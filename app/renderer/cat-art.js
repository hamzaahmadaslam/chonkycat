/*
 * Chonky Cat art engine
 * Draws a chubby, illustrated cat procedurally with Canvas 2D every frame.
 * Everything (fatness, mood, pose, props, skin) is a continuous parameter, so
 * the cat can morph smoothly instead of swapping between fixed sprites.
 *
 * Virtual canvas: W x H units. Callers scale the context to fit.
 */
(function (root) {
  'use strict';

  const W = 420;
  const H = 400;
  const CX = 210;
  const GROUND = 366;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- skins --
  const SKINS = {
    tabby: {
      label: 'Orange tabby',
      fur: ['#FFDDB0', '#F9AE5E', '#E58A3C', '#B55F28'],
      stripe: 'rgba(196, 98, 34, 0.92)',
      cream: ['#FFFDF8', '#FFEED8', '#F0CDA2'],
      outline: '#5A2D14',
      earInner: ['#FFD1D8', '#F2A0AE'],
      nose: ['#FFC0CB', '#E8798D'],
      iris: ['#D4F7A8', '#6CB94A', '#2C6522'],
      pupil: '#1F120A',
      blush: '255, 118, 118',
      collar: ['#86EBE0', '#2FA69C', '#1B6A63'],
      furLight: 'rgba(255, 238, 210, 0.55)',
      furDark: 'rgba(160, 76, 24, 0.35)',
      stripes: true,
      bib: true,
      muzzle: true,
    },
    grey: {
      label: 'Grey loaf',
      fur: ['#E3E9F0', '#AEB9C6', '#8995A4', '#5F6A78'],
      stripe: 'rgba(110, 122, 138, 0.6)',
      cream: ['#FFFFFF', '#E9EEF3', '#C9D2DC'],
      outline: '#242A32',
      earInner: ['#F6D3DA', '#DE9DAC'],
      nose: ['#F6C9D2', '#C97B8C'],
      iris: ['#FFE9A6', '#F0AE36', '#9A5F10'],
      pupil: '#16191E',
      blush: '236, 140, 160',
      collar: ['#FFB8C9', '#E2648A', '#A23E5D'],
      furLight: 'rgba(255, 255, 255, 0.5)',
      furDark: 'rgba(70, 80, 95, 0.3)',
      stripes: false,
      bib: true,
      muzzle: true,
    },
    tuxedo: {
      label: 'Tuxedo',
      fur: ['#6B6B7C', '#3B3B47', '#272731', '#16161C'],
      stripe: 'rgba(0,0,0,0)',
      cream: ['#FFFFFF', '#F4F0E8', '#D6CFC2'],
      outline: '#0C0C10',
      earInner: ['#E7AAB8', '#B9707F'],
      nose: ['#F7C0CB', '#D9788C'],
      iris: ['#E3FFD0', '#86CF72', '#2F7426'],
      pupil: '#0C0C10',
      blush: '235, 120, 140',
      collar: ['#FF9494', '#D94848', '#962C2C'],
      furLight: 'rgba(255, 255, 255, 0.14)',
      furDark: 'rgba(0, 0, 0, 0.35)',
      stripes: false,
      bib: true,
      muzzle: true,
      blaze: true,
      whiteTail: true,
    },
    calico: {
      label: 'Calico',
      fur: ['#FFFFFF', '#FBF6EE', '#E9DDCB', '#C9B79C'],
      stripe: 'rgba(0,0,0,0)',
      cream: ['#FFFFFF', '#FFFDF9', '#EFE5D6'],
      outline: '#3E2B1E',
      earInner: ['#FFD1D8', '#F2A0AE'],
      nose: ['#FFC0CB', '#E8798D'],
      iris: ['#FFEBB0', '#E59E34', '#8C5410'],
      pupil: '#1F120A',
      blush: '250, 130, 120',
      collar: ['#A9DBFF', '#4E9BE6', '#2D68AD'],
      furLight: 'rgba(255, 255, 255, 0.5)',
      furDark: 'rgba(120, 90, 60, 0.22)',
      stripes: false,
      bib: false,
      muzzle: true,
      patches: {
        orange: ['#FFC27A', '#EE9440', '#C8702C'],
        black: ['#5E5753', '#3A3532', '#221F1D'],
      },
    },
  };

  // ------------------------------------------------------------- helpers --
  const lerp = (a, b, u) => a + (b - a) * u;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (u) => u * u * (3 - 2 * u);

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Closed organic shape: ellipse with optional pear, flat bottom and fur tufts.
  function shapePath(ctx, cx, cy, rx, ry, o) {
    o = o || {};
    const n = o.n || (o.fluff ? 128 : 72);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const s = Math.sin(a);
      const c = Math.cos(a);
      let kx = 1;
      if (o.pear) kx *= 1 + o.pear * s; // wider at the bottom, narrower on top
      let r = 1;
      if (o.fluff) r += fluffAt(a, o);
      let x = cx + c * rx * kx * r;
      let y = cy + s * ry * r;
      if (o.maxY != null && y > o.maxY) y = o.maxY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function fluffAt(a, o) {
    let w = 1;
    if (o.range) {
      w = 0;
      for (const [c, h] of o.range) {
        const d = Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)));
        w = Math.max(w, clamp(1 - d / h, 0, 1));
      }
    }
    if (!w) return 0;
    const k = o.tufts || 16;
    const p = ((a * k) / TAU + (o.phase || 0)) % 1;
    const tri = 1 - Math.abs(p * 2 - 1);
    return o.fluff * w * Math.pow(tri, 1.6);
  }

  // Radial "volume" gradient lit from the top-left.
  function volume(ctx, cx, cy, rx, ry, ramp) {
    const g = ctx.createRadialGradient(cx - rx * 0.38, cy - ry * 0.5, 0, cx - rx * 0.1, cy - ry * 0.1, Math.max(rx, ry) * 1.35);
    g.addColorStop(0, ramp[0]);
    g.addColorStop(0.42, ramp[1]);
    g.addColorStop(0.8, ramp[2]);
    g.addColorStop(1, ramp[3] || ramp[2]);
    return g;
  }

  // Draw a part: outline under the fill, then optional details clipped inside.
  function part(ctx, pathFn, fill, S, ow, details) {
    ctx.save();
    pathFn();
    ctx.lineJoin = 'round';
    ctx.lineWidth = ow;
    ctx.strokeStyle = S.outline;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
    if (details) {
      ctx.clip();
      details();
    }
    ctx.restore();
  }

  // soft rim light (top-left) + inner shadow (bottom-right), clipped to the current path
  function rim(ctx, pathFn, strength) {
    strength = strength == null ? 1 : strength;
    ctx.save();
    ctx.translate(5, 6);
    pathFn();
    ctx.lineWidth = 11;
    ctx.strokeStyle = `rgba(255, 246, 230, ${0.3 * strength})`;
    ctx.stroke();
    ctx.translate(-11, -13);
    pathFn();
    ctx.lineWidth = 15;
    ctx.strokeStyle = `rgba(90, 30, 5, ${0.17 * strength})`;
    ctx.stroke();
    ctx.restore();
  }

  // Tapered stroke along a quadratic/cubic polyline, filled as a polygon.
  function taper(ctx, pts, w0, w1, color, cap, roundEnd) {
    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const r = pts[Math.max(0, i - 1)];
      let dx = q[0] - r[0];
      let dy = q[1] - r[1];
      const m = Math.hypot(dx, dy) || 1;
      dx /= m; dy /= m;
      const w = lerp(w0, w1, i / (pts.length - 1)) / 2;
      left.push([p[0] - dy * w, p[1] + dx * w]);
      right.push([p[0] + dy * w, p[1] - dx * w]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const p of left) ctx.lineTo(p[0], p[1]);
    if (roundEnd) {
      const e = pts[pts.length - 1], q = pts[pts.length - 2];
      const a = Math.atan2(e[1] - q[1], e[0] - q[0]);
      ctx.arc(e[0], e[1], w1 / 2, a + Math.PI / 2, a - Math.PI / 2, true);
    }
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    if (color) {
      ctx.fillStyle = color;
      ctx.fill();
      if (cap) {
        const e = pts[pts.length - 1];
        ctx.beginPath();
        ctx.arc(e[0], e[1], w1 / 2, 0, TAU);
        ctx.fill();
      }
    }
  }

  function quad(p0, p1, p2, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      out.push([
        (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0],
        (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1],
      ]);
    }
    return out;
  }

  function cubicPt(P, u) {
    const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
    return [a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]];
  }

  // Short hair strokes that follow the form. Seeded so they don't shimmer.
  function furStrokes(ctx, cx, cy, rx, ry, seed, count, S, flow) {
    // Batched into two paths (lit / shaded) — one draw call each instead of one per hair.
    const r = rng(seed);
    const lit = new Path2D();
    const dark = new Path2D();
    for (let i = 0; i < count; i++) {
      const a = r() * TAU;
      const d = Math.sqrt(r()) * 0.95;
      const u = Math.cos(a) * d;
      const v = Math.sin(a) * d;
      const x = cx + u * rx;
      const y = cy + v * ry;
      const p = u + v < -0.2 ? lit : dark;
      r();
      const ang = Math.atan2(v, u) * 0.35 + Math.PI / 2 + (flow || 0);
      const len = 7 + r() * 8;
      p.moveTo(x, y);
      p.quadraticCurveTo(x + Math.cos(ang - 0.4) * len * 0.5, y + Math.sin(ang - 0.4) * len * 0.5, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.1;
    ctx.strokeStyle = S.furLight;
    ctx.stroke(lit);
    ctx.strokeStyle = S.furDark;
    ctx.stroke(dark);
    ctx.restore();
  }

  function star4(ctx, x, y, r, color, glow) {
    ctx.save();
    if (glow) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r + glow);
      g.addColorStop(0, 'rgba(255, 236, 160, 0.55)');
      g.addColorStop(1, 'rgba(255, 236, 160, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r + glow, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU - Math.PI / 2;
      const rr = i % 2 ? r * 0.28 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function heart(ctx, x, y, s, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-12, -2, -8, -12, 0, -6);
    ctx.bezierCurveTo(8, -12, 12, -2, 0, 6);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.ellipse(-4.5, -4.5, 2, 1.3, -0.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // Renders a layer once (at the current pixel scale) and reuses it while its key is unchanged.
  function cachedLayer(ctx, cache, key, render, sc) {
    const ck = key + '|' + sc;
    let c = cache.get(ck);
    if (!c) {
      c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(Math.ceil(W * sc), Math.ceil(H * sc)) : Object.assign(document.createElement('canvas'), { width: Math.ceil(W * sc), height: Math.ceil(H * sc) });
      const x = c.getContext('2d');
      x.setTransform(sc, 0, 0, sc, 0, 0);
      x.lineJoin = 'round';
      x.lineCap = 'round';
      render(x);
      cache.set(ck, c);
      if (cache.size > 48) cache.delete(cache.keys().next().value);
    }
    ctx.drawImage(c, 0, 0, W, H);
  }

  // ------------------------------------------------------------ the cat --
  /**
   * draw(ctx, opts) — ctx should already be scaled so 1 unit = 1 virtual px.
   * opts: skin, t, fat (0..1), state, pose ('sit'|'walk'|'sleep'), look {x,y},
   *       walkPhase, wave, knock, prop ('laptop'|'fish'), burp (0..1), eyes, mouth
   * returns anchors for speech bubbles etc.
   */
  function draw(ctx, opts) {
    const S = typeof opts.skin === 'string' ? SKINS[opts.skin] || SKINS.tabby : opts.skin || SKINS.tabby;
    const t = opts.t || 0;
    const fat = clamp(opts.fat == null ? 0.25 : opts.fat, 0, 1);
    const state = opts.state || 'idle';
    const pose = opts.pose || (state === 'sleep' ? 'sleep' : 'sit');
    const sleepy = pose === 'sleep';
    const walking = pose === 'walk';
    const puff = state === 'danger';
    const look = opts.look || { x: 0, y: 0 };
    const OW = 6;
    const ks = opts.kitten ? 0.62 : 1;
    const hk = opts.kitten ? 0.86 : 1;
    const tilt = opts.headTilt || 0;
    const raises = [].concat(opts.raise || []);
    if (opts.wave > 0) raises.push({ side: 1, kind: 'wave' });
    if (opts.knock > 0) raises.push({ side: 1, kind: 'knock' });
    const raisedSide = (sd) => raises.some((r) => (r.side || 1) === sd);
    const twoPawProp = ['laptop', 'terminal', 'book', 'clipboard', 'binoculars'].includes(opts.prop);

    const breathRate = sleepy ? 3.8 : state === 'working' ? 1.7 : 2.7;
    const br = Math.sin((t * TAU) / breathRate);
    const wp = opts.walkPhase || 0;
    const waddle = walking ? Math.sin(wp * TAU) : 0;
    const bob = walking ? Math.abs(Math.sin(wp * TAU)) * 6 : 0;

    // ---- geometry (b = breath, lx/ly = gaze); rest geometry feeds the layer cache
    const geom = (b, lx, ly) => {
      let brx = (98 + fat * 44) * ks + b * 1.6 + (puff ? 10 : 0);
      let bry = (76 + fat * 16) * ks + b * 1.4 + (puff ? 6 : 0);
      if (sleepy) { brx += 14; bry -= 12; }
      const bottom = GROUND - bob;
      const bcx = CX;
      const bcy = bottom - bry;
      const btop = bcy - bry;
      const hrx = (90 + fat * 10) * hk + (puff ? 6 : 0);
      const hry = (72 + fat * 3) * hk;
      const hcx = CX + lx * 4 + waddle * 3;
      const hcy = btop - 4 - b * 1.2 + (sleepy ? 26 : 0) + ly * 3 + (opts.headDrop || 0);
      const htop = hcy - hry;
      const fx = hcx + lx * 7; // facial features shift more → parallax
      const fy = hcy + ly * 5;
      return { brx, bry, bottom, bcx, bcy, btop, hrx, hry, hcx, hcy, htop, fx, fy };
    };
    const G = geom(br, look.x, look.y);
    const { brx, bry, bottom, bcx, bcy, btop, hrx, hry, hcx, hcy, htop, fx, fy } = G;
    const cache = opts.cache || null;
    const baseScale = cache ? (() => { const m = ctx.getTransform(); return Math.round(Math.hypot(m.a, m.b) * 1000) / 1000; })() : 1;
    const canCache = !!cache && !walking && !puff && !opts.pawLift;
    const R = canCache ? geom(0, 0, 0) : G;
    const pawRamp = [S.cream[0], S.cream[1], S.cream[2], S.cream[2]];

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // ---- ground shadow
    {
      const g = ctx.createRadialGradient(CX, GROUND + 4, 4, CX, GROUND + 4, brx + 40);
      g.addColorStop(0, 'rgba(40, 18, 6, 0.28)');
      g.addColorStop(1, 'rgba(40, 18, 6, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(CX + 6, GROUND + 4, brx + 40, 16, 0, 0, TAU);
      ctx.fill();
    }

    if (walking) {
      ctx.translate(CX, GROUND);
      ctx.rotate(waddle * 0.05);
      ctx.translate(-CX, -GROUND);
    }

    if (opts.prop === 'box') drawBoxBack(ctx, S, bottom, brx, OW);

    // ---- tail
    const tailSpeed = { idle: 1.4, thinking: 1, working: 2.4, needs: 5.5, done: 4, danger: 0, sleep: 0.4, error: 0.7 }[state] || 1.4;
    const sway = Math.sin(t * tailSpeed) * 14;
    let TP;
    if (sleepy) {
      TP = [[bcx + brx - 30, bottom - 16], [bcx + brx + 18, bottom + 6], [bcx + 40, bottom + 20], [bcx - 40 + sway * 0.3, bottom + 4]];
    } else if (puff) {
      TP = [[bcx + brx - 30, bottom - 20], [bcx + brx + 30, bottom - 30], [bcx + brx + 34, btop - 10], [bcx + brx + 22, btop - 60]];
    } else {
      TP = [[bcx + brx - 30, bottom - 20], [bcx + brx + 42, bottom - 14], [bcx + brx + 52 + sway, btop - 6], [bcx + brx + 24 + sway * 1.5, btop - 44]];
    }
    const tailPts = [];
    for (let i = 0; i <= 40; i++) tailPts.push(cubicPt(TP, i / 40));
    const tw0 = (puff ? 44 : 30) * ks;
    const tw1 = (puff ? 34 : 21) * ks;
    const tailPath = () => taper(ctx, tailPts, tw0, tw1, null, false, true);
    {
      const tg = ctx.createLinearGradient(TP[0][0] - 30, btop, TP[2][0] + 40, bottom);
      tg.addColorStop(0, S.fur[1]);
      tg.addColorStop(1, S.fur[2]);
      part(ctx, tailPath, tg, S, OW, () => {
        if (S.stripes) {
          ctx.lineCap = 'butt';
          ctx.strokeStyle = S.stripe;
          ctx.lineWidth = 60;
          for (const [a, b] of [[0.3, 0.37], [0.48, 0.56], [0.66, 0.74], [0.86, 1]]) {
            ctx.beginPath();
            const p0 = cubicPt(TP, a);
            ctx.moveTo(p0[0], p0[1]);
            for (let u = a; u <= b + 0.001; u += 0.01) { const p = cubicPt(TP, u); ctx.lineTo(p[0], p[1]); }
            if (b === 1) { const e = tailPts[tailPts.length - 1], q = tailPts[tailPts.length - 3]; ctx.lineTo(e[0] + (e[0] - q[0]) * 4, e[1] + (e[1] - q[1]) * 4); }
            ctx.stroke();
          }
        }
        if (S.patches) {
          ctx.fillStyle = S.patches.orange[1];
          ctx.beginPath();
          const e = cubicPt(TP, 0.75);
          ctx.ellipse(e[0], e[1], 50, 60, 0, 0, TAU);
          ctx.fill();
        }
        if (S.whiteTail) {
          const e = tailPts[tailPts.length - 1];
          ctx.fillStyle = S.cream[1];
          ctx.beginPath();
          ctx.arc(e[0], e[1], 22, 0, TAU);
          ctx.fill();
        }
        rim(ctx, tailPath, 0.8);
      });
      if (puff) {
        // bottle-brush spikes
        ctx.save();
        ctx.strokeStyle = S.outline;
        ctx.fillStyle = S.fur[2];
        for (let i = 4; i < tailPts.length; i += 3) {
          const p = tailPts[i];
          const q = tailPts[Math.min(tailPts.length - 1, i + 1)];
          const nx = -(q[1] - p[1]), ny = q[0] - p[0];
          const m = Math.hypot(nx, ny) || 1;
          for (const s of [-1, 1]) {
            const w = lerp(tw0, tw1, i / 40) / 2;
            const jitter = Math.sin(i * 3 + t * 30) * 2;
            ctx.beginPath();
            ctx.moveTo(p[0] + (s * nx / m) * (w - 4) - 5, p[1] + (s * ny / m) * (w - 4));
            ctx.lineTo(p[0] + (s * nx / m) * (w + 12 + jitter), p[1] + (s * ny / m) * (w + 12 + jitter));
            ctx.lineTo(p[0] + (s * nx / m) * (w - 4) + 5, p[1] + (s * ny / m) * (w - 4));
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }

    const bodyLayer = (ctx, g) => {
      const { brx, bry, bottom, bcx, bcy, btop, hrx, hry, hcx, hcy } = g;
      // ---- body
      const bodyFluff = puff
        ? { fluff: 0.09, tufts: 30, phase: t * 3 }
        : { fluff: 0.025, tufts: 22, range: [[0.15, 0.6], [Math.PI - 0.15, 0.6]] };
      const bodyPath = () => shapePath(ctx, bcx, bcy, brx, bry, Object.assign({ pear: 0.14, maxY: bottom + 2 }, bodyFluff));
      part(ctx, bodyPath, volume(ctx, bcx, bcy, brx, bry, S.fur), S, OW, () => {
        furStrokes(ctx, bcx, bcy, brx, bry, 11, 90, S);
        if (S.patches) {
          patchBlob(ctx, bcx + brx * 0.5, bcy - bry * 0.3, brx * 0.5, bry * 0.6, S.patches.black, 3);
          patchBlob(ctx, bcx - brx * 0.62, bcy + bry * 0.25, brx * 0.42, bry * 0.5, S.patches.orange, 5);
        }
        if (S.stripes) {
          for (const s of [-1, 1]) {
            for (let k = 0; k < 4; k++) {
              const y0 = bcy - bry * 0.55 + k * bry * 0.36;
              const pts = quad([bcx + s * brx * 1.05, y0], [bcx + s * brx * 0.78, y0 - 4], [bcx + s * brx * (0.5 - k * 0.03), y0 + 10 + k * 3], 16);
              taper(ctx, pts, 15, 2, S.stripe);
            }
          }
        }
        // shadow under the head
        ctx.save();
        ctx.translate(hcx, hcy + hry * 0.8);
        ctx.scale(1, 0.55);
        const hs = ctx.createRadialGradient(0, 0, hrx * 0.4, 0, 0, hrx * 0.95);
        hs.addColorStop(0, 'rgba(110, 40, 8, 0.32)');
        hs.addColorStop(1, 'rgba(110, 40, 8, 0)');
        ctx.fillStyle = hs;
        ctx.beginPath();
        ctx.arc(0, 0, hrx * 0.95, 0, TAU);
        ctx.fill();
        ctx.restore();
        if (S.bib) {
          const bibPath = () => shapePath(ctx, bcx, bcy + bry * 0.18, brx * 0.42, bry * 0.95, { fluff: 0.1, tufts: 20, range: [[-Math.PI / 2, 1.6]], n: 140 });
          ctx.save();
          bibPath();
          ctx.fillStyle = volume(ctx, bcx, bcy + bry * 0.18, brx * 0.42, bry * 0.95, [S.cream[0], S.cream[1], S.cream[2], S.cream[2]]);
          ctx.fill();
          ctx.clip();
          furStrokes(ctx, bcx, bcy + bry * 0.2, brx * 0.4, bry * 0.9, 21, 30, { furLight: 'rgba(255,255,255,0.7)', furDark: 'rgba(200,150,100,0.3)' });
          ctx.restore();
        }
        rim(ctx, bodyPath);
      });

      // ---- haunches
      if (!sleepy) {
        for (const s of [-1, 1]) {
          const step = walking ? Math.max(0, s < 0 ? waddle : -waddle) * 7 : 0;
          const hx = bcx + s * (brx - (30 + fat * 4) * ks);
          const hy = bottom - 25 * ks - step;
          const hrx2 = (34 + fat * 9) * ks;
          const hry2 = 26 * ks;
          const hp = () => shapePath(ctx, hx, hy, hrx2, hry2, { maxY: bottom + 2 - step });
          const ramp = S.patches && s < 0 ? [S.patches.orange[0], S.patches.orange[1], S.patches.orange[2], S.patches.orange[2]] : S.fur;
          part(ctx, hp, volume(ctx, hx, hy, hrx2, hry2, ramp), S, OW, () => {
            furStrokes(ctx, hx, hy, hrx2, hry2, 31 + s, 25, S);
            if (S.stripes) {
              ctx.strokeStyle = S.stripe;
              ctx.lineWidth = 7;
              for (const rr of [14, 27, 40]) {
                ctx.beginPath();
                ctx.arc(hx + s * 6, hy + 10, rr * 0.82, Math.PI + 0.35, TAU - 0.35);
                ctx.stroke();
              }
            }
            rim(ctx, hp, 0.8);
          });
        }
      }

      // ---- front paws
      const paws = [];
      if (sleepy) {
        paws.push([bcx - 52, bottom - 8, 22, 12]);
        paws.push([bcx - 14, bottom - 6, 22, 12]);
      } else if (!twoPawProp && opts.paws !== 'tucked') {
        for (const s of [-1, 1]) {
          if (raisedSide(s)) continue;
          const lift = (walking ? Math.max(0, s < 0 ? -waddle : waddle) * 10 : 0) + ((opts.pawLift && opts.pawLift[s < 0 ? 0 : 1]) || 0);
          paws.push([bcx + s * 27 * ks, bottom - 10 * ks - lift, 22 * ks, 14 * ks]);
        }
      }
      for (const [px, py, prx, pry] of paws) {
        const pp = () => shapePath(ctx, px, py, prx, pry, { maxY: py + pry - 1 });
        part(ctx, pp, volume(ctx, px, py, prx, pry, pawRamp), S, OW, () => {
          ctx.strokeStyle = 'rgba(120, 70, 40, 0.55)';
          ctx.lineWidth = 2.4;
          for (const ox of [-7, 7]) {
            ctx.beginPath();
            ctx.moveTo(px + ox, py + pry);
            ctx.quadraticCurveTo(px + ox * 0.9, py + pry - 6, px + ox * 0.7, py + pry - 9);
            ctx.stroke();
          }
        });
      }

    };
    if (canCache) {
      // breathing = scale the cached rest-pose body around its feet
      ctx.save();
      ctx.translate(bcx, bottom);
      ctx.scale(brx / R.brx, bry / R.bry);
      ctx.translate(-bcx, -bottom);
      cachedLayer(ctx, cache, ['B', S.label, Math.round(fat * 40), sleepy, !!opts.kitten, opts.paws || '', twoPawProp, raisedSide(-1), raisedSide(1)].join('|'), (c) => bodyLayer(c, R), baseScale);
      ctx.restore();
    } else bodyLayer(ctx, G);

    // ---- collar (behind head so the head covers its top edge)
    let bellPos = null;
    if (S.collar && !sleepy && !opts.kitten && opts.prop !== 'box') {
      ctx.save();
      const a0 = 0.32, a1 = Math.PI - 0.32;
      const ring = (off) => {
        const pts = [];
        for (let i = 0; i <= 40; i++) {
          const a = lerp(a0, a1, i / 40);
          pts.push([hcx + Math.cos(a) * hrx * 0.93, hcy + Math.sin(a) * hry * 0.93 + off]);
        }
        return pts;
      };
      const top = ring(2), bot = ring(19);
      ctx.beginPath();
      top.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
      ctx.closePath();
      const cg = ctx.createLinearGradient(0, hcy + hry - 10, 0, hcy + hry + 16);
      cg.addColorStop(0, S.collar[0]);
      cg.addColorStop(0.5, S.collar[1]);
      cg.addColorStop(1, S.collar[2]);
      ctx.lineWidth = 4;
      ctx.strokeStyle = S.outline;
      ctx.stroke();
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.restore();
      const swing = state === 'needs' || state === 'done' || walking ? Math.sin(t * 9) * 0.35 : Math.sin(t * 1.3) * 0.08;
      bellPos = [hcx, hcy + hry + 18, swing];
    }

    if (opts.prop === 'box') drawBoxFront(ctx, S, bottom, brx, OW, t);

    // head group (ears, head, face) can tilt
    const tiltOn = () => {
      ctx.save();
      if (tilt) { ctx.translate(hcx, hcy + hry * 0.6); ctx.rotate(tilt); ctx.translate(-hcx, -(hcy + hry * 0.6)); }
    };
    const headLayer = (ctx, g) => {
      const { hcx, hcy, hrx, hry, htop, fx, fy } = g;
      // ---- ears
      const earPose = opts.ears || (puff ? 'flat' : sleepy ? 'droop' : 'up');
      const twitch = state === 'idle' && t % 6.2 < 0.25 ? 1 : 0;
      for (const s of [-1, 1]) {
        const A = [hcx + s * 84 * hk, hcy - 26 * hk];
        const B = [hcx + s * 22 * hk, htop + 6];
        let T;
        if (earPose === 'flat') T = [hcx + s * 132, htop + 22];
        else if (earPose === 'droop') T = [hcx + s * 96, htop - 26];
        else if (earPose === 'perk') T = [hcx + s * 68 * hk, htop - 62 * hk];
        else if (earPose === 'back') T = [hcx + s * 116, htop - 6];
        else if (earPose === 'one') T = s < 0 ? [hcx - 72 * hk, htop - 48 * hk] : [hcx + 110, htop - 10];
        else       T = [hcx + s * (72 + (s > 0 ? twitch * 8 : 0)) * hk, htop - 48 * hk + (s > 0 ? twitch * 6 : 0)];
        const earPath = (A, B, T, bulge) => () => {
          const A1 = [lerp(A[0], T[0], 0.86), lerp(A[1], T[1], 0.86)];
          const B1 = [lerp(B[0], T[0], 0.86), lerp(B[1], T[1], 0.86)];
          const cA = [lerp(A[0], T[0], 0.5) + s * bulge, lerp(A[1], T[1], 0.5)];
          const cB = [lerp(B[0], T[0], 0.5) - s * bulge * 0.4, lerp(B[1], T[1], 0.5)];
          ctx.beginPath();
          ctx.moveTo(A[0], A[1]);
          ctx.quadraticCurveTo(cA[0], cA[1], A1[0], A1[1]);
          ctx.quadraticCurveTo(T[0], T[1], B1[0], B1[1]);
          ctx.quadraticCurveTo(cB[0], cB[1], B[0], B[1]);
          ctx.closePath();
        };
        const ep = earPath(A, B, T, 10);
        const ramp = S.patches && s < 0 ? [S.patches.orange[0], S.patches.orange[1], S.patches.orange[2], S.patches.orange[2]] : S.fur;
        const eg = ctx.createLinearGradient(T[0], T[1], (A[0] + B[0]) / 2, A[1]);
        eg.addColorStop(0, ramp[s < 0 ? 0 : 1]);
        eg.addColorStop(1, ramp[s < 0 ? 1 : 2]);
        part(ctx, ep, eg, S, OW, () => {
          const c = [(A[0] + B[0] + T[0]) / 3, (A[1] + B[1] + T[1]) / 3 + 8];
          const sh = (p, k) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k];
          const ip = earPath(sh(A, 0.62), sh(B, 0.62), sh(T, 0.62), 4);
          ip();
          const ig = ctx.createLinearGradient(T[0], T[1], c[0], c[1] + 20);
          ig.addColorStop(0, S.earInner[1]);
          ig.addColorStop(1, S.earInner[0]);
          ctx.fillStyle = ig;
          ctx.fill();
          // white fluff tufts in the ear
          ctx.strokeStyle = 'rgba(255, 252, 245, 0.95)';
          ctx.lineWidth = 2.4;
          for (let k = 0; k < 4; k++) {
            const bx = lerp(A[0], B[0], 0.25 + k * 0.12);
            const by = lerp(A[1], B[1], 0.25 + k * 0.12) + 4;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.quadraticCurveTo(bx + s * 4, by - 14, lerp(bx, T[0], 0.35), lerp(by, T[1], 0.35));
            ctx.stroke();
          }
        });
      }

      // ---- head
      const cheekFluff = puff
        ? { fluff: 0.08, tufts: 34, phase: t * 3 }
        : { fluff: 0.075, tufts: 30, range: [[0.42, 0.42], [Math.PI - 0.42, 0.42]] };
      const headPath = () => shapePath(ctx, hcx, hcy, hrx, hry, Object.assign({ pear: 0.07 }, cheekFluff));
      part(ctx, headPath, volume(ctx, hcx, hcy, hrx, hry, S.fur), S, OW, () => {
        furStrokes(ctx, hcx, hcy - 10, hrx * 0.95, hry * 0.8, 7, 70, S, -Math.PI / 2 + 0.2);
        if (S.patches) {
          patchBlob(ctx, hcx - hrx * 0.5, hcy - hry * 0.55, hrx * 0.62, hry * 0.6, S.patches.orange, 9);
          patchBlob(ctx, hcx + hrx * 0.62, hcy - hry * 0.05, hrx * 0.38, hry * 0.45, S.patches.black, 13);
        }
        if (S.stripes) {
          // classic tabby "M" on the forehead
          const fyb = htop + 4;
          taper(ctx, quad([fx, fyb], [fx + 1, fyb + 18], [fx, fyb + 34], 12), 11, 3, S.stripe);
          for (const s of [-1, 1]) {
            taper(ctx, quad([fx + s * 17, fyb + 6], [fx + s * 16, fyb + 20], [fx + s * 11, fyb + 30], 12), 9, 2, S.stripe);
            taper(ctx, quad([fx + s * 36, fyb + 14], [fx + s * 34, fyb + 24], [fx + s * 28, fyb + 30], 12), 7, 2, S.stripe);
            // cheek stripes
            for (let k = 0; k < 2; k++) {
              const y = fy + 10 + k * 15;
              taper(ctx, quad([hcx + s * (hrx + 6), y], [hcx + s * (hrx - 14), y - 4], [hcx + s * (hrx - 30), y + 2], 12), 9, 2, S.stripe);
            }
          }
        }
        if (S.blaze) {
          ctx.fillStyle = S.cream[1];
          ctx.beginPath();
          ctx.moveTo(fx - 4, htop + 14);
          ctx.quadraticCurveTo(fx, htop + 8, fx + 4, htop + 14);
          ctx.lineTo(fx + 16, fy + 26);
          ctx.lineTo(fx - 16, fy + 26);
          ctx.closePath();
          ctx.fill();
        }
        if (S.muzzle) {
          ctx.save();
          const mg = ctx.createRadialGradient(fx - 6, fy + 30, 2, fx, fy + 38, 40);
          mg.addColorStop(0, S.cream[0]);
          mg.addColorStop(0.7, S.cream[1]);
          mg.addColorStop(1, S.cream[2]);
          ctx.fillStyle = mg;
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(fx + s * 15, fy + 38, 21, 15, s * 0.15, 0, TAU);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.ellipse(fx, fy + 50, 15, 11, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        if (opts.prop === 'laptop') {
          // screen glow on the face
          const sg = ctx.createRadialGradient(fx, fy + 70, 10, fx, fy + 40, 120);
          sg.addColorStop(0, 'rgba(140, 200, 255, 0.28)');
          sg.addColorStop(1, 'rgba(140, 200, 255, 0)');
          ctx.fillStyle = sg;
          ctx.fillRect(hcx - hrx - 10, hcy - hry, hrx * 2 + 20, hry * 2 + 10);
        }
        rim(ctx, headPath);
      });

    };
    tiltOn();
    if (canCache) {
      ctx.save();
      ctx.translate(hcx - R.hcx, hcy - R.hcy);
      cachedLayer(ctx, cache, ['H', S.label, Math.round(fat * 40), sleepy, puff, !!opts.kitten, opts.ears || '', state === 'idle' && t % 6.2 < 0.25, opts.prop === 'laptop'].join('|'), (c) => headLayer(c, R), baseScale);
      ctx.restore();
    } else headLayer(ctx, G);
    ctx.restore();

    // ---- bell (in front of the head)
    if (bellPos) {
      const [bx, by, rot] = bellPos;
      ctx.save();
      ctx.translate(bx, by - 8);
      ctx.rotate(rot);
      ctx.translate(0, 8);
      ctx.beginPath();
      ctx.arc(0, 4, 12, 0, TAU);
      ctx.lineWidth = 4;
      ctx.strokeStyle = S.outline;
      ctx.stroke();
      const bg = ctx.createRadialGradient(-4, 0, 1, 0, 4, 13);
      bg.addColorStop(0, '#FFF6C2');
      bg.addColorStop(0.45, '#F7C948');
      bg.addColorStop(1, '#B9800F');
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(110, 70, 8, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-11, 2); ctx.quadraticCurveTo(0, 6, 11, 2); ctx.stroke();
      ctx.fillStyle = '#5E3B07';
      ctx.beginPath(); ctx.arc(0, 9, 2.6, 0, TAU); ctx.fill();
      ctx.fillRect(-1.2, 9, 2.4, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.ellipse(-5, -1, 3, 2, -0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // ---- props in front
    if (opts.prop) {
      const small = opts.kitten && opts.prop !== 'box';
      if (small) { ctx.save(); ctx.translate(CX, bottom); ctx.scale(0.68, 0.68); ctx.translate(-CX, -bottom); }
      drawProp(ctx, S, opts.prop, { t, bottom, hcx, hcy: small ? hcy + 40 : hcy, hry, brx, fx, fy, pawRamp, OW, stamped: opts.stamped || 0 });
      if (small) ctx.restore();
    }

    // ---- face
    tiltOn();
    drawFace(ctx, S, { t, state, pose, fx, fy, hcx, hcy, hrx, hry, opts, look });
    if (opts.glasses || opts.prop === 'book') drawGlasses(ctx, S, fx, fy);
    if (opts.hat) drawHat(ctx, S, opts.hat, hcx, htop, hrx, t);
    ctx.restore();

    // raised paws: wave, knock-on-the-glass, or a custom target (grooming, holding a mug…)
    let pad = null;
    for (const r of raises) {
      const s = r.side || 1;
      const knocking = r.kind === 'knock';
      const waving = r.kind === 'wave';
      const wob = waving ? Math.sin(t * 10) * 9 : 0;
      const press = knocking ? Math.max(0, Math.sin(t * 7)) : 0;
      const sx = bcx + s * brx * 0.55, sy = btop + 40;
      let px, py, pr;
      if (knocking) { px = CX + s * 40; py = hcy + 80 - press * 4; pr = 32 + press * 5; }
      else if (waving) { px = hcx + s * (hrx + 22) + wob; py = hcy - 6 - Math.abs(wob) * 0.4; pr = 21; }
      else { px = r.x; py = r.y; pr = r.r || 21; }
      const armPts = quad([sx, sy], [lerp(sx, px, 0.5) + s * 12, lerp(sy, py, 0.5) + 10], [px, py], 20);
      const ap = () => taper(ctx, armPts, 34 * ks, 30 * ks);
      const ag = ctx.createLinearGradient(sx, sy, px, py);
      ag.addColorStop(0, S.fur[2]);
      ag.addColorStop(1, S.fur[1]);
      part(ctx, ap, ag, S, OW, () => {
        if (S.stripes) {
          ctx.strokeStyle = S.stripe;
          ctx.lineWidth = 6;
          for (const u of [0.35, 0.6]) {
            const p = armPts[Math.round(u * 20)];
            ctx.beginPath();
            ctx.moveTo(p[0] - 14, p[1] - 6);
            ctx.lineTo(p[0] + 14, p[1] + 6);
            ctx.stroke();
          }
        }
      });
      if (r.hold) drawHeld(ctx, S, r.hold, px, py - pr * 0.6, t, s);
      const pp = () => { ctx.beginPath(); ctx.ellipse(px, py, pr, pr * (knocking ? 1 - press * 0.08 : 1), 0, 0, TAU); };
      part(ctx, pp, volume(ctx, px, py, pr, pr, pawRamp), S, OW, () => {
        if (knocking || waving || r.beans) toeBeans(ctx, px, py + pr * 0.12, pr / 21);
      });
      pad = { x: px, y: py, r: pr, press };
    }
    if (opts.prop === 'binoculars') drawBinoculars(ctx, S, fx, fy, pawRamp, OW, t);

    // ---- effects & overlays
    const anchor = { headX: hcx, headTop: htop - 50, mouth: [fx, fy + 44], bottom, bodyRx: brx };
    drawEffects(ctx, S, { t, state, pose, fx, fy, hcx, hcy, hrx, hry, htop, bcx, bcy, brx, bry, bottom, opts });

    ctx.restore();
    return { anchor, pad };
  }

  function patchBlob(ctx, x, y, rx, ry, ramp, seed) {
    ctx.save();
    shapePath(ctx, x, y, rx, ry, { fluff: 0.12, tufts: 7 + (seed % 4), phase: seed * 0.13, n: 120 });
    const g = ctx.createRadialGradient(x - rx * 0.3, y - ry * 0.4, 0, x, y, Math.max(rx, ry) * 1.2);
    g.addColorStop(0, ramp[0]);
    g.addColorStop(0.55, ramp[1]);
    g.addColorStop(1, ramp[2]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function toeBeans(ctx, x, y, k) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    const g = ctx.createRadialGradient(-3, 0, 1, 0, 4, 14);
    g.addColorStop(0, '#FFC9D3');
    g.addColorStop(1, '#EE8399');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.bezierCurveTo(9, -3, 12, 8, 6, 11);
    ctx.bezierCurveTo(3, 12.5, -3, 12.5, -6, 11);
    ctx.bezierCurveTo(-12, 8, -9, -3, 0, -1);
    ctx.fill();
    for (const [bx, by, r] of [[-11, -7, 3.6], [-4, -12, 3.8], [4, -12, 3.8], [11, -7, 3.6]]) {
      ctx.beginPath();
      ctx.ellipse(bx, by, r, r * 1.2, bx * 0.03, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath(); ctx.ellipse(-2.5, 3, 2.6, 1.6, -0.4, 0, TAU); ctx.fill();
    for (const [bx, by] of [[-11, -7], [-4, -12], [4, -12], [11, -7]]) {
      ctx.beginPath(); ctx.arc(bx - 1, by - 1.5, 1, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawFish(ctx, x, y, k, wiggle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.rotate(wiggle || 0);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1F3F63';
    ctx.lineJoin = 'round';
    const g = ctx.createLinearGradient(0, -14, 0, 14);
    g.addColorStop(0, '#7CC0F2');
    g.addColorStop(0.55, '#4A94DA');
    g.addColorStop(1, '#BFE2FA');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-26, 0);
    ctx.bezierCurveTo(-14, -18, 12, -16, 20, 0);
    ctx.bezierCurveTo(12, 16, -14, 18, -26, 0);
    ctx.closePath();
    ctx.moveTo(18, 0);
    ctx.lineTo(34, -13);
    ctx.quadraticCurveTo(29, 0, 34, 13);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-15, -3, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1F3F63';
    ctx.beginPath(); ctx.arc(-14.5, -3, 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(31,63,99,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-6, -8); ctx.quadraticCurveTo(-2, 0, -6, 8); ctx.stroke();
    ctx.restore();
  }

  // --------------------------------------------------------------- props --
  const CARD = ['#F2C08A', '#DDA064', '#BE8048', '#8F5C2E'];

  function drawBoxBack(ctx, S, bottom, brx, OW) {
    const bw = brx * 2 + 46;
    const top = bottom - 150;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = OW;
    ctx.strokeStyle = S.outline;
    ctx.fillStyle = '#B07A45';
    ctx.beginPath();
    ctx.moveTo(CX - bw / 2 + 18, top);
    ctx.lineTo(CX + bw / 2 - 18, top);
    ctx.lineTo(CX + bw / 2, bottom - 110);
    ctx.lineTo(CX - bw / 2, bottom - 110);
    ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#C48C52';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(CX + s * (bw / 2 - 18), top);
      ctx.lineTo(CX + s * (bw / 2 + 14), top - 34);
      ctx.lineTo(CX + s * (bw / 2 - 30), top - 40);
      ctx.lineTo(CX + s * (bw / 2 - 60), top);
      ctx.closePath();
      ctx.stroke(); ctx.fill();
    }
    ctx.restore();
  }

  function drawBoxFront(ctx, S, bottom, brx, OW, t) {
    const bw = brx * 2 + 46;
    const top = bottom - 112;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = OW;
    ctx.strokeStyle = S.outline;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, CARD[0]);
    g.addColorStop(1, CARD[2]);
    roundRect(ctx, CX - bw / 2, top, bw, bottom - top + 6, 6);
    ctx.stroke();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = CARD[1];
    for (const s of [-1, 1]) {
      const wob = Math.sin(t * 2 + s) * 2;
      ctx.beginPath();
      ctx.moveTo(CX + s * (bw / 2), top);
      ctx.lineTo(CX + s * (bw / 2 + 34), top - 26 + wob);
      ctx.lineTo(CX + s * 30, top - 28 + wob);
      ctx.lineTo(CX + s * 8, top);
      ctx.closePath();
      ctx.stroke(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 236, 200, 0.55)';
    ctx.fillRect(CX - 14, top + 3, 28, bottom - top);
    drawPawPrint(ctx, CX + bw / 2 - 52, top + 52, 1.1, 0.55, '#7A4A22');
    ctx.fillStyle = 'rgba(90, 50, 20, 0.6)';
    ctx.font = 'bold 15px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillText('THIS SIDE UP', CX - bw / 2 + 22, top + 40);
    ctx.restore();
  }

  function heldPaws(ctx, S, pawRamp, OW, pts) {
    for (const [px, py] of pts) {
      const pp = () => shapePath(ctx, px, py, 21, 13);
      part(ctx, pp, volume(ctx, px, py, 21, 13, pawRamp), S, OW);
    }
  }

  function drawProp(ctx, S, prop, G) {
    const { t, bottom, hcx, hcy, hry, brx, pawRamp, OW } = G;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (prop === 'laptop' || prop === 'terminal') {
      const dark = prop === 'terminal';
      const lw = 168, lh = 96;
      const lx = CX - lw / 2, ly = bottom - lh + 4;
      ctx.save();
      roundRect(ctx, lx, ly, lw, lh, 12);
      ctx.lineWidth = OW;
      ctx.strokeStyle = S.outline;
      ctx.stroke();
      const lg = ctx.createLinearGradient(0, ly, 0, ly + lh);
      lg.addColorStop(0, dark ? '#4A5160' : '#F4F6F9');
      lg.addColorStop(1, dark ? '#20242C' : '#BCC4CF');
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 60, ly); ctx.lineTo(lx + 20, ly + lh); ctx.lineTo(lx, ly + lh); ctx.fill();
      ctx.restore();
      if (dark) {
        ctx.save();
        ctx.fillStyle = '#5CF29A';
        ctx.font = 'bold 34px Consolas, "Cascadia Code", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(t % 1 < 0.55 ? '>_' : '> ', CX, ly + lh / 2 + 12);
        ctx.restore();
      } else {
        star4(ctx, CX, ly + lh / 2, 16, '#E07A4E');
        drawFish(ctx, lx + lw - 34, ly + lh - 22, 0.55, 0);
      }
      const f = Math.floor(t * 9) % 2;
      heldPaws(ctx, S, pawRamp, OW, [[CX - 42, ly - 4 - f * 6], [CX + 42, ly - 4 - (1 - f) * 6]]);
    } else if (prop === 'book') {
      const cx = hcx, cy = hcy + hry + 34 + Math.sin(t * 1.2) * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(t * 0.8) * 0.03);
      ctx.lineWidth = OW;
      ctx.strokeStyle = S.outline;
      ctx.fillStyle = '#B84A3E';
      roundRect(ctx, -86, -44, 172, 92, 8);
      ctx.stroke(); ctx.fill();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -36);
        ctx.quadraticCurveTo(s * 40, -46, s * 80, -38);
        ctx.lineTo(s * 80, 40);
        ctx.quadraticCurveTo(s * 40, 32, 0, 42);
        ctx.closePath();
        ctx.fillStyle = s < 0 ? '#FFF9EE' : '#F6EBD6';
        ctx.lineWidth = 3;
        ctx.stroke(); ctx.fill();
        ctx.strokeStyle = 'rgba(120, 100, 80, 0.45)';
        ctx.lineWidth = 2.4;
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          ctx.moveTo(s * 12, -22 + k * 12);
          ctx.lineTo(s * (66 - (k === 4 ? 24 : 0)), -26 + k * 12);
          ctx.stroke();
        }
        ctx.strokeStyle = S.outline;
      }
      const fp = (t % 5) / 0.6;
      if (fp < 1) {
        ctx.save();
        ctx.scale(Math.cos(fp * Math.PI), 1);
        ctx.fillStyle = '#FFFDF6';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -36); ctx.quadraticCurveTo(40, -46, 78, -38); ctx.lineTo(78, 40); ctx.quadraticCurveTo(40, 32, 0, 42); ctx.closePath();
        ctx.stroke(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      heldPaws(ctx, S, pawRamp, OW, [[cx - 84, cy + 18], [cx + 84, cy + 18]]);
    } else if (prop === 'clipboard') {
      const cx = hcx + 6, cy = hcy + hry + 52;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.06);
      ctx.lineWidth = OW;
      ctx.strokeStyle = S.outline;
      ctx.fillStyle = '#A8733F';
      roundRect(ctx, -58, -62, 116, 128, 10); ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      roundRect(ctx, -48, -48, 96, 106, 4); ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#C9CED6';
      roundRect(ctx, -22, -72, 44, 22, 6); ctx.lineWidth = 3; ctx.stroke(); ctx.fill();
      const done = Math.floor(t / 1.2) % 5;
      for (let k = 0; k < 4; k++) {
        const y = -28 + k * 22;
        ctx.strokeStyle = '#9AA3AF'; ctx.lineWidth = 2;
        roundRect(ctx, -38, y - 7, 14, 14, 3); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,120,130,0.6)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-16, y); ctx.lineTo(34 - (k % 2) * 12, y); ctx.stroke();
        if (k < done) {
          ctx.strokeStyle = '#3BB273'; ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.moveTo(-36, y); ctx.lineTo(-31, y + 5); ctx.lineTo(-22, y - 8); ctx.stroke();
        }
      }
      ctx.restore();
      heldPaws(ctx, S, pawRamp, OW, [[cx - 58, cy + 40], [cx + 62, cy + 34]]);
    } else if (prop === 'hourglass') {
      const x = CX - brx - 44, y = bottom - 52;
      const flip = (t % 8) > 7.4 ? ((t % 8) - 7.4) / 0.6 : 0;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(flip * Math.PI);
      ctx.lineWidth = 4;
      ctx.strokeStyle = S.outline;
      ctx.fillStyle = '#9A6A3A';
      roundRect(ctx, -26, -50, 52, 10, 4); ctx.stroke(); ctx.fill();
      roundRect(ctx, -26, 40, 52, 10, 4); ctx.stroke(); ctx.fill();
      ctx.fillStyle = 'rgba(210, 236, 255, 0.55)';
      ctx.beginPath();
      ctx.moveTo(-20, -40); ctx.lineTo(20, -40); ctx.quadraticCurveTo(20, -8, 3, 0); ctx.quadraticCurveTo(20, 8, 20, 40);
      ctx.lineTo(-20, 40); ctx.quadraticCurveTo(-20, 8, -3, 0); ctx.quadraticCurveTo(-20, -8, -20, -40); ctx.closePath();
      ctx.stroke(); ctx.fill();
      const k = (t % 8) / 7.4;
      ctx.fillStyle = '#F2C35B';
      ctx.beginPath(); ctx.moveTo(-14 * (1 - k), -6 - 26 * (1 - k)); ctx.lineTo(14 * (1 - k), -6 - 26 * (1 - k)); ctx.lineTo(2, -4); ctx.lineTo(-2, -4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-18, 38); ctx.lineTo(18, 38); ctx.lineTo(4, 38 - 28 * k); ctx.lineTo(-4, 38 - 28 * k); ctx.closePath(); ctx.fill();
      ctx.fillRect(-1, -4, 2, 42);
      ctx.restore();
    } else if (prop === 'package') {
      drawParcel(ctx, S, CX - brx - 52, bottom - 36, 1, G.stamped);
    }
    ctx.restore();
  }

  function drawParcel(ctx, S, x, y, k, stamped) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = S ? S.outline : '#5A2D14';
    const g = ctx.createLinearGradient(0, -34, 0, 34);
    g.addColorStop(0, CARD[0]);
    g.addColorStop(1, CARD[2]);
    ctx.fillStyle = g;
    roundRect(ctx, -46, -34, 92, 70, 6); ctx.stroke(); ctx.fill();
    ctx.fillStyle = 'rgba(255, 236, 200, 0.6)';
    ctx.fillRect(-46, -6, 92, 12);
    ctx.fillRect(-6, -34, 12, 70);
    if (stamped > 0) {
      ctx.globalAlpha = Math.min(1, stamped * 2);
      drawPawPrint(ctx, 20, 14, 0.9, 1, '#D83A3A');
      ctx.fillStyle = '#D83A3A';
      ctx.font = 'bold 13px "Trebuchet MS", system-ui, sans-serif';
      ctx.fillText('OK!', -38, 26);
    }
    ctx.restore();
  }

  function drawGlasses(ctx, S, fx, fy) {
    ctx.save();
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = '#3A2A20';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(fx + s * 40, fy + 4, 27, 0, TAU);
      ctx.fillStyle = 'rgba(200, 230, 255, 0.16)';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(fx + s * 40 - 14, fy - 8); ctx.lineTo(fx + s * 40 - 4, fy - 18); ctx.stroke();
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = '#3A2A20';
      ctx.beginPath(); ctx.moveTo(fx + s * 67, fy); ctx.lineTo(fx + s * 86, fy - 6); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(fx - 13, fy); ctx.quadraticCurveTo(fx, fy - 8, fx + 13, fy); ctx.stroke();
    ctx.restore();
  }

  function drawBinoculars(ctx, S, fx, fy, pawRamp, OW, t) {
    const sway = Math.sin(t * 0.9) * 10;
    ctx.save();
    ctx.translate(sway, 0);
    ctx.lineWidth = OW;
    ctx.strokeStyle = S.outline;
    for (const s of [-1, 1]) {
      const g = ctx.createLinearGradient(0, fy - 26, 0, fy + 26);
      g.addColorStop(0, '#5B6270');
      g.addColorStop(1, '#22262E');
      ctx.fillStyle = g;
      roundRect(ctx, fx + s * 40 - 24, fy - 24, 48, 50, 12); ctx.stroke(); ctx.fill();
      ctx.beginPath(); ctx.arc(fx + s * 40, fy + 1, 17, 0, TAU);
      const lg = ctx.createRadialGradient(fx + s * 40 - 6, fy - 5, 1, fx + s * 40, fy + 1, 17);
      lg.addColorStop(0, '#E8F6FF'); lg.addColorStop(0.35, '#6FB5E8'); lg.addColorStop(1, '#1E3F66');
      ctx.fillStyle = lg; ctx.lineWidth = 3; ctx.stroke(); ctx.fill(); ctx.lineWidth = OW;
    }
    ctx.fillStyle = '#3A3F4B';
    roundRect(ctx, fx - 16, fy - 10, 32, 20, 6); ctx.stroke(); ctx.fill();
    ctx.restore();
    heldPaws(ctx, S, pawRamp, OW, [[fx - 52 + sway, fy + 34], [fx + 52 + sway, fy + 34]]);
  }

  function drawHat(ctx, S, kind, hcx, htop, hrx, t) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = S.outline;
    if (kind === 'nightcap') {
      const sw = Math.sin(t * 1.5) * 6;
      ctx.fillStyle = '#4B6CC1';
      ctx.beginPath();
      ctx.moveTo(hcx - 58, htop + 16);
      ctx.quadraticCurveTo(hcx - 20, htop - 70, hcx + 70 + sw, htop - 30);
      ctx.quadraticCurveTo(hcx + 40, htop - 20, hcx + 58, htop + 16);
      ctx.closePath();
      ctx.stroke(); ctx.fill();
      for (const [x, y] of [[-20, -18], [10, -36], [32, -14], [-38, 2]]) star4(ctx, hcx + x, htop + y, 6, '#FFE58A');
      ctx.fillStyle = '#FFFFFF';
      shapePath(ctx, hcx, htop + 16, 64, 13, { fluff: 0.08, tufts: 26 }); ctx.stroke(); ctx.fill();
      ctx.beginPath(); ctx.arc(hcx + 72 + sw, htop - 26, 13, 0, TAU); ctx.stroke(); ctx.fill();
    } else if (kind === 'pumpkin') {
      ctx.save();
      ctx.translate(hcx + 18, htop - 4);
      ctx.rotate(0.12 + Math.sin(t * 1.4) * 0.03);
      for (const [ox, rx] of [[-18, 20], [18, 20], [0, 24]]) {
        ctx.beginPath(); ctx.ellipse(ox, 0, rx, 26, 0, 0, TAU);
        const g = ctx.createRadialGradient(ox - 6, -8, 2, ox, 0, 28);
        g.addColorStop(0, '#FFB45C'); g.addColorStop(1, '#E06A12');
        ctx.fillStyle = g; ctx.stroke(); ctx.fill();
      }
      ctx.fillStyle = '#5E8C2E';
      roundRect(ctx, -4, -38, 9, 16, 3); ctx.stroke(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(14, -32, 12, 6, -0.4, 0, TAU); ctx.lineWidth = 3; ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#5A2D14';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 10, -6); ctx.lineTo(s * 4, 2); ctx.lineTo(s * 14, 2); ctx.closePath(); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(-12, 10); ctx.quadraticCurveTo(0, 18, 12, 10); ctx.lineTo(8, 12); ctx.lineTo(4, 9); ctx.lineTo(0, 13); ctx.lineTo(-4, 9); ctx.lineTo(-8, 12); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (kind === 'party') {
      ctx.save();
      ctx.translate(hcx + 24, htop + 10);
      ctx.rotate(0.28);
      ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(0, -84); ctx.lineTo(30, 0); ctx.closePath();
      ctx.fillStyle = '#FF7AA8'; ctx.stroke(); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = '#FFE066'; ctx.lineWidth = 9;
      for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(-40, -k * 20); ctx.lineTo(40, -k * 20 - 18); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = '#7AD3FF';
      ctx.beginPath(); ctx.arc(0, -86, 10 + Math.sin(t * 6) * 1.5, 0, TAU); ctx.stroke(); ctx.fill();
      ctx.restore();
    } else if (kind === 'crown') {
      const w = 76, y = htop + 12;
      ctx.beginPath();
      ctx.moveTo(hcx - w / 2, y);
      ctx.lineTo(hcx - w / 2 - 4, y - 40);
      ctx.lineTo(hcx - w / 4, y - 20);
      ctx.lineTo(hcx, y - 50);
      ctx.lineTo(hcx + w / 4, y - 20);
      ctx.lineTo(hcx + w / 2 + 4, y - 40);
      ctx.lineTo(hcx + w / 2, y);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, y - 50, 0, y);
      g.addColorStop(0, '#FFF1A8'); g.addColorStop(1, '#E3A51D');
      ctx.fillStyle = g; ctx.stroke(); ctx.fill();
      for (const [x, c] of [[-w / 4, '#E5484D'], [0, '#4F9BEA'], [w / 4, '#3BB273']]) {
        ctx.beginPath(); ctx.arc(hcx + x, y - 10, 6, 0, TAU); ctx.fillStyle = c; ctx.lineWidth = 2.5; ctx.stroke(); ctx.fill();
      }
      star4(ctx, hcx + w / 2 + 6, y - 46, 5 + Math.sin(t * 5) * 2, '#FFFFFF');
    }
    ctx.restore();
  }

  function drawHeld(ctx, S, kind, x, y, t, side) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (kind === 'mug') {
      ctx.translate(x, y - 6);
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = S.outline;
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, -20, -26, 40, 44, 8); ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#5FC4BD';
      ctx.fillRect(-18, -8, 36, 10);
      ctx.beginPath(); ctx.arc(-side * 22, -4, 10, Math.PI * 0.5, Math.PI * 1.5, side > 0); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 3;
      for (let k = 0; k < 2; k++) {
        const p = (t * 0.6 + k * 0.5) % 1;
        ctx.globalAlpha = Math.sin(p * Math.PI);
        ctx.beginPath();
        ctx.moveTo(-6 + k * 10, -30 - p * 30);
        ctx.bezierCurveTo(-14 + k * 10, -38 - p * 30, 2 + k * 10, -46 - p * 30, -6 + k * 10, -54 - p * 30);
        ctx.stroke();
      }
    } else if (kind === 'stamp') {
      ctx.translate(x, y + 10);
      ctx.lineWidth = 4;
      ctx.strokeStyle = S.outline;
      ctx.fillStyle = '#A8733F';
      roundRect(ctx, -9, -44, 18, 36, 7); ctx.stroke(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -48, 13, 0, TAU); ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#7A4A22';
      roundRect(ctx, -22, 6, 44, 14, 3); ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#D83A3A';
      roundRect(ctx, -24, 18, 48, 10, 3); ctx.stroke(); ctx.fill();
    } else if (kind === 'fish') {
      drawFish(ctx, x + side * 6, y - 4, 0.9, side * 0.5);
    } else if (kind === 'yarn') {
      drawYarn(ctx, x, y - 18, 20, t * 2, '#E45B8F');
    }
    ctx.restore();
  }

  // ------------------------------------------------- free-standing sprites --
  function drawPawPrint(ctx, x, y, k, alpha, color) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = color || 'rgba(90, 50, 30, 0.6)';
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.beginPath(); ctx.ellipse(0, 6, 11, 9, 0, 0, TAU); ctx.fill();
    for (const [bx, by] of [[-12, -6], [-4, -12], [4, -12], [12, -6]]) { ctx.beginPath(); ctx.ellipse(bx, by, 4.2, 5.2, bx * 0.03, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  function drawYarn(ctx, x, y, r, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#5A2D14';
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
    g.addColorStop(0, '#FFB3CD');
    g.addColorStop(1, color || '#E45B8F');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = 'rgba(140, 30, 70, 0.55)';
    ctx.lineWidth = 2.2;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.ellipse(k * r * 0.22, 0, r * 0.35, r * 1.1, 0.5, 0, TAU); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = color || '#E45B8F';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(r * 0.7, r * 0.7); ctx.bezierCurveTo(r * 1.4, r * 1.2, r * 1.8, r * 0.4, r * 2.4, r * 1.1); ctx.stroke();
    ctx.restore();
  }

  function drawButterfly(ctx, x, y, k, flap, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    const f = 0.25 + Math.abs(Math.sin(flap)) * 0.75;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4A2A3A';
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.scale(s * f, 1);
      ctx.fillStyle = color || '#FF9BD2';
      ctx.beginPath(); ctx.ellipse(10, -8, 12, 10, -0.4, 0, TAU); ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#FFD36E';
      ctx.beginPath(); ctx.ellipse(8, 8, 8, 7, 0.4, 0, TAU); ctx.stroke(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(11, -10, 3, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#4A2A3A';
    ctx.beginPath(); ctx.ellipse(0, 0, 3, 13, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.quadraticCurveTo(-6, -22, -9, -22); ctx.moveTo(0, -12); ctx.quadraticCurveTo(6, -22, 9, -22); ctx.stroke();
    ctx.restore();
  }

  function drawBird(ctx, x, y, k, flap, dir) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k * (dir || 1), k);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2E3A4A';
    ctx.fillStyle = '#6FA8DC';
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 14, 0, 0, TAU); ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.arc(16, -10, 10, 0, TAU); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#F2B84B';
    ctx.beginPath(); ctx.moveTo(25, -11); ctx.lineTo(34, -8); ctx.lineTo(25, -5); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#2E3A4A';
    ctx.beginPath(); ctx.arc(18, -12, 2.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4C86C0';
    ctx.beginPath(); ctx.moveTo(-4, -4); ctx.quadraticCurveTo(-14, -6 - Math.sin(flap) * 22, -26, -10 - Math.sin(flap) * 18); ctx.quadraticCurveTo(-12, 4, -4, 4); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  function drawRocket(ctx, x, y, k, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.lineJoin = 'round';
    const fl = 1 + Math.sin(t * 40) * 0.15;
    const fg = ctx.createLinearGradient(0, 40, 0, 40 + 60 * fl);
    fg.addColorStop(0, '#FFF3A0'); fg.addColorStop(0.4, '#FFAE34'); fg.addColorStop(1, 'rgba(255,80,40,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.moveTo(-16, 38); ctx.quadraticCurveTo(0, 40 + 80 * fl, 16, 38); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#3A2A3A';
    ctx.fillStyle = '#E5484D';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 18, 10); ctx.lineTo(s * 34, 42); ctx.lineTo(s * 14, 38); ctx.closePath(); ctx.stroke(); ctx.fill(); }
    const g = ctx.createLinearGradient(-20, 0, 20, 0);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#C9D2DE');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, -60); ctx.quadraticCurveTo(26, -30, 20, 40); ctx.lineTo(-20, 40); ctx.quadraticCurveTo(-26, -30, 0, -60); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#7AC8F5';
    ctx.beginPath(); ctx.arc(0, -14, 10, 0, TAU); ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  function drawCup(ctx, x, y, rot, k, broken) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    ctx.scale(k || 1, k || 1);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#3A2A20';
    ctx.lineJoin = 'round';
    if (broken) {
      ctx.fillStyle = 'rgba(120, 72, 40, 0.65)';
      ctx.beginPath(); ctx.ellipse(0, 12, 40, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      for (const [px, py, r] of [[-22, 4, 0.4], [6, 8, -0.3], [26, 2, 0.9], [-4, -4, 1.4]]) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(r);
        ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(9, -7); ctx.lineTo(5, 6); ctx.lineTo(-7, 4); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, -18, -22, 36, 40, 7); ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#E5484D';
      ctx.fillRect(-16, -6, 32, 9);
      ctx.beginPath(); ctx.arc(22, -2, 9, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.fillStyle = '#6B3E1E';
      ctx.beginPath(); ctx.ellipse(0, -20, 14, 3.5, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- face --
  function drawFace(ctx, S, F) {
    const { t, state, pose, fx, fy, opts, look } = F;
    const sleepy = pose === 'sleep' || state === 'sleep';
    let eye = 'open';
    const blink = t % 3.7 < 0.14 || (t + 1.9) % 11.3 < 0.14;
    if (sleepy) eye = 'closed';
    else if (state === 'done') eye = 'happy';
    else if (state === 'error') eye = t % 2.4 < 1.2 ? 'x' : 'dizzy';
    else if (state === 'needs') eye = 'wide';
    else if (state === 'danger') eye = 'angry';
    else if (blink) eye = 'blink';
    else if (state === 'working') eye = 'focus';
    if (opts.eyes) eye = opts.eyes;

    const ex = 40, ey = fy + 4;
    const lx = state === 'thinking' ? -3 : look.x * 3;
    const ly = state === 'thinking' ? -5 : state === 'working' ? 4 : look.y * 3;
    for (const s of [-1, 1]) drawEye(ctx, S, fx + s * ex, ey, s, eye, lx, ly, t);

    // blush with little anime hatching
    for (const s of [-1, 1]) {
      const bx = fx + s * 60, by = fy + 30;
      const g = ctx.createRadialGradient(bx, by, 1, bx, by, 20);
      g.addColorStop(0, `rgba(${S.blush}, 0.55)`);
      g.addColorStop(1, `rgba(${S.blush}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(bx, by, 20, 12, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(${S.blush}, 0.7)`;
      ctx.lineWidth = 2;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(bx + k * 6 - 2, by + 3);
        ctx.lineTo(bx + k * 6 + 2, by - 3);
        ctx.stroke();
      }
    }

    // nose
    const ny = fy + 27;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(fx - 9, ny - 4);
    ctx.quadraticCurveTo(fx, ny - 8, fx + 9, ny - 4);
    ctx.quadraticCurveTo(fx + 7, ny + 2, fx, ny + 5);
    ctx.quadraticCurveTo(fx - 7, ny + 2, fx - 9, ny - 4);
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = S.outline;
    ctx.stroke();
    const ng = ctx.createLinearGradient(0, ny - 7, 0, ny + 5);
    ng.addColorStop(0, S.nose[0]);
    ng.addColorStop(1, S.nose[1]);
    ctx.fillStyle = ng;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.ellipse(fx - 3, ny - 3.5, 2.6, 1.4, -0.3, 0, TAU); ctx.fill();
    ctx.restore();

    // mouth
    let mouth = 'w';
    if (state === 'needs') mouth = t % 1.6 < 0.8 ? 'open' : 'w';
    if (state === 'done') mouth = 'smile';
    if (state === 'danger') mouth = 'hiss';
    if (state === 'error') mouth = 'wavy';
    if (opts.burp > 0 && opts.burp < 0.6) mouth = 'open';
    if (opts.yawn) mouth = 'yawn';
    if (opts.mouth) mouth = opts.mouth;
    drawMouth(ctx, S, fx, ny + 5, mouth, t);

    // whiskers
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const x0 = fx + s * 42, y0 = ny + 6 + k * 6;
        const x1 = fx + s * 132, y1 = ny - 8 + k * 16 + Math.sin(t * 2 + k) * 1.5;
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = S === SKINS.tuxedo ? 'rgba(255,255,255,0.85)' : 'rgba(90, 45, 20, 0.7)';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(lerp(x0, x1, 0.5), y0 - 4 + k * 2, x1, y1);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function eyePath(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.moveTo(x - rx, y);
    ctx.bezierCurveTo(x - rx, y - ry * 1.12, x + rx, y - ry * 1.12, x + rx, y);
    ctx.bezierCurveTo(x + rx, y + ry * 1.3, x - rx, y + ry * 1.3, x - rx, y);
    ctx.closePath();
  }

  function drawEye(ctx, S, x, y, side, mode, lx, ly, t) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lineEye = (pts, w) => {
      ctx.lineWidth = w || 5;
      ctx.strokeStyle = S.outline;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(x + p[0], y + p[1]) : ctx.moveTo(x + p[0], y + p[1])));
      ctx.stroke();
    };
    if (mode === 'blink') {
      ctx.lineWidth = 5; ctx.strokeStyle = S.outline;
      ctx.beginPath(); ctx.moveTo(x - 17, y + 2); ctx.quadraticCurveTo(x, y + 9, x + 17, y + 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + side * 16, y + 2); ctx.lineTo(x + side * 22, y - 2); ctx.stroke();
      ctx.restore();
      return;
    }
    if (mode === 'closed') {
      ctx.lineWidth = 5; ctx.strokeStyle = S.outline;
      ctx.beginPath(); ctx.moveTo(x - 16, y + 2); ctx.quadraticCurveTo(x, y + 14, x + 16, y + 2); ctx.stroke();
      ctx.restore();
      return;
    }
    if (mode === 'happy') {
      ctx.lineWidth = 6; ctx.strokeStyle = S.outline;
      ctx.beginPath(); ctx.moveTo(x - 16, y + 6); ctx.quadraticCurveTo(x, y - 14, x + 16, y + 6); ctx.stroke();
      ctx.restore();
      return;
    }
    if (mode === 'x') {
      lineEye([[-12, -10], [12, 10]]);
      lineEye([[12, -10], [-12, 10]]);
      ctx.restore();
      return;
    }
    if (mode === 'dizzy') {
      ctx.lineWidth = 3.5; ctx.strokeStyle = S.outline;
      ctx.beginPath();
      for (let i = 0; i < 60; i++) {
        const a = i * 0.32 + t * 6 * side;
        const r = i * 0.27;
        i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (mode === 'heart') {
      heart(ctx, x, y + 2, 2.1 + Math.sin(t * 8) * 0.12, '#FF5E86');
      ctx.restore();
      return;
    }
    if (mode === 'star') {
      star4(ctx, x, y, 19 + Math.sin(t * 9) * 2, '#FFD54A', 8);
      ctx.restore();
      return;
    }
    if (mode === 'half') mode = 'focus';
    const wide = mode === 'wide';
    const rx = wide ? 20 : 18;
    const ry = wide ? 23 : 21;
    eyePath(ctx, x, y, rx, ry);
    ctx.lineWidth = 4;
    ctx.strokeStyle = S.outline;
    ctx.stroke();
    ctx.fillStyle = S.pupil;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // iris glow at the bottom
    const ig = ctx.createRadialGradient(x + lx, y + ly + ry * 0.75, 2, x + lx, y + ly + ry * 0.5, ry * 1.1);
    ig.addColorStop(0, S.iris[0]);
    ig.addColorStop(0.4, S.iris[1]);
    ig.addColorStop(0.75, S.iris[2]);
    ig.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ig;
    ctx.fillRect(x - rx - 2, y - ry - 2, rx * 2 + 4, ry * 2.6);
    // pupil
    ctx.fillStyle = S.pupil;
    ctx.beginPath();
    ctx.ellipse(x + lx, y + ly - 2, rx * 0.5, ry * 0.62, 0, 0, TAU);
    ctx.fill();
    // highlights
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.36 + lx * 0.6, y - ry * 0.38 + ly * 0.6, rx * 0.36, ry * 0.3, -0.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + rx * 0.38 + lx * 0.6, y + ry * 0.3 + ly * 0.6, rx * 0.14, 0, TAU);
    ctx.fill();
    if (wide) star4(ctx, x + rx * 0.2 + lx, y - ry * 0.55, 6 + Math.sin(t * 8) * 1.5, '#FFFFFF');
    // focused half lid
    if (mode === 'focus') {
      ctx.fillStyle = S.fur[1];
      ctx.fillRect(x - rx - 4, y - ry - 6, rx * 2 + 8, ry * 0.85);
    }
    if (mode === 'angry') {
      ctx.fillStyle = S.fur[1];
      ctx.beginPath();
      ctx.moveTo(x - side * (rx + 6), y - ry - 8);
      ctx.lineTo(x + side * (rx + 6), y - ry - 8);
      ctx.lineTo(x + side * (rx + 6), y - ry * 0.85);
      ctx.lineTo(x - side * (rx + 6), y - ry * 0.05);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // lid line + lash flick
    ctx.lineWidth = 5;
    ctx.strokeStyle = S.outline;
    if (mode === 'focus') {
      ctx.beginPath(); ctx.moveTo(x - rx - 2, y - ry * 0.12); ctx.quadraticCurveTo(x, y - ry * 0.32, x + rx + 2, y - ry * 0.12); ctx.stroke();
    } else if (mode === 'angry') {
      ctx.beginPath(); ctx.moveTo(x - side * (rx + 4), y - ry * 0.05); ctx.lineTo(x + side * (rx + 4), y - ry * 0.85); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - rx - 1, y - 1);
      ctx.bezierCurveTo(x - rx, y - ry * 1.14, x + rx, y - ry * 1.14, x + rx + 1, y - 1);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x + side * (rx - 1), y - ry * 0.45);
    ctx.quadraticCurveTo(x + side * (rx + 6), y - ry * 0.7, x + side * (rx + 9), y - ry * 0.95);
    ctx.stroke();
    ctx.restore();
  }

  function drawMouth(ctx, S, x, y, mode, t) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = S.outline;
    ctx.lineWidth = 3.4;
    const inner = (path, tongue) => {
      path();
      ctx.fillStyle = '#8E2B3C';
      ctx.fill();
      ctx.save();
      ctx.clip();
      if (tongue) {
        ctx.fillStyle = '#F48A9B';
        ctx.beginPath(); ctx.ellipse(x, y + tongue, 9, 7, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
      path();
      ctx.stroke();
    };
    // philtrum
    ctx.beginPath(); ctx.moveTo(x, y - 1); ctx.lineTo(x, y + 5); ctx.stroke();
    if (mode === 'w') {
      ctx.beginPath();
      ctx.moveTo(x - 15, y + 2);
      ctx.quadraticCurveTo(x - 8, y + 12, x, y + 5);
      ctx.quadraticCurveTo(x + 8, y + 12, x + 15, y + 2);
      ctx.stroke();
    } else if (mode === 'open') {
      inner(() => { ctx.beginPath(); ctx.moveTo(x - 10, y + 5); ctx.quadraticCurveTo(x, y + 2, x + 10, y + 5); ctx.quadraticCurveTo(x + 9, y + 22, x, y + 23); ctx.quadraticCurveTo(x - 9, y + 22, x - 10, y + 5); ctx.closePath(); }, 18);
    } else if (mode === 'smile') {
      inner(() => { ctx.beginPath(); ctx.moveTo(x - 15, y + 4); ctx.quadraticCurveTo(x, y + 8, x + 15, y + 4); ctx.quadraticCurveTo(x + 12, y + 22, x, y + 22); ctx.quadraticCurveTo(x - 12, y + 22, x - 15, y + 4); ctx.closePath(); }, 18);
    } else if (mode === 'hiss') {
      inner(() => { ctx.beginPath(); ctx.moveTo(x - 17, y + 4); ctx.quadraticCurveTo(x, y, x + 17, y + 4); ctx.quadraticCurveTo(x + 14, y + 26, x, y + 27); ctx.quadraticCurveTo(x - 14, y + 26, x - 17, y + 4); ctx.closePath(); }, 22);
      ctx.fillStyle = '#FFFFFF';
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(x + s * 13, y + 4); ctx.lineTo(x + s * 7, y + 4); ctx.lineTo(x + s * 10, y + 12); ctx.closePath(); ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
      }
    } else if (mode === 'wavy') {
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) { const xx = x - 14 + i * 1.17; const yy = y + 9 + Math.sin(i * 0.8 + t * 6) * 2.5; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.stroke();
    } else if (mode === 'blep') {
      ctx.beginPath();
      ctx.moveTo(x - 15, y + 2);
      ctx.quadraticCurveTo(x - 8, y + 12, x, y + 5);
      ctx.quadraticCurveTo(x + 8, y + 12, x + 15, y + 2);
      ctx.stroke();
      ctx.fillStyle = '#F48A9B';
      ctx.beginPath(); ctx.ellipse(x + 2, y + 12, 5, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2.4; ctx.stroke();
    } else if (mode === 'munch') {
      const open = Math.floor(t * 7) % 2 === 0;
      if (open) inner(() => { ctx.beginPath(); ctx.ellipse(x, y + 10, 9, 7, 0, 0, Math.PI * 2); }, 14);
      else { ctx.beginPath(); ctx.moveTo(x - 12, y + 6); ctx.quadraticCurveTo(x, y + 12, x + 12, y + 6); ctx.stroke(); }
    } else if (mode === 'meow') {
      inner(() => { ctx.beginPath(); ctx.ellipse(x, y + 13, 10, 12, 0, 0, Math.PI * 2); }, 20);
    } else if (mode === 'pant') {
      inner(() => { ctx.beginPath(); ctx.moveTo(x - 12, y + 5); ctx.quadraticCurveTo(x, y + 2, x + 12, y + 5); ctx.quadraticCurveTo(x + 10, y + 18, x, y + 19); ctx.quadraticCurveTo(x - 10, y + 18, x - 12, y + 5); ctx.closePath(); }, 0);
      ctx.fillStyle = '#F48A9B';
      ctx.beginPath(); ctx.ellipse(x, y + 22 + Math.sin(t * 12) * 1.5, 8, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2.4; ctx.stroke();
    } else if (mode === 'o') {
      inner(() => { ctx.beginPath(); ctx.ellipse(x, y + 10, 5, 6, 0, 0, Math.PI * 2); }, 0);
    } else if (mode === 'yawn') {
      inner(() => { ctx.beginPath(); ctx.ellipse(x, y + 16, 13, 15, 0, 0, TAU); }, 26);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------- effects --
  function drawEffects(ctx, S, E) {
    const { t, state, pose, fx, fy, hcx, hcy, hrx, htop, bcx, bcy, brx, bottom, opts } = E;
    if (state === 'thinking') {
      const cx = hcx + hrx + 30, cy = htop - 10;
      ctx.save();
      ctx.lineWidth = 4;
      ctx.strokeStyle = S.outline;
      const blobs = [[0, 0, 26], [26, -10, 22], [46, 6, 20], [22, 16, 22], [-20, 10, 18]];
      ctx.beginPath();
      for (const [ox, oy, r] of blobs) { ctx.moveTo(cx + ox + r, cy + oy); ctx.arc(cx + ox, cy + oy, r, 0, TAU); }
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      for (const [ox, oy, r] of [[-30, 40, 7], [-44, 60, 4.5]]) {
        ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r, 0, TAU); ctx.stroke(); ctx.fill();
      }
      const n = Math.floor(t * 3) % 4;
      ctx.fillStyle = S.outline;
      for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.arc(cx + k * 14, cy + 4, 4.5, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    if (state === 'needs') {
      const bx = hcx - hrx - 70, by = htop - 50;
      ctx.save();
      ctx.lineWidth = 4;
      ctx.strokeStyle = S.outline;
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, bx, by, 54, 58, 14);
      ctx.stroke(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx + 38, by + 56); ctx.lineTo(bx + 60, by + 74); ctx.lineTo(bx + 48, by + 54); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.fillRect(bx + 36, by + 50, 14, 6);
      if (t % 0.9 < 0.62) {
        ctx.fillStyle = '#E5484D';
        roundRect(ctx, bx + 22, by + 10, 10, 26, 5); ctx.fill();
        ctx.beginPath(); ctx.arc(bx + 27, by + 45, 5.5, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    if (state === 'sleep' || pose === 'sleep') {
      const ph = (Math.sin(t * 1.6) + 1) / 2;
      const r = 4 + ph * 11;
      const x = fx + 14 + r, y = fy + 24;
      ctx.save();
      const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.5, 'rgba(200,235,255,0.55)');
      g.addColorStop(1, 'rgba(150,210,245,0.75)');
      ctx.fillStyle = g;
      ctx.strokeStyle = 'rgba(90,160,210,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.font = 'bold 30px "Trebuchet MS", system-ui, sans-serif';
      for (let k = 0; k < 3; k++) {
        const p = (t * 0.32 + k / 3) % 1;
        ctx.globalAlpha = Math.sin(p * Math.PI);
        ctx.fillStyle = '#7E9CC4';
        ctx.font = `bold ${18 + k * 6}px "Trebuchet MS", system-ui, sans-serif`;
        ctx.fillText('z', hcx + hrx - 10 + k * 18 + Math.sin(p * 6 + k) * 6, htop - p * 60);
      }
      ctx.restore();
    }
    if (state === 'done') {
      const spots = [[hcx - hrx - 30, htop + 10], [hcx + hrx + 26, htop - 14], [hcx - hrx - 44, bcy - 10], [hcx + hrx + 40, bcy + 10], [hcx + 20, htop - 60]];
      spots.forEach(([x, y], i) => {
        const p = (t * 1.3 + i * 0.37) % 1;
        const s = Math.sin(p * Math.PI);
        star4(ctx, x, y, 6 + s * 10, '#FFD54A', 10);
      });
      for (let k = 0; k < 2; k++) {
        const p = (t * 0.45 + k * 0.5) % 1;
        heart(ctx, hcx - hrx - 10 + Math.sin(p * 7 + k) * 8 + k * 20, htop + 40 - p * 90, 1.4, '#FF7A93', Math.sin(p * Math.PI));
      }
    }
    if (state === 'danger') {
      ctx.save();
      ctx.strokeStyle = '#E5484D';
      ctx.lineWidth = 5;
      const ax = hcx + hrx - 6, ay = htop - 6;
      const k = 1 + Math.sin(t * 14) * 0.1;
      for (let i = 0; i < 4; i++) {
        ctx.save(); ctx.translate(ax, ay); ctx.rotate((i * Math.PI) / 2); ctx.scale(k, k);
        ctx.beginPath(); ctx.moveTo(4, -12); ctx.quadraticCurveTo(4, -4, 12, -4); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
    if (state === 'error') {
      const p = (t * 0.8) % 1;
      ctx.save();
      ctx.globalAlpha = 1 - p * 0.6;
      const x = hcx + hrx - 16, y = htop + 30 + p * 26;
      ctx.fillStyle = '#8FD0F7';
      ctx.strokeStyle = '#3F86B8';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.quadraticCurveTo(x + 10, y, x, y + 6); ctx.quadraticCurveTo(x - 10, y, x, y - 14); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    if (state === 'working' && opts.prop === 'laptop') {
      const syms = ['</>', '{ }', '( )', '=>', '#', ';'];
      ctx.save();
      ctx.font = 'bold 18px Consolas, "Cascadia Code", monospace';
      for (let k = 0; k < 4; k++) {
        const p = (t * 0.45 + k / 4) % 1;
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.9;
        ctx.fillStyle = k % 2 ? '#5FA8E8' : '#E58A3C';
        ctx.fillText(syms[(k + Math.floor(t * 0.45)) % syms.length], CX - 80 + k * 44 + Math.sin(p * 5 + k) * 8, bottom - 110 - p * 90);
      }
      ctx.restore();
    }
    if (opts.burp > 0) {
      ctx.save();
      for (let k = 0; k < 5; k++) {
        const p = opts.burp * 1.4 - k * 0.15;
        if (p <= 0 || p >= 1) continue;
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = '#4FB3D9';
        ctx.fillStyle = 'rgba(190, 236, 255, 0.5)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(fx + 20 + k * 12 + Math.sin(p * 9) * 6, fy + 50 - p * 120, 6 + k * 2, 0, TAU); ctx.fill(); ctx.stroke();
      }
      if (opts.burp < 0.7) {
        ctx.globalAlpha = 1 - opts.burp / 0.7;
        ctx.fillStyle = '#4FB3D9';
        ctx.font = 'bold 26px "Trebuchet MS", system-ui, sans-serif';
        ctx.fillText('burp!', fx + 46, fy + 30 - opts.burp * 40);
      }
      ctx.restore();
    }
    if (opts.prop === 'fish' || state === 'done') {
      drawFish(ctx, bcx - brx - 26, bottom - 16 - Math.abs(Math.sin(t * 4)) * 8, 1, Math.sin(t * 4) * 0.15);
    }
  }

  const api = { draw, SKINS, W, H, CX, GROUND, drawFish, drawYarn, drawButterfly, drawBird, drawRocket, drawCup, drawParcel, drawPawPrint, heart, star4, toeBeans };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CatArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
