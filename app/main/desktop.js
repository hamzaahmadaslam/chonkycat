'use strict';
// Desktop awareness: where are the user's windows? Used to perch Arshia on title
// bars and to run over to the terminal/editor of the session that needs you.
// Windows: a persistent PowerShell helper calling Win32 (no native modules).
// macOS:   JXA via osascript (needs Accessibility permission; fails quietly).
// Linux:   xdotool / wmctrl when installed.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const TERMINALISH = /^(windowsterminal|wt|openconsole|conhost|powershell|pwsh|cmd|code|code - insiders|cursor|windsurf|claude|iterm2|terminal|alacritty|wezterm|wezterm-gui|kitty|ghostty|warp|hyper|tabby|idea64|webstorm64|pycharm64|zed|gnome-terminal-server|konsole|xterm|tilix|terminator)$/i;

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ArshiaWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string Info(IntPtr h) {
    RECT r; DwmGetWindowAttribute(h, 9, out r, 16);
    var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
    int pid; GetWindowThreadProcessId(h, out pid);
    string name = "";
    try { name = System.Diagnostics.Process.GetProcessById(pid).ProcessName; } catch {}
    string t = sb.ToString().Replace("\\", "\\\\").Replace("\"", "\\\"");
    return "{\"id\":" + h.ToInt64() + ",\"title\":\"" + t + "\",\"proc\":\"" + name + "\",\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + ",\"pid\":" + pid + "}";
  }
  public static string Foreground() { return Info(GetForegroundWindow()); }
  public static string List() {
    var items = new List<string>();
    int self = System.Diagnostics.Process.GetCurrentProcess().Id;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      if (GetWindow(h, 4) != IntPtr.Zero) return true; // owned popups
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // tool windows
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4); if (cloaked != 0) return true;
      var sb = new StringBuilder(4); if (GetWindowText(h, sb, 4) == 0) return true;
      RECT r; DwmGetWindowAttribute(h, 9, out r, 16);
      if (r.R - r.L < 120 || r.B - r.T < 80) return true;
      items.Add(Info(h));
      return items.Count < 40;
    }, IntPtr.Zero);
    return "[" + string.Join(",", items) + "]";
  }
}
"@
[void][ArshiaWin]::SetProcessDPIAware()
[Console]::OutputEncoding = [Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq 'fg') { [Console]::Out.WriteLine([ArshiaWin]::Foreground()) }
  elseif ($line -eq 'list') { [Console]::Out.WriteLine([ArshiaWin]::List()) }
  else { [Console]::Out.WriteLine('null') }
  [Console]::Out.Flush()
}
`;

class Desktop {
  constructor(opts) {
    this.toDip = (opts && opts.toDip) || ((r) => r);
    this.ownPid = process.pid;
    this.queue = [];
    this.ok = true;
    this.platform = process.platform;
  }

  start() {
    if (this.platform !== 'win32') return;
    try {
      const file = path.join(os.tmpdir(), 'arshia-desktop-' + process.pid + '.ps1');
      fs.writeFileSync(file, PS_SCRIPT);
      this.scriptFile = file;
      this.ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      this.ok = false;
      return;
    }
    this.ps.on('exit', () => { this.ok = false; this.ps = null; for (const q of this.queue.splice(0)) q(null); });
    this.rl = readline.createInterface({ input: this.ps.stdout });
    this.rl.on('line', (line) => {
      this.warm = true;
      const cb = this.queue.shift();
      if (!cb) return;
      try { cb(JSON.parse(line)); } catch { cb(null); }
    });
  }

  ask(cmd) {
    return new Promise((resolve) => {
      if (this.platform === 'win32') {
        if (!this.ps || !this.ok) return resolve(null);
        const timer = setTimeout(() => { const i = this.queue.indexOf(done); if (i >= 0) this.queue.splice(i, 1); resolve(null); }, this.warm ? 2500 : 8000);
        const done = (v) => { clearTimeout(timer); resolve(v); };
        this.queue.push(done);
        this.ps.stdin.write(cmd + '\n');
      } else if (this.platform === 'darwin') {
        macQuery(cmd).then(resolve, () => resolve(null));
      } else {
        linuxQuery(cmd).then(resolve, () => resolve(null));
      }
    });
  }

  normalize(w) {
    if (!w || !w.w) return null;
    const r = this.toDip({ x: w.x, y: w.y, width: w.w, height: w.h });
    return { id: w.id, title: w.title || '', proc: w.proc || '', pid: w.pid, x: r.x, y: r.y, w: r.width, h: r.height };
  }

  async foreground() {
    const w = this.normalize(await this.ask('fg'));
    if (!w || w.pid === this.ownPid || /^electron$/i.test(w.proc)) return null;
    return w;
  }

  async list() {
    const arr = (await this.ask('list')) || [];
    return arr.map((w) => this.normalize(w)).filter((w) => w && w.pid !== this.ownPid && !/^electron$/i.test(w.proc));
  }

  // Best guess at the window hosting a given Claude Code session.
  async findSessionWindow(project) {
    const wins = await this.list();
    let best = null;
    let bestScore = 0;
    wins.forEach((w, z) => {
      let score = 0;
      if (TERMINALISH.test(w.proc)) score += 3;
      if (project && w.title.toLowerCase().includes(String(project).toLowerCase())) score += 5;
      if (/claude/i.test(w.title)) score += 2;
      score += Math.max(0, 2 - z * 0.2); // prefer windows near the top of the z-order
      if (score > bestScore) { best = w; bestScore = score; }
    });
    return bestScore >= 3 ? best : null;
  }

  stop() {
    if (this.ps) try { this.ps.kill(); } catch {}
    if (this.scriptFile) try { fs.unlinkSync(this.scriptFile); } catch {}
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 2500, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out))));
  });
}

async function macQuery(cmd) {
  const js = `
    const se = Application('System Events');
    const procs = se.applicationProcesses.whose({ visible: true })();
    const out = [];
    for (const p of procs) {
      let front = false; try { front = p.frontmost(); } catch (e) {}
      if (${cmd === 'fg'} && !front) continue;
      let wins = []; try { wins = p.windows(); } catch (e) {}
      for (const w of wins.slice(0, 3)) {
        try {
          const [x, y] = w.position(); const [ww, hh] = w.size();
          out.push({ id: out.length + 1, title: w.name() || '', proc: p.name(), pid: p.unixId(), x, y, w: ww, h: hh, front });
        } catch (e) {}
      }
    }
    JSON.stringify(out);`;
  const res = JSON.parse(await run('osascript', ['-l', 'JavaScript', '-e', js]));
  if (cmd === 'fg') return res[0] || null;
  return res.sort((a, b) => b.front - a.front);
}

async function linuxQuery(cmd) {
  if (cmd === 'fg') {
    const out = await run('xdotool', ['getactivewindow', 'getwindowgeometry', '--shell', 'getwindowname', 'getwindowpid']);
    const g = Object.fromEntries(out.split('\n').filter((l) => l.includes('=')).map((l) => l.split('=')));
    const lines = out.trim().split('\n');
    return { id: Number(g.WINDOW), title: lines[lines.length - 2] || '', proc: '', pid: Number(lines[lines.length - 1]), x: +g.X, y: +g.Y, w: +g.WIDTH, h: +g.HEIGHT };
  }
  const out = await run('wmctrl', ['-lGp']);
  return out.trim().split('\n').map((l) => {
    const p = l.split(/\s+/);
    return { id: parseInt(p[0], 16), pid: +p[2], x: +p[3], y: +p[4], w: +p[5], h: +p[6], proc: '', title: p.slice(8).join(' ') };
  }).reverse();
}

module.exports = { Desktop, TERMINALISH };
