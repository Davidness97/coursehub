const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const courseService = require('../services/courseService');
const db = require('../services/db');
const { safeResolveCoursePath } = require('../services/pathService');

const DATA_PATH = process.env.DATA_PATH || '/data';
const coversDir = path.join(DATA_PATH, 'covers');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, coversDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Home / Library
router.get('/', (req, res) => {
  const { search, category, sort } = req.query;
  const courses = courseService.getAllCourses({ search, category, sort });
  const allCategories = courseService.getCategories();
  
  // Enrich with basic progress
  for (const course of courses) {
    const stats = db.prepare(`
      SELECT 
        COUNT(l.id) as total_lessons,
        SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) as completed_lessons,
        SUM(p.watched_seconds) as watched_seconds,
        SUM(l.duration) as total_seconds
      FROM lessons l
      LEFT JOIN progress p ON l.id = p.lesson_id
      WHERE l.course_id = ? AND l.file_type = 'video' AND l.is_missing = 0
    `).get(course.id);
    
    course.total_lessons = stats.total_lessons;
    course.completed_lessons = stats.completed_lessons;
    course.watched_seconds = stats.watched_seconds || 0;
    
    // Percentuale basata sul tempo guardato se la durata totale > 0, altrimenti basata sui video completati come fallback
    if (course.total_duration_seconds > 0) {
       course.progress_pct = Math.round((course.watched_seconds / course.total_duration_seconds) * 100);
       if (course.progress_pct > 100) course.progress_pct = 100;
    } else {
       course.progress_pct = stats.total_lessons > 0 
         ? Math.round((stats.completed_lessons / stats.total_lessons) * 100) 
         : null;
    }
  }
  
  res.render('index', { 
    courses, 
    categories: allCategories, 
    query: { search: search || '', category: category || '', sort: sort || '' }
  });
});

// Add Course Form
router.get('/courses/add', (req, res) => {
  const allCategories = courseService.getCategories();
  res.render('course_form', { course: {}, categories: allCategories, error: null });
});

// Edit Course Form
router.get('/courses/edit/:id', (req, res) => {
  const course = courseService.getCourse(req.params.id);
  if (!course) return res.status(404).send('Corso non trovato');
  const allCategories = courseService.getCategories();
  res.render('course_form', { course, categories: allCategories, error: null });
});

// Add Course Submit
router.post('/courses/add', upload.single('cover'), async (req, res) => {
  const { description, category, multi_folder_paths, multi_titles } = req.body;
  const allCategories = courseService.getCategories();
  
  if (!multi_folder_paths || !multi_folder_paths.length) {
    return res.render('course_form', { course: req.body, categories: allCategories, error: 'Devi selezionare almeno una cartella.' });
  }
  let cover_type = null;
  let cover_path = null;

  if (req.file) {
    cover_type = 'uploaded';
    cover_path = req.file.filename;
  } else if (req.body.cover_downloaded_filename) {
    cover_type = 'uploaded';
    cover_path = req.body.cover_downloaded_filename;
  } else if (req.body.cover_fs_path) {
    if (safeResolveCoursePath(req.body.cover_fs_path)) {
      cover_type = 'filesystem';
      cover_path = req.body.cover_fs_path;
    }
  }

  const paths = Array.isArray(multi_folder_paths) ? multi_folder_paths : [multi_folder_paths];
  const titles = Array.isArray(multi_titles) ? multi_titles : [multi_titles];

  const errors = [];
  let addedCount = 0;

  for (let i = 0; i < paths.length; i++) {
    const fPath = paths[i];
    const fTitle = titles[i] || fPath;
    
    if (!safeResolveCoursePath(fPath)) {
      errors.push(`Percorso non valido: ${fPath}`);
      continue;
    }

    try {
      await courseService.createCourse({
        title: fTitle,
        description: description || '',
        category: category || '',
        folder_path: fPath,
        cover_type,
        cover_path
      });
      addedCount++;
    } catch (err) {
      errors.push(`Errore per "${fTitle}": ${err.message}`);
    }
  }

  if (errors.length > 0) {
    if (addedCount > 0) {
      // Partial success
      return res.render('course_form', { 
        course: req.body, 
        categories: allCategories,
        error: `Creati ${addedCount} corsi. Errori: ` + errors.join(' | ') 
      });
    } else {
      // Total failure
      return res.render('course_form', { 
        course: req.body, 
        categories: allCategories,
        error: errors.join(' | ') 
      });
    }
  }

  res.redirect('/');
});

// Course View
router.get('/courses/:id', async (req, res) => {
  const course = courseService.getCourse(req.params.id);
  if (!course) return res.status(404).send('Corso non trovato');
  
  let scanResult;
  try {
    const absolutePath = safeResolveCoursePath(course.folder_path);
    if (!absolutePath) throw new Error('Path non valido');
    scanResult = await require('../services/fileService').scanCourse(absolutePath);
  } catch (e) {
    return res.status(500).send('Impossibile scansionare il corso: ' + e.message);
  }
  
  // Lessons in DB
  const dbLessons = courseService.getCourseLessons(course.id);
  const dbLessonsMap = new Map();
  dbLessons.forEach(l => dbLessonsMap.set(l.relative_path, l));
  
  // Progress
  const progressRows = db.prepare('SELECT * FROM progress WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)').all(course.id);
  const progressMap = {};
  let watched_seconds = 0;
  progressRows.forEach(p => {
    progressMap[p.lesson_id] = p;
    watched_seconds += p.watched_seconds || 0;
  });
  
  course.watched_seconds = watched_seconds;
  if (course.total_duration_seconds > 0) {
    course.progress_pct = Math.round((course.watched_seconds / course.total_duration_seconds) * 100);
    if (course.progress_pct > 100) course.progress_pct = 100;
  } else {
    course.progress_pct = 0;
  }
  
  // Find last watched section
  let lastWatchedSectionId = null;
  const lastWatchedProgress = db.prepare(`
    SELECT p.lesson_id, l.section_relative_path 
    FROM progress p
    JOIN lessons l ON p.lesson_id = l.id
    WHERE l.course_id = ? 
    ORDER BY p.last_watched_at DESC LIMIT 1
  `).get(course.id);
  
  if (lastWatchedProgress && lastWatchedProgress.section_relative_path) {
     // The section.id in fileService is generated as base64 of relativeToRoot
     lastWatchedSectionId = Buffer.from(lastWatchedProgress.section_relative_path).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  } else {
     // fallback to root or first section
     lastWatchedSectionId = '__root__';
  }

  const noteService = require('../services/noteService');
  const courseNote = noteService.getCourseNote(course.id);

  res.render('course_view', { 
    course, 
    rootSection: scanResult.rootSection, 
    sections: scanResult.sections, 
    dbLessonsMap,
    progressMap,
    courseNote,
    lastWatchedSectionId,
    reqQuery: req.query
  });
});

// Lesson View
router.get('/courses/:courseId/lessons/:lessonId', (req, res) => {
  const course = courseService.getCourse(req.params.courseId);
  if (!course) return res.status(404).send('Corso non trovato');

  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ? AND course_id = ?').get(req.params.lessonId, course.id);
  if (!lesson) return res.status(404).send('Lezione non trovata');

  // Breadcrumb prep
  const sectionTitle = lesson.section_relative_path ? lesson.section_relative_path.split('/').pop().replace(/^\d+[\s\-_.]*/, '').trim() : 'Contenuti principali';

  // Get all lessons to build sidebar and next/prev
  const allLessons = courseService.getCourseLessons(course.id).filter(l => !l.is_missing);
  
  const currentIndex = allLessons.findIndex(l => l.id === lesson.id);
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;

  // Progress
  const progressService = require('../services/progressService');
  const progress = progressService.getProgress(lesson.id) || { completed: 0, last_position: 0 };

  // Notes
  const noteService = require('../services/noteService');
  const note = noteService.getLessonNote(lesson.id);

  // Re-fetch materials for sidebar if we want, or just pass minimal course info.
  // We can pass `allLessons` for a simple playlist sidebar.
  
  res.render('lesson_view', { 
    course, 
    lesson, 
    sectionTitle, 
    allLessons, 
    prevLesson, 
    nextLesson, 
    progress,
    note
  });
});

// Edit Course Form
router.get('/courses/:id/edit', (req, res) => {
  const course = courseService.getCourse(req.params.id);
  if (!course) return res.status(404).send('Corso non trovato');
  const allCategories = courseService.getCategories();
  res.render('course_form', { course, categories: allCategories, error: null });
});

// Edit Course Submit
router.post('/courses/:id/edit', upload.single('cover'), async (req, res) => {
  const course = courseService.getCourse(req.params.id);
  const allCategories = courseService.getCategories();
  if (!course) return res.status(404).send('Corso non trovato');

  const { title, description, category, folder_path } = req.body;
  if (!title || !folder_path) {
    return res.render('course_form', { course: { ...course, ...req.body }, categories: allCategories, error: 'Titolo e cartella sono obbligatori.' });
  }

  if (!safeResolveCoursePath(folder_path)) {
    return res.render('course_form', { course: { ...course, ...req.body }, categories: allCategories, error: 'Percorso non autorizzato.' });
  }

  let cover_type = course.cover_type;
  let cover_path = course.cover_path;

  if (req.file) {
    cover_type = 'uploaded';
    cover_path = req.file.filename;
  } else if (req.body.cover_downloaded_filename) {
    cover_type = 'uploaded';
    cover_path = req.body.cover_downloaded_filename;
  } else if (req.body.cover_fs_path) {
    if (safeResolveCoursePath(req.body.cover_fs_path)) {
      cover_type = 'filesystem';
      cover_path = req.body.cover_fs_path;
    }
  }
  
  try {
    courseService.updateCourse(course.id, {
      title, description, category, folder_path, cover_type, cover_path
    });
    // Trigger un refresh morbido
    await courseService.refreshCourse(course.id);
    res.redirect('/courses/' + course.id);
  } catch (e) {
    res.render('course_form', { course: { ...course, ...req.body }, categories: allCategories, error: 'Errore: ' + e.message });
  }
});

// Refresh Content
router.post('/courses/:id/refresh', async (req, res) => {
  const course = courseService.getCourse(req.params.id);
  if (!course) return res.status(404).send('Corso non trovato');
  
  try {
    const result = await courseService.refreshCourse(course.id);
    // Passing success feedback could be done via session/flash, but for now we'll just redirect
    res.redirect('/courses/' + course.id + '?refreshed=1&added=' + result.added + '&updated=' + result.updated + '&reactivated=' + result.reactivated);
  } catch(e) {
    res.status(500).send('Errore durante il refresh: ' + e.message);
  }
});

// Delete Course
router.post('/courses/:id/delete', (req, res) => {
  courseService.deleteCourse(req.params.id);
  res.redirect('/');
});

module.exports = router;
