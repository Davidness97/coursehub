const db = require('./db');

function getProgress(lessonId) {
  return db.prepare('SELECT * FROM progress WHERE lesson_id = ?').get(lessonId);
}

function updateProgress(lessonId, data) {
  // Sync duration to lessons table if present and not set
  if (data.total_seconds && data.total_seconds > 0) {
    db.prepare(`
      UPDATE lessons 
      SET duration = ? 
      WHERE id = ? AND (duration IS NULL OR duration = 0)
    `).run(data.total_seconds, lessonId);
  }

  // If completed but watched_seconds not explicitly passed, infer it from duration
  let watchedSeconds = data.watched_seconds;
  if (watchedSeconds === undefined && data.completed === 1) {
    const lesson = db.prepare('SELECT duration FROM lessons WHERE id = ?').get(lessonId);
    if (lesson && lesson.duration > 0) {
      watchedSeconds = lesson.duration;
    } else if (data.total_seconds > 0) {
      watchedSeconds = data.total_seconds;
    }
  }

  // Upsert pattern
  const existing = getProgress(lessonId);
  if (existing) {
    db.prepare(`
      UPDATE progress 
      SET completed = @completed, 
          last_position = @last_position, 
          watched_seconds = @watched_seconds, 
          total_seconds = @total_seconds,
          last_watched_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE lesson_id = @lesson_id
    `).run({
      lesson_id: lessonId,
      completed: data.completed !== undefined ? data.completed : existing.completed,
      last_position: data.last_position !== undefined ? data.last_position : existing.last_position,
      watched_seconds: watchedSeconds !== undefined ? watchedSeconds : existing.watched_seconds,
      total_seconds: data.total_seconds !== undefined ? data.total_seconds : existing.total_seconds
    });
  } else {
    db.prepare(`
      INSERT INTO progress (lesson_id, completed, last_position, watched_seconds, total_seconds, last_watched_at)
      VALUES (@lesson_id, @completed, @last_position, @watched_seconds, @total_seconds, CURRENT_TIMESTAMP)
    `).run({
      lesson_id: lessonId,
      completed: data.completed || 0,
      last_position: data.last_position || 0,
      watched_seconds: watchedSeconds || 0,
      total_seconds: data.total_seconds || null
    });
  }
}

function markCompleted(lessonId, isCompleted) {
  const lesson = db.prepare('SELECT duration FROM lessons WHERE id = ?').get(lessonId);
  const dur = (lesson && lesson.duration) ? lesson.duration : 0;
  updateProgress(lessonId, { 
    completed: isCompleted ? 1 : 0,
    watched_seconds: isCompleted ? dur : 0
  });
}

module.exports = {
  getProgress,
  updateProgress,
  markCompleted
};
