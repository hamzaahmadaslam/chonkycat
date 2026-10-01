#!/usr/bin/env node
// Stress test: N subagents hammering the running app with hook events.
// Usage: node scripts/stress-agents.js [agents=30] [seconds=25]
const http = require('http');
const { FILES, readJSON } = require('../app/shared/config');

const N = Number(process.argv[2]) || 30;
const SECONDS = Number(process.argv[3]) || 25;
const rt = readJSON(FILES.runtime, null);
if (!rt) { console.error('Start the app first: npx chonkycat start'); process.exit(1); }

const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
let sent = 0, failed = 0;
function post(ev) {
  return new Promise((resolve) => {
    const body = JSON.stringify(Object.assign({ session_id: 'stress', cwd: '/work/stress-test' }, ev));
    const req = http.request({ host: '127.0.0.1', port: rt.port, path: '/event', method: 'POST', agent, timeout: 3000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-chonky-token': rt.token } }, (res) => { res.resume(); res.on('end', () => { sent++; resolve(); }); });
    req.on('error', () => { failed++; resolve(); });
    req.on('timeout', () => { req.destroy(); failed++; resolve(); });
    req.end(body);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = ['Explore', 'Plan', 'general-purpose', 'code-reviewer'];
const TOOLS = [['Read', { file_path: 'src/a.ts' }], ['Grep', { pattern: 'todo' }], ['Edit', { file_path: 'src/b.ts' }], ['Bash', { command: 'npm test' }], ['WebSearch', { query: 'docs' }], ['Glob', { pattern: '**/*.ts' }]];

(async () => {
  const t0 = Date.now();
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  await post({ hook_event_name: 'UserPromptSubmit' });
  const ids = [];
  for (let i = 0; i < N; i++) {
    const type = TYPES[i % TYPES.length];
    await post({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: type, description: `Stress task #${i + 1}` } });
    await post({ hook_event_name: 'SubagentStart', agent_id: `s${i}`, agent_type: type });
    ids.push(`s${i}`);
  }
  console.log(`${N} subagents started`);
  const end = Date.now() + SECONDS * 1000;
  const loops = ids.map(async (id, i) => {
    let n = 0;
    while (Date.now() < end) {
      const [tool, input] = TOOLS[(i + n++) % TOOLS.length];
      await post({ hook_event_name: 'PreToolUse', agent_id: id, tool_name: tool, tool_input: input });
      if (n % 9 === 0 && i % 5 === 0) await post({ hook_event_name: 'PermissionRequest', agent_id: id, tool_name: 'Bash', tool_input: { command: 'npm ci' } });
      await sleep(400 + Math.random() * 800);
      await post({ hook_event_name: 'PostToolUse', agent_id: id, tool_name: tool, tool_input: input, tool_response_exit_code: 0 });
    }
    // finish in waves
    await sleep(i * 120);
    await post({ hook_event_name: 'SubagentStop', agent_id: id, last_assistant_message: `Stress task #${i + 1} done.` });
  });
  await Promise.all(loops);
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Stress test finished.' });
  const secs = (Date.now() - t0) / 1000;
  console.log(`sent ${sent} events in ${secs.toFixed(1)}s (${(sent / secs).toFixed(0)}/s), ${failed} failed`);
  await sleep(4000);
  await post({ hook_event_name: 'SessionEnd', reason: 'other' });
  agent.destroy();
})();
