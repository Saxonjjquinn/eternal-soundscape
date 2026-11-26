// Builds a soundscape with ffmpeg.
//
// Pass 1 (per clip): decode any audio/video format, cut to the chosen part,
//   trim silence at the ends, clean up rumble and hiss, even out loudness.
// Plan: lay voices out on a timeline with natural, uneven gaps, cycling
//   through every recording before any repeats, never the same clip twice in
//   a row, each placed slightly left or right at a slightly different level.
//   Small "moments" (chimes, music-box phrases) go in some of the quiet gaps.
// Pass 2a: render the voice track and the moments track.
// Pass 2b: loop up to three ambient layers, bring them in one at a time,
//   let each breathe slowly in volume, dip them under the voices, add the
//   voices and moments, fade in/out and level the result.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('./ffmpeg-path');
const { MAX_CLIP_SECONDS } = require('./themes');

const SR = 44100;

function run(args, loglevel = 'error') {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', loglevel, '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.trim() || `ffmpeg exited ${code}`))));
  });
}

// Integrated loudness (LUFS) of a file.
async function measureLufs(file) {
  const out = await run(['-i', file, '-af', 'ebur128', '-f', 'null', '-'], 'info');
  const m = out.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/);
  return m ? Number(m[1]) : null;
}

// Duration of a 16-bit stereo PCM wav written by us.
const wavSeconds = (file) => (fs.statSync(file).size - 44) / (SR * 4);

async function prepareClip(input, output, from = 0, to = null) {
  const trimSilence = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.2';
  const start = Math.max(0, Number(from) || 0);
  const end = to != null && Number(to) > start ? Math.min(Number(to), start + MAX_CLIP_SECONDS) : start + MAX_CLIP_SECONDS;
  await run([
    '-ss', start.toFixed(2), '-t', (end - start).toFixed(2), '-i', input, '-vn', '-ac', '2', '-ar', String(SR),
    '-af', [
      trimSilence, 'areverse', trimSilence, 'areverse', // trim both ends
      'highpass=f=90', 'lowpass=f=11000',
      'afftdn=nf=-30', // light hiss reduction for phone recordings
      'loudnorm=I=-19:TP=-2:LRA=9',
    ].join(','),
    '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', output,
  ]);
  const secs = wavSeconds(output);
  if (secs < 0.5) throw new Error('One of the clips seems to be silent or too short.');
  return secs;
}

// Small deterministic random generator so a given soundscape can be rebuilt identically.
function seeded(seed) {
  // mulberry32: well spread even for small seeds
  let s = (Math.imul(seed >>> 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, a, b) => a + r() * (b - a);

/**
 * Lay out voices and moments on the timeline.
 * @returns {{voices: {clip,start,dur,pan,gain}[], moments: {start,dur,variant,pan}[]}}
 */
function schedule(durations, total, { seed = 1, momentVariants = 0, momentDur = 6 } = {}) {
  const r = seeded(seed);
  const head = between(r, 6, 10);
  const tail = 8;
  const n = durations.length;

  // Natural gaps: mostly 10–20 s, occasionally a longer rest. Shrink them if
  // there isn't room to play every recording at least once.
  let gapMin = 10;
  let gapMax = 20;
  let allowLongRest = true;
  const room = total - head - tail;
  const once = durations.reduce((a, b) => a + b, 0);
  const avg = (room - once) / Math.max(1, n - 1); // average gap that still fits everyone in once
  if (n > 1 && avg < 24) {
    gapMin = Math.max(3, avg * 0.7);
    gapMax = Math.max(3.5, avg * 0.95);
    allowLongRest = false;
  }

  // Shuffle-bag order: every clip once before any repeats, no back-to-back repeats.
  const order = [];
  let last = -1;
  const nextBag = () => {
    const bag = [...Array(n).keys()];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    if (n > 1 && bag[0] === last) [bag[0], bag[1]] = [bag[1], bag[0]];
    return bag;
  };

  const voices = [];
  const gaps = [];
  let t = head;
  let side = r() < 0.5 ? -1 : 1;
  for (let guard = 0; guard < 500; guard++) {
    if (!order.length) order.push(...nextBag());
    const clip = order.shift();
    const dur = durations[clip];
    if (t + dur > total - tail) {
      if (!voices.length) voices.push({ clip, start: Math.max(1, total - tail - dur), dur: Math.min(dur, total - tail - 1), pan: 0, gain: 1 });
      break;
    }
    side = -side; // alternate sides so it feels like the room, not one speaker
    voices.push({ clip, start: t, dur, pan: +(side * between(r, 0.08, 0.32)).toFixed(2), gain: +between(r, 0.82, 1).toFixed(2) });
    last = clip;
    const longRest = allowLongRest && r() < 0.2;
    const gap = longRest ? between(r, gapMax, gapMax * 1.5) : between(r, gapMin, gapMax);
    gaps.push([t + dur, t + dur + gap]);
    t += dur + gap;
  }
  // the stretch after the last voice runs to the end
  const lv = voices[voices.length - 1];
  if (gaps.length) gaps[gaps.length - 1] = [lv.start + lv.dur, total - tail];

  const moments = [];
  if (momentVariants > 0) {
    let prev = -1;
    for (const [a, b] of [[2, voices[0].start], ...gaps]) {
      const len = b - a;
      if (len < momentDur + 5 || r() > 0.65) continue;
      let variant = 1 + Math.floor(r() * momentVariants);
      if (variant === prev && momentVariants > 1) variant = (variant % momentVariants) + 1;
      prev = variant;
      moments.push({ start: +between(r, a + 2, b - momentDur - 2).toFixed(2), dur: momentDur, variant, pan: +between(r, -0.4, 0.4).toFixed(2) });
    }
    if (!moments.length) {
      // they asked for moments, so make sure at least one plays: use the longest quiet stretch
      const [a, b] = gaps.reduce((best, g) => (g[1] - g[0] > best[1] - best[0] ? g : best), [0, 0]);
      if (b - a >= momentDur + 3) moments.push({ start: +((a + b - momentDur) / 2).toFixed(2), dur: momentDur, variant: 1 + Math.floor(r() * momentVariants), pan: 0 });
    }
  }
  return { voices, moments };
}

const panFilter = (pan, gain) => {
  const l = (gain * Math.min(1, 1 - pan)).toFixed(3);
  const rr = (gain * Math.min(1, 1 + pan)).toFixed(3);
  return `pan=stereo|c0=${l}*c0|c1=${rr}*c1`;
};

// Render a set of one-shot sounds onto a silent track of exact length.
async function renderTrack(items, total, output, extra = () => '') {
  const args = ['-f', 'lavfi', '-t', String(total), '-i', `anullsrc=r=${SR}:cl=stereo`];
  const f = [];
  items.forEach((it, k) => {
    args.push('-i', it.file);
    const ms = Math.round(it.start * 1000);
    f.push(`[${k + 1}:a]aformat=sample_rates=${SR}:channel_layouts=stereo,${extra(it)}${panFilter(it.pan, it.gain ?? 1)},adelay=${ms}|${ms}[v${k}]`);
  });
  const labels = items.map((_, k) => `[v${k}]`).join('');
  f.push(`[0:a]${labels}amix=inputs=${items.length + 1}:normalize=0:duration=first:dropout_transition=0[out]`);
  await run([...args, '-filter_complex', f.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', output]);
}

/**
 * @param {object} o
 * @param {{file:string, volume:number}[]} o.layers  ambient beds (1–3), volume 0..1
 * @param {{file:string, from?:number, to?:number, name?:string}[]} o.clips
 * @param {{dir:string, id:string, variants:number}|null} o.moments
 * @param {number} o.seconds
 * @param {string} o.output
 * @param {string} o.workDir
 * @param {number} [o.seed]
 * @param {string} [o.title]
 */
async function mix({ layers, clips, moments, seconds, output, workDir, seed = 1, title, bedLevel = 0.5 }) {
  // bedLevel (0.25–1) sets how loud the background sounds and moments sit under the voices
  // mapped on a curve so each step is clearly audible (0.25→0.16, 0.5→0.38, 0.75→0.63, 1→0.9)
  const level = Math.pow(Math.max(0.1, Math.min(1, Number(bedLevel) || 0.5)), 1.25) * 0.9;
  fs.mkdirSync(workDir, { recursive: true });
  const prepared = [];
  const durations = [];
  for (let i = 0; i < clips.length; i++) {
    const out = path.join(workDir, `clip${i}.wav`);
    durations.push(await prepareClip(clips[i].file, out, clips[i].from, clips[i].to));
    prepared.push(out);
  }

  const momentDur = moments && moments.id === 'bowl' ? 9 : 6;
  const plan = schedule(durations, seconds, { seed, momentVariants: moments ? moments.variants : 0, momentDur });

  // Pass 2a: voice track and moments track.
  const voicesWav = path.join(workDir, 'voices.wav');
  await renderTrack(
    plan.voices.map((v) => ({ ...v, file: prepared[v.clip] })),
    seconds,
    voicesWav,
    (v) => `atrim=0:${v.dur.toFixed(2)},afade=t=in:d=0.25,afade=t=out:st=${Math.max(0, v.dur - 0.6).toFixed(2)}:d=0.6,aecho=0.85:0.5:45|95:0.18|0.1,`
  );
  let momentsWav = null;
  if (plan.moments.length) {
    momentsWav = path.join(workDir, 'moments.wav');
    await renderTrack(
      plan.moments.map((m) => ({ ...m, gain: +(0.8 * Math.sqrt(level)).toFixed(3), file: path.join(moments.dir, `${moments.id}-${m.variant}.mp3`) })),
      seconds,
      momentsWav
    );
  }

  // Pass 2b: layers, ducking, final mix.
  const r = seeded(seed * 7 + 3);
  const args = [];
  layers.forEach((l) => args.push('-stream_loop', '-1', '-i', l.file));
  const vIn = layers.length;
  args.push('-i', voicesWav, '-i', voicesWav);
  if (momentsWav) args.push('-i', momentsWav);

  const f = [];
  const layerScale = 1 / Math.sqrt(layers.length); // similar overall bed level however many layers
  const layerInfo = [];
  layers.forEach((l, k) => {
    // first layer fades in from the start; the others drift in one after another
    const fadeStart = k === 0 ? 0 : +(k * between(r, 7, 11)).toFixed(1);
    const fadeLen = k === 0 ? 4 : 10;
    const period = between(r, 18, 34).toFixed(1); // slow "breathing" in volume
    const phase = (r() * 6.28).toFixed(2);
    layerInfo.push({ fadeStart, fadeLen });
    f.push(
      `[${k}:a]aformat=sample_rates=${SR}:channel_layouts=stereo,atrim=0:${seconds},asetpts=PTS-STARTPTS,` +
        `volume=${(Math.max(0, Math.min(1, l.volume)) * layerScale * 1.25 * level).toFixed(3)},` +
        `volume='0.86+0.14*sin(2*PI*t/${period}+${phase})':eval=frame,` +
        `afade=t=in:st=${fadeStart}:d=${fadeLen}[b${k}]`
    );
  });
  const bedLabels = layers.map((_, k) => `[b${k}]`).join('');
  f.push(layers.length > 1 ? `${bedLabels}amix=inputs=${layers.length}:normalize=0:duration=first[bed]` : `[b0]anull[bed]`);
  f.push(`[bed][${vIn}:a]sidechaincompress=threshold=0.015:ratio=4:attack=150:release=1800[ducked]`);
  const finalInputs = `[ducked][${vIn + 1}:a]${momentsWav ? `[${vIn + 2}:a]` : ''}`;
  f.push(
    `${finalInputs}amix=inputs=${momentsWav ? 3 : 2}:normalize=0:duration=first,` +
      `afade=t=in:d=4,afade=t=out:st=${seconds - 6}:d=6[out]`
  );
  const premaster = path.join(workDir, 'premaster.wav');
  args.push('-filter_complex', f.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', premaster);
  await run(args);

  // Level the finished mix with one fixed gain (not an automatic leveller,
  // which would pull the quiet ambience-only stretches up between voices),
  // then a gentle peak limiter.
  const lufs = await measureLufs(premaster);
  const gainDb = lufs == null ? 0 : Math.max(-20, Math.min(20, -20 - lufs));
  const master = ['-i', premaster, '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.84:attack=5:release=80:level=disabled`, '-ar', String(SR), '-c:a', 'libmp3lame', '-b:a', '192k'];
  if (title) master.push('-metadata', `title=${title}`);
  master.push(output);
  await run(master);

  return {
    total: seconds,
    layers: layerInfo,
    voices: plan.voices.map((v) => ({ clip: v.clip, name: clips[v.clip].name || `Clip ${v.clip + 1}`, start: +v.start.toFixed(2), dur: +v.dur.toFixed(2), pan: v.pan })),
    moments: plan.moments.map((m) => ({ start: m.start, dur: m.dur })),
  };
}

module.exports = { mix, schedule };
