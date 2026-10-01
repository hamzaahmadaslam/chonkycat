'use strict';
// Session state machine. Consumes hook events, keeps per-session state, and emits:
//   'status'  — a snapshot for the renderer (the mood the cat should show)
//   'fx'      — one-shot reactions (git commit stamp, kitten spawn, burp, …)
const { EventEmitter } = require('events');
const path = require('path');
const { riskOf, activityOf, describe, commandOf, basename, truncate, TEST_CMD } = require('./classify');
const transcript = require('./transcript');

const PRIORITY = { danger: 7, needs: 6, error: 5, working: 4, thinking: 3, done: 2, idle: 1, sleep: 0 };
const DONE_HOLD_MS = 6000;
const ERROR_HOLD_MS = 4000;
const STALE_MS = 15 * 60 * 1000; // a session with no events for this long is considered gone
const IDLE_SLEEP_MS = 4 * 60 * 1000;

class Sessions extends EventEmitter {
  constructor() {
    super();
    this.map = new Map();
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
    const s = this.get(id);
    const now = Date.now();
    s.lastEvent = now;
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

    switch (ev.hook_event_name) {
      case 'SessionStart':
        set('idle', { activity: null, detail: ev.source === 'resume' ? 'Resumed' : 'Ready', needsSince: 0 });
        if (ev.context_tokens) s.context.tokens = ev.context_tokens;
        this.fx('session-start', s, { source: ev.source });
        break;
      case 'UserPromptSubmit':
        s.prompts++;
        set('thinking', { activity: 'thinking', detail: 'Thinking…', needsSince: 0, risk: null });
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
        }
        if (risk) {
          set('danger', { activity, risk, detail: `Careful: ${risk}`, command: truncate(commandOf(ev.tool_input), 120) });
          this.fx('danger', s, { risk, command: commandOf(ev.tool_input) });
        } else if (activity === 'asking') {
          set('needs', { activity, detail: describe(ev.tool_name, ev.tool_input), needsSince: s.needsSince || now });
          this.fx('needs', s, { reason: 'question' });
        } else {
          set('working', { activity, detail: describe(ev.tool_name, ev.tool_input), needsSince: 0, risk: null });
          if (activity === 'git-commit' || activity === 'git-push' || activity === 'testing') this.fx(activity + '-start', s);
        }
        break;
      }
      case 'PostToolUse': {
        if (fromSubagent) break;
        const activity = activityOf(ev.tool_name, ev.tool_input);
        const code = ev.tool_response_exit_code;
        const failed = typeof code === 'number' && code !== 0;
        if (activity === 'git-commit') this.fx(failed ? 'tool-fail' : 'git-commit', s, { command: commandOf(ev.tool_input) });
        else if (activity === 'git-push') this.fx(failed ? 'tool-fail' : 'git-push', s);
        else if (activity === 'testing') this.fx(failed ? 'tests-fail' : 'tests-pass', s);
        else if (activity === 'building') this.fx(failed ? 'tool-fail' : 'build-ok', s);
        else if (activity === 'installing' && !failed) this.fx('installed', s);
        if (s.state === 'danger' || s.state === 'needs') set('working', { risk: null, needsSince: 0 });
        this.refreshContext(s);
        break;
      }
      case 'PostToolUseFailure': {
        if (fromSubagent) break;
        const activity = activityOf(ev.tool_name, ev.tool_input);
        set('error', { holdUntil: now + ERROR_HOLD_MS, detail: `${ev.tool_name || 'Tool'} failed`, risk: null, needsSince: 0 });
        this.fx(activity === 'testing' ? 'tests-fail' : 'tool-fail', s, { tool: ev.tool_name });
        break;
      }
      case 'PermissionRequest': {
        if (fromSubagent && !s.subagents.size) break;
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
        set('working', { needsSince: 0, pending: null });
        this.fx('denied', s);
        break;
      case 'Notification': {
        const type = ev.notification_type || '';
        if (type === 'permission_prompt' || type === 'elicitation_dialog' || type === 'agent_needs_input') {
          if (s.state !== 'danger') set('needs', { detail: truncate(ev.message || 'Needs your input', 60), needsSince: s.needsSince || now });
          this.fx('needs', s, { reason: type, message: ev.message });
        } else if (type === 'idle_prompt') {
          set('idle', { detail: 'Waiting for you', needsSince: 0 });
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
        set('done', { holdUntil: now + DONE_HOLD_MS, detail: 'All done!', risk: null, needsSince: 0, pending: null });
        this.refreshContext(s);
        this.fx('done', s, { summary });
        break;
      }
      case 'StopFailure':
        set('error', { holdUntil: now + ERROR_HOLD_MS * 2, detail: friendlyError(ev.error_type), needsSince: 0 });
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
        this.fx('kitten-return', s, { agentId: key, agentType: (k && k.type) || ev.agent_type || 'helper', summary: truncate(ev.last_assistant_message || '', 160) });
        break;
      }
      case 'PreCompact':
        set('working', { activity: 'compacting', detail: 'Digesting the conversation…' });
        this.fx('compact-start', s, { reason: ev.compaction_reason });
        break;
      case 'PostCompact':
        s.context.tokens = Math.round(s.context.tokens * 0.15);
        this.fx('compact-end', s);
        this.refreshContext(s, 1500);
        break;
      case 'SessionEnd':
        this.fx('session-end', s, { reason: ev.end_reason });
        this.map.delete(id);
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
      if (!info) return;
      s.context = { tokens: info.tokens, window: info.window };
      if (info.model) s.model = info.model;
      this.emitStatus();
    }, delay || 250);
  }

  tick() {
    const now = Date.now();
    let changed = false;
    for (const [id, s] of this.map) {
      if ((s.state === 'done' || s.state === 'error') && s.holdUntil && now > s.holdUntil) {
        s.state = 'idle';
        s.detail = 'Waiting for you';
        s.holdUntil = 0;
        changed = true;
      }
      if (now - s.lastEvent > STALE_MS && s.state !== 'needs') {
        this.map.delete(id);
        changed = true;
      }
    }
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
