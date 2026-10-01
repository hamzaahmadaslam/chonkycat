'use strict';
// Turns raw Claude Code hook payloads into things a cat can act out.

const { riskOfCommand } = require('../../plugin/scripts/risk');

const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|jest|vitest|mocha|phpunit|rspec)\b|\bgo\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b|\bmvn\s+test\b|\bgradle\w*\s+test\b|\bnode\s+--test\b|\bplaywright\s+test\b/i;
const BUILD_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\bcargo\s+build\b|\bgo\s+build\b|\bmake\b|\btsc\b|\bdotnet\s+build\b|\bgradle\w*\s+build\b/i;
const INSTALL_CMD = /\b(npm|pnpm|yarn|bun)\s+(install|i|add)\b|\bpip3?\s+install\b|\bcargo\s+add\b|\bgo\s+get\b|\bbrew\s+install\b/i;

function commandOf(input) {
  if (!input) return '';
  return String(input.command || input.cmd || input.script || '');
}

function riskOf(toolName, input) {
  if (toolName !== 'Bash' && toolName !== 'PowerShell') return null;
  return riskOfCommand(commandOf(input));
}

// What the cat should be "doing" for a tool.
function activityOf(toolName, input) {
  const t = toolName || '';
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(t)) return 'reading';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return 'typing';
  if (t === 'Bash' || t === 'PowerShell') {
    const cmd = commandOf(input);
    if (/\bgit\s+commit\b/.test(cmd)) return 'git-commit';
    if (/\bgit\s+push\b/.test(cmd)) return 'git-push';
    if (TEST_CMD.test(cmd)) return 'testing';
    if (BUILD_CMD.test(cmd)) return 'building';
    if (INSTALL_CMD.test(cmd)) return 'installing';
    return 'terminal';
  }
  if (/^(WebFetch|WebSearch)$/.test(t)) return 'browsing';
  if (/^(Task|Agent)$/.test(t)) return 'delegating';
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|EnterPlanMode)$/.test(t)) return 'planning';
  if (/^(AskUserQuestion|ExitPlanMode)$/.test(t)) return 'asking';
  if (t === 'Skill') return 'skill';
  if (t.startsWith('mcp__')) return 'plugging';
  return 'working';
}

function basename(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(p);
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Short human description of what a tool call is doing.
function describe(toolName, input) {
  input = input || {};
  const file = basename(input.file_path || input.notebook_path || input.path);
  switch (toolName) {
    case 'Read': return `Reading ${file || 'a file'}`;
    case 'Edit': case 'MultiEdit': return `Editing ${file || 'a file'}`;
    case 'Write': return `Writing ${file || 'a file'}`;
    case 'NotebookEdit': return `Editing ${file || 'a notebook'}`;
    case 'Grep': return `Searching for "${truncate(input.pattern, 28)}"`;
    case 'Glob': return `Looking for ${truncate(input.pattern, 30)}`;
    case 'Bash': case 'PowerShell': return `Running ${truncate(commandOf(input), 44)}`;
    case 'WebFetch': return `Reading ${truncate(String(input.url || '').replace(/^https?:\/\//, ''), 36)}`;
    case 'WebSearch': return `Searching the web: ${truncate(input.query, 30)}`;
    case 'Task': case 'Agent': return `Sending a helper: ${truncate(input.description || input.subagent_type, 32)}`;
    case 'TodoWrite': return 'Planning the to-do list';
    case 'AskUserQuestion': return 'Has a question for you';
    case 'ExitPlanMode': return 'Plan ready for review';
    case 'Skill': return `Using skill ${truncate(input.skill || input.name, 30)}`;
    default:
      if (toolName && toolName.startsWith('mcp__')) {
        const [, server, tool] = toolName.split('__');
        return `Using ${server}${tool ? ' · ' + tool : ''}`;
      }
      return toolName ? `Using ${toolName}` : 'Working';
  }
}

module.exports = { riskOf, activityOf, describe, commandOf, basename, truncate, TEST_CMD };
