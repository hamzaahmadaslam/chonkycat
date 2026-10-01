'use strict';
// Cat café: opt-in LAN mode. When a teammate's Claude finishes something, their cat
// strolls across your screen. Messages are UDP broadcasts on the local network,
// signed with an HMAC of a shared room code; nothing leaves the LAN.
const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');
const { EventEmitter } = require('events');

const PORT = 47322;
const SHARE = new Set(['done', 'git-commit', 'git-push', 'tests-pass', 'hello']);

class Cafe extends EventEmitter {
  constructor() {
    super();
    this.id = crypto.randomBytes(6).toString('hex');
    this.seen = new Map();
    this.lastFrom = new Map();
    this.cfg = null;
  }

  configure(cfg, me) {
    const on = !!(cfg && cfg.enabled && cfg.room);
    this.cfg = cfg;
    this.me = me; // { name, skin }
    if (on && !this.sock) this.open();
    if (!on && this.sock) this.close();
  }

  open() {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => this.close());
    sock.on('message', (buf, rinfo) => this.receive(buf, rinfo));
    sock.bind(PORT, () => {
      try { sock.setBroadcast(true); } catch {}
      this.announce('hello');
    });
    this.sock = sock;
  }

  close() {
    if (this.sock) try { this.sock.close(); } catch {}
    this.sock = null;
  }

  key() {
    return crypto.createHash('sha256').update('chonkycat-cafe:' + this.cfg.room).digest();
  }

  sign(body) {
    return crypto.createHmac('sha256', this.key()).update(body).digest('hex');
  }

  announce(event, project) {
    if (!this.sock || !SHARE.has(event)) return;
    const msg = {
      v: 1,
      from: this.id,
      cat: String((this.me && this.me.name) || 'Arshia').slice(0, 24),
      skin: (this.me && this.me.skin) || 'tabby',
      owner: String(this.cfg.displayName || os.userInfo().username || 'someone').slice(0, 24),
      event,
      project: this.cfg.shareProject && project ? String(project).slice(0, 40) : '',
      ts: Date.now(),
      nonce: crypto.randomBytes(6).toString('hex'),
    };
    const body = JSON.stringify(msg);
    const packet = Buffer.from(JSON.stringify({ body, sig: this.sign(body) }));
    for (const addr of broadcastAddresses()) {
      try { this.sock.send(packet, PORT, addr); } catch {}
    }
  }

  receive(buf) {
    if (!this.cfg || buf.length > 2048) return;
    let outer, msg;
    try { outer = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (!outer || typeof outer.body !== 'string' || typeof outer.sig !== 'string') return;
    const expect = this.sign(outer.body);
    if (expect.length !== outer.sig.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(outer.sig))) return;
    try { msg = JSON.parse(outer.body); } catch { return; }
    if (!msg || msg.from === this.id || !SHARE.has(msg.event)) return;
    if (Math.abs(Date.now() - msg.ts) > 60000) return; // stale / replay
    if (this.seen.has(msg.nonce)) return;
    this.seen.set(msg.nonce, Date.now());
    if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value);
    const last = this.lastFrom.get(msg.from) || 0;
    if (msg.event !== 'hello' && Date.now() - last < 20000) return; // one visit per 20s per cat
    this.lastFrom.set(msg.from, Date.now());
    this.emit('visit', {
      cat: String(msg.cat || 'cat').slice(0, 24),
      owner: String(msg.owner || '').slice(0, 24),
      skin: ['tabby', 'grey', 'tuxedo', 'calico'].includes(msg.skin) ? msg.skin : 'grey',
      event: msg.event,
      project: String(msg.project || '').slice(0, 40),
    });
  }
}

function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal || !ni.netmask) continue;
      const ip = ni.address.split('.').map(Number);
      const mask = ni.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b | (~mask[i] & 255)) & 255).join('.'));
    }
  }
  return [...out];
}

module.exports = { Cafe };
