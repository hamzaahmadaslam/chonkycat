#!/usr/bin/env node
'use strict';
/*
 * Chonky Cat hook bridge — Claude Code runs this on hook events.
 *   node chonky-hook.js            forward the event to the Chonky Cat app (run as an async hook)
 *   node chonky-hook.js permission paw-approval: wait for Allow/Deny from the cat (sync hook)
 *   node chonky-hook.js guard      danger sense: force a confirmation prompt for risky commands
 *   node chonky-hook.js launch     start the Chonky Cat app if it isn't running
 *
 * It must never break Claude Code: every failure path exits 0 with no output.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { riskOfCommand } = require('./risk');

const HOME = process.env.CHONKY_HOME || path.join(os.homedir(), '.chonkycat');
const mode = process.argv[2] || 'event';

const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const settings = Object.assign({ autoStart: true, pawApproval: false, pawApprovalTimeout: 25, dangerGuard: true, dnd: false, name: 'Arshia' }, readJSON(path.join(HOME, 'settings.json')) || {});

function readStdin(maxMs) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const timer = setTimeout(() => resolve(data), maxMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; if (data.length > 4 * 1024 * 1024) { clearTimeout(timer); resolve(data); } });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
  });
}

// Keep payloads small: the app only needs metadata, not file contents.
function slim(ev) {
  const out = {};
  for (const [k, v] of Object.entries(ev)) {
    if (k === 'tool_response' || k === 'tool_error') continue;
    if (k === 'tool_input' && v && typeof v === 'object') {
      const ti = {};
      for (const [ik, iv] of Object.entries(v)) {
        if (/^(content|new_string|old_string|edits|new_source)$/.test(ik)) continue;
        ti[ik] = typeof iv === 'string' ? iv.slice(0, 600) : typeof iv === 'object' ? undefined : iv;
      }
      out.tool_input = ti;
    } else if (typeof v === 'string') out[k] = v.slice(0, k === 'last_assistant_message' ? 2000 : 1000);
    else out[k] = v;
  }
  return out;
}

function post(rt, route, body, timeoutMs) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: rt.port, path: route, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-chonky-token': rt.token },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve({ ok: res.statusCode === 200, body: JSON.parse(buf || '{}') }); } catch { resolve({ ok: false }); } });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.on('error', () => resolve({ ok: false, down: true }));
    req.end(data);
  });
}

function launchApp() {
  const launch = readJSON(path.join(HOME, 'launch.json'));
  try {
    let child;
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE; // must be absent, not empty
    try { fs.mkdirSync(HOME, { recursive: true }); } catch {}
    const out = fs.openSync(path.join(HOME, 'chonkycat.log'), 'a');
    if (launch && launch.command && fs.existsSync(launch.command)) {
      child = spawn(launch.command, launch.args || [], { detached: true, stdio: ['ignore', out, out], windowsHide: false, env });
    } else {
      // never installed locally yet — fetch & start the published app
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      child = spawn(npx, ['-y', 'chonkycat', 'start'], { detached: true, stdio: ['ignore', out, out], shell: process.platform === 'win32', windowsHide: true, env });
    }
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (mode === 'launch') { launchApp(); return; }
  const raw = await readStdin(mode === 'event' ? 3000 : 2000);
  let ev;
  try { ev = JSON.parse(raw); } catch { return; }
  if (!ev || typeof ev !== 'object') return;

  if (mode === 'guard') {
    if (!settings.dangerGuard) return;
    const cmd = ev.tool_input && (ev.tool_input.command || ev.tool_input.cmd);
    const risk = riskOfCommand(cmd);
    if (!risk) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `🙀 ${settings.name}'s whiskers are twitching: this looks like a ${risk}. Please double-check before allowing.`,
      },
    }));
    return;
  }

  const rt = readJSON(path.join(HOME, 'runtime.json'));

  if (mode === 'permission') {
    if (!settings.pawApproval || settings.dnd || !rt) return; // fall back to Claude's own prompt
    const timeout = Math.max(5, Math.min(110, Number(settings.pawApprovalTimeout) || 25));
    const res = await post(rt, `/permission?timeout=${timeout}`, slim(ev), (timeout + 5) * 1000);
    const behavior = res.ok && res.body && res.body.behavior;
    if (behavior === 'allow' || behavior === 'deny') {
      const decision = { behavior };
      if (behavior === 'deny') decision.message = `Denied from ${settings.name}'s paw.`;
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
    }
    return;
  }

  // default: forward event
  const body = slim(ev);
  let res = rt ? await post(rt, '/event', body, 1500) : { ok: false, down: true };
  if (!res.ok && ev.hook_event_name === 'SessionStart' && settings.autoStart) {
    if (launchApp()) {
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        const rt2 = readJSON(path.join(HOME, 'runtime.json'));
        if (rt2 && (!rt || rt2.token !== rt.token)) {
          await sleep(1200); // let the overlay finish loading so the greeting is visible
          res = await post(rt2, '/event', body, 1500);
          break;
        }
      }
    }
  }
}

main().catch(() => {}).finally(() => process.exit(0));
