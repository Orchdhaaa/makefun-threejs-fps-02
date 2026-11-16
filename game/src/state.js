// state.js — the single store for FERROLINE.
// Every number the game rules read lives in the one object created here.
// Nothing else in the game creates score, money, health, phase, timer or
// bomb state. The RNG is seeded once per match so a staged capture
// (?shot=...&seed=1) replays exactly; live matches seed from Date.now()
// once, at match start, and the stream is never re-seeded per round.
export const PHASES = { BUY: 'buy', LIVE: 'live', END: 'end', MATCH: 'match' };

// Mode ids. The full MODES registry (names, descriptions, tuning) lives in
// rounds.js; this list is duplicated here only so createGameState can
// validate a mode without importing rounds.js (a circular import).
export const MODE_IDS = ['bomb', 'tdm', 'attack', 'domination', 'frontline'];

// Fallback control points (DEPOT 9): site A (-24,-14), site B (24,-14) and
// mid (0,0). Used when the map has not supplied MAP.capturePoints — see
// rounds.js getCapturePoints(). Radius 4.5 covers the 8x8 site zones.
export const FALLBACK_POINTS = [
  { id: 'A', x: -24, z: -14, r: 4.5 },
  { id: 'B', x: 24, z: -14, r: 4.5 },
  { id: 'C', x: 0, z: 0, r: 4.5 },
];

// One Domination control point: owner is null | 'B' | 'W'; prog is signed
// capture progress, -1 (fully Warden) .. +1 (fully Breaker), 0 neutral.
export function makeDomPoint(p) {
  return { id: p.id, x: p.x, z: p.z, r: p.r, owner: null, prog: 0 };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One fighter, player or bot. pos is (x, z) on the floor; y is derived
// from crouch/eye height by the code that reads it, never stored twice.
export function makeFighter(id, name, team, x, z, yaw) {
  return {
    id, name, team, x, z, yaw, pitch: 0, y: 0,
    hp: 100, alive: true, crouched: false,
    // respawnT counts down in Team Deathmatch only (rounds.js); every other
    // mode revives fighters at the next round instead. deadT is the bot
    // fall-over animation clock (bots.js).
    respawnT: 0, deadT: 0,
    weapon: 'pistol', // 'pistol' | 'rifle' | 'sniper'
    mag: 12, reserve: 36,
    // Match loadout (player only; bots leave these at their defaults).
    // loadoutPrimary is the lobby pick — null (fallback), 'none'
    // (pistol only) or a weapon id — and is fixed for the whole match
    // (only an in-match gun purchase changes it). primary is the LIVE
    // slot-2 choice and is reset at every round start.
    primary: null, loadoutPrimary: null, loadoutFrag: false, loadoutSmoke: false,
    // Bot-only fields; the player leaves them at their defaults.
    state: 'ROUTE', route: [], wp: 0, holdX: x, holdZ: z, holdYaw: yaw,
    reaction: 0, burstLeft: 0, burstPause: 0, cooldown: 0,
    seeTimer: 0, target: null, lastSeenX: 0, lastSeenZ: 0,
    scanDir: 1, scanT: 0, stuckT: 0, stuckX: x, stuckZ: z,
    sideStep: 1, sideSteps: 0, plantT: 0, defuseT: 0,
    visionT: 0, hearX: 0, hearZ: 0, hearT: 0,
    role: '', lane: '', site: '',
  };
}

// mode: 'bomb' (default) | 'tdm' | 'attack' | 'domination' | 'frontline'.
// An unknown mode id falls back to 'bomb'. capturePoints is optional: the
// caller may pass MAP.capturePoints here (or assign state.capturePoints
// later); when absent the FALLBACK_POINTS above are used.
export function createGameState(seed, mode = 'bomb', capturePoints) {
  const rng = mulberry32(seed);
  const m = MODE_IDS.includes(mode) ? mode : 'bomb';
  const points = Array.isArray(capturePoints) && capturePoints.length >= 3
    ? capturePoints : FALLBACK_POINTS;
  const state = {
    seed, rng, time: 0,
    mode: m,
    phase: PHASES.BUY, round: 1, matchOver: false,
    score: { breakers: 0, wardens: 0 },
    money: 950, lossStreak: 0,
    timer: 10, // buy phase countdown; live phase counts down from 100
    bombTimer: 35,
    bomb: { mode: 'carried', x: 0, z: 0, plantT: 0, defuseT: 0, site: '', planter: null, defuser: null },
    // --- mode state (rules in rounds.js; every field exists in every mode
    // so the HUD/menu can read it without mode checks) ---
    teamKills: { breakers: 0, wardens: 0 }, // TDM kills per team
    domScore: { breakers: 0, wardens: 0 },  // Domination points (cumulative over rounds)
    domPoints: points.map(makeDomPoint),    // Domination control points
    attackSite: 'A', attackProg: 0,         // Attack: site under attack, 0..1 capture bar
    front: 1, frontProg: 0,                 // Frontline: index into the B->W ordered
    //   capture points (1 = middle zone) and signed capture progress -1..1
    matchWinner: null, // 'B' | 'W' | null (draw / undecided)
    matchReason: '',
    matchCreditsPaid: false, // per-match earn paid once (rounds.js payMatchCredits)
    matchCreditsEarned: 0, // per-match counter for the end-of-match overlay
    capturePoints: Array.isArray(capturePoints) ? capturePoints : null,
    _aliveIds: null, // internal: alive-set snapshot for TDM kill credit
    player: makeFighter('you', 'You', 'B', 0, 19, 0),
    bots: [],
    killfeed: [], // {text, head, age}
    grenades: [],
    bullets: [], // live projectiles; cleared on round/match end (§6.2 of the ballistics design)
    banner: '', bannerT: 0,
    death: null, // {by, weapon, head} while the player spectates
    spectate: null, // bot id the dead player watches
    paused: false, muted: false,
    stats: { kills: 0, deaths: 0 },
    events: [], // short strings for the HUD/audio to consume, drained each frame
    shot: null, // staging mode: 'start' | 'play' | 'buy' | 'end'
  };
  state.player.weapons = {
    pistol: { owned: true, mag: 12, reserve: 36 },
    rifle: { owned: false, mag: 30, reserve: 90 },
    sniper: { owned: false, mag: 5, reserve: 15 },
    smg: { owned: false, mag: 28, reserve: 84 },
    grenade: { owned: false, count: 0 },
  };
  state.player.weapon = 'pistol';
  state.player.mag = 12;
  state.player.reserve = 36;
  return state;
}

// Append a killfeed line, newest first, capped at four entries.
export function pushKillfeed(state, text, head) {
  state.killfeed.unshift({ text, head: !!head, age: 0 });
  if (state.killfeed.length > 4) state.killfeed.length = 4;
}

export function pushEvent(state, kind, data) {
  state.events.push({ kind, data });
}
