// audio.js — FERROLINE procedural sound engine. Self-contained.
// Web Audio API only: oscillators + filtered noise buffers, all created
// in code. NO external audio files, NO network, NO fetched assets.
//
// The AudioContext is created lazily on the first user gesture only
// (createAudio().ensure(), called from main.js on pointer-lock / click),
// never on page load, so the browser autoplay policy never blocks it.
// If the Web Audio API is unavailable every function below is a silent
// no-op: the game keeps running, no crash, no console errors.
//
// API (all safe to call before ensure() — they just do nothing):
//   ensure()            create/resume the context (call on user gesture)
//   setMuted(m) / isMuted() / toggleMute()   mute control (M key)
//   shot(id)            gunshot: 'pistol' | 'rifle' | 'sniper' | 'grenade'
//                       ('grenade' = the throw whoosh, not a gunshot)
//   dry()               empty-magazine click
//   hit()               hit confirm — one short high tick
//   kill()              kill confirm — distinct two-note chime (E5 -> B5)
//   reload()            reload — two mechanical clicks (mag out, mag in)
//   buy()               purchase confirm — bright two-note coin chirp
//   click()             generic UI click (buy menu navigation)
//   error()             buy denied / error buzz
//   explosion()         grenade / bomb blast — deep boom + noise wash
//   footstep(dist)      one step; volume falls with distance (m), rate-limited
//   beep()              bomb countdown beep (speeds up as timer falls)
//   plantBeep()         bomb plant progress beep (lower, double-tick)
//   defuseBeep()        bomb defuse progress beep (higher, steady tick)
//   roundWin()          round-win stinger — rising major triad
//   roundLose()         round-lose stinger — falling minor phrase
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let volume = 1; // master volume 0..1 (settings panel); scales MASTER_GAIN
  let lastStep = 0; // footstep rate limiter (ms timestamp)
  const MASTER_GAIN = 0.5;

  const a = {
    // Create the context on a user gesture, or resume it if suspended.
    // Safe to call any number of times; no-ops when audio is unsupported.
    ensure() {
      try {
        if (ctx) {
          if (ctx.state === 'suspended') ctx.resume();
          return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return; // Web Audio unavailable: stay silent, never crash.
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : MASTER_GAIN * volume;
        master.connect(ctx.destination);
      } catch (e) { ctx = null; master = null; }
    },

    setMuted(m) {
      muted = !!m;
      if (master) { try { master.gain.value = muted ? 0 : MASTER_GAIN * volume; } catch (e) {} }
    },
    isMuted() { return muted; },
    toggleMute() { a.setMuted(!muted); return muted; },

    // Master volume 0..1 (settings panel). Scales every sound through
    // the master gain; mute still wins over volume (0 when muted).
    setVolume(v) {
      volume = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
      if (master) { try { master.gain.value = muted ? 0 : MASTER_GAIN * volume; } catch (e) {} }
    },
    getVolume() { return volume; },

    // Introspection for debugging/wiring checks: 'none' before the
    // first user gesture, otherwise the AudioContext state.
    state() { return ctx ? ctx.state : 'none'; },

    // --- internals -------------------------------------------------------
    // Short burst of white noise through a filter, decaying envelope.
    // dur seconds, filter cutoff freq Hz, peak gain, filter type.
    _noise(dur, freq, gain, type, delay) {
      if (!ctx || !master || muted) return;
      try {
        const t0 = ctx.currentTime + (delay || 0);
        const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = type || 'lowpass';
        f.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t0);
      } catch (e) {}
    },

    // One oscillator note with a decaying envelope. `slide` glides the
    // pitch to a second frequency; `delay` schedules it in the future.
    _tone(freq, dur, gain, type, slide, delay) {
      if (!ctx || !master || muted) return;
      try {
        const t0 = ctx.currentTime + (delay || 0);
        const o = ctx.createOscillator();
        o.type = type || 'square';
        o.frequency.setValueAtTime(Math.max(1, freq), t0);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(1, slide), t0 + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g); g.connect(master);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      } catch (e) {}
    },

    // --- gunshots --------------------------------------------------------
    // Pistol: short high crack. Rifle: mid crack + body thump.
    // Sniper: long boom, low sub thump, sharper crack. Grenade: the
    // throw itself — a soft airy whoosh, NOT a gunshot (the blast is
    // explosion(), fired when the grenade detonates).
    // `vol` is an optional 0..1 distance attenuation (bot shots far away
    // are quieter); the player's own shots always use full volume.
    shot(weaponId, vol) {
      const v = typeof vol === 'number' ? Math.max(0, Math.min(1, vol)) : 1;
      if (weaponId === 'sniper') {
        a._noise(0.28, 900, 0.55 * v);
        a._noise(0.1, 3500, 0.25 * v, 'highpass');
        a._tone(90, 0.22, 0.45 * v, 'sine', 38);
      } else if (weaponId === 'rifle') {
        a._noise(0.13, 1800, 0.4 * v);
        a._noise(0.06, 4000, 0.18 * v, 'highpass');
        a._tone(160, 0.09, 0.28 * v, 'square', 70);
      } else if (weaponId === 'grenade' || weaponId === 'smoke') {
        // Throw whoosh (frag and smoke alike): a soft airy whoosh, NOT
        // a gunshot (the blast is explosion(), the smoke cloud is smoke()).
        a._noise(0.18, 1200, 0.12 * v, 'bandpass');
      } else { // pistol (default)
        a._noise(0.09, 2400, 0.32 * v);
        a._noise(0.05, 4500, 0.15 * v, 'highpass');
        a._tone(220, 0.06, 0.2 * v, 'square', 90);
      }
    },

    // Hurt: the player takes damage — a short low thud + noise burst.
    hurt() {
      a._tone(110, 0.12, 0.25, 'square', 70);
      a._noise(0.08, 500, 0.2);
    },

    // Empty magazine: dry metallic click.
    dry() { a._tone(1200, 0.04, 0.12, 'square'); a._noise(0.03, 3000, 0.08, 'highpass'); },

    // Hit confirm: one short high tick (sine, 880 Hz, 50 ms).
    hit() { a._tone(880, 0.05, 0.16, 'sine'); },

    // Kill confirm: distinct two-note chime, E5 then B5, sequential
    // (not simultaneous) so it reads as a chime, not a chord.
    kill() {
      a._tone(660, 0.09, 0.18, 'sine');
      a._tone(990, 0.14, 0.18, 'sine', null, 0.09);
    },

    // Reload: two mechanical clicks — mag out (low thunk) then mag in
    // (brighter click) — spaced like a real reload beat.
    reload() {
      a._noise(0.04, 900, 0.2);
      a._tone(180, 0.05, 0.16, 'square', 120);
      a._noise(0.04, 1600, 0.22, 'bandpass', 0.16);
      a._tone(320, 0.05, 0.16, 'square', 200, 0.16);
    },

    // Purchase confirm: bright two-note coin chirp (C6 -> E6).
    buy() {
      a._tone(1046, 0.07, 0.16, 'sine');
      a._tone(1318, 0.11, 0.16, 'sine', null, 0.07);
    },

    // Generic UI click (buy-menu navigation).
    click() { a._tone(500, 0.03, 0.1, 'square'); },

    // Buy denied / error: low sawtooth buzz sliding down.
    error() { a._tone(140, 0.15, 0.2, 'sawtooth', 90); },

    // Grenade / bomb blast: long low noise wash + deep sub sine drop.
    explosion() {
      a._noise(0.9, 300, 0.75);
      a._noise(0.4, 1200, 0.3, 'bandpass');
      a._tone(60, 0.75, 0.55, 'sine', 28);
    },

    // Knife swing: a short airy whoosh (bandpass noise), no impact —
    // the hit itself is the hit confirm (hit()) + damage number.
    knifeSwing() {
      a._noise(0.12, 1800, 0.18, 'bandpass');
    },

    // Smoke grenade detonation: a soft pop (low sine thump) + a long
    // low hiss as the canister vents (lowpass noise, ~0.9 s).
    smoke() {
      a._tone(180, 0.1, 0.25, 'sine', 60);
      a._noise(0.9, 800, 0.12, 'lowpass');
    },

    // One footstep. `dist` = distance in metres from the listener;
    // volume fades out by ~15 m. Rate-limited internally (min 0.28 s
    // between steps) so a per-frame caller cannot machine-gun it.
    footstep(dist) {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - lastStep < 280) return;
      lastStep = now;
      const d = typeof dist === 'number' ? dist : 0;
      const g = Math.max(0.02, 0.22 * (1 - d / 15));
      a._noise(0.05, 400, g);
    },

    // Bomb countdown beep: sharp 1200 Hz sine blip. main.js calls this
    // faster and faster as the bomb timer falls.
    beep() { a._tone(1200, 0.05, 0.12, 'sine'); },

    // Plant progress beep: lower double-tick (900 Hz) while the plant
    // channel runs, so it never confuses with the countdown beep.
    plantBeep() {
      a._tone(900, 0.05, 0.12, 'sine');
      a._tone(900, 0.05, 0.1, 'sine', null, 0.08);
    },

    // Defuse progress beep: steady high tick (1500 Hz) while defusing.
    defuseBeep() { a._tone(1500, 0.04, 0.11, 'sine'); },

    // Round-win stinger: rising major triad (C5 -> E5 -> G5), punchy.
    roundWin() {
      a._tone(523, 0.12, 0.2, 'triangle');
      a._tone(659, 0.12, 0.2, 'triangle', null, 0.11);
      a._tone(784, 0.28, 0.22, 'triangle', null, 0.22);
    },

    // Round-lose stinger: falling minor phrase (A4 -> F4 -> D4).
    roundLose() {
      a._tone(440, 0.14, 0.2, 'triangle');
      a._tone(349, 0.14, 0.2, 'triangle', null, 0.13);
      a._tone(294, 0.32, 0.2, 'triangle', null, 0.26);
    },
  };
  return a;
}
