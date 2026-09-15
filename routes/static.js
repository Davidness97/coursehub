const express = require('express');
const fs = require('fs');
const path = require('path');
const { safeResolveCoursePath } = require('../services/pathService');

const router = express.Router();

// Helper to determine mime type
function getContentType(ext) {
  const types = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.pdf': 'application/pdf',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}

router.get('/files/*', (req, res) => {
  // We use req.params[0] because the router matches /files/*
  // We do NOT use decodeURIComponent here because pathService handles it safely.
  const relativePath = req.params[0];
  
  if (!relativePath) {
    return res.status(400).send('Path is required');
  }

  const absolutePath = safeResolveCoursePath(relativePath);
  
  if (!absolutePath) {
    return res.status(403).send('Forbidden: Invalid path');
  }

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send('File not found');
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    return res.status(403).send('Forbidden: Cannot serve a directory');
  }

  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(absolutePath);
  const contentType = getContentType(ext);

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      res.status(416).header('Content-Range', `bytes */${fileSize}`).send('Requested range not satisfiable');
      return;
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(absolutePath, { start, end });
    
    res.status(206).set({
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });
    
    file.pipe(res);
  } else {
    res.status(200).set({
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(absolutePath).pipe(res);
  }
});

module.exports = router;
