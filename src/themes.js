// Theme catalogue. `free: false` themes need the (placeholder) Plus unlock.
const THEMES = [
  { id: 'gentle-rain', name: 'Gentle Rain', blurb: 'Soft rain on the window with a warm hum underneath.', free: true, colors: ['#5b7a99', '#a9c1d9'] },
  { id: 'ocean-waves', name: 'Ocean Waves', blurb: 'Slow waves rolling in and drawing back.', free: true, colors: ['#2f6f7e', '#9fd3d6'] },
  { id: 'lullaby-glow', name: 'Lullaby Glow', blurb: 'A soft pad with music-box notes, like a nightlight.', free: true, colors: ['#8a6fa8', '#e8c9e0'] },
  { id: 'forest-morning', name: 'Forest Morning', blurb: 'A light breeze and birds waking up.', free: false, colors: ['#4f7a4a', '#c8dca4'] },
  { id: 'cosy-fireplace', name: 'Cosy Fireplace', blurb: 'A low crackling fire on a winter evening.', free: false, colors: ['#9a4f2c', '#f0c48a'] },
  { id: 'starry-night', name: 'Starry Night', blurb: 'Crickets and a slow, starlit hum.', free: false, colors: ['#26305c', '#8d93c9'] },
];

// Limits for each tier. Plus is a placeholder until payments exist.
const TIERS = {
  free: { maxClips: 2, minMinutes: 1, maxMinutes: 3 },
  plus: { maxClips: 8, minMinutes: 1, maxMinutes: 15 },
};

module.exports = { THEMES, TIERS };
