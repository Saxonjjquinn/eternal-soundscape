// Synthesises the ambient beds used by every theme.
// Everything here is generated from maths (noise, sine waves, envelopes),
// so the output is original audio with no licensing strings attached.
//
// Usage: node scripts/make-beds.js      (writes public/beds/<theme>.mp3)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { THEMES } = require('../src/themes');
const ffmpeg = require('../src/ffmpeg-path');

const SR = 44100;
const LOOP = 60; // seconds; every modulation period below divides 60 so the loop is seamless
const XF = 3; // crossfade seconds used to hide the loop seam
const N = SR * (LOOP + XF);

// ---------- small DSP toolkit ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const buf = () => new Float32Array(N);

function white(r) {
  const b = buf();
  for (let i = 0; i < N; i++) b[i] = r() * 2 - 1;
  return b;
}
function pink(r) {
  const b = buf();
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < N; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    b[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return b;
}
function brown(r) {
  const b = buf();
  let last = 0;
  for (let i = 0; i < N; i++) {
    last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
    b[i] = last * 3.5;
  }
  return b;
}
function lowpass(b, hz) {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / SR);
  let y = 0;
  for (let i = 0; i < b.length; i++) { y += a * (b[i] - y); b[i] = y; }
  return b;
}
function highpass(b, hz) {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / SR);
  let y = 0;
  for (let i = 0; i < b.length; i++) { y += a * (b[i] - y); b[i] = b[i] - y; }
  return b;
}
const lfo = (i, periodSec, phase = 0) => Math.sin((2 * Math.PI * i) / (SR * periodSec) + phase);
function scale(b, g) { for (let i = 0; i < b.length; i++) b[i] *= g; return b; }
function add(dst, src, g = 1) { for (let i = 0; i < dst.length; i++) dst[i] += src[i] * g; return dst; }
function modulate(b, fn) { for (let i = 0; i < b.length; i++) b[i] *= fn(i); return b; }

// soft sine pad: chord of frequencies, slight detune, slow swell
function pad(freqs, gain, swellPeriod) {
  const b = buf();
  freqs.forEach((f, k) => {
    const det = [0.999, 1.0015];
    det.forEach((d) => {
      const w = (2 * Math.PI * f * d) / SR;
      for (let i = 0; i < N; i++) {
        b[i] += Math.sin(w * i) * (0.55 + 0.45 * lfo(i, swellPeriod, k * 1.7));
      }
    });
  });
  return scale(b, gain / (freqs.length * 2));
}

// short plucked tone (music box / soft bell)
function pluck(b, startSec, freq, gain, decay = 1.6) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(SR * decay * 3);
  for (let j = 0; j < len; j++) {
    const idx = (start + j) % N; // wrap so notes near the end bleed into the loop start
    const t = j / SR;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / decay * 2.2);
    const s = Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-t * 3);
    b[idx] += s * env * gain;
  }
}

// bird chirp: a quick frequency sweep with a bell envelope
function chirp(b, startSec, f0, f1, durSec, gain, pan, R) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(durSec * SR);
  let ph = 0;
  for (let j = 0; j < len; j++) {
    const t = j / len;
    const f = f0 + (f1 - f0) * Math.sin(t * Math.PI * 0.5);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.sin(Math.PI * t) ** 2;
    const idx = (start + j) % N;
    b.L[idx] += Math.sin(ph) * env * gain * (1 - pan);
    b.R[idx] += Math.sin(ph) * env * gain * pan;
  }
}

// fire crackle: tiny decaying noise bursts
function crackle(b, startSec, gain, R) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(SR * (0.004 + R() * 0.02));
  for (let j = 0; j < len; j++) {
    const idx = (start + j) % N;
    b[idx] += (R() * 2 - 1) * Math.exp((-j / len) * 5) * gain;
  }
}

// ---------- the themes ----------
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

const recipes = {
  'gentle-rain'(R) {
    const L = lowpass(highpass(pink(R), 300), 3500);
    const Rr = lowpass(highpass(pink(R), 300), 3500);
    const drops = buf();
    for (let k = 0; k < 900; k++) crackle(drops, R() * (LOOP + XF), 0.12 * R(), R);
    lowpass(drops, 5000);
    const warm = pad([110, 164.81, 220], 0.12, 20);
    const mod = (i) => 0.8 + 0.2 * lfo(i, 15);
    return {
      L: add(add(modulate(L, mod), drops, 0.6), warm),
      R: add(add(modulate(Rr, mod), drops, 0.5), warm),
    };
  },
  'ocean-waves'(R) {
    const mk = (ph) => {
      const n = lowpass(brown(R), 900);
      add(n, lowpass(highpass(pink(R), 1500), 4000), 0.25);
      // waves every 10s, swell in slowly, crash and recede
      return modulate(n, (i) => {
        const x = ((i / SR + ph) % 10) / 10;
        const swell = x < 0.55 ? Math.pow(x / 0.55, 2) : Math.exp(-(x - 0.55) * 6);
        return 0.25 + 0.95 * swell;
      });
    };
    return { L: mk(0), R: mk(0.35) };
  },
  'lullaby-glow'(R) {
    const p = pad([130.81, 196.0, 261.63, 329.63], 0.55, 12);
    const notes = buf();
    for (let t = 1; t < LOOP; t += 2.5) {
      if (R() < 0.75) pluck(notes, t + R() * 0.1, PENTA[Math.floor(R() * PENTA.length)] * 2, 0.09, 1.4);
    }
    lowpass(notes, 4000);
    const L = add(Float32Array.from(p), notes, 1.0);
    const Rr = add(Float32Array.from(p), notes, 0.8);
    return { L, R: Rr };
  },
  'forest-morning'(R) {
    const wind = (ph) => modulate(lowpass(highpass(pink(R), 150), 1200), (i) => 0.4 + 0.3 * lfo(i, 20, ph));
    const out = { L: wind(0), R: wind(1.3) };
    scale(out.L, 0.7); scale(out.R, 0.7);
    for (let k = 0; k < 28; k++) {
      const t = R() * LOOP;
      const base = 2800 + R() * 2200;
      const pan = R();
      const reps = 1 + Math.floor(R() * 4);
      for (let r = 0; r < reps; r++) chirp(out, t + r * 0.16, base, base * (1.15 + R() * 0.3), 0.09 + R() * 0.05, 0.05, pan, R);
    }
    return out;
  },
  'cosy-fireplace'(R) {
    const mk = () => lowpass(brown(R), 500);
    const out = { L: mk(), R: mk() };
    const cr = buf();
    for (let k = 0; k < 700; k++) crackle(cr, R() * (LOOP + XF), 0.35 * Math.pow(R(), 2), R);
    highpass(cr, 1200);
    add(out.L, cr, 0.8); add(out.R, cr, 0.6);
    const warm = pad([98, 146.83, 196], 0.12, 15);
    add(out.L, warm); add(out.R, warm);
    return out;
  },
  'music-box'(R) {
    const notes = buf();
    // slow pentatonic phrases with long rests; period 60s so it loops cleanly
    let t = 0.8;
    while (t < LOOP - 1) {
      const phrase = 3 + Math.floor(R() * 4);
      let idx = Math.floor(R() * 5);
      for (let k = 0; k < phrase && t < LOOP - 1; k++) {
        idx = Math.max(0, Math.min(PENTA.length - 1, idx + (R() < 0.5 ? -1 : 1) * (1 + Math.floor(R() * 2))));
        pluck(notes, t, PENTA[idx] * 2, 0.16, 1.8);
        t += 0.55 + R() * 0.35;
      }
      t += 3 + R() * 4;
    }
    lowpass(notes, 5000);
    const air = lowpass(pink(R), 400);
    const L = add(Float32Array.from(notes), air, 0.02);
    const Rr = add(Float32Array.from(notes), air, 0.02);
    return { L, R: Rr };
  },
  'soft-wind'(R) {
    const mk = (ph) => {
      const n = lowpass(highpass(pink(R), 120), 900);
      add(n, lowpass(highpass(pink(R), 1500), 3000), 0.15);
      return modulate(n, (i) => 0.45 + 0.35 * (0.5 + 0.5 * lfo(i, 12, ph)) + 0.2 * lfo(i, 30, ph * 2));
    };
    return { L: mk(0), R: mk(1.9) };
  },
  'starry-night'(R) {
    const p = pad([110, 164.81, 246.94, 329.63], 0.45, 20);
    const crickets = (ph, f) => {
      const b = buf();
      for (let i = 0; i < N; i++) {
        const pulse = Math.max(0, Math.sin((2 * Math.PI * i) / (SR / 30))) ** 4; // 30 Hz trill
        const gate = lfo(i, 1.5, ph) > 0.2 ? 1 : 0;
        b[i] = Math.sin((2 * Math.PI * f * i) / SR) * pulse * gate * 0.035;
      }
      return lowpass(b, 6000);
    };
    const air = lowpass(pink(R), 600);
    return {
      L: add(add(Float32Array.from(p), crickets(0, 4400)), air, 0.15),
      R: add(add(Float32Array.from(p), crickets(2.1, 4700)), air, 0.15),
    };
  },
};

// ---------- loop + write ----------
function makeLoop(b) {
  const out = new Float32Array(SR * LOOP);
  const xf = SR * XF;
  for (let i = 0; i < out.length; i++) out[i] = b[i];
  // tail (60..63s) fades out over the head (0..3s), which fades in
  for (let i = 0; i < xf; i++) {
    const g = i / xf;
    out[i] = b[i] * Math.sqrt(g) + b[SR * LOOP + i] * Math.sqrt(1 - g);
  }
  return out;
}

function writeWav(file, L, R) {
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.7 / (peak || 1);
  const data = Buffer.alloc(L.length * 4);
  for (let i = 0; i < L.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

const outDir = path.join(__dirname, '..', 'public', 'beds');
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'beds-'));

const only = process.argv.slice(2);
THEMES.filter((t) => t.gen !== 'music' && (!only.length || only.includes(t.id))).forEach((theme) => {
  const recipe = recipes[theme.id];
  if (!recipe) throw new Error(`No recipe for ${theme.id}`);
  const seed = [...theme.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const { L, R } = recipe(rng(seed));
  const wav = path.join(tmp, `${theme.id}.wav`);
  writeWav(wav, makeLoop(L), makeLoop(R));
  const mp3 = path.join(outDir, `${theme.id}.mp3`);
  // bring every bed to the same perceived loudness
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', wav, '-af', 'loudnorm=I=-23:TP=-2:LRA=11', '-ar', '44100', '-b:a', '192k', mp3]);
  console.log('wrote', path.relative(process.cwd(), mp3));
});
// ---------- one-off "moments" ----------
function momentBuffers(id, variant) {
  const R = rng(9000 + variant * 131 + id.length * 17);
  const secs = id === 'bowl' ? 9 : 6;
  const n = SR * secs;
  const L = new Float32Array(n), Rr = new Float32Array(n);
  const tone = (start, f, gain, decay, pan, partials) => {
    for (let j = Math.floor(start * SR); j < n; j++) {
      const t = j / SR - start;
      const env = Math.min(1, t / 0.003) * Math.exp(-t / decay);
      if (env < 1e-4 && t > 0.1) break;
      let v = 0;
      partials.forEach(([m, g, dm]) => { v += Math.sin(2 * Math.PI * f * m * t) * g * Math.exp(-t / (decay * dm)); });
      L[j] += v * env * gain * (1 - pan);
      Rr[j] += v * env * gain * pan;
    }
  };
  if (id === 'chimes') {
    const scale = [1046.5, 1174.7, 1318.5, 1568, 1760, 2093];
    const hits = 4 + Math.floor(R() * 4);
    let t = 0.05;
    for (let k = 0; k < hits; k++) {
      tone(t, scale[Math.floor(R() * scale.length)], 0.18, 1.4, 0.3 + R() * 0.4, [[1, 1, 1], [2.76, 0.35, 0.5], [5.4, 0.12, 0.3]]);
      t += 0.12 + R() * 0.45;
    }
  } else if (id === 'musicbox') {
    let idx = 2 + Math.floor(R() * 3);
    let t = 0.05;
    const notes = 4 + Math.floor(R() * 3);
    for (let k = 0; k < notes; k++) {
      idx = Math.max(0, Math.min(PENTA.length - 1, idx + (R() < 0.5 ? -1 : 1)));
      tone(t, PENTA[idx] * 2, 0.22, 0.9, 0.5, [[1, 1, 1], [2, 0.25, 0.4], [3, 0.08, 0.3]]);
      t += 0.38 + R() * 0.2;
    }
  } else if (id === 'whistle') {
    // a short, relaxed whistled tune: a pure tone gliding between notes, a little vibrato and breath
    const tunes = [[4, 5, 4, 2, 3], [2, 4, 5, 7, 5], [5, 4, 2, 0, 2, 4], [3, 5, 7, 5]];
    const notes = tunes[(variant - 1) % tunes.length];
    const hz = (i) => PENTA[Math.min(PENTA.length - 1, i % PENTA.length)] * (i >= PENTA.length ? 2 : 1) * 4;
    let ph = 0, prevF = hz(notes[0]);
    const lens = notes.map((_, k) => (k === notes.length - 1 ? 0.9 : 0.32 + R() * 0.25));
    const total = lens.reduce((a, b) => a + b, 0);
    let t0 = 0.1, k = 0, noiseLp = 0;
    for (let j = Math.floor(t0 * SR); j < n && k < notes.length; j++) {
      const t = j / SR;
      if (t > t0 + lens[k]) { t0 += lens[k]; k++; if (k >= notes.length) break; }
      const target = hz(notes[k]);
      prevF += (target - prevF) * 0.0025; // portamento
      const local = t - t0;
      const vib = 1 + 0.008 * Math.sin(2 * Math.PI * 5.4 * t) * Math.min(1, local / 0.2);
      ph += (2 * Math.PI * prevF * vib) / SR;
      const all = t - 0.1;
      const env = Math.min(1, all / 0.08) * Math.min(1, (total - all) / 0.3) * (0.8 + 0.2 * Math.min(1, local / 0.05));
      noiseLp += 0.3 * ((R() * 2 - 1) - noiseLp);
      const v = (Math.sin(ph) + noiseLp * 0.05) * Math.max(0, env) * 0.16;
      L[j] += v * 0.55; Rr[j] += v * 0.45;
    }
  } else if (id === 'footsteps') {
    // small feet pattering past: soft thumps and a little scuff, drifting across the room
    const steps = 5 + Math.floor(R() * 5);
    let t = 0.1;
    const fromLeft = variant % 2 === 1;
    for (let k = 0; k < steps; k++) {
      const pan = fromLeft ? 0.25 + (0.5 * k) / steps : 0.75 - (0.5 * k) / steps;
      const loud = 0.6 + 0.4 * Math.sin((Math.PI * (k + 0.5)) / steps); // nearest in the middle
      const f = 70 + R() * 40;
      let lp = 0;
      for (let j = Math.floor(t * SR), end = Math.min(n, j + SR * 0.18); j < end; j++) {
        const u = j / SR - t;
        lp += 0.12 * ((R() * 2 - 1) - lp);
        const v = (Math.sin(2 * Math.PI * f * u) * Math.exp(-u * 40) + lp * 0.9 * Math.exp(-u * 28)) * Math.min(1, u / 0.002) * 0.35 * loud;
        L[j] += v * (1 - pan); Rr[j] += v * pan;
      }
      t += (k % 2 ? 0.26 : 0.31) + R() * 0.08;
    }
  } else if (id === 'bikebell') {
    // a bicycle bell out on the street: two quick rattly rings
    const f = [2050, 2350, 2600][(variant - 1) % 3];
    const partials = [[1, 1, 1], [1.51, 0.5, 0.7], [2.02, 0.3, 0.5], [2.74, 0.25, 0.35], [3.9, 0.1, 0.2]];
    const rings = 1 + (variant % 2) + (R() < 0.3 ? 1 : 0);
    let t = 0.1;
    for (let r = 0; r < rings; r++) {
      const strikes = 4 + Math.floor(R() * 3); // the clapper rattles
      for (let s = 0; s < strikes; s++) tone(t + s * 0.045, f * (1 + (R() - 0.5) * 0.004), 0.06 * (s === 0 ? 1 : 0.55), 0.9, 0.62, partials);
      t += 0.55 + R() * 0.2;
    }
  } else if (id === 'bowl') {
    const f = [174.6, 196, 220.0][variant % 3];
    tone(0.05, f, 0.35, 3.2, 0.5, [[1, 1, 1], [2.71, 0.45, 0.6], [5.1, 0.18, 0.35], [1.006, 0.6, 1]]);
  }
  return { L, R: Rr };
}
const momentsDir = path.join(__dirname, '..', 'public', 'moments');
fs.mkdirSync(momentsDir, { recursive: true });
const { MOMENTS } = require('../src/themes');
const MODELLED = Object.keys(require('./make-moments').KINDS); // made by make-moments.js
MOMENTS.filter((m) => m.variants && !MODELLED.includes(m.id)).forEach((m) => {
  for (let v = 1; v <= m.variants; v++) {
    const { L, R } = momentBuffers(m.id, v);
    const wav = path.join(tmp, `${m.id}-${v}.wav`);
    writeWav(wav, L, R);
    const out = path.join(momentsDir, `${m.id}-${v}.mp3`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', wav, '-af', `aecho=0.8:0.6:70|140:0.25|0.15,${m.id === 'bikebell' ? 'lowpass=f=6000,' : ''}loudnorm=I=${{ bikebell: -28, footsteps: -27, whistle: -26 }[m.id] || -24}:TP=-3`, '-ar', '44100', '-b:a', '160k', out]);
  }
  console.log('wrote moments', m.id);
});
fs.rmSync(tmp, { recursive: true, force: true });
