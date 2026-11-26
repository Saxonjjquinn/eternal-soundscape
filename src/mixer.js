// Mixes uploaded voice clips over a looping ambient bed using ffmpeg.
//
// Pass 1 (per clip): decode any audio/video format, trim silence at the ends,
// clean up rumble and hiss, even out loudness, cap the length.
// Pass 2: loop the bed to the chosen length, scatter the clips across it with
// quiet gaps between them, gently duck the bed under the voices, fade in/out.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('./ffmpeg-path');

const SR = 44100;
const MAX_CLIP_SECONDS = 45;

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited ${code}`))));
  });
}

// Duration of a 16-bit stereo PCM wav written by us.
function wavSeconds(file) {
  return (fs.statSync(file).size - 44) / (SR * 4);
}

async function prepareClip(input, output) {
  const trimSilence = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.2';
  await run([
    '-i', input, '-vn', '-ac', '2', '-ar', String(SR),
    '-af', [
      trimSilence, 'areverse', trimSilence, 'areverse', // trim both ends
      'highpass=f=90', 'lowpass=f=11000',
      'afftdn=nf=-30', // light hiss reduction for phone recordings
      'loudnorm=I=-19:TP=-2:LRA=9',
      `atrim=0:${MAX_CLIP_SECONDS}`,
    ].join(','),
    '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', output,
  ]);
  const secs = wavSeconds(output);
  if (secs < 0.5) throw new Error('One of the clips seems to be silent or too short.');
  return secs;
}

// Deterministic jitter so the same inputs give the same mix.
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// Decide when each clip plays. Returns [{ clip, start }].
function schedule(durations, total) {
  const rand = seeded(durations.length * 7919 + Math.round(total));
  const out = [];
  let t = 5 + rand() * 3;
  let i = 0;
  const tail = 6;
  while (true) {
    const clip = i % durations.length;
    const d = durations[clip];
    if (t + d > total - tail) {
      // if nothing fits, still place a trimmed first clip
      if (out.length === 0) out.push({ clip, start: Math.max(1, Math.min(t, total - tail - d)) });
      break;
    }
    out.push({ clip, start: t });
    t += d + 10 + rand() * 12; // 10–22 s of just ambience between voices
    i++;
  }
  return out;
}

/**
 * @param {object} o
 * @param {string} o.bed       path to looping bed mp3
 * @param {string[]} o.clips   paths to uploaded clips
 * @param {number} o.seconds   total length
 * @param {string} o.output    output mp3 path
 * @param {string} o.workDir   scratch dir
 */
async function mix({ bed, clips, seconds, output, workDir, title }) {
  fs.mkdirSync(workDir, { recursive: true });
  const prepared = [];
  const durations = [];
  for (let i = 0; i < clips.length; i++) {
    const out = path.join(workDir, `clip${i}.wav`);
    durations.push(await prepareClip(clips[i], out));
    prepared.push(out);
  }

  const plan = schedule(durations, seconds);

  // Pass 2a: build the voice track. Each placement reads its clip as its own
  // input (no asplit), and a silent bed of the exact length sets the duration.
  const voices = path.join(workDir, 'voices.wav');
  const va = ['-f', 'lavfi', '-t', String(seconds), '-i', `anullsrc=r=${SR}:cl=stereo`];
  const vf = [];
  plan.forEach((p, k) => {
    va.push('-i', prepared[p.clip]);
    const d = durations[p.clip];
    const ms = Math.round(p.start * 1000);
    vf.push(
      `[${k + 1}:a]afade=t=in:d=0.2,afade=t=out:st=${Math.max(0, d - 0.5).toFixed(2)}:d=0.5,` +
        `aecho=0.85:0.5:45|95:0.18|0.1,` + // a little room so voices sit inside the ambience
        `adelay=${ms}|${ms}[v${k}]`
    );
  });
  const labels = plan.map((_, k) => `[v${k}]`).join('');
  vf.push(`[0:a]${labels}amix=inputs=${plan.length + 1}:normalize=0:duration=first:dropout_transition=0[out]`);
  await run([...va, '-filter_complex', vf.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', voices]);

  // Pass 2b: loop the bed, duck it under the voices, add the voices, fade, level.
  const args = ['-stream_loop', '-1', '-i', bed, '-i', voices, '-i', voices];
  const f = [
    `[0:a]aformat=sample_rates=${SR}:channel_layouts=stereo,atrim=0:${seconds},asetpts=PTS-STARTPTS[bed]`,
    '[bed][1:a]sidechaincompress=threshold=0.02:ratio=3:attack=150:release=1800[ducked]',
    `[ducked][2:a]amix=inputs=2:normalize=0:duration=first,` +
      `afade=t=in:d=4,afade=t=out:st=${seconds - 6}:d=6,loudnorm=I=-20:TP=-1.5:LRA=11[out]`,
  ];
  args.push('-filter_complex', f.join(';'), '-map', '[out]', '-ar', String(SR), '-c:a', 'libmp3lame', '-b:a', '192k');
  if (title) args.push('-metadata', `title=${title}`);
  args.push(output);
  await run(args);
  return { plan, durations };
}

module.exports = { mix, schedule };
