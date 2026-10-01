#!/usr/bin/env node
'use strict';
// chonkycat CLI: start/stop the desktop cat, wire hooks, run a demo, diagnose.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { FILES, HOME, ensureHome, readJSON, loadSettings } = require('../app/shared/config');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'plugin', 'scripts', 'chonky-hook.js');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const cmd = (process.argv[2] || 'start').toLowerCase();

const c = {
  o: (s) => `\x1b[38;5;208m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};
const cat = c.o('ฅ^•ﻌ•^ฅ');

function health(rt) {
  return new Promise((resolve) => {
    if (!rt || !rt.port) return resolve(false);
    const req = http.get({ host: '127.0.0.1', port: rt.port, path: '/health', timeout: 800 }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b).app === 'chonkycat'); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function post(rt, route, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: rt.port, path: route, method: 'POST', timeout: 1500, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-chonky-token': rt.token } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode === 200)); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(data);
  });
}

let electronError = '';
function electronPath() {
  try { return require('electron'); } catch (e) { electronError = e.message; return null; }
}

async function start() {
  const rt = readJSON(FILES.runtime, null);
  if (await health(rt)) {
    console.log(`${cat}  ${loadSettings().name} is already awake (port ${rt.port}).`);
    return;
  }
  const bin = electronPath();
  if (!bin || typeof bin !== 'string') {
    console.error(c.r('Electron could not be loaded' + (electronError ? `: ${electronError}` : '.')));
    console.error(c.d('   Try reinstalling: npm install -g chonkycat  (or delete the npx cache and run npx chonkycat again)'));
    process.exit(1);
  }
  ensureHome();
  // ELECTRON_RUN_AS_NODE must be absent, not empty: Electron only checks that it exists
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const out = fs.openSync(FILES.log, 'a');
  const child = spawn(bin, [ROOT], { detached: true, stdio: ['ignore', out, out], windowsHide: false, env });
  child.on('error', (e) => console.error(c.r('Could not start Electron: ' + e.message)));
  child.unref();
  console.log(`${cat}  Waking up ${c.b(loadSettings().name)}… she’ll appear at the bottom of your screen.`);
  if (!hooksInstalled()) {
    console.log(c.d('\nTip: connect her to Claude Code with the plugin:'));
    console.log(`   /plugin marketplace add ${c.b('hamzaahmadaslam/chonkycat')}`);
    console.log(`   /plugin install ${c.b('chonkycat@chonkycat')}`);
    console.log(c.d(`or wire hooks directly:  npx chonkycat install-hooks`));
  }
}

async function stop() {
  const rt = readJSON(FILES.runtime, null);
  if (!rt || !(await health(rt))) { console.log(`${loadSettings().name} is not running.`); return; }
  await post(rt, '/control', { action: 'quit' });
  for (let i = 0; i < 30 && (await health(rt)); i++) await new Promise((r) => setTimeout(r, 100));
  if (await health(rt)) { try { process.kill(rt.pid); } catch (e) { console.error(c.r('Could not stop: ' + e.message)); return; } }
  console.log(`${cat}  Goodnight, ${loadSettings().name}. 💤`);
}

async function status() {
  const rt = readJSON(FILES.runtime, null);
  const up = await health(rt);
  console.log(`${cat}  ${loadSettings().name}: ${up ? c.g('awake') + c.d(` (port ${rt.port}, pid ${rt.pid})`) : c.r('asleep (not running)')}`);
  console.log(`   hooks: ${hooksInstalled() ? c.g('installed in ~/.claude/settings.json') : c.d('not in settings.json (fine if you use the plugin)')}`);
  const st = readJSON(FILES.stats, null);
  if (st) console.log(`   🐟 ${st.fish} fish · 🔥 ${st.streakDays}-day streak · ✓ ${st.tasksDone} tasks · ${st.commits} commits`);
}

// --------------------------------------------------------------- hooks --
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact'];

const STABLE_HOOK = path.join(HOME, 'hooks', 'chonky-hook.js');
function hookCommand(extra) {
  return `node "${STABLE_HOOK.replace(/\\/g, '/')}"${extra ? ' ' + extra : ''}`;
}

// npx installs live in a cache that gets cleaned; copy the hook somewhere permanent.
function copyHookScripts() {
  fs.mkdirSync(path.dirname(STABLE_HOOK), { recursive: true });
  for (const f of ['chonky-hook.js', 'risk.js']) fs.copyFileSync(path.join(ROOT, 'plugin', 'scripts', f), path.join(path.dirname(STABLE_HOOK), f));
}

// Read ~/.claude/settings.json strictly: if it exists but isn't valid JSON, refuse to touch it.
function readClaudeSettings() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return {};
  const text = fs.readFileSync(CLAUDE_SETTINGS, 'utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch (e) {
    console.error(c.r(`${CLAUDE_SETTINGS} isn't plain JSON (${e.message}).`));
    console.error(c.d('   I won\'t rewrite it and risk losing your settings. Fix the file, or use the plugin instead:'));
    console.error('   /plugin marketplace add hamzaahmadaslam/chonkycat  then  /plugin install chonkycat@chonkycat');
    process.exit(1);
  }
}

function writeClaudeSettings(s) {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(CLAUDE_SETTINGS, `${CLAUDE_SETTINGS}.chonkycat-backup-${stamp}`);
  }
  const tmp = CLAUDE_SETTINGS + '.chonkycat-tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, CLAUDE_SETTINGS);
}

function pluginInstalled() {
  return JSON.stringify(readJSON(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), {})).includes('chonkycat');
}

function hooksInstalled() {
  const s = readJSON(CLAUDE_SETTINGS, {});
  return JSON.stringify(s.hooks || {}).includes('chonky-hook.js');
}

function stripChonky(hooks) {
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = (hooks[ev] || []).map((g) => Object.assign({}, g, { hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('chonky-hook.js')) })).filter((g) => g.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  return hooks;
}

function installHooks() {
  if (pluginInstalled()) {
    console.log(c.d('The Chonky Cat plugin is already installed, so hooks are already connected. Adding them again would double every event.'));
    console.log(c.d('Remove the plugin first (/plugin uninstall chonkycat@chonkycat) if you really want settings.json hooks.'));
    return;
  }
  const s = readClaudeSettings();
  copyHookScripts();
  const hooks = stripChonky(s.hooks || {});
  const add = (ev, entry) => { (hooks[ev] = hooks[ev] || []).push(entry); };
  for (const ev of EVENTS) add(ev, { hooks: [{ type: 'command', command: hookCommand(), async: true, timeout: ev === 'SessionStart' ? 20 : 5 }] });
  add('PreToolUse', { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: hookCommand('guard'), timeout: 5 }] });
  add('PermissionRequest', { hooks: [{ type: 'command', command: hookCommand('permission'), timeout: 120 }] });
  s.hooks = hooks;
  writeClaudeSettings(s);
  console.log(`${cat}  Hooks added to ${CLAUDE_SETTINGS} ${c.d('(a timestamped backup sits next to it)')}`);
  console.log(c.d('   Restart Claude Code sessions to pick them up. Use the plugin instead if you prefer: /plugin install chonkycat@chonkycat'));
}

function uninstallHooks() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) { console.log('No ~/.claude/settings.json found.'); return; }
  const s = readClaudeSettings();
  s.hooks = stripChonky(s.hooks || {});
  if (!Object.keys(s.hooks).length) delete s.hooks;
  writeClaudeSettings(s);
  console.log(`${cat}  Chonky Cat hooks removed from ${CLAUDE_SETTINGS}.`);
}

// ---------------------------------------------------------------- demo --
async function demo() {
  const rt = readJSON(FILES.runtime, null);
  if (!(await health(rt))) { console.error(c.r('Start the cat first: npx chonkycat start')); process.exit(1); }
  const sid = 'demo-' + Date.now();
  const tp = path.join(os.tmpdir(), 'chonky-demo.jsonl');
  fs.writeFileSync(tp, JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-demo', content: [{ type: 'text', text: 'Demo!' }], usage: { input_tokens: 2, cache_read_input_tokens: 60000, cache_creation_input_tokens: 2000, output_tokens: 300 } } }) + '\n');
  const base = { session_id: sid, cwd: path.join(os.homedir(), 'chonky-demo'), transcript_path: tp };
  const send = (ev) => post(rt, '/event', Object.assign({}, base, ev));
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const steps = [
    ['New session', { hook_event_name: 'SessionStart', source: 'startup' }, 4],
    ['You send a prompt', { hook_event_name: 'UserPromptSubmit', prompt: 'build a feature' }, 3],
    ['Claude reads files', { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'src/app.ts' } }, 4],
    ['Claude edits code', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/app.ts' } }, 4],
    ['Claude searches the web', { hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: { query: 'cat facts' } }, 4],
    ['Subagent kittens', { hook_event_name: 'SubagentStart', agent_id: 'k1', agent_type: 'Explore' }, 1],
    ['', { hook_event_name: 'SubagentStart', agent_id: 'k2', agent_type: 'Plan' }, 4],
    ['Runs the tests', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }, 2],
    ['Tests pass', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response_exit_code: 0 }, 4],
    ['Kittens come home', { hook_event_name: 'SubagentStop', agent_id: 'k1', agent_type: 'Explore' }, 1],
    ['', { hook_event_name: 'SubagentStop', agent_id: 'k2', agent_type: 'Plan' }, 3],
    ['git commit', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "feat"' } }, 0.5],
    ['', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "feat"' }, tool_response_exit_code: 0 }, 4],
    ['Danger sense', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf node_modules' } }, 4],
    ['Needs your permission', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs permission to use Bash' }, 6],
    ['Tests fail (cup!)', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response_exit_code: 1 }, 6],
    ['Compacting (nom nom)', { hook_event_name: 'PreCompact', compaction_reason: 'manual' }, 4],
    ['Burp', { hook_event_name: 'PostCompact' }, 3],
    ['git push', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git push' }, tool_response_exit_code: 0 }, 4],
    ['Done! (+1 fish)', { hook_event_name: 'Stop', last_assistant_message: 'All done! The feature is implemented and tests pass.' }, 6],
    ['Session ends', { hook_event_name: 'SessionEnd', end_reason: 'other' }, 1],
  ];
  console.log(`${cat}  Demo time! Watch the bottom of your screen.\n`);
  for (const [label, ev, w] of steps) {
    if (label) console.log(`  ${c.o('›')} ${label}`);
    await send(ev);
    await wait(w);
  }
  console.log(`\n${cat}  That’s the show. Take a bow, ${loadSettings().name}.`);
}

async function control(action, extra) {
  const rt = readJSON(FILES.runtime, null);
  if (!(await health(rt))) { console.error(c.r(`${loadSettings().name} is not running. Start her with: npx chonkycat`)); process.exit(1); }
  await post(rt, '/control', Object.assign({ action }, extra || {}));
}

async function doctor() {
  const ok = (b, msg, fix) => console.log(`  ${b ? c.g('✔') : c.r('✘')} ${msg}${!b && fix ? c.d('  → ' + fix) : ''}`);
  console.log(`${cat}  Chonky Cat doctor\n`);
  ok(Number(process.versions.node.split('.')[0]) >= 18, `Node ${process.versions.node}`, 'install Node 18+');
  ok(!!electronPath(), 'Electron available', 'npm install');
  ok(fs.existsSync(HOME), `data folder ${HOME}`);
  const rt = readJSON(FILES.runtime, null);
  const up = await health(rt);
  ok(up, 'app is running', 'npx chonkycat start');
  const plug = fs.existsSync(path.join(os.homedir(), '.claude', 'plugins')) && JSON.stringify(readJSON(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), {})).includes('chonkycat');
  ok(plug || hooksInstalled(), `hooks connected (${plug ? 'plugin' : hooksInstalled() ? 'settings.json' : 'none'})`, '/plugin install chonkycat@chonkycat  or  npx chonkycat install-hooks');
  if (up) {
    const sent = await post(rt, '/event', { hook_event_name: 'Notification', notification_type: 'idle_prompt', session_id: 'doctor', cwd: 'doctor' });
    ok(sent, 'test event delivered (she should meow at you)');
  }
}

function help() {
  console.log(`${cat}  ${c.b('chonkycat')} — a chubby desktop cat for Claude Code

  npx chonkycat [start]        wake her up
  npx chonkycat stop           send her to bed
  npx chonkycat status         is she awake? stats
  npx chonkycat demo           play every reaction once
  npx chonkycat settings       open the settings window
  npx chonkycat show | hide
  npx chonkycat play <reaction>  e.g. play git-push, play tests-pass
  npx chonkycat install-hooks  connect to Claude Code via ~/.claude/settings.json
  npx chonkycat uninstall-hooks
  npx chonkycat doctor         diagnose problems

Data lives in ${HOME}`);
}

const table = { start, stop, status, demo, doctor, settings: () => control('settings'), show: () => control('show'), hide: () => control('hide'), play: () => control('fx', { type: process.argv[3] || 'hello' }), 'install-hooks': installHooks, 'uninstall-hooks': uninstallHooks, help, '--help': help, '-h': help };
(table[cmd] || help)();
