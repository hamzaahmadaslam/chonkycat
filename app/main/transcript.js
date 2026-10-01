'use strict';
// Reads the tail of a Claude Code transcript (JSONL) to estimate context usage
// and grab the latest assistant text. Never reads the whole file.
const fs = require('fs');

const TAIL_BYTES = 384 * 1024;

function readTail(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    let text = buf.toString('utf8');
    if (len < size) text = text.slice(text.indexOf('\n') + 1); // drop partial first line
    return text;
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function windowFor(model) {
  const m = String(model || '');
  if (/\[1m\]|1m/i.test(m)) return 1000000;
  return 200000;
}

/** @returns {{tokens:number, window:number, model:string, lastText:string}|null} */
function inspect(file) {
  if (!file) return null;
  const text = readTail(file);
  if (!text) return null;
  const lines = text.split('\n');
  let tokens = null;
  let model = '';
  let lastText = '';
  for (let i = lines.length - 1; i >= 0 && (tokens === null || !lastText); i--) {
    const line = lines[i];
    if (!line || line.indexOf('"assistant"') === -1) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const msg = row && row.message;
    if (!msg || msg.role !== 'assistant') continue;
    if (row.isSidechain) continue; // subagent traffic doesn't fill the main context
    if (tokens === null && msg.usage) {
      const u = msg.usage;
      tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      model = msg.model || '';
    }
    if (!lastText && Array.isArray(msg.content)) {
      const t = msg.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim();
      if (t) lastText = t;
    }
  }
  if (tokens === null) return { tokens: 0, window: windowFor(model), model, lastText };
  let window = windowFor(model);
  if (tokens > window * 0.98) window = 1000000; // larger-context models report past 200k
  return { tokens, window, model, lastText };
}

module.exports = { inspect, windowFor };
