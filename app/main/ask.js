'use strict';
// "Ask Arshia" — answers questions about your Claude Code sessions, in cat voice.
// Fully local: it reads the live session state; no network, no model calls.

const JOKES = [
  'Why did the cat sit on the keyboard? To keep an eye on the mouse.',
  'My favourite data structure? A purr-ority queue.',
  'I tried to write a recursive nap. Never woke up. Stack overflowed with dreams.',
  'There are 10 kinds of cats: ones who knock things off tables, and ones who will.',
  'I don’t have bugs. I have undocumented hunting features.',
  'Git blame? Always the dog.',
  'I only push to main after a nap. Sometimes during.',
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const pct = (c) => (c && c.window ? Math.round((c.tokens / c.window) * 100) : 0);
const meow = () => pick(['Mrrp!', 'Mew.', 'Prrrt?', 'Meow!', '*tail flick*', '*slow blink*']);

function sessionLine(s) {
  let line = `${s.project}: ${s.detail || s.state}`;
  if (s.subagents && s.subagents.length) line += ` (+${s.subagents.length} kitten${s.subagents.length > 1 ? 's' : ''} helping)`;
  return line;
}

function answer(q, { settings, status, stats }) {
  const text = q.toLowerCase();
  const name = settings.name || 'Arshia';
  const sessions = status.sessions || [];
  const has = (re) => re.test(text);

  if (!text.trim()) return `${meow()} Ask me what Claude is doing, for a summary, how full my belly is, or for a joke.`;

  if (has(/\b(who are you|your name|what are you)\b/)) {
    return `I’m ${name}! A professional loaf who watches Claude Code for you. I get chubbier as the context fills up, and I burp when it compacts.`;
  }
  if (has(/\b(help|what can you|commands?)\b/)) {
    return 'Try: “what’s Claude doing?”, “summary”, “how full are you?”, “stats”, “feed”, or “joke”. Click me to boop, drag me around, double-click to make me jump.';
  }
  if (has(/\b(joke|funny|laugh)\b/)) return pick(JOKES);
  if (has(/\b(feed|food|hungry|eat|fish)\b/) && !has(/\bstats?\b/)) {
    const hunger = stats.hunger > 0.7 ? 'starving' : stats.hunger > 0.4 ? 'a bit peckish' : 'pleasantly full';
    return `I have ${stats.fish} fish saved up and I’m ${hunger}. Every task Claude finishes earns me a fish. Right-click me → Feed to give me one.`;
  }
  if (has(/\b(context|token|belly|fat|full|chonk|weight)\b/)) {
    if (!sessions.length) return 'No sessions right now, so my belly is empty. Slim and sleek!';
    return sessions.map((s) => `${s.project}: ${pct(s.context)}% of the context window (${Math.round(s.context.tokens / 1000)}k tokens)`).join('\n') +
      (pct(status.context) > 75 ? '\nI’m getting very round… a /compact would help me burp.' : '');
  }
  if (has(/\b(summary|summarize|said|last|result|reply|answer|finished)\b/)) {
    const s = sessions.find((x) => x.summary) || null;
    if (!s) return 'Claude hasn’t finished a reply yet. I’ll tell you when it does!';
    return `${s.project} last said: “${s.summary}”`;
  }
  if (has(/\b(stats?|score|streak|today|how many)\b/)) {
    return `Today: ${stats.today.tasks} tasks done, ${stats.today.minutesWorking} min of work. Lifetime: ${stats.tasksDone} tasks, ${stats.commits} commits, ${stats.pushes} pushes, ${stats.testsPassed} green test runs, ${stats.kittens} kittens sent out. Streak: ${stats.streakDays} day${stats.streakDays === 1 ? '' : 's'} (best ${stats.bestStreak}). Fish: ${stats.fish}.`;
  }
  if (has(/\b(wait|need|stuck|blocked|permission|approve)\b/)) {
    const waiting = sessions.filter((s) => s.state === 'needs' || s.state === 'danger');
    if (!waiting.length) return 'Nobody is waiting on you right now. Go stretch!';
    return waiting.map((s) => `${s.project} is waiting ${Math.round(s.needsFor / 1000)}s: ${s.pending ? s.pending.summary : s.detail}`).join('\n');
  }
  if (has(/\b(kitten|subagent|helper|agent)\b/)) {
    const ks = sessions.flatMap((s) => s.subagents.map((k) => `${k.type} for ${s.project}: ${k.detail || 'working'}`));
    return ks.length ? ks.join('\n') : 'No kittens out right now. They’re napping in my fur.';
  }
  // default: status report
  if (!sessions.length) return `${meow()} No Claude Code sessions are running. I’m on nap duty.`;
  return `${meow()} ${sessions.map(sessionLine).join('\n')}`;
}

module.exports = { answer };
