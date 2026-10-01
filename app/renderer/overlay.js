/* Arshia overlay: the cat, her behaviours, kittens, visitors and all the UI around her. */
(function () {
  'use strict';
  const A = window.ArshiaArt;
  const SND = window.ArshiaSound;
  const api = window.arshia || mockApi();
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const ease = (u) => u * u * (3 - 2 * u);
  const now = () => performance.now() / 1000;

  // ------------------------------------------------------------- state --
  let settings = null;
  let stats = { fish: 0, streakDays: 0, today: { tasks: 0 } };
  let status = { state: 'sleep', sessions: [], context: { tokens: 0, window: 200000 }, detail: '' };
  let statusSince = now();
  let cursor = { x: -1000, y: -1000, inside: false, still: 0, lastMove: now() };
  const view = { w: innerWidth, h: innerHeight };
  const stageEl = $('stage');
  // the window only covers part of the scene; vp is that part, in scene coordinates
  const vp = { x: 0, y: 0, w: innerWidth, h: innerHeight, pending: false, compactSince: 0 };
  const catEl = $('cat');
  const cctx = catEl.getContext('2d');
  const fxEl = $('fx');
  const fctx = fxEl.getContext('2d');
  const FOOT = A.GROUND / A.H;

  const cat = {
    x: 0, y: 0, vx: 0, vy: 0,
    mode: 'floor', // floor | perch | air | drag | hop
    flip: 1, walkPhase: 0, walking: false, walkSpeed: 0,
    sq: { x: 1, y: 1 }, sq0: { x: 1, y: 1 }, sqT: 9,
    perch: null, hop: null,
    fat: 0.2, fatBoost: 0, burp: 0,
    look: { x: 0, y: 0 },
    w: 190, h: 181, k: 1,
    anchor: { headX: A.CX, headTop: 90, mouth: [A.CX, 250], bottom: A.GROUND, bodyRx: 110 },
    homeX: null,
  };

  // =================================================================== env --
  // Everything behaviours are allowed to touch.
  const env = {
    t: 0,
    dt: 0,
    cat,
    view,
    get status() { return status; },
    get settings() { return settings; },
    get stats() { return stats; },
    get cursor() { return cursor; },
    get statusAge() { return now() - statusSince; },
    css(vx, vy) {
      return [cat.x + (vx - A.CX) * cat.k * cat.flip, cat.y + (vy - A.GROUND) * cat.k];
    },
    virt(px, py) {
      return [A.CX + ((px - cat.x) / cat.k) * cat.flip, A.GROUND + (py - cat.y) / cat.k];
    },
    headTopY() { return cat.y + (cat.anchor.headTop - A.GROUND) * cat.k; },
    floorY() { return view.h - 3; },
    groundY() { return cat.mode === 'perch' && cat.perch ? cat.perch.y : view.h - 3; },
    night() { const h = new Date().getHours(); return h >= 22 || h < 6; },
    morning() { const h = new Date().getHours(); return h >= 6 && h < 11; },
    month() { return new Date().getMonth(); },
    quiet() { return !!settings.dnd; },
    sfx(name, gap) { if (!settings.dnd) SND.play(name, gap); },
    say(text, ms, opts) { say(text, ms, opts); },
    toast(text, ms) { toast(text, ms); },
    burst(kind, x, y, n, o) { burst(kind, x, y, n, o); },
    sprite(s) { sprites.push(s); return s; },
    squash(x, y) { cat.sq0 = { x, y }; cat.sqT = 0; },
    walkTo(x, speed) {
      const dx = x - cat.x;
      if (Math.abs(dx) < 4) { cat.walking = false; return true; }
      const dir = Math.sign(dx);
      cat.x += dir * Math.min(Math.abs(dx), speed * env.dt);
      cat.walking = true;
      cat.walkSpeed = speed;
      cat.flip = dir > 0 ? -1 : 1;
      cat.walkPhase += env.dt * (speed / 110);
      if (cat.mode === 'perch' && cat.perch && (cat.x < cat.perch.x + 20 || cat.x > cat.perch.x + cat.perch.w - 20)) {
        cat.mode = 'air'; cat.vy = -80; cat.vx = dir * 120; cat.perch = null;
      }
      return false;
    },
    hopTo(x, y, dur, height, mode) {
      cat.hop = { x0: cat.x, y0: cat.y, x1: x, y1: y, t0: now(), dur: dur || 0.6, h: height || 90, mode: mode || 'floor' };
      cat.mode = 'hop';
      cat.flip = x > cat.x ? -1 : 1;
      env.squash(1.15, 0.85);
    },
    landed() { return cat.mode !== 'hop' && cat.mode !== 'air'; },
    sessionNeeding() { return (status.sessions || []).find((s) => s.state === 'needs' || s.state === 'danger'); },
  };

  // ============================================================ behaviours --
  // Each behaviour: { pri, dur | (env,p)=>dur, idle?, weight?, busyOk?, cond?, start?, frame(env,k,s,p)->overrides, end?, while? }
  // Overrides may contain any ArshiaArt.draw option plus sx/sy/rot/dx/dy/flip/done.
  const B = {};
  const PHRASES = ['Mrrp?', 'Is it snack o’clock?', 'I supervise. Professionally.', 'Your code smells like fish. Nice.', 'Prrrrr…', '*stares at a bug only I can see*', 'I knocked nothing over. Yet.', 'Did someone say tuna?', 'Loaf mode: engaged.', 'I’m not fat, I’m context-rich.'];

  // ---- idle & ambient
  B.lookAround = { idle: true, weight: 3, busyOk: true, pri: 1, dur: 4, frame: (e, k) => ({ look: { x: k < 0.3 ? -1 : k < 0.65 ? 1 : 0, y: -0.2 }, ears: k > 0.25 && k < 0.7 ? 'perk' : undefined }) };
  B.earTwitch = { idle: true, weight: 2, busyOk: true, pri: 1, dur: 1.2, frame: (e, k) => ({ ears: Math.floor(k * 6) % 2 ? 'one' : 'up' }) };
  B.slowBlink = {
    idle: true, weight: 3, pri: 1, dur: 3.6,
    frame(e, k, s, p) {
      if (k > 0.66 && !p.h) { p.h = 1; const [x, y] = e.css(A.CX + 60, e.cat.anchor.headTop + 40); e.burst('heart', x, y, 1); }
      return { eyes: k > 0.25 && k < 0.62 ? 'closed' : 'open', look: { x: 0, y: 0 }, mouth: 'w' };
    },
  };
  B.groom = {
    idle: true, weight: 3, pri: 1, dur: 6.5,
    frame(e, k, s) {
      const m = e.cat.anchor.mouth;
      if (k < 0.62) {
        const lick = s % 1.1 < 0.55;
        return { raise: { side: 1, x: m[0] + 30, y: m[1] + (lick ? -2 : 12), r: 21, beans: true }, eyes: 'closed', mouth: lick ? 'blep' : 'w', headTilt: -0.08 };
      }
      const w = Math.sin(s * 6);
      return { raise: { side: 1, x: m[0] + 48 + w * 10, y: m[1] - 54 + w * 8, r: 21 }, eyes: 'closed', headTilt: -0.16, ears: 'back' };
    },
  };
  B.yawn = {
    idle: true, weight: 2, pri: 1, dur: 2.6,
    start: (e) => e.sfx('yawn'),
    frame: (e, k) => (k > 0.12 && k < 0.78 ? { mouth: 'yawn', eyes: 'closed', ears: 'back', sy: 1 + Math.sin(k * Math.PI) * 0.06 } : {}),
  };
  B.stretch = {
    idle: true, weight: 2, pri: 1, dur: 3,
    frame(e, k, s, p) {
      if (k > 0.85 && !p.m) { p.m = 1; e.sfx('mrrp'); }
      const u = Math.sin(clamp(k / 0.8, 0, 1) * Math.PI);
      return { sx: 1 + u * 0.16, sy: 1 - u * 0.17, eyes: u > 0.3 ? 'closed' : 'open', mouth: u > 0.5 ? 'yawn' : 'w', ears: u > 0.3 ? 'back' : undefined };
    },
  };
  B.blep = { idle: true, weight: 2, pri: 1, dur: 4, frame: () => ({ mouth: 'blep', look: { x: 0, y: 0 } }) };
  B.knead = {
    idle: true, weight: 2, pri: 1, dur: 6,
    start: (e) => e.sfx('purr'),
    frame(e, k, s, p) {
      const ph = Math.floor(s * 4) % 2;
      if (Math.floor(s) !== p.l) { p.l = Math.floor(s); const [x, y] = e.css(A.CX + rand(-60, 60), e.cat.anchor.headTop + 30); if (Math.random() < 0.6) e.burst('heart', x, y, 1); }
      return { pawLift: ph ? [12, 0] : [0, 12], eyes: 'half', mouth: 'w' };
    },
  };
  B.sneeze = {
    idle: true, weight: 1, pri: 1, dur: 2.2,
    frame(e, k, s, p) {
      if (k < 0.45) return { headTilt: -0.18 * (k / 0.45), eyes: 'closed', mouth: 'o', sy: 1 + 0.05 * (k / 0.45), ears: 'back' };
      if (!p.a) {
        p.a = 1;
        e.sfx('sneeze');
        e.squash(1.12, 0.86);
        const [x, y] = e.css(A.CX, e.cat.anchor.mouth[1]);
        e.burst('dust', x, y, 8);
        e.say('Achoo!', 1100);
      }
      return { eyes: k < 0.6 ? 'x' : 'open', mouth: k < 0.6 ? 'meow' : 'w', dy: k < 0.55 ? 4 : 0 };
    },
  };
  B.hiccups = {
    idle: true, weight: 1, pri: 1, dur: 4.4,
    frame(e, k, s, p) {
      const n = Math.floor(s / 1.1);
      const ph = s % 1.1;
      if (n !== p.n && ph < 0.1) { p.n = n; e.sfx('hic'); const [x, y] = e.css(A.CX + 80, e.cat.anchor.headTop + 20); e.burst('text', x, y, 1, { text: 'hic!' }); }
      return { dy: ph < 0.16 ? -Math.sin((ph / 0.16) * Math.PI) * 12 : 0, eyes: ph < 0.3 ? 'wide' : 'open', mouth: ph < 0.3 ? 'o' : 'w' };
    },
  };
  B.curious = {
    idle: true, weight: 3, busyOk: true, pri: 1, dur: 3.4,
    start(e) { const [x, y] = e.css(A.CX + 90, e.cat.anchor.headTop + 10); e.burst('text', x, y, 1, { text: '?', size: 26 }); },
    frame: (e, k) => ({ headTilt: Math.sin(Math.min(1, k * 3) * Math.PI / 2) * 0.24, ears: 'one', mouth: 'o' }),
  };
  B.meow = {
    idle: true, weight: 2, pri: 1, dur: 2.2,
    start(e) { e.sfx('meow'); if (!e.quiet()) e.say(pick(PHRASES), 2600); },
    frame: (e, k) => ({ mouth: k < 0.35 ? 'meow' : 'w', ears: 'perk' }),
  };
  B.tailChase = {
    idle: true, weight: 1, pri: 1, dur: 3.2,
    frame(e, k, s, p) {
      if (k > 0.75) { if (!p.d) { p.d = 1; e.burst('star', e.cat.x, e.headTopY(), 4); } return { eyes: 'dizzy', mouth: 'wavy', rot: Math.sin(s * 9) * 0.06 }; }
      if (Math.floor(s * 7) !== p.f) { p.f = Math.floor(s * 7); if (Math.random() < 0.5) e.burst('dust', e.cat.x + rand(-40, 40), e.cat.y, 2); }
      return { flip: Math.floor(s * 7) % 2 ? -1 : 1, pose: 'walk', walkPhase: s * 4, eyes: 'wide', mouth: 'pant', dy: -Math.abs(Math.sin(s * 14)) * 6 };
    },
  };
  B.zoomies = {
    idle: true, weight: 1, pri: 1, dur: 12,
    cond: () => !cat.perch,
    start(e, p) {
      const w = e.view.w;
      p.home = e.cat.x;
      p.pts = [clamp(e.cat.x - rand(250, 500), 80, w - 80), clamp(e.cat.x + rand(250, 500), 80, w - 80), p.home];
      p.i = 0;
      e.sfx('mrrp');
    },
    frame(e, k, s, p) {
      if (e.walkTo(p.pts[p.i], 720)) { p.i++; e.squash(0.85, 1.12); if (p.i >= p.pts.length) return { done: true }; }
      if (Math.random() < 0.35) e.burst('dust', e.cat.x + e.cat.flip * 40, e.cat.y - 4, 1);
      return { pose: 'walk', walkPhase: e.cat.walkPhase, mouth: 'pant', eyes: 'wide', ears: 'back' };
    },
    end(e) { savePos(); },
  };
  B.wander = {
    idle: true, weight: 4, pri: 1, dur: 20,
    start(e, p) {
      const lo = cat.perch ? cat.perch.x + 40 : 70;
      const hi = cat.perch ? cat.perch.x + cat.perch.w - 40 : e.view.w - 70;
      p.to = clamp(e.cat.x + rand(-420, 420), lo, hi);
    },
    frame(e, k, s, p) {
      if (e.walkTo(p.to, 130)) return { done: true };
      return { pose: 'walk', walkPhase: e.cat.walkPhase };
    },
    end() { savePos(); },
  };
  B.roll = {
    idle: true, weight: 1, pri: 1, dur: 1.8,
    cond: () => !cat.perch,
    start(e, p) { p.dir = e.cat.x > e.view.w / 2 ? -1 : 1; e.sfx('pop'); },
    frame(e, k, s, p) {
      if (k < 0.75) { e.cat.x = clamp(e.cat.x + p.dir * 260 * e.dt, 80, e.view.w - 80); return { rot: p.dir * ease(k / 0.75) * TAU, eyes: 'happy', mouth: 'smile', dy: -18 }; }
      return { eyes: 'dizzy', mouth: 'wavy' };
    },
    end: () => savePos(),
  };
  B.butterfly = {
    idle: true, weight: 2, pri: 1, dur: 9,
    cond: (e) => !e.night(),
    start(e, p) {
      const side = Math.random() < 0.5 ? -1 : 1;
      p.b = e.sprite({ kind: 'butterfly', x: e.cat.x + side * 500, y: e.headTopY() - 120, t0: now(), side, color: pick(['#FF9BD2', '#9BD7FF', '#C8A2FF', '#FFC56E']), free: false });
    },
    frame(e, k, s, p) {
      const b = p.b;
      if (!b.free) {
        const tx = e.cat.x + Math.sin(s * 1.3) * e.cat.w * 0.55;
        const ty = e.headTopY() - 40 + Math.sin(s * 2.3) * 40;
        b.x = lerp(b.x, tx, Math.min(1, e.dt * 1.6));
        b.y = lerp(b.y, ty, Math.min(1, e.dt * 1.6));
      }
      const [vx, vy] = e.virt(b.x, b.y);
      const look = { x: clamp((vx - A.CX) / 160, -1, 1), y: clamp((vy - 200) / 160, -1, 1) };
      if (s > 5.6 && s < 6.6) {
        if (!b.free && s > 6.1) { b.free = true; b.vx = (b.x > e.cat.x ? 1 : -1) * 220; b.vy = -260; e.sfx('boop'); }
        return { look, raise: { side: vx > A.CX ? 1 : -1, x: clamp(vx, 40, 380), y: clamp(vy, 40, 300), r: 22, beans: true }, eyes: 'wide', mouth: 'o', ears: 'perk' };
      }
      return { look, ears: 'perk', eyes: s > 6.6 ? 'happy' : 'wide', mouth: s > 6.6 ? 'smile' : 'w' };
    },
    end(e, p) { p.b.free = true; p.b.vx = p.b.vx || 200; p.b.vy = p.b.vy || -200; },
  };
  B.yarn = {
    idle: true, weight: 2, pri: 1, dur: 7,
    start(e, p) {
      const side = e.cat.x > e.view.w / 2 ? -1 : 1;
      p.side = side;
      p.y = e.sprite({ kind: 'yarn', x: side < 0 ? -40 : e.view.w + 40, y: e.groundY() - 22, vx: 0, rot: 0, r: 22, target: e.cat.x + side * e.cat.w * 0.62 });
    },
    frame(e, k, s, p) {
      const y = p.y;
      if (s < 2.2) {
        y.x = lerp(y.x, y.target, Math.min(1, e.dt * 2.2));
        y.rot += e.dt * 6 * p.side;
        return { look: { x: p.side, y: 0.6 }, eyes: 'wide', sy: 0.92, dx: Math.sin(s * 30) * 2, ears: 'perk' };
      }
      if (s < 2.9) {
        const [vx, vy] = e.virt(y.x, y.y);
        if (!p.hit && s > 2.6) { p.hit = 1; y.vx = p.side * 520; e.sfx('boop'); }
        return { raise: { side: p.side, x: clamp(vx, 30, 390), y: clamp(vy - 10, 200, 360), r: 22, beans: true }, eyes: 'wide', mouth: 'o' };
      }
      return { look: { x: p.side, y: 0.3 }, eyes: 'happy', mouth: 'smile' };
    },
  };
  B.box = {
    idle: true, weight: 2, pri: 1, dur: 12,
    start(e) { e.sfx('pop'); if (!e.quiet()) e.say('If I fits, I sits.', 2800); },
    frame: (e, k, s) => ({ prop: 'box', eyes: s % 5 < 2.5 ? 'happy' : 'half', look: { x: Math.sin(s * 0.7) * 0.6, y: 0 } }),
  };
  B.loaf = { idle: true, weight: 2, pri: 1, dur: 10, frame: () => ({ paws: 'tucked', eyes: 'half', mouth: 'w' }) };
  B.nap = {
    idle: true, weight: 2, pri: 1, dur: 26,
    cond: (e) => e.status.state === 'sleep' || e.status.state === 'idle',
    frame(e, k, s, p) {
      if (Math.floor(s / 7) !== p.d && s > 3) {
        p.d = Math.floor(s / 7);
        const [x, y] = e.css(A.CX + 120, e.cat.anchor.headTop - 10);
        e.burst('dream', x, y, 1);
      }
      return { pose: 'sleep', hat: e.night() ? 'nightcap' : undefined };
    },
    end(e) { director.queueNext('shakeFur'); },
  };
  B.shakeFur = {
    busyOk: true, pri: 1, dur: 0.9,
    frame(e, k, s, p) {
      if (k > 0.8 && !p.d) { p.d = 1; e.burst('dust', e.cat.x, e.cat.y - e.cat.h * 0.4, 6); }
      return { dx: Math.sin(s * 70) * 4 * (1 - k), eyes: 'closed', ears: k < 0.5 ? 'back' : 'up', rot: Math.sin(s * 50) * 0.03 };
    },
  };
  B.peekaboo = {
    idle: true, weight: 1, pri: 1, dur: 14,
    cond: () => !cat.perch,
    start(e, p) {
      p.home = e.cat.x;
      p.side = e.cat.x < e.view.w / 2 ? -1 : 1;
      p.edge = p.side < 0 ? -e.cat.w * 0.18 : e.view.w + e.cat.w * 0.18;
      p.phase = 0;
    },
    frame(e, k, s, p) {
      if (p.phase === 0) { if (e.walkTo(p.edge, 260)) { p.phase = 1; p.t1 = s; } return { pose: 'walk', walkPhase: e.cat.walkPhase }; }
      if (p.phase === 1) {
        if (s - p.t1 > 3.5) p.phase = 2;
        e.cat.flip = 1;
        return { look: { x: -p.side, y: 0 }, eyes: s - p.t1 > 2 ? 'happy' : 'wide', ears: 'perk' };
      }
      if (e.walkTo(p.home, 200)) return { done: true };
      return { pose: 'walk', walkPhase: e.cat.walkPhase };
    },
    end: () => savePos(),
  };
  B.birdWatch = {
    idle: true, weight: 1, pri: 1, dur: 7,
    cond: (e) => !e.night(),
    start(e, p) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      p.b = e.sprite({ kind: 'bird', x: dir > 0 ? -60 : e.view.w + 60, y: Math.max(60, e.headTopY() - rand(160, 260)), vx: dir * rand(170, 240), dir });
      e.sfx('chirp');
    },
    frame(e, k, s, p) {
      const [vx, vy] = e.virt(p.b.x, p.b.y);
      return { look: { x: clamp((vx - A.CX) / 200, -1, 1), y: -1 }, ears: 'perk', eyes: 'wide', mouth: Math.floor(s * 12) % 2 ? 'o' : 'w' };
    },
  };
  B.coffee = {
    idle: true, weight: 3, pri: 1, dur: 9,
    cond: (e) => e.morning(),
    frame(e, k, s) {
      const m = e.cat.anchor.mouth;
      const sip = s % 3 > 2;
      return { raise: { side: 1, x: m[0] + (sip ? 34 : 62), y: m[1] + (sip ? 4 : 36), r: 20, hold: 'mug' }, eyes: sip ? 'closed' : 'half', mouth: sip ? 'o' : 'w' };
    },
  };
  B.dance = {
    idle: true, weight: 1, pri: 1, dur: 5,
    start: (e) => e.sfx('chime'),
    frame(e, k, s, p) {
      if (Math.floor(s * 2) !== p.n) { p.n = Math.floor(s * 2); e.burst('note', e.cat.x + rand(-80, 80), e.headTopY() + 10, 1); }
      return { rot: Math.sin(s * 7) * 0.12, dy: -Math.abs(Math.sin(s * 7)) * 8, eyes: 'happy', mouth: 'smile', ears: 'perk', headTilt: Math.sin(s * 7) * 0.1 };
    },
  };
  B.scratchEar = {
    idle: true, weight: 1, pri: 1, dur: 3,
    frame(e, k, s) {
      const h = e.cat.anchor;
      return { raise: { side: -1, x: h.headX - 92 + Math.sin(s * 30) * 6, y: h.headTop + 70 + Math.cos(s * 30) * 6, r: 20 }, headTilt: -0.2, eyes: 'closed', mouth: 'blep', ears: 'back' };
    },
  };
  B.bellyFlop = {
    idle: true, weight: 1, pri: 1, dur: 8,
    start(e) { if (!e.quiet()) e.say('Belly rub? (it’s a trap)', 2600); },
    frame: (e, k, s) => ({ pose: 'sleep', eyes: s % 4 < 3 ? 'open' : 'blink', mouth: 'w', rot: -0.12, look: { x: 0.4, y: 0 } }),
  };
  B.stargaze = {
    idle: true, weight: 3, pri: 1, dur: 9,
    cond: (e) => e.night(),
    frame(e, k, s, p) {
      if (Math.floor(s * 1.5) !== p.n) { p.n = Math.floor(s * 1.5); e.burst('star', e.cat.x + rand(-200, 200), e.headTopY() - rand(80, 220), 1); }
      return { look: { x: Math.sin(s * 0.5) * 0.6, y: -1 }, hat: 'nightcap', eyes: 'open' };
    },
  };
  B.waveHi = {
    idle: true, weight: 1, pri: 1, dur: 2.4,
    start(e) { e.sfx('mrrp'); if (!e.quiet()) e.say(pick(['Hi!', 'Hello, human!', '👋', 'Still here, still cute.']), 1800); },
    frame: () => ({ wave: 1, eyes: 'happy', mouth: 'smile' }),
  };
  B.perch = {
    idle: true, weight: 2, pri: 1, dur: 6,
    cond: (e) => e.settings.desktopAwareness && e.settings.perchOnWindows && !cat.perch && cat.mode === 'floor',
    start(e, p) {
      p.wait = true;
      api.foregroundWindow().then((w) => {
        p.wait = false;
        if (!w || w.y < 140 || w.w < 320 || w.y > e.view.h - 120) { p.skip = true; return; }
        const x = clamp(e.cat.x, w.x + 70, w.x + w.w - 70);
        p.win = w;
        e.hopTo(x, w.y, 0.75, 120, 'perch');
        cat.perch = { id: w.id, x: w.x, y: w.y, w: w.w, h: w.h };
        e.sfx('mrrp');
      });
    },
    frame(e, k, s, p) {
      if (p.skip) return { done: true };
      if (!p.wait && e.landed() && s > 1) return { done: true };
      return { eyes: 'wide', ears: 'perk' };
    },
  };
  B.hopDown = {
    idle: true, weight: 3, pri: 1, dur: 1.4,
    cond: () => !!cat.perch && cat.mode === 'perch',
    start(e) { cat.perch = null; e.hopTo(e.cat.x + rand(-80, 80), e.floorY(), 0.7, 60, 'floor'); },
    frame: () => ({ eyes: 'wide', mouth: 'o' }),
    end: () => savePos(),
  };
  B.chaseCursor = {
    pri: 2, dur: 3,
    start(e, p) { p.tx = clamp(e.cursor.x, 60, e.view.w - 60); p.phase = 0; },
    frame(e, k, s, p) {
      if (p.phase === 0) {
        if (s > 1.3) { p.phase = 1; e.hopTo(p.tx, e.groundY(), 0.55, 110, cat.perch ? 'perch' : 'floor'); e.sfx('mrrp'); }
        return { sy: 0.86, sx: 1.06, dx: Math.sin(s * 28) * 3, eyes: 'wide', ears: 'perk', look: { x: clamp((p.tx - e.cat.x) / 200, -1, 1), y: 0.5 } };
      }
      if (e.landed() && s > 2) return { eyes: 'happy', mouth: 'smile' };
      return { eyes: 'wide', mouth: 'o' };
    },
    end: () => savePos(),
  };

  // ---- reactions to Claude Code
  B.hello = {
    pri: 3, dur: 2.4,
    start(e) { e.sfx('jingle'); e.sfx('mrrp'); if (!e.quiet()) e.say(`Hi! I’m ${e.settings.name} 🐾`, 2200); },
    frame: (e, k) => ({ wave: k < 0.85 ? 1 : 0, eyes: 'happy', mouth: k < 0.3 ? 'meow' : 'smile' }),
  };
  B.wakeUp = {
    pri: 4, dur: 3.2,
    start(e, p) { p.wasAsleep = p.prev === 'sleep'; e.sfx('jingle'); },
    frame(e, k, s, p) {
      if (p.wasAsleep && s < 1.3) return { mouth: 'yawn', eyes: 'closed', ears: 'back', sy: 1.05 };
      if (p.wasAsleep && s < 2.1) return { sx: 1.14, sy: 0.84, eyes: 'closed' };
      if (!p.said) { p.said = 1; if (!e.quiet()) e.say(p.project ? `New session: <b>${esc(p.project)}</b>` : 'New session!', 2400, { html: true }); }
      return { ears: 'perk', eyes: 'wide', mouth: 'smile', dy: s < 2.4 ? -Math.sin(((s - 2.1) / 0.3) * Math.PI) * 10 : 0 };
    },
  };
  B.perk = {
    pri: 2, dur: 1,
    start: (e) => { e.sfx('mrrp', 1500); e.squash(0.92, 1.08); },
    frame: (e, k) => ({ ears: 'perk', eyes: k < 0.5 ? 'wide' : undefined, dy: -Math.sin(Math.min(1, k * 3) * Math.PI) * 10 }),
  };
  B.stamp = {
    pri: 5, dur: 3.4,
    frame(e, k, s, p) {
      const a = e.cat.anchor;
      const px = A.CX - a.bodyRx - 52;
      const up = s < 1.1;
      const slam = s >= 1.1 && s < 1.35;
      if (s >= 1.15 && !p.hit) {
        p.hit = 1;
        e.sfx('stamp');
        e.squash(1.06, 0.94);
        const [x, y] = e.css(px, A.GROUND - 36);
        e.burst('star', x, y - 20, 4);
        e.toast('Committed! 📦✓', 2200);
      }
      const ry = up ? A.GROUND - 150 - Math.sin(s * 6) * 6 : slam ? A.GROUND - 60 : A.GROUND - 64;
      return { prop: 'package', stamped: p.hit ? 1 : 0, raise: { side: -1, x: px + 6, y: ry, r: 20, hold: 'stamp' }, look: { x: -0.8, y: 0.6 }, eyes: p.hit ? 'happy' : 'focus', mouth: p.hit ? 'smile' : 'w' };
    },
  };
  B.rocket = {
    pri: 5, dur: 3.6,
    start(e, p) {
      const side = e.cat.x > e.view.w / 2 ? -1 : 1;
      p.r = e.sprite({ kind: 'rocket', x: e.cat.x + side * e.cat.w * 0.75, y: e.groundY() - 50, vy: 0, t0: now(), parcel: true });
      e.sfx('whoosh');
      e.toast('Pushed! 🚀', 2400);
    },
    frame(e, k, s, p) {
      p.r.vy -= 900 * e.dt;
      if (s > 0.35) p.r.y += p.r.vy * e.dt;
      if (Math.random() < 0.5) e.burst('dust', p.r.x + rand(-10, 10), p.r.y + 60, 1);
      const [vx, vy] = e.virt(p.r.x, p.r.y);
      return { look: { x: clamp((vx - A.CX) / 160, -1, 1), y: clamp((vy - 200) / 150, -1, 1) }, wave: s > 1 ? 1 : 0, eyes: 'wide', mouth: 'o', ears: 'perk' };
    },
  };
  B.celebrate = {
    pri: 5, dur: 3.8,
    start(e) { e.sfx('tada'); e.burst('confetti', e.cat.x, e.headTopY(), 60); e.toast('Tests passed ✅', 2400); },
    frame: (e, k, s) => ({ eyes: 'star', mouth: 'smile', hat: 'party', rot: Math.sin(s * 8) * 0.1, dy: -Math.abs(Math.sin(s * 8)) * 12, ears: 'perk' }),
  };
  B.cupKnock = {
    pri: 5, dur: 5.2,
    start(e, p) {
      const side = e.cat.x > e.view.w / 2 ? -1 : 1;
      p.side = side;
      p.c = e.sprite({ kind: 'cup', x: e.cat.x + side * e.cat.w * 0.48, y: e.groundY() - 20, vx: 0, vy: 0, rot: 0, falling: false, floor: e.floorY(), perched: !!cat.perch });
    },
    frame(e, k, s, p) {
      const c = p.c;
      if (s < 1.6) return { look: { x: 0, y: 0 }, eyes: 'half', mouth: 'w', headTilt: -0.08 };
      const [vx, vy] = e.virt(c.x, c.y);
      if (s < 2.8) {
        const u = (s - 1.6) / 1.2;
        if (u > 0.8 && !c.falling) { c.falling = true; c.vx = p.side * 160; c.vy = -120; e.toast('Tests failed… *innocent blink*', 2600); }
        return { raise: { side: p.side, x: lerp(A.CX + p.side * 90, clamp(vx, 20, 400), u), y: clamp(vy - 6, 220, 360), r: 20 }, look: { x: 0, y: 0 }, eyes: 'half' };
      }
      return { look: { x: 0, y: 0 }, eyes: s % 1 < 0.15 ? 'blink' : 'open', mouth: 'w', headTilt: 0.1 };
    },
  };
  B.oops = {
    pri: 3, dur: 2,
    start: (e) => e.sfx('boop', 2000),
    frame: () => ({ state: 'error' }),
  };
  B.hiss = {
    pri: 6, dur: 2.6,
    start(e, p) { e.sfx('hiss'); if (!e.quiet()) e.say(`Whoa, a <b>${esc(p.risk || 'risky command')}</b>! Fur is up. Check before approving.`, 4200, { html: true }); },
    frame: (e, k, s) => ({ state: 'danger', dx: Math.sin(s * 60) * (k < 0.4 ? 3 : 0) }),
  };
  B.needsYou = {
    pri: 7, dur: 600,
    while: (e) => e.status.state === 'needs' || e.status.state === 'danger',
    start(e, p) {
      p.sNeeds = e.sessionNeeding();
      if (!permVisible() && !e.quiet()) {
        const what = p.sNeeds && p.sNeeds.pending ? p.sNeeds.pending.summary : (p.sNeeds && p.sNeeds.detail) || 'Claude needs you';
        e.say(`<b>${esc((p.sNeeds && p.sNeeds.project) || 'Claude')}</b> needs you:\n${esc(what)}`, 9000, { html: true });
      }
      e.sfx('meow');
      p.phase = 0;
      p.lastMeow = 0;
    },
    frame(e, k, s, p) {
      const danger = e.status.state === 'danger';
      if (p.phase === 0 && s > 12 && e.settings.runToWindow && e.settings.desktopAwareness && !e.quiet()) {
        p.phase = 1;
        api.sessionWindow(p.sNeeds && p.sNeeds.project).then((w) => {
          if (!w || w.w < 200) { p.phase = 3; return; }
          const x = clamp(w.x + w.w - 140, 80, e.view.w - 80);
          if (w.y > 140 && w.y < e.view.h - 160) {
            cat.perch = { id: w.id, x: w.x, y: w.y, w: w.w, h: w.h };
            e.hopTo(x, w.y, 0.9, 160, 'perch');
          } else {
            p.walkX = x;
          }
          p.phase = 2;
        });
      }
      if (p.phase === 2 && p.walkX != null) {
        if (!e.walkTo(p.walkX, 380)) return { pose: 'walk', walkPhase: e.cat.walkPhase, eyes: 'wide', state: danger ? 'danger' : 'needs' };
        p.walkX = null;
      }
      if (s - p.lastMeow > 14 && s > 30) {
        p.lastMeow = s;
        e.sfx('meow');
        if (!permVisible() && !e.quiet()) e.say(`Hey! <b>${esc((p.sNeeds && p.sNeeds.project) || 'Claude')}</b> is still waiting (${Math.round(s)}s)`, 5000, { html: true });
      }
      const knocking = p.phase >= 2 && e.landed() && s > 13;
      if (knocking && Math.sin(e.t * 7) > 0.97 && !p.k) {
        p.k = 1;
        const [x, y] = e.css(A.CX + 40, e.cat.anchor.mouth[1] + 40);
        smudge(x + rand(-12, 12), y + rand(-10, 10));
        e.sfx('thud', 300);
      }
      if (Math.sin(e.t * 7) < 0.5) p.k = 0;
      if (danger) return { state: 'danger', knock: knocking ? 1 : 0 };
      return { state: 'needs', wave: knocking ? 0 : 1, knock: knocking ? 1 : 0 };
    },
    end(e) { if (!e.quiet() && !['sleep', 'needs', 'danger'].includes(e.status.state)) e.say(pick(['Thanks! 💛', 'Back to work!', 'Purrfect.']), 1400); },
  };
  B.reward = {
    pri: 4, dur: 4.2,
    start(e, p) {
      e.sfx('chime');
      p.f = e.sprite({ kind: 'fishFly', x: e.cat.x + rand(-160, 160), y: -40, t0: now(), tx: e.cat.x, ty: e.headTopY() + e.cat.h * 0.25 });
      if (p.fish) {
        const streak = p.streak > 1 ? `  🔥 ${p.streak}-day streak` : '';
        e.toast(`+1 🐟  (${p.fish})${streak}`, 2600);
      }
      if (p.speak && p.summary) SND.speak(firstSentence(p.summary), e.settings.voice);
    },
    frame(e, k, s, p) {
      if (s < 0.8) return { state: 'done', look: { x: 0, y: -1 }, eyes: 'wide', mouth: 'o' };
      p.f.dead = true;
      const m = e.cat.anchor.mouth;
      if (s > 0.8 && !p.m) { p.m = 1; e.sfx('munch'); }
      if (Math.floor(s * 7) % 3 === 0) e.sfx('munch', 200);
      return { state: 'done', raise: { side: 1, x: m[0] + 24, y: m[1] + 22, r: 20, hold: s < 3.2 ? 'fish' : undefined }, mouth: s < 3.2 ? 'munch' : 'smile', eyes: 'happy', hat: e.stats.streakDays >= 7 ? 'crown' : undefined };
    },
  };
  B.rateLimit = {
    pri: 4, dur: 30,
    while: (e) => e.status.state === 'error',
    start(e) { if (!e.quiet()) e.say('Rate limited. Resting my paws for a bit ⏳', 3500); },
    frame: () => ({ prop: 'hourglass', eyes: 'half', mouth: 'w', state: 'idle' }),
  };
  B.feast = {
    pri: 5, dur: 25,
    while: (e) => e.status.activity === 'compacting',
    start(e) { if (!e.quiet()) e.say('Nom nom… digesting the conversation', 3000); cat.fatBoost = 0.18; },
    frame(e, k, s) {
      const m = e.cat.anchor.mouth;
      if (Math.floor(s * 5) % 2 === 0) e.sfx('munch', 180);
      return { raise: { side: 1, x: m[0] + 24, y: m[1] + 20, r: 20, hold: 'fish' }, mouth: 'munch', eyes: 'closed', state: 'working' };
    },
    end() { cat.fatBoost = 0; },
  };
  B.burp = {
    pri: 5, dur: 2.4,
    start(e) { e.sfx('burp'); cat.fatBoost = 0; if (!e.quiet()) e.say('*burp* … much lighter!', 2400); },
    frame: (e, k) => ({ burp: k, eyes: k < 0.4 ? 'closed' : 'happy', mouth: k < 0.35 ? 'meow' : 'smile', sx: 1 + Math.sin(k * Math.PI) * 0.05 }),
  };
  B.goodbye = {
    pri: 3, dur: 2.2,
    start(e, p) { if (!e.quiet()) e.say(`Bye, ${esc(p.project || 'session')}!`, 1800); },
    frame: () => ({ wave: 1, eyes: 'happy', mouth: 'smile' }),
  };
  B.nudge = {
    pri: 3, dur: 2.6,
    start(e) { e.sfx('meow'); if (!e.quiet()) e.say('Your turn! Claude is waiting for you.', 3000); },
    frame: (e, k) => ({ mouth: k < 0.3 ? 'meow' : 'w', look: { x: 0, y: 0 }, ears: 'perk', wave: k > 0.3 ? 1 : 0 }),
  };
  B.sniff = { pri: 2, dur: 2.2, frame: (e, k, s) => ({ look: { x: Math.sin(s * 5), y: 0.4 }, headTilt: Math.sin(s * 9) * 0.05, mouth: 'o' }) };
  B.unbox = {
    pri: 3, dur: 4,
    start(e) { e.sfx('pop'); if (!e.quiet()) e.say('New packages! I’m keeping the box.', 2600); },
    frame: () => ({ prop: 'box', eyes: 'happy', mouth: 'smile' }),
  };
  B.checkmark = {
    pri: 3, dur: 2.6,
    start(e, p) { if (p.subject && !e.quiet()) e.toast(`✓ ${p.subject}`, 2200); e.sfx('pop'); },
    frame: () => ({ prop: 'clipboard', eyes: 'happy', mouth: 'smile' }),
  };
  B.visitorWave = {
    pri: 3, dur: 3,
    frame: (e, k, s, p) => ({ wave: 1, look: { x: p.dir || 1, y: 0 }, eyes: 'happy', mouth: 'smile' }),
  };
  B.breakTime = {
    pri: 5, dur: 40,
    start(e, p) {
      p.to = e.view.w / 2;
      if (cat.perch) { cat.perch = null; e.hopTo(e.cat.x, e.floorY(), 0.6, 60, 'floor'); }
      e.say(`You’ve been at it for ${p.minutes || 90} minutes.\nStretch break? I’ll guard the code. 🧘`, 30000, { sticky: true });
      e.sfx('meow');
    },
    frame(e, k, s, p) {
      if (!e.landed()) return {};
      if (!p.arrived) { if (e.walkTo(p.to, 220)) p.arrived = true; return { pose: 'walk', walkPhase: e.cat.walkPhase }; }
      return { pose: 'sleep', eyes: 'half', mouth: 'w', rot: -0.1 };
    },
    end() { hideBubble(); },
  };
  B.eatFish = {
    pri: 4, dur: 3.6,
    start(e, p) {
      api.feed().then((ok) => {
        p.ok = ok;
        if (!ok && !e.quiet()) e.say('No fish left… finish a Claude task to earn one!', 2600);
        else e.sfx('munch');
      });
    },
    frame(e, k, s, p) {
      if (p.ok === false) return { eyes: 'half', mouth: 'w', ears: 'back', done: s > 2.4 };
      const m = e.cat.anchor.mouth;
      return { raise: { side: 1, x: m[0] + 24, y: m[1] + 22, r: 20, hold: s < 2.8 ? 'fish' : undefined }, mouth: s < 2.8 ? 'munch' : 'smile', eyes: 'happy' };
    },
  };

  // ---- petting & physical play
  B.boop = {
    pri: 3, dur: 0.7,
    start(e) { e.sfx('boop'); e.squash(1.12, 0.88); api.pet(); const [x, y] = e.css(A.CX + 30, e.cat.anchor.headTop + 40); e.burst('heart', x, y, 1); },
    frame: () => ({ eyes: 'closed', mouth: 'o', ears: 'back' }),
  };
  B.jump = {
    pri: 3, dur: 1.2,
    start(e) { e.sfx('mrrp'); e.hopTo(e.cat.x, e.groundY(), 0.7, 170, cat.perch ? 'perch' : 'floor'); },
    frame: (e, k) => ({ eyes: k < 0.6 ? 'wide' : 'happy', mouth: k < 0.6 ? 'o' : 'smile', ears: 'perk' }),
  };
  B.purr = {
    pri: 2, dur: 30,
    while: () => hover.on,
    start(e) { e.sfx('purr', 1400); api.pet(); },
    frame(e, k, s, p) {
      if (Math.floor(s / 1.5) !== p.n) {
        p.n = Math.floor(s / 1.5);
        e.sfx('purr', 1400);
        const [x, y] = e.css(A.CX + rand(-70, 70), e.cat.anchor.headTop + 30);
        e.burst('heart', x, y, 1);
      }
      return { eyes: s > 3 ? 'heart' : 'closed', mouth: 'w', headTilt: clamp((e.cursor.x - e.cat.x) / 600, -0.2, 0.2), ears: 'back' };
    },
  };
  B.dizzy = {
    pri: 3, dur: 1.6,
    start(e) { e.burst('star', e.cat.x, e.headTopY() + 20, 5); },
    frame: () => ({ eyes: 'dizzy', mouth: 'wavy' }),
  };

  // Map hook reactions to behaviours.
  const FX_TO_BEHAVIOR = {
    'session-start': 'wakeUp', prompt: 'perk', 'git-commit': 'stamp', 'git-push': 'rocket', 'tests-pass': 'celebrate',
    'tests-fail': 'cupKnock', 'tool-fail': 'oops', danger: 'hiss', permission: 'needsYou', needs: 'needsYou', done: 'reward',
    'compact-start': 'feast', 'compact-end': 'burp', 'session-end': 'goodbye', 'idle-nudge': 'nudge', sniff: 'sniff',
    installed: 'unbox', 'task-done': 'checkmark', 'break-time': 'breakTime', 'feed-request': 'eatFish', hello: 'hello',
  };

  // ============================================================ director --
  const director = {
    cur: null,
    queue: [],
    nextIdle: now() + 6,
    lastIdle: [],
    play(name, p, force) {
      const def = B[name];
      if (!def) return;
      p = Object.assign({}, p || {});
      if (this.cur && !force) {
        if ((this.cur.def.pri || 0) > (def.pri || 0)) {
          if ((def.pri || 0) >= 3) this.queue.push([name, p]);
          return;
        }
        if (this.cur.name === name && def.while) return; // already running
      }
      this.end();
      this.cur = { name, def, p, t0: now() };
      if (def.start) def.start(env, p);
    },
    queueNext(name) { this.queue.push([name, {}]); },
    end() {
      if (!this.cur) return;
      const c = this.cur;
      this.cur = null;
      if (c.def.end) c.def.end(env, c.p);
    },
    update(t) {
      if (cat.mode === 'drag') return { eyes: 'wide', mouth: 'o', sy: 1.12, sx: 0.94, ears: 'back', paws: undefined };
      if (!this.cur && this.queue.length) { const [n, p] = this.queue.shift(); this.play(n, p); }
      if (!this.cur) { this.maybeIdle(t); return {}; }
      const c = this.cur;
      const s = t - c.t0;
      const dur = typeof c.def.dur === 'function' ? c.def.dur(env, c.p) : c.def.dur;
      const k = dur ? Math.min(1, s / dur) : 0;
      const o = (c.def.frame && c.def.frame(env, k, s, c.p)) || {};
      const stop = o.done || (dur && s >= dur) || (c.def.while && s > 0.3 && !c.def.while(env, c.p));
      if (stop) this.end();
      return o;
    },
    maybeIdle(t) {
      if (!settings || t < this.nextIdle) return;
      const freq = clamp(settings.animationFrequency || 1, 0.3, 3);
      this.nextIdle = t + rand(9, 28) / freq;
      if (!settings.randomAnimations || cat.mode === 'drag' || cat.mode === 'air' || cat.mode === 'hop') return;
      const busy = !['idle', 'sleep', 'done'].includes(status.state);
      const pool = Object.entries(B).filter(([n, d]) => d.idle && (!busy || d.busyOk) && (!d.cond || d.cond(env)) && !this.lastIdle.includes(n));
      if (!pool.length) return;
      const sum = pool.reduce((a, [, d]) => a + (d.weight || 1), 0);
      let r = Math.random() * sum;
      for (const [n, d] of pool) {
        r -= d.weight || 1;
        if (r <= 0) {
          this.lastIdle = [n, ...this.lastIdle].slice(0, 4);
          this.play(n);
          return;
        }
      }
    },
  };

  // ============================================================ kittens --
  const kittens = new Map();
  const KITTEN_PROP = { Explore: 'binoculars', Plan: 'clipboard', 'general-purpose': 'laptop', 'code-reviewer': 'book', 'statusline-setup': 'terminal' };
  function spawnKitten(id, type) {
    if (kittens.size >= 8) return;
    const n = kittens.size;
    const side = n % 2 ? -1 : 1;
    const slot = Math.floor(n / 2);
    const tx = clamp(cat.x + side * (cat.w * 0.85 + slot * cat.w * 0.55), 60, view.w - 60);
    kittens.set(id, { id, type, x: cat.x, y: env.groundY(), tx, state: 'out', t0: now(), flip: side > 0 ? -1 : 1, walkPhase: 0, skin: settings.skin, prop: KITTEN_PROP[type] || pick(['laptop', 'book', 'terminal', 'binoculars']) });
    env.sfx('pop');
    burst('spark', cat.x, cat.y - cat.h * 0.3, 6);
  }
  function returnKitten(id, type) {
    let k = kittens.get(id);
    if (!k) k = [...kittens.values()].find((x) => x.state !== 'home' && x.type === type);
    if (!k) return;
    k.state = 'home';
    k.t0 = now();
  }
  function updateKittens(dt) {
    for (const k of kittens.values()) {
      if (k.state === 'out') {
        const dx = k.tx - k.x;
        if (Math.abs(dx) < 4) { k.state = 'work'; k.flip = 1; }
        else { k.x += Math.sign(dx) * Math.min(Math.abs(dx), 260 * dt); k.walkPhase += dt * 2.6; k.flip = dx > 0 ? -1 : 1; }
        k.y = env.groundY();
      } else if (k.state === 'home') {
        const dx = cat.x - k.x;
        k.y = env.groundY();
        if (Math.abs(dx) < 30) {
          kittens.delete(k.id);
          burst('heart', cat.x, cat.y - cat.h * 0.6, 2);
          env.sfx('purr', 800);
          continue;
        }
        k.x += Math.sign(dx) * Math.min(Math.abs(dx), 300 * dt);
        k.walkPhase += dt * 3;
        k.flip = dx > 0 ? -1 : 1;
      }
    }
  }

  // ============================================================ visitors --
  const visitors = [];
  function addVisitor(v) {
    if (settings.dnd) return;
    const dir = cat.x > view.w / 2 ? 1 : -1; // walk in from the far side
    const startX = dir > 0 ? -120 : view.w + 120;
    visitors.push(Object.assign({ x: startX, y: env.floorY(), dir, state: 'in', t0: now(), walkPhase: 0, stopX: clamp(cat.x - dir * cat.w * 1.25, 80, view.w - 80) }, v));
    env.sfx('chirp');
  }
  function updateVisitors(dt) {
    for (let i = visitors.length - 1; i >= 0; i--) {
      const v = visitors[i];
      v.y = env.floorY();
      if (v.state === 'in') {
        const dx = v.stopX - v.x;
        if (Math.abs(dx) < 4) {
          v.state = 'wave';
          v.t0 = now();
          director.play('visitorWave', { dir: -v.dir });
          const what = { done: 'finished a task', 'git-commit': 'made a commit', 'git-push': 'pushed code', 'tests-pass': 'got green tests', hello: 'joined the café' }[v.event] || 'says hi';
          say(`<b>${esc(v.owner || 'A teammate')}</b>’s cat <b>${esc(v.cat)}</b> ${what}${v.project ? ' in ' + esc(v.project) : ''}! 🐾`, 3800, { html: true });
        } else { v.x += Math.sign(dx) * Math.min(Math.abs(dx), 170 * dt); v.walkPhase += dt * 1.6; }
      } else if (v.state === 'wave') {
        if (now() - v.t0 > 3.2) v.state = 'out';
      } else {
        v.x -= v.dir * 170 * dt;
        v.walkPhase += dt * 1.6;
        if (v.x < -200 || v.x > view.w + 200) visitors.splice(i, 1);
      }
    }
  }

  // ======================================================== particles fx --
  const particles = [];
  const sprites = [];
  const smudges = [];
  function burst(kind, x, y, n, o) {
    o = o || {};
    for (let i = 0; i < (n || 1); i++) {
      const p = { kind, x, y, vx: 0, vy: 0, life: 0, max: 1.4, rot: rand(0, TAU), vr: rand(-4, 4), size: 1, color: '#fff', text: o.text };
      if (kind === 'confetti') { p.vx = rand(-420, 420); p.vy = rand(-760, -260); p.max = rand(1.8, 3); p.color = pick(['#FF5E86', '#FFD54A', '#5FC4BD', '#7A9CFF', '#8FD18A', '#FF9B4A']); p.size = rand(6, 11); }
      else if (kind === 'heart') { p.vx = rand(-20, 20); p.vy = -70; p.max = 1.6; p.size = rand(1, 1.5); }
      else if (kind === 'star' || kind === 'spark') { p.vx = rand(-120, 120); p.vy = rand(-160, -40); p.max = 1; p.size = rand(6, 12); }
      else if (kind === 'dust') { p.vx = rand(-60, 60); p.vy = rand(-50, -10); p.max = 0.8; p.size = rand(6, 14); }
      else if (kind === 'note') { p.vx = rand(-30, 30); p.vy = -60; p.max = 1.8; p.text = pick(['♪', '♫', '♬']); }
      else if (kind === 'text') { p.vy = -50; p.max = 1.2; p.size = o.size || 18; }
      else if (kind === 'dream') { p.vy = -18; p.max = 4; }
      particles.push(p);
    }
  }
  function smudge(x, y) { smudges.push({ x, y, life: 0, max: 9, rot: rand(-0.3, 0.3), k: rand(1.6, 2.1) }); }

  function updateFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life > p.max) { particles.splice(i, 1); continue; }
      if (p.kind === 'confetti') { p.vy += 900 * dt; p.vx *= 0.99; }
      if (p.kind === 'dust') { p.vx *= 0.94; p.size += dt * 10; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = smudges.length - 1; i >= 0; i--) { smudges[i].life += dt; if (smudges[i].life > smudges[i].max) smudges.splice(i, 1); }
    for (let i = sprites.length - 1; i >= 0; i--) {
      const s = sprites[i];
      if (s.kind === 'butterfly' && s.free) { s.x += s.vx * dt; s.y += s.vy * dt; if (s.y < -60 || s.x < -60 || s.x > view.w + 60) s.dead = true; }
      if (s.kind === 'bird') { s.x += s.vx * dt; s.y += Math.sin(now() * 3) * 0.5; if (s.x < -100 || s.x > view.w + 100) s.dead = true; }
      if (s.kind === 'yarn' && s.vx) { s.x += s.vx * dt; s.rot += s.vx * dt / 22; s.vx *= 0.995; if (s.x < -60 || s.x > view.w + 60) s.dead = true; }
      if (s.kind === 'rocket' && s.y < -200) s.dead = true;
      if (s.kind === 'cup' && s.falling && !s.broken) {
        s.vy += 1800 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.rot += s.vx * dt * 0.02;
        if (s.perched && s.y >= s.floor - 16) { s.broken = true; s.y = s.floor - 12; s.rot = 0; s.t1 = now(); env.sfx('crash'); }
        if (!s.perched && s.y > view.h + 40) { s.dead = true; env.sfx('crash'); }
      }
      if (s.kind === 'cup' && s.broken && now() - s.t1 > 5) s.dead = true;
      if (s.kind === 'fishFly') { const u = clamp((now() - s.t0) / 0.8, 0, 1); s.x = lerp(s.x, s.tx, u * 0.25); s.y = lerp(-40, s.ty, ease(u)); s.rot = u * TAU * 1.5; }
      if (s.dead) sprites.splice(i, 1);
    }
  }

  // ============================================================ physics --
  function updateCat(t, dt) {
    cat.walking = false;
    if (cat.mode === 'hop' && cat.hop) {
      const h = cat.hop;
      const u = clamp((t - h.t0) / h.dur, 0, 1);
      cat.x = lerp(h.x0, h.x1, u);
      cat.y = lerp(h.y0, h.y1, u) - Math.sin(u * Math.PI) * h.h;
      if (u >= 1) {
        cat.mode = h.mode;
        cat.hop = null;
        cat.y = h.y1;
        env.squash(1.18, 0.82);
        env.sfx('thud', 200);
        burst('dust', cat.x, cat.y - 4, 4);
      }
    } else if (cat.mode === 'air') {
      cat.vy += 2600 * dt;
      cat.x += cat.vx * dt;
      cat.y += cat.vy * dt;
      cat.rotV = (cat.rotV || 0) * 0.98;
      if (cat.x < cat.w * 0.35) { cat.x = cat.w * 0.35; cat.vx = Math.abs(cat.vx) * 0.5; }
      if (cat.x > view.w - cat.w * 0.35) { cat.x = view.w - cat.w * 0.35; cat.vx = -Math.abs(cat.vx) * 0.5; }
      if (cat.y < cat.h * 0.9) { cat.y = cat.h * 0.9; cat.vy = Math.abs(cat.vy) * 0.3; }
      const floor = env.floorY();
      if (cat.y >= floor && cat.vy > 0) {
        const hard = cat.vy > 1500;
        cat.y = floor;
        cat.mode = 'floor';
        cat.perch = null;
        cat.vx = 0;
        cat.vy = 0;
        cat.spin = 0;
        env.squash(1.25, 0.75);
        env.sfx('thud');
        burst('dust', cat.x, cat.y - 4, 6);
        if (hard) director.play('dizzy', {}, true);
        savePos();
      }
    } else if (cat.mode === 'floor') {
      cat.y = env.floorY();
    } else if (cat.mode === 'perch' && cat.perch) {
      cat.y = cat.perch.y;
    }
    if (cat.spin) cat.spinAngle = (cat.spinAngle || 0) + cat.spin * dt;
    // squash spring
    cat.sqT += dt;
    const damp = Math.exp(-cat.sqT * 8) * Math.cos(cat.sqT * 24);
    cat.sq.x = 1 + (cat.sq0.x - 1) * damp;
    cat.sq.y = 1 + (cat.sq0.y - 1) * damp;
    // context window → chonk
    const c = status.context || { tokens: 0, window: 200000 };
    const target = status.sessions && status.sessions.length ? clamp((c.tokens / (c.window || 200000)) * 1.15, 0.06, 1) : 0.15;
    cat.fat += (clamp(target + cat.fatBoost, 0, 1.15) - cat.fat) * Math.min(1, dt * (cat.fatBoost ? 0.8 : 1.6));
  }

  // Perched cats check that their window is still where they left it.
  let perchCheck = 0;
  function checkPerch(t) {
    if (cat.mode !== 'perch' || !cat.perch || t < perchCheck) return;
    perchCheck = t + 0.7;
    api.foregroundWindow().then((w) => {
      if (cat.mode !== 'perch' || !cat.perch) return;
      const p = cat.perch;
      if (!w || w.id !== p.id) {
        // window lost focus — it may be covered now; hop down to stay visible
        director.play('hopDown', {}, true);
        return;
      }
      const dx = w.x - p.x, dy = w.y - p.y;
      if (Math.abs(dy) > 30 || Math.abs(dx) > 60) {
        cat.mode = 'air';
        cat.vx = dx * 2;
        cat.vy = -200;
        cat.perch = null;
        say(pick(['Whoa!', 'Hey, I was sitting there!', 'Earthquake!!']), 1400);
        env.sfx('meow');
      } else {
        cat.x += dx;
        Object.assign(p, { x: w.x, y: w.y, w: w.w, h: w.h });
      }
    });
  }

  // ============================================================ rendering --
  const PROP_BY_ACT = { typing: 'laptop', reading: 'book', terminal: 'terminal', testing: 'terminal', building: 'terminal', installing: 'terminal', 'git-commit': 'terminal', 'git-push': 'terminal', browsing: 'binoculars', planning: 'clipboard', plugging: 'laptop', skill: 'book', working: 'laptop' };

  function baseOpts() {
    const st = status.state;
    const o = { state: st };
    if (st === 'working') {
      o.prop = PROP_BY_ACT[status.activity];
      if (status.activity === 'reading') o.eyes = 'half';
      if (status.activity === 'compacting') { o.mouth = 'munch'; o.eyes = 'closed'; o.prop = undefined; }
      if (status.activity === 'delegating') o.look = { x: Math.sin(now() * 0.8), y: 0.3 };
    }
    if (st === 'needs') o.wave = 1;
    if (st === 'sleep') { o.pose = 'sleep'; if (env.night()) o.hat = 'nightcap'; }
    if (settings.seasonal && !o.hat && env.month() === 9 && (st === 'idle' || st === 'sleep')) o.hat = 'pumpkin';
    return o;
  }

  let ov = {};
  const catCache = new Map();
  const miniCache = new Map();
  let lastAnchor = null;
  function renderCat(t) {
    const base = baseOpts();
    if (director.cur && base.pose === 'sleep' && !ov.pose) delete base.pose; // behaviours wake her up
    const o = Object.assign(base, stripUndef(ov));
    // eyes follow the cursor unless a behaviour is steering the gaze
    let look = o.look;
    if (!look) {
      if (cursor.inside && Math.hypot(cursor.x - cat.x, cursor.y - cat.y) < 900) {
        look = { x: clamp(((cursor.x - cat.x) / 380) * cat.flip, -1, 1), y: clamp((cursor.y - env.headTopY() - cat.h * 0.3) / 380, -1, 1) };
      } else look = { x: 0, y: 0 };
    }
    cat.look.x += (look.x - cat.look.x) * 0.25;
    cat.look.y += (look.y - cat.look.y) * 0.25;
    const opts = Object.assign({}, o, {
      skin: settings.skin,
      t,
      fat: cat.fat,
      look: cat.look,
      walkPhase: o.walkPhase != null ? o.walkPhase : cat.walkPhase,
      pose: o.pose || (cat.walking ? 'walk' : undefined),
      burp: o.burp || 0,
      cache: catCache,
    });
    if (opts.pose === undefined) delete opts.pose;
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, catEl.width, catEl.height);
    const k = catEl.width / A.W;
    cctx.setTransform(k, 0, 0, k, 0, 0);
    const r = A.draw(cctx, opts);
    lastAnchor = r.anchor;
    cat.anchor = r.anchor;
  }

  let lastTf = '';
  function placeCat() {
    const flip = ov.flip != null ? ov.flip : cat.flip;
    cat.flipDraw = flip;
    const left = cat.x - cat.w / 2 + (ov.dx || 0);
    const top = cat.y - cat.h * FOOT + (ov.dy || 0);
    const rot = (ov.rot || 0) + (cat.spinAngle || 0);
    const sx = (ov.sx || 1) * cat.sq.x * flip;
    const sy = (ov.sy || 1) * cat.sq.y;
    const tf = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0) rotate(${rot.toFixed(3)}rad) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
    if (tf !== lastTf) { catEl.style.transform = tf; lastTf = tf; }
  }

  function drawFx(t) {
    const active = particles.length || sprites.length || smudges.length || kittens.size || visitors.length;
    if (!active && !fxDirty) return;
    fxDirty = !!active;
    const d = fxEl.width / view.w;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fxEl.width, fxEl.height);
    fctx.setTransform(d, 0, 0, d, 0, 0);
    for (const s of smudges) A.drawPawPrint(fctx, s.x, s.y, s.k, 0.35 * (1 - s.life / s.max), 'rgba(120, 80, 60, 1)');
    for (const v of visitors) {
      const opts = { skin: v.skin, t, fat: 0.3, pose: v.state === 'wave' ? 'sit' : 'walk', walkPhase: v.walkPhase, wave: v.state === 'wave' ? 1 : 0, eyes: v.state === 'wave' ? 'happy' : undefined };
      drawMini(v.x, v.y, cat.w * 0.82, v.state === 'wave' ? 1 : (v.dir > 0 ? -1 : 1) * (v.state === 'out' ? -1 : 1), opts);
      nameTag(v.x, v.y - cat.h * 0.82, v.cat);
    }
    for (const k of kittens.values()) {
      const walking = k.state !== 'work';
      const opts = { skin: k.skin, t: t + k.x * 0.01, kitten: true, fat: 0, pose: walking ? 'walk' : 'sit', walkPhase: k.walkPhase, prop: !walking ? k.prop : undefined, raise: k.state === 'home' ? { side: 1, x: 236, y: 250, r: 18, hold: 'fish' } : undefined };
      drawMini(k.x, k.y, cat.w * 0.62, k.flip, opts);
      nameTag(k.x, k.y - cat.w * 0.62 * 0.86, k.type);
    }
    for (const s of sprites) {
      if (s.kind === 'butterfly') A.drawButterfly(fctx, s.x, s.y, 1, t * 14, s.color);
      else if (s.kind === 'bird') A.drawBird(fctx, s.x, s.y, 1, t * 16, s.dir);
      else if (s.kind === 'yarn') A.drawYarn(fctx, s.x, s.y, s.r, s.rot, '#E45B8F');
      else if (s.kind === 'rocket') { A.drawRocket(fctx, s.x, s.y, 0.8, t); if (s.parcel) A.drawParcel(fctx, null, s.x, s.y - 70, 0.55, 1); }
      else if (s.kind === 'cup') A.drawCup(fctx, s.x, s.y, s.rot, 0.9, s.broken);
      else if (s.kind === 'fishFly') { fctx.save(); fctx.translate(s.x, s.y); fctx.rotate(s.rot); A.drawFish(fctx, 0, 0, 0.9, 0); fctx.restore(); }
    }
    for (const p of particles) {
      const a = 1 - p.life / p.max;
      fctx.save();
      fctx.globalAlpha = clamp(a * 1.4, 0, 1);
      if (p.kind === 'confetti') { fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillStyle = p.color; fctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
      else if (p.kind === 'heart') A.heart(fctx, p.x, p.y, p.size, '#FF6F91', clamp(a * 1.4, 0, 1));
      else if (p.kind === 'star' || p.kind === 'spark') A.star4(fctx, p.x, p.y, p.size * (0.5 + a * 0.5), '#FFD54A', 8);
      else if (p.kind === 'dust') { fctx.fillStyle = 'rgba(230, 215, 195, 0.8)'; fctx.beginPath(); fctx.arc(p.x, p.y, p.size, 0, TAU); fctx.fill(); }
      else if (p.kind === 'note') { fctx.fillStyle = '#7A6CFF'; fctx.font = 'bold 26px "Segoe UI Symbol", sans-serif'; fctx.fillText(p.text, p.x, p.y); }
      else if (p.kind === 'text') { fctx.fillStyle = '#5A2D14'; fctx.font = `bold ${p.size}px "Trebuchet MS", sans-serif`; fctx.strokeStyle = 'rgba(255,255,255,0.9)'; fctx.lineWidth = 4; fctx.strokeText(p.text, p.x, p.y); fctx.fillText(p.text, p.x, p.y); }
      else if (p.kind === 'dream') {
        fctx.globalAlpha = Math.sin((p.life / p.max) * Math.PI);
        fctx.fillStyle = '#FFFFFF'; fctx.strokeStyle = '#5A2D14'; fctx.lineWidth = 2.5;
        fctx.beginPath(); fctx.ellipse(p.x, p.y, 34, 24, 0, 0, TAU); fctx.fill(); fctx.stroke();
        A.drawFish(fctx, p.x, p.y, 0.6, Math.sin(p.life * 4) * 0.2);
      }
      fctx.restore();
    }
  }
  let fxDirty = false;

  function drawMini(x, y, w, flip, opts) {
    const k = w / A.W;
    fctx.save();
    fctx.translate(x, y);
    fctx.scale(k * flip, k);
    fctx.translate(-A.CX, -A.GROUND);
    opts.cache = miniCache;
    A.draw(fctx, opts);
    fctx.restore();
  }

  function nameTag(x, y, text) {
    if (!text) return;
    fctx.save();
    fctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    const w = fctx.measureText(text).width + 12;
    fctx.fillStyle = 'rgba(255, 250, 242, 0.95)';
    fctx.strokeStyle = 'rgba(90, 45, 20, 0.7)';
    fctx.lineWidth = 1.5;
    fctx.beginPath();
    if (fctx.roundRect) fctx.roundRect(x - w / 2, y - 16, w, 16, 8); else fctx.rect(x - w / 2, y - 16, w, 16);
    fctx.fill();
    fctx.stroke();
    fctx.fillStyle = '#5A2D14';
    fctx.textAlign = 'center';
    fctx.fillText(text, x, y - 4);
    fctx.restore();
  }

  // ================================================================== UI --
  const bubbleEl = $('bubble');
  const statusEl = $('status');
  const rosterEl = $('roster');
  const permEl = $('perm');
  const menuEl = $('menu');
  const askEl = $('ask');
  const toastEl = $('toast');
  let bubbleUntil = 0;
  let bubbleSticky = false;
  let toastUntil = 0;
  let statusUntil = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function stripUndef(o) { const r = {}; for (const k in o) if (o[k] !== undefined) r[k] = o[k]; return r; }
  function firstSentence(s) { const m = String(s).match(/^(.{20,180}?[.!?])(\s|$)/); return (m ? m[1] : String(s).slice(0, 160)).replace(/[`*_#>]/g, ''); }

  function say(text, ms, opts) {
    opts = opts || {};
    if (opts.html) bubbleEl.innerHTML = text; else bubbleEl.textContent = text;
    bubbleEl.classList.remove('hidden');
    bubbleEl.style.animation = 'none';
    void bubbleEl.offsetWidth;
    bubbleEl.style.animation = '';
    bubbleUntil = now() + (ms || 3000) / 1000;
    bubbleSticky = !!opts.sticky;
  }
  function hideBubble() { bubbleEl.classList.add('hidden'); bubbleUntil = 0; bubbleSticky = false; }
  function toast(text, ms) {
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    toastEl.style.animation = 'none';
    void toastEl.offsetWidth;
    toastEl.style.animation = '';
    toastUntil = now() + (ms || 2200) / 1000;
  }

  function dotColor(st) { return { needs: '#F08A3C', danger: '#E5484D', error: '#E5484D', working: '#4F9BEA', thinking: '#9B6CFF', done: '#3BB273', idle: '#C9B79C', sleep: '#7A6A5A' }[st] || '#C9B79C'; }

  function showStatusLine() {
    if (!settings.showStatusLine) return;
    const pct = status.context && status.context.window ? Math.round((status.context.tokens / status.context.window) * 100) : 0;
    const extra = status.sessions.length > 1 ? ` · ${status.sessions.length} sessions` : '';
    const belly = status.sessions.length ? ` · belly ${pct}%` : '';
    statusEl.innerHTML = `<span class="dot" style="background:${dotColor(status.state)}"></span>${esc(status.detail || status.state)}${belly}${extra}`;
    statusEl.classList.remove('hidden');
    statusUntil = now() + (status.state === 'needs' || status.state === 'danger' ? 999 : 4);
  }

  function renderRoster() {
    const ss = status.sessions || [];
    let html = `<h4>${esc(settings.name)} is watching ${ss.length || 'no'} session${ss.length === 1 ? '' : 's'}</h4>`;
    for (const s of ss.slice(0, 6)) {
      const pct = s.context && s.context.window ? Math.round((s.context.tokens / s.context.window) * 100) : 0;
      html += `<div class="row"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor(s.state)}"></span><span class="name">${esc(s.project)}</span><span class="what">${esc(s.detail || s.state)}</span></div>`;
      html += `<div class="meter" title="context ${pct}%"><i style="width:${clamp(pct, 2, 100)}%"></i></div>`;
      if (s.subagents && s.subagents.length) html += `<div class="row" style="padding-left:16px"><span class="what">🐱 ${s.subagents.map((k) => esc(k.type)).join(', ')}</span></div>`;
    }
    html += `<div class="foot">🐟 ${stats.fish} fish · 🔥 ${stats.streakDays}-day streak · ✓ ${stats.today ? stats.today.tasks : 0} today</div>`;
    rosterEl.innerHTML = html;
  }

  // ---- permission card (paw approval)
  let perm = null;
  function permVisible() { return !!perm; }
  function showPermission(p) {
    if (!settings.pawApproval) { api.decide(p.id, null); return; }
    perm = Object.assign({ t0: now(), armed: false }, p);
    const cmd = p.input && (p.input.command || p.input.file_path || p.input.url || p.input.pattern) || JSON.stringify(p.input || {}).slice(0, 200);
    const risky = /\b(rm\s+-|remove-item|git\s+push|reset\s+--hard|drop\s+table|truncate|mkfs|format|shutdown|publish)\b/i.test(cmd);
    perm.risky = risky;
    permEl.querySelector('.perm-title').textContent = `${p.project || 'Claude'} wants to use ${p.tool}`;
    permEl.querySelector('.perm-cmd').textContent = cmd;
    permEl.classList.toggle('danger', risky);
    const allow = permEl.querySelector('.allow');
    allow.textContent = 'Allow 🐾';
    allow.classList.remove('confirm');
    permEl.classList.remove('hidden');
    hideBubble();
    const bar = permEl.querySelector('.perm-timer span');
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth;
    bar.style.transition = `transform ${p.timeout || 25}s linear`;
    bar.style.transform = 'scaleX(0)';
    if (!(director.cur && director.cur.name === 'needsYou')) director.play('needsYou', {}, true);
  }
  function hidePermission(id) {
    if (!perm || (id && perm.id !== id)) return;
    perm = null;
    permEl.classList.add('hidden');
  }
  permEl.querySelector('.allow').addEventListener('click', (e) => {
    if (!perm) return;
    if (perm.risky && !perm.armed) {
      perm.armed = true;
      e.currentTarget.textContent = 'Really? Click again';
      e.currentTarget.classList.add('confirm');
      env.sfx('hiss');
      return;
    }
    api.decide(perm.id, 'allow');
    env.sfx('pop');
    hidePermission();
  });
  permEl.querySelector('.deny').addEventListener('click', () => { if (perm) { api.decide(perm.id, 'deny'); hidePermission(); env.sfx('boop'); } });
  permEl.querySelector('.later').addEventListener('click', () => { if (perm) { api.decide(perm.id, null); hidePermission(); } });

  // ---- context menu
  function showMenu(x, y) {
    const fishN = stats.fish || 0;
    const items = [
      ['meta', `${esc(settings.name)} · 🐟 ${fishN} · 🔥 ${stats.streakDays || 0}`],
      ['ask', `💬 Ask ${esc(settings.name)}…`],
      ['feed', `🐟 Feed a fish (${fishN})`],
      ['play', '🎾 Play!'],
      ['nap', status.state === 'sleep' || (director.cur && director.cur.name === 'nap') ? '☀️ Wake up' : '😴 Nap'],
      ['box', '📦 Sit in a box'],
      ['hr'],
      ['dnd', settings.dnd ? '🔔 Turn off Do Not Disturb' : '🔕 Do Not Disturb'],
      ['settings', '⚙️ Settings…'],
      ['hide', '🙈 Hide (Ctrl+Alt+A)'],
      ['quit', '✖ Quit'],
    ];
    menuEl.innerHTML = items.map(([id, label]) => (id === 'hr' ? '<hr>' : id === 'meta' ? `<div class="meta">${label}</div>` : `<button data-id="${id}" role="menuitem">${label}</button>`)).join('');
    menuEl.classList.remove('hidden');
    const r = menuEl.getBoundingClientRect();
    menuEl.style.transform = `translate(${clamp(x, 6, view.w - r.width - 6)}px, ${clamp(y - r.height, 6, view.h - r.height - 6)}px)`;
    api.focusOverlay(true);
    const first = menuEl.querySelector('button');
    if (first) first.focus();
  }
  function hideMenu() { menuEl.classList.add('hidden'); }
  menuEl.addEventListener('click', (e) => {
    const id = e.target.closest('button') && e.target.closest('button').dataset.id;
    if (!id) return;
    hideMenu();
    if (id === 'ask') openAsk();
    else if (id === 'feed') director.play('eatFish', {}, true);
    else if (id === 'play') director.play(pick(['yarn', 'butterfly', 'zoomies', 'dance', 'tailChase', 'roll']), {}, true);
    else if (id === 'nap') director.play(director.cur && director.cur.name === 'nap' ? 'shakeFur' : 'nap', {}, true);
    else if (id === 'box') director.play('box', {}, true);
    else if (id === 'dnd') api.saveSettings({ dnd: !settings.dnd });
    else if (id === 'settings') api.openSettings();
    else if (id === 'hide') toggleHidden();
    else if (id === 'quit') api.quit();
  });

  // ---- ask box
  function openAsk() {
    askEl.classList.remove('hidden');
    api.focusOverlay(true);
    const input = $('ask-input');
    input.value = '';
    setTimeout(() => input.focus(), 30);
  }
  askEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('ask-input').value.trim();
    askEl.classList.add('hidden');
    const a = await api.ask(q);
    env.sfx('mrrp');
    director.play('meowQuiet', {}, true);
    say(a, Math.min(14000, 2500 + a.length * 45));
  });
  B.needsPreview = {
    pri: 6, dur: 5,
    start(e) { e.sfx('meow'); e.say('<b>my-project</b> needs you:\nWants to run npm install', 4500, { html: true }); },
    frame: (e, k) => ({ state: 'needs', wave: k < 0.6 ? 1 : 0, knock: k >= 0.6 ? 1 : 0 }),
  };
  B.feastPreview = Object.assign({}, B.feast, { dur: 4, while: undefined });
  B.meowQuiet = { pri: 3, dur: 1.2, frame: (e, k) => ({ mouth: k < 0.4 ? 'meow' : 'w', ears: 'perk' }) };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideMenu(); askEl.classList.add('hidden'); } });
  document.addEventListener('pointerdown', (e) => {
    if (!menuEl.contains(e.target)) hideMenu();
    if (!askEl.contains(e.target) && e.target !== catEl) askEl.classList.add('hidden');
  });
  window.addEventListener('blur', () => { hideMenu(); });

  let hiddenCat = false;
  function toggleHidden() { hiddenCat = !hiddenCat; catEl.style.visibility = hiddenCat ? 'hidden' : ''; }

  // =========================================================== pointer --
  const hover = { on: false, since: 0 };
  let drag = null;
  let lastClick = 0;
  let clickTimer = null;
  catEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    catEl.setPointerCapture(e.pointerId);
    const ex = e.clientX + vp.x, ey = e.clientY + vp.y;
    drag = { id: e.pointerId, sx: ex, sy: ey, ox: cat.x - ex, oy: cat.y - ey, moved: false, hist: [[ex, ey, now()]] };
  });
  catEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const ex = e.clientX + vp.x, ey = e.clientY + vp.y;
    drag.hist.push([ex, ey, now()]);
    if (drag.hist.length > 6) drag.hist.shift();
    if (!drag.moved && Math.hypot(ex - drag.sx, ey - drag.sy) > 6) {
      drag.moved = true;
      director.end();
      cat.mode = 'drag';
      cat.perch = null;
      cat.hop = null;
      catEl.classList.add('dragging');
      env.sfx('meow', 1500);
      hideBubble();
    }
    if (drag.moved) {
      cat.x = ex + drag.ox;
      cat.y = ey + drag.oy;
    }
  });
  catEl.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    catEl.classList.remove('dragging');
    if (d.moved) {
      const a = d.hist[0], b = d.hist[d.hist.length - 1];
      const dt = Math.max(0.016, b[2] - a[2]);
      cat.vx = clamp((b[0] - a[0]) / dt, -2600, 2600);
      cat.vy = clamp((b[1] - a[1]) / dt, -2600, 2600);
      cat.mode = 'air';
      cat.spin = Math.abs(cat.vx) > 900 ? Math.sign(cat.vx) * 10 : 0;
      cat.spinAngle = 0;
      if (cat.x < 0 || cat.x > view.w) api.moveDisplay({ x: cat.x, y: cat.y }).then((b2) => { if (b2) { cat.x = cat.x < 0 ? b2.width - cat.w : cat.w; cat.y = 0; resize(b2); } });
      return;
    }
    const t = Date.now();
    if (t - lastClick < 320) {
      clearTimeout(clickTimer);
      lastClick = 0;
      director.play('jump', {}, true);
    } else {
      lastClick = t;
      clickTimer = setTimeout(() => {
        if (director.cur && director.cur.name === 'breakTime') { director.end(); say('Okay okay, back to work 😼', 1500); return; }
        director.play('boop', {}, true);
        if (status.sessions.length) showStatusLine();
      }, 260);
    }
  });
  catEl.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu(e.clientX + vp.x, e.clientY + vp.y); });
  catEl.addEventListener('pointerenter', () => { hover.on = true; hover.since = now(); });
  catEl.addEventListener('pointerleave', () => { hover.on = false; rosterEl.classList.add('hidden'); });

  function updateHover(t) {
    if (hover.on && !drag) {
      if (t - hover.since > 0.6 && rosterEl.classList.contains('hidden')) { renderRoster(); rosterEl.classList.remove('hidden'); }
      if (t - hover.since > 1.4 && (!director.cur || director.cur.def.pri < 2)) director.play('purr');
    }
  }

  // cursor play: if the pointer rests near Arshia, she stalks and pounces on it
  function updateCursorPlay(t) {
    if (!settings.cursorPlay || !cursor.inside || drag || hover.on) return;
    if (director.cur || status.state === 'needs' || status.state === 'danger' || status.state === 'sleep') return;
    const near = Math.abs(cursor.x - cat.x) < 340 && Math.abs(cursor.x - cat.x) > cat.w * 0.6 && Math.abs(cursor.y - cat.y) < 140;
    if (near && t - cursor.lastMove > 1.6 && t - cursor.lastMove < 1.7 && Math.random() < 0.5) director.play('chaseCursor');
  }

  // ============================================================== layout --
  function positionUI(t) {
    const headY = env.headTopY();
    const topY = Math.min(headY, cat.y - cat.h * 0.75);
    let y = topY - 8;
    if (!statusEl.classList.contains('hidden')) {
      if (t > statusUntil) statusEl.classList.add('hidden');
      else {
        const r = statusEl.getBoundingClientRect();
        statusEl.style.transform = `translate(${clamp(cat.x - r.width / 2, 4, view.w - r.width - 4)}px, ${clamp(y - r.height, 4, view.h - r.height)}px)`;
        y -= r.height + 6;
      }
    }
    if (!bubbleEl.classList.contains('hidden')) {
      if (!bubbleSticky && t > bubbleUntil) hideBubble();
      else {
        const r = bubbleEl.getBoundingClientRect();
        const bx = clamp(cat.x - r.width / 2, 6, view.w - r.width - 6);
        bubbleEl.style.setProperty('--tail', `${clamp(cat.x - bx, 18, r.width - 18)}px`);
        bubbleEl.style.transform = `translate(${bx}px, ${clamp(y - r.height - 10, 4, view.h - r.height - 4)}px)`;
        y -= r.height + 16;
      }
    }
    if (!toastEl.classList.contains('hidden')) {
      if (t > toastUntil) toastEl.classList.add('hidden');
      else {
        const r = toastEl.getBoundingClientRect();
        const side = cat.x > view.w / 2 ? -1 : 1;
        const tx = side > 0 ? cat.x + cat.w * 0.45 : cat.x - cat.w * 0.45 - r.width;
        toastEl.style.transform = `translate(${clamp(tx, 6, view.w - r.width - 6)}px, ${clamp(cat.y - cat.h * 0.55, 6, view.h - r.height - 6)}px)`;
      }
    }
    const side = cat.x > view.w / 2 ? -1 : 1;
    for (const el of [rosterEl, permEl, askEl]) {
      if (el.classList.contains('hidden')) continue;
      const r = el.getBoundingClientRect();
      const px = side > 0 ? cat.x + cat.w * 0.42 : cat.x - cat.w * 0.42 - r.width;
      const py = el === askEl ? headY - r.height - 12 : cat.y - r.height - cat.h * 0.15;
      el.style.transform = `translate(${clamp(px, 6, view.w - r.width - 6)}px, ${clamp(py, 6, view.h - r.height - 6)}px)`;
    }
  }

  let lastRects = '';
  let rectTimer = 0;
  function sendHitRects(t) {
    if (t < rectTimer) return;
    rectTimer = t + 0.08;
    let rects;
    if (drag && drag.moved) rects = [{ x: 0, y: 0, w: view.w, h: view.h }];
    else {
      rects = [];
      if (!hiddenCat) {
        const a = cat.anchor;
        const top = cat.y + (a.headTop + 30 - A.GROUND) * cat.k;
        const half = (a.bodyRx + 30) * cat.k;
        rects.push({ x: Math.round(cat.x - half), y: Math.round(top), w: Math.round(half * 2), h: Math.round(cat.y - top) });
      }
      for (const el of [permEl, menuEl, askEl]) {
        if (el.classList.contains('hidden')) continue;
        const r = el.getBoundingClientRect();
        rects.push({ x: Math.round(r.left + vp.x), y: Math.round(r.top + vp.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    const key = JSON.stringify(rects);
    if (key !== lastRects) { lastRects = key; api.setHitRects(rects); }
  }

  // ============================================================ wiring --
  let posTimer = null;
  function savePos() {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => api.savePosition({ x: Math.round(cat.x) }), 1500);
  }

  function sizeCat() {
    const dpr = window.devicePixelRatio || 1;
    cat.w = settings.size;
    cat.h = Math.round((cat.w * A.H) / A.W);
    cat.k = cat.w / A.W;
    catEl.width = Math.round(cat.w * dpr);
    catEl.height = Math.round(cat.h * dpr);
    catEl.style.width = cat.w + 'px';
    catEl.style.height = cat.h + 'px';
    catEl.style.transformOrigin = `50% ${(FOOT * 100).toFixed(2)}%`;
  }

  function resize(bounds) {
    if (bounds && bounds.width) { view.w = bounds.width; view.h = bounds.height; }
    stageEl.style.width = view.w + 'px';
    stageEl.style.height = view.h + 'px';
    fxEl.style.width = view.w + 'px';
    fxEl.style.height = view.h + 'px';
    Object.assign(vp, { x: 0, y: 0, w: view.w, h: view.h });
    stageEl.style.transform = 'translate(0px, 0px)';
    const dpr = window.devicePixelRatio || 1;
    fxEl.width = Math.round(view.w * dpr);
    fxEl.height = Math.round(view.h * dpr);
    cat.x = clamp(cat.x, cat.w * 0.4, view.w - cat.w * 0.4);
    if (cat.mode === 'floor') cat.y = env.floorY();
    fxDirty = true;
  }

  function applySettings(s) {
    const sizeChanged = !settings || s.size !== settings.size;
    const skinChanged = !settings || s.skin !== settings.skin;
    settings = s;
    SND.configure({ volume: s.volume, enabled: s.sounds && !s.dnd });
    if (sizeChanged) { sizeCat(); catCache.clear(); miniCache.clear(); }
    if (skinChanged) { catCache.clear(); miniCache.clear(); }
    if (skinChanged) makeTrayIcon();
  }

  function onStatus(s) {
    const prev = status;
    status = s;
    if (prev.state !== s.state || prev.detail !== s.detail) {
      statusSince = now();
      if (s.state !== 'sleep' && s.state !== 'idle') showStatusLine();
    }
    if ((s.state === 'needs' || s.state === 'danger') && !(director.cur && director.cur.name === 'needsYou')) director.play('needsYou');
    if (s.state === 'error' && /rate|limit|resting/i.test(s.detail || '') && !(director.cur && director.cur.name === 'rateLimit')) director.play('rateLimit');
    if (!rosterEl.classList.contains('hidden')) renderRoster();
  }

  function onFx(fx) {
    if (fx.type === 'kitten-spawn') { spawnKitten(fx.agentId, fx.agentType); director.play('perk'); return; }
    if (fx.type === 'kitten-return') { returnKitten(fx.agentId, fx.agentType); return; }
    if (fx.type === 'cafe-visit') { addVisitor(fx); return; }
    if (fx.type === 'session-start') { director.play('wakeUp', { project: fx.project, prev: status.state }); return; }
    if (fx.preview && (fx.type === 'needs' || fx.type === 'permission')) { director.play('needsPreview', {}, true); return; }
    if (fx.preview && fx.type === 'compact-start') { director.play('feastPreview', {}, true); return; }
    const name = FX_TO_BEHAVIOR[fx.type];
    if (!name) return;
    if (fx.type === 'danger') director.play('hiss', { risk: fx.risk });
    else director.play(name, fx);
  }

  function makeTrayIcon() {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      const k = 64 / 250;
      x.setTransform(k, 0, 0, k, -(A.CX - 125) * k, -28 * k);
      A.draw(x, { skin: settings.skin, t: 0.5, fat: 0.2, eyes: 'happy', mouth: 'w' });
      api.trayIcon(c.toDataURL('image/png'));
    } catch (e) { /* ignore */ }
  }

  // ============================================================ viewport --
  // Transparent windows cost GPU time in proportion to their area, so the window
  // hugs Arshia (plus room for bubbles) and only grows when the scene needs it.
  function updateViewport(t) {
    if (vp.pending) return;
    const big = kittens.size > 0 || visitors.length > 0 || sprites.length > 0 || smudges.length > 0 || cat.mode === 'drag' || cat.mode === 'air' || cat.mode === 'hop' || particles.some((p) => p.kind === 'confetti' || p.kind === 'dream');
    let want;
    if (big) {
      vp.compactSince = 0;
      want = { x: 0, y: 0, w: view.w, h: view.h };
    } else {
      if (!vp.compactSince) vp.compactSince = t;
      const pad = 340;
      const box = { x: cat.x - pad, y: cat.y - cat.h - 330, x2: cat.x + pad, y2: cat.y + 8 };
      const inside = box.x >= vp.x - 2 && box.x2 <= vp.x + vp.w + 2 && box.y >= vp.y - 2 && box.y2 <= vp.y + vp.h + 2;
      const isFull = vp.w >= view.w && vp.h >= view.h;
      if (inside && !(isFull && t - vp.compactSince > 1.2)) return;
      if (isFull && t - vp.compactSince < 1.2) return; // let effects finish before shrinking
      const w = Math.min(view.w, pad * 2 + 160);
      const hh = Math.min(view.h, cat.h + 330 + 8 + 60);
      want = { x: clamp(cat.x - w / 2, 0, view.w - w), y: clamp(box.y - 30, 0, view.h - hh), w, h: hh };
    }
    if (Math.abs(want.x - vp.x) < 1 && Math.abs(want.y - vp.y) < 1 && Math.abs(want.w - vp.w) < 1 && Math.abs(want.h - vp.h) < 1) return;
    vp.pending = true;
    Promise.resolve(api.setViewport(want)).then((got) => {
      vp.pending = false;
      if (!got) return;
      Object.assign(vp, { x: got.x, y: got.y, w: got.w, h: got.h });
      stageEl.style.transform = `translate(${-got.x}px, ${-got.y}px)`;
    }, () => { vp.pending = false; });
  }

  // ============================================================== loop --
  let lastT = now();
  const perf = { t0: now(), ms: 0, frames: 0, ticks: 0, moving: 0 };
  let drawAcc = 1;
  function loop() {
    const t = now();
    const dt = Math.min(0.05, t - lastT);
    lastT = t;
    env.t = t;
    env.dt = dt;
    ov = director.update(t);
    updateCat(t, dt);
    updateKittens(dt);
    updateVisitors(dt);
    updateFx(dt);
    updateHover(t);
    updateCursorPlay(t);
    checkPerch(t);
    // "moving" needs 60 Hz for smooth motion; "active" just needs the normal animation rate
    const moving = cat.walking || cat.mode === 'air' || cat.mode === 'hop' || cat.mode === 'drag' || particles.length > 0 || sprites.length > 0 || visitors.length > 0 || [...kittens.values()].some((k) => k.state !== 'work') || cat.sqT < 0.5 || !!ov.dx || !!ov.dy || !!ov.rot;
    const active = moving || !!director.cur || kittens.size > 0 || hover.on;
    const calm = !active && (status.state === 'idle' || status.state === 'sleep');
    const base = settings.fps || 24;
    const fps = calm ? (status.state === 'sleep' ? Math.min(8, base) : Math.min(12, base)) : !active ? Math.min(20, base) : base;
    drawAcc += dt;
    if (drawAcc >= 1 / fps - 0.004) {
      drawAcc = 0;
      const p0 = performance.now();
      if (!hiddenCat) renderCat(t);
      drawFx(t);
      perf.ms += performance.now() - p0;
      perf.frames++;
    }
    perf.ticks++;
    if (moving) perf.moving++;
    if (t - perf.t0 > 15) {
      console.log(`perf: ${perf.frames} frames, ${(perf.ms / Math.max(1, perf.frames)).toFixed(2)} ms/frame, ${perf.ticks} ticks, moving ${Math.round((perf.moving / Math.max(1, perf.ticks)) * 100)}%, behaviour ${director.cur ? director.cur.name : '-'}`);
      Object.assign(perf, { t0: t, ms: 0, frames: 0, ticks: 0, moving: 0 });
    }
    placeCat();
    positionUI(t);
    updateViewport(t);
    sendHitRects(t);
    // when nothing moves, sleep between frames instead of spinning at 60 Hz
    if (moving) requestAnimationFrame(loop);
    else setTimeout(loop, 1000 / fps);
  }

  async function boot() {
    const init = await api.init();
    applySettings(init.settings);
    stats = init.stats || stats;
    status = init.status || status;
    resize(init.bounds);
    const p = settings.position;
    cat.x = p && p.x != null ? clamp(p.x, cat.w * 0.5, view.w - cat.w * 0.5) : view.w - cat.w * 0.9;
    cat.y = env.floorY();
    api.onStatus(onStatus);
    api.onFx(onFx);
    api.onStats((s) => { stats = s; });
    api.onSettings(applySettings);
    api.onCursor((c) => {
      if (Math.abs(c.x - cursor.x) > 1 || Math.abs(c.y - cursor.y) > 1) cursor.lastMove = now();
      cursor.x = c.x; cursor.y = c.y; cursor.inside = c.inside;
    });
    api.onBounds((b) => resize(b));
    api.onPermission(showPermission);
    api.onPermissionResolved((r) => hidePermission(r.id));
    makeTrayIcon();
    requestAnimationFrame(loop);
    setTimeout(() => director.play('hello'), 700);
  }

  // ---------------------------------------------------- browser demo api --
  function mockApi() {
    const listeners = {};
    const on = (ch) => (cb) => { (listeners[ch] = listeners[ch] || []).push(cb); };
    const emit = (ch, d) => (listeners[ch] || []).forEach((f) => f(d));
    const mockSettings = { name: 'Arshia', skin: 'tabby', size: 190, fps: 30, sounds: false, volume: 0.4, showStatusLine: true, pawApproval: true, pawApprovalTimeout: 25, randomAnimations: true, animationFrequency: 1, desktopAwareness: false, runToWindow: false, perchOnWindows: false, cursorPlay: true, seasonal: true, dnd: false };
    const mockStats = { fish: 3, streakDays: 4, today: { tasks: 2, minutesWorking: 30 }, tasksDone: 12, commits: 4 };
    window.addEventListener('mousemove', (e) => emit('cursor', { x: e.clientX, y: e.clientY, inside: true }));
    window.demo = {
      status(state, activity, detail, ctxPct, extra) {
        emit('status', Object.assign({ state, activity, detail: detail || state, project: 'demo', context: { tokens: (ctxPct || 20) * 2000, window: 200000 }, needsFor: 0, subagents: 0, sessions: [{ id: 'd', project: 'demo', state, activity, detail: detail || state, context: { tokens: (ctxPct || 20) * 2000, window: 200000 }, subagents: [], pending: { summary: 'Run npm test' } }] }, extra || {}));
      },
      fx(type, data) { emit('fx', Object.assign({ type, project: 'demo' }, data || {})); },
      perm() { emit('permission', { id: 'p1', tool: 'Bash', input: { command: 'rm -rf build && npm run build' }, project: 'demo', timeout: 25 }); },
      play(name) { director.play(name, {}, true); },
      behaviors: () => Object.keys(B),
    };
    return {
      init: async () => ({ bounds: { width: innerWidth, height: innerHeight }, settings: mockSettings, stats: mockStats, status: { state: 'idle', sessions: [], context: { tokens: 0, window: 200000 }, detail: 'Idle' } }),
      onStatus: on('status'), onFx: on('fx'), onStats: on('stats'), onSettings: on('settings'), onCursor: on('cursor'), onBounds: on('bounds'),
      onPermission: on('permission'), onPermissionResolved: on('permission-resolved'),
      setHitRects() {}, setViewport: async () => null, moveDisplay: async () => null, savePosition() {}, decide(id, d) { console.log('decision', id, d); },
      feed: async () => { if (mockStats.fish > 0) { mockStats.fish--; return true; } return false; },
      pet() {}, openSettings() {}, quit() {}, trayIcon() {}, focusOverlay() {},
      ask: async (q) => `Mrrp! You asked “${q}”. In the real app I answer from your live sessions.`,
      foregroundWindow: async () => null, sessionWindow: async () => null,
      saveSettings: async (p) => { Object.assign(mockSettings, p); emit('settings', Object.assign({}, mockSettings)); },
    };
  }

  boot();
})();
