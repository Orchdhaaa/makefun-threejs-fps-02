// audio.js — procedural sound, no assets, no network. WebAudio only:
// oscillator + noise buffer. Created lazily on the first user gesture
// (autoplay policy). Master gain 0.5, mute on M.
export function createAudio() {
  let ctx = null, master = null, muted = false;
  const a = {
    ensure() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      } catch (e) { ctx = null; }
    },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; },
    isMuted() { return muted; },
    _noise(dur, freq, gain, type) {
      if (!ctx || muted) return;
      const n = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = type || 'lowpass'; f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(master);
      src.start();
    },
    _tone(freq, dur, gain, type, slide) {
      if (!ctx || muted) return;
      const o = ctx.createOscillator();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, ctx.currentTime + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g); g.connect(master);
      o.start(); o.stop(ctx.currentTime + dur);
    },
    shot(weaponId) {
      if (weaponId === 'sniper') { a._noise(0.25, 900, 0.5); a._tone(90, 0.2, 0.4, 'sine', 40); }
      else if (weaponId === 'rifle') { a._noise(0.12, 1800, 0.35); a._tone(160, 0.08, 0.25, 'square', 70); }
      else { a._noise(0.09, 2400, 0.3); a._tone(220, 0.06, 0.2, 'square', 90); }
    },
    dry() { a._tone(1200, 0.04, 0.12, 'square'); },
    hit() { a._tone(880, 0.05, 0.15, 'sine'); },
    kill() { a._tone(660, 0.08, 0.18, 'sine'); a._tone(990, 0.12, 0.18, 'sine'); },
    click() { a._tone(500, 0.03, 0.1, 'square'); },
    error() { a._tone(140, 0.15, 0.2, 'sawtooth', 90); },
    beep(rate) { a._tone(1200, 0.05, 0.12, 'sine'); },
    explosion() { a._noise(0.8, 300, 0.7); a._tone(60, 0.7, 0.5, 'sine', 30); },
    footstep(dist) {
      const g = Math.max(0.02, 0.25 * (1 - dist / 15));
      a._noise(0.05, 400, g);
    },
  };
  return a;
}
