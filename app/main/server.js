'use strict';
// Local-only HTTP endpoint the Claude Code hook script talks to.
// Binds to 127.0.0.1 and requires a random per-install token.
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const PREFERRED_PORT = 47321;
const MAX_BODY = 512 * 1024;

class EventServer extends EventEmitter {
  constructor() {
    super();
    this.token = crypto.randomBytes(18).toString('hex');
    this.port = 0;
    this.pending = new Map(); // permission id -> { res, timer, ev }
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.route(req, res));
      this.server.keepAliveTimeout = 2000;
      const listen = (port) => {
        this.server.once('error', (err) => {
          if (err.code === 'EADDRINUSE' && port !== 0) listen(0);
          else reject(err);
        });
        this.server.listen(port, '127.0.0.1', () => {
          this.port = this.server.address().port;
          resolve(this.port);
        });
      };
      listen(PREFERRED_PORT);
    });
  }

  route(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, app: 'chonkycat' });
    }
    if (req.headers['x-chonky-token'] !== this.token) return send(res, 401, { error: 'bad token' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    readBody(req, (err, body) => {
      if (err) return send(res, 400, { error: 'body' });
      let ev;
      try { ev = JSON.parse(body); } catch { return send(res, 400, { error: 'json' }); }
      if (url.pathname === '/event') {
        send(res, 200, {});
        this.emit('event', ev);
      } else if (url.pathname === '/control') {
        send(res, 200, {});
        this.emit('control', ev);
      } else if (url.pathname === '/permission') {
        this.waitForDecision(ev, res, Number(url.searchParams.get('timeout')) || 25);
      } else {
        send(res, 404, { error: 'route' });
      }
    });
  }

  waitForDecision(ev, res, timeoutSec) {
    const id = crypto.randomBytes(6).toString('hex');
    const timer = setTimeout(() => this.resolve(id, null), Math.max(3, timeoutSec) * 1000);
    this.pending.set(id, { res, timer, ev });
    res.on('close', () => { if (this.pending.has(id)) this.resolve(id, null, true); });
    this.emit('event', ev);
    this.emit('permission', { id, ev });
  }

  // decision: 'allow' | 'deny' | null (fall back to Claude's own prompt)
  resolve(id, decision, closed) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (!closed) send(p.res, 200, decision ? { behavior: decision } : {});
    this.emit('permission-resolved', { id, decision });
  }

  stop() {
    for (const id of [...this.pending.keys()]) this.resolve(id, null);
    if (this.server) this.server.close();
  }
}

function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { req.destroy(); cb(new Error('too big')); return; }
    chunks.push(c);
  });
  req.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
  req.on('error', cb);
}

function send(res, code, obj) {
  if (res.headersSent) return;
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

module.exports = { EventServer, PREFERRED_PORT };
