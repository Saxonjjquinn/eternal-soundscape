// Builds the "Listen to examples" soundscapes shown on the home page.
//
// Put each example in its own folder under examples/, with the clips and an
// example.json like: { "title": "Mia's rainy afternoon", "theme": "gentle-rain", "minutes": 1 }
// Only use recordings you have permission to show publicly.
//
// Usage: node scripts/make-examples.js   (writes public/examples/)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { mix } = require('../src/mixer');
const { THEMES } = require('../src/themes');

const SRC = path.join(__dirname, '..', 'examples');
const OUT = path.join(__dirname, '..', 'public', 'examples');
const AUDIO = /\.(m4a|mp3|wav|aac|ogg|opus|webm|mp4|mov|caf|flac)$/i;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const list = [];
  const dirs = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((d) => fs.statSync(path.join(SRC, d)).isDirectory()) : [];
  for (const d of dirs.sort()) {
    const cfg = JSON.parse(fs.readFileSync(path.join(SRC, d, 'example.json'), 'utf8'));
    const theme = THEMES.find((t) => t.id === cfg.theme);
    if (!theme) throw new Error(`${d}: unknown theme ${cfg.theme}`);
    const clips = fs.readdirSync(path.join(SRC, d)).filter((f) => AUDIO.test(f)).sort().map((f) => path.join(SRC, d, f));
    if (!clips.length) throw new Error(`${d}: no audio clips found`);
    const file = `${d}.mp3`;
    await mix({ bed: path.join(__dirname, '..', 'public', 'beds', `${theme.id}.mp3`), clips, seconds: Math.round((cfg.minutes || 1) * 60), output: path.join(OUT, file), workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ex-')), title: cfg.title });
    list.push({ title: cfg.title, subtitle: cfg.subtitle || theme.name, theme: theme.id, src: `/examples/${file}` });
    console.log('built', file);
  }
  fs.writeFileSync(path.join(OUT, 'examples.json'), JSON.stringify(list, null, 2));
  console.log(list.length ? `${list.length} example(s) ready` : 'No examples found; the home page will show theme previews instead.');
})().catch((e) => { console.error(e.message); process.exit(1); });
