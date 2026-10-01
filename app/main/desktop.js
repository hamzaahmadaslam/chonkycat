'use strict';
// Desktop awareness: where are the user's windows? Used to perch the cat on title
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
public static class ChonkyWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
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
    string t = System.Text.RegularExpressions.Regex.Replace(sb.ToString(), "[\\x00-\\x1F]", " ").Replace("\\", "\\\\").Replace("\"", "\\\"");
    return "{\"id\":" + h.ToInt64() + ",\"title\":\"" + t + "\",\"proc\":\"" + name + "\",\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + ",\"pid\":" + pid + "}";
  }
  public static string Foreground() { return Info(GetForegroundWindow()); }
  public static string Focus(long id) {
    IntPtr h = new IntPtr(id);
    if (IsIconic(h)) ShowWindow(h, 9);
    // Windows only lets the foreground app hand over focus; a synthetic Alt press unlocks it.
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    BringWindowToTop(h);
    return SetForegroundWindow(h) ? "true" : "false";
  }
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
[void][ChonkyWin]::SetProcessDPIAware()
[Console]::OutputEncoding = [Text.Encoding]::UTF8
# Each request is "<id> <command> [arg]"; replies are "<id><TAB><json>" so a late reply
# can never be mistaken for the answer to a newer request.
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Split(' ')
  $id = $parts[0]; $cmd = $parts[1]
  try {
    if ($cmd -eq 'fg') { $out = [ChonkyWin]::Foreground() }
    elseif ($cmd -eq 'list') { $out = [ChonkyWin]::List() }
    elseif ($cmd -eq 'focus') { $out = [ChonkyWin]::Focus([long]$parts[2]) }
    else { $out = 'null' }
  } catch { $out = 'null' }
  [Console]::Out.WriteLine($id + [char]9 + $out)
  [Console]::Out.Flush()
}
`;

class Desktop {
  constructor(opts) {
    this.toDip = (opts && opts.toDip) || ((r) => r);
    this.ownPid = process.pid;
    this.pending = new Map(); // request id -> callback
    this.seq = 0;
    this.ok = true;
    this.restarts = 0;
    this.platform = process.platform;
  }

  start() {
    if (this.platform !== 'win32') return;
    try {
      const file = path.join(os.tmpdir(), 'chonky-desktop-' + process.pid + '.ps1');
      fs.writeFileSync(file, PS_SCRIPT);
      this.scriptFile = file;
      this.ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      this.ok = false;
      return;
    }
    this.ok = true;
    this.warm = false;
    this.ps.on('error', () => { this.ok = false; });
    this.ps.stdin.on('error', () => {});
    this.ps.on('exit', () => {
      this.ok = false;
      this.ps = null;
      for (const cb of this.pending.values()) cb(null);
      this.pending.clear();
      // the helper died (sleep/resume, AV, crash): bring it back a few times
      if (!this.stopped && this.restarts < 5) {
        this.restarts++;
        setTimeout(() => { if (!this.stopped) this.start(); }, 2000 * this.restarts).unref();
      }
    });
    this.rl = readline.createInterface({ input: this.ps.stdout });
    this.rl.on('line', (line) => {
      this.warm = true;
      const tab = line.indexOf('\t');
      if (tab < 0) return;
      const cb = this.pending.get(line.slice(0, tab));
      if (!cb) return; // a reply that already timed out
      this.pending.delete(line.slice(0, tab));
      try { cb(JSON.parse(line.slice(tab + 1))); } catch { cb(null); }
    });
  }

  ask(cmd) {
    return new Promise((resolve) => {
      if (this.platform === 'win32') {
        if (!this.ps || !this.ok) return resolve(null);
        const id = String(++this.seq);
        const timer = setTimeout(() => { this.pending.delete(id); resolve(null); }, this.warm ? 3000 : 10000);
        this.pending.set(id, (v) => { clearTimeout(timer); resolve(v); });
        try { this.ps.stdin.write(id + ' ' + cmd + '\n'); } catch { this.pending.delete(id); clearTimeout(timer); resolve(null); }
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

  // Bring a window (from list()/findSessionWindow()) to the front.
  async focus(w) {
    if (!w) return false;
    if (this.platform === 'win32') return (await this.ask('focus ' + Math.trunc(Number(w.id)))) === true;
    try {
      if (this.platform === 'darwin') await run('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${Math.trunc(Number(w.pid))}) to true`]);
      else await run('wmctrl', ['-ia', '0x' + Math.trunc(Number(w.id)).toString(16)]);
      return true;
    } catch { return false; }
  }

  stop() {
    this.stopped = true;
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
