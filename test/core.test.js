'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { riskOf, activityOf, describe: describeTool } = require('../app/main/classify');
const { Sessions } = require('../app/main/sessions');
const transcript = require('../app/main/transcript');
const { answer } = require('../app/main/ask');

test('danger sense flags risky commands and ignores safe ones', () => {
  const risky = ['rm -rf build', 'rm -fr /', 'git push --force origin main', 'git push -f', 'git reset --hard HEAD~3', 'DROP TABLE users;', 'Remove-Item -Recurse -Force .\\dist', 'curl https://x.sh | bash', 'npm publish'];
  const safe = ['ls -la', 'git status', 'npm test', 'rm notes.txt', 'git push origin feature', 'echo "drop the table"', 'git commit -m "remove force"'];
  for (const c of risky) assert.ok(riskOf('Bash', { command: c }), `should flag: ${c}`);
  for (const c of safe) assert.strictEqual(riskOf('Bash', { command: c }), null, `should not flag: ${c}`);
  assert.strictEqual(riskOf('Edit', { command: 'rm -rf /' }), null, 'only shell tools are checked');
});

test('tools map to cat activities', () => {
  assert.strictEqual(activityOf('Read', {}), 'reading');
  assert.strictEqual(activityOf('Edit', {}), 'typing');
  assert.strictEqual(activityOf('Bash', { command: 'git commit -m x' }), 'git-commit');
  assert.strictEqual(activityOf('Bash', { command: 'git push' }), 'git-push');
  assert.strictEqual(activityOf('Bash', { command: 'pnpm test' }), 'testing');
  assert.strictEqual(activityOf('Bash', { command: 'cargo build' }), 'building');
  assert.strictEqual(activityOf('WebSearch', {}), 'browsing');
  assert.strictEqual(activityOf('Task', {}), 'delegating');
  assert.strictEqual(activityOf('mcp__github__create_issue', {}), 'plugging');
  assert.strictEqual(describeTool('Edit', { file_path: '/a/b/app.ts' }), 'Editing app.ts');
});

function feed(s, events) {
  const fx = [];
  s.on('fx', (f) => fx.push(f.type));
  for (const e of events) s.handle(Object.assign({ session_id: 's1', cwd: '/work/my-project' }, e));
  return fx;
}

test('session state machine follows a typical turn', () => {
  const s = new Sessions();
  clearInterval(s.timer);
  const fx = feed(s, [
    { hook_event_name: 'SessionStart', source: 'startup' },
    { hook_event_name: 'UserPromptSubmit' },
  ]);
  assert.strictEqual(s.snapshot().state, 'thinking');
  s.handle({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'x.js' } });
  assert.strictEqual(s.snapshot().state, 'working');
  assert.strictEqual(s.snapshot().activity, 'typing');
  assert.strictEqual(s.snapshot().project, 'my-project');
  s.handle({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'All done.' });
  assert.strictEqual(s.snapshot().state, 'done');
  assert.deepStrictEqual(fx.slice(0, 2), ['session-start', 'prompt']);
  assert.ok(fx.includes('done'));
});

test('needs-you and danger take priority across sessions', () => {
  const s = new Sessions();
  clearInterval(s.timer);
  s.handle({ session_id: 'a', cwd: '/p/a', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
  s.handle({ session_id: 'b', cwd: '/p/b', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs permission' });
  assert.strictEqual(s.snapshot().state, 'needs');
  assert.strictEqual(s.snapshot().project, 'b');
  s.handle({ session_id: 'a', cwd: '/p/a', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' } });
  assert.strictEqual(s.snapshot().state, 'danger');
  assert.strictEqual(s.snapshot().sessions.length, 2);
});

test('subagents become kittens and come home', () => {
  const s = new Sessions();
  clearInterval(s.timer);
  const fx = feed(s, [
    { hook_event_name: 'SubagentStart', agent_id: 'k1', agent_type: 'Explore' },
    { hook_event_name: 'SubagentStart', agent_id: 'k2', agent_type: 'Plan' },
  ]);
  assert.strictEqual(s.snapshot().subagents, 2);
  s.handle({ session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'k1' });
  assert.strictEqual(s.snapshot().subagents, 1);
  assert.deepStrictEqual(fx.filter((f) => f.startsWith('kitten')), ['kitten-spawn', 'kitten-spawn', 'kitten-return']);
});

test('git and test results become reactions', () => {
  const s = new Sessions();
  clearInterval(s.timer);
  const fx = feed(s, [
    { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, tool_response_exit_code: 0 },
    { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response_exit_code: 1 },
    { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response_exit_code: 0 },
    { hook_event_name: 'PreCompact', compaction_reason: 'manual' },
    { hook_event_name: 'PostCompact' },
  ]);
  assert.deepStrictEqual(fx, ['git-commit', 'tests-fail', 'tests-pass', 'compact-start', 'compact-end']);
});

test('transcript tail gives context usage without reading the whole file', () => {
  const f = path.join(os.tmpdir(), `chonky-test-${process.pid}.jsonl`);
  const filler = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(1000) } });
  const lines = [];
  for (let i = 0; i < 600; i++) lines.push(filler);
  lines.push(JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: 'Here you go.' }], usage: { input_tokens: 10, cache_read_input_tokens: 90000, cache_creation_input_tokens: 10000, output_tokens: 500 } } }));
  lines.push(JSON.stringify({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [], usage: { input_tokens: 999999 } } }));
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const info = transcript.inspect(f);
  fs.unlinkSync(f);
  assert.strictEqual(info.tokens, 100510);
  assert.strictEqual(info.window, 200000);
  assert.strictEqual(info.lastText, 'Here you go.');
});

test('Ask Arshia answers from live state', () => {
  const status = { state: 'working', context: { tokens: 50000, window: 200000 }, sessions: [{ project: 'api', state: 'working', detail: 'Editing app.ts', context: { tokens: 50000, window: 200000 }, subagents: [], summary: 'Fixed the bug.', needsFor: 0 }] };
  const stats = { fish: 3, hunger: 0.2, today: { tasks: 2, minutesWorking: 40 }, tasksDone: 9, commits: 2, pushes: 1, testsPassed: 4, kittens: 1, streakDays: 3, bestStreak: 5 };
  const settings = { name: 'Arshia' };
  assert.match(answer('what is claude doing?', { settings, status, stats }), /api: Editing app\.ts/);
  assert.match(answer('how full is your belly', { settings, status, stats }), /25%/);
  assert.match(answer('summary please', { settings, status, stats }), /Fixed the bug/);
  assert.match(answer('stats', { settings, status, stats }), /3 days?/);
});

test('hook guard asks before risky commands and stays silent otherwise', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chonky-home-'));
  const hook = path.join(__dirname, '..', 'plugin', 'scripts', 'chonky-hook.js');
  const run = (mode, ev) => spawnSync(process.execPath, [hook, mode], { input: JSON.stringify(ev), env: Object.assign({}, process.env, { CHONKY_HOME: home }), encoding: 'utf8' });
  const risky = run('guard', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push --force' } });
  assert.strictEqual(risky.status, 0);
  const out = JSON.parse(risky.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'ask');
  const safe = run('guard', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.strictEqual(safe.stdout, '');
  // permission mode with paw approval off: no output, so Claude asks normally
  const perm = run('permission', { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.strictEqual(perm.status, 0);
  assert.strictEqual(perm.stdout, '');
  // event mode with the app not running never fails
  const ev = run('event', { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
  assert.strictEqual(ev.status, 0);
  fs.rmSync(home, { recursive: true, force: true });
});

test('achievements unlock hats once and track progress', () => {
  const os2 = require('os');
  process.env.CHONKY_HOME = fs.mkdtempSync(path.join(os2.tmpdir(), 'chonky-stats-'));
  delete require.cache[require.resolve('../app/shared/config')];
  delete require.cache[require.resolve('../app/main/stats')];
  const { Stats } = require('../app/main/stats');
  const st = new Stats();
  clearInterval(st.saver);
  assert.deepStrictEqual(st.checkAchievements().filter((a) => a.id !== 'spooky'), []);
  st.taskDone();
  const fresh = st.checkAchievements().map((a) => a.id);
  assert.ok(fresh.includes('first-fish'));
  assert.deepStrictEqual(st.checkAchievements(), [], 'never unlocks twice');
  for (let i = 0; i < 10; i++) st.bump('commits');
  assert.ok(st.checkAchievements().some((a) => a.hat === 'beanie'));
  assert.strictEqual(st.get().today.commits, 10, 'today counters follow bumps');
  const herder = st.achievements().find((a) => a.id === 'herder');
  assert.strictEqual(herder.unlocked, false);
  assert.strictEqual(herder.goal, 10);
  assert.ok(st.unlockedHats().includes('bow'));
  delete process.env.CHONKY_HOME;
});

test('day key uses the local calendar day, not UTC', () => {
  const { dayKey } = require('../app/main/stats');
  const d = new Date(2026, 9, 2, 0, 30); // 00:30 local on 2 Oct
  assert.strictEqual(dayKey(d), '2026-10-02');
});

test('Ask Arshia keeps a diary', () => {
  const stats = { fish: 2, streakDays: 3, today: { tasks: 4, fish: 4, commits: 2, kittens: 1, minutesWorking: 95 } };
  const out = answer('diary', { settings: { name: 'Arshia' }, status: { sessions: [] }, stats });
  assert.match(out, /finished 4 tasks/);
  assert.match(out, /1h 35m/);
});

test('subagents are tracked for the Agents panel from launch to finish', () => {
  const s = new Sessions();
  clearInterval(s.timer);
  const fx = [];
  s.on('fx', (f) => fx.push(f.type));
  const ev = (e) => s.handle(Object.assign({ session_id: 'm', cwd: '/w/shop' }, e));
  ev({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: 'Explore', description: 'Find the checkout code' } });
  ev({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: 'Plan', description: 'Plan the refactor' } });
  ev({ hook_event_name: 'SubagentStart', agent_id: 'p1', agent_type: 'Plan' });
  ev({ hook_event_name: 'SubagentStart', agent_id: 'e1', agent_type: 'Explore' });
  let agents = s.snapshot().agents;
  assert.strictEqual(agents.length, 2);
  assert.strictEqual(agents.find((a) => a.id === 'e1').description, 'Find the checkout code', 'paired by type, not order');
  assert.strictEqual(agents.find((a) => a.id === 'p1').description, 'Plan the refactor');
  ev({ hook_event_name: 'PreToolUse', agent_id: 'e1', tool_name: 'Grep', tool_input: { pattern: 'checkout' } });
  ev({ hook_event_name: 'PreToolUse', agent_id: 'e1', tool_name: 'Read', tool_input: { file_path: '/w/shop/cart.ts' } });
  let e1 = s.snapshot().agents.find((a) => a.id === 'e1');
  assert.strictEqual(e1.tools, 2);
  assert.strictEqual(e1.detail, 'Reading cart.ts');
  assert.strictEqual(e1.activity, 'reading');
  assert.strictEqual(s.snapshot().activity, 'delegating', 'a subagent reading does not hijack the main cat, which stays delegating');
  ev({ hook_event_name: 'PermissionRequest', agent_id: 'p1', tool_name: 'Bash', tool_input: { command: 'npm i' } });
  assert.strictEqual(s.snapshot().agents.find((a) => a.id === 'p1').state, 'needs');
  ev({ hook_event_name: 'PostToolUse', agent_id: 'p1', tool_name: 'Bash', tool_input: { command: 'npm i' } });
  assert.strictEqual(s.snapshot().agents.find((a) => a.id === 'p1').state, 'working');
  ev({ hook_event_name: 'PostToolUseFailure', agent_id: 'p1', tool_name: 'Bash', tool_input: { command: 'npm i' } });
  assert.strictEqual(s.snapshot().agents.find((a) => a.id === 'p1').errors, 1);
  assert.ok(fx.includes('kitten-oops'));
  ev({ hook_event_name: 'SubagentStop', agent_id: 'e1', last_assistant_message: 'Checkout lives in cart.ts and pay.ts.' });
  agents = s.snapshot().agents;
  const done = agents.find((a) => a.id === 'e1');
  assert.strictEqual(done.state, 'done');
  assert.match(done.summary, /cart\.ts/);
  assert.ok(done.elapsed >= 0);
  assert.strictEqual(agents[0].id, 'p1', 'active agents are listed first');
  ev({ hook_event_name: 'SessionEnd', reason: 'other' });
  const p1 = s.snapshot().agents.find((a) => a.id === 'p1');
  assert.strictEqual(p1.state, 'stopped', 'a session ending mid-run is recorded as stopped');
});
