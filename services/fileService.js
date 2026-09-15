const fs = require('fs');
const path = require('path');
const { COURSES_ROOT, toCourseRelativePath } = require('./pathService');

const SUPPORTED_VIDEO = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];
const SUPPORTED_DOCS = ['.pdf', '.md', '.txt'];
const SUPPORTED_IMAGES = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
const IGNORED_NAMES = ['.ds_store', 'thumbs.db', '.git', 'node_modules'];

function isHiddenOrIgnored(filename) {
  const lower = filename.toLowerCase();
  if (lower.startsWith('.') && lower !== '.md') return true;
  if (IGNORED_NAMES.includes(lower)) return true;
  return false;
}

function getFileType(ext) {
  const e = ext.toLowerCase();
  if (SUPPORTED_VIDEO.includes(e)) return 'video';
  if (SUPPORTED_DOCS.includes(e) || SUPPORTED_IMAGES.includes(e)) return 'material';
  return 'unknown';
}

function normalizeTitle(filename) {
  let title = path.basename(filename, path.extname(filename));
  // Remove prefixes like "01 - ", "02_", "03."
  title = title.replace(/^\d+[\s\-_.]*/, '');
  return title.trim();
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function scanCourse(folderAbsolutePath) {
  if (!fs.existsSync(folderAbsolutePath)) {
    throw new Error(`Course directory not found: ${folderAbsolutePath}`);
  }

  const courseRelativePath = toCourseRelativePath(folderAbsolutePath) || '';

  const result = {
    rootSection: {
      id: '__root__',
      title: 'Contenuti principali',
      relativePath: courseRelativePath,
      lessons: [],
      materials: []
    },
    sections: [],
    allLessons: [],
    allMaterials: []
  };

  const entries = fs.readdirSync(folderAbsolutePath, { withFileTypes: true })
    .filter(e => !isHiddenOrIgnored(e.name))
    .sort((a, b) => naturalSort(a.name, b.name));

  // First pass: Root files and Section folders
  for (const entry of entries) {
    const fullPath = path.join(folderAbsolutePath, entry.name);
    const relativeToRoot = toCourseRelativePath(fullPath);
    
    if (!relativeToRoot) continue; // Out of bounds symlink, skipped safely

    if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const type = getFileType(ext);
      if (type !== 'unknown') {
        const item = {
          title: normalizeTitle(entry.name),
          relativePath: relativeToRoot,
          fileType: type,
        };
        if (type === 'video') {
          result.rootSection.lessons.push(item);
          result.allLessons.push(item);
        } else {
          result.rootSection.materials.push(item);
          result.allMaterials.push(item);
        }
      }
    } else if (entry.isDirectory()) {
      // Create a section
      const section = {
        id: entry.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        title: normalizeTitle(entry.name),
        relativePath: relativeToRoot,
        lessons: [],
        materials: [],
        descendants: []
      };
      
      // Recursively scan deep files and map them to this section
      scanDirectoryDeep(fullPath, section, result, section.relativePath);
      
      result.sections.push(section);
    }
  }

  return result;
}

function scanDirectoryDeep(dirPath, section, result, sectionRootRelative) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !isHiddenOrIgnored(e.name))
      .sort((a, b) => naturalSort(a.name, b.name));
  } catch (e) {
    return; // E.g., permission denied, skip safely
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativeToRoot = toCourseRelativePath(fullPath);
    if (!relativeToRoot) continue;

    if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const type = getFileType(ext);
      
      if (type !== 'unknown') {
        // path inside section calculation:
        // relativeToRoot: Arte/01 - Fotocamera/immagini/schema.jpg
        // sectionRootRelative: Arte/01 - Fotocamera
        const pathInsideSection = relativeToRoot.substring(sectionRootRelative.length + 1); // +1 for the slash
        
        const item = {
          title: normalizeTitle(entry.name),
          relativePath: relativeToRoot,
          section_relative_path: sectionRootRelative,
          path_inside_section: pathInsideSection,
          fileType: type
        };
        
        if (type === 'video') {
          section.lessons.push(item);
          result.allLessons.push(item);
        } else {
          section.materials.push(item);
          result.allMaterials.push(item);
        }
      }
    } else if (entry.isDirectory()) {
      // It's a descendant directory, just keep traversing
      section.descendants.push(relativeToRoot);
      scanDirectoryDeep(fullPath, section, result, sectionRootRelative);
    }
  }
}

module.exports = {
  scanCourse,
  getFileType,
  normalizeTitle,
  naturalSort
};
