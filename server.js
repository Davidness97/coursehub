const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Helper function for EJS: always available to res.render
app.locals.getCourseCoverUrl = function(course) {
  if (!course || !course.cover_type || !course.cover_path) return '/img/placeholder.jpg';
  if (course.cover_type === 'uploaded') {
    return `/uploads/covers/${encodeURIComponent(path.basename(course.cover_path))}`;
  } else if (course.cover_type === 'filesystem') {
    return `/api/cover/fs?path=${encodeURIComponent(course.cover_path)}`;
  }
  return '/img/placeholder.jpg';
};

app.locals.formatDuration = function(seconds) {
  if (!seconds || seconds <= 0) return '0 min';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h e ${m}min`;
  return `${m} min`;
};

// Routes
app.use('/', require('./routes/static')); // contains /files/*
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/index'));

// Provide uploaded cover images from DATA_PATH
const DATA_PATH = process.env.DATA_PATH || '/data';
app.use('/uploads/covers', express.static(path.join(DATA_PATH, 'covers')));

app.listen(PORT, () => {
  console.log(`CourseHub started on port ${PORT}`);
});
