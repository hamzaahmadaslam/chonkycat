/* Arshia sounds — all synthesised with WebAudio, so no audio files ship with the app. */
(function (root) {
  'use strict';
  let ac = null;
  let master = null;
  let volume = 0.45;
  let enabled = true;
  const last = {};

  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = volume;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function noiseBuffer(sec) {
    const a = ctx();
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * sec), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function env(g, t0, a, peak, d, end) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(end || 0.0001, t0 + a + d);
  }

  function tone(type, f0, f1, dur, peak, delay) {
    const a = ctx();
    const t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    env(g, t0, Math.min(0.02, dur / 4), peak, dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(dur, filterType, freq, q, peak, delay, sweepTo) {
    const a = ctx();
    const t0 = a.currentTime + (delay || 0);
    const src = a.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.1);
    const f = a.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q || 1;
    const g = a.createGain();
    env(g, t0, 0.01, peak, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  }

  const SOUNDS = {
    meow() {
      // a sawtooth through a sweeping band-pass: "mi-aaow"
      const a = ctx();
      const t0 = a.currentTime;
      const o = a.createOscillator();
      o.type = 'sawtooth';
      const base = 520 + Math.random() * 160;
      o.frequency.setValueAtTime(base * 0.9, t0);
      o.frequency.linearRampToValueAtTime(base * 1.35, t0 + 0.18);
      o.frequency.linearRampToValueAtTime(base * 0.8, t0 + 0.55);
      const f = a.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 4;
      f.frequency.setValueAtTime(900, t0);
      f.frequency.linearRampToValueAtTime(2200, t0 + 0.2);
      f.frequency.linearRampToValueAtTime(800, t0 + 0.55);
      const g = a.createGain();
      env(g, t0, 0.06, 0.5, 0.52);
      o.connect(f).connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + 0.65);
    },
    mrrp() { tone('triangle', 380, 620, 0.14, 0.35); tone('triangle', 620, 520, 0.1, 0.25, 0.12); },
    purr() {
      const a = ctx();
      const t0 = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuffer(1.6);
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 180;
      const g = a.createGain();
      const lfo = a.createOscillator();
      const lg = a.createGain();
      lfo.frequency.value = 24;
      lg.gain.value = 0.25;
      lfo.connect(lg).connect(g.gain);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.35, t0 + 0.2);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 1.5);
      src.connect(f).connect(g).connect(master);
      lfo.start(t0); src.start(t0);
      lfo.stop(t0 + 1.6); src.stop(t0 + 1.6);
    },
    jingle() {
      [2637, 3136, 3951].forEach((f, i) => tone('sine', f, f * 0.995, 0.5, 0.12, i * 0.05));
      [2637, 3520].forEach((f, i) => tone('sine', f, null, 0.35, 0.08, 0.2 + i * 0.05));
    },
    pop() { tone('sine', 900, 300, 0.09, 0.4); },
    boop() { tone('sine', 660, 990, 0.12, 0.35); },
    hiss() { noise(0.7, 'highpass', 3000, 0.7, 0.35); },
    chime() { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, null, 0.35, 0.22, i * 0.09)); },
    sad() { [523, 466, 392].forEach((f, i) => tone('triangle', f, null, 0.3, 0.2, i * 0.15)); },
    thud() { tone('sine', 140, 60, 0.18, 0.5); },
    crash() { noise(0.4, 'highpass', 2500, 1, 0.35); [3200, 4100, 2800].forEach((f, i) => tone('square', f, f * 0.7, 0.06, 0.05, 0.03 * i)); },
    whoosh() { noise(1.1, 'bandpass', 300, 1.2, 0.35, 0, 3000); },
    stamp() { tone('sine', 110, 50, 0.15, 0.6); noise(0.08, 'lowpass', 800, 1, 0.3); },
    chirp() { tone('sine', 2400, 3600, 0.08, 0.15); tone('sine', 2600, 3900, 0.08, 0.15, 0.12); },
    burp() { tone('sawtooth', 120, 70, 0.45, 0.25); noise(0.4, 'lowpass', 400, 1, 0.12); },
    sneeze() { noise(0.12, 'bandpass', 1200, 2, 0.3); noise(0.25, 'highpass', 2500, 1, 0.35, 0.18); },
    hic() { tone('triangle', 700, 1100, 0.07, 0.3); },
    tada() { [392, 523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, null, 0.4, 0.2, i * 0.07)); },
    yawn() { tone('triangle', 300, 180, 0.9, 0.18); },
    munch() { noise(0.05, 'bandpass', 1500, 3, 0.3); },
  };

  root.ArshiaSound = {
    configure(opts) {
      if (opts.volume != null) { volume = opts.volume; if (master) master.gain.value = volume; }
      if (opts.enabled != null) enabled = opts.enabled;
    },
    play(name, minGap) {
      if (!enabled || !SOUNDS[name]) return;
      const now = performance.now();
      if (last[name] && now - last[name] < (minGap || 250)) return;
      last[name] = now;
      try { SOUNDS[name](); } catch (e) { /* audio may be unavailable */ }
    },
    speak(text, voiceName) {
      if (!enabled || !window.speechSynthesis || !text) return;
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 1.45;
      u.rate = 1.05;
      u.volume = Math.min(1, volume * 1.8);
      const v = speechSynthesis.getVoices().find((x) => x.name === voiceName);
      if (v) u.voice = v;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    },
  };
})(window);
