// Generates the "real world" little moments: someone whistling, small
// footsteps, a bicycle bell and wind chimes. Nothing is sampled; each sound is
// modelled on how the real thing behaves (a person's imperfect pitch and
// breath, a floor's thud and creak, a bell's beating metal modes, chime tubes
// struck by gusts) and then placed in a room or street with its own echo, so
// it sounds recorded rather than clean.
//
//   node scripts/make-moments.js            # all
//   node scripts/make-moments.js whistle    # just one kind
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpeg = require('../src/ffmpeg-path');

const SR = 44100;
const TAU = Math.PI * 2;

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
const gauss = (R) => (R() + R() + R() + R() - 2) * 1.22; // roughly normal, sd ~1
const pick = (R, a) => a[Math.floor(R() * a.length)];

class Stereo {
  constructor(secs) { this.N = Math.round(secs * SR); this.L = new Float32Array(this.N); this.R = new Float32Array(this.N); }
  add(i, v, pan = 0.5) { if (i >= 0 && i < this.N) { this.L[i] += v * Math.cos(pan * Math.PI / 2); this.R[i] += v * Math.sin(pan * Math.PI / 2); } }
}

// Resonant band-pass whose centre can move every sample (RBJ biquad).
function bandpass() {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f, q) => {
    const w = (TAU * Math.min(f, SR * 0.45)) / SR, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a;
    const y = ((a * x) - (a * x2) - (-2 * c) * y1 - (1 - a) * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
const onepole = (hz) => { const k = 1 - Math.exp((-TAU * hz) / SR); let y = 0; return (x) => (y += k * (x - y)); };

// ---------------------------------------------------------------------------
// Someone whistling a little tune to themselves: never quite in tune, scooping
// into notes, uneven vibrato, airy breath around the tone, a breath between phrases.
function whistle(R, variant) {
  const out = new Stereo(7.5);
  const base = 78 + Math.floor(R() * 5); // notes land around 0.9–2.2 kHz, where people whistle
  const scale = [0, 2, 4, 7, 9, 12, 14];
  let idx = 2 + Math.floor(R() * 3);
  const notes = [];
  let t = 0.25;
  const count = 8 + Math.floor(R() * 5);
  for (let k = 0; k < count; k++) {
    const step = pick(R, [-3, -2, -1, -1, 1, 1, 2, 3]);
    idx = idx + step < 0 || idx + step >= scale.length ? idx - step : idx + step; // turn back at the edges
    const last = k === count - 1;
    const dur = last ? 0.9 + R() * 0.5 : pick(R, [0.16, 0.2, 0.24, 0.3, 0.38, 0.5, 0.65]) * (0.85 + R() * 0.3);
    notes.push({ t, dur, midi: base + scale[idx] + gauss(R) * 0.22, slur: R() < 0.45, level: 0.7 + R() * 0.3 });
    t += dur + (R() < 0.15 && !last ? 0.25 + R() * 0.3 : 0); // the odd little gap
    if (t > 6.5) break;
  }
  const end = notes[notes.length - 1].t + notes[notes.length - 1].dur;
  const bp = bandpass(), hiss = onepole(9000), hissHp = onepole(1800), wobble = onepole(3), tremble = onepole(6);
  let ph = 0, f = 440 * Math.pow(2, (notes[0].midi - 1 - 69) / 12), amp = 0, k = 0;
  const vibRate = 4.6 + R() * 1.2, vibDepth = 0.006 + R() * 0.01;
  for (let i = Math.floor(0.2 * SR); i < Math.min(out.N, (end + 0.3) * SR); i++) {
    const s = i / SR;
    while (k < notes.length - 1 && s >= notes[k + 1].t) k++;
    const n = notes[k];
    const local = s - n.t;
    const target = 440 * Math.pow(2, (n.midi - 69) / 12);
    const scoop = local < 0.07 && !n.slur ? 1 - 0.035 * (1 - local / 0.07) : 1; // lip finds the note from below
    f += (target * scoop - f) * (n.slur ? 0.0016 : 0.004);
    const vib = 1 + vibDepth * Math.sin(TAU * vibRate * s + Math.sin(TAU * 0.7 * s)) * Math.min(1, Math.max(0, local - 0.12) / 0.2);
    const drift = 1 + wobble(gauss(R) * 0.05); // tiny unsteadiness
    ph += (TAU * f * vib * drift) / SR;
    // breath-driven loudness: soft attack, little dips where the tongue articulates
    const art = !n.slur && local < 0.035 ? local / 0.035 : 1;
    const tail = s > end ? Math.max(0, 1 - (s - end) / 0.12) : 1;
    amp += (n.level * art * tail - amp) * 0.004;
    const shaky = 1 + tremble(gauss(R) * 0.6) * 0.15;
    const a = amp * shaky;
    const tone = Math.sin(ph) + 0.035 * Math.sin(2 * ph) + 0.01 * Math.sin(3 * ph);
    const air = bp(gauss(R), f, 9) * 0.55; // breath noise hugging the pitch
    const hs = hiss(gauss(R)); const hsh = hs - hissHp(hs); // broadband air from the lips
    out.add(i, (tone * 0.55 + air + hsh * 0.03) * a * 0.3, 0.45);
  }
  // a quiet breath in, before the tune
  const inhale = onepole(2500), inHp = onepole(400);
  for (let i = 0; i < 0.22 * SR; i++) {
    const s = i / SR, e = Math.sin(Math.PI * s / 0.22) * 0.012;
    const x = inhale(gauss(R)); out.add(i, (x - inHp(x)) * e, 0.45);
  }
  return { out, room: 'room' };
}

// ---------------------------------------------------------------------------
// Little feet across a wooden floor: a heel thud and a lighter toe on each
// step, uneven timing, one foot a bit heavier, the odd floorboard creak,
// getting nearer then further as they pass.
function footsteps(R, variant) {
  const out = new Stereo(6.5);
  const running = variant % 2 === 0;
  const steps = running ? 9 + Math.floor(R() * 4) : 6 + Math.floor(R() * 3);
  const gap = running ? 0.27 : 0.46;
  const fromLeft = R() < 0.5;
  let t = 0.15;
  for (let k = 0; k < steps; k++) {
    const p = k / (steps - 1);
    const pan = fromLeft ? 0.2 + 0.6 * p : 0.8 - 0.6 * p;
    const near = Math.sin(Math.PI * (0.15 + 0.7 * p)); // closest in the middle
    const vel = (0.55 + 0.45 * near) * (k % 2 ? 0.85 : 1) * (0.85 + R() * 0.3);
    const tone = 1800 + 4000 * near; // further away sounds duller
    // heel: the floor's low "body" plus a soft contact click
    const modes = [90 + R() * 50, 160 + R() * 80, 310 + R() * 120];
    const click = onepole(tone);
    for (let j = 0; j < 0.16 * SR; j++) {
      const u = j / SR;
      let v = 0;
      modes.forEach((fm, m) => { v += Math.sin(TAU * fm * u) * Math.exp(-u * (28 + m * 22)) * [1, 0.5, 0.25][m]; });
      v += click(gauss(R)) * Math.exp(-u * 160) * 0.9;
      out.add(Math.round((t + u) * SR), v * Math.min(1, u / 0.0015) * vel * 0.33, pan);
    }
    // toe/forefoot a moment later: lighter, with a tiny scuff
    const toeAt = t + (running ? 0.045 : 0.085) + R() * 0.03;
    const scuff = bandpass(), lp = onepole(tone * 0.8);
    for (let j = 0; j < 0.09 * SR; j++) {
      const u = j / SR;
      const v = lp(gauss(R)) * Math.exp(-u * 70) * 0.5 + scuff(gauss(R), 1400 + R() * 600, 1.5) * Math.exp(-u * 35) * 0.25 + Math.sin(TAU * (modes[1] * 1.3) * u) * Math.exp(-u * 60) * 0.3;
      out.add(Math.round((toeAt + u) * SR), v * vel * 0.3, pan);
    }
    // an old floorboard, now and then
    if (R() < (variant > 2 ? 0.35 : 0.15)) {
      const cr = bandpass(), len = 0.12 + R() * 0.2, f0 = 380 + R() * 300, f1 = f0 * (1.2 + R() * 0.4);
      const at = t + 0.05;
      for (let j = 0; j < len * SR; j++) {
        const u = j / SR, e = Math.sin(Math.PI * u / len) * (0.6 + 0.4 * Math.sin(TAU * 35 * u));
        out.add(Math.round((at + u) * SR), cr(gauss(R), f0 + (f1 - f0) * (u / len), 40) * e * 0.5 * vel, pan);
      }
    }
    t += gap * (0.88 + R() * 0.24) * (k % 2 ? 1.04 : 0.96);
    if (t > 6) break;
  }
  return { out, room: 'hall' };
}

// ---------------------------------------------------------------------------
// A bicycle bell out on the street: a domed bell with slightly mistuned twin
// modes (so it shimmers), struck by a rattling clapper, a bit off in the distance.
function bikebell(R, variant) {
  const out = new Stereo(5);
  const f0 = [1950, 2280, 2620][(variant - 1) % 3] * (1 + (R() - 0.5) * 0.02);
  const modes = [[0.5, 0.06, 0.9], [1, 1, 1.7], [1.006, 0.75, 1.5], [1.52, 0.35, 0.9], [2.29, 0.28, 0.6], [2.31, 0.15, 0.55], [3.02, 0.12, 0.35], [3.9, 0.06, 0.22]]
    .map(([r, a, d]) => ({ f: f0 * r * (1 + (R() - 0.5) * 0.003), a, d: d * (0.85 + R() * 0.3), ph: R() * TAU }));
  // strike times: "ding-ding" with a lever, or a rattly "brrring" with a rotary bell
  const strikes = [];
  const rotary = variant === 2;
  let t = 0.1;
  const rings = rotary ? 1 + (R() < 0.5 ? 1 : 0) : 2;
  for (let r = 0; r < rings; r++) {
    if (rotary) {
      const len = 0.35 + R() * 0.25;
      for (let s = 0; s < len; s += 0.03 + R() * 0.018) strikes.push({ t: t + s, v: 0.35 + R() * 0.35 });
      t += len + 0.5 + R() * 0.3;
    } else {
      strikes.push({ t, v: 0.9 + R() * 0.1 });
      strikes.push({ t: t + 0.035 + R() * 0.02, v: 0.25 + R() * 0.15 }); // the clapper bounces
      t += 0.32 + R() * 0.12;
    }
  }
  const pan = 0.3 + R() * 0.4;
  for (const st of strikes) {
    const start = Math.round(st.t * SR);
    for (const m of modes) {
      const len = Math.min(out.N - start, Math.round(m.d * 5 * SR));
      for (let j = 0; j < len; j++) {
        const u = j / SR;
        out.add(start + j, Math.sin(TAU * m.f * u + m.ph) * Math.exp(-u / m.d) * m.a * st.v * Math.min(1, u / 0.0008) * 0.05, pan);
      }
    }
    const click = onepole(7000);
    for (let j = 0; j < 0.006 * SR; j++) out.add(start + j, click(gauss(R)) * Math.exp(-j / SR * 900) * st.v * 0.05, pan);
  }
  return { out, room: 'street' };
}

// ---------------------------------------------------------------------------
// Wind chimes on a porch: a few metal tubes (each with its own overtones and a
// slow shimmer), knocked by the striker as a breeze builds and fades.
function chimes(R, variant) {
  const out = new Stereo(9);
  const sets = [[523, 587, 659, 784, 880], [392, 440, 523, 587, 659], [659, 740, 880, 988, 1109], [440, 494, 587, 659, 784]];
  const tubes = sets[(variant - 1) % sets.length].map((f) => {
    f *= 1 + (R() - 0.5) * 0.012; // never perfectly tuned
    return {
      pan: 0.25 + R() * 0.5,
      modes: [[1, 1, 3.6], [2.756, 0.45, 1.9], [5.404, 0.2, 0.9], [8.933, 0.08, 0.45]].map(([r, a, d]) => ({
        f: f * r, f2: f * r * (1 + 0.0015 + R() * 0.003), a, d: d * (700 / f) ** 0.4 * (0.8 + R() * 0.4),
      })),
    };
  });
  // a breeze: strikes cluster where the gust is strongest
  const peak = 1 + R() * 2;
  const strikes = [];
  let last = -1;
  for (let s = 0.1; s < 6.5;) {
    const gust = Math.exp(-((s - peak) ** 2) / 2.2);
    s += 0.06 + (-Math.log(1 - R()) / (1 + 9 * gust)) * 0.9;
    if (s > 6.5 || strikes.length > 16) break;
    let tube = Math.floor(R() * tubes.length);
    if (tube === last) tube = (tube + 1 + Math.floor(R() * (tubes.length - 1))) % tubes.length;
    last = tube;
    strikes.push({ t: s, tube, v: (0.3 + 0.7 * gust) * (0.5 + R() * 0.5) });
  }
  if (!strikes.length) strikes.push({ t: 0.3, tube: 0, v: 0.6 });
  for (const st of strikes) {
    const tb = tubes[st.tube];
    const start = Math.round(st.t * SR);
    for (const m of tb.modes) {
      const len = Math.min(out.N - start, Math.round(m.d * 5 * SR));
      for (let j = 0; j < len; j++) {
        const u = j / SR;
        const v = (Math.sin(TAU * m.f * u) + 0.6 * Math.sin(TAU * m.f2 * u)) * Math.exp(-u / m.d) * m.a;
        out.add(start + j, v * st.v * Math.min(1, u / 0.001) * 0.05, tb.pan);
      }
    }
    // the knock of the wooden striker
    const knock = bandpass();
    for (let j = 0; j < 0.01 * SR; j++) out.add(start + j, knock(gauss(R), 2500, 3) * Math.exp(-j / SR * 500) * st.v * 0.06, tb.pan);
  }
  return { out, room: 'porch' };
}

// ---------------------------------------------------------------------------
// The space each sound was "recorded" in, as a stereo impulse response.
function impulse(kind, R) {
  const spec = {
    room: { rt: 0.45, early: [[0.007, 0.35], [0.013, 0.25], [0.021, 0.18]], damp: 3500, tail: 0.5 },
    hall: { rt: 0.75, early: [[0.011, 0.4], [0.019, 0.3], [0.029, 0.22], [0.041, 0.15]], damp: 3000, tail: 0.6 },
    street: { rt: 0.9, early: [[0.018, 0.45], [0.034, 0.3], [0.061, 0.2], [0.093, 0.12]], damp: 4500, tail: 0.25 },
    porch: { rt: 0.6, early: [[0.009, 0.3], [0.023, 0.2]], damp: 6000, tail: 0.2 },
  }[kind];
  const n = Math.round(spec.rt * 1.2 * SR);
  const L = new Float32Array(n), Rr = new Float32Array(n);
  L[0] = Rr[0] = 1;
  spec.early.forEach(([d, g]) => { L[Math.round(d * SR)] += g * (0.8 + R() * 0.4); Rr[Math.round(d * 1.13 * SR)] += g * (0.8 + R() * 0.4); });
  const lpL = onepole(spec.damp), lpR = onepole(spec.damp);
  for (let i = Math.round(0.012 * SR); i < n; i++) {
    const e = Math.exp((-6.9 * i) / (spec.rt * SR)) * spec.tail;
    L[i] += lpL(gauss(R)) * e * 0.5;
    Rr[i] += lpR(gauss(R)) * e * 0.5;
  }
  return { L, R: Rr };
}

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

const KINDS = {
  whistle: { make: whistle, variants: 4, target: -26, wet: 0.35 },
  footsteps: { make: footsteps, variants: 4, target: -27, wet: 0.45 },
  bikebell: { make: bikebell, variants: 3, target: -29, wet: 0.6 },
  chimes: { make: chimes, variants: 4, target: -25, wet: 0.3 },
};
module.exports = { KINDS };

if (require.main === module) {
  const outDir = path.join(__dirname, '..', 'public', 'moments');
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moments-'));
  const only = process.argv.slice(2);
  for (const [id, k] of Object.entries(KINDS)) {
    if (only.length && !only.includes(id)) continue;
    for (let v = 1; v <= k.variants; v++) {
      const R = rng(4242 + v * 977 + id.length * 31 + id.charCodeAt(0));
      const { out, room } = k.make(R, v);
      const ir = impulse(room, R);
      const dry = path.join(tmp, `${id}-${v}.wav`), irf = path.join(tmp, `${id}-${v}-ir.wav`);
      writeWav(dry, out.L, out.R);
      writeWav(irf, ir.L, ir.R);
      // place it in its space, roll off like a phone mic, fade the ends, level it
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', dry, '-i', irf, '-filter_complex',
        `[0:a]asplit[d][w];[w][1:a]afir[r];[d][r]amix=inputs=2:weights=1 ${k.wet}:normalize=0,highpass=f=70,lowpass=f=12000,` +
        `afade=t=in:d=0.02,areverse,afade=t=in:d=0.3,areverse,loudnorm=I=${k.target}:TP=-3:LRA=20`,
        '-ar', '44100', '-b:a', '160k', path.join(outDir, `${id}-${v}.mp3`)]);
    }
    console.log('wrote', id);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
