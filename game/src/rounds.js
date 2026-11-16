// rounds.js — the phase machine, the economy, the bomb, and the mode rules.
// Economy (DESIGN §3.4, de-CS-ified): start $950, win $2,600, loss $1,700
// +$450 per consecutive loss (cap +$900), kill $250, plant/defuse $250,
// cap $14,000. Rifle $2,900, sniper $4,900, grenade $350, pistol $350.
// Win checks run in order every fixed step (§3.3): explosion, defuse,
// elimination, time expiry.
//
// MODES — five modes, one rules file. 'bomb' is the original game and its
// behaviour is unchanged: startBombRound()/bombStep() below are the
// original startRound()/roundsStep() bodies, moved verbatim, and roundsStep
// dispatches to them whenever state.mode is 'bomb'. The other four modes
// share the round/economy machinery where it fits and branch where they
// must. Mode ids are fixed strings; the menu (menu.js) renders MODES
// entries {id, name, desc} directly.
//
//   bomb       Round-based plant/defuse. Default. Rounds to firstTo 6 /
//              maxRounds 11, buy phase every round, full economy.
//   tdm        One continuous match, no rounds, no buy phase. First team
//              to 20 kills wins, else most kills at 300 s. Everyone
//              respawns 3 s after dying with their kept weapons.
//   attack     Round-based like bomb, no bomb. Breakers capture the
//              round's site (alternates A, B, A, B...) by standing in it
//              uncontested for ~6 s, or wipe the Wardens. Wardens win by
//              wiping the Breakers or holding till the round timer ends.
//   domination Round-based like bomb, no bomb. Three points A/B/C; a team
//              captures a point by outnumbering the enemy inside it
//              (~4 s). Held points score 1/s each (cumulative across
//              rounds); first team to 100 wins the match at once. A round
//              ends on elimination or its timer, won by the team ahead
//              on domination points (level = draw round, no point).
//   frontline  Round-based like bomb, no bomb. The three points, ordered
//              Breaker-side -> Warden-side, form a line; only the middle
//              front zone is contestable. Capturing it (~4 s) pushes the
//              front one step toward the enemy; capturing the last zone
//              wins the match at once. A round ends on elimination or its
//              timer, won by the team furthest forward (level = draw).
//
// Capture points come from state.capturePoints when the caller supplies
// them (pass MAP.capturePoints to createGameState, or assign
// state.capturePoints before the first round); otherwise the FALLBACK_POINTS
// in state.js are used (site A, site B, mid — the same coordinates as
// MAP.sites). The bot brain in bots.js is retargeted per mode
// (updateAttack / updateDomination / updateFrontline / updateTdm) and
// reads the same capture points, so rules and bots agree on the zones.
//
// Anti-soft-lock: every mode has a timer that always ends the match —
// TDM/Domination/Frontline/Attack rounds end on ROUND.liveTime, and the
// round cap (maxRounds) ends the match even if every round draws.
import { PHASES, pushKillfeed, pushEvent, FALLBACK_POINTS, makeDomPoint } from './state.js';
import { WEAPONS, GRENADE_PRICE, SMOKE_PRICE, spawnWeaponFor, PRIMARY_IDS } from './weapons.js';
import { clearAllSmoke } from './fx.js';
import { clearBullets } from './combat.js';
import { earnCredits, EARN } from './shop.js';

// True only in Bomb Mission: the only mode with an in-match buy menu.
// Every other mode (TDM, Domination, Frontline, Attack) is a loadout
// mode — the 10 s phase is GET READY, the player spawns and respawns
// from the lobby loadout, and no $ is spent in-match. This one
// predicate gates the buy keys, the auto-open, the force-close, the
// render and buyItem() itself, so the modes can never drift apart.
export function hasBuyMenu(state) {
  return state.mode === 'bomb';
}

// Apply the lobby loadout to the player: equip the spawn weapon
// (spawnWeaponFor: the lobby pick, never the live primary), refill the
// owned weapons' magazines the way the old round-start blocks did,
// and reset the live slot-2 choice (primary) for the new round/life.
// Throwables are granted (count 1, owned) only when grantThrowables is
// true AND the loadout toggle is on; otherwise the counts are 0. Round
// starts grant (Bomb always; round-based non-bomb modes too, but not
// TDM — TDM is continuous, not round-based); TDM respawns never grant.
export function applyLoadoutToPlayer(state, grantThrowables) {
  const p = state.player;
  p.weapons.pistol.mag = 12; p.weapons.pistol.reserve = 36;
  if (p.weapons.rifle.owned) { p.weapons.rifle.mag = 30; p.weapons.rifle.reserve = 90; }
  if (p.weapons.sniper.owned) { p.weapons.sniper.mag = 5; p.weapons.sniper.reserve = 15; }
  if (p.weapons.smg && p.weapons.smg.owned) { p.weapons.smg.mag = 28; p.weapons.smg.reserve = 84; }
  p.weapon = spawnWeaponFor(state);
  p.mag = p.weapons[p.weapon].mag; p.reserve = p.weapons[p.weapon].reserve;
  p.primary = PRIMARY_IDS.includes(p.weapon) ? p.weapon : null;
  if (grantThrowables && p.loadoutFrag) {
    p.weapons.grenade.owned = true;
    p.weapons.grenade.count = 1;
  } else {
    p.weapons.grenade.count = 0;
  }
  if (grantThrowables && p.loadoutSmoke && p.weapons.smoke) {
    p.weapons.smoke.owned = true;
    p.weapons.smoke.count = 1;
  } else if (p.weapons.smoke) {
    p.weapons.smoke.count = 0;
  }
}

// --- Shop Credits -------------------------------------------------------
// Meta currency, earned by playing (see shop.js EARN). Round Credits are
// paid in endRound (once per round); match Credits are paid once per
// match by payMatchCredits(), guarded by state.matchCreditsPaid — the
// three match-end paths (endRound rounds-decision, endDrawRound,
// endMatch score-target) are mutually exclusive, but the flag makes a
// double-pay impossible even if two ever fired for one match. The flag
// resets in startRound/startBombRound when a new match starts (round 1).
function payMatchCredits(state) {
  if (state.matchCreditsPaid) return;
  state.matchCreditsPaid = true;
  if (state.matchWinner === 'B') { earnCredits(EARN.matchWin, 'match-win'); state.matchCreditsEarned += EARN.matchWin; }
  else if (state.matchWinner === 'W') { earnCredits(EARN.matchLoss, 'match-loss'); state.matchCreditsEarned += EARN.matchLoss; }
  // A draw (matchWinner null) pays nothing.
}
import { MAP } from './world.js';

export const ECONOMY = {
  start: 950, win: 2600, loss: 1700, lossStep: 450, lossCap: 900,
  kill: 250, plant: 250, defuse: 250, cap: 14000,
};
export const ROUND = {
  buyTime: 10, liveTime: 100, bombTime: 35, endTime: 5,
  plantTime: 4, defuseTime: 5, firstTo: 6, maxRounds: 11,
};

// MODES registry: the menu reads {id, name, desc}; the rules read the
// numeric tuning. roundBased tells the menu/coordinator whether the mode
// plays rounds with a buy phase (bomb/attack/domination/frontline) or one
// continuous match (tdm).
export const MODES = {
  bomb: {
    id: 'bomb', name: 'Bomb Mission',
    desc: 'Plant the charge or wipe the Wardens; defuse or hold to stop them.',
    roundBased: true,
  },
  tdm: {
    id: 'tdm', name: 'Team Deathmatch',
    desc: 'First crew to 20 kills wins — or most kills when the clock ends. Instant respawns.',
    roundBased: false, killTarget: 20, matchTime: 300, respawnTime: 3,
  },
  attack: {
    id: 'attack', name: 'Attack & Defend',
    desc: 'Breakers storm a shed: capture it or wipe the Wardens. Wardens hold till the clock ends.',
    roundBased: true, captureTime: 6,
  },
  domination: {
    id: 'domination', name: 'Domination',
    desc: 'Hold points A, B and C to score — first crew to 100 points wins.',
    roundBased: true, scoreTarget: 100, pointRate: 1, captureTime: 4,
  },
  frontline: {
    id: 'frontline', name: 'Frontline',
    desc: 'Push the front through the middle zone into the enemy base.',
    roundBased: true, captureTime: 4,
  },
};

export function createRounds(state) {
  return { state };
}

// Bot buying: affordability only, never winning (§3.4). A bot buys the
// rifle when it can afford it and keep $350 spare (money >= $3,250).
// Warden-3 buys the sniper from round 3 onward at money >= $5,250.
export function botBuy(state, bot, round) {
  if (!bot.money) bot.money = ECONOMY.start;
  if (bot.sniper && round >= 3 && bot.money >= 5250 && bot.weapon !== 'sniper') {
    bot.money -= 4900; bot.weapon = 'sniper'; bot.mag = 5; bot.reserve = 15;
    return;
  }
  if (bot.weapon !== 'rifle' && bot.money >= 3250) {
    bot.money -= 2900; bot.weapon = 'rifle'; bot.mag = 30; bot.reserve = 90;
  }
}

// --- capture points -------------------------------------------------------
// Normalised {id, x, z, r} list from state.capturePoints, or the fallback
// (MAP.sites A/B + mid) when the map module has not supplied any.
export function getCapturePoints(state) {
  const src = Array.isArray(state.capturePoints) && state.capturePoints.length >= 3
    ? state.capturePoints : FALLBACK_POINTS;
  return src.map((p) => ({ id: p.id, x: p.x, z: p.z, r: p.r || 4.5 }));
}

// The three points ordered Breaker-side -> Warden-side (closest to the
// Breaker spawn, z = 19, first; ties broken by x). Frontline fights over
// them in this order.
export function frontlineZones(state) {
  // The front line runs west → centre → east: A (west), C (centre),
  // B (east). Index 1 is the geographic middle (C), so the front starts
  // there and each capture moves it one step along a real line.
  return getCapturePoints(state).slice().sort((a, b) => a.x - b.x);
}

// (Re)build state.domPoints from the current capture-point source, keeping
// ownership/progress when the point ids match the previous set.
function ensureDomPoints(state) {
  const pts = getCapturePoints(state);
  if (Array.isArray(state.domPoints) && state.domPoints.length === pts.length &&
      state.domPoints.every((d, i) => d.id === pts[i].id)) return state.domPoints;
  state.domPoints = pts.map(makeDomPoint);
  return state.domPoints;
}

// --- spawns / revive ------------------------------------------------------

// Team-spawn offsets, relative to the map's attacker/defender spawn.
// The offsets are the DEPOT 9 ones, so on DEPOT 9 every spawn lands on
// exactly the old coordinate; on FOUNDRY-7 / DUSTLINE they follow
// MAP.attackerSpawn / MAP.defenderSpawn (live binding, re-pointed by
// createWorld before the first round).
const SPAWN_OFFSETS_B = [[-3, -0.5], [2, -0.5], [4, -0.5], [-5, -0.5]];
const SPAWN_OFFSETS_W = [[-4, 0], [-2, 0], [2, 0], [4, 0], [0, 0]];
function spawnsFor(team) {
  const base = team === 'B' ? MAP.attackerSpawn : MAP.defenderSpawn;
  const offs = team === 'B' ? SPAWN_OFFSETS_B : SPAWN_OFFSETS_W;
  return offs.map(([dx, dz]) => [base.x + dx, base.z + dz]);
}

function fighters(state) { return [state.player, ...state.bots]; }

// [x, z, yaw] for a fighter's own-team spawn. Mirrors the indexing of the
// original startRound (first four bots are Breakers).
function spawnFor(state, f) {
  if (f.id === 'you') return [MAP.attackerSpawn.x, MAP.attackerSpawn.z, 0];
  const i = state.bots.indexOf(f);
  const s = f.team === 'B' ? spawnsFor('B')[i % 4] : spawnsFor('W')[i >= 4 ? i - 4 : 0];
  return [s[0], s[1], f.team === 'B' ? 0 : Math.PI];
}

// Refill one fighter's health/ammo for its current weapon (no reposition).
function refillFighter(f) {
  f.hp = 100; f.alive = true; f.crouched = false;
  f.respawnT = 0; f.deadT = 0; f.plantT = 0; f.defuseT = 0;
  f.burstLeft = 0; f.cooldown = 0; f.target = null;
  if (f.weapon === 'rifle') { f.mag = 30; f.reserve = 90; }
  else if (f.weapon === 'sniper') { f.mag = 5; f.reserve = 15; }
  else { f.mag = 12; f.reserve = 36; }
}

// Respawn one dead fighter at its team's spawn with full health and its
// kept weapons (TDM). The player keeps the loadout they own; a bot keeps
// its bought weapon and its home route.
export function respawnFighter(state, f) {
  const [x, z, yaw] = spawnFor(state, f);
  refillFighter(f);
  f.x = x; f.z = z; f.yaw = yaw; f.pitch = 0;
  f.state = 'ROUTE'; f.wp = 0;
  if (f.homeRoute) f.route = f.homeRoute.map(([rx, rz]) => ({ x: rx, z: rz }));
  if (f.meshes) { f.meshes.rig.rotation.z = 0; }
  if (f.id === 'you') {
    state.death = null; state.spectate = null;
    // TDM respawn: from the loadout, never granted throwables.
    applyLoadoutToPlayer(state, false);
  }
}

// Revive everyone at their spawns and refill ammo (free, §4.1), exactly as
// the original startRound did — shared by the non-bomb round-based modes.
function reviveAll(state, n) {
  state.grenades.length = 0;
  state.death = null; state.spectate = null; state.banner = '';
  const p = state.player;
  p.hp = 100; p.alive = true; p.x = MAP.attackerSpawn.x; p.z = MAP.attackerSpawn.z; p.yaw = 0; p.pitch = 0; p.crouched = false;
  p.respawnT = 0; p.deadT = 0;
  // Round start: from the loadout; throwables granted in round-based
  // modes, never in TDM (continuous, not round-based).
  applyLoadoutToPlayer(state, state.mode !== 'tdm');
  state.bots.forEach((b, i) => {
    const s = b.team === 'B' ? spawnsFor('B')[i % 4] : spawnsFor('W')[i - 4];
    b.hp = 100; b.alive = true; b.x = s[0]; b.z = s[1];
    b.yaw = b.team === 'B' ? 0 : Math.PI;
    b.state = 'ROUTE'; b.wp = 0; b.target = null; b.plantT = 0; b.defuseT = 0;
    b.deadT = 0; b.respawnT = 0; b.burstLeft = 0; b.cooldown = 0;
    botBuy(state, b, n);
    if (b.weapon === 'rifle') { b.mag = 30; b.reserve = 90; }
    else if (b.weapon === 'sniper') { b.mag = 5; b.reserve = 15; }
    else { b.mag = 12; b.reserve = 36; }
    // Restore the assigned route (a mid bot's branch push and the HUNT
    // sweep mutate the route list during a round).
    if (b.homeRoute) b.route = b.homeRoute.map(([x, z]) => ({ x, z }));
    b.wp = 0;
    if (b.meshes) { b.meshes.rig.rotation.z = 0; }
  });
}

// Count living fighters of each team inside a circle (x, z, r).
function countIn(state, x, z, r) {
  let b = 0, w = 0;
  for (const f of fighters(state)) {
    if (!f.alive) continue;
    if (Math.hypot(f.x - x, f.z - z) <= r) { if (f.team === 'B') b++; else w++; }
  }
  return { b, w };
}

function teamsAlive(state) {
  return {
    breakers: state.player.alive || state.bots.some((b) => b.alive && b.team === 'B'),
    wardens: state.bots.some((b) => b.alive && b.team === 'W'),
  };
}

// The score that decides this mode's match (the HUD/match overlay read
// state.score for rounds; endMatch mirrors this into state.score at the end
// so the overlay shows the deciding score).
export function modeScore(state) {
  switch (state.mode) {
    case 'tdm': return { ...state.teamKills };
    case 'domination': return { ...state.domScore };
    case 'frontline': return {
      breakers: Math.max(0, Math.min(2, state.front - 1)),
      wardens: Math.max(0, Math.min(2, 1 - state.front)),
    };
    default: return { ...state.score };
  }
}

// --- round start ----------------------------------------------------------

// Original Bomb Mission startRound, verbatim (see file header).
function startBombRound(state, n) {
  state.round = n;
  state.phase = PHASES.BUY;
  state.timer = ROUND.buyTime;
  // A new match starts at round 1: the once-per-match Credits flag resets
  // (a page reload also resets it, since the state is per-load — this is
  // belt-and-braces for any play-again path that reuses the state).
  if (n === 1) state.matchCreditsPaid = false;
  if (n === 1) state.matchCreditsEarned = 0;
  state.bomb = { mode: 'carried', x: 0, z: 0, plantT: 0, defuseT: 0, site: '', planter: null, defuser: null };
  state.banner = '';
  state.death = null; state.spectate = null;
  state.grenades.length = 0;
  // Respawn everyone at their spawns, refill reserve ammo (free, §4.1).
  const p = state.player;
  p.hp = 100; p.alive = true; p.x = MAP.attackerSpawn.x; p.z = MAP.attackerSpawn.z; p.yaw = 0; p.pitch = 0; p.crouched = false;
  // Bomb round start: from the loadout, throwables granted.
  applyLoadoutToPlayer(state, true);
  const spawnsB = spawnsFor('B');
  const spawnsW = spawnsFor('W');
  state.bots.forEach((b, i) => {
    const s = b.team === 'B' ? spawnsB[i % 4] : spawnsW[i - 4];
    b.hp = 100; b.alive = true; b.x = s[0]; b.z = s[1];
    b.yaw = b.team === 'B' ? 0 : Math.PI;
    b.state = 'ROUTE'; b.wp = 0; b.target = null; b.plantT = 0; b.defuseT = 0;
    b.deadT = 0; b.burstLeft = 0; b.cooldown = 0;
    botBuy(state, b, n);
    if (b.weapon === 'rifle') { b.mag = 30; b.reserve = 90; }
    else if (b.weapon === 'sniper') { b.mag = 5; b.reserve = 15; }
    else { b.mag = 12; b.reserve = 36; }
    // Restore the assigned route (a mid bot's branch push and the HUNT
    // sweep mutate the route list during a round).
    b.route = b.homeRoute.map(([x, z]) => ({ x, z }));
    b.wp = 0;
    if (b.meshes) { b.meshes.rig.rotation.z = 0; }
  });
}

export function startRound(state, n) {
  // A late-round smoke cloud must not carry into the next round: clear
  // every registered volume (visuals + registry) at every round start.
  // Safe: fx.update() splices disposed handles from fx.smokes itself.
  clearAllSmoke();
  // Live bullets never carry into the next round either.
  clearBullets(state);
  if (state.mode === 'bomb') { startBombRound(state, n); return; }
  state.round = n;
  // A new match starts at round 1: the once-per-match Credits flag resets.
  if (n === 1) state.matchCreditsPaid = false;
  if (n === 1) state.matchCreditsEarned = 0;
  state._aliveIds = null; // fresh alive snapshot for TDM kill credit
  state.bomb = { mode: 'gone', x: 0, z: 0, plantT: 0, defuseT: 0, site: '', planter: null, defuser: null };
  if (state.mode === 'tdm') {
    // One continuous match: no buy phase, no round reset. Everyone spawns
    // with the TDM loadout — rifle + pistol for the player and every bot —
    // and keeps it for the whole match. Money/kill rewards still accrue
    // (combat.js pays $250 per player kill) but buy nothing: there is no
    // buy phase to spend them in.
    state.phase = PHASES.LIVE;
    state.timer = MODES.tdm.matchTime;
    state.teamKills = { breakers: 0, wardens: 0 };
    state.score = { breakers: 0, wardens: 0 };
    state.banner = '';
    state.player.weapons.rifle.owned = true;
    state.player.weapons.rifle.mag = 30; state.player.weapons.rifle.reserve = 90;
    reviveAll(state, n);
    for (const b of state.bots) { b.weapon = 'rifle'; b.mag = 30; b.reserve = 90; }
    return;
  }
  // Round-based modes without a bomb: Attack, Domination, Frontline.
  // Same buy phase, revive and economy as Bomb Mission; only the bomb and
  // the per-mode state differ.
  state.phase = PHASES.BUY;
  state.timer = ROUND.buyTime;
  reviveAll(state, n);
  if (state.mode === 'attack') {
    state.attackSite = n % 2 === 1 ? 'A' : 'B'; // site alternates A, B, A, B...
    state.attackProg = 0;
  } else if (state.mode === 'domination') {
    if (n === 1) state.domScore = { breakers: 0, wardens: 0 }; // cumulative across rounds
    const pts = ensureDomPoints(state);
    for (const pt of pts) { pt.owner = null; pt.prog = 0; }
  } else if (state.mode === 'frontline') {
    state.front = 1; state.frontProg = 0; // front restarts at the middle zone each round
  }
}

export function buyItem(state, itemId) {
  // Defensive guard: only Bomb Mission has a buy menu. The callers
  // (main.js buy keys / auto-open) are gated by hasBuyMenu too; this
  // makes a stray call in a loadout mode a no-op instead of a spend.
  if (!hasBuyMenu(state)) return false;
  const p = state.player;
  const def = WEAPONS[itemId];
  if (itemId === 'grenade') {
    if (p.weapons.grenade.count >= 1 || state.money < GRENADE_PRICE) return false;
    state.money -= GRENADE_PRICE;
    p.weapons.grenade.count = 1; p.weapons.grenade.owned = true;
    p.weapon = 'grenade';
    return true;
  }
  // Smoke grenade (M-9 SMOKE): 1 per round, $200 — cheaper than frag
  // ($350) so it is affordable on the $950 starting money. Same shape
  // as the frag case; the actual throw lives in weapons.js.
  if (itemId === 'smoke') {
    if (!p.weapons.smoke || p.weapons.smoke.count >= 1 || state.money < SMOKE_PRICE) return false;
    state.money -= SMOKE_PRICE;
    p.weapons.smoke.count = 1; p.weapons.smoke.owned = true;
    p.weapon = 'smoke';
    return true;
  }
  // Knife (TALON K-1): always owned, free — buying it is a no-op that
  // just equips it. It can never fail, so the buy menu never errors.
  if (itemId === 'knife') {
    p.weapon = 'knife';
    return true;
  }
  if (!def) return false;
  if (p.weapons[itemId].owned || state.money < def.price) return false;
  state.money -= def.price;
  p.weapons[itemId].owned = true;
  p.weapons[itemId].mag = def.mag; p.weapons[itemId].reserve = def.reserve;
  p.weapon = itemId;
  p.mag = def.mag; p.reserve = def.reserve;
  // A gun bought in-match becomes the loadout pick for the rest of the
  // match (and the live slot-2 choice), so the next round spawns it.
  if (PRIMARY_IDS.includes(itemId)) {
    p.loadoutPrimary = itemId;
    p.primary = itemId;
  }
  return true;
}

// End the match at once (kill/score target reached, or the match timer ran
// out). winner is 'B' | 'W' | null (draw). The mode score is mirrored into
// state.score so the match overlay — which reads state.score — shows the
// deciding score, not the round tally.
export function endMatch(state, winner, reason) {
  clearBullets(state);
  state.phase = PHASES.MATCH;
  state.matchOver = true;
  state.matchWinner = winner;
  state.matchReason = reason;
  state.timer = 0;
  // Shop Credits: the match payout (once per match, see payMatchCredits).
  payMatchCredits(state);
  const label = winner === 'B' ? 'BREAKERS WIN' : winner === 'W' ? 'WARDENS WIN' : 'DRAW';
  state.banner = 'MATCH — ' + label + ' — ' + reason;
  state.bannerT = 0;
  if (state.mode === 'tdm' || state.mode === 'domination' || state.mode === 'frontline') {
    state.score = { ...modeScore(state) };
  }
  pushEvent(state, 'matchEnd', { winner, reason });
}

export function endRound(state, winner, reason) {
  clearBullets(state);
  state.phase = PHASES.END;
  state.timer = ROUND.endTime;
  const won = winner === 'B';
  state.score.breakers += won ? 1 : 0;
  state.score.wardens += won ? 0 : 1;
  // Economy payout to the player.
  if (won) { state.money += ECONOMY.win; state.lossStreak = 0; }
  else {
    state.money += ECONOMY.loss + Math.min(ECONOMY.lossCap, state.lossStreak * ECONOMY.lossStep);
    state.lossStreak++;
  }
  state.money = Math.min(ECONOMY.cap, state.money);
  // Shop Credits: the round payout (once per round — endRound runs once
  // per round). A draw round (endDrawRound) pays no round Credits.
  earnCredits(won ? EARN.roundWin : EARN.roundLoss, won ? 'round-win' : 'round-loss');
  state.matchCreditsEarned += won ? EARN.roundWin : EARN.roundLoss;
  // Bot money mirrors the same payout (their buying is affordability-gated).
  for (const b of state.bots) {
    if (!b.money) b.money = ECONOMY.start;
    b.money += won === (b.team === 'B') ? ECONOMY.win
      : ECONOMY.loss + Math.min(ECONOMY.lossCap, (b.lossStreak || 0) * ECONOMY.lossStep);
    if (won !== (b.team === 'B')) b.lossStreak = (b.lossStreak || 0) + 1;
    else b.lossStreak = 0;
    b.money = Math.min(ECONOMY.cap, b.money);
  }
  state.banner = (won ? 'ROUND WON — ' : 'ROUND LOST — ') + reason;
  state.bannerT = ROUND.endTime;
  state.roundReason = reason;
  state.roundWinner = winner;
  pushEvent(state, 'roundEnd', { won });
  // Match end. Bomb/Attack are decided by round wins (first to 6) or
  // maxRounds. Domination/Frontline are decided by their MODE score
  // (first to 100 points / front overrun ends the match via endMatch) or
  // by the mode score at maxRounds — round wins never end these matches,
  // or a team could win the match on rounds while losing the mode score.
  // (endMatch mirrors the mode score into state.score, so the overlay
  // shows the deciding score; do the same here at maxRounds.)
  if (state.mode === 'domination' || state.mode === 'frontline') {
    if (state.round >= ROUND.maxRounds) {
      state.matchOver = true;
      const ms = modeScore(state);
      state.matchWinner = ms.breakers === ms.wardens ? null
        : (ms.breakers > ms.wardens ? 'B' : 'W');
      state.matchReason = state.matchWinner
        ? 'MATCH — ' + (state.matchWinner === 'B' ? 'BREAKERS WIN' : 'WARDENS WIN')
        : 'MATCH DRAW';
      state.score = { ...ms };
    }
  } else if (state.score.breakers >= ROUND.firstTo || state.score.wardens >= ROUND.firstTo ||
      state.round >= ROUND.maxRounds) {
    state.matchOver = true;
    state.matchWinner = state.score.breakers === state.score.wardens ? null
      : (state.score.breakers > state.score.wardens ? 'B' : 'W');
    state.matchReason = state.matchWinner
      ? 'MATCH — ' + (state.matchWinner === 'B' ? 'BREAKERS WIN' : 'WARDENS WIN')
      : 'MATCH DRAW';
  }
  // Shop Credits: the match payout, if this round decided the match.
  if (state.matchOver) payMatchCredits(state);
}

// A round that ends level on the deciding score (Domination/Frontline
// timer expiry): no round point, no payout, next round. At maxRounds the
// match is decided on the mode score instead of the round score.
export function endDrawRound(state, reason) {
  clearBullets(state);
  state.phase = PHASES.END;
  state.timer = ROUND.endTime;
  state.banner = 'ROUND DRAW — ' + reason;
  state.bannerT = ROUND.endTime;
  state.roundReason = reason;
  state.roundWinner = null;
  pushEvent(state, 'roundEnd', { won: null, draw: true });
  if (state.round >= ROUND.maxRounds) {
    state.matchOver = true;
    const s = modeScore(state);
    state.matchWinner = s.breakers === s.wardens ? null
      : (s.breakers > s.wardens ? 'B' : 'W');
    state.matchReason = state.matchWinner
      ? 'MATCH — ' + (state.matchWinner === 'B' ? 'BREAKERS WIN' : 'WARDENS WIN')
      : 'MATCH DRAW';
  }
  // Shop Credits: the match payout, if this draw decided the match.
  if (state.matchOver) payMatchCredits(state);
}

// --- TDM ------------------------------------------------------------------

// Credit kills from alive -> dead transitions. There is no friendly fire
// in this game (fireShot skips teammates, grenades only hurt Wardens, and
// TDM has no bomb), so a dead Breaker is always a Warden kill and vice
// versa. The killer's identity is never needed — only which team scored.
function scanDeaths(state) {
  const all = fighters(state);
  const now = new Set();
  for (const f of all) if (f.alive) now.add(f.id);
  const prev = state._aliveIds;
  state._aliveIds = now;
  if (!prev) return; // first sighting: no kill to credit
  for (const f of all) {
    if (prev.has(f.id) && !now.has(f.id)) {
      if (f.team === 'B') state.teamKills.wardens++;
      else state.teamKills.breakers++;
      f.respawnT = MODES.tdm.respawnTime;
    }
  }
}

function tdmStep(state, dt) {
  if (state.phase !== PHASES.LIVE) return;
  scanDeaths(state);
  for (const f of fighters(state)) {
    if (f.alive) continue;
    // Defensive: a fighter dead with no timer (e.g. killed before the
    // first scan) still gets a respawn instead of staying down forever.
    if (f.respawnT <= 0) f.respawnT = MODES.tdm.respawnTime;
    f.respawnT -= dt;
    if (f.respawnT <= 0) respawnFighter(state, f);
  }
  state.timer -= dt;
  // Mirror kills into state.score so the HUD score line reads as the TDM score.
  state.score.breakers = state.teamKills.breakers;
  state.score.wardens = state.teamKills.wardens;
  if (state.teamKills.breakers >= MODES.tdm.killTarget) {
    endMatch(state, 'B', 'FIRST TO ' + MODES.tdm.killTarget + ' KILLS');
    return;
  }
  if (state.teamKills.wardens >= MODES.tdm.killTarget) {
    endMatch(state, 'W', 'FIRST TO ' + MODES.tdm.killTarget + ' KILLS');
    return;
  }
  if (state.timer <= 0) {
    const k = state.teamKills;
    if (k.breakers > k.wardens) endMatch(state, 'B', 'TIME — MOST KILLS');
    else if (k.wardens > k.breakers) endMatch(state, 'W', 'TIME — MOST KILLS');
    else endMatch(state, null, 'TIME — KILLS LEVEL');
  }
}

// --- Domination / Frontline shared round phases ---------------------------

// BUY/END countdowns shared by the round-based non-bomb modes. Returns
// true when the step is consumed (phase is not LIVE).
function roundPhaseStep(state, dt) {
  if (state.phase === PHASES.BUY) {
    state.timer -= dt;
    if (state.timer <= 0) { state.phase = PHASES.LIVE; state.timer = ROUND.liveTime; }
    return true;
  }
  if (state.phase === PHASES.END) {
    state.timer -= dt;
    state.bannerT -= dt;
    if (state.timer <= 0) {
      if (state.matchOver) { state.phase = PHASES.MATCH; }
      else startRound(state, state.round + 1);
    }
    return true;
  }
  return state.phase !== PHASES.LIVE;
}

function domStep(state, dt) {
  if (roundPhaseStep(state, dt)) return;
  state.timer -= dt;
  const pts = ensureDomPoints(state);
  const capTime = MODES.domination.captureTime;
  for (const pt of pts) {
    const { b, w } = countIn(state, pt.x, pt.z, pt.r);
    const prev = pt.prog;
    if (b > w) pt.prog = Math.min(1, pt.prog + dt / capTime);
    else if (w > b) pt.prog = Math.max(-1, pt.prog - dt / capTime);
    // Tie / empty: progress holds. Crossing zero neutralises the point.
    if (pt.prog >= 1) pt.owner = 'B';
    else if (pt.prog <= -1) pt.owner = 'W';
    else if ((prev > 0 && pt.prog <= 0) || (prev < 0 && pt.prog >= 0)) pt.owner = null;
    if (pt.owner !== (pt._lastOwner || null)) {
      pushEvent(state, 'capture', { point: pt.id, owner: pt.owner });
      pt._lastOwner = pt.owner;
    }
  }
  // Holding a point earns 1 point per second per point.
  for (const pt of pts) {
    if (pt.owner === 'B') state.domScore.breakers += MODES.domination.pointRate * dt;
    else if (pt.owner === 'W') state.domScore.wardens += MODES.domination.pointRate * dt;
  }
  if (state.domScore.breakers >= MODES.domination.scoreTarget) {
    endMatch(state, 'B', 'DOMINATION 100 — BREAKERS');
    return;
  }
  if (state.domScore.wardens >= MODES.domination.scoreTarget) {
    endMatch(state, 'W', 'DOMINATION 100 — WARDENS');
    return;
  }
  const alive = teamsAlive(state);
  if (!alive.wardens) { endRound(state, 'B', 'ALL WARDENS DOWN'); return; }
  if (!alive.breakers) { endRound(state, 'W', 'ALL BREAKERS DOWN'); return; }
  if (state.timer <= 0) {
    const s = state.domScore;
    if (s.breakers > s.wardens) endRound(state, 'B', 'TIME — BREAKERS AHEAD ON POINTS');
    else if (s.wardens > s.breakers) endRound(state, 'W', 'TIME — WARDENS AHEAD ON POINTS');
    else endDrawRound(state, 'TIME — POINTS LEVEL');
  }
}

function frontStep(state, dt) {
  if (roundPhaseStep(state, dt)) return;
  state.timer -= dt;
  const zones = frontlineZones(state);
  const zone = zones[state.front];
  if (zone) {
    const { b, w } = countIn(state, zone.x, zone.z, zone.r);
    if (b > w) state.frontProg = Math.min(1, state.frontProg + dt / MODES.frontline.captureTime);
    else if (w > b) state.frontProg = Math.max(-1, state.frontProg - dt / MODES.frontline.captureTime);
    // Tie / empty: progress holds.
    if (state.frontProg >= 1) {
      state.front += 1; state.frontProg = 0;
      pushEvent(state, 'front', { front: state.front });
      if (state.front >= zones.length) {
        endMatch(state, 'B', 'FRONTLINE — BREAKERS OVERRAN THE BASE');
        return;
      }
    } else if (state.frontProg <= -1) {
      state.front -= 1; state.frontProg = 0;
      pushEvent(state, 'front', { front: state.front });
      if (state.front < 0) {
        endMatch(state, 'W', 'FRONTLINE — WARDENS OVERRAN THE BASE');
        return;
      }
    }
  }
  const alive = teamsAlive(state);
  if (!alive.wardens) { endRound(state, 'B', 'ALL WARDENS DOWN'); return; }
  if (!alive.breakers) { endRound(state, 'W', 'ALL BREAKERS DOWN'); return; }
  if (state.timer <= 0) {
    if (state.front > 1) endRound(state, 'B', 'TIME — BREAKERS FURTHEST FORWARD');
    else if (state.front < 1) endRound(state, 'W', 'TIME — WARDENS FURTHEST FORWARD');
    else endDrawRound(state, 'TIME — FRONT LEVEL');
  }
}

// --- Bomb Mission (original roundsStep, verbatim apart from the Attack
// capture block marked below) ----------------------------------------------

function bombStep(state, dt) {
  if (state.phase === PHASES.BUY) {
    state.timer -= dt;
    if (state.timer <= 0) { state.phase = PHASES.LIVE; state.timer = ROUND.liveTime; }
    return;
  }
  if (state.phase === PHASES.END) {
    state.timer -= dt;
    state.bannerT -= dt;
    if (state.timer <= 0) {
      if (state.matchOver) { state.phase = PHASES.MATCH; }
      else startRound(state, state.round + 1);
    }
    return;
  }
  if (state.phase !== PHASES.LIVE) return;
  // The round timer pauses while a plant channel is active.
  const planting = state.bomb.mode === 'carried' && state.bomb.plantT > 0;
  if (state.bomb.mode === 'planted') {
    state.bombTimer -= dt;
    if (state.bombTimer <= 0) {
      // Explosion: blast damage, then a Breaker win (rule 1).
      explodeBomb(state);
      endRound(state, 'B', 'CHARGE DETONATED');
      return;
    }
  } else if (!planting) {
    state.timer -= dt;
  }
  // ATTACK & DEFEND only (bomb mode never reaches this branch: its bomb is
  // 'carried'/'planted'/'dropped', never 'gone', and state.mode is checked).
  // Breakers capture the round's site by standing in it uncontested
  // (~6 s). Defenders in the zone freeze the bar; an empty zone drains it.
  if (state.mode === 'attack') {
    const pts = getCapturePoints(state);
    const pt = pts.find((p) => p.id === state.attackSite) || pts[0];
    const cap = countIn(state, pt.x, pt.z, pt.r);
    if (cap.b > 0 && cap.w === 0) state.attackProg += dt / MODES.attack.captureTime;
    else if (cap.b === 0) state.attackProg = Math.max(0, state.attackProg - dt / MODES.attack.captureTime);
    if (state.attackProg >= 1) { endRound(state, 'B', 'SITE ' + state.attackSite + ' CAPTURED'); return; }
  }
  // Defuse completion (rule 2).
  if (state.bomb.mode === 'planted' && state.bomb.defuseT >= ROUND.defuseTime) {
    state.money += 0; // defuser reward is paid to the bot, not the player
    endRound(state, 'W', 'CHARGE DEFUSED');
    return;
  }
  // Elimination (rule 3).
  const breakersAlive = state.player.alive || state.bots.some((b) => b.alive && b.team === 'B');
  const wardensAlive = state.bots.some((b) => b.alive && b.team === 'W');
  if (!wardensAlive) {
    endRound(state, 'B', 'ALL WARDENS DOWN');
    return;
  }
  if (!breakersAlive) {
    if (state.bomb.mode === 'planted') return; // round continues to explosion/defuse
    endRound(state, 'W', 'ALL BREAKERS DOWN');
    return;
  }
  // Time expiry with no plant (rule 4).
  if (state.timer <= 0 && state.bomb.mode !== 'planted') {
    endRound(state, 'W', 'TIME EXPIRED');
  }
}

// Plant/defuse progress + win checks, in the §3.3 order.
export function roundsStep(state, dt) {
  switch (state.mode) {
    case 'tdm': tdmStep(state, dt); return;
    case 'domination': domStep(state, dt); return;
    case 'frontline': frontStep(state, dt); return;
    default: bombStep(state, dt); return; // 'bomb' and 'attack'
  }
}

function explodeBomb(state) {
  // Blast uses the grenade table against everyone in radius.
  const bx = state.bomb.x, bz = state.bomb.z;
  // The detonation is an explosion event: the coordinator plays the blast
  // sound and the visible explosion for it (previously it was silent and
  // invisible — the biggest boom in the game had no feedback at all).
  pushEvent(state, 'explosion', { x: bx, y: 1, z: bz });
  const hurt = (f) => {
    if (!f.alive) return;
    const d = Math.hypot(f.x - bx, f.z - bz);
    if (d > 6) return;
    const dmg = Math.max(0, Math.round(120 - 105 * (d / 6)));
    f.hp -= dmg;
    if (f.hp <= 0) {
      f.hp = 0; f.alive = false;
      pushKillfeed(state, `${state.bomb.planter || 'You'} > ${f.name} [M-7 FRAG]`, false);
    }
  };
  hurt(state.player);
  for (const b of state.bots) hurt(b);
  state.bomb.mode = 'gone';
}
