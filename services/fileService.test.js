const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const mockCoursesPath = path.join(__dirname, '..', 'test-fixtures', 'courses');
process.env.COURSES_PATH = mockCoursesPath;

const { scanCourse, normalizeTitle, naturalSort } = require('./fileService');

test('fileService - naturalSort', (t) => {
  const arr = ['10 - advanced.mp4', '02 - basic.mp4', '01 - intro.mp4'];
  arr.sort(naturalSort);
  assert.deepStrictEqual(arr, ['01 - intro.mp4', '02 - basic.mp4', '10 - advanced.mp4']);
});

test('fileService - normalizeTitle', (t) => {
  assert.strictEqual(normalizeTitle('01 - Corpo macchina.mp4'), 'Corpo macchina');
  assert.strictEqual(normalizeTitle('02_Obiettivi.mp4'), 'Obiettivi');
  assert.strictEqual(normalizeTitle('10. Avanzate.md'), 'Avanzate');
  assert.strictEqual(normalizeTitle('Benvenuto.mp4'), 'Benvenuto');
});

test('fileService - scanCourse', (t) => {
  // Setup fixture
  const coursePath = path.join(mockCoursesPath, 'Fotografia');
  if (fs.existsSync(mockCoursesPath)) {
    fs.rmSync(mockCoursesPath, { recursive: true, force: true });
  }
  fs.mkdirSync(coursePath, { recursive: true });
  
  // Root file
  fs.writeFileSync(path.join(coursePath, '00 - Introduzione.mp4'), '');
  
  // Section 1
  const sec1 = path.join(coursePath, '01 - Fotocamera');
  fs.mkdirSync(sec1);
  fs.writeFileSync(path.join(sec1, '01 - Corpo macchina.mp4'), '');
  fs.writeFileSync(path.join(sec1, 'guida.pdf'), '');
  
  // Section 1 Deep
  const sec1Deep = path.join(sec1, 'approfondimenti');
  fs.mkdirSync(sec1Deep);
  fs.writeFileSync(path.join(sec1Deep, 'schema.jpg'), '');
  
  const result = scanCourse(coursePath);
  
  // Root Section
  assert.strictEqual(result.rootSection.lessons.length, 1);
  assert.strictEqual(result.rootSection.lessons[0].title, 'Introduzione');
  
  // Sections
  assert.strictEqual(result.sections.length, 1);
  const s1 = result.sections[0];
  assert.strictEqual(s1.title, 'Fotocamera');
  
  // Nested mapping
  assert.strictEqual(s1.lessons.length, 1);
  assert.strictEqual(s1.materials.length, 1); // guida.pdf
  assert.strictEqual(s1.children.length, 1); // approfondimenti
  
  // Deep path correctly assigned
  const childSec = s1.children[0];
  assert.strictEqual(childSec.title, 'approfondimenti');
  assert.strictEqual(childSec.materials.length, 1); // schema.jpg
  
  const schemaItem = childSec.materials[0];
  assert.strictEqual(schemaItem.title, 'schema');
});
