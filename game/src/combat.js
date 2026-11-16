// combat.js — shooting, grenades, damage. One shared Raycaster.
// Ballistics (R4): fireShot spawns a real projectile (state.bullets) with
// per-weapon muzzle velocity and shared gravity BALLISTIC_GRAVITY = 20
// (arcade compression, not Earth physics — see weapons.js); combat.step
// integrates it per fixed step with chunked segment raycasts (<=5 m).
// Sorted-hits rule: all hits are sorted by distance; the first wall or
// ENEMY hit applies; hits on friendly bots are skipped — bullets pass
// through teammates. Bullets are invisible in flight: no mesh, no streak.
// The muzzle is 0.5 m forward of the torso centre at torso-centre height.
import * as THREE from 'three';
import { WEAPONS, BALLISTIC_GRAVITY } from './weapons.js';
import { pushKillfeed, pushEvent } from './state.js';

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
_ray.far = 80;

export function createCombat(scene, world) {
  // No tracer pool: the beam was removed (R4 §1). Bullets are invisible
  // in flight; the only in-flight evidence is muzzle flash/smoke at spawn
  // and the impact at landing. (`scene` is kept in the signature — the
  // caller passes it — but nothing here adds meshes to it anymore.)
  const stats = { cappedDrops: 0 };
  // Player hitbox (invisible, never added to the scene): the player has no
  // visible body mesh (first-person), so without this bot shots can never
  // hit the player — the raycast targets were only world cover + bot
  // meshes, and the player was effectively invincible to bot gunfire.
  // Two parts matching the bot hitboxes (torso 0.52x0.78x0.30 at y=1.0,
  // head sphere r=0.16 at y=1.53). Positioned at the player's feet once
  // per step (see buildTargets); crouching lowers both parts by the
  // eye-height drop (1.6 -> 1.02). matrixWorld is updated explicitly
  // there because the meshes live outside the scene graph.
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const pTorso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.30), hitMat);
  const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), hitMat);
  pTorso.userData = { isPlayer: true, part: 'torso' };
  pHead.userData = { isPlayer: true, part: 'head' };
  // Target list for one step: world shootables + head/torso meshes of all
  // currently alive bots + the player hitbox (positioned once, matrix
  // updated once). Built ONCE per combat.step call and passed into the
  // chunk resolver — never rebuilt per bullet or per chunk.
  function buildTargets(state) {
    const targets = [];
    for (const m of world.shootables) targets.push(m);
    for (const b of state.bots) {
      if (!b.alive || !b.meshes) continue;
      targets.push(b.meshes.head, b.meshes.torso);
      // Matrix staleness is eliminated, not bounded: botsStep moves bots
      // before combat.step in the same fixed step, but matrixWorld is
      // only refreshed by the renderer — up to 0.35 m stale in a 5-step
      // catch-up frame. Refresh every alive rig here, before any raycast.
      b.meshes.rig.updateMatrixWorld(true);
    }
    const p = state.player;
    if (p.alive) {
      const drop = p.crouched ? 0.58 : 0; // EYE_STAND 1.6 -> EYE_CROUCH 1.02
      pTorso.position.set(p.x, (p.y || 0) + 1.0 - drop, p.z);
      pHead.position.set(p.x, (p.y || 0) + 1.53 - drop, p.z);
      pTorso.updateMatrixWorld();
      pHead.updateMatrixWorld();
      targets.push(pHead, pTorso);
    }
    return targets;
  }

  // Hitbox descriptors for the point-in-hitbox test (§3.6): torso boxes
  // (half-extents 0.26 x 0.39 x 0.15) and head spheres (r 0.16). Crouch
  // heights from BOT_TUNING (chest 0.62 / head 0.96); the player hitbox
  // uses the 0.58 eye drop, matching buildTargets above.
  function buildHitboxes(state) {
    const list = [];
    for (const b of state.bots) {
      if (!b.alive) continue;
      const chestY = b.crouched ? 0.62 : 1.0;
      const headY = b.crouched ? 0.96 : 1.53;
      list.push({ target: b, part: 'head', x: b.x, y: headY, z: b.z, r: 0.16 });
      list.push({ target: b, part: 'torso', x: b.x, y: chestY, z: b.z, yaw: b.yaw, hx: 0.26, hy: 0.39, hz: 0.15 });
    }
    const p = state.player;
    if (p.alive) {
      const drop = p.crouched ? 0.58 : 0;
      list.push({ target: p, part: 'head', x: p.x, y: (p.y || 0) + 1.53 - drop, z: p.z, r: 0.16 });
      list.push({ target: p, part: 'torso', x: p.x, y: (p.y || 0) + 1.0 - drop, z: p.z, yaw: 0, hx: 0.26, hy: 0.39, hz: 0.15 });
    }
    return list;
  }

  // Point-in-hitbox at a chunk start. Heads are tested before torsos (the
  // two overlap by 0.02 m). Returns { target, part } or null. Friendly /
  // own-team targets and the shooter's own hitbox are skipped — a bot's
  // eye (1.5) sits inside its own head sphere (centre 1.53, r 0.16), so
  // every bot shot spawns inside its own head and must pass through.
  function pointHit(hitboxes, px, py, pz, shooter) {
    for (let pass = 0; pass < 2; pass++) {
      for (const hb of hitboxes) {
        const isHead = hb.r !== undefined;
        if ((pass === 0) !== isHead) continue;
        const t = hb.target;
        if (!t.alive) continue;
        if (t.id === shooter.id) continue;
        if (t.team === shooter.team) continue;
        let inside = false;
        if (isHead) {
          const dx = px - hb.x, dy = py - hb.y, dz = pz - hb.z;
          inside = dx * dx + dy * dy + dz * dz <= hb.r * hb.r;
        } else {
          const dx = px - hb.x, dz = pz - hb.z;
          const co = Math.cos(hb.yaw), si = Math.sin(hb.yaw);
          const lx = co * dx - si * dz, lz = si * dx + co * dz;
          inside = Math.abs(lx) <= hb.hx && Math.abs(py - hb.y) <= hb.hy && Math.abs(lz) <= hb.hz;
        }
        if (inside) return { target: t, part: hb.part };
      }
    }
    return null;
  }

  // Ranging ray for the probe record: first wall/enemy hit along dir from
  // origin (same sorted-hits rule as the chunk resolver). Returns the
  // horizontal distance and the aim-point height at that range. No hit:
  // the 80 m cap.
  function measureRange(state, shooter, origin, dir) {
    const targets = buildTargets(state);
    _origin.copy(origin);
    _dir.copy(dir);
    _ray.set(_origin, _dir);
    _ray.far = 80;
    const hits = _ray.intersectObjects(targets, false);
    _ray.far = 80;
    let slant = 80;
    for (const h of hits) {
      const u = h.object.userData;
      if (u && u.bot) {
        if (!u.bot.alive || u.bot.team === shooter.team) continue;
        slant = h.distance; break;
      }
      if (u && u.isPlayer) {
        if (shooter.id === 'you' || !state.player.alive) continue;
        slant = h.distance; break;
      }
      slant = h.distance; break;
    }
    const horiz = Math.hypot(dir.x, dir.z) || 1;
    return { rangeM: slant * horiz, aimY: origin.y + dir.y * slant };
  }

  // Resolve one bullet: write the probe record (a fresh object every time
  // — Test F relies on identity), push the impact event, and apply
  // damage. `outcome.point` is null only for expiry, which produces no
  // impact event at all: a bullet that dies mid-air leaves no mark.
  function resolveBullet(state, bullet, outcome) {
    const b = bullet;
    c.lastResolved = {
      weapon: b.weapon,
      rangeM: b.rangeM,
      aimY: b.aimY,
      impact: outcome.point ? { x: outcome.point.x, y: outcome.point.y, z: outcome.point.z } : null,
      part: outcome.part || null,
      targetName: outcome.target ? outcome.target.name : null,
      travelled: outcome.travelled,
      steps: b.steps,
      reason: outcome.reason,
    };
    if (outcome.reason === 'expired') return;
    // Bullet impact feedback: the coordinator drains the 'impact' event
    // into fx.spawnImpact — a dust puff + spark + a lingering decal mark
    // at the hit point. Wall hits and bot hits both report; the player
    // shot always reports, bot shots only when close enough for the
    // player to see the mark (30 m).
    const pt = outcome.point;
    const nearPlayer = Math.hypot(pt.x - state.player.x, pt.z - state.player.z) < 30;
    if (b.shooter.id === 'you' || nearPlayer) {
      pushEvent(state, 'impact', {
        point: { x: pt.x, y: pt.y, z: pt.z },
        normal: outcome.normal ? { x: outcome.normal.x, y: outcome.normal.y, z: outcome.normal.z } : null,
        surface: outcome.target ? 'target' : 'wall',
      });
    }
    if (outcome.target) {
      const def = WEAPONS[b.shooter.weapon] || WEAPONS.pistol;
      let dmg = def.body;
      if (outcome.part === 'head') {
        // Bots never one-tap the player with a headshot: body damage only.
        dmg = b.shooter.id === 'you' ? def.body * def.headMul : def.body;
      }
      // Bot damage model, bot shooters only. The player always deals the
      // full WEAPONS body/head damage. Falloff distance is the accumulated
      // travelled distance (completed chunks + hit distance in the final
      // chunk) — never a straight ray length.
      if (b.shooter.id !== 'you') {
        dmg = botDamage(dmg, b.shooter, outcome.target, outcome.travelled, state);
      }
      damage(state, outcome.target, dmg, outcome.part, b.shooter, pt);
    }
  }

  const c = {
    stats,
    lastResolved: null,
    clearBullets,
    // Fire one shot: spawn a ballistic projectile. shooter: fighter
    // object. dir: THREE.Vector3. spread: radians, applied ONCE at the
    // muzzle. Returns the bullet record (callers ignore it today).
    // Drop is real projectile math with arcade-compression constants
    // (g = 20, rifle v = 320 — see weapons.js). The per-step integrator
    // is velocity-Verlet, exact for constant gravity, so the measured
    // drop matches 1/2*g*t^2 to float precision: a first-order Euler
    // step would overshoot drop by (g*dt/2)*t (~0.04 m at 79 m rifle)
    // and break the harness +/-0.01 m tolerance (R4 §7.2).
    fireShot(state, shooter, origin, dir, spread) {
      const rng = state.rng;
      _dir.copy(dir);
      // Random cone offset, then normalise (starter method).
      _dir.x += (rng() * 2 - 1) * spread;
      _dir.y += (rng() * 2 - 1) * spread;
      _dir.z += (rng() * 2 - 1) * spread;
      _dir.normalize();
      const def = WEAPONS[shooter.weapon] || WEAPONS.pistol;
      const vel = def.velocity || 320;
      // Ranging record for the probe (combat.lastResolved.rangeM/aimY).
      const { rangeM, aimY } = measureRange(state, shooter, origin, _dir);
      const bullet = {
        x: origin.x, y: origin.y, z: origin.z,
        vx: _dir.x * vel, vy: _dir.y * vel, vz: _dir.z * vel,
        shooter, weapon: shooter.weapon,
        travelled: 0, steps: 0, alive: true,
        rangeM, aimY,
      };
      if (!state.bullets) state.bullets = [];
      // Bullet cap 32 (safety valve; the live bound is 16). Oldest BOT
      // bullet drops first — never the player's in-flight rounds. Every
      // trigger logs and counts so it can never pass silently.
      if (state.bullets.length >= 32) {
        let idx = -1;
        for (let i = 0; i < state.bullets.length; i++) {
          if (state.bullets[i].shooter.id !== 'you') { idx = i; break; }
        }
        if (idx === -1) idx = 0; // all 32 are the player's (unreachable in practice)
        state.bullets.splice(idx, 1);
        stats.cappedDrops++;
        console.warn('[ballistics] bullet cap: dropped oldest bullet (cappedDrops=' + stats.cappedDrops + ')');
      }
      state.bullets.push(bullet);
      // Bot shots push a 'shot' event so the coordinator can play a
      // distance-attenuated gunshot and a muzzle flash, at SPAWN time —
      // a gunshot must be heard when the trigger is pulled. The player's
      // own shot sound/flash are played by the caller (doFire), not here.
      if (shooter.id !== 'you') {
        pushEvent(state, 'shot', { weapon: shooter.weapon, x: origin.x, y: origin.y, z: origin.z, dx: _dir.x, dy: _dir.y, dz: _dir.z });
      }
      return bullet;
    },
    step(state, dt) {
      const bullets = state.bullets;
      if (!bullets || bullets.length === 0) return;
      const targets = buildTargets(state);
      const hitboxes = buildHitboxes(state);
      const G = BALLISTIC_GRAVITY;
      const halfGdt2 = 0.5 * G * dt * dt;
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (!b.alive) { bullets.splice(i, 1); continue; }
        b.steps++;
        // Velocity-Verlet step (exact for constant gravity): advance with
        // the old velocity plus the half-gravity term, then update vy.
        // The chord from step start to step end is what the segment
        // raycasts test; the true parabola deviates from it by at most
        // g*dt^2/8 = 0.69 mm — ~400x smaller than the thinnest hitbox.
        const sx = b.x, sy = b.y, sz = b.z;
        const dx = b.vx * dt;
        const dy = b.vy * dt - halfGdt2;
        const dz = b.vz * dt;
        b.vy -= G * dt;
        const stepLen = Math.hypot(dx, dy, dz);
        if (stepLen <= 1e-9) continue;
        const ux = dx / stepLen, uy = dy / stepLen, uz = dz / stepLen;
        let cx = sx, cy = sy, cz = sz;
        let remaining = stepLen;
        let resolved = false;
        while (remaining > 1e-9 && !resolved) {
          const chunkLen = Math.min(5, remaining);
          // (1) Point-in-hitbox at the chunk start: a ray starting inside
          // a FrontSide mesh may report no intersection, so the resolver
          // must not rely on the Raycaster alone for this case.
          const inside = pointHit(hitboxes, cx, cy, cz, b.shooter);
          if (inside) {
            resolveBullet(state, b, {
              reason: 'hit', part: inside.part, target: inside.target,
              point: { x: cx, y: cy, z: cz }, normal: null,
              travelled: b.travelled,
            });
            resolved = true;
            break;
          }
          // (2) Segment raycast: hit-before-cap. _ray.far is set per
          // chunk and restored to 80 immediately after the call, before
          // any damage() call or other code that could re-enter raycasting.
          _origin.set(cx, cy, cz);
          _dir.set(ux, uy, uz);
          _ray.set(_origin, _dir);
          _ray.far = chunkLen;
          const hits = _ray.intersectObjects(targets, false);
          _ray.far = 80;
          let rec = null;
          for (const h of hits) {
            const u = h.object.userData;
            if (u && u.bot) {
              if (!u.bot.alive) continue; // a corpse never blocks a bullet
              if (u.bot.team === b.shooter.team) continue; // pass through teammates
              rec = { hit: h, part: u.part, target: u.bot };
              break;
            }
            if (u && u.isPlayer) {
              if (b.shooter.id === 'you') continue;
              if (!state.player.alive) continue;
              rec = { hit: h, part: u.part, target: state.player };
              break;
            }
            rec = { hit: h, part: 'wall', target: null };
            break;
          }
          if (rec) {
            const falloffDist = b.travelled + rec.hit.distance;
            let nrm = null;
            if (rec.hit.face && rec.hit.face.normal) {
              const wn = rec.hit.face.normal.clone().transformDirection(rec.hit.object.matrixWorld);
              nrm = { x: wn.x, y: wn.y, z: wn.z };
            }
            resolveBullet(state, b, {
              reason: rec.target ? 'hit' : 'wall',
              part: rec.part, target: rec.target,
              point: { x: rec.hit.point.x, y: rec.hit.point.y, z: rec.hit.point.z },
              normal: nrm, travelled: falloffDist,
            });
            resolved = true;
            break;
          }
          // No hit in this chunk: bank the chord length, advance.
          b.travelled += chunkLen;
          cx += ux * chunkLen; cy += uy * chunkLen; cz += uz * chunkLen;
          remaining -= chunkLen;
          // (3) Ground: the floor is not in shootables. A bullet dies at
          // y <= 0.02 with an up normal so the impact leaves a decal.
          if (cy <= 0.02) {
            resolveBullet(state, b, {
              reason: 'ground', part: null, target: null,
              point: { x: cx, y: 0.02, z: cz }, normal: { x: 0, y: 1, z: 0 },
              travelled: b.travelled,
            });
            resolved = true;
            break;
          }
          // (4) Cap: only after a chunk with no hit, so a target at
          // exactly 80.0 m still gets hit.
          if (b.travelled >= 80) {
            resolveBullet(state, b, {
              reason: 'expired', part: null, target: null,
              point: null, normal: null, travelled: b.travelled,
            });
            resolved = true;
            break;
          }
        }
        if (resolved) bullets.splice(i, 1);
        else { b.x = cx; b.y = cy; b.z = cz; }
      }
    },
  };
  return c;
}

// Clear all live bullets, silently (no event, no log). Called from
// rounds.js at every round/match end and at every round start — the same
// shape as the grenade clears. A cleared bullet never resolves: no hit,
// no damage, no killfeed, no money, no stats.
export function clearBullets(state) {
  if (state.bullets) state.bullets.length = 0;
}

// --- Bot damage model (balance pass) -----------------------------------
// The same WEAPONS body value as the player (symmetric base), then — bot
// shooters only — a sniper cap, a distance falloff, and stance/movement
// modifiers. Pure function: no rounding, no state mutation.
//   sniperMul: bot sniper never one-taps a full-HP player (100 -> 90)
//   falloff: x1.00 at/below falloffNear, linear to falloffFarMul at/beyond
//     falloffFar (rifle 33 / 26.4 @20 m / 19.8 @>=30 m)
//   crouchMul: target crouched; sprintMul: target sprinting (replaces
//     moveMul); moveMul: target moving (state.playerMoving).
export const BOT_DAMAGE = {
  sniperMul: 0.9,
  falloffNear: 10, falloffFar: 30, falloffFarMul: 0.6,
  crouchMul: 0.85, moveMul: 0.85, sprintMul: 0.75,
};

export function botDamage(base, shooter, target, dist, state) {
  let dmg = base;
  if (shooter.weapon === 'sniper') dmg *= BOT_DAMAGE.sniperMul;
  const d = typeof dist === 'number' && Number.isFinite(dist) ? dist : 0;
  if (d > BOT_DAMAGE.falloffNear) {
    const t = Math.min(1, (d - BOT_DAMAGE.falloffNear) / (BOT_DAMAGE.falloffFar - BOT_DAMAGE.falloffNear));
    dmg *= 1 - (1 - BOT_DAMAGE.falloffFarMul) * t;
  }
  if (target && target.crouched) dmg *= BOT_DAMAGE.crouchMul;
  // Stance/movement modifiers apply ONLY when the target is the player.
  // (Devil round-2 finding: the old code read state.player.sprinting /
  // state.playerMoving for every target, so bot-vs-bot hits were reduced
  // by 15-25% whenever the player moved — a leak from one subsystem
  // into another. Bot-vs-bot damage now uses only the falloff, the
  // sniper cap, and the target's own crouch flag.)
  if (target && target.id === 'you') {
    if (state && state.player && state.player.sprinting) dmg *= BOT_DAMAGE.sprintMul;
    else if (state && state.playerMoving) dmg *= BOT_DAMAGE.moveMul;
  }
  return dmg;
}

// Apply damage, credit kills, write the killfeed. part: 'head' | 'torso'.
// `point` is the world-space hit point (for the damage-number position);
// callers that have no single point (grenade blast) omit it.
export function damage(state, target, amount, part, shooter, point) {
  if (!target.alive) return;
  // ANVIL (Plated Vest) passive: the player takes 15% less damage.
  // Applied BEFORE the hp subtraction and BEFORE the 'hit' event, so
  // the damage number and the killfeed agree with the hp actually lost.
  // state.player.opMods is set once at boot by main.js (default 1).
  if (target.id === 'you' && state.player.opMods) {
    amount *= state.player.opMods.damageTakenMul ?? 1;
  }
  target.hp -= amount;
  if (target.id === 'you') {
    pushEvent(state, 'hurt', { from: shooter });
  }
  if (target.hp > 0) {
    if (shooter && shooter.id === 'you') pushEvent(state, 'hit', { kill: false, amount, part, point });
    return;
  }
  target.hp = 0;
  target.alive = false;
  const wname = shooter.weapon === 'grenade' ? 'M-7 FRAG'
    : (WEAPONS[shooter.weapon] ? WEAPONS[shooter.weapon].name : 'SPARROW P9');
  const head = part === 'head' && shooter.id === 'you';
  pushKillfeed(state, `${shooter.name} > ${target.name} [${wname}]${head ? ' HEADSHOT' : ''}`, head);
  if (shooter.id === 'you') {
    state.stats.kills++;
    state.money += 250; // kill reward, paid at once to the killer
    pushEvent(state, 'hit', { kill: true, amount, part, point });
    pushEvent(state, 'money', {});
  }
  if (target.id === 'you') {
    state.stats.deaths++;
    state.death = { by: shooter.name, weapon: wname, head: part === 'head' };
    pushEvent(state, 'died', {});
    // The bomb drops where the player fell.
    if (state.bomb.mode === 'carried') {
      state.bomb.mode = 'dropped';
      state.bomb.x = target.x; state.bomb.z = target.z;
    }
  }
  // A defuser hit by any damage loses the channel at once.
  if (state.bomb.defuser === target.id) {
    state.bomb.defuseT = 0;
    state.bomb.defuser = null;
  }
  // A planting bot hit keeps its paused channel (plant pauses, never resets).
  pushEvent(state, 'death', { id: target.id });
}

// ---- Grenades (M-7 FRAG, §4.2) ----
// 120 at 0 m falling linearly to 15 at 6 m, 0 beyond. Walls block damage:
// a ray from 1.0 m above the blast to the target's chest OR head that hits
// a wall means 0. Lethal only within 1.14 m: a softener, not a killer.
// Friendly fire off: only enemy bots are damaged.
export function throwGrenade(state, thrower, origin, dir) {
  const g = {
    x: origin.x, y: origin.y, z: origin.z,
    vx: dir.x * 14 + (thrower.vx || 0) * 0.5,
    vy: dir.y * 14,
    vz: dir.z * 14 + (thrower.vz || 0) * 0.5,
    fuse: 1.8, bounces: 0,
  };
  state.grenades.push(g);
  return g;
}

export function stepGrenades(state, world, dt, meshes) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    // Smoke grenades are NOT stepped here: weapons.stepSmokeGrenades()
    // owns them (different fuse, no explosion, spawns a smoke cloud).
    // Without this guard a smoke grenade would detonate as a frag.
    if (g.kind === 'smoke') continue;
    g.fuse -= dt;
    g.vy -= BALLISTIC_GRAVITY * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.1) {
      g.y = 0.1;
      if (g.bounces === 0) { g.vy = -g.vy * 0.45; g.vx *= 0.7; g.vz *= 0.7; g.bounces++; }
      else { g.vy = 0; g.vx *= 0.9; g.vz *= 0.9; }
    }
    if (meshes && meshes[i]) { meshes[i].position.set(g.x, g.y, g.z); meshes[i].visible = true; }
    if (g.fuse <= 0) {
      explodeGrenade(state, world, g);
      state.grenades.splice(i, 1);
      if (meshes && meshes[i]) meshes[i].visible = false;
    }
  }
}

export function explodeGrenade(state, world, g) {
  pushEvent(state, 'explosion', { x: g.x, y: g.y, z: g.z });
  const targets = [...state.bots];
  for (const t of targets) {
    if (!t.alive || t.team === 'B') continue; // friendly fire off
    const d = Math.hypot(t.x - g.x, t.z - g.z);
    if (d > 6) continue;
    // Wall check: ray from 1.0 m above the blast to chest or head.
    const chestY = t.crouched ? 0.62 : 1.0;
    let blocked = true;
    for (const ty of [chestY, chestY + 0.53]) {
      _origin.set(g.x, 1.0, g.z);
      _dir.set(t.x - g.x, ty - 1.0, t.z - g.z);
      const len = _dir.length();
      _dir.normalize();
      _ray.set(_origin, _dir);
      _ray.far = len;
      const hits = _ray.intersectObjects(world.shootables, false);
      if (hits.length === 0) { blocked = false; break; }
    }
    _ray.far = 80;
    if (blocked) continue;
    const dmg = Math.max(0, 120 - (120 - 15) * (d / 6));
    damage(state, t, Math.round(dmg), 'torso', { id: 'you', name: 'You', weapon: 'grenade', team: 'B' });
  }
}
