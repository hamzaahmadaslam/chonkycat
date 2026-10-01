'use strict';
// Commands that make Arshia's fur stand up. Shared by the hook (guard mode) and the app.
const RISKY = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\b/i, 'recursive delete'],
  [/\bremove-item\b[^\n]*-recurse[^\n]*-force|\bremove-item\b[^\n]*-force[^\n]*-recurse/i, 'recursive delete'],
  [/\b(rd|rmdir)\s+\/s\b|\bdel\s+\/[sq]\b/i, 'recursive delete'],
  [/\bgit\s+push\b[^\n]*(--force\b|-f\b|--force-with-lease)/i, 'force push'],
  [/\bgit\s+reset\s+--hard\b/i, 'hard reset'],
  [/\bgit\s+clean\s+-[a-z]*f/i, 'git clean'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/i, 'discard changes'],
  [/\bgit\s+branch\s+-D\b/, 'delete branch'],
  [/\bdrop\s+(table|database|schema)\b/i, 'drop table'],
  [/\btruncate\s+table\b/i, 'truncate table'],
  [/\bdelete\s+from\s+\w+\s*(;|$)/i, 'delete all rows'],
  [/\bmkfs\b|\bdd\s+if=|\bformat\s+[a-z]:/i, 'disk wipe'],
  [/\bchmod\s+-R\s+777\b/i, 'chmod 777'],
  [/(curl|wget|iwr|invoke-webrequest)[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|invoke-expression)\b/i, 'pipe to shell'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'fork bomb'],
  [/\b(shutdown|reboot|stop-computer|restart-computer)\b/i, 'shutdown'],
  [/\bkubectl\s+delete\b|\bterraform\s+destroy\b|\bhelm\s+uninstall\b/i, 'infra delete'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i, 'publish package'],
  [/\bsudo\s+rm\b/i, 'sudo delete'],
];

function riskOfCommand(cmd) {
  cmd = String(cmd || '');
  for (const [re, label] of RISKY) if (re.test(cmd)) return label;
  return null;
}

module.exports = { RISKY, riskOfCommand };
