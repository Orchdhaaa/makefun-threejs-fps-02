// player.js — player movement + collision. Axis-separated AABB against the
// world colliders: move X, resolve, move Z, resolve, so the player slides
// along walls instead of sticking. Same collision the bots use.
// Speeds (DESIGN §5.2): walk 5.2, sprint 7.6 (Left Shift), crouch 2.4,
// accel 42, friction 9, gravity 20, jump 6.2. Eye 1.6 m standing, 1.02 m crouched.
import * as THREE from 'three';
import { MAP } from './world.js';

export const EYE_STAND = 1.6;
export const EYE_CROUCH = 1.02;
export const HEIGHT_STAND = 1.72;
export const HEIGHT_CROUCH = 1.12;
const RADIUS = 0.34;
const WALK = 5.2, SPRINT = 7.6, CROUCH_SPEED = 2.4;
const ACCEL = 42, AIR_ACCEL = 9, FRICTION = 9, GRAVITY = 20, JUMP = 6.2;

export function createPlayer(colliders) {
  const p = {
    x: 0, z: 19, y: 0, vx: 0, vz: 0, vy: 0,
    yaw: 0, pitch: 0, crouched: false, sprinting: false, onGround: true,
    colliders,
  };
  return p;
}

// True when the disc (x, z, RADIUS) at this height overlaps a collider.
export function hitsCollider(colliders, x, z, height) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (height >= c.h) continue;
    if (x + RADIUS > c.minX && x - RADIUS < c.maxX &&
        z + RADIUS > c.minZ && z - RADIUS < c.maxZ) return c;
  }
  return null;
}

export function moveAxis(p, dx, dz) {
  const h = p.crouched ? HEIGHT_CROUCH : HEIGHT_STAND;
  let nx = p.x + dx;
  if (!hitsCollider(p.colliders, nx, p.z, h)) p.x = nx;
  let nz = p.z + dz;
  if (!hitsCollider(p.colliders, p.x, nz, h)) p.z = nz;
  // Clamp to the current map's bounds (walls are colliders too, this is
  // a belt). Follows the live MAP binding, so it tracks whichever map
  // createWorld built; on DEPOT 9 this is the old ±31.6 / ±21.6 exactly.
  const b = MAP.bounds;
  p.x = Math.max(b.minX + 0.4, Math.min(b.maxX - 0.4, p.x));
  p.z = Math.max(b.minZ + 0.4, Math.min(b.maxZ - 0.4, p.z));
}

export function playerStep(p, keys, dt, speedMul) {
  const wantCrouch = !!keys.KeyZ; // Z (hold) is the crouch key.
  if (wantCrouch !== p.crouched) {
    if (!wantCrouch) {
      // Stand-up check: no low cover overhead.
      if (hitsCollider(p.colliders, p.x, p.z, HEIGHT_STAND)) { /* stay crouched */ }
      else p.crouched = false;
    } else p.crouched = true;
  }
  // Left Shift sprints (noticeably faster); crouching overrides sprint.
  const sprinting = !!(keys.ShiftLeft || keys.ShiftRight) && !p.crouched;
  p.sprinting = sprinting;
  const base = p.crouched ? CROUCH_SPEED : sprinting ? SPRINT : WALK;
  const speed = base * (speedMul || 1);
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let fx = 0, fz = 0;
  if (keys.KeyW) { fx -= sin; fz -= cos; }
  if (keys.KeyS) { fx += sin; fz += cos; }
  if (keys.KeyA) { fx -= cos; fz += sin; }
  if (keys.KeyD) { fx += cos; fz -= sin; }
  const len = Math.hypot(fx, fz);
  if (len > 0) { fx /= len; fz /= len; }
  const accel = p.onGround ? ACCEL : AIR_ACCEL;
  // Steer velocity toward the desired velocity at `accel` m/s^2.
  const wantX = fx * speed, wantZ = fz * speed;
  const dvx = wantX - p.vx, dvz = wantZ - p.vz;
  const dlen = Math.hypot(dvx, dvz);
  const step = accel * dt;
  if (dlen > 0) {
    const s = Math.min(1, step / dlen);
    p.vx += dvx * s; p.vz += dvz * s;
  }
  moveAxis(p, p.vx * dt, p.vz * dt);
  // Gravity + jump.
  if (keys.Space && p.onGround && !p.crouched) { p.vy = JUMP; p.onGround = false; }
  p.vy -= GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }
  return Math.hypot(p.vx, p.vz);
}

export function eyeHeight(p) { return p.crouched ? EYE_CROUCH : EYE_STAND; }

// Scratch camera basis, reused (no per-frame allocation in hot loops).
const _fwd = new THREE.Vector3();
export function cameraForward(yaw, pitch, out) {
  out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  return out;
}
export { _fwd };
