'use strict';
// Fish economy, lifetime stats and achievements, persisted in ~/.chonkycat/stats.json.
const { FILES, readJSON, writeJSON } = require('../shared/config');

const TODAY = { day: '', tasks: 0, fish: 0, minutesWorking: 0, commits: 0, pushes: 0, testsPassed: 0, testsFailed: 0, kittens: 0, compacts: 0, pets: 0 };

const DEFAULT = {
  fish: 0,
  fishEaten: 0,
  tasksDone: 0,
  tools: 0,
  commits: 0,
  pushes: 0,
  testsPassed: 0,
  testsFailed: 0,
  kittens: 0,
  compacts: 0,
  dangers: 0,
  pets: 0,
  streakDays: 0,
  bestStreak: 0,
  lastDay: '',
  nightOwl: false,
  unlocked: [],
  today: Object.assign({}, TODAY),
  hunger: 0.3, // 0 full … 1 starving
  mood: 0.7,   // 0 grumpy … 1 delighted
  firstSeen: '',
};

// Each achievement unlocks a hat in the wardrobe.
const ACHIEVEMENTS = [
  { id: 'first-fish', label: 'First fish', desc: 'Finish your first Claude task', hat: 'bow', goal: 1, value: (d) => d.tasksDone },
  { id: 'committed', label: 'Committed', desc: 'Make 10 git commits', hat: 'beanie', goal: 10, value: (d) => d.commits },
  { id: 'green', label: 'Test whisperer', desc: 'Get 10 green test runs', hat: 'party', goal: 10, value: (d) => d.testsPassed },
  { id: 'herder', label: 'Kitten herder', desc: 'Send out 10 subagent kittens', hat: 'wizard', goal: 10, value: (d) => d.kittens },
  { id: 'cuddles', label: 'Cuddle monster', desc: 'Pet her 50 times', hat: 'headphones', goal: 50, value: (d) => d.pets },
  { id: 'night-owl', label: 'Night owl', desc: 'Finish a task between midnight and 5 AM', hat: 'nightcap', goal: 1, value: (d) => (d.nightOwl ? 1 : 0) },
  { id: 'royal', label: 'Royal streak', desc: 'Keep a 7-day streak', hat: 'crown', goal: 7, value: (d) => d.bestStreak },
  { id: 'spooky', label: 'Spooky season', desc: 'Code with her in October', hat: 'pumpkin', goal: 1, value: () => (new Date().getMonth() === 9 ? 1 : 0) },
];

// Local calendar day (not UTC), so "today" and streaks roll over at the user's midnight.
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

class Stats {
  constructor() {
    this.data = Object.assign({}, DEFAULT, readJSON(FILES.stats, {}));
    this.data.today = Object.assign({}, TODAY, this.data.today || {});
    if (!Array.isArray(this.data.unlocked)) this.data.unlocked = [];
    if (!this.data.firstSeen) this.data.firstSeen = new Date().toISOString();
    this.dirty = false;
    this.saver = setInterval(() => this.flush(), 5000);
    if (this.saver.unref) this.saver.unref();
  }

  rollDay() {
    const today = dayKey();
    if (this.data.today.day !== today) this.data.today = Object.assign({}, TODAY, { day: today });
  }

  bump(key, n) {
    this.rollDay();
    this.data[key] = (this.data[key] || 0) + (n || 1);
    if (key in TODAY && key !== 'day') this.data.today[key] = (this.data.today[key] || 0) + (n || 1);
    this.dirty = true;
  }

  // A finished task earns a fish and keeps the daily streak alive.
  taskDone() {
    this.rollDay();
    const d = this.data;
    d.tasksDone++;
    d.fish++;
    d.today.tasks++;
    d.today.fish++;
    if (new Date().getHours() < 5) d.nightOwl = true;
    const today = dayKey();
    if (d.lastDay !== today) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      d.streakDays = d.lastDay === dayKey(y) ? d.streakDays + 1 : 1;
      d.bestStreak = Math.max(d.bestStreak, d.streakDays);
      d.lastDay = today;
    }
    d.mood = Math.min(1, d.mood + 0.05);
    this.dirty = true;
    return { fish: d.fish, streak: d.streakDays, today: d.today.tasks };
  }

  feed() {
    const d = this.data;
    if (d.fish <= 0) return false;
    d.fish--;
    d.fishEaten++;
    d.hunger = Math.max(0, d.hunger - 0.35);
    d.mood = Math.min(1, d.mood + 0.12);
    this.dirty = true;
    return true;
  }

  // Called every minute: hunger rises slowly, mood drifts toward neutral.
  minute(working) {
    this.rollDay();
    const d = this.data;
    d.hunger = Math.min(1, d.hunger + 0.004);
    d.mood += (0.6 - d.mood) * 0.01 - (d.hunger > 0.8 ? 0.01 : 0);
    d.mood = Math.max(0, Math.min(1, d.mood));
    if (working) d.today.minutesWorking++;
    this.dirty = true;
  }

  adjustMood(delta) {
    this.data.mood = Math.max(0, Math.min(1, this.data.mood + delta));
    this.dirty = true;
  }

  // Returns achievements unlocked since the last call.
  checkAchievements() {
    const d = this.data;
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (d.unlocked.includes(a.id)) continue;
      if (a.value(d) >= a.goal) {
        d.unlocked.push(a.id);
        fresh.push({ id: a.id, label: a.label, desc: a.desc, hat: a.hat });
      }
    }
    if (fresh.length) this.dirty = true;
    return fresh;
  }

  achievements() {
    const d = this.data;
    return ACHIEVEMENTS.map((a) => ({ id: a.id, label: a.label, desc: a.desc, hat: a.hat, goal: a.goal, progress: Math.min(a.goal, a.value(d) || 0), unlocked: d.unlocked.includes(a.id) }));
  }

  unlockedHats() {
    return this.achievements().filter((a) => a.unlocked).map((a) => a.hat);
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try { writeJSON(FILES.stats, this.data); } catch {}
  }

  get() { this.rollDay(); return this.data; }
}

module.exports = { Stats, ACHIEVEMENTS, dayKey };
