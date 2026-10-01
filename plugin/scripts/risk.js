'use strict';
// Danger sense: decide whether a shell command deserves a second look.
// Shared by the hook (guard mode) and the app. Must be fast on huge inputs and must not
// trip on harmless text (commit messages, grep patterns, file names), so we:
//   1. only look at the first 16 KB,
//   2. blank out quoted strings before structural checks,
//   3. split into command segments (; && || | newline) and check the command in position,
//   4. use bounded patterns only (no nested unbounded wildcards).

const MAX = 16 * 1024;
const DB_CLIENTS = /^(psql|mysql|mariadb|sqlite3?|sqlcmd|mongo|mongosh|duckdb|clickhouse(-client)?|cockroach|snowsql|bq)$/i;

// Replace the *contents* of quoted strings with spaces (keeps offsets, drops text).
function blankQuotes(s) {
  return s.replace(/"(?:[^"\\\n]|\\.){0,4000}"|'[^'\n]{0,4000}'/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[m.length - 1]);
}

function segments(s) {
  return s.split(/\r?\n|;|&&|\|\||\|/).map((x) => x.trim()).filter(Boolean);
}

// Strip leading sudo / env assignments / "command" wrappers to find the program name.
function head(seg) {
  const words = seg.split(/\s+/);
  let i = 0;
  while (i < words.length && (/^(sudo|doas|command|exec|nohup|time|env)$/i.test(words[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || /^-\w+$/.test(words[i]) && i > 0 && /^(sudo|env)$/i.test(words[i - 1]))) i++;
  return { name: (words[i] || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase(), args: words.slice(i + 1) };
}

const has = (args, re) => args.some((a) => re.test(a));

function checkSegment(seg) {
  const { name, args } = head(seg);
  const dry = has(args, /^--dry-run(=\S*)?$|^-whatif$|^--what-?if$/i);

  // ---- deletes
  if (name === 'rm' || name === 'remove-item' || name === 'ri' || name === 'del' || name === 'erase' || name === 'rmdir' || name === 'rd') {
    const psRecurse = has(args, /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i) && has(args, /^-/) && args.some((a) => /^-recurse$/i.test(a) || /^-r$/i.test(a));
    const unixR = has(args, /^-[a-zA-Z]*[rR][a-zA-Z]*$/) || has(args, /^--recursive$/);
    const unixF = has(args, /^-[a-zA-Z]*f[a-zA-Z]*$/) || has(args, /^--force$/) || has(args, /^-fo(r(c(e)?)?)?$/i);
    if (name === 'rm' && unixR && unixF) return 'recursive delete';
    if ((name === 'remove-item' || name === 'ri' || name === 'del' || name === 'erase' || name === 'rm' || name === 'rmdir' || name === 'rd') && args.some((a) => /^-recurse$/i.test(a))) return 'recursive delete';
    if ((name === 'ri' || name === 'remove-item') && psRecurse && unixF) return 'recursive delete';
    if ((name === 'rd' || name === 'rmdir' || name === 'del' || name === 'erase') && has(args, /^\/s$/i)) return 'recursive delete';
  }
  if (name === 'find' && has(args, /^-delete$/)) return 'bulk delete';

  // ---- git (allow `git -C dir` / `git -c k=v` prefixes)
  if (name === 'git') {
    let i = 0;
    while (i < args.length && /^(-C|-c|--git-dir|--work-tree)$/.test(args[i])) i += 2;
    const sub = (args[i] || '').toLowerCase();
    const rest = args.slice(i + 1);
    if (sub === 'push') {
      if (has(rest, /^(--force|--force-with-lease(=.*)?|--force-if-includes)$/) || has(rest, /^-[a-zA-Z]*f[a-zA-Z]*$/)) return 'force push';
      if (has(rest, /^\+\S+/)) return 'force push';
      if (has(rest, /^(--delete|-d|--mirror|--prune)$/) || has(rest, /^:\S+/)) return 'delete remote branch';
    }
    if (sub === 'reset' && has(rest, /^--hard$/)) return 'hard reset';
    if (sub === 'clean' && has(rest, /^-[a-zA-Z]*f/)) return 'git clean';
    if ((sub === 'checkout' || sub === 'restore') && rest.includes('.') && !dry) return 'discard changes';
    if (sub === 'branch' && (has(rest, /^-D$/) || (has(rest, /^(-d|--delete)$/) && has(rest, /^(-f|--force)$/)))) return 'delete branch';
    if (sub === 'filter-branch' || sub === 'filter-repo') return 'history rewrite';
  }

  // ---- machine
  if (/^(shutdown|reboot|halt|poweroff|stop-computer|restart-computer)$/.test(name)) return 'shutdown';
  if (/^mkfs(\.\w+)?$/.test(name) || name === 'diskpart' || name === 'format-volume' || name === 'clear-disk') return 'disk wipe';
  if (name === 'format' && has(args, /^[a-z]:$/i)) return 'disk wipe';
  if (name === 'dd' && has(args, /^of=\/dev\//)) return 'disk wipe';
  if (name === 'chmod' && has(args, /^-[a-zA-Z]*R/) && has(args, /^0?777$/)) return 'chmod 777';

  // ---- infrastructure & data
  if (dry) return null;
  if (name === 'kubectl' && has(args, /^delete$/)) return 'infra delete';
  if (name === 'terraform' && has(args, /^destroy$/)) return 'infra delete';
  if (name === 'helm' && has(args, /^(uninstall|delete)$/)) return 'infra delete';
  if (name === 'aws' && ((has(args, /^rm$/) && has(args, /^--recursive$/)) || has(args, /^(delete-\S+|rb|terminate-instances)$/))) return 'infra delete';
  if (name === 'gcloud' && has(args, /^delete$/)) return 'infra delete';
  if (name === 'az' && has(args, /^delete$/)) return 'infra delete';
  if (name === 'docker' && has(args, /^prune$/) && has(args, /^(-a|--all|-af|-fa|--volumes)$/)) return 'docker prune';
  if (name === 'dropdb' || (name === 'redis-cli' && has(args, /^flush(all|db)$/i))) return 'wipe database';
  if (/^(npm|pnpm|yarn|bun)$/.test(name) && has(args, /^(publish|unpublish)$/)) return 'publish package';
  if (name === 'cargo' && has(args, /^publish$/)) return 'publish package';
  if (name === 'twine' && has(args, /^upload$/)) return 'publish package';
  return null;
}

const SQL = /\b(drop\s+(table|database|schema)|truncate\s+table)\b|\bdelete\s+from\s+[\w."`\[\]]+\s*(;|$|")/i;
const PIPE_SHELL = [
  /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n|]{0,600}\|\s*(sudo\s+)?(sh|bash|zsh|dash|iex|invoke-expression|pwsh|powershell|python3?|node|perl|ruby)\b/i,
  /\b(iex|invoke-expression)\b\s*\(?\s*(\(\s*)?(irm|iwr|curl|wget|invoke-restmethod|invoke-webrequest|new-object\s+net\.webclient)\b/i,
  /\b(bash|sh|zsh)\s+<\(\s*(curl|wget)\b/i,
  /\b(bash|sh|zsh)\s+-c\s+["']?\$\(\s*(curl|wget)\b/i,
];
const FORK_BOMB = /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;

function riskOfCommand(cmd) {
  if (!cmd) return null;
  const raw = String(cmd).slice(0, MAX);
  if (FORK_BOMB.test(raw)) return 'fork bomb';
  const blank = blankQuotes(raw);
  // download-and-run: check unquoted text (so 'echo "curl x | bash"' is fine); sh -c "$(curl…)" needs the quotes
  for (let i = 0; i < PIPE_SHELL.length; i++) if (PIPE_SHELL[i].test(i === 3 ? raw : blank)) return 'pipe to shell';
  const segs = segments(blank);
  for (const seg of segs) {
    const r = checkSegment(seg);
    if (r) return r;
  }
  // SQL is usually quoted, so check the raw text — but only when a DB client is involved
  if (segs.some((seg) => DB_CLIENTS.test(head(seg).name) || /^(drop|truncate|delete)\b/i.test(seg)) && SQL.test(raw)) {
    return /drop/i.test(raw.match(SQL)[0]) ? 'drop table' : /truncate/i.test(raw.match(SQL)[0]) ? 'truncate table' : 'delete all rows';
  }
  return null;
}

module.exports = { riskOfCommand };
