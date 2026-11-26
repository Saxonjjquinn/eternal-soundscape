const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { THEMES, TIERS } = require('./themes');
const { mix } = require('./mixer');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const STORE = path.join(DATA, 'soundscapes');
const UPLOADS = path.join(DATA, 'uploads');
const WORK = path.join(DATA, 'work');
[STORE, UPLOADS, WORK].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // so share links use https behind a host's proxy

// ---------- helpers ----------
const newId = () => crypto.randomBytes(9).toString('base64url'); // 12 chars, unguessable
const validId = (id) => /^[A-Za-z0-9_-]{12}$/.test(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'soundscape';
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

function readMeta(id) {
  if (!validId(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(STORE, id, 'meta.json'), 'utf8')); } catch { return null; }
}

// One or two mixes at a time keeps a small server responsive.
const MAX_JOBS = Number(process.env.MAX_JOBS || 2);
let running = 0;
const waiting = [];
function queue(task) {
  return new Promise((resolve, reject) => {
    const go = async () => {
      running++;
      try { resolve(await task()); } catch (e) { reject(e); } finally {
        running--;
        if (waiting.length) waiting.shift()();
      }
    };
    running < MAX_JOBS ? go() : waiting.push(go);
  });
}

// ---------- uploads ----------
const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 60 * 1024 * 1024, files: TIERS.plus.maxClips },
  fileFilter: (req, file, cb) => {
    const ok = /^(audio|video)\//.test(file.mimetype) || /\.(m4a|mp3|wav|aac|ogg|opus|webm|mp4|mov|caf|amr|3gp|flac)$/i.test(file.originalname);
    cb(ok ? null : new Error(`"${file.originalname}" doesn't look like an audio or video file.`), ok);
  },
});

// ---------- API ----------
app.get('/api/config', (req, res) => {
  const examplesFile = path.join(PUBLIC, 'examples', 'examples.json');
  let examples = [];
  try { examples = JSON.parse(fs.readFileSync(examplesFile, 'utf8')); } catch {}
  res.json({ themes: THEMES, tiers: TIERS, examples });
});

app.post('/api/soundscapes', upload.array('clips'), async (req, res) => {
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
  try {
    // PROTOTYPE: "plus" is trusted from the browser. Replace with a real
    // account/payment check before launch.
    const tierName = req.body.plus === '1' ? 'plus' : 'free';
    const tier = TIERS[tierName];
    const theme = THEMES.find((t) => t.id === req.body.theme);
    const minutes = Number(req.body.minutes);
    const title = String(req.body.title || '').trim().slice(0, 80) || 'Our soundscape';

    if (!theme) throw new Error('Please choose a theme.');
    if (!theme.free && tierName !== 'plus') throw new Error(`${theme.name} is a Plus theme.`);
    if (!files.length) throw new Error('Please add at least one voice clip.');
    if (files.length > tier.maxClips) throw new Error(`You can add up to ${tier.maxClips} clips${tierName === 'free' ? ' on the free plan' : ''}.`);
    if (!(minutes >= tier.minMinutes && minutes <= tier.maxMinutes)) throw new Error(`Length must be between ${tier.minMinutes} and ${tier.maxMinutes} minutes.`);
    if (req.body.consent !== '1') throw new Error('Please confirm you have permission to use these recordings.');

    const id = newId();
    const dir = path.join(STORE, id);
    fs.mkdirSync(dir, { recursive: true });
    const workDir = path.join(WORK, id);
    const started = Date.now();
    try {
      await queue(() => mix({
        bed: path.join(PUBLIC, 'beds', `${theme.id}.mp3`),
        clips: files.map((f) => f.path),
        seconds: Math.round(minutes * 60),
        output: path.join(dir, 'soundscape.mp3'),
        workDir,
        title,
      }));
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    const meta = { id, title, theme: theme.id, minutes, clips: files.length, tier: tierName, createdAt: new Date().toISOString(), mixMs: Date.now() - started };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    res.json({ ...meta, listenUrl: `${baseUrl(req)}/s/${id}`, audioUrl: `/media/${id}.mp3`, downloadUrl: `/media/${id}.mp3?download=1` });
  } catch (e) {
    console.error('mix failed:', e.message);
    const friendly = /Invalid data|could not find codec|does not contain any stream|moov atom/i.test(e.message)
      ? "We couldn't read one of those files. Try exporting it as .m4a, .mp3 or .wav."
      : e.message.split('\n')[0].slice(0, 200);
    res.status(400).json({ error: friendly });
  } finally {
    cleanup();
  }
});

app.get('/api/soundscapes/:id', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });
  res.json({ ...meta, audioUrl: `/media/${meta.id}.mp3`, downloadUrl: `/media/${meta.id}.mp3?download=1` });
});

app.get('/media/:file', (req, res) => {
  const id = req.params.file.replace(/\.mp3$/, '');
  const meta = readMeta(id);
  if (!meta) return res.status(404).send('Not found');
  const file = path.join(STORE, id, 'soundscape.mp3');
  if ('download' in req.query) res.attachment(`${slug(meta.title)}.mp3`);
  res.sendFile(file, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }); // supports range requests for seeking
});

// ---------- player page (server-filled so link previews show the title) ----------
const playerTemplate = fs.readFileSync(path.join(PUBLIC, 'player.html'), 'utf8');
app.get('/s/:id', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).sendFile(path.join(PUBLIC, '404.html'));
  const theme = THEMES.find((t) => t.id === meta.theme) || THEMES[0];
  const html = playerTemplate
    .replaceAll('{{TITLE}}', escapeHtml(meta.title))
    .replaceAll('{{THEME_NAME}}', escapeHtml(theme.name))
    .replaceAll('{{C1}}', theme.colors[0])
    .replaceAll('{{C2}}', theme.colors[1])
    .replaceAll('{{DATA}}', escapeHtml(JSON.stringify({ ...meta, themeName: theme.name, colors: theme.colors, audioUrl: `/media/${meta.id}.mp3`, downloadUrl: `/media/${meta.id}.mp3?download=1` })));
  res.type('html').send(html);
});

app.use(express.static(PUBLIC, { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each clip must be under 60 MB.' : err.code === 'LIMIT_FILE_COUNT' ? 'Too many clips.' : err.message;
    return res.status(400).json({ error: msg });
  }
  next(err);
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Soundscape app running at http://localhost:${PORT}`));
