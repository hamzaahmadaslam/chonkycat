'use strict';
// Shared between the Electron app, the CLI and the Claude Code hook script.
// Keep this file dependency-free and fast to load: the hook runs on every tool call.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.CHONKY_HOME || path.join(os.homedir(), '.chonkycat');
const FILES = {
  settings: path.join(HOME, 'settings.json'),
  runtime: path.join(HOME, 'runtime.json'),
  stats: path.join(HOME, 'stats.json'),
  log: path.join(HOME, 'chonkycat.log'),
};

const DEFAULTS = {
  name: 'Arshia',
  skin: 'tabby',
  size: 190,
  fps: 24,
  sounds: true,
  volume: 0.45,
  speakSummaries: false,
  voice: '',
  showStatusLine: true,
  pawApproval: false,
  pawApprovalTimeout: 25,
  dangerGuard: true,
  randomAnimations: true,
  roam: true,
  kittens: true,
  kittenLabels: 'activity', // off | name | activity
  maxKittens: 2, // more than this wait in the "+N more" badge / Agents panel
  kittenColors: 'mixed', // mixed | match
  hat: '',
  notifications: 'hidden', // off | hidden (only when the cat is hidden) | always
  animationFrequency: 1, // 0.5 calm … 2 hyper
  desktopAwareness: true,
  runToWindow: true,
  perchOnWindows: true,
  cursorPlay: true,
  breakGuardian: true,
  breakMinutes: 90,
  autoStart: true,
  launchAtLogin: false,
  hotkey: 'CommandOrControl+Alt+A',
  dnd: false,
  seasonal: true,
  cafe: { enabled: false, room: '', displayName: '', shareProject: false },
  position: null,
};

function ensureHome() {
  try { fs.mkdirSync(HOME, { recursive: true }); } catch {}
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}

function writeJSON(file, data, mode) {
  ensureHome();
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: mode || 0o600 });
  fs.renameSync(tmp, file);
}

function loadSettings() {
  let s = readJSON(FILES.settings, {});
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  return Object.assign({}, DEFAULTS, s, { cafe: Object.assign({}, DEFAULTS.cafe, s.cafe || {}) });
}

function saveSettings(patch) {
  const next = Object.assign(loadSettings(), patch);
  writeJSON(FILES.settings, next);
  return next;
}

module.exports = { HOME, FILES, DEFAULTS, ensureHome, readJSON, writeJSON, loadSettings, saveSettings };
