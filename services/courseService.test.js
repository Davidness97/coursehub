const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const mockCoursesPath = path.join(__dirname, '..', 'test-fixtures', 'courses');
const mockDataPath = path.join(__dirname, '..', 'test-fixtures', 'data');
process.env.COURSES_PATH = mockCoursesPath;
process.env.DATA_PATH = mockDataPath;

const db = require('./db');
const { createCourse, refreshCourse, getCourseLessons } = require('./courseService');

test('courseService - conservative sync', (t) => {
  // Clear tables
  db.prepare('DELETE FROM courses').run();
  
  // Setup fixture
  const coursePath = path.join(mockCoursesPath, 'SyncTest');
  if (fs.existsSync(mockCoursesPath)) {
    fs.rmSync(mockCoursesPath, { recursive: true, force: true });
  }
  fs.mkdirSync(coursePath, { recursive: true });
  
  // Create Initial File
  const file1 = path.join(coursePath, '01 - Intro.mp4');
  fs.writeFileSync(file1, '');

  const courseId = createCourse({
    title: 'Sync Test Course',
    folder_path: 'SyncTest'
  });

  let lessons = getCourseLessons(courseId);
  assert.strictEqual(lessons.length, 1);
  assert.strictEqual(lessons[0].title, 'Intro');
  assert.strictEqual(lessons[0].is_missing, 0);

  const originalLessonId = lessons[0].id;

  // Add Progress to this lesson to verify it survives
  db.prepare('INSERT INTO progress (lesson_id, completed, last_position) VALUES (?, ?, ?)')
    .run(originalLessonId, 1, 50.5);

  // Now REMOVE the file and add a new one
  fs.unlinkSync(file1);
  const file2 = path.join(coursePath, '02 - Avanzato.mp4');
  fs.writeFileSync(file2, '');

  // Refresh
  const refresh1 = refreshCourse(courseId);
  assert.strictEqual(refresh1.added, 1); // Avanzato
  assert.strictEqual(refresh1.updated, 0); 
  
  lessons = getCourseLessons(courseId);
  assert.strictEqual(lessons.length, 2); // Both exist in DB
  
  const intro = lessons.find(l => l.title === 'Intro');
  const avanzato = lessons.find(l => l.title === 'Avanzato');
  
  assert.strictEqual(intro.is_missing, 1);
  assert.ok(intro.missing_at !== null);
  assert.strictEqual(intro.id, originalLessonId); // ID didn't change
  
  // Verify progress is still there
  const prog = db.prepare('SELECT * FROM progress WHERE lesson_id = ?').get(originalLessonId);
  assert.ok(prog);
  assert.strictEqual(prog.completed, 1);
  assert.strictEqual(prog.last_position, 50.5);

  assert.strictEqual(avanzato.is_missing, 0);
  
  // Re-add the file to test reactivation
  fs.writeFileSync(file1, '');
  const refresh2 = refreshCourse(courseId);
  assert.strictEqual(refresh2.reactivated, 1);
  
  lessons = getCourseLessons(courseId);
  const introAgain = lessons.find(l => l.title === 'Intro');
  assert.strictEqual(introAgain.is_missing, 0);
  assert.strictEqual(introAgain.missing_at, null);
  assert.strictEqual(introAgain.id, originalLessonId); // ID remains the same
});
