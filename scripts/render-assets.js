// Renders README images from the live art engine.
// Usage: npx electron scripts/render-assets.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs');

const PAGE = `<!doctype html><html><body style="margin:0">
<script src="${path.join(__dirname, '..', 'app', 'renderer', 'arshia-art.js').replace(/\\/g, '/')}"></script>
<script>
  const A = window.ArshiaArt;
  function shot(w, opts, label) {
    const h = Math.round(w * A.H / A.W) + (label ? 34 : 0);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.save();
    x.scale(w / A.W, w / A.W);
    A.draw(x, Object.assign({ t: 1.1 }, opts));
    x.restore();
    if (label) {
      x.font = 'bold 18px "Trebuchet MS", sans-serif';
      x.textAlign = 'center';
      x.fillStyle = '#5a2d14';
      x.fillText(label, w / 2, h - 10);
    }
    return c;
  }
  function sheet(items, cols, w) {
    const tiles = items.map(([label, opts]) => shot(w, opts, label));
    const th = tiles[0].height;
    const rows = Math.ceil(tiles.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * w; c.height = rows * th;
    const x = c.getContext('2d');
    tiles.forEach((t, i) => x.drawImage(t, (i % cols) * w, Math.floor(i / cols) * th));
    return c.toDataURL('image/png');
  }
  function icon(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const k = size / 250;
    x.setTransform(k, 0, 0, k, -(A.CX - 125) * k, -28 * k);
    A.draw(x, { t: 0.5, fat: 0.2, eyes: 'happy', mouth: 'w' });
    return c.toDataURL('image/png');
  }
  window.render = () => ({
    icon: icon(256),
    hero: shot(640, { state: 'idle', fat: 0.3, eyes: 'happy', mouth: 'smile' }).toDataURL('image/png'),
    states: sheet([
      ['Thinking', { state: 'thinking' }],
      ['Editing', { state: 'working', prop: 'laptop' }],
      ['Reading', { state: 'working', prop: 'book', eyes: 'half' }],
      ['Terminal', { state: 'working', prop: 'terminal' }],
      ['Web search', { state: 'working', prop: 'binoculars' }],
      ['Planning', { state: 'working', prop: 'clipboard' }],
      ['Needs you', { state: 'needs', wave: 1 }],
      ['Danger sense', { state: 'danger' }],
      ['Done!', { state: 'done' }],
      ['Tool failed', { state: 'error' }],
      ['Commit stamp', { prop: 'package', stamped: 1, raise: { side: -1, x: 120, y: 290, hold: 'stamp' }, eyes: 'happy' }],
      ['Asleep', { state: 'sleep', hat: 'nightcap' }],
    ], 4, 260),
    fun: sheet([
      ['Context 10%', { fat: 0.05 }],
      ['Context 90%', { fat: 0.95, eyes: 'half' }],
      ['Kitten (subagent)', { kitten: true, fat: 0, prop: 'laptop' }],
      ['If I fits…', { prop: 'box', eyes: 'happy' }],
      ['Petted', { eyes: 'heart', headTilt: 0.15 }],
      ['Party', { hat: 'party', eyes: 'star', mouth: 'smile' }],
      ['October', { hat: 'pumpkin', eyes: 'happy' }],
      ['Streak crown', { hat: 'crown', eyes: 'happy' }],
    ], 4, 260),
    skins: sheet(Object.keys(A.SKINS).map((k) => [A.SKINS[k].label, { skin: k, eyes: 'happy', mouth: 'smile' }]), 4, 260),
  });
</script></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } });
  const tmp = path.join(app.getPath('temp'), 'arshia-assets.html');
  fs.writeFileSync(tmp, PAGE);
  await win.loadFile(tmp);
  const imgs = await win.webContents.executeJavaScript('render()');
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, url] of Object.entries(imgs)) {
    const dest = name === 'icon' ? path.join(__dirname, '..', 'app', 'assets', 'icon.png') : path.join(OUT, `${name}.png`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote ' + path.relative(path.join(__dirname, '..'), dest));
  }
  app.quit();
});
