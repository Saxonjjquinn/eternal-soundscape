(() => {
  const $ = (s) => document.querySelector(s);
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
  const LENGTHS = [1, 2, 3, 5, 10, 15];

  let config;
  const state = { theme: null, minutes: 2, clips: [], plus: false };
  try { state.plus = localStorage.getItem('le-plus') === '1'; } catch {}
  const tier = () => config.tiers[state.plus ? 'plus' : 'free'];

  // ---------- one shared preview player ----------
  const preview = new Audio();
  preview.loop = true;
  let previewBtn = null;
  function togglePreview(btn, src) {
    if (previewBtn === btn && !preview.paused) { preview.pause(); return; }
    if (previewBtn) previewBtn.innerHTML = PLAY;
    previewBtn = btn;
    if (!preview.src.endsWith(src)) preview.src = src;
    preview.play().catch(() => {});
    btn.innerHTML = PAUSE;
  }
  preview.addEventListener('pause', () => { if (previewBtn) previewBtn.innerHTML = PLAY; });
  preview.addEventListener('play', () => { if (previewBtn) previewBtn.innerHTML = PAUSE; });

  const gradient = (c) => `linear-gradient(135deg, ${c[0]}, ${c[1]})`;

  // ---------- examples ----------
  function renderExamples() {
    const list = $('#examplesList');
    list.innerHTML = '';
    let items = config.examples;
    if (!items.length) {
      // No real example mixes yet, so offer the ambience of each free theme.
      $('#examplesNote').textContent = 'Here is the ambience of each free theme. Your children\'s voices drift in and out over the top, and the ambience softens while they speak.';
      items = config.themes.filter((t) => t.free).map((t) => ({ title: t.name, subtitle: 'Ambience only', theme: t.id, src: `/beds/${t.id}.mp3` }));
    } else {
      $('#examplesNote').textContent = 'Real soundscapes made with Little Echoes (shared with permission).';
    }
    items.forEach((ex) => {
      const t = config.themes.find((x) => x.id === ex.theme) || config.themes[0];
      const el = document.createElement('div');
      el.className = 'example';
      el.innerHTML = `<div class="art" style="background:${gradient(t.colors)}"></div><div style="flex:1;min-width:0"><h3></h3><p class="muted small"></p></div><button class="play" type="button" aria-label="Play">${PLAY}</button>`;
      el.querySelector('h3').textContent = ex.title;
      el.querySelector('p').textContent = ex.subtitle || t.name;
      const btn = el.querySelector('.play');
      btn.addEventListener('click', () => togglePreview(btn, ex.src));
      list.appendChild(el);
    });
  }

  // ---------- themes ----------
  function renderThemes() {
    const wrap = $('#themes');
    wrap.innerHTML = '';
    config.themes.forEach((t) => {
      const locked = !t.free && !state.plus;
      const el = document.createElement('div');
      el.className = 'theme' + (locked ? ' locked' : '');
      el.setAttribute('role', 'radio');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-checked', String(state.theme === t.id));
      el.style.background = gradient(t.colors);
      el.innerHTML = `${locked ? '<span class="art-dim"></span>' : ''}<div><h3></h3><p></p></div>
        <div class="row"><span class="tag">${t.free ? 'Free' : locked ? '🔒 Plus' : 'Plus'}</span>
        <button class="play" type="button" aria-label="Preview ${t.name}">${PLAY}</button></div>`;
      el.querySelector('h3').textContent = t.name;
      el.querySelector('p').textContent = t.blurb;
      const btn = el.querySelector('.play');
      btn.addEventListener('click', (e) => { e.stopPropagation(); togglePreview(btn, `/beds/${t.id}.mp3`); });
      const choose = () => {
        if (locked) return openPlus();
        state.theme = t.id;
        renderThemes();
      };
      el.addEventListener('click', choose);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
      wrap.appendChild(el);
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
  }

  // ---------- clips ----------
  function renderClips() {
    const max = tier().maxClips;
    const full = state.clips.length >= max;
    const hint = $('#clipHint');
    hint.innerHTML = `Add up to ${max} short recordings (giggles, chatter, a song, "hi Nana!"). Around 5 to 30 seconds each works best. `;
    if (!state.plus) {
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'upsell'; up.textContent = 'Want more clips? Unlock Plus';
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
      li.innerHTML = `<span class="name"></span><button type="button" class="remove">Remove</button><audio controls preload="metadata"></audio>`;
      li.querySelector('.name').textContent = c.name;
      li.querySelector('audio').src = c.url;
      li.querySelector('.remove').addEventListener('click', () => {
        URL.revokeObjectURL(c.url);
        state.clips.splice(i, 1);
        renderClips();
      });
      list.appendChild(li);
    });
  }

  function addFiles(files) {
    const max = tier().maxClips;
    let skipped = 0;
    for (const f of files) {
      if (state.clips.length >= max) { skipped++; continue; }
      if (f.size > 60 * 1024 * 1024) { showError(`"${f.name}" is over 60 MB.`); continue; }
      state.clips.push({ file: f, name: f.name, url: URL.createObjectURL(f) });
    }
    if (skipped) showError(state.plus ? `You can add up to ${max} clips.` : `The free plan includes ${max} clips. Unlock Plus to add more.`);
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
        addFiles([new File(chunks, `Recording ${n}.${ext}`, { type })]);
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
        if (s >= 60) recorder && recorder.stop();
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
    const th = config.themes.find((t) => t.id === state.theme);
    if (!on && th && !th.free) state.theme = config.themes.find((t) => t.free).id;
    if (state.minutes > tier().maxMinutes) state.minutes = tier().maxMinutes;
    while (state.clips.length > tier().maxClips) URL.revokeObjectURL(state.clips.pop().url);
    renderThemes(); renderLengths(); renderClips();
  }

  // ---------- submit ----------
  function showError(msg) { $('#formError').textContent = msg || ''; }

  $('#create').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    if (!state.theme) return showError('Pick a theme first.');
    if (!state.clips.length) return showError('Add at least one voice clip.');
    if (!$('#consent').checked) return showError('Please tick the permission box.');

    const fd = new FormData();
    fd.append('theme', state.theme);
    fd.append('minutes', String(state.minutes));
    fd.append('title', $('#title').value.trim());
    fd.append('consent', '1');
    fd.append('plus', state.plus ? '1' : '0');
    state.clips.forEach((c) => fd.append('clips', c.file, c.name));

    preview.pause();
    $('#working').hidden = false;
    $('#submitBtn').disabled = true;
    try {
      const res = await fetch('/api/soundscapes', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({ error: 'Something went wrong. Please try again.' }));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      showResult(data);
    } catch (err) {
      showError(err.message);
    } finally {
      $('#working').hidden = true;
      $('#submitBtn').disabled = false;
    }
  });

  function showResult(d) {
    $('#create').hidden = true;
    $('#result').hidden = false;
    const theme = config.themes.find((t) => t.id === d.theme);
    $('#resultCard').style.borderTop = `8px solid ${theme.colors[0]}`;
    $('#resultTitle').textContent = d.title;
    $('#resultAudio').src = d.audioUrl;
    $('#downloadLink').href = d.downloadUrl;
    $('#openLink').href = d.listenUrl;
    $('#shareUrl').value = d.listenUrl;
    $('#shareBtn').hidden = !navigator.share;
    $('#shareBtn').onclick = () => navigator.share({ title: d.title, text: 'A little soundscape for you', url: d.listenUrl }).catch(() => {});
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
    state.clips.forEach((c) => URL.revokeObjectURL(c.url));
    state.clips = [];
    $('#title').value = '';
    renderClips();
    $('#create').scrollIntoView({ behavior: 'smooth' });
  });

  // ---------- boot ----------
  fetch('/api/config').then((r) => r.json()).then((c) => {
    config = c;
    state.theme = config.themes.find((t) => t.free).id;
    setPlus(state.plus);
    renderExamples();
  });
})();
