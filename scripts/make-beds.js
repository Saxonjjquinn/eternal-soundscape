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

THEMES.forEach((theme, idx) => {
  const recipe = recipes[theme.id];
  if (!recipe) throw new Error(`No recipe for ${theme.id}`);
  const { L, R } = recipe(rng(1234 + idx * 77));
  const wav = path.join(tmp, `${theme.id}.wav`);
  writeWav(wav, makeLoop(L), makeLoop(R));
  const mp3 = path.join(outDir, `${theme.id}.mp3`);
  // bring every bed to the same perceived loudness
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', wav, '-af', 'loudnorm=I=-23:TP=-2:LRA=11', '-ar', '44100', '-b:a', '192k', mp3]);
  console.log('wrote', path.relative(process.cwd(), mp3));
});
fs.rmSync(tmp, { recursive: true, force: true });
