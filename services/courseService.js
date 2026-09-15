const db = require('./db');
const path = require('path');
const { COURSES_ROOT } = require('./pathService');
const { scanCourse } = require('./fileService');

function getAllCourses(options = {}) {
  let query = `
    SELECT c.*, 
           COALESCE(SUM(l.duration), 0) as total_duration_seconds
    FROM courses c
    LEFT JOIN lessons l ON c.id = l.course_id AND l.is_missing = 0
  `;
  
  const conditions = [];
  const params = [];
  
  if (options.search) {
    conditions.push('c.title LIKE ?');
    params.push('%' + options.search + '%');
  }
  
  if (options.category) {
    conditions.push('c.category = ?');
    params.push(options.category);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' GROUP BY c.id ';
  
  if (options.sort === 'alpha_asc') {
    query += ' ORDER BY c.title ASC';
  } else if (options.sort === 'duration_desc') {
    query += ' ORDER BY total_duration_seconds DESC';
  } else if (options.sort === 'duration_asc') {
    query += ' ORDER BY total_duration_seconds ASC';
  } else {
    // Default
    query += ' ORDER BY c.updated_at DESC';
  }
  
  return db.prepare(query).all(...params);
}

function getCategories() {
  const rows = db.prepare('SELECT DISTINCT category FROM courses WHERE category IS NOT NULL AND category != "" ORDER BY category ASC').all();
  return rows.map(r => r.category);
}

function getCourse(id) {
  return db.prepare(`
    SELECT c.*, 
           COALESCE(SUM(l.duration), 0) as total_duration_seconds
    FROM courses c
    LEFT JOIN lessons l ON c.id = l.course_id AND l.is_missing = 0
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id);
}

async function createCourse(data) {
  const stmt = db.prepare(`
    INSERT INTO courses (title, description, category, folder_path, cover_type, cover_path)
    VALUES (@title, @description, @category, @folder_path, @cover_type, @cover_path)
  `);
  
  const info = stmt.run({
    title: data.title,
    description: data.description || '',
    category: data.category || '',
    folder_path: data.folder_path,
    cover_type: data.cover_type || null,
    cover_path: data.cover_path || null
  });
  
  // Scansione iniziale asincrona
  await refreshCourse(info.lastInsertRowid);
  
  return info.lastInsertRowid;
}

function updateCourse(id, data) {
  const stmt = db.prepare(`
    UPDATE courses 
    SET title = @title, description = @description, category = @category, folder_path = @folder_path, 
        cover_type = @cover_type, cover_path = @cover_path, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  
  stmt.run({
    id,
    title: data.title,
    description: data.description || '',
    category: data.category || '',
    folder_path: data.folder_path,
    cover_type: data.cover_type || null,
    cover_path: data.cover_path || null
  });
}

function deleteCourse(id) {
  db.prepare('DELETE FROM courses WHERE id = ?').run(id);
}

function syncLessons(courseId, scanResult) {
  const existingLessons = db.prepare('SELECT * FROM lessons WHERE course_id = ?').all(courseId);
  const existingMap = new Map();
  for (const l of existingLessons) {
    existingMap.set(l.relative_path, l);
  }

  const newLessons = scanResult.allLessons;
  const newMap = new Map();
  
  const updateStmt = db.prepare(`
    UPDATE lessons 
    SET title = @title, section_relative_path = @section_relative_path, 
        duration = @duration, order_index = @order_index, is_missing = 0, missing_at = NULL, 
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  
  const insertStmt = db.prepare(`
    INSERT INTO lessons (course_id, title, relative_path, section_relative_path, file_type, duration, order_index)
    VALUES (@course_id, @title, @relative_path, @section_relative_path, @file_type, @duration, @order_index)
  `);

  const markMissingStmt = db.prepare(`
    UPDATE lessons
    SET is_missing = 1, missing_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND is_missing = 0
  `);

  let added = 0;
  let updated = 0;
  let reactivated = 0;

  db.transaction(() => {
    // 1. Update existing, reactivate, or insert new
    newLessons.forEach((lesson, index) => {
      newMap.set(lesson.relativePath, true);
      const existing = existingMap.get(lesson.relativePath);
      
      if (existing) {
        updateStmt.run({
          id: existing.id,
          title: lesson.title,
          section_relative_path: lesson.section_relative_path || '',
          duration: lesson.duration || 0,
          order_index: index
        });
        if (existing.is_missing) {
          reactivated++;
        } else {
          updated++;
        }
      } else {
        insertStmt.run({
          course_id: courseId,
          title: lesson.title,
          relative_path: lesson.relativePath,
          section_relative_path: lesson.section_relative_path || '',
          file_type: lesson.fileType,
          duration: lesson.duration || 0,
          order_index: index
        });
        added++;
      }
    });

    // 2. Mark missing
    let missingCount = 0;
    for (const existing of existingLessons) {
      if (!newMap.has(existing.relative_path)) {
        if (!existing.is_missing) {
          markMissingStmt.run({ id: existing.id });
          missingCount++;
        }
      }
    }
  })();

  return { added, updated, reactivated };
}

async function refreshCourse(id) {
  const course = getCourse(id);
  if (!course) throw new Error('Course not found');

  const absolutePath = path.join(COURSES_ROOT, course.folder_path);
  const scanResult = await scanCourse(absolutePath);
  
  return syncLessons(id, scanResult);
}

function getCourseLessons(courseId) {
  return db.prepare(`
    SELECT l.*, p.completed 
    FROM lessons l
    LEFT JOIN progress p ON l.id = p.lesson_id
    WHERE l.course_id = ? 
    ORDER BY l.order_index ASC
  `).all(courseId);
}

module.exports = {
  getAllCourses,
  getCategories,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  getCourseLessons,
  getLesson,
  updateProgress,
  getCourseNotes,
  updateCourseNotes,
  getLessonNotes,
  updateLessonNotes,
  refreshCourse,
  syncLessons
};
