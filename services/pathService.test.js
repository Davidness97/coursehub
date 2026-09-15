const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Set a mock COURSES_PATH before importing
const mockCoursesPath = path.join(__dirname, '..', 'test-fixtures', 'courses');
process.env.COURSES_PATH = mockCoursesPath;

const {
  normalizeRelativeCoursePath,
  safeResolveCoursePath,
  toCourseRelativePath,
  isPathInsideCoursesRoot
} = require('./pathService');

test('pathService - normalizeRelativeCoursePath', (t) => {
  assert.strictEqual(normalizeRelativeCoursePath('Arte'), 'Arte');
  assert.strictEqual(normalizeRelativeCoursePath('/courses/Arte'), 'Arte');
  assert.strictEqual(normalizeRelativeCoursePath('courses/Arte'), 'Arte');
  assert.strictEqual(normalizeRelativeCoursePath('/courses//Arte'), 'Arte');
  assert.strictEqual(normalizeRelativeCoursePath('./Arte'), 'Arte');
  assert.strictEqual(normalizeRelativeCoursePath('Arte/Modulo 1'), 'Arte/Modulo 1');
  assert.strictEqual(normalizeRelativeCoursePath('Arte\\Modulo 1'), 'Arte/Modulo 1');
  
  // URL encoded traversal
  assert.strictEqual(normalizeRelativeCoursePath('%2e%2e/%2e%2e/etc/passwd'), null);
  
  // Normal traversal
  assert.strictEqual(normalizeRelativeCoursePath('../../etc/passwd'), null);
  assert.strictEqual(normalizeRelativeCoursePath('/../../etc/passwd'), null);
});

test('pathService - safeResolveCoursePath and symlinks', (t) => {
  // Create fixture directory
  if (fs.existsSync(mockCoursesPath)) {
    fs.rmSync(mockCoursesPath, { recursive: true, force: true });
  }
  fs.mkdirSync(mockCoursesPath, { recursive: true });
  
  const safeFile = path.join(mockCoursesPath, 'safe.txt');
  fs.writeFileSync(safeFile, 'test');
  
  const outsideDir = path.join(__dirname, '..', 'test-fixtures', 'outside');
  if (!fs.existsSync(outsideDir)) fs.mkdirSync(outsideDir, { recursive: true });
  const outsideFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(outsideFile, 'secret');
  
  // Create a symlink pointing outside
  const symlinkPath = path.join(mockCoursesPath, 'bad-link');
  try {
    fs.symlinkSync(outsideDir, symlinkPath, 'junction'); // Using junction on Windows for directories, or symlink if admin
  } catch (e) {
    // If we can't create symlinks on Windows without admin, we skip the symlink test
    // but the test logic itself is sound.
  }
  
  // Test safe file
  const resolvedSafe = safeResolveCoursePath('safe.txt');
  assert.ok(resolvedSafe);
  assert.strictEqual(resolvedSafe, safeFile);
  
  // Test symlink if it was created
  if (fs.existsSync(symlinkPath)) {
    const resolvedBad = safeResolveCoursePath('bad-link/secret.txt');
    assert.strictEqual(resolvedBad, null);
  }
});
