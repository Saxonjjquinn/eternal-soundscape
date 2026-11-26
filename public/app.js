(() => {
  const $ = (s) => document.querySelector(s);
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
  const LENGTHS = [1, 2, 3, 5, 10, 15];
  const CLIP_COLORS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2a541', '#9b72cf', '#d1495b', '#2a9d8f', '#c08552'];
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  let config;
  const state = { layers: [], moments: 'none', minutes: 2, clips: [], plus: false };
  try { state.plus = localStorage.getItem('le-plus') === '1'; } catch {}
  const tier = () => config.tiers[state.plus ? 'plus' : 'free'];
  const themeById = (id) => config.themes.find((t) => t.id === id);

  // ---------- previews: one sound at a time, or the whole selected mix ----------
  const previews = [];
  let previewOwner = null; // the button currently showing "pause"
  function stopPreviews() {
    previews.splice(0).forEach((a) => { a.pause(); a.src = ''; });
    if (previewOwner) previewOwner.innerHTML = previewOwner.dataset.label || PLAY;
    previewOwner = null;
  }
  function playPreview(btn, sources, { loop = true } = {}) {
    const same = previewOwner === btn;
    stopPreviews();
    if (same) return;
    stopClipPreview();
    sources.forEach(({ src, volume = 1 }) => {
      const a = new Audio(src);
      a.loop = loop;
      a.volume = volume;
      a.play().catch(() => {});
      if (!loop) a.addEventListener('ended', () => { if (previewOwner === btn) stopPreviews(); });
      previews.push(a);
    });
    previewOwner = btn;
    btn.innerHTML = btn.dataset.label ? btn.dataset.label.replace('▶', '■').replace('Hear them together', 'Stop') : PAUSE;
  }

  const gradient = (c) => `linear-gradient(135deg, ${c[0]}, ${c[1]})`;

  // ---------- examples ----------
  function renderExamples() {
    const list = $('#examplesList');
    list.innerHTML = '';
    let items = config.examples;
    if (!items.length) {
      $('#examplesNote').textContent = 'Here is the ambience of each free sound. Your children\'s voices drift in and out over the top, and the ambience softens while they speak.';
      items = config.themes.filter((t) => t.free).map((t) => ({ title: t.name, subtitle: 'Ambience only', theme: t.id, src: `/beds/${t.id}.mp3` }));
    } else {
      $('#examplesNote').textContent = 'Real soundscapes made with Little Echoes (shared with permission).';
    }
    items.forEach((ex) => {
      const t = themeById(ex.theme) || config.themes[0];
      const el = document.createElement('div');
      el.className = 'example';
      el.innerHTML = `<div class="art" style="background:${gradient(t.colors)}"></div><div style="flex:1;min-width:0"><h3></h3><p class="muted small"></p></div><button class="play" type="button" aria-label="Play">${PLAY}</button>`;
      el.querySelector('h3').textContent = ex.title;
      el.querySelector('p').textContent = ex.subtitle || t.name;
      const btn = el.querySelector('.play');
      btn.addEventListener('click', () => playPreview(btn, [{ src: ex.src }]));
      list.appendChild(el);
    });
  }

  // ---------- sounds (layers) ----------
  function renderThemes() {
    const max = tier().maxLayers;
    $('#layerHint').innerHTML = `Pick up to ${max} sounds to layer together. They drift in one at a time, and you can set how loud each one is. `;
    if (!state.plus) {
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'upsell'; up.textContent = 'Layer 3 sounds with Plus';
      up.addEventListener('click', openPlus);
      $('#layerHint').appendChild(up);
    }
    const wrap = $('#themes');
    wrap.innerHTML = '';
    config.themes.forEach((t) => {
      const locked = !t.free && !state.plus;
      const idx = state.layers.findIndex((l) => l.id === t.id);
      const on = idx >= 0;
      const el = document.createElement('div');
      el.className = 'theme' + (locked ? ' locked' : '');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-pressed', String(on));
      el.style.background = gradient(t.colors);
      el.innerHTML = `${locked ? '<span class="art-dim"></span>' : ''}${on ? `<span class="layer-no" aria-label="Layer ${idx + 1}">${idx + 1}</span>` : ''}
        <div><h3></h3><p></p></div>
        ${on ? `<label class="vol">Volume <input type="range" min="10" max="100" step="5" value="${Math.round(state.layers[idx].volume * 100)}" aria-label="${t.name} volume"></label>` : ''}
        <div class="row"><span class="tag">${t.free ? 'Free' : locked ? '🔒 Plus' : 'Plus'}</span>
        <button class="play" type="button" aria-label="Preview ${t.name}">${PLAY}</button></div>`;
      el.querySelector('h3').textContent = t.name;
      el.querySelector('p').textContent = t.blurb;
      const btn = el.querySelector('.play');
      btn.addEventListener('click', (e) => { e.stopPropagation(); playPreview(btn, [{ src: `/beds/${t.id}.mp3` }]); });
      const slider = el.querySelector('.vol input');
      if (slider) {
        ['click', 'keydown', 'pointerdown'].forEach((ev) => el.querySelector('.vol').addEventListener(ev, (e) => e.stopPropagation()));
        slider.addEventListener('input', () => {
          state.layers[idx].volume = slider.value / 100;
          if (previewOwner === $('#previewMix')) previews.forEach((a, k) => (a.volume = state.layers[k] ? state.layers[k].volume : a.volume));
          renderMixbar();
        });
      }
      const toggle = () => {
        if (locked) return openPlus();
        if (on) state.layers.splice(idx, 1);
        else if (state.layers.length >= max) {
          if (max === 1) state.layers = [];
          else return showError(state.plus ? `You can layer up to ${max} sounds. Tap one to remove it first.` : `The free plan layers ${max} sounds. Tap one to remove it, or unlock Plus for 3.`);
        }
        if (!on) state.layers.push({ id: t.id, volume: state.layers.length ? 0.6 : 0.85 });
        showError('');
        if (previewOwner === $('#previewMix')) stopPreviews();
        renderThemes();
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } });
      wrap.appendChild(el);
    });
    renderMixbar();
  }

  function renderMixbar() {
    const bar = $('#mixbar');
    bar.hidden = state.layers.length < 2;
    $('#mixSummary').textContent = state.layers.map((l) => `${themeById(l.id).name} ${Math.round(l.volume * 100)}%`).join(' + ');
  }
  const mixBtn = $('#previewMix');
  mixBtn.dataset.label = '▶ Hear them together';
  mixBtn.addEventListener('click', () => playPreview(mixBtn, state.layers.map((l) => ({ src: `/beds/${l.id}.mp3`, volume: l.volume }))));

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
        const v = 1 + Math.floor(Math.random() * m.variants);
        playPreview(p, [{ src: `/moments/${m.id}-${v}.mp3` }], { loop: false });
      });
      wrap.appendChild(b);
    });
  }

  // ---------- lengths ----------
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
      hint.innerHTML = '<span class="warn">Your recordings add up to more than fits in this length, so some may be left out. Choose a longer length or shorten a recording.</span>';
    } else {
      hint.textContent = 'Players can loop it, so even a short soundscape can play all afternoon.';
    }
  }

  // ---------- recordings ----------
  let clipPreview = null;
  function stopClipPreview() {
    if (clipPreview) { clipPreview.audio.pause(); clipPreview.btn.textContent = '▶ Play this part'; clipPreview = null; }
  }

  function renderClips() {
    const max = tier().maxClips;
    const full = state.clips.length >= max;
    const hint = $('#clipHint');
    hint.innerHTML = `Add up to ${max} recordings: giggles, chatter, a song, "hi Nana!". We use up to ${config.maxClipSeconds} seconds from each one, and you choose which part. `;
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
      });
      if (c.status === 'working') {
        li.insertAdjacentHTML('beforeend', `<span class="busy">${c.isVideo ? 'Taking the sound from your video…' : 'Reading the recording…'}</span>`);
      } else if (c.duration) {
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `${c.isVideo ? 'Sound from video · ' : ''}${fmt(c.duration)} long`;
        li.appendChild(meta);
        if (c.duration > 3) {
          const trim = document.createElement('div');
          trim.className = 'trim';
          trim.innerHTML = `<span>Start</span><input type="range" step="0.5" min="0" max="${c.duration.toFixed(1)}" value="${c.from}" aria-label="Start of the part to use"><output>${fmt(c.from)}</output>
            <span>End</span><input type="range" step="0.5" min="0" max="${c.duration.toFixed(1)}" value="${c.to}" aria-label="End of the part to use"><output>${fmt(c.to)}</output>`;
          const [s, e] = trim.querySelectorAll('input');
          const [so, eo] = trim.querySelectorAll('output');
          const limit = config.maxClipSeconds;
          const sync = (moved) => {
            let a = Number(s.value), b = Number(e.value);
            if (b - a < 1) { if (moved === s) a = Math.max(0, b - 1); else b = Math.min(c.duration, a + 1); }
            if (b - a > limit) { if (moved === s) b = a + limit; else a = b - limit; }
            c.from = a; c.to = b; s.value = a; e.value = b;
            so.textContent = fmt(a); eo.textContent = fmt(b);
            partLabel.textContent = `Using ${fmt(b - a)}`;
            renderLengthHint();
          };
          s.addEventListener('input', () => sync(s));
          e.addEventListener('input', () => sync(e));
          li.appendChild(trim);
        }
        const part = document.createElement('div');
        part.className = 'part';
        part.innerHTML = '<button type="button" class="btn ghost">▶ Play this part</button><span class="muted small"></span>';
        const partLabel = part.querySelector('span');
        partLabel.textContent = `Using ${fmt(c.to - c.from)}`;
        const pb = part.querySelector('button');
        pb.addEventListener('click', () => {
          if (clipPreview && clipPreview.btn === pb) return stopClipPreview();
          stopClipPreview(); stopPreviews();
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

  // Decode in the browser where we can: works for most phone videos, so we
  // only upload the few seconds of sound that are needed, not the whole video.
  let audioCtx;
  async function decodeToMono(file) {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const buf = await file.arrayBuffer();
    const decoded = await new Promise((res, rej) => {
      const p = audioCtx.decodeAudioData(buf, res, rej);
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
    return { pcm: rendered.getChannelData(0), rate };
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

  async function prepareClip(c) {
    const big = c.file.size > 20 * 1024 * 1024;
    try {
      if (c.isVideo || big) {
        if (c.file.size > 600 * 1024 * 1024) throw new Error('too big');
        const { pcm, rate } = await decodeToMono(c.file);
        c.pcm = pcm; c.rate = rate;
        c.duration = pcm.length / rate;
        c.url = URL.createObjectURL(wavBlob(pcm, rate, 0, Math.min(c.duration, 600)));
      } else {
        c.url = URL.createObjectURL(c.file);
        c.duration = await mediaDuration(c.url);
        if (!c.duration) throw new Error('no duration');
      }
    } catch {
      // Fall back to uploading the original file; the server pulls out the sound.
      if (c.file.size > 250 * 1024 * 1024) {
        state.clips.splice(state.clips.indexOf(c), 1);
        showError(`"${c.name}" is too large to use. Trim the video on your phone first, then add it again.`);
        return renderClips();
      }
      if (!c.url) c.url = URL.createObjectURL(c.file);
      c.duration = c.duration || (await mediaDuration(c.url)) || 30;
      c.note = 'We\'ll take the sound out of this one after you press Create.';
    }
    c.from = 0;
    c.to = Math.min(c.duration, config.maxClipSeconds);
    c.status = 'ready';
    renderClips();
  }

  function addFiles(files) {
    const max = tier().maxClips;
    let skipped = 0;
    for (const f of files) {
      if (state.clips.length >= max) { skipped++; continue; }
      const isVideo = f.type.startsWith('video/') || /\.(mp4|mov|m4v|3gp|webm)$/i.test(f.name) && !f.type.startsWith('audio/');
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
    if (!on) state.layers = state.layers.filter((l) => themeById(l.id).free);
    state.layers = state.layers.slice(0, tier().maxLayers);
    if (!state.layers.length) state.layers = [{ id: config.themes.find((t) => t.free).id, volume: 0.85 }];
    if (state.minutes > tier().maxMinutes) state.minutes = tier().maxMinutes;
    while (state.clips.length > tier().maxClips) { const c = state.clips.pop(); if (c.url) URL.revokeObjectURL(c.url); }
    renderThemes(); renderLengths(); renderClips();
  }

  // ---------- submit ----------
  function showError(msg) { $('#formError').textContent = msg || ''; }

  $('#create').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    if (!state.layers.length) return showError('Pick at least one sound.');
    if (!state.clips.length) return showError('Add at least one recording.');
    if (state.clips.some((c) => c.status !== 'ready')) return showError('Hang on, still reading a recording…');
    if (!$('#consent').checked) return showError('Please tick the permission box.');

    const fd = new FormData();
    fd.append('layers', JSON.stringify(state.layers));
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

    stopPreviews(); stopClipPreview();
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
      return r;
    };
    (d.layers || []).forEach((l, k) => {
      const t = themeById(l.id);
      const info = tl.layers[k] || { fadeStart: 0, fadeLen: 4 };
      row(t.name, (track) => {
        const b = document.createElement('div');
        b.className = 'tl-block';
        b.style.left = pct(info.fadeStart);
        b.style.right = '0';
        b.style.background = `linear-gradient(90deg, transparent, ${t.colors[0]} ${(info.fadeLen / (tl.total - info.fadeStart)) * 100}%, ${t.colors[0]} 96%, transparent)`;
        b.style.opacity = String(0.35 + 0.65 * l.volume);
        track.appendChild(b);
      });
    });
    const names = [...new Set(tl.voices.map((v) => v.clip))].sort((a, b) => a - b);
    names.forEach((ci) => {
      const voices = tl.voices.filter((v) => v.clip === ci);
      row(voices[0].name, (track) => voices.forEach((v) => {
        const b = document.createElement('div');
        b.className = 'tl-block';
        b.style.left = pct(v.start);
        b.style.width = pct(v.dur);
        b.style.background = CLIP_COLORS[ci % CLIP_COLORS.length];
        b.title = `${v.name} at ${fmt(v.start)}`;
        track.appendChild(b);
      }));
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

    // playhead that follows the audio
    const tracks = [...box.querySelectorAll('.tl-track')];
    const heads = tracks.map((t) => { const h = document.createElement('div'); h.className = 'tl-head'; h.style.left = '0'; t.appendChild(h); return h; });
    const audio = $('#resultAudio');
    audio.ontimeupdate = () => heads.forEach((h) => (h.style.left = pct(audio.currentTime)));
  }

  function showResult(d) {
    $('#create').hidden = true;
    $('#result').hidden = false;
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
    state.clips.forEach((c) => c.url && URL.revokeObjectURL(c.url));
    state.clips = [];
    $('#title').value = '';
    renderClips();
    $('#create').scrollIntoView({ behavior: 'smooth' });
  });

  // ---------- boot ----------
  fetch('/api/config').then((r) => r.json()).then((c) => {
    config = c;
    setPlus(state.plus);
    renderMoments();
    renderExamples();
  });
})();
