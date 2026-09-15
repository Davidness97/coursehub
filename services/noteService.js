const db = require('./db');

function getCourseNote(courseId) {
  const row = db.prepare('SELECT content FROM course_notes WHERE course_id = ?').get(courseId);
  return row ? row.content : '';
}

function saveCourseNote(courseId, content) {
  const existing = db.prepare('SELECT id FROM course_notes WHERE course_id = ?').get(courseId);
  if (existing) {
    db.prepare('UPDATE course_notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE course_id = ?')
      .run(content, courseId);
  } else {
    db.prepare('INSERT INTO course_notes (course_id, content) VALUES (?, ?)')
      .run(courseId, content);
  }
}

function getLessonNote(lessonId) {
  const row = db.prepare('SELECT content FROM lesson_notes WHERE lesson_id = ?').get(lessonId);
  return row ? row.content : '';
}

function saveLessonNote(lessonId, content) {
  const existing = db.prepare('SELECT id FROM lesson_notes WHERE lesson_id = ?').get(lessonId);
  if (existing) {
    db.prepare('UPDATE lesson_notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE lesson_id = ?')
      .run(content, lessonId);
  } else {
    db.prepare('INSERT INTO lesson_notes (lesson_id, content) VALUES (?, ?)')
      .run(lessonId, content);
  }
}

module.exports = {
  getCourseNote,
  saveCourseNote,
  getLessonNote,
  saveLessonNote
};
