// Use the ffmpeg binary bundled by ffmpeg-static, or a system ffmpeg if FFMPEG_PATH is set.
let p = process.env.FFMPEG_PATH;
if (!p) {
  try { p = require('ffmpeg-static'); } catch { p = 'ffmpeg'; }
}
module.exports = p;
