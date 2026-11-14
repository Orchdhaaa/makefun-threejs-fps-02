// weapons.js — weapon data, view models and firing state. It never
// raycasts and never applies damage; combat.js does that. Numbers are the
// DESIGN §4.1 table, final.
//   SPARROW P9  pistol  26/78  semi  0.18s  12/36  reload 1.4s
//   HERON AR-4  rifle   33/132 full  0.10s  30/90  reload 1.9s
//   LONGSHOT DMR sniper 95/380 bolt  1.20s   5/15  reload 2.6s
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'SPARROW P9', price: 350, body: 26, headMul: 3,
    interval: 0.18, auto: false, mag: 12, reserve: 36, reload: 1.4,
    spread: 0.008, bloomPerShot: 0.002, bloomMax: 0.016,
    recoilPitch: 0.006, recoilYaw: 0.003, speedMul: 1.0, stat: '26 dmg — 333 RPM — 12/36',
  },
  rifle: {
    id: 'rifle', name: 'HERON AR-4', price: 2900, body: 33, headMul: 4,
    interval: 0.10, auto: true, mag: 30, reserve: 90, reload: 1.9,
    spread: 0.004, bloomPerShot: 0.004, bloomMax: 0.030,
    recoilPitch: 0.011, recoilYaw: 0.004, speedMul: 0.92, stat: '33 dmg — 600 RPM — 30/90',
  },
  sniper: {
    id: 'sniper', name: 'LONGSHOT DMR', price: 4900, body: 95, headMul: 4,
    interval: 1.20, auto: false, mag: 5, reserve: 15, reload: 2.6,
    spread: 0.001, bloomPerShot: 0.001, bloomMax: 0.004,
    recoilPitch: 0.030, recoilYaw: 0.002, speedMul: 0.85, stat: '95 dmg — 50 RPM — 5/15',
  },
};
export const GRENADE_PRICE = 350;

// Stance multipliers on (base spread + bloom). Stopping to aim pays:
// moving is 3.5x worse than standing still; worst case ~30x.
export function stanceMul(moving, crouched, airborne) {
  if (airborne) return 4.0;
  if (crouching(crouched, moving)) return 1.8;
  if (crouched) return 0.7;
  if (moving) return 3.5;
  return 1.0;
}
function crouching(c, m) { return c && m; }

export function spreadFor(weapon, bloom, moving, crouched, airborne) {
  return (weapon.spread + bloom) * stanceMul(moving, crouched, airborne);
}

export function createWeapons(camera) {
  const group = new THREE.Group();
  camera.add(group);
  const metal = new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.35, metalness: 0.2 });
  const grip = new THREE.MeshStandardMaterial({ color: PALETTE.hairline, roughness: 0.85, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.1 });
  const models = {};
  const box = (mat, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };
  // Pistol: 3 boxes. Rifle: 5 boxes. Sniper: 6 boxes. All procedural.
  const pistol = new THREE.Group();
  pistol.add(box(metal, 0.05, 0.07, 0.22, 0, 0, 0));
  pistol.add(box(grip, 0.045, 0.12, 0.06, 0, -0.08, 0.08));
  pistol.add(box(accent, 0.052, 0.015, 0.05, 0, 0.04, -0.09));
  models.pistol = pistol;
  const rifle = new THREE.Group();
  rifle.add(box(metal, 0.06, 0.09, 0.55, 0, 0, 0));
  rifle.add(box(metal, 0.05, 0.05, 0.3, 0, 0.01, -0.35));
  rifle.add(box(grip, 0.05, 0.13, 0.07, 0, -0.09, 0.12));
  rifle.add(box(grip, 0.045, 0.08, 0.1, 0, -0.06, -0.12));
  rifle.add(box(accent, 0.062, 0.02, 0.08, 0, 0.055, -0.15));
  models.rifle = rifle;
  const sniper = new THREE.Group();
  sniper.add(box(metal, 0.055, 0.08, 0.6, 0, 0, 0));
  sniper.add(box(metal, 0.04, 0.04, 0.45, 0, 0.01, -0.5));
  sniper.add(box(metal, 0.05, 0.06, 0.18, 0, 0, -0.28));
  sniper.add(box(grip, 0.05, 0.13, 0.07, 0, -0.09, 0.14));
  sniper.add(box(metal, 0.06, 0.05, 0.22, 0, -0.03, 0.22));
  sniper.add(box(accent, 0.057, 0.02, 0.06, 0, 0.05, -0.2));
  models.sniper = sniper;
  for (const m of Object.values(models)) { m.position.set(0.28, -0.26, -0.5); m.visible = false; group.add(m); }
  // Grenade view model: a small yellow charge.
  const grenade = new THREE.Group();
  grenade.add(box(new THREE.MeshStandardMaterial({ color: PALETTE.bombYellow, roughness: 0.5 }), 0.09, 0.09, 0.09, 0, 0, 0));
  grenade.position.set(0.28, -0.26, -0.5);
  grenade.visible = false;
  group.add(grenade);
  models.grenade = grenade;

  const w = {
    group, models, current: 'pistol', bloom: 0, bloomT: 0,
    cooldown: 0, reloadT: 0, switchT: 0, kick: 0,
    equip(id) {
      w.current = id;
      for (const [k, m] of Object.entries(models)) m.visible = (k === id);
      w.bloom = 0; w.switchT = 0.5;
    },
    // Returns true when a shot may be fired this step.
    canFire() { return w.cooldown <= 0 && w.reloadT <= 0 && w.switchT <= 0; },
    onShot(weapon) {
      w.cooldown = weapon.interval;
      w.bloom = Math.min(weapon.bloomMax, w.bloom + weapon.bloomPerShot);
      w.bloomT = 0;
      w.kick = 1;
    },
    step(dt) {
      w.cooldown = Math.max(0, w.cooldown - dt);
      w.reloadT = Math.max(0, w.reloadT - dt);
      w.switchT = Math.max(0, w.switchT - dt);
      w.bloomT += dt;
      if (w.bloomT > 0.25) w.bloom = Math.max(0, w.bloom - 0.05 * dt);
      w.kick = Math.max(0, w.kick - dt * 6);
    },
  };
  w.equip('pistol');
  return w;
}

// Reload: move reserve into the magazine. Returns [moved, done].
export function startReload(state) {
  const slot = state.player.weapons[state.player.weapon];
  if (!slot || state.player.weapon === 'grenade') return false;
  const def = WEAPONS[state.player.weapon];
  if (slot.mag >= def.mag || slot.reserve <= 0) return false;
  return true;
}
export function finishReload(state) {
  const slot = state.player.weapons[state.player.weapon];
  const def = WEAPONS[state.player.weapon];
  const need = def.mag - slot.mag;
  const moved = Math.min(need, slot.reserve);
  slot.mag += moved; slot.reserve -= moved;
  state.player.mag = slot.mag; state.player.reserve = slot.reserve;
}
