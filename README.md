# Little Echoes (prototype)

Parents upload candid recordings of their kids. The app blends them with a soft ambient bed into a soundscape that family can **download as an MP3** or **play from a shareable link** on a tablet, phone or smart display.

*"Little Echoes" is a working name. Change it in `public/index.html`, `public/player.html` and `public/404.html`.*

## The flow

1. **Listen to examples**: the home page plays sample soundscapes (or theme previews until you add real examples).
2. **Choose your sounds**: layer up to 2 sounds (free) or 3 (Plus), each with its own volume, and hear them together before you create. Gentle Rain, Ocean Waves, Lullaby Glow and Music Box are free. Forest Morning, Cosy Fireplace, Starry Night and Soft Wind are Plus.
3. **Little moments** (optional): wind chimes, a music-box phrase or a singing bowl, placed now and then in the quiet stretches between voices.
4. **Add recordings**: voice memos, phone videos (only the sound is used) or record in the browser. Pick which part of each recording to use (up to 60 s). 2 recordings free, up to 8 on Plus.
5. **Choose a length**: 1 to 3 minutes free, 5 / 10 / 15 minutes on Plus.
6. **Name it** and tick the parent/guardian permission box.
7. **Create**: you get a player, a timeline showing where each voice, sound and moment lands, a Download button, and a link like `/s/AbC123xyz_-Q` that opens a full-screen player with a big play button, looping on by default and the screen kept awake while it plays.

## Run it

Needs Node.js 18 or newer. ffmpeg is bundled via `ffmpeg-static`, so nothing else to install.

```bash
npm install
npm start            # http://localhost:3000
```

Settings (environment variables):

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `PUBLIC_URL` | taken from the request | Base used in share links, e.g. `https://littleechoes.app` |
| `DATA_DIR` | `./data` | Where finished soundscapes are stored |
| `MAX_JOBS` | `2` | How many mixes run at once |
| `FFMPEG_PATH` | bundled binary | Use a system ffmpeg instead |

## How the mix works (`src/mixer.js`)

1. Each clip is cut to the chosen part (max 60 s), silence is trimmed from both ends, rumble and hiss are reduced and loudness is evened out.
2. Voices are laid out with natural, uneven gaps (mostly 10 to 20 s, sometimes a longer rest). Every recording plays once before any repeats, never the same one twice in a row, each placed slightly left or right at a slightly different level. Gaps shrink automatically so every recording fits if it can.
3. Up to three ambient layers loop to the chosen length. The first fades in at the start and the others drift in one after another, each slowly "breathing" in volume. Together they dip gently while a child is speaking.
4. Optional moments (chimes, music box, singing bowl) go in some of the quiet stretches.
5. A 4 second fade in, 6 second fade out, and the whole track is levelled to a calm -20 LUFS, 192 kbps MP3.

Phone videos are decoded in the browser where possible, so only the chosen few seconds of sound are uploaded. If the browser can't read a file, the original is uploaded (up to 250 MB) and the server extracts the sound.

A 3 minute mix takes about 5 seconds on a small server.

## Ambient sounds

All eight beds in `public/beds/` and the moments in `public/moments/` are **synthesised from scratch** by `scripts/make-beds.js` (noise, filters, sine pads, generated bird chirps and crackles), so there are no licensing questions. Each is a seamless 60 second loop. To regenerate after editing a recipe: `npm run beds`. To add a theme, add it to `src/themes.js` and a matching recipe in `scripts/make-beds.js`. You could also swap in recorded beds (for example CC0 field recordings) by dropping a 60 second loopable MP3 at `public/beds/<theme-id>.mp3`.

## Real examples

Put each example in a folder under `examples/` with its clips and an `example.json`:

```json
{ "title": "Mia's rainy afternoon", "theme": "gentle-rain", "minutes": 1 }
```

Then run `npm run examples`. Only use recordings you have permission to show publicly.

## Prototype shortcuts to replace before launch

- **Plus is a placeholder.** The "Unlock Plus (demo)" button just sets a flag in the browser, and the server trusts `plus=1`. Replace with accounts and a payment provider (e.g. Stripe Checkout) and check the entitlement server-side in `src/server.js`.
- **Storage is the local disk.** Move `data/soundscapes` to object storage (S3, R2) for a real deployment, and consider expiring or letting parents delete soundscapes.
- **Links are unlisted, not private.** Anyone with a link can listen. IDs are 72-bit random, so they can't be guessed, but consider optional PINs for grandparent links.
- **No rate limiting or abuse checks** on uploads yet.
- Uploaded original recordings are deleted as soon as the mix is made. Only the finished MP3 is kept.

## Files

```
src/server.js        Express app: API, uploads, share links, downloads
src/mixer.js         ffmpeg mixing engine
src/themes.js        theme catalogue and free/Plus limits
public/              home page, player page, styles, ambient beds
scripts/make-beds.js synthesises the ambient beds
scripts/make-examples.js builds home-page examples from examples/
```
