// bots.js — the nine bots: bodies, senses and the state machine.
// One controller; friend and foe differ only in team, spawn, role table
// and target selection. States are named per-state functions, not one giant
// step(): ROUTE, HOLD, ENGAGE, INVESTIGATE, PUSH, PLANT, GUARD, RETAKE,
// DEFUSE, HUNT (DESIGN §6.2). Difficulty is fixed: BOT_TUNING below.
// Bots never pick up the grenade and never throw one.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeFighter } from './state.js';
import { hitsCollider } from './player.js';
import { WEAPONS } from './weapons.js';

// Bot tuning — one table, the whole difficulty (DESIGN §6.4).
export const BOT_TUNING = {
  speed: 4.2, crouchSpeed: 2.0, // slower than the player (5.2)
  visionRange: 45, visionCone: 55, // degrees half-angle (110 total)
  hearShot: 22, hearStepRun: 10, hearStepWalk: 5, hearPlant: 15,
  reactionFoe: [0.28, 0.45], reactionFriend: [0.30, 0.50],
  aimBase: 0.010, aimPerMetre: 0.0006, aimCrouchMul: 1.4, aimMoveMul: 1.5,
  aimHeadOnlyMul: 1.4, aimBloom: 0.004,
  burstRifle: 3, burstPause: 0.45, pistolInterval: 0.35, sniperWait: 1.5,
  eyeH: 1.5, chestH: 1.0, headH: 1.53, chestCrouchH: 0.62, headCrouchH: 0.96,
};

const WEST = [[0, 19], [-13, 14], [-20, 14], [-20, 10], [-23, -5], [-24, -13]];
const EAST = [[0, 19], [13, 14], [20, 14], [20, 10], [23, -5], [24, -13]];
const MID = [[0, 19], [8, 14], [8, 10], [8, 2], [8, -8], [8, -13]];
const RETAKE_A = [[0, -19.5], [-8, -13], [-20, -13], [-24, -13]];
const RETAKE_B = [[0, -19.5], [8, -13], [20, -13], [24, -13]];
const HUNT = [[-24, -13], [8, -13], [8, 0], [-8, 0], [-8, 14], [0, 19]];
const GUARD_A = [[-22, -7], [-19, -14], [-27, -17]];
const GUARD_B = [[22, -7], [19, -14], [27, -17]];

function routeTo(bot, list) { bot.route = list.map(([x, z]) => ({ x, z })); bot.wp = 0; }

export function createBots(scene, world, state) {
  const group = new THREE.Group();
  scene.add(group);
  const geoTorso = new THREE.BoxGeometry(0.52, 0.78, 0.30);
  const geoHead = new THREE.SphereGeometry(0.16, 12, 10);
  const geoGun = new THREE.BoxGeometry(0.06, 0.09, 0.6);
  const geoBand = new THREE.BoxGeometry(0.54, 0.12, 0.32);
  const matTorso = new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.85 });
  const matAmber = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.7 });
  const matBlue = new THREE.MeshStandardMaterial({ color: PALETTE.defenderBlue, roughness: 0.7 });
  const matGun = new THREE.MeshStandardMaterial({ color: PALETTE.hairline, roughness: 0.55 });

  const defs = [
    { name: 'Breaker-1', team: 'B', lane: 'west', route: WEST, hold: [-24, -13], site: 'A' },
    { name: 'Breaker-2', team: 'B', lane: 'mid', route: MID, hold: [8, -13], site: 'A' },
    { name: 'Breaker-3', team: 'B', lane: 'east', route: EAST, hold: [24, -13], site: 'B' },
    { name: 'Breaker-4', team: 'B', lane: 'west', route: WEST, hold: [-24, -13], site: 'A' },
    { name: 'Warden-1', team: 'W', lane: 'A1', route: [[0, -19.5], [-14, -13], [-27, -13], [-27, -17]], hold: [-27, -17], site: 'A', holdYaw: Math.PI },
    { name: 'Warden-2', team: 'W', lane: 'A2', route: [[0, -19.5], [-14, -13], [-21, -13], [-21, -11]], hold: [-21, -11], site: 'A' },
    { name: 'Warden-3', team: 'W', lane: 'B1', route: [[0, -19.5], [14, -13], [27, -13], [27, -17]], hold: [27, -17], site: 'B', holdYaw: Math.PI, sniper: true },
    { name: 'Warden-4', team: 'W', lane: 'B2', route: [[0, -19.5], [14, -13], [21, -13], [21, -11]], hold: [21, -11], site: 'B' },
    { name: 'Warden-5', team: 'W', lane: 'mid', route: [[0, -19.5], [8, -13], [8, -8]], hold: [8, -8], site: '', mid: true },
  ];
  const bots = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const spawn = d.team === 'B' ? [d.name === 'Breaker-2' ? 2 : d.name === 'Breaker-3' ? 4 : -2 - (i % 2), 19] : [0, -19.5];
    const b = makeFighter('bot' + i, d.name, d.team, spawn[0], spawn[1], d.team === 'B' ? 0 : Math.PI);
    b.role = d.lane; b.site = d.site; b.sniper = !!d.sniper; b.mid = !!d.mid;
    b.holdX = d.hold[0]; b.holdZ = d.hold[1];
    b.holdYaw = d.holdYaw !== undefined ? d.holdYaw : (d.team === 'B' ? 0 : Math.PI);
    b.weapon = 'rifle';
    b.mag = 30; b.reserve = 90;
    routeTo(b, d.route);
    b.homeRoute = d.route.map(([x, z]) => [x, z]);
    // Body: torso, head, gun, team band. Head + torso are the hit meshes.
    const torso = new THREE.Mesh(geoTorso, matTorso);
    torso.position.y = 1.0; torso.castShadow = true;
    const head = new THREE.Mesh(geoHead, matTorso);
    head.position.y = 1.53; head.castShadow = true;
    const band = new THREE.Mesh(geoBand, d.team === 'B' ? matAmber : matBlue);
    band.position.y = 1.15;
    const headBand = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.34), d.team === 'B' ? matAmber : matBlue);
    headBand.position.y = 1.62;
    const gun = new THREE.Mesh(geoGun, matGun);
    gun.position.set(0.25, 1.15, -0.2);
    const rig = new THREE.Group();
    rig.add(torso, head, band, headBand, gun);
    rig.position.set(b.x, 0, b.z);
    group.add(rig);
    torso.userData = { bot: b, part: 'torso' };
    head.userData = { bot: b, part: 'head' };
    b.meshes = { rig, torso, head, gun };
    b.deadT = 0;
    bots.push(b);
  }
  state.bots = bots;
  return { group, bots };
}

// --- senses ---
const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

function canSee(bot, target, world) {
  const dx = target.x - bot.x, dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > BOT_TUNING.visionRange) return null;
  // Vision cone: +/-55 deg from facing.
  const ang = Math.atan2(-dx, -dz); // yaw that faces the target (yaw 0 = -z)
  let diff = ang - bot.yaw;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  if (Math.abs(diff) > BOT_TUNING.visionCone * Math.PI / 180) return null;
  const eyeY = BOT_TUNING.eyeH;
  const chestY = target.crouched ? BOT_TUNING.chestCrouchH : BOT_TUNING.chestH;
  const headY = target.crouched ? BOT_TUNING.headCrouchH : BOT_TUNING.headH;
  let headOnly = false;
  for (const [ty, isHead] of [[chestY, false], [headY, true]]) {
    _o.set(bot.x, eyeY, bot.z);
    _d.set(dx, ty - eyeY, dz);
    const len = _d.length();
    _d.normalize();
    _ray.set(_o, _d); _ray.far = len;
    const hits = _ray.intersectObjects(world.shootables, false);
    if (hits.length === 0) return { dist, headOnly: isHead, aimY: ty };
    if (isHead) headOnly = true;
  }
  _ray.far = 80;
  return null;
}

function nearestEnemy(state, bot) {
  const foes = [];
  if (bot.team === 'W' && state.player.alive) foes.push(state.player);
  for (const b of state.bots) if (b.alive && b.team !== bot.team) foes.push(b);
  return foes;
}

// --- movement ---
function moveToward(bot, tx, tz, dt, colliders, speed) {
  const dx = tx - bot.x, dz = tz - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return true;
  const step = Math.min(dist, speed * dt);
  const nx = bot.x + (dx / dist) * step;
  const nz = bot.z + (dz / dist) * step;
  const h = bot.crouched ? 1.12 : 1.72;
  if (!hitsCollider(colliders, nx, bot.z, h)) bot.x = nx;
  if (!hitsCollider(colliders, bot.x, nz, h)) bot.z = nz;
  bot.yaw = Math.atan2(-(dx), -(dz));
  // Stuck detection: no progress toward the waypoint.
  const prog = Math.hypot(bot.x - bot.stuckX, bot.z - bot.stuckZ);
  bot.stuckT += dt;
  if (bot.stuckT > 0.5) {
    if (prog < 0.15) {
      // Sidestep 1 m perpendicular, alternating sides, up to 2 times.
      if (bot.sideSteps < 2) {
        const px = -Math.sin(bot.yaw + Math.PI / 2) * bot.sideStep;
        const pz = -Math.cos(bot.yaw + Math.PI / 2) * bot.sideStep;
        if (!hitsCollider(colliders, bot.x + px, bot.z + pz, h)) { bot.x += px; bot.z += pz; }
        bot.sideStep *= -1; bot.sideSteps++;
      } else { bot.wp++; bot.sideSteps = 0; }
    }
    bot.stuckT = 0; bot.stuckX = bot.x; bot.stuckZ = bot.z;
  }
  return dist <= 0.8;
}

export function botsStep(state, world, combat, dt) {
  const colliders = world.colliders;
  for (const bot of state.bots) {
    if (!bot.alive) { bot.deadT += dt; continue; }
    // Vision, staggered: each bot checks every 0.1 s on its own offset.
    bot.visionT -= dt;
    let seen = null;
    if (bot.visionT <= 0) {
      bot.visionT = 0.1;
      for (const foe of nearestEnemy(state, bot)) {
        const v = canSee(bot, foe, world);
        if (v) { seen = { foe, ...v }; break; }
      }
      if (seen) {
        bot.target = seen.foe;
        bot.lastSeenX = seen.foe.x; bot.lastSeenZ = seen.foe.z;
        bot.seeTimer = 1.5;
        if (bot.state !== 'ENGAGE') {
          bot.state = 'ENGAGE';
          const r = bot.team === 'W' ? BOT_TUNING.reactionFoe : BOT_TUNING.reactionFriend;
          bot.reaction = r[0] + state.rng() * (r[1] - r[0]);
          bot.burstLeft = 0; bot.burstPause = 0;
        }
      } else if (bot.target) {
        bot.seeTimer -= 0.1;
        if (bot.seeTimer <= 0) bot.target = null;
      }
    }
    if (bot.target && !bot.target.alive) bot.target = null;
    // Hearing: a gunshot within 22 m turns the bot toward it (no move).
    if (bot.hearT > 0) {
      bot.hearT -= dt;
      if (bot.state === 'ROUTE' || bot.state === 'HOLD') bot.state = 'INVESTIGATE';
    }
    switch (bot.state) {
      case 'ROUTE': updateRoute(state, bot, dt, colliders); break;
      case 'HOLD': updateHold(state, bot, dt); break;
      case 'ENGAGE': updateEngage(state, bot, world, combat, dt); break;
      case 'INVESTIGATE': updateInvestigate(state, bot, dt); break;
      case 'PUSH': updatePush(state, bot, dt, colliders); break;
      case 'PLANT': updatePlant(state, bot, dt, colliders); break;
      case 'GUARD': updateGuard(state, bot, dt, colliders); break;
      case 'RETAKE': updateRetake(state, bot, dt, colliders); break;
      case 'DEFUSE': updateDefuse(state, bot, dt); break;
      case 'HUNT': updateHunt(state, bot, dt, colliders); break;
    }
    // HUNT when last alive on the team.
    if (bot.state !== 'ENGAGE' && bot.state !== 'PLANT' && bot.state !== 'DEFUSE') {
      const aliveMates = state.bots.filter((b) => b.alive && b.team === bot.team);
      if (aliveMates.length === 1 && aliveMates[0] === bot && bot.state !== 'HUNT') {
        bot.state = 'HUNT'; bot.wp = 0; bot.route = HUNT.map(([x, z]) => ({ x, z }));
      }
    }
    syncBotMesh(bot, dt);
  }
}

function updateRoute(state, bot, dt, colliders) {
  if (bot.wp >= bot.route.length) {
    bot.state = 'HOLD';
    bot.yaw = bot.holdYaw;
    return;
  }
  const w = bot.route[bot.wp];
  if (moveToward(bot, w.x, w.z, dt, colliders, BOT_TUNING.speed)) bot.wp++;
  // Mid-route branch: the mid Breaker picks a shed at the branch point.
  if (bot.role === 'mid' && bot.wp === 5 && bot.team === 'B' && bot.route.length === 6) {
    const toA = state.rng() < 0.5;
    bot.site = toA ? 'A' : 'B';
    const end = toA ? [-8, -13] : [24, -13];
    bot.route.push({ x: end[0], z: end[1] });
    bot.holdX = end[0]; bot.holdZ = end[1];
  }
  // PUSH trigger: a teammate died within 12 m, or the timer hits 45 s left.
  if (bot.team === 'B' && state.phase === 'live') {
    for (const b of state.bots) {
      if (b.team === 'B' && !b.alive && Math.hypot(b.x - bot.x, b.z - bot.z) < 12) {
        bot.state = 'PUSH'; return;
      }
    }
    if (state.timer <= 45 && bot.state === 'ROUTE') { bot.state = 'PUSH'; return; }
  }
}

function updateHold(state, bot, dt) {
  // Slow scan: yaw sweeps +/-35 deg over 3 s.
  bot.scanT += dt;
  bot.yaw = bot.holdYaw + Math.sin(bot.scanT * (2 * Math.PI / 3)) * (35 * Math.PI / 180);
  // Mid defender rotates between the two gap lines every 4 s.
  if (bot.mid && bot.state === 'HOLD') {
    bot.scanT += dt;
    if (bot.scanT > 4) {
      bot.scanT = 0;
      bot.holdX = bot.holdX === 8 ? -8 : 8;
      bot.holdZ = -8;
      bot.route = [{ x: bot.holdX, z: -13 }, { x: bot.holdX, z: -8 }];
      bot.wp = 0; bot.state = 'ROUTE';
    }
  }
  // Attackers go to GUARD once the bomb is planted.
  if (state.bomb.mode === 'planted' && bot.team === 'B') {
    const posts = state.bomb.site === 'A' ? GUARD_A : GUARD_B;
    const i = state.bots.indexOf(bot) % posts.length;
    bot.route = [{ x: posts[i][0], z: posts[i][1] }];
    bot.wp = 0; bot.state = 'GUARD';
  }
}

function updateEngage(state, bot, world, combat, dt) {
  const foe = bot.target;
  if (!foe || !foe.alive) { bot.state = 'ROUTE'; return; }
  // Face the enemy.
  bot.yaw = Math.atan2(-(foe.x - bot.x), -(foe.z - bot.z));
  // Carrier with a paused plant channel: back to PLANT in the zone.
  if (bot.team === 'B' && bot.plantT > 0 && state.bomb.mode === 'carried') {
    const site = state.bomb.site || bot.site;
    const s = world.sites[site];
    if (s && bot.x >= s.minX && bot.x <= s.maxX && bot.z >= s.minZ && bot.z <= s.maxZ) {
      bot.state = 'PLANT'; return;
    }
  }
  // Hold fire if a teammate is within 1 m of the muzzle->chest segment.
  const chestY = foe.crouched ? 0.62 : 1.0;
  for (const m of state.bots) {
    if (!m.alive || m === bot || m.team !== bot.team) continue;
    const mx = bot.x - Math.sin(bot.yaw) * 0.5, mz = bot.z - Math.cos(bot.yaw) * 0.5;
    const ax = foe.x - mx, az = foe.z - mz;
    const bx = m.x - mx, bz = m.z - mz;
    const t = Math.max(0, Math.min(1, (bx * ax + bz * az) / (ax * ax + az * az || 1)));
    const px = mx + ax * t, pz = mz + az * t;
    if (Math.hypot(m.x - px, m.z - pz) < 1) { bot.cooldown = Math.max(bot.cooldown, 0.3); return; }
  }
  bot.reaction -= dt;
  if (bot.reaction > 0) return;
  bot.cooldown -= dt;
  if (bot.cooldown > 0) return;
  const def = WEAPONS[bot.weapon] || WEAPONS.rifle;
  const dist = Math.hypot(foe.x - bot.x, foe.z - bot.z);
  let err = BOT_TUNING.aimBase + BOT_TUNING.aimPerMetre * Math.max(0, dist - 10);
  if (foe.crouched) err *= BOT_TUNING.aimCrouchMul;
  if (foe.id === 'you' && state.playerMoving) err *= BOT_TUNING.aimMoveMul;
  err += bot.burstLeft > 0 ? BOT_TUNING.aimBloom : 0;
  if (bot.weapon === 'sniper') {
    bot.cooldown = BOT_TUNING.sniperWait;
    bot.mag--;
    if (bot.mag <= 0) { bot.weapon = 'rifle'; bot.mag = 30; }
  } else if (bot.weapon === 'rifle') {
    if (bot.burstLeft <= 0) { bot.burstLeft = BOT_TUNING.burstRifle; bot.burstPause = BOT_TUNING.burstPause; }
    bot.burstLeft--;
    bot.mag--;
    bot.cooldown = bot.burstLeft > 0 ? def.interval : bot.burstPause;
    if (bot.mag <= 0) { bot.mag = 30; bot.reserve -= 30; bot.cooldown = Math.max(bot.cooldown, 1.9); }
  } else {
    bot.cooldown = BOT_TUNING.pistolInterval;
    bot.mag--;
    if (bot.mag <= 0) { bot.mag = 12; bot.reserve -= 12; bot.cooldown = Math.max(bot.cooldown, 1.4); }
  }
  _o.set(bot.x, 1.5, bot.z);
  const ty = chestY;
  _d.set(foe.x - bot.x, ty - 1.5, foe.z - bot.z).normalize();
  combat.fireShot(state, bot, _o, _d, err);
  // Loud: every bot within 22 m hears the shot.
  hearShot(state, bot);
}

function updateInvestigate(state, bot, dt) {
  // Does NOT move: holds position and scans toward the heard position.
  bot.yaw = Math.atan2(-(bot.hearX - bot.x), -(bot.hearZ - bot.z));
  bot.scanT += dt;
  if (bot.scanT > 2) { bot.scanT = 0; bot.state = 'HOLD'; }
}

function updatePush(state, bot, dt, colliders) {
  const site = bot.site || 'A';
  const s = site === 'A' ? { x: -24, z: -13 } : { x: 24, z: -13 };
  if (moveToward(bot, s.x, s.z, dt, colliders, BOT_TUNING.speed)) {
    bot.holdX = s.x; bot.holdZ = s.z; bot.state = 'HOLD';
  }
}

function updatePlant(state, bot, dt, colliders) {
  // The carrier channels 4 s in the plant zone (pauses outside it).
  const s = state.bomb.site ? state.bomb.site : bot.site;
  const zone = s === 'A' ? { minX: -28, maxX: -20, minZ: -18, maxZ: -10 } : { minX: 20, maxX: 28, minZ: -18, maxZ: -10 };
  if (bot.x < zone.minX || bot.x > zone.maxX || bot.z < zone.minZ || bot.z > zone.maxZ) {
    if (moveToward(bot, s === 'A' ? -24 : 24, -13, dt, colliders, BOT_TUNING.speed)) { /* arrived */ }
    return;
  }
  bot.plantT += dt;
  state.bomb.plantT = bot.plantT;
  if (bot.plantT >= 4) {
    state.bomb.mode = 'planted';
    state.bomb.site = s;
    state.bomb.x = s === 'A' ? -24 : 24;
    state.bomb.z = -13;
    state.bombTimer = 35;
    bot.plantT = 0;
    bot.state = 'GUARD';
  }
}

function updateGuard(state, bot, dt, colliders) {
  if (bot.wp < bot.route.length) {
    const w = bot.route[bot.wp];
    if (moveToward(bot, w.x, w.z, dt, colliders, BOT_TUNING.speed)) bot.wp++;
  } else {
    // Hold the post and scan (do not re-enter updateHold: it would
    // re-assign the guard route every frame).
    bot.scanT += dt;
    bot.yaw = bot.holdYaw + Math.sin(bot.scanT * (2 * Math.PI / 3)) * (35 * Math.PI / 180);
  }
}

function updateRetake(state, bot, dt, colliders) {
  if (bot.wp >= bot.route.length) {
    // At the bomb: defuse if the site is clear (no visible enemy).
    if (!bot.target) {
      bot.state = 'DEFUSE';
      state.bomb.defuser = bot.id;
      bot.defuseT = 0;
    }
    return;
  }
  const w = bot.route[bot.wp];
  if (moveToward(bot, w.x, w.z, dt, colliders, BOT_TUNING.speed)) bot.wp++;
}

function updateDefuse(state, bot, dt) {
  if (state.bomb.defuser !== bot.id) { bot.state = 'RETAKE'; return; }
  bot.defuseT += dt;
  state.bomb.defuseT = bot.defuseT;
  if (bot.defuseT >= 5) {
    state.bomb.mode = 'gone';
    bot.state = 'HOLD';
  }
}

function updateHunt(state, bot, dt, colliders) {
  if (bot.wp >= bot.route.length) { bot.wp = 0; }
  const w = bot.route[bot.wp];
  if (moveToward(bot, w.x, w.z, dt, colliders, BOT_TUNING.speed)) bot.wp++;
}

// Every bot within 22 m of a shot hears it.
export function hearShot(state, shooter) {
  for (const b of state.bots) {
    if (!b.alive || b === shooter) continue;
    if (Math.hypot(b.x - shooter.x, b.z - shooter.z) <= BOT_TUNING.hearShot) {
      b.hearX = shooter.x; b.hearZ = shooter.z; b.hearT = 2; b.scanT = 0;
    }
  }
}

// Sync the rig to the sim state; death is a 0.4 s fall-over.
function syncBotMesh(bot, dt) {
  const m = bot.meshes;
  if (!m) return;
  m.rig.position.set(bot.x, 0, bot.z);
  if (!bot.alive) {
    bot.deadT += dt;
    const k = Math.min(1, bot.deadT / 0.4);
    m.rig.rotation.z = k * Math.PI / 2;
    return;
  }
  m.rig.rotation.y = bot.yaw;
  m.rig.rotation.z = 0;
  // Slight bob while moving.
  const moving = bot.state === 'ROUTE' || bot.state === 'PUSH' || bot.state === 'RETAKE' || bot.state === 'HUNT';
  m.rig.position.y = moving ? Math.abs(Math.sin(bot.x * 2 + bot.z * 2)) * 0.03 : 0;
}
