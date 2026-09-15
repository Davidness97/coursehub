const db = require('./db');
const path = require('path');
const { COURSES_ROOT } = require('./pathService');
const { scanCourse } = require('./fileService');

function getAllCourses() {
  return db.prepare('SELECT * FROM courses ORDER BY updated_at DESC').all();
}

function getCourse(id) {
  return db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
}

function createCourse(data) {
  const stmt = db.prepare(`
    INSERT INTO courses (title, description, folder_path, cover_type, cover_path)
    VALUES (@title, @description, @folder_path, @cover_type, @cover_path)
  `);
  
  const info = stmt.run({
    title: data.title,
    description: data.description || '',
    folder_path: data.folder_path,
    cover_type: data.cover_type || null,
    cover_path: data.cover_path || null
  });
  
  // Scansione iniziale
  refreshCourse(info.lastInsertRowid);
  
  return info.lastInsertRowid;
}

function updateCourse(id, data) {
  const stmt = db.prepare(`
    UPDATE courses 
    SET title = @title, description = @description, folder_path = @folder_path, 
        cover_type = @cover_type, cover_path = @cover_path, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  
  stmt.run({
    id,
    title: data.title,
    description: data.description || '',
    folder_path: data.folder_path,
    cover_type: data.cover_type || null,
    cover_path: data.cover_path || null
  });
}

function deleteCourse(id) {
  // SQLite ON DELETE CASCADE will handle lessons, progress, and notes
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
        order_index = @order_index, is_missing = 0, missing_at = NULL, 
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  
  const insertStmt = db.prepare(`
    INSERT INTO lessons (course_id, title, relative_path, section_relative_path, file_type, order_index)
    VALUES (@course_id, @title, @relative_path, @section_relative_path, @file_type, @order_index)
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

function refreshCourse(id) {
  const course = getCourse(id);
  if (!course) throw new Error('Course not found');

  const absolutePath = path.join(COURSES_ROOT, course.folder_path);
  const scanResult = scanCourse(absolutePath);
  
  return syncLessons(id, scanResult);
}

function getCourseLessons(courseId) {
  return db.prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY order_index ASC').all(courseId);
}

module.exports = {
  getAllCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  refreshCourse,
  syncLessons,
  getCourseLessons
};
