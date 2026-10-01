(function () {
  'use strict';
  const A = window.CatArt;
  const api = window.chonky;
  const $ = (id) => document.getElementById(id);
  let s = null;

  const BOOL = ['roam', 'randomAnimations', 'cursorPlay', 'seasonal', 'showStatusLine', 'sounds', 'speakSummaries', 'pawApproval', 'dangerGuard', 'autoStart', 'dnd', 'desktopAwareness', 'perchOnWindows', 'runToWindow', 'breakGuardian', 'launchAtLogin'];
  const NUM = ['size', 'fps', 'volume', 'animationFrequency', 'pawApprovalTimeout', 'breakMinutes'];
  const TEXT = ['name', 'hotkey', 'voice'];

  const PREVIEWS = [
    ['hello', '👋 Hello'], ['session-start', '🌅 New session'], ['prompt', '💭 Prompt'], ['git-commit', '📦 Commit'], ['git-push', '🚀 Push'],
    ['tests-pass', '✅ Tests pass'], ['tests-fail', '☕ Tests fail'], ['danger', '🙀 Danger'], ['needs', '🙋 Needs you'], ['done', '🐟 Done'],
    ['compact-start', '🍽️ Compacting'], ['compact-end', '💨 Burp'], ['kitten-spawn', '🐱 Kitten'], ['break-time', '🧘 Break'], ['cafe-visit', '☕ Café visit'],
  ];

  function saved() {
    const el = $('saved');
    el.classList.add('on');
    clearTimeout(saved.t);
    saved.t = setTimeout(() => el.classList.remove('on'), 900);
  }

  async function save(patch) {
    s = await api.saveSettings(patch);
    $('title').textContent = s.name;
    document.title = `${s.name} · Chonky Cat settings`;
    saved();
  }

  function fill() {
    for (const k of BOOL) $(k).checked = !!s[k];
    for (const k of NUM) $(k).value = s[k];
    for (const k of TEXT) $(k).value = s[k] || '';
    $('cafeEnabled').checked = !!s.cafe.enabled;
    $('cafeRoom').value = s.cafe.room || '';
    $('cafeName').value = s.cafe.displayName || '';
    $('cafeProject').checked = !!s.cafe.shareProject;
    $('title').textContent = s.name;
    document.querySelectorAll('.skin').forEach((el) => el.classList.toggle('on', el.dataset.skin === s.skin));
  }

  function wire() {
    for (const k of BOOL) $(k).addEventListener('change', (e) => save({ [k]: e.target.checked }));
    for (const k of NUM) $(k).addEventListener('change', (e) => save({ [k]: Number(e.target.value) }));
    for (const k of TEXT) $(k).addEventListener('change', (e) => save({ [k]: e.target.value }));
    const cafe = () => save({ cafe: { enabled: $('cafeEnabled').checked, room: $('cafeRoom').value.trim(), displayName: $('cafeName').value.trim(), shareProject: $('cafeProject').checked } });
    ['cafeEnabled', 'cafeRoom', 'cafeName', 'cafeProject'].forEach((id) => $(id).addEventListener('change', cafe));
    $('resetName').addEventListener('click', () => { $('name').value = 'Arshia'; save({ name: 'Arshia' }); });
  }

  function skins() {
    const box = $('skins');
    for (const key of Object.keys(A.SKINS)) {
      const b = document.createElement('button');
      b.className = 'skin';
      b.dataset.skin = key;
      const c = document.createElement('canvas');
      c.width = 210; c.height = 200;
      b.append(c, document.createTextNode(A.SKINS[key].label));
      b.addEventListener('click', () => { save({ skin: key }); document.querySelectorAll('.skin').forEach((el) => el.classList.toggle('on', el === b)); });
      box.append(b);
    }
  }

  function draw(t) {
    const hero = $('hero');
    const hx = hero.getContext('2d');
    hx.setTransform(1, 0, 0, 1, 0, 0);
    hx.clearRect(0, 0, hero.width, hero.height);
    hx.setTransform(hero.width / A.W, 0, 0, hero.width / A.W, 0, 0);
    A.draw(hx, { skin: s.skin, t, fat: 0.3, state: 'idle', eyes: Math.floor(t / 4) % 3 === 2 ? 'happy' : undefined });
    document.querySelectorAll('.skin canvas').forEach((c) => {
      const x = c.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, c.width, c.height);
      x.setTransform(c.width / A.W, 0, 0, c.width / A.W, 0, 0);
      A.draw(x, { skin: c.parentElement.dataset.skin, t: t + c.parentElement.dataset.skin.length, fat: 0.3 });
    });
    setTimeout(() => requestAnimationFrame(() => draw(performance.now() / 1000)), 50);
  }

  async function stats() {
    const st = await api.getStats();
    const cells = [['🐟', st.fish, 'fish'], ['🔥', st.streakDays, 'day streak'], ['✓', st.tasksDone, 'tasks done'], ['📦', st.commits, 'commits'], ['🚀', st.pushes, 'pushes'], ['✅', st.testsPassed, 'green tests'], ['🐱', st.kittens, 'kittens sent'], ['💛', st.pets, 'pets']];
    $('stats').innerHTML = cells.map(([i, n, l]) => `<div class="stat"><b>${i} ${n || 0}</b><span>${l}</span></div>`).join('');
  }

  function voices() {
    const sel = $('voice');
    const fillVoices = () => {
      const vs = speechSynthesis.getVoices();
      if (!vs.length) return;
      sel.innerHTML = '<option value="">System default</option>' + vs.map((v) => `<option>${v.name.replace(/</g, '')}</option>`).join('');
      sel.value = s.voice || '';
    };
    fillVoices();
    speechSynthesis.onvoiceschanged = fillVoices;
  }

  async function boot() {
    s = await api.getSettings();
    skins();
    fill();
    wire();
    voices();
    stats();
    const fx = $('fx');
    for (const [type, label] of PREVIEWS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => api.previewFx(type));
      fx.append(b);
    }
    api.onSettings((ns) => { s = ns; fill(); });
    draw(0);
    setInterval(stats, 5000);
  }
  boot();
})();
