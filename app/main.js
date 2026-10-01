'use strict';
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { FILES, ensureHome, loadSettings, saveSettings, writeJSON, readJSON, HOME } = require('./shared/config');
const { Sessions } = require('./main/sessions');
const { EventServer } = require('./main/server');
const { Stats } = require('./main/stats');
const { Desktop } = require('./main/desktop');
const { Cafe } = require('./main/cafe');
const { answer } = require('./main/ask');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (process.env.CHONKY_NO_GPU || loadSettings().noGpu) app.disableHardwareAcceleration();
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');

let settings = loadSettings();
const stats = new Stats();
const sessions = new Sessions();
const server = new EventServer();
const cafe = new Cafe();
let desktop = null;
let overlay = null;
let settingsWin = null;
let tray = null;
let hitRects = [];
let ignoring = true;
let lastCursor = { x: -1, y: -1 };
let currentDisplayId = null;
let workStreakMin = 0;
let idleMin = 0;
let lastStatus = sessions.snapshot();

function log(...a) {
  try { fs.appendFileSync(FILES.log, `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch {}
}

// ------------------------------------------------------------- overlay --
function pickDisplay() {
  const all = screen.getAllDisplays();
  if (settings.position && settings.position.display) {
    const d = all.find((x) => x.id === settings.position.display);
    if (d) return d;
  }
  return screen.getPrimaryDisplay();
}

function createOverlay() {
  const d = pickDisplay();
  currentDisplayId = d.id;
  const b = d.workArea;
  overlay = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    title: 'Chonky Cat',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlay.once('ready-to-show', () => overlay.showInactive());
  overlay.on('closed', () => { overlay = null; });
  overlay.webContents.on('console-message', (e) => {
    const lvl = e.level != null ? e.level : '';
    if (lvl === 'error' || lvl === 'warning' || lvl === 2 || lvl === 3 || process.env.CHONKY_DEBUG) log('renderer', lvl, e.message, e.sourceId ? `${path.basename(e.sourceId)}:${e.lineNumber}` : '');
  });
  overlay.webContents.on('did-finish-load', () => log('overlay loaded', JSON.stringify(overlay.getBounds()), 'visible', overlay.isVisible()));
  overlay.webContents.on('render-process-gone', (_e, details) => {
    log('renderer gone', details.reason);
    setTimeout(() => { if (overlay) overlay.reload(); }, 1000);
  });
}

function send(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

// The scene uses the work area of the cat's display as its coordinate space.
// The window itself is only as big as needed (see 'set-viewport') because
// transparent windows cost GPU time proportional to their area.
function overlayBounds() {
  const d = screen.getAllDisplays().find((x) => x.id === currentDisplayId) || screen.getPrimaryDisplay();
  return d.workArea;
}

let viewport = null;
function setViewport(vp) {
  if (!overlay || overlay.isDestroyed()) return;
  const wa = overlayBounds();
  const w = Math.max(80, Math.min(wa.width, Math.round(vp.w)));
  const h = Math.max(80, Math.min(wa.height, Math.round(vp.h)));
  const x = Math.max(0, Math.min(wa.width - w, Math.round(vp.x)));
  const y = Math.max(0, Math.min(wa.height - h, Math.round(vp.y)));
  viewport = { x, y, w, h };
  overlay.setBounds({ x: wa.x + x, y: wa.y + y, width: w, height: h });
  return viewport;
}

function moveToDisplay(pt) {
  const d = screen.getDisplayNearestPoint(pt);
  if (d.id === currentDisplayId || !overlay) return null;
  currentDisplayId = d.id;
  overlay.setBounds(d.workArea);
  viewport = { x: 0, y: 0, w: d.workArea.width, h: d.workArea.height };
  return d.workArea;
}

// Click-through except on the cat: poll the cursor and toggle mouse events.
function pollCursor() {
  if (!overlay || overlay.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const b = overlayBounds();
  const x = p.x - b.x, y = p.y - b.y;
  if (x !== lastCursor.x || y !== lastCursor.y) {
    lastCursor = { x, y };
    send('cursor', { x, y, inside: x >= 0 && y >= 0 && x < b.width && y < b.height });
  }
  const over = hitRects.some((r) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h);
  if (over === ignoring) {
    ignoring = !over;
    overlay.setIgnoreMouseEvents(ignoring, { forward: true });
  }
}

// ---------------------------------------------------------------- tray --
function buildTray(dataUrl) {
  const img = dataUrl ? nativeImage.createFromDataURL(dataUrl) : nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  if (!tray) {
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 18, height: 18 }));
    tray.on('click', () => toggleVisible());
  } else if (!img.isEmpty()) {
    tray.setImage(img.resize({ width: 18, height: 18 }));
  }
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const snap = lastStatus;
  const s = stats.get();
  const sessionItems = snap.sessions.length
    ? snap.sessions.slice(0, 8).map((x) => ({ label: `${dot(x.state)}  ${x.project} — ${x.detail || x.state}`, enabled: false }))
    : [{ label: 'No Claude Code sessions', enabled: false }];
  tray.setToolTip(`${settings.name}: ${snap.detail || snap.state}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${settings.name} · 🐟 ${s.fish}  ·  🔥 ${s.streakDays}-day streak`, enabled: false },
    { type: 'separator' },
    ...sessionItems,
    { type: 'separator' },
    { label: overlay && overlay.isVisible() ? 'Hide' : 'Show', click: toggleVisible },
    { label: 'Do not disturb', type: 'checkbox', checked: !!settings.dnd, click: (m) => applySettings({ dnd: m.checked }) },
    { label: 'Feed a fish', enabled: s.fish > 0, click: () => send('fx', { type: 'feed-request' }) },
    { label: 'Settings…', click: openSettings },
    { label: 'Open data folder', click: () => shell.openPath(HOME) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function dot(state) {
  return { needs: '🟠', danger: '🔴', error: '🔴', working: '🔵', thinking: '🟣', done: '🟢', idle: '⚪', sleep: '⚫' }[state] || '⚪';
}

function toggleVisible() {
  if (!overlay) return;
  if (overlay.isVisible()) overlay.hide();
  else { overlay.showInactive(); send('fx', { type: 'hello' }); }
  refreshTrayMenu();
}

// ------------------------------------------------------------ settings --
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 780, minWidth: 420, minHeight: 500,
    title: `${settings.name} settings`,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#fff8ef',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function applySettings(patch) {
  settings = saveSettings(patch);
  send('settings', settings);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings', settings);
  cafe.configure(settings.cafe, { name: settings.name, skin: settings.skin });
  try { app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin, args: [app.getAppPath()] }); } catch {}
  registerHotkey();
  refreshTrayMenu();
  return settings;
}

let registeredHotkey = null;
function registerHotkey() {
  if (registeredHotkey === settings.hotkey) return;
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = null;
  if (!settings.hotkey) return;
  try {
    if (globalShortcut.register(settings.hotkey, toggleVisible)) registeredHotkey = settings.hotkey;
  } catch {}
}

// ------------------------------------------------------------ events --
function onFx(fx) {
  switch (fx.type) {
    case 'done': {
      const r = stats.taskDone();
      fx.fish = r.fish; fx.streak = r.streak; fx.today = r.today;
      cafe.announce('done', fx.project);
      break;
    }
    case 'git-commit': stats.bump('commits'); cafe.announce('git-commit', fx.project); break;
    case 'git-push': stats.bump('pushes'); cafe.announce('git-push', fx.project); break;
    case 'tests-pass': stats.bump('testsPassed'); cafe.announce('tests-pass', fx.project); break;
    case 'tests-fail': stats.bump('testsFailed'); break;
    case 'kitten-spawn': stats.bump('kittens'); break;
    case 'compact-end': stats.bump('compacts'); break;
    case 'danger': stats.bump('dangers'); break;
    case 'needs': case 'permission': stats.adjustMood(-0.01); break;
    default: break;
  }
  if (fx.type === 'done' && settings.speakSummaries) fx.speak = true;
  send('fx', fx);
  send('stats', stats.get());
}

function minuteTick() {
  const busy = ['working', 'thinking', 'needs', 'danger'].includes(lastStatus.state);
  stats.minute(busy);
  if (busy) { workStreakMin++; idleMin = 0; } else if (++idleMin >= 10) workStreakMin = 0;
  if (settings.breakGuardian && workStreakMin >= settings.breakMinutes) {
    workStreakMin = 0;
    send('fx', { type: 'break-time', minutes: settings.breakMinutes });
  }
  send('stats', stats.get());
  refreshTrayMenu();
}

// ------------------------------------------------------------------ ipc --
function wireIpc() {
  ipcMain.handle('init', () => ({
    settings,
    stats: stats.get(),
    status: lastStatus,
    platform: process.platform,
    version: app.getVersion(),
    bounds: overlayBounds(),
  }));
  ipcMain.handle('set-viewport', (_e, vp) => setViewport(vp));
  ipcMain.on('hit-rects', (_e, rects) => { hitRects = Array.isArray(rects) ? rects.slice(0, 32) : []; });
  ipcMain.handle('move-display', (_e, pt) => {
    const b = overlayBounds();
    return moveToDisplay({ x: Math.round(pt.x + b.x), y: Math.round(pt.y + b.y) });
  });
  ipcMain.on('save-position', (_e, pos) => {
    settings = saveSettings({ position: Object.assign({}, pos, { display: currentDisplayId }) });
  });
  ipcMain.on('permission-decision', (_e, { id, decision }) => server.resolve(id, decision === 'allow' || decision === 'deny' ? decision : null));
  ipcMain.handle('feed', () => { const ok = stats.feed(); send('stats', stats.get()); refreshTrayMenu(); return ok; });
  ipcMain.on('pet', () => { stats.bump('pets'); stats.adjustMood(0.02); });
  ipcMain.on('open-settings', openSettings);
  ipcMain.on('quit', () => app.quit());
  ipcMain.on('tray-icon', (_e, dataUrl) => buildTray(dataUrl));
  ipcMain.on('focus-overlay', (_e, on) => {
    if (!overlay) return;
    if (on) { overlay.setIgnoreMouseEvents(false); ignoring = false; overlay.focus(); }
  });
  ipcMain.handle('ask', (_e, q) => answer(String(q || '').slice(0, 300), { settings, status: lastStatus, stats: stats.get() }));
  ipcMain.handle('fg-window', async () => {
    if (!desktop || !settings.desktopAwareness) return null;
    const w = await desktop.foreground();
    return w && toLocal(w);
  });
  ipcMain.handle('session-window', async (_e, project) => {
    if (!desktop || !settings.desktopAwareness || !settings.runToWindow) return null;
    const w = await desktop.findSessionWindow(project);
    return w && toLocal(w);
  });
  ipcMain.handle('get-settings', () => settings);
  ipcMain.handle('save-settings', (_e, patch) => applySettings(sanitize(patch)));
  ipcMain.handle('get-stats', () => stats.get());
  ipcMain.handle('preview-fx', (_e, type) => {
    const fx = { type: String(type), project: 'preview', session: 'preview', preview: true, summary: 'This is what a finished-task summary sounds like.', fish: stats.get().fish, streak: stats.get().streakDays };
    if (fx.type === 'kitten-spawn') {
      const id = 'preview-' + Date.now();
      send('fx', Object.assign(fx, { agentId: id, agentType: 'Explore' }));
      setTimeout(() => send('fx', { type: 'kitten-return', agentId: id, agentType: 'Explore' }), 7000);
      return;
    }
    if (fx.type === 'cafe-visit') Object.assign(fx, { cat: 'Mochi', owner: 'A teammate', skin: 'grey', event: 'done' });
    if (fx.type === 'danger') fx.risk = 'recursive delete';
    if (fx.type === 'done' && settings.speakSummaries) fx.speak = true;
    send('fx', fx);
  });
}

function toLocal(w) {
  const b = overlayBounds();
  return Object.assign({}, w, { x: w.x - b.x, y: w.y - b.y });
}

function sanitize(p) {
  const out = {};
  const allowed = ['roam', 'name', 'skin', 'size', 'fps', 'sounds', 'volume', 'speakSummaries', 'voice', 'showStatusLine', 'pawApproval', 'pawApprovalTimeout', 'dangerGuard', 'randomAnimations', 'animationFrequency', 'desktopAwareness', 'runToWindow', 'perchOnWindows', 'cursorPlay', 'breakGuardian', 'breakMinutes', 'autoStart', 'launchAtLogin', 'hotkey', 'dnd', 'seasonal', 'cafe'];
  for (const k of allowed) if (p && k in p) out[k] = p[k];
  if ('name' in out) out.name = String(out.name || 'Arshia').trim().slice(0, 24) || 'Arshia';
  if ('size' in out) out.size = Math.max(90, Math.min(420, Number(out.size) || 190));
  if ('fps' in out) out.fps = [20, 24, 30, 45, 60].includes(Number(out.fps)) ? Number(out.fps) : 24;
  return out;
}

// ------------------------------------------------------------- startup --
app.whenReady().then(async () => {
  ensureHome();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  app.setAppUserModelId('dev.chonkycat.app');

  try {
    await server.start();
  } catch (e) {
    log('server failed', e.message);
  }
  writeJSON(FILES.runtime, { port: server.port, token: server.token, pid: process.pid, started: Date.now(), version: app.getVersion() });
  writeJSON(path.join(HOME, 'launch.json'), { command: process.execPath, args: process.defaultApp ? [app.getAppPath()] : [] });

  server.on('event', (ev) => {
    if (process.env.CHONKY_DEBUG) log('event', ev.hook_event_name, ev.tool_name || '', ev.notification_type || '', ev.agent_type || '');
    sessions.handle(ev);
  });
  server.on('permission', ({ id, ev }) => {
    if (settings.dnd) return server.resolve(id, null);
    send('permission', { id, tool: ev.tool_name, input: ev.tool_input, project: path.basename(ev.cwd || ''), timeout: settings.pawApprovalTimeout });
  });
  server.on('permission-resolved', (r) => send('permission-resolved', r));
  server.on('control', (c) => {
    const action = c && c.action;
    if (action === 'settings') openSettings();
    else if (action === 'show') { if (overlay) { overlay.showInactive(); send('fx', { type: 'hello' }); } }
    else if (action === 'hide') { if (overlay) overlay.hide(); }
    else if (action === 'fx' && typeof c.type === 'string') send('fx', Object.assign({ preview: true, project: 'cli' }, c, { type: c.type }));
  });
  sessions.on('status', (s) => { lastStatus = s; send('status', s); });
  sessions.on('fx', onFx);
  cafe.on('visit', (v) => send('fx', Object.assign({ type: 'cafe-visit' }, v)));
  cafe.configure(settings.cafe, { name: settings.name, skin: settings.skin });

  desktop = new Desktop({ toDip: (r) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r) });
  desktop.start();

  wireIpc();
  createOverlay();
  registerHotkey();
  buildTray(null);
  setInterval(pollCursor, 33);
  setInterval(minuteTick, 60000);
  screen.on('display-removed', () => { if (overlay) overlay.setBounds(screen.getPrimaryDisplay().workArea); });
  screen.on('display-metrics-changed', () => {
    if (!overlay) return;
    const d = screen.getAllDisplays().find((x) => x.id === currentDisplayId) || screen.getPrimaryDisplay();
    overlay.setBounds(d.workArea);
    viewport = null;
    send('bounds', d.workArea);
  });
  log('started on port', server.port);
});

app.on('second-instance', () => {
  if (overlay) { overlay.showInactive(); send('fx', { type: 'hello' }); }
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', () => {
  stats.flush();
  server.stop();
  if (desktop) desktop.stop();
  cafe.close();
  globalShortcut.unregisterAll();
  const rt = readJSON(FILES.runtime, null);
  if (rt && rt.pid === process.pid) try { fs.unlinkSync(FILES.runtime); } catch {}
});
