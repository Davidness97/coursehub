const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { COURSES_ROOT, safeResolveCoursePath, toCourseRelativePath } = require('../services/pathService');

// API: Browse folders (directories only)
router.get('/browse-folders', (req, res) => {
  const reqPath = req.query.path || '';
  
  // Only allow valid paths under COURSES_ROOT
  // If empty string, safeResolveCoursePath resolves to COURSES_ROOT
  const absolutePath = safeResolveCoursePath(reqPath);
  
  if (!absolutePath) {
    return res.status(403).json({ error: 'Access denied or invalid path' });
  }
  
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'Directory not found' });
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Path is not a directory' });
  }

  const currentRelative = toCourseRelativePath(absolutePath);
  const parentAbsolute = path.dirname(absolutePath);
  let parentRelative = '';
  
  // Ensure we don't go above COURSES_ROOT
  if (absolutePath !== COURSES_ROOT && parentAbsolute.startsWith(COURSES_ROOT)) {
    parentRelative = toCourseRelativePath(parentAbsolute);
  }

  const folders = [];
  
  try {
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // ignore hidden
      
      const childAbs = path.join(absolutePath, entry.name);
      
      // If it's a symlink, check if it's safe
      if (entry.isSymbolicLink()) {
         if (!safeResolveCoursePath(toCourseRelativePath(childAbs))) {
            continue;
         }
         try {
           const realStat = fs.statSync(childAbs);
           if (!realStat.isDirectory()) continue;
         } catch(e) { continue; }
      } else if (!entry.isDirectory()) {
         continue;
      }
      
      folders.push({
        name: entry.name,
        path: toCourseRelativePath(childAbs)
      });
    }
    
    folders.sort((a, b) => a.name.localeCompare(b.name));
    
    res.json({
      current: currentRelative,
      parent: parentRelative,
      folders
    });
  } catch (err) {
    res.status(500).json({ error: 'Error reading directory' });
  }
});

// POST /api/progress
router.post('/progress', (req, res) => {
  const { lesson_id, completed, last_position, watched_seconds, total_seconds } = req.body;
  if (!lesson_id) return res.status(400).json({ error: 'lesson_id required' });
  
  try {
    const progressService = require('../services/progressService');
    progressService.updateProgress(lesson_id, {
      completed, last_position, watched_seconds, total_seconds
    });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/notes
router.post('/notes', (req, res) => {
  const { type, id, content } = req.body; // type: 'course' or 'lesson'
  if (!type || !id) return res.status(400).json({ error: 'type and id required' });
  
  try {
    const noteService = require('../services/noteService');
    if (type === 'course') {
      noteService.saveCourseNote(id, content || '');
    } else if (type === 'lesson') {
      noteService.saveLessonNote(id, content || '');
    }
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Browse images (files only)
router.get('/browse-images', (req, res) => {
  const reqPath = req.query.path || '';
  const absolutePath = safeResolveCoursePath(reqPath);
  
  if (!absolutePath) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: 'Directory not found' });

  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });

  const currentRelative = toCourseRelativePath(absolutePath);
  const parentAbsolute = path.dirname(absolutePath);
  let parentRelative = '';
  
  if (absolutePath !== COURSES_ROOT && parentAbsolute.startsWith(COURSES_ROOT)) {
    parentRelative = toCourseRelativePath(parentAbsolute);
  }

  const folders = [];
  const files = [];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
  
  try {
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      
      const childAbs = path.join(absolutePath, entry.name);
      const childRel = toCourseRelativePath(childAbs);
      if (!childRel) continue;
      
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      
      if (entry.isSymbolicLink()) {
         if (!safeResolveCoursePath(childRel)) continue;
         try {
           const realStat = fs.statSync(childAbs);
           isDir = realStat.isDirectory();
           isFile = realStat.isFile();
         } catch(e) { continue; }
      }
      
      if (isDir) {
        folders.push({ name: entry.name, path: childRel });
      } else if (isFile) {
        const ext = path.extname(entry.name).toLowerCase();
        if (allowedExts.includes(ext)) {
          files.push({ name: entry.name, path: childRel });
        }
      }
    }
    
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    
    res.json({
      current: currentRelative,
      parent: parentRelative,
      folders,
      images: files
    });
  } catch (err) {
    res.status(500).json({ error: 'Error reading directory' });
  }
});

// POST /api/download-cover (SSRF Protected & Streaming limited)
router.post('/download-cover', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL mancante' });

  try {
    const { safeFetchUrl } = require('../services/ssrfService');
    const response = await safeFetchUrl(url);

    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      response.destroy();
      return res.status(400).json({ error: 'L\'URL non punta a un\'immagine valida' });
    }

    const contentLength = response.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
      response.destroy();
      return res.status(400).json({ error: 'Immagine troppo grande (limite 10MB dichiarato)' });
    }

    // Generate filename
    const ext = contentType.split('/')[1] || 'jpg';
    const filename = `url-cover-${Date.now()}-${Math.round(Math.random() * 1E9)}.${ext}`;
    
    const DATA_PATH = process.env.DATA_PATH || '/data';
    const coversDir = path.join(DATA_PATH, 'covers');
    if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
    const filepath = path.join(coversDir, filename);

    const fileStream = fs.createWriteStream(filepath);
    
    let downloadedBytes = 0;
    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

    response.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (downloadedBytes > MAX_BYTES) {
        response.destroy(new Error('Superato limite 10MB in streaming'));
      } else {
        fileStream.write(chunk);
      }
    });

    response.on('end', () => {
      fileStream.end();
      res.json({ success: true, filename });
    });

    response.on('error', (err) => {
      fileStream.end();
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      
      if (!res.headersSent) {
        res.status(400).json({ error: err.message });
      }
    });

  } catch (err) {
    if (!res.headersSent) {
      res.status(400).json({ error: err.message || 'URL non valido o errore di rete' });
    }
  }
});

module.exports = router;
