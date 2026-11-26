// Sound catalogue. Each sound is a looping ambient bed in public/beds/<id>.mp3.
// People layer up to `maxLayers` of them. `free: false` sounds need Plus.
const THEMES = [
  { id: 'gentle-rain', name: 'Gentle Rain', blurb: 'Soft rain on the window with a warm hum underneath.', free: true, colors: ['#5b7a99', '#a9c1d9'] },
  { id: 'ocean-waves', name: 'Ocean Waves', blurb: 'Slow waves rolling in and drawing back.', free: true, colors: ['#2f6f7e', '#9fd3d6'] },
  { id: 'lullaby-glow', name: 'Lullaby Glow', blurb: 'A soft pad with music-box notes, like a nightlight.', free: true, colors: ['#8a6fa8', '#e8c9e0'] },
  { id: 'music-box', name: 'Music Box', blurb: 'A few slow, twinkling notes and nothing else.', free: true, colors: ['#b0697f', '#f4cdd4'] },
  { id: 'forest-morning', name: 'Forest Morning', blurb: 'A light breeze and birds waking up.', free: false, colors: ['#4f7a4a', '#c8dca4'] },
  { id: 'cosy-fireplace', name: 'Cosy Fireplace', blurb: 'A low crackling fire on a winter evening.', free: false, colors: ['#9a4f2c', '#f0c48a'] },
  { id: 'starry-night', name: 'Starry Night', blurb: 'Crickets and a slow, starlit hum.', free: false, colors: ['#26305c', '#8d93c9'] },
  { id: 'soft-wind', name: 'Soft Wind', blurb: 'Air moving gently through an open window.', free: false, colors: ['#6b7f8e', '#d5dee4'] },
];

// Small one-off sounds scattered in the quiet stretches between voices.
// Each has several variations in public/moments/<id>-<n>.mp3.
const MOMENTS = [
  { id: 'none', name: 'None', variants: 0 },
  { id: 'chimes', name: 'Wind chimes', variants: 4 },
  { id: 'musicbox', name: 'Music-box phrase', variants: 4 },
  { id: 'bowl', name: 'Singing bowl', variants: 3 },
];

// Limits for each tier. Plus is a placeholder until payments exist.
const TIERS = {
  free: { maxClips: 2, minMinutes: 1, maxMinutes: 3, maxLayers: 2 },
  plus: { maxClips: 8, minMinutes: 1, maxMinutes: 15, maxLayers: 3 },
};

const MAX_CLIP_SECONDS = 60; // longest stretch of a single recording we use

module.exports = { THEMES, MOMENTS, TIERS, MAX_CLIP_SECONDS };
