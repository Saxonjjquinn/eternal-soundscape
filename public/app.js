(() => {
  const $ = (s) => document.querySelector(s);
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
  const LENGTHS = [1, 2, 3, 5, 10, 15];
  const LEVELS = [0.25, 0.5, 0.75, 1];
  const CLIP_COLORS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2a541', '#9b72cf', '#d1495b', '#2a9d8f', '#c08552'];
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const curve = (level) => Math.pow(level, 1.25); // so each volume step is clearly audible

  let config;
  const state = { ambience: [], music: null, bgLevel: 0.5, musicLevel: 0.5, voiceLevel: 1, moments: 'none', minutes: 2, clips: [], plus: false };
  try { state.plus = localStorage.getItem('le-plus') === '1'; } catch {}
  const tier = () => config.tiers[state.plus ? 'plus' : 'free'];
  const themeById = (id) => config.themes.find((t) => t.id === id);
  const layerCount = () => state.ambience.length + (state.music ? 1 : 0);
  const gradient = (c) => `linear-gradient(135deg, ${c[0]}, ${c[1]})`;

  // =====================================================================
  // Live mix: your recordings play with the chosen sounds and music on top.
  // Volume changes and new sounds are heard straight away.
  // =====================================================================
  const live = { ctx: null, playing: false, beds: new Map(), voiceSrc: null, clipIdx: 0, timer: null };
  function ensureCtx() {
    if (!live.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      live.ctx = new C();
      live.master = live.ctx.createGain();
      live.master.connect(live.ctx.destination);
      live.duck = live.ctx.createGain(); // beds dip while a voice plays, like the final mix
      live.duck.connect(live.master);
      live.bgBus = live.ctx.createGain();
      live.musicBus = live.ctx.createGain();
      live.bgBus.connect(live.duck);
      live.musicBus.connect(live.duck);
      live.voice = live.ctx.createGain();
      live.voice.connect(live.master);
    }
    if (live.ctx.state === 'suspended') live.ctx.resume();
    return live.ctx;
  }
  function applyLevels() {
    if (!live.ctx) return;
    const n = Math.max(1, layerCount());
    const k = 1.1 / Math.sqrt(n);
    const now = live.ctx.currentTime;
    live.bgBus.gain.setTargetAtTime(curve(state.bgLevel) * k, now, 0.08);
    live.musicBus.gain.setTargetAtTime(curve(state.musicLevel) * k, now, 0.08);
  }
  function syncBeds() {
    if (!live.ctx) return;
    const wanted = new Map(state.ambience.map((id) => [id, live.bgBus]));
    if (state.music) wanted.set(state.music, live.musicBus);
    for (const [id, b] of live.beds) {
      if (!wanted.has(id)) {
        b.gain.gain.setTargetAtTime(0, live.ctx.currentTime, 0.2);
        setTimeout(() => { b.el.pause(); b.el.src = ''; }, 900);
        live.beds.delete(id);
      }
    }
    for (const [id, bus] of wanted) {
      if (live.beds.has(id)) continue;
      const el = new Audio(`/beds/${id}.mp3`);
      el.loop = true;
      el.crossOrigin = 'anonymous';
      const src = live.ctx.createMediaElementSource(el);
      const gain = live.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(bus);
      const b = { el, gain };
      live.beds.set(id, b);
      if (live.playing) startBed(b);
    }
    applyLevels();
    renderLivebar();
  }
  function startBed(b) {
    b.el.play().catch(() => {});
    b.gain.gain.setTargetAtTime(1, live.ctx.currentTime, 0.4); // drift in
  }
  function duck(on) {
    if (!live.ctx) return;
    live.duck.gain.setTargetAtTime(on ? 0.55 : 1, live.ctx.currentTime, on ? 0.08 : 0.6);
  }
  function readyClips() { return state.clips.filter((c) => c.status === 'ready' && c.buffer); }
  function playNextVoice() {
    clearTimeout(live.timer);
    if (!live.playing) return;
    const clips = readyClips();
    if (!clips.length) { live.timer = setTimeout(playNextVoice, 1500); return; }
    const c = clips[live.clipIdx % clips.length];
    live.clipIdx++;
    const src = live.ctx.createBufferSource();
    src.buffer = c.buffer;
    src.connect(live.voice);
    // the first time round each recording plays clearly; after that it comes back softer
    const echo = live.clipIdx > clips.length;
    live.voice.gain.value = (c.previewGain || 1) * (echo ? 0.5 : 1) * curve(state.voiceLevel);
    const dur = Math.max(0.3, c.to - c.from);
    src.start(0, c.from, dur);
    live.voiceSrc = src;
    duck(true);
    renderLivebar(c.name);
    src.onended = () => {
      if (live.voiceSrc !== src) return;
      duck(false);
      renderLivebar();
      // a pause before the next voice (shorter than the real mix so you hear more)
      const gap = 7000 + Math.random() * 5000;
      if (state.moments !== 'none' && Math.random() < 0.6) {
        const m = config.moments.find((x) => x.id === state.moments);
        setTimeout(() => {
          if (!live.playing || !m || !m.variants) return;
          const el = new Audio(`/moments/${m.id}-${1 + Math.floor(Math.random() * m.variants)}.mp3`);
          el.volume = Math.min(1, 0.35 + 0.5 * curve(state.bgLevel));
          el.play().catch(() => {});
        }, gap * 0.3);
      }
      live.timer = setTimeout(playNextVoice, gap);
    };
  }
  function startLive() {
    stopAudition();
    ensureCtx();
    syncBeds();
    live.playing = true;
    for (const b of live.beds.values()) startBed(b);
    live.timer = setTimeout(playNextVoice, live.beds.size ? 1800 : 200);
    renderLivebar();
  }
  function stopLive() {
    live.playing = false;
    clearTimeout(live.timer);
    if (live.voiceSrc) { try { live.voiceSrc.stop(); } catch {} live.voiceSrc = null; }
    for (const b of live.beds.values()) { b.el.pause(); if (live.ctx) b.gain.gain.value = 0; }
    duck(false);
    renderLivebar();
  }
  // Called after anything changes. Starts listening when there is something to
  // hear and the change came from a tap, so it feels live.
  function mixChanged(fromTap) {
    syncBedsIfReady();
    if (fromTap && !live.playing && (readyClips().length || layerCount())) startLive();
    renderLivebar();
  }
  function syncBedsIfReady() { if (live.ctx) syncBeds(); }

  function renderLivebar(speaking) {
    const bar = $('#livebar');
    const has = readyClips().length || layerCount();
    bar.hidden = !has || !$('#result').hidden;
    $('#livePlay').textContent = live.playing ? '❚❚' : '▶';
    $('#livePlay').setAttribute('aria-label', live.playing ? 'Pause your mix' : 'Listen to your mix');
    const parts = [];
    if (readyClips().length) parts.push(`${readyClips().length} recording${readyClips().length > 1 ? 's' : ''}`);
    state.ambience.forEach((id) => parts.push(themeById(id).name));
    if (state.music) parts.push(themeById(state.music).name);
    $('#liveTitle').textContent = live.playing ? (speaking ? `Playing: ${speaking}` : 'Listening to your mix') : 'Listen to your mix';
    $('#liveSummary').textContent = parts.join(' + ');
  }
  $('#livePlay').addEventListener('click', () => (live.playing ? stopLive() : startLive()));

  // ---------- single-sound audition (the ▶ on each card) ----------
  let audition = null;
  function stopAudition() {
    if (audition) { audition.el.pause(); audition.btn.innerHTML = PLAY; audition = null; }
  }
  function playAudition(btn, src, { loop = true } = {}) {
    const same = audition && audition.btn === btn;
    stopAudition();
    if (same) return;
    if (live.playing) stopLive();
    stopClipPreview();
    const el = new Audio(src);
    el.loop = loop;
    el.play().catch(() => {});
    el.addEventListener('ended', () => { if (audition && audition.el === el) stopAudition(); });
    audition = { el, btn };
    btn.innerHTML = PAUSE;
  }

  // ---------- favourite combinations ----------
  function comboLocked(c) {
    if (state.plus) return false;
    return [...c.ambience, c.music].some((id) => !themeById(id).free) || c.ambience.length + 1 > config.tiers.free.maxLayers;
  }
  function renderCombos() {
    const list = $('#comboList');
    list.innerHTML = '';
    config.combos.forEach((c) => {
      const m = themeById(c.music);
      const a = themeById(c.ambience[0]);
      const locked = comboLocked(c);
      const el = document.createElement('div');
      el.className = 'example combo';
      el.innerHTML = `<div class="art" style="background:linear-gradient(135deg, ${a.colors[0]}, ${m.colors[1]})"></div>
        <div class="combo-text"><h3></h3><p class="muted small"></p><p class="small combo-parts"></p></div>
        <div class="combo-actions"><button class="play" type="button" aria-label="Hear ${c.name}">${PLAY}</button>
        <button class="btn small-btn" type="button">${locked ? '🔒 Plus' : 'Use this'}</button></div>`;
      el.querySelector('h3').textContent = c.name;
      el.querySelectorAll('p')[0].textContent = c.blurb;
      el.querySelector('.combo-parts').textContent = [...c.ambience.map((id) => themeById(id).name), m.name].join(' + ');
      const play = el.querySelector('.play');
      play.addEventListener('click', () => playCombo(play, c));
      el.querySelector('.small-btn').addEventListener('click', () => {
        if (locked) return openPlus();
        state.ambience = [...c.ambience];
        state.music = c.music;
        state.bgLevel = c.bgLevel;
        state.musicLevel = c.musicLevel;
        stopAudition();
        renderAll();
        mixChanged(true);
        showError('');
        $('#create').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      list.appendChild(el);
    });
  }
  // a combo preview plays its sounds together at the combo's levels
  let comboAudio = [];
  function playCombo(btn, c) {
    const same = audition && audition.btn === btn;
    stopAudition();
    comboAudio.forEach((a) => a.pause());
    comboAudio = [];
    if (same) return;
    if (live.playing) stopLive();
    stopClipPreview();
    const n = c.ambience.length + 1;
    const mk = (id, level) => { const a = new Audio(`/beds/${id}.mp3`); a.loop = true; a.volume = Math.min(1, curve(level) / Math.sqrt(n) * 1.2); a.play().catch(() => {}); return a; };
    comboAudio = [...c.ambience.map((id) => mk(id, c.bgLevel)), mk(c.music, c.musicLevel)];
    const first = comboAudio[0];
    audition = { el: { pause: () => comboAudio.forEach((a) => a.pause()) }, btn };
    btn.innerHTML = PAUSE;
    void first;
  }

  // ---------- sound cards ----------
  function soundCard(t, on, onToggle) {
    const locked = !t.free && !state.plus;
    const el = document.createElement('div');
    el.className = 'theme' + (locked ? ' locked' : '');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-pressed', String(on));
    el.style.background = gradient(t.colors);
    el.innerHTML = `${locked ? '<span class="art-dim"></span>' : ''}${on ? '<span class="layer-no" aria-hidden="true">✓</span>' : ''}
      <div><h3></h3><p></p></div>
      <div class="row"><span class="tag">${t.free ? 'Free' : locked ? '🔒 Plus' : 'Plus'}</span>
      <button class="play" type="button" aria-label="Hear ${t.name} on its own">${PLAY}</button></div>`;
    el.querySelector('h3').textContent = t.name;
    el.querySelector('p').textContent = t.blurb;
    const btn = el.querySelector('.play');
    btn.addEventListener('click', (e) => { e.stopPropagation(); playAudition(btn, `/beds/${t.id}.mp3`); });
    const go = () => (locked ? openPlus() : onToggle());
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(); } });
    return el;
  }
  function limitMessage() {
    const max = tier().maxLayers;
    return state.plus
      ? `You can use up to ${max} sounds in total. Tap one to remove it first.`
      : `The free plan uses ${max} sounds in total (for example one background sound and one piece of music). Unlock Plus for 3.`;
  }
  function renderBackground() {
    const max = tier().maxLayers;
    const hint = $('#bgHint');
    hint.innerHTML = 'Tap to add a sound. If your recordings are added, you\'ll hear it with them straight away. ';
    if (!state.plus) {
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'upsell'; up.textContent = 'Use 3 sounds with Plus';
      up.addEventListener('click', openPlus);
      hint.appendChild(up);
    }
    const wrap = $('#bgList');
    wrap.innerHTML = '';
    config.themes.filter((t) => t.kind !== 'music').forEach((t) => {
      const on = state.ambience.includes(t.id);
      wrap.appendChild(soundCard(t, on, () => {
        if (on) state.ambience = state.ambience.filter((x) => x !== t.id);
        else if (layerCount() >= max) return showError(limitMessage());
        else state.ambience.push(t.id);
        showError('');
        renderBackground();
        mixChanged(true);
      }));
    });
  }
  function renderMusic() {
    $('#musicHint').textContent = 'Choose one piece, or none. Tap a different one to swap.';
    const wrap = $('#musicList');
    wrap.innerHTML = '';
    config.themes.filter((t) => t.kind === 'music').forEach((t) => {
      const on = state.music === t.id;
      wrap.appendChild(soundCard(t, on, () => {
        if (on) state.music = null;
        else if (!state.music && layerCount() >= tier().maxLayers) return showError(limitMessage());
        else state.music = t.id;
        showError('');
        renderMusic();
        mixChanged(true);
      }));
    });
  }

  // ---------- volume choices ----------
  function renderLevel(el, key) {
    const wrap = $(el);
    wrap.innerHTML = '';
    LEVELS.forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'len';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state[key] === v));
      const def = key === 'voiceLevel' ? 1 : 0.5;
      b.innerHTML = `${v * 100}%${v === def ? '<span class="lock">default</span>' : v === 0.25 ? '<span class="lock">very soft</span>' : ''}`;
      b.addEventListener('click', () => {
        const old = state[key];
        state[key] = v;
        applyLevels();
        if (key === 'voiceLevel' && live.ctx && live.voiceSrc) live.voice.gain.setTargetAtTime(live.voice.gain.value * curve(v) / curve(old), live.ctx.currentTime, 0.08);
        renderLevel(el, key);
        mixChanged(true);
      });
      wrap.appendChild(b);
    });
  }

  // ---------- moments ----------
  function renderMoments() {
    const wrap = $('#moments');
    wrap.innerHTML = '';
    config.moments.forEach((m) => {
      const b = document.createElement('div');
      b.className = 'len moment-opt';
      b.setAttribute('role', 'radio');
      b.setAttribute('tabindex', '0');
      b.setAttribute('aria-checked', String(state.moments === m.id));
      b.innerHTML = `<span></span>${m.variants ? `<button type="button" class="play" aria-label="Hear ${m.name}">${PLAY}</button>` : ''}`;
      b.querySelector('span').textContent = m.name;
      if (!m.variants) b.style.paddingRight = '16px';
      const choose = () => { state.moments = m.id; renderMoments(); };
      b.addEventListener('click', choose);
      b.addEventListener('keydown', (e) => { if (e.target === b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(); } });
      const p = b.querySelector('.play');
      if (p) p.addEventListener('click', (e) => {
        e.stopPropagation();
        playAudition(p, `/moments/${m.id}-${1 + Math.floor(Math.random() * m.variants)}.mp3`, { loop: false });
      });
      wrap.appendChild(b);
    });
  }

  // ---------- duration ----------
  function renderLengths() {
    const wrap = $('#lengths');
    wrap.innerHTML = '';
    LENGTHS.forEach((m) => {
      const locked = m > tier().maxMinutes;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'len' + (locked ? ' locked' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.minutes === m));
      b.innerHTML = `${m} min${locked ? '<span class="lock">🔒 Plus</span>' : ''}`;
      b.addEventListener('click', () => {
        if (locked) return openPlus();
        state.minutes = m;
        renderLengths();
      });
      wrap.appendChild(b);
    });
    renderLengthHint();
  }
  function renderLengthHint() {
    const used = state.clips.reduce((a, c) => a + (c.duration ? c.to - c.from : 0), 0);
    const room = state.minutes * 60 - 16 - Math.max(0, state.clips.length - 1) * 4;
    const hint = $('#lengthHint');
    if (state.clips.length > 1 && used > room) {
      hint.innerHTML = '<span class="warn">Your recordings add up to more than fits in this length, so some may be left out. Choose a longer duration or shorten a recording.</span>';
    } else {
      hint.textContent = state.minutes >= 5 ? 'Each recording plays clearly once, then comes back now and then as a softer echo, with long quiet stretches between.' : state.minutes >= 3 ? 'Each recording plays clearly once, and may come back once as a softer echo.' : 'Each recording plays once, with quiet music in between. Players can loop it.';
    }
  }

  // ---------- recordings ----------
  let clipPreview = null;
  function stopClipPreview() {
    if (clipPreview) { clipPreview.audio.pause(); clipPreview.btn.textContent = '▶ Play'; clipPreview = null; }
  }

  function renderClips() {
    const max = tier().maxClips;
    const full = state.clips.length >= max;
    const hint = $('#clipHint');
    hint.innerHTML = `Add up to ${max} recordings: giggles, chatter, a song, "hi Nana!". We use up to ${config.maxClipSeconds} seconds from each one. `;
    if (!state.plus) {
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'upsell'; up.textContent = 'Want more recordings? Unlock Plus';
      up.addEventListener('click', openPlus);
      hint.appendChild(up);
    }
    $('#drop').classList.toggle('disabled', full);
    $('#fileInput').disabled = full;
    $('#recordBtn').disabled = full && !recorder;

    const list = $('#clipList');
    list.innerHTML = '';
    state.clips.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'clip';
      li.style.borderLeft = `5px solid ${CLIP_COLORS[i % CLIP_COLORS.length]}`;
      li.innerHTML = `<span class="name"></span><button type="button" class="remove">Remove</button>`;
      li.querySelector('.name').textContent = c.name;
      li.querySelector('.remove').addEventListener('click', () => {
        stopClipPreview();
        if (c.url) URL.revokeObjectURL(c.url);
        state.clips.splice(i, 1);
        renderClips();
        renderLivebar();
      });
      if (c.status === 'working') {
        li.insertAdjacentHTML('beforeend', `<span class="busy">${c.isVideo ? 'Taking the sound from your video…' : 'Reading the recording…'}</span>`);
      } else if (c.duration) {
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `${c.isVideo ? 'Sound from video · ' : ''}${fmt(c.duration)} long`;
        li.appendChild(meta);
        let partLabel;
        const part = document.createElement('div');
        part.className = 'part';
        part.innerHTML = '<button type="button" class="btn ghost">▶ Play</button><span class="muted small"></span>';
        partLabel = part.querySelector('span');
        partLabel.textContent = c.duration > config.maxClipSeconds ? `We'll use the first ${config.maxClipSeconds} seconds` : '';
        const pb = part.querySelector('button');
        pb.addEventListener('click', () => {
          if (clipPreview && clipPreview.btn === pb) return stopClipPreview();
          stopClipPreview(); stopAudition();
          if (live.playing) stopLive();
          const audio = new Audio(c.url);
          clipPreview = { audio, btn: pb };
          pb.textContent = '■ Stop';
          audio.addEventListener('loadedmetadata', () => { audio.currentTime = c.from; audio.play().catch(() => {}); }, { once: true });
          audio.addEventListener('timeupdate', () => { if (audio.currentTime >= c.to) stopClipPreview(); });
          audio.addEventListener('ended', stopClipPreview);
        });
        li.appendChild(part);
        if (c.note) li.insertAdjacentHTML('beforeend', `<span class="meta">${c.note}</span>`);
      }
      list.appendChild(li);
    });
    renderLengthHint();
  }

  // Decode in the browser where we can: it lets us play the recording in the
  // live mix, and for videos we only upload the few seconds of sound needed.
  let decodeCtx;
  async function decodeToMono(file) {
    decodeCtx = decodeCtx || new (window.AudioContext || window.webkitAudioContext)();
    const buf = await file.arrayBuffer();
    const decoded = await new Promise((res, rej) => {
      const p = decodeCtx.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
    const rate = 22050;
    const len = Math.ceil(decoded.duration * rate);
    const off = new OfflineAudioContext(1, len, rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return { pcm: rendered.getChannelData(0), rate, buffer: rendered };
  }
  function wavBlob(pcm, rate, from = 0, to = pcm.length / rate) {
    const a = Math.floor(from * rate);
    const b = Math.min(pcm.length, Math.ceil(to * rate));
    const n = Math.max(0, b - a);
    const view = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, s) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
    w(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    w(36, 'data'); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[a + i])) * 32767, true);
    return new Blob([view], { type: 'audio/wav' });
  }
  function mediaDuration(url) {
    return new Promise((res) => {
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => res(isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => res(0);
      a.src = url;
    });
  }
  // even out quiet and loud recordings in the live mix, like the final mix does
  function loudnessGain(pcm) {
    let sum = 0, n = 0;
    for (let i = 0; i < pcm.length; i += 7) { const v = pcm[i]; if (Math.abs(v) > 0.01) { sum += v * v; n++; } }
    const rms = Math.sqrt(sum / Math.max(1, n)) || 0.1;
    return Math.max(0.3, Math.min(6, 0.12 / rms));
  }

  async function prepareClip(c) {
    try {
      if (c.file.size > 600 * 1024 * 1024) throw new Error('too big');
      const { pcm, rate, buffer } = await decodeToMono(c.file);
      c.pcm = pcm; c.rate = rate; c.buffer = buffer;
      c.duration = pcm.length / rate;
      c.previewGain = loudnessGain(pcm);
      c.url = URL.createObjectURL(wavBlob(pcm, rate, 0, Math.min(c.duration, 600)));
    } catch {
      // Fall back to uploading the original file; the server pulls out the sound.
      if (c.file.size > 250 * 1024 * 1024) {
        state.clips.splice(state.clips.indexOf(c), 1);
        showError(`"${c.name}" is too large to use. Trim the video on your phone first, then add it again.`);
        return renderClips();
      }
      if (!c.url) c.url = URL.createObjectURL(c.file);
      c.duration = c.duration || (await mediaDuration(c.url)) || 30;
      c.note = 'This one won\'t play in the live mix, but it will be in your soundscape.';
    }
    c.from = 0;
    c.to = Math.min(c.duration, config.maxClipSeconds);
    c.status = 'ready';
    renderClips();
    renderLivebar();
  }

  function addFiles(files) {
    const max = tier().maxClips;
    let skipped = 0;
    for (const f of files) {
      if (state.clips.length >= max) { skipped++; continue; }
      const isVideo = f.type.startsWith('video/') || (/\.(mp4|mov|m4v|3gp|webm)$/i.test(f.name) && !f.type.startsWith('audio/'));
      const c = { file: f, name: f.name.replace(/\.[a-z0-9]{2,4}$/i, ''), isVideo, status: 'working' };
      state.clips.push(c);
      prepareClip(c);
    }
    if (skipped) showError(state.plus ? `You can add up to ${max} recordings.` : `The free plan includes ${max} recordings. Unlock Plus to add more.`);
    renderClips();
  }

  const drop = $('#drop');
  $('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  // ---------- in-browser recording ----------
  let recorder = null;
  let recordTimer = null;
  $('#recordBtn').addEventListener('click', async () => {
    const btn = $('#recordBtn');
    const status = $('#recordStatus');
    if (recorder) { recorder.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { status.textContent = 'Recording isn\'t supported in this browser. Upload a file instead.'; return; }
    try {
      if (live.playing) stopLive();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recordTimer);
        const type = recorder.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const n = state.clips.filter((c) => c.name.startsWith('Recording')).length + 1;
        addFiles([new File(chunks, `Recording ${n}.${ext}`, { type: type.replace('video/', 'audio/') })]);
        recorder = null;
        btn.textContent = '● Record a clip';
        btn.classList.remove('recording');
        status.textContent = '';
      };
      recorder.start();
      const t0 = Date.now();
      btn.textContent = '■ Stop recording';
      btn.classList.add('recording');
      recordTimer = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        status.textContent = `Recording… ${s}s`;
        if (s >= config.maxClipSeconds) recorder && recorder.stop();
      }, 250);
    } catch {
      status.textContent = 'Microphone access was blocked.';
    }
  });

  // ---------- plus (placeholder) ----------
  const dialog = $('#plusDialog');
  function openPlus() { if (!state.plus) dialog.showModal(); }
  // demo: clicking the pill while on Plus switches back to free
  $('#plusPill').addEventListener('click', () => (state.plus ? setPlus(false) : openPlus()));
  dialog.addEventListener('close', () => { if (dialog.returnValue === 'unlock') setPlus(true); });
  function setPlus(on) {
    state.plus = on;
    try { localStorage.setItem('le-plus', on ? '1' : '0'); } catch {}
    const pill = $('#plusPill');
    pill.classList.toggle('on', on);
    pill.innerHTML = on ? 'Plus (demo) · <u>switch to free</u>' : 'Free plan · <u>Unlock Plus</u>';
    // keep choices valid for the tier
    if (!on) {
      state.ambience = state.ambience.filter((id) => themeById(id).free);
      if (state.music && !themeById(state.music).free) state.music = null;
    }
    while (layerCount() > tier().maxLayers) state.ambience.pop();
    if (state.minutes > tier().maxMinutes) state.minutes = tier().maxMinutes;
    while (state.clips.length > tier().maxClips) { const c = state.clips.pop(); if (c.url) URL.revokeObjectURL(c.url); }
    renderAll();
    syncBedsIfReady();
  }

  function renderAll() {
    renderCombos();
    renderClips();
    renderBackground();
    renderMoments();
    renderLevel('#voiceLevel', 'voiceLevel');
    renderLevel('#bgLevel', 'bgLevel');
    renderMusic();
    renderLevel('#musicLevel', 'musicLevel');
    renderLengths();
    renderLivebar();
  }

  // ---------- submit ----------
  function showError(msg) { $('#formError').textContent = msg || ''; }

  $('#create').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    if (!state.clips.length) return showError('Add at least one recording (step 1).');
    if (!layerCount()) return showError('Add at least one background sound or piece of music.');
    if (state.clips.some((c) => c.status !== 'ready')) return showError('Hang on, still reading a recording…');
    if (!$('#consent').checked) return showError('Please tick the permission box.');

    const layers = [
      ...state.ambience.map((id) => ({ id, volume: curve(state.bgLevel) })),
      ...(state.music ? [{ id: state.music, volume: curve(state.musicLevel) }] : []),
    ];
    const fd = new FormData();
    fd.append('layers', JSON.stringify(layers));
    fd.append('bedLevel', '1'); // volumes are already in each layer
    fd.append('voiceLevel', String(state.voiceLevel));
    fd.append('moments', state.moments);
    fd.append('minutes', String(state.minutes));
    fd.append('title', $('#title').value.trim());
    fd.append('consent', '1');
    fd.append('plus', state.plus ? '1' : '0');
    const info = [];
    state.clips.forEach((c) => {
      if (c.pcm) {
        // already decoded: send just the chosen part as a small WAV
        fd.append('clips', new File([wavBlob(c.pcm, c.rate, c.from, c.to)], `${c.name}.wav`, { type: 'audio/wav' }));
        info.push({ name: c.name });
      } else {
        fd.append('clips', c.file, c.file.name);
        info.push({ name: c.name, from: c.from, to: c.to });
      }
    });
    fd.append('clipInfo', JSON.stringify(info));

    stopLive(); stopAudition(); stopClipPreview();
    $('#working').hidden = false;
    $('#submitBtn').disabled = true;
    try {
      const res = await fetch('/api/soundscapes', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({ error: res.status === 413 ? 'That upload is too large.' : 'Something went wrong. Please try again.' }));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      showResult(data);
    } catch (err) {
      showError(err.message);
    } finally {
      $('#working').hidden = true;
      $('#submitBtn').disabled = false;
    }
  });

  // ---------- timeline ----------
  function renderTimeline(d) {
    const tl = d.timeline;
    const box = $('#timeline');
    box.innerHTML = '';
    if (!tl) { box.hidden = true; return; }
    box.hidden = false;
    const pct = (s) => `${(s / tl.total) * 100}%`;
    const row = (label, fill) => {
      const r = document.createElement('div');
      r.className = 'tl-row';
      r.innerHTML = '<span class="tl-label"></span><div class="tl-track"></div>';
      r.querySelector('.tl-label').textContent = label;
      r.querySelector('.tl-label').title = label;
      fill(r.querySelector('.tl-track'));
      box.appendChild(r);
    };
    const names = [...new Set(tl.voices.map((v) => v.clip))].sort((a, b) => a - b);
    names.forEach((ci) => {
      const voices = tl.voices.filter((v) => v.clip === ci);
      row(voices[0].name, (track) => voices.forEach((v) => {
        const b = document.createElement('div');
        b.className = 'tl-block';
        b.style.left = pct(v.start);
        b.style.width = pct(v.dur);
        b.style.background = CLIP_COLORS[ci % CLIP_COLORS.length];
        if (v.echo) b.style.opacity = '0.45';
        b.title = `${v.name} at ${fmt(v.start)}${v.echo ? ' (soft echo)' : ''}`;
        track.appendChild(b);
      }));
    });
    (d.layers || []).forEach((l, k) => {
      const t = themeById(l.id);
      const info = tl.layers[k] || { fadeStart: 0, fadeLen: 4 };
      row(t.name, (track) => {
        const b = document.createElement('div');
        b.className = 'tl-block';
        b.style.left = pct(info.fadeStart);
        b.style.right = '0';
        b.style.background = `linear-gradient(90deg, transparent, ${t.colors[0]} ${(info.fadeLen / (tl.total - info.fadeStart)) * 100}%, ${t.colors[0]} 96%, transparent)`;
        b.style.opacity = String(0.35 + 0.65 * Math.min(1, l.volume));
        track.appendChild(b);
      });
    });
    if (tl.moments.length) {
      const m = config.moments.find((x) => x.id === d.moments);
      row(m ? m.name : 'Moments', (track) => tl.moments.forEach((mo) => {
        const dot = document.createElement('div');
        dot.className = 'tl-dot';
        dot.style.left = pct(mo.start);
        dot.title = fmt(mo.start);
        track.appendChild(dot);
      }));
    }
    const axis = document.createElement('div');
    axis.className = 'tl-row';
    axis.innerHTML = '<span></span><div class="tl-axis"></div>';
    const step = tl.total <= 180 ? 30 : tl.total <= 600 ? 60 : 180;
    for (let s = 0; s <= tl.total; s += step) axis.querySelector('.tl-axis').insertAdjacentHTML('beforeend', `<span style="left:${pct(s)}">${fmt(s)}</span>`);
    box.appendChild(axis);
    if (tl.unused > 0) box.insertAdjacentHTML('beforeend', `<p class="warn small" style="margin:4px 0 0">${tl.unused} recording${tl.unused > 1 ? 's' : ''} didn't fit in this length. Make a longer one to include ${tl.unused > 1 ? 'them' : 'it'}.</p>`);

    const tracks = [...box.querySelectorAll('.tl-track')];
    const heads = tracks.map((t) => { const h = document.createElement('div'); h.className = 'tl-head'; h.style.left = '0'; t.appendChild(h); return h; });
    const audio = $('#resultAudio');
    audio.ontimeupdate = () => heads.forEach((h) => (h.style.left = pct(audio.currentTime)));
  }

  function showResult(d) {
    $('#create').hidden = true;
    $('#combos').hidden = true;
    $('#result').hidden = false;
    renderLivebar();
    const theme = themeById(d.theme);
    $('#resultCard').style.borderTop = `8px solid ${theme.colors[0]}`;
    $('#resultTitle').textContent = d.title;
    $('#resultAudio').src = d.audioUrl;
    $('#downloadLink').href = d.downloadUrl;
    $('#openLink').href = d.listenUrl;
    $('#shareUrl').value = d.listenUrl;
    $('#shareBtn').hidden = !navigator.share;
    $('#shareBtn').onclick = () => navigator.share({ title: d.title, text: 'A little soundscape for you', url: d.listenUrl }).catch(() => {});
    renderTimeline(d);
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#copyBtn').addEventListener('click', async () => {
    const input = $('#shareUrl');
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
    $('#copyBtn').textContent = 'Copied';
    setTimeout(() => ($('#copyBtn').textContent = 'Copy'), 1500);
  });

  $('#againBtn').addEventListener('click', () => {
    $('#resultAudio').pause();
    $('#result').hidden = true;
    $('#create').hidden = false;
    $('#combos').hidden = false;
    state.clips.forEach((c) => c.url && URL.revokeObjectURL(c.url));
    state.clips = [];
    $('#title').value = '';
    renderClips();
    renderLivebar();
    $('#create').scrollIntoView({ behavior: 'smooth' });
  });

  // ---------- boot ----------
  fetch('/api/config').then((r) => r.json()).then((c) => {
    config = c;
    setPlus(state.plus);
  });
})();
