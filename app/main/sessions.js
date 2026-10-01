'use strict';
// Session state machine. Consumes hook events, keeps per-session state, and emits:
//   'status'  — a snapshot for the renderer (the mood the cat should show)
//   'fx'      — one-shot reactions (git commit stamp, kitten spawn, burp, …)
const { EventEmitter } = require('events');
const { riskOf, activityOf, describe, commandOf, basename, truncate } = require('./classify');
const transcript = require('./transcript');

const PRIORITY = { danger: 7, needs: 6, error: 5, working: 4, thinking: 3, done: 2, idle: 1, sleep: 0 };
const DONE_HOLD_MS = 6000;
const ERROR_HOLD_MS = 4000;
const STALE_MS = 15 * 60 * 1000; // a session with no events for this long is considered gone
const IDLE_SLEEP_MS = 4 * 60 * 1000;
const NEEDS_STALE_MS = 60 * 60 * 1000; // a forgotten permission prompt (terminal closed) still expires
const QUIET_IDLE_MS = 3 * 60 * 1000;
const ENDED_MEMORY_MS = 5 * 60 * 1000;

class Sessions extends EventEmitter {
  constructor() {
    super();
    this.map = new Map();
    this.ended = new Map(); // session id -> time it ended
    this.lastActivity = 0;
    this.timer = setInterval(() => this.tick(), 1000);
    if (this.timer.unref) this.timer.unref();
  }

  get(id) {
    let s = this.map.get(id);
    if (!s) {
      s = {
        id,
        cwd: '',
        project: '',
        state: 'idle',
        activity: null,
        detail: '',
        since: Date.now(),
        lastEvent: Date.now(),
        holdUntil: 0,
        subagents: new Map(),
        context: { tokens: 0, window: 200000 },
        model: '',
        transcript: '',
        needsSince: 0,
        risk: null,
        lastSummary: '',
        tools: 0,
        prompts: 0,
        permissionMode: '',
      };
      this.map.set(id, s);
    }
    return s;
  }

  handle(ev) {
    if (!ev || !ev.hook_event_name) return;
    const id = ev.session_id || 'default';
    const now = Date.now();
    // hooks run async, so events can arrive after SessionEnd; don't resurrect the session
    const ended = this.ended.get(id);
    if (ended && ev.hook_event_name !== 'SessionStart') {
      if (now - ended < ENDED_MEMORY_MS) return;
      this.ended.delete(id);
    }
    if (ev.hook_event_name === 'SessionStart') this.ended.delete(id);
    const s = this.get(id);
    s.lastEvent = now;
    s.lastHook = ev.hook_event_name;
    this.lastActivity = now;
    if (ev.cwd) { s.cwd = ev.cwd; s.project = basename(ev.cwd); }
    if (ev.transcript_path) s.transcript = ev.transcript_path;
    if (ev.permission_mode) s.permissionMode = ev.permission_mode;
    if (ev.model) s.model = ev.model;
    const fromSubagent = !!ev.agent_id && ev.hook_event_name !== 'SubagentStart' && ev.hook_event_name !== 'SubagentStop';

    const set = (state, extra) => {
      s.state = state;
      s.since = now;
      Object.assign(s, extra || {});
    };
    // an alert raised by a subagent clears when that subagent moves on
    const clearSubagentAlert = () => {
      if (fromSubagent && s.alertAgent && ev.agent_id === s.alertAgent) {
        s.alertAgent = null;
        set('working', { risk: null, pending: null, needsSince: 0, detail: 'Working…' });
      }
    };

    switch (ev.hook_event_name) {
      case 'SessionStart':
        if (ev.source === 'compact') break; // compaction restarts the context, not the session
        set('idle', { activity: null, detail: ev.source === 'resume' ? 'Resumed' : 'Ready', needsSince: 0, pending: null, risk: null, inTurn: false });
        if (ev.context_tokens) s.context.tokens = ev.context_tokens;
        this.fx('session-start', s, { source: ev.source });
        break;
      case 'UserPromptSubmit':
        s.prompts++;
        set('thinking', { activity: 'thinking', detail: 'Thinking…', needsSince: 0, risk: null, pending: null, inTurn: true, rewarded: false, alertAgent: null });
        this.fx('prompt', s);
        break;
      case 'PreToolUse': {
        const risk = riskOf(ev.tool_name, ev.tool_input);
        const activity = activityOf(ev.tool_name, ev.tool_input);
        s.tools++;
        if (fromSubagent) {
          const k = s.subagents.get(ev.agent_id);
          if (k) { k.detail = describe(ev.tool_name, ev.tool_input); k.activity = activity; }
          if (!risk) break; // keep the main cat on the main thread's activity
          s.alertAgent = ev.agent_id;
        }
        if (risk) {
          set('danger', { activity, risk, detail: `Careful: ${risk}`, command: truncate(commandOf(ev.tool_input), 120) });
          this.fx('danger', s, { risk, command: commandOf(ev.tool_input) });
        } else if (activity === 'asking') {
          set('needs', { activity, detail: describe(ev.tool_name, ev.tool_input), needsSince: s.needsSince || now });
          this.fx('needs', s, { reason: 'question' });
        } else {
          set('working', { activity, detail: describe(ev.tool_name, ev.tool_input), needsSince: 0, risk: null, pending: null });
          if (activity === 'git-commit' || activity === 'git-push' || activity === 'testing') this.fx(activity + '-start', s);
        }
        break;
      }
      case 'PostToolUse': {
        if (fromSubagent) { clearSubagentAlert(); break; }
        const activity = activityOf(ev.tool_name, ev.tool_input);
        const code = ev.tool_response_exit_code;
        const failed = typeof code === 'number' && code !== 0;
        if (activity === 'git-commit') this.fx(failed ? 'tool-fail' : 'git-commit', s, { command: commandOf(ev.tool_input) });
        else if (activity === 'git-push') this.fx(failed ? 'tool-fail' : 'git-push', s);
        else if (activity === 'testing') this.fx(failed ? 'tests-fail' : 'tests-pass', s);
        else if (activity === 'building') this.fx(failed ? 'tool-fail' : 'build-ok', s);
        else if (activity === 'installing' && !failed) this.fx('installed', s);
        if (s.state === 'danger' || s.state === 'needs') set('working', { risk: null, needsSince: 0, pending: null, detail: describe(ev.tool_name, ev.tool_input) });
        this.refreshContext(s);
        break;
      }
      case 'PostToolUseFailure': {
        if (fromSubagent) { clearSubagentAlert(); break; }
        const activity = activityOf(ev.tool_name, ev.tool_input);
        set('error', { holdUntil: now + ERROR_HOLD_MS, detail: `${ev.tool_name || 'Tool'} failed`, risk: null, needsSince: 0, pending: null });
        this.fx(activity === 'testing' ? 'tests-fail' : 'tool-fail', s, { tool: ev.tool_name });
        break;
      }
      case 'PermissionRequest': {
        if (fromSubagent && !s.subagents.size) break;
        if (fromSubagent) s.alertAgent = ev.agent_id;
        const risk = riskOf(ev.tool_name, ev.tool_input);
        set(risk ? 'danger' : 'needs', {
          detail: `Wants to: ${describe(ev.tool_name, ev.tool_input)}`,
          needsSince: s.needsSince || now,
          risk,
          pending: { tool: ev.tool_name, summary: describe(ev.tool_name, ev.tool_input), command: truncate(commandOf(ev.tool_input), 160) },
        });
        this.fx('permission', s, { tool: ev.tool_name, summary: describe(ev.tool_name, ev.tool_input), risk });
        break;
      }
      case 'PermissionDenied':
        set('working', { needsSince: 0, pending: null, risk: null, detail: 'Permission denied' });
        this.fx('denied', s);
        break;
      case 'Notification': {
        const type = ev.notification_type || '';
        if (type === 'permission_prompt' || type === 'elicitation_dialog' || type === 'agent_needs_input') {
          if (s.state !== 'danger') set('needs', { detail: truncate(ev.message || 'Needs your input', 60), needsSince: s.needsSince || now });
          this.fx('needs', s, { reason: type, message: ev.message });
        } else if (type === 'idle_prompt') {
          set('idle', { detail: 'Waiting for you', needsSince: 0, pending: null, inTurn: false });
          this.fx('idle-nudge', s);
        } else if (type === 'agent_completed') {
          this.fx('subagent-done', s, { message: ev.message });
        }
        break;
      }
      case 'Stop': {
        if (fromSubagent) break;
        const summary = truncate(ev.last_assistant_message || '', 400);
        if (summary) s.lastSummary = summary;
        set('done', { holdUntil: now + DONE_HOLD_MS, detail: 'All done!', risk: null, needsSince: 0, pending: null, inTurn: false, alertAgent: null });
        this.refreshContext(s);
        // a Stop re-sent because another Stop hook blocked it is the same turn: one fish per turn
        if (!s.rewarded && !ev.stop_hook_active) { s.rewarded = true; this.fx('done', s, { summary }); }
        break;
      }
      case 'StopFailure':
        set('error', { holdUntil: now + ERROR_HOLD_MS * 2, detail: friendlyError(ev.error_type), needsSince: 0, pending: null, inTurn: false });
        this.fx('stop-failure', s, { errorType: ev.error_type, message: ev.error_message });
        break;
      case 'SubagentStart': {
        const key = ev.agent_id || `${now}`;
        s.subagents.set(key, { id: key, type: ev.agent_type || 'helper', started: now, detail: 'Starting…' });
        this.fx('kitten-spawn', s, { agentId: key, agentType: ev.agent_type || 'helper' });
        break;
      }
      case 'SubagentStop': {
        const key = ev.agent_id;
        const k = key && s.subagents.get(key);
        if (key) s.subagents.delete(key);
        if (key && key === s.alertAgent) { s.alertAgent = null; if (s.state === 'danger' || s.state === 'needs') set('working', { risk: null, pending: null, needsSince: 0, detail: 'Working…' }); }
        this.fx('kitten-return', s, { agentId: key, agentType: (k && k.type) || ev.agent_type || 'helper', summary: truncate(ev.last_assistant_message || '', 160) });
        break;
      }
      case 'PreCompact':
        set('working', { activity: 'compacting', detail: 'Digesting the conversation…' });
        this.fx('compact-start', s, { reason: ev.trigger || ev.compaction_reason });
        break;
      case 'PostCompact': {
        s.context.tokens = Math.round(s.context.tokens * 0.15);
        const manual = (ev.trigger || ev.compaction_reason) === 'manual';
        set(manual || !s.inTurn ? 'idle' : 'thinking', { activity: manual ? null : 'thinking', detail: manual ? 'Compacted. Feeling light!' : 'Thinking…' });
        this.fx('compact-end', s);
        this.refreshContext(s, 1500);
        break;
      }
      case 'SessionEnd':
        this.fx('session-end', s, { reason: ev.reason || ev.end_reason });
        this.map.delete(id);
        this.ended.set(id, now);
        break;
      case 'TaskCompleted':
        this.fx('task-done', s, { subject: ev.task_subject || ev.subject });
        break;
      case 'CwdChanged':
        this.fx('sniff', s);
        break;
      default:
        break;
    }
    this.emitStatus();
  }

  refreshContext(s, delay) {
    if (!s.transcript) return;
    clearTimeout(s._ctxTimer);
    s._ctxTimer = setTimeout(() => {
      const info = transcript.inspect(s.transcript);
      if (!info) return; // no usage line in the tail: keep the last known value
      // SessionStart's model id may carry a [1m] marker the API model id lacks
      const window = Math.max(info.window, transcript.windowFor(s.model));
      s.context = { tokens: info.tokens, window };
      if (info.model && !/\[1m\]/i.test(s.model)) s.model = info.model;
      this.emitStatus();
    }, delay || 250);
  }

  tick() {
    const now = Date.now();
    let changed = false;
    for (const [id, s] of this.map) {
      if ((s.state === 'done' || s.state === 'error') && s.holdUntil && now > s.holdUntil) {
        // an error mid-turn: Claude is still going, so go back to thinking
        s.state = s.state === 'error' && s.inTurn ? 'thinking' : 'idle';
        s.detail = s.state === 'thinking' ? 'Thinking…' : 'Waiting for you';
        s.holdUntil = 0;
        changed = true;
      }
      // Esc-interrupted turns never send Stop; settle down after a quiet spell
      // (unless a tool is still running, e.g. a long build)
      if ((s.state === 'working' || s.state === 'thinking') && s.lastHook !== 'PreToolUse' && now - s.lastEvent > QUIET_IDLE_MS) {
        s.state = 'idle';
        s.detail = 'Waiting for you';
        s.inTurn = false;
        changed = true;
      }
      const limit = s.state === 'needs' || s.state === 'danger' ? NEEDS_STALE_MS : STALE_MS;
      if (now - s.lastEvent > limit) {
        this.map.delete(id);
        changed = true;
      }
    }
    for (const [id, t] of this.ended) if (now - t > ENDED_MEMORY_MS) this.ended.delete(id);
    if (changed) this.emitStatus();
    else if (now % 5000 < 1000) this.emitStatus(); // keep "needs" timers fresh for escalation
  }

  fx(type, s, data) {
    this.emit('fx', Object.assign({ type, session: s.id, project: s.project }, data || {}));
  }

  // The session the cat should mirror: most urgent first, then most recent.
  primary() {
    let best = null;
    for (const s of this.map.values()) {
      if (!best) { best = s; continue; }
      const a = PRIORITY[s.state] || 0, b = PRIORITY[best.state] || 0;
      if (a > b || (a === b && s.lastEvent > best.lastEvent)) best = s;
    }
    return best;
  }

  snapshot() {
    const now = Date.now();
    const p = this.primary();
    let state = p ? p.state : 'sleep';
    if (state === 'idle' && now - this.lastActivity > IDLE_SLEEP_MS) state = 'sleep';
    if (!this.map.size) state = 'sleep';
    const sessions = [...this.map.values()].sort((a, b) => b.lastEvent - a.lastEvent).map((s) => ({
      id: s.id,
      project: s.project || 'session',
      cwd: s.cwd,
      state: s.state,
      activity: s.activity,
      detail: s.detail,
      needsFor: s.needsSince ? now - s.needsSince : 0,
      subagents: [...s.subagents.values()].map((k) => ({ id: k.id, type: k.type, detail: k.detail })),
      context: s.context,
      model: s.model,
      risk: s.risk,
      pending: s.pending || null,
      summary: s.lastSummary,
      tools: s.tools,
      prompts: s.prompts,
    }));
    return {
      state,
      primary: p ? p.id : null,
      activity: p ? p.activity : null,
      detail: p ? p.detail : 'Napping — no Claude sessions',
      project: p ? p.project : '',
      context: p ? p.context : { tokens: 0, window: 200000 },
      needsFor: p && p.needsSince ? now - p.needsSince : 0,
      subagents: sessions.reduce((n, s) => n + s.subagents.length, 0),
      sessions,
    };
  }

  emitStatus() {
    this.emit('status', this.snapshot());
  }
}

function friendlyError(type) {
  switch (type) {
    case 'rate_limit': return 'Hit the rate limit — resting';
    case 'overloaded': return 'Servers are busy';
    case 'authentication_failed': return 'Needs you to log in';
    case 'billing_error': return 'Billing problem';
    case 'max_output_tokens': return 'Ran out of words';
    default: return 'Something went wrong';
  }
}

module.exports = { Sessions, PRIORITY };
