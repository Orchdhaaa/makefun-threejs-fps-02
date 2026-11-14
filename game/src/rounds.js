// rounds.js — the phase machine, the economy and the bomb.
// Economy (DESIGN §3.4, de-CS-ified): start $950, win $2,600, loss $1,700
// +$450 per consecutive loss (cap +$900), kill $250, plant/defuse $250,
// cap $14,000. Rifle $2,900, sniper $4,900, grenade $350, pistol $350.
// Win checks run in order every fixed step (§3.3): explosion, defuse,
// elimination, time expiry.
import { PHASES, pushKillfeed } from './state.js';
import { WEAPONS, GRENADE_PRICE } from './weapons.js';

export const ECONOMY = {
  start: 950, win: 2600, loss: 1700, lossStep: 450, lossCap: 900,
  kill: 250, plant: 250, defuse: 250, cap: 14000,
};
export const ROUND = {
  buyTime: 10, liveTime: 100, bombTime: 35, endTime: 5,
  plantTime: 4, defuseTime: 5, firstTo: 6, maxRounds: 11,
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

export function startRound(state, n) {
  state.round = n;
  state.phase = PHASES.BUY;
  state.timer = ROUND.buyTime;
  state.bomb = { mode: 'carried', x: 0, z: 0, plantT: 0, defuseT: 0, site: '', planter: null, defuser: null };
  state.banner = '';
  state.death = null; state.spectate = null;
  state.grenades.length = 0;
  // Respawn everyone at their spawns, refill reserve ammo (free, §4.1).
  const p = state.player;
  p.hp = 100; p.alive = true; p.x = 0; p.z = 19; p.yaw = 0; p.pitch = 0; p.crouched = false;
  p.weapons.pistol.mag = 12; p.weapons.pistol.reserve = 36;
  if (p.weapons.rifle.owned) { p.weapons.rifle.mag = 30; p.weapons.rifle.reserve = 90; }
  if (p.weapons.sniper.owned) { p.weapons.sniper.mag = 5; p.weapons.sniper.reserve = 15; }
  p.weapons.grenade.count = 0;
  p.weapon = p.weapons.rifle.owned ? 'rifle' : p.weapons.sniper.owned ? 'sniper' : 'pistol';
  p.mag = p.weapons[p.weapon].mag; p.reserve = p.weapons[p.weapon].reserve;
  const spawnsB = [[-3, 19], [2, 19], [4, 19], [-5, 19]];
  const spawnsW = [[-4, -19.5], [-2, -19.5], [2, -19.5], [4, -19.5], [0, -19.5]];
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

export function buyItem(state, itemId) {
  const p = state.player;
  const def = WEAPONS[itemId];
  if (itemId === 'grenade') {
    if (p.weapons.grenade.count >= 1 || state.money < GRENADE_PRICE) return false;
    state.money -= GRENADE_PRICE;
    p.weapons.grenade.count = 1; p.weapons.grenade.owned = true;
    p.weapon = 'grenade';
    return true;
  }
  if (!def) return false;
  if (p.weapons[itemId].owned || state.money < def.price) return false;
  state.money -= def.price;
  p.weapons[itemId].owned = true;
  p.weapons[itemId].mag = def.mag; p.weapons[itemId].reserve = def.reserve;
  p.weapon = itemId;
  p.mag = def.mag; p.reserve = def.reserve;
  return true;
}

export function endRound(state, winner, reason) {
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
  if (state.score.breakers >= ROUND.firstTo || state.score.wardens >= ROUND.firstTo ||
      state.round >= ROUND.maxRounds) {
    state.matchOver = true;
  }
}

// Plant/defuse progress + win checks, in the §3.3 order.
export function roundsStep(state, dt) {
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

function explodeBomb(state) {
  // Blast uses the grenade table against everyone in radius.
  const bx = state.bomb.x, bz = state.bomb.z;
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
