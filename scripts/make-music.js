// Synthesises the music beds and the newer background sounds.
// Everything is generated from maths (oscillators, FM, Karplus-Strong strings,
// filtered noise), so it is original audio with no licensing strings attached.
//
// Every piece is written as an exact loop: notes that ring past the end wrap
// round to the start, and filters/reverb run over the loop twice so their
// state carries across the seam. Tempos are chosen so a whole number of bars
// fills the loop.
//
// Usage: node scripts/make-music.js [id ...]   (writes public/beds/<id>.mp3)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpeg = require('../src/ffmpeg-path');

const SR = 44100;
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

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

// ---------- track: a stereo loop buffer, all writes wrap ----------
class Track {
  constructor(seconds) {
    this.N = Math.round(seconds * SR);
    this.L = new Float32Array(this.N);
    this.R = new Float32Array(this.N);
  }
  // place a mono sample array at time t (seconds), pan 0 (left) .. 1 (right)
  put(arr, t, gain = 1, pan = 0.5) {
    const start = Math.round(t * SR);
    const gl = gain * Math.cos(pan * Math.PI / 2) * Math.SQRT2;
    const gr = gain * Math.sin(pan * Math.PI / 2) * Math.SQRT2;
    for (let j = 0; j < arr.length; j++) {
      const i = (((start + j) % this.N) + this.N) % this.N;
      this.L[i] += arr[j] * gl;
      this.R[i] += arr[j] * gr;
    }
  }
  mix(other, gain = 1) {
    for (let i = 0; i < this.N; i++) { this.L[i] += other.L[i] * gain; this.R[i] += other.R[i] * gain; }
    return this;
  }
}

// render a function of time into a sample array
function render(seconds, fn) {
  const n = Math.round(seconds * SR);
  const a = new Float32Array(n);
  for (let j = 0; j < n; j++) a[j] = fn(j / SR);
  return a;
}

// ---------- loop-aware filters ----------
function lowpassLoop(buf, hz) {
  const a = 1 - Math.exp((-TAU * hz) / SR);
  let y = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); if (pass) buf[i] = y; }
  }
  return buf;
}
function highpassLoop(buf, hz) {
  const a = 1 - Math.exp((-TAU * hz) / SR);
  let y = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); if (pass) buf[i] = buf[i] - y; }
  }
  return buf;
}
const lowpassTrack = (t, hz) => { lowpassLoop(t.L, hz); lowpassLoop(t.R, hz); return t; };
const highpassTrack = (t, hz) => { highpassLoop(t.L, hz); highpassLoop(t.R, hz); return t; };

// Freeverb-style reverb, run over the loop twice so the tail wraps cleanly.
function reverb(track, wet = 0.25, room = 0.82, damp = 0.25) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const alls = [556, 441, 341, 225];
  const proc = (input, spread) => {
    const out = new Float32Array(input.length);
    const cb = combs.map((d) => ({ buf: new Float32Array(d + spread), i: 0, store: 0 }));
    const ab = alls.map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
    for (let pass = 0; pass < 2; pass++) {
      for (let n = 0; n < input.length; n++) {
        const x = input[n] * 0.015;
        let s = 0;
        for (const c of cb) {
          const y = c.buf[c.i];
          c.store = y * (1 - damp) + c.store * damp;
          c.buf[c.i] = x + c.store * room;
          c.i = (c.i + 1) % c.buf.length;
          s += y;
        }
        for (const a of ab) {
          const b = a.buf[a.i];
          a.buf[a.i] = s + b * 0.5;
          s = b - s;
          a.i = (a.i + 1) % a.buf.length;
        }
        if (pass) out[n] = s;
      }
    }
    return out;
  };
  const wl = proc(track.L, 0);
  const wr = proc(track.R, 23);
  for (let i = 0; i < track.N; i++) {
    track.L[i] = track.L[i] * (1 - wet * 0.5) + wl[i] * wet;
    track.R[i] = track.R[i] * (1 - wet * 0.5) + wr[i] * wet;
  }
  return track;
}

// ---------- instruments (each returns a mono sample array) ----------
const env = (t, att, decayRate, dur, rel) => {
  let e = t < att ? t / att : Math.exp(-(t - att) * decayRate);
  if (dur != null && t > dur) e *= Math.exp(-(t - dur) / rel);
  return e;
};

// soft electric piano (two-operator FM), mellow tine
function epiano(m, dur = 1, vel = 1) {
  const f = mtof(m);
  return render(dur + 0.6, (t) => {
    const e = env(t, 0.004, 1.1, dur, 0.12) * vel;
    const idx = 0.25 + 1.1 * Math.exp(-t * 6) * vel;
    return e * (Math.sin(TAU * f * t + idx * Math.sin(TAU * f * t)) + 0.06 * Math.sin(TAU * f * 4.01 * t) * Math.exp(-t * 9));
  });
}

// acoustic-style piano: slightly inharmonic partials, higher ones die faster
function piano(m, dur = 2, vel = 1) {
  const f = mtof(m);
  const parts = [1, 2, 3, 4, 5, 6].map((n) => ({ f: f * n * Math.sqrt(1 + 0.00035 * n * n), a: 1 / Math.pow(n, 1.6), d: 0.7 + 0.55 * n + f / 900 }));
  const len = Math.min(5, dur + 1.5);
  return render(len, (t) => {
    let s = 0;
    for (const p of parts) s += p.a * Math.exp(-t * p.d) * Math.sin(TAU * p.f * t);
    const atk = t < 0.003 ? t / 0.003 : 1;
    const off = t > dur ? Math.exp(-(t - dur) / 0.25) : 1;
    return s * atk * off * vel * 0.6;
  });
}

// round upright-style bass
function bass(m, dur = 0.5, vel = 1) {
  const f = mtof(m);
  return render(dur + 0.25, (t) => env(t, 0.01, 2.2, dur, 0.06) * vel * (Math.sin(TAU * f * t) + 0.28 * Math.sin(TAU * 2 * f * t) * Math.exp(-t * 4)));
}

// plucked string (Karplus-Strong)
function string(m, dur = 1, vel = 1, R = Math.random, bright = 0.5) {
  const f = mtof(m);
  const p = Math.max(2, Math.round(SR / f));
  const n = Math.round((dur + 0.4) * SR);
  const out = new Float32Array(n);
  const line = new Float32Array(p);
  let lp = 0;
  for (let i = 0; i < p; i++) { lp += (1 - bright) * ((R() * 2 - 1) - lp); line[i] = lp; }
  const loss = 0.4985 + 0.0013 * bright;
  let idx = 0;
  for (let j = 0; j < n; j++) {
    const nxt = (idx + 1) % p;
    const y = line[idx];
    line[idx] = (line[idx] + line[nxt]) * loss;
    idx = nxt;
    const t = j / SR;
    const off = t > dur ? Math.exp(-(t - dur) / 0.05) : 1;
    out[j] = y * vel * off;
  }
  return out;
}

// warm pad: a few harmonics, slow attack and release
function pad(m, dur, vel = 1, bright = 4) {
  const f = mtof(m);
  return render(dur + 1.4, (t) => {
    const a = Math.min(1, t / 0.6) * (t > dur ? Math.exp(-(t - dur) / 0.5) : 1);
    let s = 0;
    for (let n = 1; n <= bright; n++) s += (Math.sin(TAU * f * n * t * 0.998) + Math.sin(TAU * f * n * t * 1.002)) / (n * n);
    return s * a * vel * 0.4;
  });
}

// mallet/vibes-like soft bell
function bell(m, vel = 1) {
  const f = mtof(m);
  return render(2.5, (t) => vel * Math.exp(-t * 1.8) * Math.min(1, t / 0.003) * (Math.sin(TAU * f * t) + 0.2 * Math.sin(TAU * f * 4 * t) * Math.exp(-t * 6)) * (1 + 0.15 * Math.sin(TAU * 5 * t)));
}

// drums
function kick(R, vel = 1) {
  let ph = 0;
  return render(0.35, (t) => { ph += TAU * (44 + 70 * Math.exp(-t * 32)) / SR; return Math.sin(ph) * Math.exp(-t * 10) * vel; });
}
function hat(R, vel = 1, len = 0.05) {
  let prev = 0;
  return render(len * 2, (t) => { const w = R() * 2 - 1; const y = w - prev; prev = w; return y * Math.exp(-t / len * 4) * vel * 0.5; });
}
function brush(R, vel = 1, len = 0.22) {
  let lo = 0;
  return render(len * 1.6, (t) => {
    const w = R() * 2 - 1;
    lo += 0.25 * (w - lo);
    const e = Math.min(1, t / 0.012) * Math.exp(-t / len * 3.2);
    return (w - lo) * e * vel * 0.6;
  });
}
function rim(R, vel = 1) {
  return render(0.08, (t) => (Math.sin(TAU * 1750 * t) * 0.6 + (R() * 2 - 1) * 0.4) * Math.exp(-t * 70) * vel);
}

// background textures
function vinyl(track, R, crackle = 0.6, hiss = 0.004) {
  for (let i = 0; i < track.N; i++) {
    const h = (R() * 2 - 1) * hiss;
    track.L[i] += h; track.R[i] += h * 0.9;
  }
  const pops = Math.round((track.N / SR) * 9 * crackle);
  for (let k = 0; k < pops; k++) {
    const amp = 0.04 * Math.pow(R(), 3);
    track.put(render(0.003 + R() * 0.004, (t) => (R() * 2 - 1) * Math.exp(-t * 900) * amp), R() * track.N / SR, 1, R());
  }
  return track;
}

// ---------- helpers for writing music ----------
const human = (R, amt = 0.012) => (R() - 0.5) * amt;
function chordAt(prog, bar) { return prog[bar % prog.length]; }

// ---------- the pieces ----------
const pieces = {
  // 120 BPM, 32 bars = 64 s. Fmaj9 | Em9 | Dm9 | Cmaj9, two bars each.
  'lofi-jazz-house'(R) {
    const beat = 0.5, bar = beat * 4, bars = 32;
    const T = new Track(bar * bars);
    const keys = new Track(bar * bars);
    const prog = [
      { b: 41, v: [57, 60, 64, 67] }, { b: 41, v: [57, 60, 64, 67] },
      { b: 40, v: [55, 59, 62, 66] }, { b: 40, v: [55, 59, 62, 66] },
      { b: 38, v: [53, 57, 60, 64] }, { b: 38, v: [53, 57, 60, 64] },
      { b: 36, v: [52, 55, 59, 62] }, { b: 36, v: [52, 55, 59, 62] },
    ];
    for (let k = 0; k < bars; k++) {
      const c = chordAt(prog, k);
      const t0 = k * bar;
      const breakdown = k >= 24 && k < 28; // drums drop out briefly for variety
      // chord stabs, soft and syncopated
      const hits = k % 2 === 0 ? [[0, 1.4, 0.55], [2.5, 0.4, 0.35]] : [[1.5, 0.9, 0.42], [3.5, 0.35, 0.3]];
      hits.forEach(([b, d, v]) => c.v.forEach((m, i) => keys.put(epiano(m, d * beat, v * (0.9 + R() * 0.2)), t0 + b * beat + human(R) + i * 0.006, 0.16, 0.35 + i * 0.1)));
      // bass
      T.put(bass(c.b, 0.85 * beat, 0.9), t0 + human(R, 0.006), 0.42, 0.5);
      T.put(bass(c.b, 0.35 * beat, 0.6), t0 + 2.5 * beat, 0.36, 0.5);
      if (k % 4 === 3) T.put(bass(c.b + 12, 0.3 * beat, 0.5), t0 + 3.5 * beat, 0.28, 0.5);
      if (!breakdown) {
        for (let b = 0; b < 4; b++) T.put(kick(R, 0.9), t0 + b * beat, 0.32, 0.5);
        for (let b = 0; b < 4; b++) T.put(hat(R, 0.8 + R() * 0.3), t0 + (b + 0.5) * beat + human(R, 0.008), 0.07, 0.62);
        T.put(rim(R, 0.7), t0 + 1 * beat, 0.035, 0.42);
        T.put(rim(R, 0.7), t0 + 3 * beat, 0.035, 0.42);
      }
      // a sparse bell note now and then
      if (k % 8 === 6) T.put(bell(c.v[3] + 12, 0.8), t0 + 2 * beat, 0.05, 0.7);
    }
    lowpassTrack(keys, 3200);
    T.mix(reverb(keys, 0.3));
    vinyl(T, R, 0.5, 0.003);
    return reverb(lowpassTrack(T, 5200), 0.12);
  },

  // 60 BPM, 16 bars = 64 s. Gentle piano, broken chords and a slow melody.
  'classical-piano'(R) {
    const beat = 1, bar = 4, bars = 16;
    const T = new Track(bar * bars);
    // C | Am | F | G | C/E | F | Dm7 | G
    const prog = [
      { r: 48, tones: [48, 55, 60, 64], mel: [72, 76, 79] },
      { r: 45, tones: [45, 52, 57, 60], mel: [69, 72, 76] },
      { r: 41, tones: [41, 48, 53, 57], mel: [69, 72, 77] },
      { r: 43, tones: [43, 50, 55, 59], mel: [71, 74, 79] },
      { r: 40, tones: [40, 48, 52, 55], mel: [72, 76, 79] },
      { r: 41, tones: [41, 48, 53, 57], mel: [69, 72, 77] },
      { r: 38, tones: [38, 45, 50, 53], mel: [69, 72, 74] },
      { r: 43, tones: [43, 50, 55, 59], mel: [71, 74, 77] },
    ];
    let last = 76;
    for (let k = 0; k < bars; k++) {
      const c = chordAt(prog, k);
      const t0 = k * bar;
      // left hand: rolling eighths, held with the pedal
      const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
      pattern.forEach((p, i) => T.put(piano(c.tones[p], bar - i * 0.5 + 0.2, i === 0 ? 0.9 : 0.6), t0 + i * 0.5 * beat + human(R, 0.02), 0.13, 0.35 + p * 0.06));
      // right hand: two or three long notes, mostly stepwise
      const times = k % 4 === 3 ? [0, 2] : R() < 0.5 ? [0, 2, 3] : [0, 1.5, 3];
      times.forEach((tb, i) => {
        const options = c.mel.concat(c.mel.map((m) => m + 2).filter((m) => R() < 0.3));
        options.sort((a, b) => Math.abs(a - last) - Math.abs(b - last));
        const m = options[Math.min(options.length - 1, Math.floor(R() * 2))];
        last = m;
        const d = (times[i + 1] ?? 4) - tb;
        T.put(piano(m, d * beat + 0.3, 0.75 + R() * 0.15), t0 + tb * beat + human(R, 0.025), 0.2, 0.6);
      });
    }
    return reverb(lowpassTrack(T, 6500), 0.38, 0.86, 0.3);
  },

  // 80 BPM, 20 bars = 60 s. Am9 | Fmaj7 | Cmaj7 | G6 with a soft arp and beat.
  'lofi-electronic'(R) {
    const beat = 0.75, bar = beat * 4, bars = 20;
    const T = new Track(bar * bars);
    const pads = new Track(bar * bars);
    const prog = [
      { b: 45, v: [60, 64, 67, 71] },
      { b: 41, v: [57, 60, 64, 65] },
      { b: 36, v: [55, 59, 60, 64] },
      { b: 43, v: [55, 59, 62, 64] },
    ];
    for (let k = 0; k < bars; k++) {
      const c = chordAt(prog, k);
      const t0 = k * bar;
      c.v.forEach((m, i) => pads.put(pad(m, bar - 0.2, 0.8, 3), t0, 0.1, 0.3 + i * 0.13));
      T.put(bass(c.b, bar * 0.45, 0.8), t0, 0.34, 0.5);
      T.put(bass(c.b, bar * 0.2, 0.55), t0 + 2.5 * beat, 0.26, 0.5);
      // arpeggio, eighths, ping-pong
      const notes = [...c.v, ...c.v.slice(1, 3).reverse()].map((m) => m + 12);
      for (let i = 0; i < 8; i++) {
        if (R() < 0.22) continue;
        const swing = i % 2 ? 0.06 : 0;
        T.put(epiano(notes[i % notes.length], 0.18, 0.5), t0 + (i * 0.5 + swing) * beat, 0.075, i % 2 ? 0.72 : 0.28);
      }
      if (k % 5 !== 4) {
        T.put(kick(R, 0.9), t0, 0.34, 0.5);
        T.put(kick(R, 0.6), t0 + 2.5 * beat, 0.3, 0.5);
        T.put(brush(R, 0.8, 0.14), t0 + 1 * beat, 0.11, 0.45);
        T.put(brush(R, 0.8, 0.14), t0 + 3 * beat, 0.11, 0.45);
        for (let i = 0; i < 8; i++) T.put(hat(R, i % 2 ? 0.6 : 0.9, 0.035), t0 + (i * 0.5 + (i % 2 ? 0.06 : 0)) * beat, 0.05, 0.6);
      }
    }
    lowpassTrack(pads, 1400);
    T.mix(pads);
    vinyl(T, R, 0.8, 0.004);
    return reverb(lowpassTrack(T, 3800), 0.25);
  },

  // 80 BPM swing, 20 bars = 60 s. Dm9 | G13 | Cmaj9 | A7b9: brushes, walking bass, soft comping.
  'late-night-jazz'(R) {
    const beat = 0.75, bar = beat * 4, bars = 20, sw = 2 / 3;
    const T = new Track(bar * bars);
    const keys = new Track(bar * bars);
    const prog = [
      { b: 38, walk: [38, 41, 45, 42], v: [53, 57, 60, 64] },
      { b: 43, walk: [43, 47, 50, 49], v: [53, 57, 59, 64] },
      { b: 36, walk: [36, 40, 43, 44], v: [52, 55, 59, 62] },
      { b: 45, walk: [45, 43, 40, 39], v: [55, 58, 61, 64] },
    ];
    for (let k = 0; k < bars; k++) {
      const c = chordAt(prog, k);
      const t0 = k * bar;
      // walking bass
      c.walk.forEach((m, i) => T.put(bass(m, beat * 0.88, i === 0 ? 0.95 : 0.8), t0 + i * beat + human(R, 0.01), 0.42, 0.45));
      // comping: varied rhythms, always soft
      const comp = [[[0, 1.2]], [[1 + sw, 0.6], [3, 0.5]], [[0, 0.8], [2 + sw, 0.9]], [[1 + sw, 1.6]]][Math.floor(R() * 4)];
      comp.forEach(([b, d]) => c.v.forEach((m, i) => keys.put(epiano(m, d * beat, 0.5 + R() * 0.15), t0 + b * beat + human(R) + i * 0.008, 0.16, 0.6 + i * 0.05)));
      // ride: spang-a-lang
      [0, 1, 1 + sw, 2, 3, 3 + sw].forEach((b) => T.put(hat(R, Number.isInteger(b) ? 0.7 : 0.45, 0.12), t0 + b * beat + human(R, 0.006), 0.045, 0.7));
      // brushes: slow swish every beat plus a soft slap on 2 and 4
      for (let b = 0; b < 4; b++) T.put(brush(R, 0.5, 0.5), t0 + b * beat, 0.05, 0.4);
      T.put(brush(R, 0.9, 0.12), t0 + 1 * beat, 0.09, 0.38);
      T.put(brush(R, 0.9, 0.12), t0 + 3 * beat, 0.09, 0.38);
      // sparse vibes phrase every few bars
      if (k % 4 === 2) [0, 1, 2].forEach((i) => T.put(bell(c.v[3 - i] + 12, 0.7), t0 + (2 + i * sw) * beat, 0.055, 0.25));
    }
    lowpassTrack(keys, 3000);
    T.mix(reverb(keys, 0.28));
    vinyl(T, R, 0.25, 0.0025);
    return reverb(lowpassTrack(T, 5000), 0.18);
  },

  // 72 BPM shuffle, 24 bars = 80 s. Two times round a slow 12-bar in A.
  'slow-blues'(R) {
    const beat = 60 / 72, bar = beat * 4, bars = 24, sw = 2 / 3;
    const T = new Track(bar * bars);
    const keys = new Track(bar * bars);
    const A = { r: 45, v: [55, 61, 64, 67] };
    const D = { r: 50, v: [54, 57, 60, 62] };
    const E = { r: 52, v: [56, 59, 62, 64] };
    const form = [A, A, A, A, D, D, A, A, E, D, A, E];
    const pent = [69, 72, 74, 75, 76, 79, 81];
    for (let k = 0; k < bars; k++) {
      const c = form[k % 12];
      const t0 = k * bar;
      const r = c.r;
      // boogie line on a muted low string
      [[0, 7], [0, 9], [0, 10], [0, 9]].forEach(([a, b], i) => {
        T.put(string(r + a, beat * 0.5, 0.8, R, 0.35), t0 + i * beat + human(R, 0.01), 0.2, 0.4);
        T.put(string(r + b, beat * 0.3, 0.65, R, 0.35), t0 + (i + sw) * beat + human(R, 0.01), 0.2, 0.4);
      });
      // soft keys on 2 and 4
      [1, 3].forEach((b) => c.v.forEach((m, i) => keys.put(epiano(m, beat * 0.55, 0.45), t0 + b * beat + human(R) + i * 0.007, 0.13, 0.62)));
      // a little guitar lick in some bars
      if ([1, 3, 5, 9].includes(k % 12) && R() < 0.85) {
        let i = 2 + Math.floor(R() * 3);
        const n = 3 + Math.floor(R() * 3);
        for (let q = 0; q < n; q++) {
          i = Math.max(0, Math.min(pent.length - 1, i + (R() < 0.6 ? -1 : 1)));
          T.put(string(pent[i], beat * 0.7, 0.8, R, 0.55), t0 + (2 + q * sw * 0.75) * beat + human(R, 0.015), 0.16, 0.66);
        }
      }
      // drums: very soft
      T.put(kick(R, 0.7), t0, 0.22, 0.5);
      T.put(kick(R, 0.5), t0 + 2 * beat, 0.2, 0.5);
      T.put(brush(R, 0.9, 0.14), t0 + 1 * beat, 0.08, 0.45);
      T.put(brush(R, 0.9, 0.14), t0 + 3 * beat, 0.08, 0.45);
      for (let b = 0; b < 4; b++) T.put(hat(R, 0.5, 0.08), t0 + (b + sw) * beat, 0.03, 0.62);
    }
    lowpassTrack(keys, 2600);
    T.mix(reverb(keys, 0.25));
    vinyl(T, R, 0.3, 0.0025);
    return reverb(lowpassTrack(T, 4500), 0.22);
  },

  // ---------- background sounds ----------
  'distant-birds'(R) {
    const T = new Track(60);
    // faint air
    for (let i = 0; i < T.N; i++) { const w = (R() * 2 - 1) * 0.02; T.L[i] += w; T.R[i] += w; }
    lowpassTrack(T, 500);
    const birds = new Track(60);
    for (let k = 0; k < 22; k++) {
      const t = R() * 60;
      const base = 2600 + R() * 2400;
      const pan = R();
      const reps = 1 + Math.floor(R() * 4);
      for (let q = 0; q < reps; q++) {
        const d = 0.07 + R() * 0.06;
        const f1 = base * (1.1 + R() * 0.35);
        let ph = 0;
        birds.put(render(d, (tt) => { const x = tt / d; ph += TAU * (base + (f1 - base) * Math.sin(x * Math.PI / 2)) / SR; return Math.sin(ph) * Math.sin(Math.PI * x) ** 2; }), t + q * (0.14 + R() * 0.06), 0.05, pan);
      }
    }
    lowpassTrack(birds, 4200); // distance takes the edge off
    reverb(birds, 0.55, 0.88, 0.4);
    return T.mix(birds);
  },

  'little-footsteps'(R) {
    const T = new Track(60);
    // quiet room tone
    for (let i = 0; i < T.N; i++) { const w = (R() * 2 - 1) * 0.01; T.L[i] += w; T.R[i] += w; }
    lowpassTrack(T, 300);
    const steps = new Track(60);
    const step = (vel) => {
      const f = 70 + R() * 25;
      let lo = 0;
      return render(0.12, (t) => {
        const w = R() * 2 - 1;
        lo += 0.08 * (w - lo);
        return vel * (Math.sin(TAU * f * t) * Math.exp(-t * 45) * 0.9 + lo * Math.exp(-t * 80) * 2.2);
      });
    };
    let t = 1 + R() * 2;
    while (t < 56) {
      const running = R() < 0.55;
      const n = running ? 5 + Math.floor(R() * 8) : 3 + Math.floor(R() * 4);
      const gap = running ? 0.22 + R() * 0.06 : 0.42 + R() * 0.1;
      const from = R(), to = R() < 0.5 ? from * 0.3 : 1 - (1 - from) * 0.3;
      const loud = 0.5 + R() * 0.5;
      for (let i = 0; i < n; i++) {
        const x = i / Math.max(1, n - 1);
        const arc = Math.sin(Math.PI * (0.2 + 0.6 * x)); // come closer, then away
        steps.put(step(loud * arc * (i % 2 ? 0.85 : 1)), t + i * gap + (R() - 0.5) * 0.03, 0.5, from + (to - from) * x);
      }
      t += n * gap + 4 + R() * 7;
    }
    lowpassTrack(steps, 1600);
    reverb(steps, 0.4, 0.75, 0.5);
    return T.mix(steps);
  },

  'fan-hum'(R) {
    const T = new Track(60);
    let b = 0;
    for (let i = 0; i < T.N; i++) {
      b = (b + 0.02 * (R() * 2 - 1)) / 1.02;
      const w = R() * 2 - 1;
      T.L[i] = b * 3 + w * 0.05;
      b = (b + 0.02 * (R() * 2 - 1)) / 1.02;
      T.R[i] = b * 3 + R() * 0.1 - 0.05;
    }
    lowpassTrack(T, 900);
    // blade whoosh: a gentle 10 Hz flutter, and a faint motor hum
    for (let i = 0; i < T.N; i++) {
      const t = i / SR;
      const flutter = 1 + 0.06 * Math.sin(TAU * 10 * t);
      const hum = 0.012 * Math.sin(TAU * 100 * t) + 0.005 * Math.sin(TAU * 200 * t);
      T.L[i] = T.L[i] * flutter + hum;
      T.R[i] = T.R[i] * flutter + hum;
    }
    return T;
  },
};

// ---------- write ----------
function writeWav(file, L, R) {
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.8 / (peak || 1);
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'music-'));
const only = process.argv.slice(2);
for (const [id, fn] of Object.entries(pieces)) {
  if (only.length && !only.includes(id)) continue;
  const seed = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
  const t = fn(rng(seed));
  const wav = path.join(tmp, `${id}.wav`);
  writeWav(wav, t.L, t.R);
  // loudnorm in linear mode keeps the dynamics of the music intact
  // faint sounds sit lower so they stay in the distance
  const target = { 'distant-birds': -28, 'little-footsteps': -31 }[id] || -23;
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', wav, '-af', `loudnorm=I=${target}:TP=-2:LRA=20:linear=true`, '-ar', '44100', '-b:a', '160k', path.join(outDir, `${id}.mp3`)]);
  console.log('wrote', id, `${(t.N / SR).toFixed(0)}s`);
}
fs.rmSync(tmp, { recursive: true, force: true });
