// fx.js — FERROLINE procedural animation & effects (ANIMATION ARTIST module).
//
// Self-contained: three.js meshes, particles and lights only. Zero network,
// no external assets, no fetched files. Nothing in here changes gameplay
// rules, economy or round flow — it only animates.
//
// WIRING (coordinator): create ONE instance per game and step it every frame:
//   import { createFX } from './fx.js';
//   const fx = createFX(scene, camera);
//   // in the frame loop, AFTER botsStep()/combat.step():
//   fx.update(dt);
//   // in render(), AFTER the camera is positioned from player state:
//   fx.applyCameraShake(camera);
// Then call the effect functions from the matching event handlers:
//   grenade explodes  -> fx.spawnExplosion(new THREE.Vector3(x, y, z))
//   smoke grenade pops -> fx.spawnSmoke(new THREE.Vector3(x, y, z))
//                        (12 s cloud, r 3.2 m; see SMOKE_* below)
//   player/bot fires  -> fx.flashMuzzle(muzzlePos, direction)
//   bot steps         -> fx.updateBot(bot, dt, { moving, speed, aiming })
//   bot fires         -> fx.botRecoil(bot)
//   bot dies          -> fx.playBotDeath(bot)   (fx.updateBot then finishes the fall)
//   reload starts     -> fx.startReload(weapons.models[weapons.current], WEAPONS[id].reload)
//   aim down sights   -> fx.setScoped(true) / fx.setScoped(false)
//   plant/defuse      -> fx.startChannel(pos, 'plant'|'defuse');
//                        fx.setChannelProgress(plantT / 4) each frame;
//                        fx.stopChannel() when the channel ends.
//
// ORDERING NOTE (bots): bots.js syncBotMesh() also rotates a dead bot's rig
// (rotation.z) every step. fx.updateBot() runs AFTER botsStep() in the frame,
// so the fx death fall wins visually; fx owns rotation.z for dead bots.
// For live bots fx only touches the limbs, the gun mesh and torso pitch —
// none of which syncBotMesh touches — so there is no fight there either.
//
// All effect objects are pooled or disposed when finished: explosions reuse
// pooled debris/smoke particle systems, scorch marks reuse a fixed pool of
// 8, the muzzle flash is a single reusable group. No per-frame allocation
// in the hot path (update loops reuse preallocated arrays).
import * as THREE from 'three';

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const _v = new THREE.Vector3();
// Muzzle-smoke rotation temps (sun-smoke r4 §2.6 change 6): the barrel
// screen angle is projected into these, never into _v (shared by
// toVec3). _camFwd holds the camera forward for the degeneracy test.
const _projA = new THREE.Vector3();
const _projB = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
function toVec3(p, out) {
  if (!p) return out.set(0, 0, 0);
  if (p instanceof THREE.Vector3) return out.copy(p);
  if (Array.isArray(p)) return out.set(p[0] || 0, p[1] || 0, p[2] || 0);
  return out.set(p.x || 0, p.y || 0, p.z || 0);
}
function hashDir(seed) { // deterministic +/-1 from a string/number id
  let h = 0; const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h & 1) === 0 ? 1 : -1;
}

// Shared geometries (never disposed) and materials.
const _sphereGeo = new THREE.SphereGeometry(1, 20, 14);
const _ringGeo = new THREE.RingGeometry(0.85, 1, 48);
const _circleGeo = new THREE.CircleGeometry(1, 40);
const _scorchGeo = new THREE.CircleGeometry(1.7, 28);
// Soft round particle sprite (procedural canvas radial gradient). A
// PointsMaterial WITHOUT a map renders every point as a hard-edged
// SQUARE — the explosion smoke/debris looked like flat pale squares.
// With this map each point is a soft round disc (colour comes from the
// material). Generated once, zero network, no external asset.
const _dotTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
})();
// Elongated ragged muzzle-smoke wisp texture (sun-smoke r4 §2.6 change
// 1). Square 128x128 canvas on purpose — elongation comes only from
// sprite scale, never from texture aspect. 5 near-round blobs, radii
// 14-24 px, joint-sampled so every radius stays in [14, 24] AND every
// ratio rx/ry stays in [0.9, 1.3] (draw rx ~ U[14,24], then
// ry ~ U[max(14, rx/1.3), min(24, rx/0.9)]); rendered aspect of a blob
// is (rx/ry) * (sx/sy) = (rx/ry) * 2.22 at aspect 0.45, i.e. 2.0-2.9:1
// — soft elongated blobs, not streaks. Each blob is drawn twice with a
// 2-4 px offset, clamped so every blob edge stays >= 2 px inside the
// canvas; each blob has its own radial gradient (opaque centre ->
// transparent edge), so no blob has a hard edge. White: colour comes
// from the SpriteMaterial, like _dotTex. _dotTex is NEVER modified.
const _wispTex = (() => {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 5; i++) {
    const rx = 14 + Math.random() * 10; // U[14, 24]
    const ry = Math.max(14, rx / 1.3) + Math.random() * (Math.min(24, rx / 0.9) - Math.max(14, rx / 1.3));
    const cx = 28 + Math.random() * 72; // x in [28, 100]
    const cy = 56 + Math.random() * 16; // y in [56, 72] (+-8 around 64)
    const alpha = 0.5 + Math.random() * 0.3; // 0.5-0.8
    // Second draw: 2-4 px offset in a random direction, clamped so the
    // blob edge stays >= 2 px inside the canvas in that direction.
    const ang = Math.random() * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let maxM = 4;
    if (ca > 0) maxM = Math.min(maxM, (126 - (cx + rx)) / ca);
    if (ca < 0) maxM = Math.min(maxM, ((cx - rx) - 2) / -ca);
    if (sa > 0) maxM = Math.min(maxM, (126 - (cy + ry)) / sa);
    if (sa < 0) maxM = Math.min(maxM, ((cy - ry) - 2) / -sa);
    const m = 2 + Math.random() * Math.max(0, Math.min(2, maxM - 2));
    const ox = ca * m, oy = sa * m;
    for (const [bx, by] of [[cx, cy], [cx + ox, cy + oy]]) {
      g.save();
      g.translate(bx, by);
      g.scale(rx, ry);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
})();
const _limbMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.85 });
const _limbMatDark = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.9 });
const _magMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.3, transparent: true });

// ------------------------------------------------------- particle pools
// One pool set per scene (WeakMap so scenes can be GC'd). Debris/smoke
// Points systems are acquired by an explosion and released when it ends.
const _poolsByScene = new WeakMap();
function getPools(scene) {
  let p = _poolsByScene.get(scene);
  if (!p) {
    p = { debris: [], smoke: [], scorch: [], scorchIdx: 0, debrisIdx: 0, smokeIdx: 0 };
    _poolsByScene.set(scene, p);
  }
  return p;
}
function makePointsSystem(count, size, color, blending) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mat = new THREE.PointsMaterial({
    size, color, transparent: true, opacity: 1, depthWrite: false,
    blending, sizeAttenuation: true, map: _dotTex, alphaTest: 0.01,
  });
  const points = new THREE.Points(geo, mat);
  points.visible = false;
  points.frustumCulled = false;
  return { points, vel: new Float32Array(count * 3), life: 0, maxLife: 1, active: false, count };
}
function acquireSystem(pool, scene, count, size, color, blending) {
  for (const s of pool) if (!s.active) return s;
  if (pool.length < 6) {
    const s = makePointsSystem(count, size, color, blending);
    scene.add(s.points);
    pool.push(s);
    return s;
  }
  // All busy: recycle the oldest slot rather than allocating.
  const s = pool[0];
  pool.push(pool.shift());
  return s;
}
function seedBurst(sys, origin, speedMin, speedMax, upMin, upMax) {
  const pos = sys.points.geometry.attributes.position.array;
  for (let i = 0; i < sys.count; i++) {
    pos[i * 3] = origin.x; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z;
    const a = Math.random() * Math.PI * 2;
    const r = speedMin + Math.random() * (speedMax - speedMin);
    const up = upMin + Math.random() * (upMax - upMin);
    sys.vel[i * 3] = Math.cos(a) * r;
    sys.vel[i * 3 + 1] = up;
    sys.vel[i * 3 + 2] = Math.sin(a) * r;
  }
  sys.points.geometry.attributes.position.needsUpdate = true;
  sys.life = 0;
  sys.active = true;
  sys.points.visible = true;
}
function stepSystem(sys, dt, gravity, drag, floorY) {
  const pos = sys.points.geometry.attributes.position.array;
  for (let i = 0; i < sys.count; i++) {
    sys.vel[i * 3 + 1] += gravity * dt;
    const d = Math.max(0, 1 - drag * dt);
    sys.vel[i * 3] *= d; sys.vel[i * 3 + 2] *= d;
    pos[i * 3] += sys.vel[i * 3] * dt;
    pos[i * 3 + 1] += sys.vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += sys.vel[i * 3 + 2] * dt;
    if (pos[i * 3 + 1] < floorY) { pos[i * 3 + 1] = floorY; sys.vel[i * 3 + 1] *= -0.3; }
  }
  sys.points.geometry.attributes.position.needsUpdate = true;
}
function releaseSystem(sys) {
  sys.active = false;
  sys.points.visible = false;
  sys.points.material.opacity = 1;
}

// Scorch marks: fixed pool of 8, oldest reused, left on the ground.
function addScorch(scene, pos) {
  const pools = getPools(scene);
  let mark = pools.scorch[pools.scorchIdx % 8];
  pools.scorchIdx++;
  if (!mark) {
    mark = new THREE.Mesh(_scorchGeo, new THREE.MeshBasicMaterial({
      color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    mark.rotation.x = -Math.PI / 2;
    pools.scorch.push(mark);
    scene.add(mark);
  }
  mark.position.set(pos.x, 0.02 + (pools.scorchIdx % 8) * 0.001, pos.z);
  const s = 0.9 + Math.random() * 0.35;
  mark.scale.set(s, s, 1);
  mark.visible = true;
  return mark;
}

// ---------------------------------------------------------------- explosion
// One function plays the whole explosion: flash, fireball, debris, smoke,
// shockwave ring, screen shake, scorch mark. Returns a handle with
// update(dt) -> false when finished, and dispose().
export function createExplosion(scene, position, opts = {}) {
  const pos = toVec3(position, new THREE.Vector3());
  const pools = getPools(scene);
  const group = new THREE.Group();
  group.position.copy(pos);
  scene.add(group);

  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfff2c0, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flash = new THREE.Mesh(_sphereGeo, flashMat);
  flash.scale.setScalar(0.5);
  group.add(flash);

  const fireMat = new THREE.MeshBasicMaterial({
    color: 0xff9a30, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const fireball = new THREE.Mesh(_sphereGeo, fireMat);
  fireball.scale.setScalar(0.4);
  group.add(fireball);

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffc46b, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(_ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06 - pos.y;
  ring.scale.setScalar(0.5);
  group.add(ring);

  const light = new THREE.PointLight(0xffb347, 0, 18, 1.6);
  light.position.y = 0.6;
  group.add(light);

  const _ps = opts.particleScale !== undefined ? opts.particleScale : 1;
  const debris = acquireSystem(pools.debris, scene, Math.max(4, Math.round(42 * _ps)), 0.14, 0xffc46b, THREE.AdditiveBlending);
  seedBurst(debris, pos, 2.5, 9, 2, 7.5);
  debris.maxLife = 0.9;
  const smoke = acquireSystem(pools.smoke, scene, Math.max(4, Math.round(26 * _ps)), 0.7, 0x8a8a86, THREE.NormalBlending);
  seedBurst(smoke, pos, 0.4, 1.6, 0.9, 2.0);
  smoke.maxLife = 1.9;
  smoke.points.material.opacity = 0.55;

  addScorch(scene, pos);
  const dur = opts.duration || 1.9;
  const handle = {
    group, position: pos.clone(), t: 0, duration: dur, done: false,
    trauma: opts.shake === undefined ? 0.7 : opts.shake,
    update(dt) {
      if (handle.done) return false;
      handle.t += dt;
      const t = handle.t;
      // Flash: bright for ~0.12 s, gone by 0.2 s.
      if (t < 0.2) {
        flash.visible = true;
        flash.scale.setScalar(0.5 + easeOut(t / 0.12) * 2.0);
        flashMat.opacity = 1 - smooth(t / 0.2);
      } else flash.visible = false;
      // Fireball: grows to ~3.5 m over 0.5 s, fades out by 0.7 s.
      if (t < 0.7) {
        fireball.visible = true;
        fireball.scale.setScalar(0.4 + easeOut(t / 0.5) * 3.1);
        fireMat.opacity = 1 - smooth((t - 0.15) / 0.5);
        fireMat.color.setHex(0xff9a30).lerp(new THREE.Color(0xd63c14), clamp(t / 0.6, 0, 1));
      } else fireball.visible = false;
      // Shockwave ring on the ground: expands to ~7 m over 0.6 s.
      if (t < 0.6) {
        ring.visible = true;
        ring.scale.setScalar(0.5 + easeOut(t / 0.6) * 6.5);
        ringMat.opacity = 0.9 * (1 - t / 0.6);
      } else ring.visible = false;
      // Blast light: hard spike, gone by 0.4 s.
      light.intensity = t < 0.4 ? 40 * (1 - t / 0.4) : 0;
      // Debris: ballistic, gravity, floor bounce, fade.
      if (debris.active) {
        debris.life += dt;
        stepSystem(debris, dt, -12, 0.4, 0.03);
        debris.points.material.opacity = Math.max(0, 1 - debris.life / debris.maxLife);
        if (debris.life >= debris.maxLife) releaseSystem(debris);
      }
      // Smoke: rises, expands, fades over ~1.9 s.
      if (smoke.active) {
        smoke.life += dt;
        stepSystem(smoke, dt, 0.6, 0.2, 0.05);
        const k = smoke.life / smoke.maxLife;
        smoke.points.material.size = 0.7 + k * 1.8;
        smoke.points.material.opacity = 0.55 * (1 - k);
        if (smoke.life >= smoke.maxLife) releaseSystem(smoke);
      }
      if (t >= dur) { handle.dispose(); return false; }
      return true;
    },
    dispose() {
      if (handle.done) return;
      handle.done = true;
      scene.remove(group);
      flashMat.dispose(); fireMat.dispose(); ringMat.dispose();
      releaseSystem(debris);
      releaseSystem(smoke);
    },
  };
  return handle;
}
// Convenience alias — same function, shorter name for event handlers.
export const spawnExplosion = createExplosion;
export const playExplosion = createExplosion;

// ---------------------------------------------------------------- muzzle flash
// Single reusable group: a point light + a cone + crossed star planes +
// a glow sprite. The old flash (cone r 0.09 / len 0.38, star 0.30,
// light 7, life 0.06 s) was invisible in a still frame — 60 ms is one
// frame at 60 fps and the cone is edge-on from most angles. The new
// one is bigger, carries a glow sprite that reads from any angle, and
// lives 0.12 s; on full-auto (a shot every 0.10 s) it is effectively
// continuous while firing. Sizes are capped so the flash reads as a
// burst AT the muzzle, not a screen-filling blob: at ~0.6 m from the
// camera a 1.1 m glow sprite subtends ~85 deg (gfx-final-depot9-fire1).
// R2: the 0.5 m glow at 0.6 m still subtended ~45 deg at t=0 and the
// per-frame group.scale *= (1+dt*2) compounded to ~67 deg — frozen t=0
// measured 12.78% of the frame pure white, a 342x390 px dense core on
// the crosshair. Glow is now 0.28 m growing to 0.35 m max, the
// compounding growth is deleted, star 0.22 m / 0.6 opacity, light 6.
export function createMuzzleFlash(scene, opts = {}) {
  const group = new THREE.Group();
  group.visible = false;
  const light = new THREE.PointLight(0xffd27a, 0, 12, 1.8);
  group.add(light);
  // R2: 32 radial segments, NOT 10 — the cone's base cap faces the
  // camera (the cone points away from it), and with 10 segments the
  // cap rendered as a hard-edged white DECAGON at t=0 (isolated by
  // toggling parts: cone-only 2.47% whites, same bbox as the full
  // flash; glow-only 0.05%, stars-only 0.59% — the "star planes"
  // the Devil saw were the cone's base, not the stars). 32 segments
  // make the cap effectively round; size/opacity unchanged.
  const coneGeo = new THREE.ConeGeometry(0.12, 0.38, 32);
  coneGeo.rotateX(-Math.PI / 2); // tip forward (-z)
  coneGeo.translate(0, 0, -0.19); // base sits at the muzzle
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xffc46b, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  group.add(cone);
  // Star planes: soft-edged (radial-dot texture) so the burst reads as
  // fire, not a paper star — the plain-colour squares had perfectly
  // straight edges that filled half the screen in stills
  // (gfx-final-dustline/foundry-fire1). Smaller and dimmer than the
  // glow sprite; the glow is the soft element, the star is the spike.
  const starMat = new THREE.MeshBasicMaterial({
    map: _dotTex, color: 0xfff6c0, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const starGeo = new THREE.PlaneGeometry(0.22, 0.22);
  const starA = new THREE.Mesh(starGeo, starMat);
  const starB = new THREE.Mesh(starGeo, starMat);
  starB.rotation.z = Math.PI / 4;
  group.add(starA, starB);
  const core = new THREE.Mesh(_sphereGeo, new THREE.MeshBasicMaterial({
    color: 0xfffbe8, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  core.scale.setScalar(0.09);
  group.add(core);
  // Glow sprite: a soft hot ball at the muzzle. Unlike the cone/star it
  // has no edge-on angle — it reads as a flash from wherever the camera
  // sits, which is what makes the shot visible in a still frame.
  // 0.28, NOT 0.5: the muzzle sits ~0.6 m from the camera, so a 0.5 m
  // sprite subtends ~45 deg at t=0 and the old compounding growth
  // pushed it to ~67 deg — a screen-whiting blob (12.78% of the frame
  // pure white at frozen t=0). 0.28 m growing to 0.35 m max still reads
  // as a bright burst while leaving the scene visible.
  const glowMat = new THREE.SpriteMaterial({
    map: _dotTex, color: 0xffc46b, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(0.28);
  group.add(glow);
  scene.add(group);

  const ctrl = {
    group, t: 0, life: opts.life || 0.12, active: false,
    // World-space flash: position + forward direction (THREE.Vector3 or {x,y,z}).
    flash(position, direction) {
      toVec3(position, group.position);
      if (direction) {
        const d = toVec3(direction, _v).normalize();
        group.lookAt(_v.copy(group.position).add(d));
      }
      ctrl.t = 0;
      ctrl.active = true;
      group.visible = true;
      group.rotation.z = Math.random() * Math.PI * 2;
      // Near-unity random scale (0.9-1.0): the glow's 0.35 m end-of-life
      // cap is absolute — a larger group scale would silently break it.
      const s = 0.9 + Math.random() * 0.1;
      group.scale.setScalar(s);
      light.intensity = 6;
      coneMat.opacity = 0.7; starMat.opacity = 0.6; glowMat.opacity = 0.9;
    },
    // Attached mode: parent to a viewmodel group (e.g. weapons.group) at
    // the barrel tip; burst() then fires without a position argument.
    attachTo(parent, offset = { x: 0.28, y: -0.24, z: -1.0 }) {
      parent.add(group);
      group.position.set(offset.x, offset.y, offset.z);
      group.rotation.set(0, 0, 0);
      return ctrl;
    },
    burst() { ctrl.flash(group.position, new THREE.Vector3(0, 0, -1)); },
    update(dt) {
      if (!ctrl.active) return false;
      ctrl.t += dt;
      const k = ctrl.t / ctrl.life;
      if (k >= 1) {
        ctrl.active = false;
        group.visible = false;
        light.intensity = 0;
        return false;
      }
      const f = 1 - k;
      light.intensity = 6 * f;
      coneMat.opacity = 0.7 * f;
      starMat.opacity = 0.6 * f;
      glowMat.opacity = 0.9 * f;
      // Glow grows 0.28 -> 0.35 m over its life and stops there. There
      // is deliberately NO group.scale growth here: the old
      // group.scale *= (1+dt*2) compounded every frame (~1.26x over
      // the 0.12 s life at 60 fps) and, on full-auto, stacked into a
      // continuous white-out.
      glow.scale.setScalar(0.28 + 0.07 * k);
      return true;
    },
    dispose() {
      scene.remove(group);
      coneMat.dispose(); starMat.dispose(); glowMat.dispose();
      core.material.dispose();
    },
  };
  return ctrl;
}
export const showMuzzleFlash = (scene, position, direction) => {
  const c = createMuzzleFlash(scene);
  c.flash(position, direction);
  return c;
};

// ---------------------------------------------------------------- bot animation
// The shipped bot rig (bots.js) is torso + head + team band + gun only —
// no limbs. attachBotLimbs() lazily adds procedural legs/arms (pivot
// groups at hip/shoulder so they swing) the first time a bot is animated,
// and stores them on bot._fxLimbs. Safe to call every frame; no-op after
// the first call. Returns the limbs record (or null if no rig).
export function attachBotLimbs(bot) {
  if (!bot || !bot.meshes || !bot.meshes.rig) return null;
  if (bot._fxLimbs) return bot._fxLimbs;
  const rig = bot.meshes.rig;
  const mkLimb = (mat, w, h, d, x, y, z) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.y = -h / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    rig.add(pivot);
    return pivot;
  };
  const limbs = {
    legL: mkLimb(_limbMat, 0.16, 0.52, 0.18, -0.13, 0.62, 0),
    legR: mkLimb(_limbMat, 0.16, 0.52, 0.18, 0.13, 0.62, 0),
    armL: mkLimb(_limbMatDark, 0.12, 0.55, 0.14, -0.33, 1.34, 0),
    armR: mkLimb(_limbMatDark, 0.12, 0.55, 0.14, 0.33, 1.34, 0),
    baseGunPos: bot.meshes.gun ? bot.meshes.gun.position.clone() : new THREE.Vector3(0.25, 1.15, -0.2),
    baseGunRot: bot.meshes.gun ? bot.meshes.gun.rotation.clone() : new THREE.Euler(),
    walkPhase: Math.random() * Math.PI * 2,
    walkBlend: 0,
    aimBlend: 0,
    recoil: 0,
    deathT: -1,
    deathDir: hashDir(bot.id || bot.name || 'bot'),
    deathDone: false,
  };
  bot._fxLimbs = limbs;
  return limbs;
}

// One-shot recoil kick for a bot that just fired.
export function botRecoil(bot, strength = 1) {
  const limbs = attachBotLimbs(bot);
  if (!limbs) return false;
  limbs.recoil = Math.max(limbs.recoil, clamp(strength, 0, 1.5));
  return true;
}

// Start a bot's death fall. The fall itself is advanced by
// updateBotAnimation() (call it every frame, including for dead bots);
// returns false if the bot has no rig.
export function playBotDeath(bot, opts = {}) {
  const limbs = attachBotLimbs(bot);
  if (!limbs) return false;
  limbs.deathT = 0;
  limbs.deathDone = false;
  if (opts.direction) limbs.deathDir = opts.direction >= 0 ? 1 : -1;
  return true;
}
export const animateBotDeath = playBotDeath;

// Per-frame bot animation. opts: { moving, speed (m/s), aiming, firing }.
//  - moving/speed: walk cycle — legs and arms swing, stride rate scales
//    with speed; eases back to idle when the bot stops.
//  - aiming: arms raise forward and the gun lifts to a shouldered aim pose.
//  - firing: triggers the recoil kick (same as botRecoil).
//  - bot.alive === false: death fall — tips over sideways (0.45 s ease)
//    and stays lying on the ground.
// Returns 'alive' | 'dying' | 'dead' | null (no rig). Call AFTER botsStep()
// each frame so the fx death fall overrides syncBotMesh's rotation.z.
export function updateBotAnimation(bot, dt, opts = {}) {
  if (!bot || !bot.meshes || !bot.meshes.rig) return null;
  const limbs = attachBotLimbs(bot);
  const rig = bot.meshes.rig;
  const gun = bot.meshes.gun;
  const torso = bot.meshes.torso;
  dt = Math.min(dt, 0.05);

  if (!bot.alive) {
    if (limbs.deathT < 0) { limbs.deathT = 0; }
    limbs.deathT += dt;
    const k = easeOut(limbs.deathT / 0.45);
    rig.rotation.z = k * (Math.PI / 2) * limbs.deathDir;
    rig.rotation.x = 0;
    // Limbs relax/splay as the body goes down.
    limbs.legL.rotation.x = lerp(limbs.legL.rotation.x, 0.15, dt * 6);
    limbs.legR.rotation.x = lerp(limbs.legR.rotation.x, -0.1, dt * 6);
    limbs.armL.rotation.x = lerp(limbs.armL.rotation.x, 0.5, dt * 6);
    limbs.armR.rotation.x = lerp(limbs.armR.rotation.x, -0.4, dt * 6);
    if (k >= 1) { limbs.deathDone = true; return 'dead'; }
    return 'dying';
  }

  // Alive: make sure a previous death rotation is cleared.
  rig.rotation.z = 0;
  if (opts.firing) limbs.recoil = Math.max(limbs.recoil, 1);
  limbs.recoil = Math.max(0, limbs.recoil - dt * 5);

  const moving = !!opts.moving;
  const speed = opts.speed !== undefined ? opts.speed : 4.2;
  limbs.walkBlend = lerp(limbs.walkBlend, moving ? 1 : 0, Math.min(1, dt * 8));
  limbs.aimBlend = lerp(limbs.aimBlend, opts.aiming ? 1 : 0, Math.min(1, dt * 10));
  if (moving) limbs.walkPhase += dt * speed * 2.0;
  const swing = Math.sin(limbs.walkPhase) * 0.55 * limbs.walkBlend;
  limbs.legL.rotation.x = swing;
  limbs.legR.rotation.x = -swing;
  // Arms: counter-swing while walking; raised forward while aiming.
  const aimArmX = 1.15;
  limbs.armL.rotation.x = lerp(-swing * 0.7, aimArmX, limbs.aimBlend);
  limbs.armR.rotation.x = lerp(swing * 0.7, aimArmX, limbs.aimBlend);
  limbs.armL.rotation.z = lerp(0, 0.15, limbs.aimBlend);
  limbs.armR.rotation.z = lerp(0, -0.15, limbs.aimBlend);
  // Gun: hip carry -> shouldered aim, plus recoil kick backwards (+z).
  if (gun) {
    const aimPos = { x: 0.05, y: 1.32, z: -0.30 };
    gun.position.set(
      lerp(limbs.baseGunPos.x, aimPos.x, limbs.aimBlend),
      lerp(limbs.baseGunPos.y, aimPos.y, limbs.aimBlend),
      lerp(limbs.baseGunPos.z, aimPos.z, limbs.aimBlend) + limbs.recoil * 0.09,
    );
    gun.rotation.x = limbs.baseGunRot.x - limbs.recoil * 0.12;
  }
  // Torso leans back slightly with the recoil kick.
  if (torso) torso.rotation.x = limbs.recoil * 0.07;
  return 'alive';
}
export const animateBot = updateBotAnimation;
export const updateBot = updateBotAnimation;

// ---------------------------------------------------------------- reload
// Reload animation for a weapon viewmodel (weapons.group or one of
// weapons.models[id]). The gun dips down and tilts, a magazine piece
// drops out and fades, then the gun returns to its base pose exactly
// when the reload duration elapses. Returns a handle with
// update(dt) -> true when finished. Base transform is restored on finish.
export function createReloadAnimation(viewmodel, duration = 1.9) {
  if (!viewmodel || !viewmodel.position) {
    return { update() { return true; }, done: true, noop: true };
  }
  const basePos = viewmodel.position.clone();
  const baseRot = viewmodel.rotation.clone();
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.035), _magMat.clone());
  mag.position.set(0, -0.16, 0.02);
  mag.visible = false;
  viewmodel.add(mag);
  const handle = {
    viewmodel, t: 0, duration: Math.max(0.1, duration), done: false,
    update(dt) {
      if (handle.done) return true;
      handle.t += dt;
      const k = clamp(handle.t / handle.duration, 0, 1);
      // Dip: in during the first 30%, held to 70%, out by 100%.
      const dipK = k < 0.3 ? smooth(k / 0.3) : k < 0.7 ? 1 : 1 - smooth((k - 0.7) / 0.3);
      viewmodel.position.set(
        basePos.x - 0.03 * dipK,
        basePos.y - 0.14 * dipK,
        basePos.z + 0.02 * dipK,
      );
      viewmodel.rotation.set(
        baseRot.x + 0.45 * dipK,
        baseRot.y,
        baseRot.z + 0.22 * dipK,
      );
      // Magazine: drops and fades between 25% and 60% of the reload.
      if (k >= 0.25 && k < 0.6) {
        const mk = (k - 0.25) / 0.35;
        mag.visible = true;
        mag.position.y = -0.16 - mk * 0.35;
        mag.position.x = 0.02 * mk;
        mag.rotation.x = mk * 1.2;
        mag.material.opacity = 1 - mk * 0.4;
      } else {
        mag.visible = false;
      }
      if (k >= 1) {
        viewmodel.position.copy(basePos);
        viewmodel.rotation.copy(baseRot);
        viewmodel.remove(mag);
        mag.material.dispose();
        handle.done = true;
        return true;
      }
      return false;
    },
    cancel() {
      if (handle.done) return;
      viewmodel.position.copy(basePos);
      viewmodel.rotation.copy(baseRot);
      viewmodel.remove(mag);
      mag.material.dispose();
      handle.done = true;
    },
  };
  return handle;
}
export const playReloadAnimation = createReloadAnimation;
export const startReloadAnimation = createReloadAnimation;

// ---------------------------------------------------------------- scope zoom
// Smooth FOV narrowing for aim-down-sights. setZoomed(true) eases from the
// hip FOV to the zoom FOV (default 75 -> 38) over ~0.18 s and back on
// setZoomed(false). update(dt) must be called every frame.
export function createScopeZoom(camera, opts = {}) {
  const hipFov = opts.hipFov || camera.fov || 75;
  const zoomFov = opts.zoomFov || 38;
  const dur = opts.duration || 0.18;
  const z = {
    camera, hipFov, zoomFov, from: camera.fov, to: camera.fov,
    t: 1, duration: dur, active: false, zoomed: false,
    setZoomed(zoomed, fovOverride) {
      z.zoomed = !!zoomed;
      z.from = camera.fov;
      z.to = zoomed ? (fovOverride || zoomFov) : hipFov;
      z.t = 0;
      z.active = z.from !== z.to;
      return z;
    },
    setTargetFov(fov) {
      z.from = camera.fov;
      z.to = clamp(fov, 10, 120);
      z.t = 0;
      z.active = z.from !== z.to;
      return z;
    },
    update(dt) {
      if (!z.active) return false;
      z.t += dt;
      const k = smooth(z.t / z.duration);
      camera.fov = lerp(z.from, z.to, k);
      camera.updateProjectionMatrix();
      if (k >= 1) { z.active = false; camera.fov = z.to; camera.updateProjectionMatrix(); }
      return z.active;
    },
    progress() { return z.active ? smooth(z.t / z.duration) : 1; },
  };
  return z;
}
export const createAimZoom = createScopeZoom;

// ---------------------------------------------------------------- plant/defuse channel
// Visible progress effect at a bomb site while a plant/defuse channel runs:
// a ground ring, a fill disc that grows with progress, a beam that rises
// with progress, and a pulsing light. Drive it with setProgress(frac)
// (coordinator: plantT/4 or defuseT/5) or let it auto-advance over
// opts.duration. stop() removes it.
export function createChannelEffect(scene, position, kind = 'plant', opts = {}) {
  const pos = toVec3(position, new THREE.Vector3());
  const color = opts.color || (kind === 'defuse' ? 0x4da3ff : 0xffcf3d);
  const group = new THREE.Group();
  group.position.set(pos.x, 0.05, pos.z);
  scene.add(group);

  const ringMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const fillMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  });
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1.0, 48), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.01;
  fill.scale.setScalar(0.02);
  group.add(fill);

  const beamMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8, 1, true), beamMat);
  beam.position.y = 1.2;
  beam.scale.y = 0.15;
  group.add(beam);

  const light = new THREE.PointLight(color, 1.5, 9, 1.8);
  light.position.y = 0.6;
  group.add(light);

  const fx = {
    group, kind, progress: 0, time: 0,
    duration: opts.duration || 0, // 0 = coordinator-driven via setProgress
    auto: !!opts.duration,
    active: true,
    setProgress(f) {
      fx.progress = clamp(f, 0, 1);
      fill.scale.setScalar(Math.max(0.02, fx.progress));
      beam.scale.y = 0.15 + fx.progress * 0.85;
      beamMat.opacity = 0.12 + fx.progress * 0.2;
      return fx.progress;
    },
    update(dt) {
      if (!fx.active) return false;
      fx.time += dt;
      const pulse = 0.5 + 0.5 * Math.sin(fx.time * 6);
      light.intensity = 1.2 + pulse * 1.6 + fx.progress * 1.5;
      ringMat.opacity = 0.55 + pulse * 0.35;
      ring.scale.setScalar(1 + pulse * 0.06);
      if (fx.auto && fx.duration > 0) {
        fx.setProgress(fx.progress + dt / fx.duration);
        if (fx.progress >= 1) { fx.stop(); return false; }
      }
      return true;
    },
    stop() {
      if (!fx.active) return;
      fx.active = false;
      scene.remove(group);
      ringMat.dispose(); fillMat.dispose(); beamMat.dispose();
      ring.geometry.dispose(); fill.geometry.dispose(); beam.geometry.dispose();
    },
  };
  return fx;
}
export const createPlantEffect = (scene, pos, opts) => createChannelEffect(scene, pos, 'plant', opts);
export const createDefuseEffect = (scene, pos, opts) => createChannelEffect(scene, pos, 'defuse', opts);
export const startChannelEffect = createChannelEffect;

// ---------------------------------------------------------------- smoke cloud
// M-9 SMOKE: a persistent vision-blocking cloud. One cloud = a dense core
// (two overlapping translucent spheres, DoubleSide so the grey wash also
// covers the camera when the player stands inside it) + 18 billowing
// soft sprites that drift, pulse and slowly rotate. Stacked alpha at the
// centre is ~0.95, so a bot or player behind the cloud is a grey smear at
// best — the cloud is a real visual occluder, not a tint.
//
// The GAMEPLAY side is the module-level registry below, not the meshes:
// every live cloud registers one volume {x, y, z, radius, remaining} on
// creation and unregisters on expiry/dispose. bots.js line-of-sight calls
// segmentBlockedBySmoke(a, b) — a pure segment-vs-sphere test, no scene
// needed — and the coordinator needs nothing else from fx.js to make
// bots blind through smoke. The registry is module-level (not per-fx
// instance) precisely so bots.js can import the query without holding the
// fx instance, and so a cloud survives an fx re-creation. fx.update()
// steps the clouds an instance owns; a standalone createSmokeCloud()
// handle must be stepped by its owner (fx.spawnSmoke does this).
export const SMOKE_DURATION = 12; // s a cloud lives
export const SMOKE_RADIUS = 3.2;  // m, sphere radius around the centre
export const SMOKE_CENTER_Y = 1.3; // m above the detonation point's ground

const _smokeVolumes = []; // live registry entries (see above)
const _sa = new THREE.Vector3();
const _sb = new THREE.Vector3();
const _sc = new THREE.Vector3();
function _asVec3(p, out) { return toVec3(p, out); }

// Snapshot of live smoke volumes: [{x, y, z, radius, remaining, duration}].
// Safe for the coordinator / bots.js to read every frame; the returned
// objects are copies, mutating them does nothing.
export function getSmokeVolumes() {
  return _smokeVolumes.map((v) => ({
    x: v.x, y: v.y, z: v.z, radius: v.radius,
    remaining: Math.max(0, v.remaining), duration: v.duration,
  }));
}
export const listSmokeVolumes = getSmokeVolumes;
export const getActiveSmokeVolumes = getSmokeVolumes;

// True when point p (Vector3 | {x,y,z} | [x,y,z]) lies inside any live
// smoke volume. Used for "is the player/bot standing in smoke" checks.
export function isPointInSmoke(p) {
  _asVec3(p, _sa);
  for (const v of _smokeVolumes) {
    const dx = _sa.x - v.x, dy = _sa.y - v.y, dz = _sa.z - v.z;
    if (dx * dx + dy * dy + dz * dz < v.radius * v.radius) return true;
  }
  return false;
}

// True when the segment a->b passes through any live smoke volume
// (segment-vs-sphere: closest point on the segment to the sphere centre
// within the radius). Endpoints inside the cloud count as blocked too.
// This is THE query bots.js canSee() calls: a sight line through smoke
// does not count as seen. Pure math — no scene, no raycast, no allocation
// beyond three reused temp vectors.
export function segmentBlockedBySmoke(a, b) {
  return segmentBlockedBySmokeDetailed(a, b) !== null;
}
export const smokeBlocksLineOfSight = segmentBlockedBySmoke;
export const isSegmentSmoked = segmentBlockedBySmoke;

// Same test, returning the blocking volume (snapshot) or null.
export function segmentBlockedBySmokeDetailed(a, b) {
  if (_smokeVolumes.length === 0) return null;
  _asVec3(a, _sa);
  _asVec3(b, _sb);
  for (const v of _smokeVolumes) {
    _sc.set(v.x, v.y, v.z);
    const abx = _sb.x - _sa.x, aby = _sb.y - _sa.y, abz = _sb.z - _sa.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = 0;
    if (len2 > 0) {
      t = ((_sc.x - _sa.x) * abx + (_sc.y - _sa.y) * aby + (_sc.z - _sa.z) * abz) / len2;
      t = clamp(t, 0, 1);
    }
    const cx = _sa.x + abx * t, cy = _sa.y + aby * t, cz = _sa.z + abz * t;
    const dx = cx - v.x, dy = cy - v.y, dz = cz - v.z;
    if (dx * dx + dy * dy + dz * dz < v.radius * v.radius) {
      return { x: v.x, y: v.y, z: v.z, radius: v.radius, remaining: Math.max(0, v.remaining), duration: v.duration };
    }
  }
  return null;
}

// One smoke cloud. position: detonation point (ground-level y is fine —
// the cloud centre is raised to SMOKE_CENTER_Y above it). opts:
// { duration (default 12), radius (default 3.2) }. Returns a handle with
// update(dt) -> false when finished, and dispose(). The handle registers
// its volume immediately; update() counts the registry lifetime down in
// lockstep with the visuals, so the query and the picture can never
// disagree about whether the cloud is still there.
export function createSmokeCloud(scene, position, opts = {}) {
  const base = toVec3(position, new THREE.Vector3());
  const duration = opts.duration || SMOKE_DURATION;
  const radius = opts.radius || SMOKE_RADIUS;
  const cx = base.x, cy = Math.max(0.6, base.y) + (SMOKE_CENTER_Y - 1.0), cz = base.z;
  const group = new THREE.Group();
  group.position.set(cx, cy, cz);
  scene.add(group);

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x8f8f88, transparent: true, opacity: 0.62,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const core = new THREE.Mesh(_sphereGeo, coreMat);
  core.scale.setScalar(radius);
  group.add(core);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0x9d9d96, transparent: true, opacity: 0.5,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const inner = new THREE.Mesh(_sphereGeo, innerMat);
  inner.scale.setScalar(radius * 0.62);
  group.add(inner);

  const puffs = [];
  for (let i = 0; i < 18; i++) {
    const mat = new THREE.SpriteMaterial({
      map: _dotTex, color: i % 3 === 0 ? 0x7e8278 : 0x9a9a92,
      transparent: true, opacity: 0.55, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    // Random offset inside the sphere (uniform-ish: cube-root radius).
    const r = radius * (0.25 + 0.75 * Math.cbrt(Math.random()));
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const bx = r * Math.sin(ph) * Math.cos(th);
    const by = r * Math.cos(ph) * 0.55; // squashed vertically: a cloud, not a ball
    const bz = r * Math.sin(ph) * Math.sin(th);
    s.position.set(bx, by, bz);
    const baseScale = 2.0 + Math.random() * 1.7;
    s.scale.setScalar(baseScale);
    group.add(s);
    puffs.push({ sprite: s, mat, bx, by, bz, baseScale, phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() * 0.9 });
  }

  const entry = { x: cx, y: cy, z: cz, radius, remaining: duration, duration };
  _smokeVolumes.push(entry);
  const handle = {
    group, position: new THREE.Vector3(cx, cy, cz), radius, duration,
    t: 0, done: false, entry,
    get remaining() { return Math.max(0, duration - handle.t); },
    update(dt) {
      if (handle.done) return false;
      handle.t += dt;
      entry.remaining = Math.max(0, duration - handle.t);
      const t = handle.t;
      // Fade in over 0.4 s (the pop), hold, fade out over the last 2 s.
      const fadeIn = smooth(t / 0.4);
      const fadeOut = t > duration - 2 ? Math.max(0, 1 - (t - (duration - 2)) / 2) : 1;
      const vis = fadeIn * fadeOut;
      coreMat.opacity = 0.62 * vis;
      innerMat.opacity = 0.5 * vis;
      // Billow: puffs drift on slow sines, swell as the cloud ages, and
      // the whole cloud creeps upward and rotates, so it never reads as
      // a static grey ball.
      const grow = 1 + (t / duration) * 0.35;
      group.rotation.y += dt * 0.07;
      group.position.y = cy + t * 0.06;
      for (const p of puffs) {
        const wob = Math.sin(t * p.speed + p.phase);
        p.sprite.position.set(
          p.bx + wob * 0.35,
          p.by + Math.sin(t * p.speed * 0.7 + p.phase) * 0.25 + t * 0.04,
          p.bz + Math.cos(t * p.speed + p.phase) * 0.35,
        );
        p.sprite.scale.setScalar(p.baseScale * grow * (1 + 0.12 * wob));
        p.mat.opacity = 0.55 * vis;
      }
      if (t >= duration) { handle.dispose(); return false; }
      return true;
    },
    dispose() {
      if (handle.done) return;
      handle.done = true;
      const i = _smokeVolumes.indexOf(entry);
      if (i >= 0) _smokeVolumes.splice(i, 1);
      scene.remove(group);
      coreMat.dispose(); innerMat.dispose();
      for (const p of puffs) p.mat.dispose();
    },
  };
  entry.handle = handle; // so clearAllSmoke() can dispose via the registry
  return handle;
}
export const spawnSmokeCloud = createSmokeCloud;
export const createSmoke = createSmokeCloud;

// Clear every registered smoke volume (coordinator: call on round start
// if any cloud should not carry across rounds; the fx instance's
// clearSmoke() does this plus disposing its own handles).
export function clearAllSmoke() {
  for (const v of [..._smokeVolumes]) {
    if (v.handle) v.handle.dispose();
  }
  _smokeVolumes.length = 0;
}

// ---------------------------------------------------------------- muzzle smoke + impact
// NEW (2026-11-15 gfx push): the game had NO muzzle smoke and NO bullet
// impact feedback at all — a shot left nothing behind except the 60 ms
// flash/tracer. Both are pooled sprite/decal systems owned by the fx
// instance: sprites/decal meshes are created once in createFX and
// recycled, so a shot allocates nothing.
function makePuffSprite(scene, color, blending, tex) {
  const mat = new THREE.SpriteMaterial({
    map: tex || _dotTex, color, transparent: true, opacity: 0, depthWrite: false,
    blending: blending || THREE.NormalBlending,
  });
  const s = new THREE.Sprite(mat);
  s.visible = false;
  scene.add(s);
  return {
    sprite: s, mat, vel: new THREE.Vector3(),
    life: 0, maxLife: 1, s0: 0.2, s1: 0.7, peak: 0.5, active: false,
  };
}
function stepPuff(p, dt) {
  if (!p.active) return;
  p.life += dt;
  const k = p.life / p.maxLife;
  if (k >= 1) {
    p.active = false;
    p.sprite.visible = false;
    p.mat.opacity = 0;
    return;
  }
  p.sprite.position.addScaledVector(p.vel, dt);
  p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
  p.vel.y += p.rise * dt; // smoke/dust keeps rising a little
  const s = p.s0 + (p.s1 - p.s0) * k;
  p.sprite.scale.set(s, s * p.aspect, 1); // non-uniform: elongated wisp
  const fin = p.fadeIn > 0 ? Math.min(1, k / p.fadeIn) : 1;
  p.mat.opacity = p.peak * Math.pow(fin, p.fadeInPow) * Math.pow(1 - k, p.fadePow);
  // Rotation is never touched here — a puff keeps its birth orientation.
}
function firePuff(pool, pos, vel, maxLife, s0, s1, peak, opts = {}) {
  let p = null;
  for (const q of pool) if (!q.active) { p = q; break; }
  // All busy: recycle the genuinely oldest puff (nearest death, opacity
  // already near 0) — NOT slot 0. All pool members are active here, so
  // life/maxLife is defined on every candidate.
  if (!p) p = pool.reduce((a, q) => (q.life / q.maxLife > a.life / a.maxLife ? q : a));
  p.sprite.position.copy(pos);
  p.vel.copy(vel);
  p.life = 0; p.maxLife = maxLife; p.s0 = s0; p.s1 = s1; p.peak = peak;
  // Per-puff params (sun-smoke r4 §2.6 change 4). Defaults are today's
  // impact values, so impact calls passing no opts are byte-identical:
  // drag 1.6, rise 0.25, fadePow 1, 12% linear fade-in, aspect 1.0.
  p.aspect = opts.aspect || 1;
  p.drag = opts.drag !== undefined ? opts.drag : 1.6;
  p.rise = opts.rise !== undefined ? opts.rise : 0.25;
  p.fadePow = opts.fadePow !== undefined ? opts.fadePow : 1;
  p.fadeIn = opts.fadeIn !== undefined ? opts.fadeIn : 0.12;
  p.fadeInPow = opts.fadeInPow !== undefined ? opts.fadeInPow : 1;
  if (opts.rotation !== undefined) p.mat.rotation = opts.rotation;
  p.active = true;
  p.sprite.visible = true;
  p.sprite.scale.set(s0, s0 * p.aspect, 1);
  p.mat.opacity = peak;
  return p;
}
const _up = new THREE.Vector3(0, 0, 1);
const _tmpN = new THREE.Vector3();

// ---------------------------------------------------------------- factory
// One fx instance per game: owns the muzzle flash, the scope zoom, the
// camera shake and the lists of live explosions / reloads / channels.
// Call fx.update(dt) every frame (after botsStep/combat) and
// fx.applyCameraShake(camera) in render() after the camera is positioned.
export function createFX(scene, camera, opts = {}) {
  const muzzle = createMuzzleFlash(scene);
  // Muzzle-smoke pool (sun-smoke r4 §2.6): 64 warm-grey (0x8a8a86)
  // wisps on the elongated _wispTex. Design case is SMG player + all 9
  // bots sustained (rifle): 62.32 births/s x 0.85 s mean life = 52.97
  // alive mean (20.8% headroom), x 1.0 s max life = 62.32 < 64. The
  // true-oldest recycle (firePuff) covers the only overflow regime
  // (perfect 9-way burst phase-lock, ~5e-7 per reshuffle) gracefully.
  const muzzleSmoke = [];
  for (let i = 0; i < 64; i++) muzzleSmoke.push(makePuffSprite(scene, 0x8a8a86, THREE.NormalBlending, _wispTex));
  // Impact dust pool (24 tan sprites) + spark pool (8 additive orange).
  const impactDust = [];
  for (let i = 0; i < 24; i++) impactDust.push(makePuffSprite(scene, 0xc9b18c));
  const impactSparks = [];
  for (let i = 0; i < 8; i++) impactSparks.push(makePuffSprite(scene, 0xffc46b, THREE.AdditiveBlending));
  // Impact decals: 12 dark marks left where bullets hit, oldest reused.
  const impactDecals = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x141210, transparent: true, opacity: 0, depthWrite: false,
    });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20), mat);
    m.visible = false;
    scene.add(m);
    impactDecals.push({ mesh: m, mat, life: 0, maxLife: 8, active: false });
  }
  let impactDecalIdx = 0;
  const scope = createScopeZoom(camera, {
    hipFov: opts.hipFov || camera.fov || 75,
    zoomFov: opts.zoomFov || 38,
    duration: opts.scopeDuration || 0.18,
  });
  const fx = {
    scene, camera, muzzle, scope,
    explosions: [],
    reloads: [],
    channels: [],
    channel: null,
    smokes: [], // live smoke clouds owned by this instance
    trauma: 0,
    shakeStrength: opts.shakeStrength !== undefined ? opts.shakeStrength : 1,
    particleScale: opts.particleScale !== undefined ? opts.particleScale : 1, // quality tier: burst counts scale by this (Low 0.35 / Medium 1 / Ultra 1.6)

    update(dt) {
      dt = Math.min(dt, 0.05);
      for (let i = fx.explosions.length - 1; i >= 0; i--) {
        if (!fx.explosions[i].update(dt)) fx.explosions.splice(i, 1);
      }
      for (let i = fx.smokes.length - 1; i >= 0; i--) {
        if (!fx.smokes[i].update(dt)) fx.smokes.splice(i, 1);
      }
      for (let i = fx.reloads.length - 1; i >= 0; i--) {
        if (fx.reloads[i].update(dt)) fx.reloads.splice(i, 1);
      }
      for (let i = fx.channels.length - 1; i >= 0; i--) {
        if (!fx.channels[i].update(dt)) {
          if (fx.channel === fx.channels[i]) fx.channel = null;
          fx.channels.splice(i, 1);
        }
      }
      muzzle.update(dt);
      scope.update(dt);
      for (const p of muzzleSmoke) stepPuff(p, dt);
      for (const p of impactDust) stepPuff(p, dt);
      for (const p of impactSparks) stepPuff(p, dt);
      for (const d of impactDecals) {
        if (!d.active) continue;
        d.life += dt;
        const k = d.life / d.maxLife;
        if (k >= 1) { d.active = false; d.mesh.visible = false; d.mat.opacity = 0; continue; }
        d.mat.opacity = k > 0.6 ? 0.65 * (1 - (k - 0.6) / 0.4) : 0.65;
      }
      fx.trauma = Math.max(0, fx.trauma - dt * 1.6);
      return fx;
    },
    step(dt) { return fx.update(dt); },

    // 1 — Explosion (whole effect in one call).
    spawnExplosion(position, options = {}) {
      const h = createExplosion(scene, position, { ...options, particleScale: fx.particleScale });
      fx.explosions.push(h);
      fx.addShake(h.trauma);
      return h;
    },
    playExplosion(position, options) { return fx.spawnExplosion(position, options); },
    explode(position, options) { return fx.spawnExplosion(position, options); },

    // 1b — Smoke cloud (M-9 SMOKE). Spawns the visual cloud AND registers
    // the gameplay volume (see the registry at the top of this file).
    // Call fx.update(dt) every frame to step it; it expires on its own
    // after SMOKE_DURATION (12 s) and unregisters itself.
    spawnSmoke(position, options = {}) {
      const h = createSmokeCloud(scene, position, options);
      fx.smokes.push(h);
      return h;
    },
    spawnSmokeCloud(position, options) { return fx.spawnSmoke(position, options); },
    detonateSmoke(position, options) { return fx.spawnSmoke(position, options); },
    // Registry queries, also available as module-level imports from fx.js
    // (bots.js uses those — it does not hold the fx instance).
    getSmokeVolumes() { return getSmokeVolumes(); },
    listSmokes() { return getSmokeVolumes(); },
    segmentBlockedBySmoke(a, b) { return segmentBlockedBySmoke(a, b); },
    smokeBlocksLineOfSight(a, b) { return segmentBlockedBySmoke(a, b); },
    isPointInSmoke(p) { return isPointInSmoke(p); },
    clearSmoke() {
      for (const h of fx.smokes) h.dispose();
      fx.smokes.length = 0;
      return fx;
    },

    // 2 — Muzzle flash.
    flashMuzzle(position, direction) { muzzle.flash(position, direction); return muzzle; },
    showMuzzleFlash(position, direction) { return fx.flashMuzzle(position, direction); },
    attachMuzzleFlash(parent, offset) { return muzzle.attachTo(parent, offset); },
    muzzleBurst() { muzzle.burst(); return muzzle; },

    // 2b — Muzzle smoke (sun-smoke r4 §2.6 change 6): a thin warm-grey
    // wisp trailing forward from the muzzle, 2 puffs per shot (1 if
    // `small` = a bot shot at distance), flat — no sustained count, no
    // sustained opacity bump. Lifetime 0.7-1.0 s, long axis 0.12 ->
    // 0.45-0.60 m, aspect 0.45, peak opacity 0.42, quadratic ease-in
    // over the first 8%, linear tail. The two puffs of one shot stay
    // near-parallel by construction (shared base jitter +-0.3 rad +
    // small per-puff jitter +-0.15 rad: max inter-puff angle 0.30 rad
    // ~= 17.2 deg, max deviation from the barrel line 0.45 rad).
    spawnMuzzleSmoke(position, direction, small = false) {
      const pos = toVec3(position, new THREE.Vector3());
      const dir = direction ? toVec3(direction, new THREE.Vector3()).normalize() : new THREE.Vector3(0, 0, -1);
      // Barrel screen angle. Degenerate when the barrel is (near-)parallel
      // to the camera view axis: the muzzle then projects to (nearly) one
      // NDC point and atan2 would read frame-to-frame camera-motion noise,
      // not the barrel. Player muzzle is exactly on-axis by construction
      // (main.js:442-444); a bot firing at the camera is the same case.
      // For an on-axis wisp the dominant screen-visible motion component
      // is lateral drift, so the fallback is a fixed screen-horizontal
      // angle (ang = 0) — defined and stable, never frame noise.
      _camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
      let ang;
      if (Math.abs(dir.dot(_camFwd)) > 0.99) { // barrel within ~8.1 deg of the view axis
        ang = 0; // degenerate: fixed screen-horizontal fallback (see r4 §1/B3b'')
      } else {
        _projA.copy(pos).project(camera);
        _projB.copy(pos).add(dir).project(camera);
        const dx = _projB.x - _projA.x, dy = _projB.y - _projA.y;
        ang = Math.hypot(dx, dy) < 0.01 ? 0 : Math.atan2(dy, dx);
      }
      // Sign convention, stated once and provable: positive
      // SpriteMaterial.rotation is counter-clockwise on screen (vendored
      // three.js sprite vertex shader, standard CCW matrix in view
      // space), matching atan2(dNDC.y, dNDC.x) with NDC y up — the sign
      // is correct as written. There is NO -ang flip anywhere: a sign
      // miss would mirror a correct angle, not fix a wrong one.
      // Shared per-shot jitter + small per-puff jitter (r4 §1/B3b''): the
      // two puffs of one shot stay near-parallel by construction.
      const baseJitter = (Math.random() - 0.5) * 0.6; // +-0.3 rad, shared
      const n = small ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const along = 0.10 + i * 0.10; // puffs 0.10 m apart along the barrel
        _tmpN.set(
          dir.x * 1.2 + (Math.random() - 0.5) * 0.4,
          0.15 + Math.random() * 0.15,
          dir.z * 1.2 + (Math.random() - 0.5) * 0.4);
        firePuff(muzzleSmoke,
          new THREE.Vector3(pos.x + dir.x * along, pos.y + dir.y * along, pos.z + dir.z * along),
          _tmpN, 0.7 + Math.random() * 0.3, 0.12, 0.45 + Math.random() * 0.15, 0.42,
          { aspect: 0.45, drag: 1.2, rise: 0.08, fadePow: 1, fadeIn: 0.08, fadeInPow: 2,
            rotation: ang + baseJitter + (Math.random() - 0.5) * 0.3 });
      }
      return fx;
    },

    // 2c — Bullet impact: a dust puff + a spark + a dark decal mark
    // where the bullet hit. point: world hit point; normal: surface
    // normal (or null — the decal is skipped then); surface: 'wall' |
    // 'target'. The decal lingers ~8 s so a fired lane shows its hits.
    spawnImpact(point, normal, surface = 'wall') {
      const pos = toVec3(point, new THREE.Vector3());
      const nrm = normal ? toVec3(normal, new THREE.Vector3()).normalize() : null;
      const origin = nrm ? pos.clone().addScaledVector(nrm, 0.05) : pos;
      for (let i = 0; i < 3; i++) {
        _tmpN.set(
          (nrm ? nrm.x * 0.8 : 0) + (Math.random() - 0.5) * 1.2,
          (nrm ? nrm.y * 0.8 : 0.4) + Math.random() * 0.6,
          (nrm ? nrm.z * 0.8 : 0) + (Math.random() - 0.5) * 1.2);
        firePuff(impactDust, origin, _tmpN, 0.6 + Math.random() * 0.3, 0.16, 0.5, 0.6);
      }
      _tmpN.set(
        (nrm ? nrm.x : 0) + (Math.random() - 0.5) * 0.8,
        0.5 + Math.random() * 0.5,
        (nrm ? nrm.z : 0) + (Math.random() - 0.5) * 0.8);
      firePuff(impactSparks, origin, _tmpN, 0.18, 0.3, 0.08, 0.95);
      if (nrm) {
        const d = impactDecals[impactDecalIdx % impactDecals.length];
        impactDecalIdx++;
        d.mesh.position.copy(pos).addScaledVector(nrm, 0.03);
        d.mesh.quaternion.setFromUnitVectors(_up, nrm);
        const s = 0.8 + Math.random() * 0.5;
        d.mesh.scale.set(s, s, 1);
        d.life = 0;
        d.active = true;
        d.mesh.visible = true;
        d.mat.opacity = 0.65;
      }
      return fx;
    },

    // 3 — Bot animation.
    attachBotLimbs(bot) { return attachBotLimbs(bot); },
    updateBot(bot, dt, options) { return updateBotAnimation(bot, dt, options); },
    animateBot(bot, dt, options) { return updateBotAnimation(bot, dt, options); },
    botRecoil(bot, strength) { return botRecoil(bot, strength); },
    playBotDeath(bot, options) { return playBotDeath(bot, options); },

    // 4 — Reload.
    startReload(viewmodel, duration) {
      const h = createReloadAnimation(viewmodel, duration);
      if (!h.noop) fx.reloads.push(h);
      return h;
    },
    playReload(viewmodel, duration) { return fx.startReload(viewmodel, duration); },

    // 5 — Scope zoom.
    setScoped(zoomed, fovOverride) { scope.setZoomed(zoomed, fovOverride); return scope; },
    setAimZoom(zoomed, fovOverride) { return fx.setScoped(zoomed, fovOverride); },
    scopeZoomTo(fov) { scope.setTargetFov(fov); return scope; },
    get scoped() { return scope.zoomed; },

    // 6 — Plant / defuse channel.
    startChannel(position, kind = 'plant', options = {}) {
      fx.stopChannel();
      const c = createChannelEffect(scene, position, kind, options);
      fx.channels.push(c);
      fx.channel = c;
      return c;
    },
    startPlantEffect(position, options) { return fx.startChannel(position, 'plant', options); },
    startDefuseEffect(position, options) { return fx.startChannel(position, 'defuse', options); },
    setChannelProgress(f) { if (fx.channel) fx.channel.setProgress(f); return fx.channel; },
    stopChannel() {
      if (fx.channel) { fx.channel.stop(); fx.channel = null; }
      return fx;
    },

    // Screen shake (driven by explosions; also directly usable).
    addShake(amount = 0.5) {
      fx.trauma = clamp(fx.trauma + amount, 0, 1);
      return fx.trauma;
    },
    shake(amount) { return fx.addShake(amount); },
    // Call AFTER the camera transform is set each frame (in render()).
    applyCameraShake(cam = camera) {
      if (fx.trauma <= 0) return;
      const s = fx.trauma * fx.trauma * fx.shakeStrength;
      cam.position.x += (Math.random() - 0.5) * 0.12 * s;
      cam.position.y += (Math.random() - 0.5) * 0.10 * s;
      cam.position.z += (Math.random() - 0.5) * 0.12 * s;
      cam.rotation.z += (Math.random() - 0.5) * 0.02 * s;
      cam.rotation.x += (Math.random() - 0.5) * 0.015 * s;
    },

    getActiveCounts() {
      return {
        explosions: fx.explosions.length,
        reloads: fx.reloads.length,
        channels: fx.channels.length,
        smokes: fx.smokes.length,
        trauma: fx.trauma,
      };
    },
    dispose() {
      for (const h of fx.explosions) h.dispose();
      for (const h of fx.smokes) h.dispose();
      for (const h of fx.reloads) h.cancel();
      for (const c of fx.channels) c.stop();
      for (const p of [...muzzleSmoke, ...impactDust, ...impactSparks]) {
        p.active = false; p.sprite.visible = false; p.mat.opacity = 0;
      }
      for (const d of impactDecals) { d.active = false; d.mesh.visible = false; d.mat.opacity = 0; }
      fx.explosions.length = 0; fx.smokes.length = 0; fx.reloads.length = 0; fx.channels.length = 0;
      fx.channel = null;
      muzzle.dispose();
      fx.trauma = 0;
    },
  };
  return fx;
}

export default createFX;
