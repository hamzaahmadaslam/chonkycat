'use strict';
// Fish economy + lifetime stats, persisted in ~/.chonkycat/stats.json.
const { FILES, readJSON, writeJSON } = require('../shared/config');

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
  today: { day: '', tasks: 0, fish: 0, minutesWorking: 0 },
  hunger: 0.3, // 0 full … 1 starving
  mood: 0.7,   // 0 grumpy … 1 delighted
  firstSeen: '',
};

const dayKey = (d) => (d || new Date()).toISOString().slice(0, 10);

class Stats {
  constructor() {
    this.data = Object.assign({}, DEFAULT, readJSON(FILES.stats, {}));
    this.data.today = Object.assign({}, DEFAULT.today, this.data.today || {});
    if (!this.data.firstSeen) this.data.firstSeen = new Date().toISOString();
    this.dirty = false;
    this.saver = setInterval(() => this.flush(), 5000);
    if (this.saver.unref) this.saver.unref();
  }

  rollDay() {
    const today = dayKey();
    if (this.data.today.day !== today) this.data.today = { day: today, tasks: 0, fish: 0, minutesWorking: 0 };
  }

  bump(key, n) {
    this.rollDay();
    this.data[key] = (this.data[key] || 0) + (n || 1);
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

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try { writeJSON(FILES.stats, this.data); } catch {}
  }

  get() { this.rollDay(); return this.data; }
}

module.exports = { Stats };
