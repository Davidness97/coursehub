const path = require('path');
const fs = require('fs');

require('dotenv').config();

// Ensure COURSES_PATH is absolute
const rawCoursesPath = process.env.COURSES_PATH || '/courses';
const COURSES_ROOT = path.resolve(rawCoursesPath);

/**
 * Normalizes an input path to a clean relative path using forward slashes.
 * Removes leading '/' or 'courses/'.
 * Prevents traversal by resolving lexically.
 * @param {string} input 
 * @returns {string|null} The normalized relative path, or null if traversal detected.
 */
function normalizeRelativeCoursePath(input) {
  if (!input || typeof input !== 'string') return '';

  let decoded = input;
  if (input.includes('%')) {
    try {
      let temp = decodeURIComponent(input);
      // Only use decoded if it's different, to prevent endless issues, though temp is fine
      decoded = temp;
    } catch (e) {
      // If it fails to decode (e.g., contains literal '%' like '50%.mp4'), 
      // just use the original string.
      decoded = input;
    }
  }
  // Normalize slashes to Unix style for processing
  let normalized = decoded.replace(/\\/g, '/');

  // Strip leading slashes
  normalized = normalized.replace(/^\/+/, '');
  
  // Strip accidental "courses/" or "courses\" prefix
  if (normalized.toLowerCase().startsWith('courses/')) {
    normalized = normalized.substring('courses/'.length);
    // Strip any additional leading slashes after removing courses/
    normalized = normalized.replace(/^\/+/, '');
  }
  if (normalized.toLowerCase() === 'courses') {
    normalized = '';
  }

  // Ensure it's purely relative and doesn't traverse up
  // We use a virtual root to detect if the path escapes
  const testRoot = '/__virtual_root__';
  const testPath = path.posix.join(testRoot, normalized);
  if (!testPath.startsWith(testRoot + '/') && testPath !== testRoot) {
    return null; // Path traversal detected
  }
  
  // Return the path relative to the test root, normalized to forward slashes
  let relative = testPath === testRoot ? '' : testPath.substring(testRoot.length + 1);
  return relative;
}

/**
 * Checks if a lexical absolute path is inside the COURSES_ROOT.
 * Does not check the filesystem.
 */
function isPathInsideCoursesRoot(absolutePath) {
  const relative = path.relative(COURSES_ROOT, absolutePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolves an input to an absolute path, ensuring it's within COURSES_ROOT.
 * If the path exists on disk, it also checks realpath to prevent symlink escapes.
 * @param {string} input 
 * @returns {string|null} Absolute path if safe, null otherwise
 */
function safeResolveCoursePath(input) {
  const relative = normalizeRelativeCoursePath(input);
  if (relative === null) return null; // Traversal in relative path

  const absolutePath = path.join(COURSES_ROOT, relative);

  // Check lexical containment
  if (relative !== '' && !isPathInsideCoursesRoot(absolutePath)) {
    return null;
  }
  if (relative === '' && absolutePath !== COURSES_ROOT) {
    return null;
  }

  // If file exists, check realpath to prevent symlink traversal outside COURSES_ROOT
  if (fs.existsSync(absolutePath)) {
    try {
      const realTarget = fs.realpathSync(absolutePath);
      const realRoot = fs.realpathSync(COURSES_ROOT);
      
      const realRelative = path.relative(realRoot, realTarget);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        return null; // Symlink points outside root
      }
    } catch (e) {
      // Error reading realpath (permissions etc.), fail closed
      return null;
    }
  }

  return absolutePath;
}

/**
 * Converts a safe absolute path back to a relative course path (forward slashes).
 * Assumes the absolute path has already been validated.
 */
function toCourseRelativePath(absolutePath) {
  const relative = path.relative(COURSES_ROOT, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null; // Not inside root
  }
  return relative.replace(/\\/g, '/');
}

module.exports = {
  COURSES_ROOT,
  normalizeRelativeCoursePath,
  safeResolveCoursePath,
  toCourseRelativePath,
  isPathInsideCoursesRoot
};
