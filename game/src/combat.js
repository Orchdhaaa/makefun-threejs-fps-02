// combat.js — shooting, grenades, damage. One shared Raycaster, a pool of
// 8 reused tracers, no per-shot allocation. Sorted-hits rule: all hits are
// sorted by distance; the first wall or ENEMY hit applies; hits on friendly
// bots are skipped — bullets pass through teammates.
// The muzzle is 0.5 m forward of the torso centre at torso-centre height.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { pushKillfeed, pushEvent } from './state.js';

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _tmp = new THREE.Vector3();
_ray.far = 80;

export function createCombat(scene, world) {
  const tracers = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat.clone());
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, t: 0 });
  }
  let tracerIdx = 0;
  const c = {
    tracers,
    // Fire one hitscan shot. shooter: fighter object. dir: THREE.Vector3.
    // spread: radians. Returns {hit, part, target} or null.
    fireShot(state, shooter, origin, dir, spread) {
      const rng = state.rng;
      _dir.copy(dir);
      // Random cone offset, then normalise (starter method).
      _dir.x += (rng() * 2 - 1) * spread;
      _dir.y += (rng() * 2 - 1) * spread;
      _dir.z += (rng() * 2 - 1) * spread;
      _dir.normalize();
      _origin.copy(origin);
      _ray.set(_origin, _dir);
      const targets = [];
      for (const m of world.shootables) targets.push(m);
      for (const b of state.bots) {
        if (!b.alive || !b.meshes) continue;
        targets.push(b.meshes.head, b.meshes.torso);
      }
      // The player's own view model is never in shootables.
      const hits = _ray.intersectObjects(targets, false);
      // Muzzle point for the tracer.
      const muzzle = _tmp.set(origin.x, origin.y, origin.z);
      let result = null;
      for (const h of hits) {
        const u = h.object.userData;
        if (u && u.bot) {
          if (u.bot.team === shooter.team) continue; // pass through teammates
          result = { hit: h, part: u.part, target: u.bot };
          break;
        }
        result = { hit: h, part: 'wall', target: null };
        break;
      }
      const end = result ? result.hit.point : _tmp.copy(origin).addScaledVector(_dir, 80);
      const tr = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % tracers.length;
      tr.mesh.visible = true;
      tr.mesh.position.copy(origin).add(end).multiplyScalar(0.5);
      tr.mesh.lookAt(end);
      tr.mesh.scale.set(1, 1, origin.distanceTo(end));
      tr.t = 0.06;
      if (result && result.target) {
        const def = WEAPONS[shooter.weapon] || WEAPONS.pistol;
        let dmg = def.body;
        if (result.part === 'head') {
          // Bots never one-tap the player with a headshot: body damage only.
          dmg = shooter.id === 'you' ? def.body * def.headMul : def.body;
        }
        damage(state, result.target, dmg, result.part, shooter);
        return { hit: true, part: result.part, target: result.target, killed: !result.target.alive, point: result.hit.point };
      }
      return { hit: false, part: result ? 'wall' : null, target: null, killed: false, point: end };
    },
    step(dt) {
      for (const tr of tracers) {
        if (tr.t > 0) { tr.t -= dt; if (tr.t <= 0) tr.mesh.visible = false; }
      }
    },
  };
  return c;
}

// Apply damage, credit kills, write the killfeed. part: 'head' | 'torso'.
export function damage(state, target, amount, part, shooter) {
  if (!target.alive) return;
  target.hp -= amount;
  if (target.id === 'you') {
    pushEvent(state, 'hurt', { from: shooter });
  }
  if (target.hp > 0) {
    if (shooter && shooter.id === 'you') pushEvent(state, 'hit', { kill: false });
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
    pushEvent(state, 'hit', { kill: true });
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
    g.fuse -= dt;
    g.vy -= 20 * dt;
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
  pushEvent(state, 'explosion', { x: g.x, z: g.z });
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
