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
    const nameA = path.parse(a).name;
    const nameB = path.parse(b).name;
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
}

function isVideoCompatible(ext) {
  const e = ext.toLowerCase();
  return e === '.mp4' || e === '.webm';
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
      materials: [],
      children: []
    },
    sections: [],
    allLessons: [],
    allMaterials: []
  };

const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

// Helper function per estrarre la durata con ffprobe in modo asincrono
async function getVideoDuration(absolutePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      absolutePath
    ], { timeout: 5000 });
    const duration = parseFloat(stdout);
    return isNaN(duration) ? 0 : duration;
  } catch (e) {
    return 0; // ffprobe mancante o fallito
  }
}

async function scanCourse(coursePath) {
  const absolutePath = safeResolveCoursePath(coursePath);
  
  const result = {
    rootSection: { lessons: [], materials: [], children: [] },
    sections: [], // Flat list of all created sections
    allLessons: [], // Flat list of all lessons
    allMaterials: [] // Flat list of all materials
  };

  if (!absolutePath) return result;
  
  let entries;
  try {
    entries = fs.readdirSync(absolutePath, { withFileTypes: true })
      .filter(e => !isHiddenOrIgnored(e.name))
      .sort((a, b) => naturalSort(a.name, b.name));
  } catch(e) {
    return result;
  }

  // First pass: Root files and Section folders
  for (const entry of entries) {
    const fullPath = path.join(absolutePath, entry.name);
    const relativeToRoot = toCourseRelativePath(fullPath);
    
    if (!relativeToRoot) continue;

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
          item.compatible = isVideoCompatible(ext);
          item.duration = await getVideoDuration(fullPath);
          result.rootSection.lessons.push(item);
          result.allLessons.push(item);
        } else {
          result.rootSection.materials.push(item);
          result.allMaterials.push(item);
        }
      }
    } else if (entry.isDirectory()) {
      // Create a top-level section
      const section = {
        id: Buffer.from(relativeToRoot).toString('base64').replace(/[^a-zA-Z0-9]/g, ''),
        title: normalizeTitle(entry.name),
        relativePath: relativeToRoot,
        lessons: [],
        materials: [],
        children: []
      };
      
      // Recursively scan deep files and folders
      await scanDirectoryDeep(fullPath, section, result, section.relativePath);
      
      result.sections.push(section);
    }
  }

  return result;
}

async function scanDirectoryDeep(dirPath, parentNode, result, sectionRootRelative) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !isHiddenOrIgnored(e.name))
      .sort((a, b) => naturalSort(a.name, b.name));
  } catch (e) {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativeToRoot = toCourseRelativePath(fullPath);
    if (!relativeToRoot) continue;

    if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const type = getFileType(ext);
      
      if (type !== 'unknown') {
        const pathInsideSection = relativeToRoot.substring(sectionRootRelative.length + 1);
        
        const item = {
          title: normalizeTitle(entry.name),
          relativePath: relativeToRoot,
          section_relative_path: sectionRootRelative,
          path_inside_section: pathInsideSection,
          fileType: type
        };
        
        if (type === 'video') {
          item.compatible = isVideoCompatible(ext);
          item.duration = await getVideoDuration(fullPath);
          parentNode.lessons.push(item);
          result.allLessons.push(item);
        } else {
          parentNode.materials.push(item);
          result.allMaterials.push(item);
        }
      }
    } else if (entry.isDirectory()) {
      // Create a child node
      const childNode = {
        id: Buffer.from(relativeToRoot).toString('base64').replace(/[^a-zA-Z0-9]/g, ''),
        title: normalizeTitle(entry.name),
        relativePath: relativeToRoot,
        lessons: [],
        materials: [],
        children: []
      };
      
      parentNode.children.push(childNode);
      await scanDirectoryDeep(fullPath, childNode, result, sectionRootRelative);
    }
  }
}

module.exports = {
  scanCourse,
  getFileType,
  normalizeTitle,
  naturalSort
};
