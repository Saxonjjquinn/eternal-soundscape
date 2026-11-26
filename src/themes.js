// Sound catalogue. Each sound is a loop in public/beds/<id>.mp3.
// People layer up to `maxLayers` of them, at most one of kind 'music'.
// `free: false` sounds need Plus. `gen: 'music'` ones come from scripts/make-music.js.
const THEMES = [
  // ---- music (only one piece at a time, so keys and tempos never clash) ----
  { id: 'classical-piano', kind: 'music', gen: 'music', name: 'Classical Piano', blurb: 'Slow, rolling piano with a simple melody.', free: true, colors: ['#5d5a7a', '#d9d2e9'] },
  { id: 'lofi-jazz-house', kind: 'music', gen: 'music', name: 'Lo-fi Jazz House', blurb: 'Warm keys over a soft, steady four-on-the-floor.', free: true, colors: ['#3e6e75', '#e3c9a1'] },
  { id: 'sunset-house', kind: 'music', gen: 'music', name: 'Sunset House', blurb: 'Slow, warm keys with a soft vibraphone answer.', free: true, colors: ['#b5654f', '#f3c9a0'] },
  { id: 'lullaby-glow', kind: 'music', name: 'Lullaby Glow', blurb: 'A soft pad with music-box notes, like a nightlight.', free: true, colors: ['#8a6fa8', '#e8c9e0'] },
  { id: 'music-box', kind: 'music', name: 'Music Box', blurb: 'A few slow, twinkling notes and nothing else.', free: true, colors: ['#b0697f', '#f4cdd4'] },
  { id: 'midnight-house', kind: 'music', gen: 'music', name: 'Midnight House', blurb: 'Dark, slow chords and a gentle pulse.', free: false, colors: ['#2b2f55', '#8f86c4'] },
  { id: 'window-seat', kind: 'music', gen: 'music', name: 'Window Seat', blurb: 'Soft felt piano over a slow, steady pulse.', free: false, colors: ['#556b7d', '#d6dfe6'] },
  { id: 'golden-hour', kind: 'music', gen: 'music', name: 'Golden Hour', blurb: 'Warm keys with a little plucked guitar.', free: false, colors: ['#a7743a', '#f2d49b'] },
  { id: 'lofi-electronic', kind: 'music', gen: 'music', name: 'Lo-fi Electronic', blurb: 'Hazy chords, a gentle arpeggio and a lazy beat.', free: false, colors: ['#4a4f8c', '#e7a7c8'] },
  { id: 'late-night-jazz', kind: 'music', gen: 'music', name: 'Late-Night Jazz', blurb: 'Brushes, walking bass and soft electric piano.', free: false, colors: ['#2e3b4e', '#d8b26e'] },
  { id: 'slow-blues', kind: 'music', gen: 'music', name: 'Slow Blues', blurb: 'An easy shuffle with a little guitar.', free: false, colors: ['#2c4a7a', '#9cc0e8'] },

  // ---- background sounds (mix freely) ----
  { id: 'gentle-rain', kind: 'ambience', name: 'Gentle Rain', blurb: 'Soft rain on the window with a warm hum underneath.', free: true, colors: ['#5b7a99', '#a9c1d9'] },
  { id: 'ocean-waves', kind: 'ambience', name: 'Ocean Waves', blurb: 'Slow waves rolling in and drawing back.', free: true, colors: ['#2f6f7e', '#9fd3d6'] },
  { id: 'distant-birds', kind: 'ambience', gen: 'music', name: 'Distant Birds', blurb: 'Birds faintly calling somewhere outside.', free: true, colors: ['#6f8f5e', '#dfe8c4'] },
  { id: 'fan-hum', kind: 'ambience', gen: 'music', name: 'Fan', blurb: 'The steady whoosh of a fan in the corner.', free: true, colors: ['#6d7a84', '#cfd8de'] },
  { id: 'little-footsteps', kind: 'ambience', gen: 'music', name: 'Little Footsteps', blurb: 'Small feet pattering through the house now and then.', free: false, colors: ['#a0745a', '#f1d7c0'] },
  { id: 'forest-morning', kind: 'ambience', name: 'Forest Morning', blurb: 'A light breeze and birds waking up.', free: false, colors: ['#4f7a4a', '#c8dca4'] },
  { id: 'cosy-fireplace', kind: 'ambience', name: 'Cosy Fireplace', blurb: 'A low crackling fire on a winter evening.', free: false, colors: ['#9a4f2c', '#f0c48a'] },
  { id: 'starry-night', kind: 'ambience', name: 'Starry Night', blurb: 'Crickets and a slow, starlit hum.', free: false, colors: ['#26305c', '#8d93c9'] },
  { id: 'soft-wind', kind: 'ambience', name: 'Soft Wind', blurb: 'Air moving gently through an open window.', free: false, colors: ['#6b7f8e', '#d5dee4'] },
];

// Small one-off sounds scattered in the quiet stretches between voices.
// Each has several variations in public/moments/<id>-<n>.mp3.
const MOMENTS = [
  { id: 'none', name: 'None', variants: 0 },
  { id: 'chimes', name: 'Wind chimes', variants: 4 },
  { id: 'whistle', name: 'Whistling', variants: 4 },
  { id: 'footsteps', name: 'Footsteps', variants: 4 },
  { id: 'bikebell', name: 'Bike bell', variants: 3 },
  { id: 'musicbox', name: 'Music-box phrase', variants: 4 },
  { id: 'bowl', name: 'Singing bowl', variants: 3 },
];

// Ready-made combinations shown at the top of the page. Levels are 0.25–1.
const COMBOS = [
  { id: 'rainy-afternoon', name: 'Rainy Afternoon', blurb: 'Soft rain with warm lo-fi keys.', ambience: ['gentle-rain'], music: 'lofi-jazz-house', bgLevel: 0.5, musicLevel: 0.5 },
  { id: 'golden-afternoon', name: 'Golden Afternoon', blurb: 'Birds outside and slow, warm house keys.', ambience: ['distant-birds'], music: 'sunset-house', bgLevel: 0.5, musicLevel: 0.5 },
  { id: 'sunday-morning', name: 'Sunday Morning', blurb: 'Birds outside and a slow piano.', ambience: ['distant-birds'], music: 'classical-piano', bgLevel: 0.5, musicLevel: 0.5 },
  { id: 'sleepy-time', name: 'Sleepy Time', blurb: 'A gentle fan and a lullaby glow.', ambience: ['fan-hum'], music: 'lullaby-glow', bgLevel: 0.5, musicLevel: 0.25 },
  { id: 'by-the-sea', name: 'By the Sea', blurb: 'Waves rolling in, a few music-box notes.', ambience: ['ocean-waves'], music: 'music-box', bgLevel: 0.5, musicLevel: 0.5 },
  { id: 'late-night', name: 'Late Night', blurb: 'A crackling fire and quiet jazz.', ambience: ['cosy-fireplace'], music: 'late-night-jazz', bgLevel: 0.5, musicLevel: 0.5 },
  { id: 'starlight', name: 'Starlight', blurb: 'Crickets, stars and hazy electronic chords.', ambience: ['starry-night'], music: 'lofi-electronic', bgLevel: 0.5, musicLevel: 0.5 },
];

// Limits for each tier. Plus is a placeholder until payments exist.
const TIERS = {
  free: { maxClips: 2, minMinutes: 1, maxMinutes: 3, maxLayers: 2 },
  plus: { maxClips: 8, minMinutes: 1, maxMinutes: 15, maxLayers: 3 },
};

const MAX_CLIP_SECONDS = 60; // longest stretch of a single recording we use

module.exports = { THEMES, MOMENTS, COMBOS, TIERS, MAX_CLIP_SECONDS };
