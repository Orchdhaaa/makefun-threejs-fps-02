// weapons.js — weapon data, view models and firing state. It never
// raycasts and never applies damage; combat.js does that. Numbers are the
// DESIGN §4.1 table, final.
//   SPARROW P9  pistol  26/78  semi  0.18s  12/36  reload 1.4s  v=200 m/s
//   HERON AR-4  rifle   33/132 full  0.10s  30/90  reload 1.9s  v=320 m/s
//   LONGSHOT DMR sniper 100/400 bolt  1.20s   5/15  reload 2.6s  v=450 m/s
//   TALON K-1   knife   50      melee 0.55s  —      range 2.0 m
//   M-7 FRAG    frag    120     throw fuse 1.8s   6 m blast
//   M-9 SMOKE   smoke   —       throw fuse 1.6s   12 s cloud, r 3.2 m
//
// 5-SLOT LOADOUT (slots, in order): 1 pistol, 2 primary (rifle/sniper/smg —
// buying one fills slot 2; key 2 cycles through the owned primaries),
// 3 knife (free, always owned), 4 frag, 5 smoke. Slot helpers
// (ensureLoadout, slotOfWeapon, weaponForSlot, nextSlot, ...) are pure
// functions over state.player.weapons; the coordinator wires them into
// main.js / rounds.js / state.js — see WIRING at the bottom of this file.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { SMG_DEF, SHOP_SKINS, SKIN_FAMILIES_LIST, getEquippedSkin } from './shop.js';
import { skinTexture } from './skins.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'SPARROW P9', price: 350, body: 26, headMul: 3,
    interval: 0.18, auto: false, mag: 12, reserve: 36, reload: 1.4,
    velocity: 200,
    spread: 0.008, bloomPerShot: 0.002, bloomMax: 0.016,
    recoilPitch: 0.006, recoilYaw: 0.003, speedMul: 1.0, stat: '26 dmg — 333 RPM — 12/36',
  },
  rifle: {
    id: 'rifle', name: 'HERON AR-4', price: 2900, body: 33, headMul: 4,
    interval: 0.10, auto: true, mag: 30, reserve: 90, reload: 1.9,
    velocity: 320,
    spread: 0.004, bloomPerShot: 0.004, bloomMax: 0.030,
    recoilPitch: 0.011, recoilYaw: 0.004, speedMul: 0.92, stat: '33 dmg — 600 RPM — 30/90',
  },
  sniper: {
    id: 'sniper', name: 'LONGSHOT DMR', price: 4900, body: 100, headMul: 4,
    interval: 1.20, auto: false, mag: 5, reserve: 15, reload: 2.6,
    velocity: 450,
    spread: 0.001, bloomPerShot: 0.001, bloomMax: 0.004,
    recoilPitch: 0.030, recoilYaw: 0.002, speedMul: 0.85, stat: '100 dmg — 50 RPM — 5/15',
  },
  // VIPER SMG-9: shop-unlocked primary (def in shop.js, viewmodel below).
  // Same shape as the other WEAPONS entries, so combat / buy / refill
  // all treat it generically; key 2 cycles rifle -> sniper -> smg when owned.
  smg: { ...SMG_DEF },
  // Knife lives in WEAPONS (not just as a slot entry) so combat.damage()
  // resolves the killfeed name ('TALON K-1') and main.js render() can read
  // def.name / def.speedMul for it exactly like a gun. It has no magazine
  // (mag 0 / reserve 0, reload 0) and startReload() refuses it explicitly.
  // headMul 1: no headshot bonus for a melee swing.
  knife: {
    id: 'knife', name: 'TALON K-1', price: 0, body: 50, headMul: 1,
    interval: 0.55, auto: false, mag: 0, reserve: 0, reload: 0,
    spread: 0, bloomPerShot: 0, bloomMax: 0,
    recoilPitch: 0, recoilYaw: 0, speedMul: 1.05, stat: '50 dmg — melee — 2.0 m range',
  },
};
export const GRENADE_PRICE = 350;
// Ballistic gravity (R4 §2.1): ONE gravity for the whole world, g = 20.
// The formula is real (drop = 1/2*g*t^2) but the constants are arcade
// compression, tuned so drop is a gameplay factor on 44-80 m maps: g = 20
// is 2.04x Earth gravity and the rifle velocity 320 m/s is 0.36x a real
// 5.56 mm load. No comment in this codebase may claim Earth physics.
// Grenades already fell at g = 20; bullets now share the constant so the
// two systems cannot silently drift apart (code consistency, not a
// player-intuition claim — a 14 m/s lob and a 320 m/s bullet are never
// experienced side by side).
export const BALLISTIC_GRAVITY = 20;
// Smoke is cheaper than the frag and affordable on the $950 start:
// $200 leaves $750 after one smoke (or $400 after frag + smoke).
export const SMOKE_PRICE = 200;
export const KNIFE_PRICE = 0;
// Knife tuning. 50 dmg = 2 swings to kill a 100 HP bot. Range 2.0 m to
// the bot's chest, plus a 0.4 m body-radius allowance in knifeHitTest().
export const KNIFE_RANGE = 2.0;
export const KNIFE_DAMAGE = 50;
export const KNIFE_INTERVAL = 0.55; // s between swings (WEAPONS.knife.interval)
// Sound-hook names. The coordinator adds these methods to audio.js
// (procedural, same pattern as shot()/explosion()); weapons.js only
// NAMES them, it never plays audio. 'knifeSwing' = the swing whoosh,
// played on every swing start. Hit feedback uses the existing 'hit'
// event (audio.hit() + hitmarker + damage number) — no separate hit sound.
export const KNIFE_SWING_SOUND = 'knifeSwing';
export const SMOKE_SOUND = 'smoke'; // soft pop + hiss on detonation

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

// ---------------------------------------------------------------- 5-slot loadout
// Slot ids are the weapon ids except slot 2, which is the virtual id
// 'primary' (rifle or sniper — whichever the player owns; both owned =
// key 2 toggles). state.player.weapons entries:
//   pistol/rifle/sniper: { owned, mag, reserve }
//   knife:               { owned: true }            (free, always owned)
//   grenade:             { owned, count }           (frag, 1 max per round)
//   smoke:               { owned, count }           (smoke, 1 max per round)
// state.js (coordinator-owned) does not create knife/smoke yet, so every
// helper below tolerates missing entries — call ensureLoadout(state) once
// at boot and it fills them in. Helpers never mutate anything except
// ensureLoadout / togglePrimary / loadoutBuy, as noted on each.
export const SLOT_ORDER = ['pistol', 'primary', 'knife', 'grenade', 'smoke'];
export const SLOTS = [
  { slot: 1, id: 'pistol', key: '1', name: 'SPARROW P9', price: 350, kind: 'gun' },
  { slot: 2, id: 'primary', key: '2', name: 'PRIMARY', price: null, kind: 'primary' },
  { slot: 3, id: 'knife', key: '3', name: 'TALON K-1', price: 0, kind: 'melee' },
  { slot: 4, id: 'grenade', key: '4', name: 'M-7 FRAG', price: GRENADE_PRICE, kind: 'throwable' },
  { slot: 5, id: 'smoke', key: '5', name: 'M-9 SMOKE', price: SMOKE_PRICE, kind: 'throwable' },
];
export const PRIMARY_IDS = ['rifle', 'sniper', 'smg'];

// Fill in the loadout entries state.js does not create yet. Idempotent
// and non-destructive: never resets counts or ownership, only adds what
// is missing. Returns state.player.weapons.
export function ensureLoadout(state) {
  const w = state.player.weapons;
  if (!w.knife) w.knife = { owned: true };
  else w.knife.owned = true; // the knife can never be lost or sold
  if (!w.smoke) w.smoke = { owned: false, count: 0 };
  if (w.smoke.count === undefined) w.smoke.count = 0;
  if (!w.grenade) w.grenade = { owned: false, count: 0 };
  if (w.grenade.count === undefined) w.grenade.count = 0;
  return w;
}

// Slot number (1-5) for a concrete weapon id. 'primary' is not a weapon.
export function slotOfWeapon(weaponId) {
  if (weaponId === 'pistol') return 1;
  if (weaponId === 'rifle' || weaponId === 'sniper' || weaponId === 'smg') return 2;
  if (weaponId === 'knife') return 3;
  if (weaponId === 'grenade') return 4;
  if (weaponId === 'smoke') return 5;
  return 0;
}

// Display name for a weapon id, including the two throwables (which are
// not in WEAPONS). Used for the weapon popup and the HUD ammo label.
export function displayNameForWeapon(weaponId) {
  if (weaponId === 'grenade') return 'M-7 FRAG';
  if (weaponId === 'smoke') return 'M-9 SMOKE';
  const def = WEAPONS[weaponId];
  return def ? def.name : String(weaponId || '').toUpperCase();
}

// Which primaries the player owns, in buy-menu order.
export function ownedPrimaries(state) {
  const w = state.player.weapons;
  return PRIMARY_IDS.filter((id) => w[id] && w[id].owned);
}

// The weapon a match spawns the player with, from the lobby loadout
// pick (state.player.loadoutPrimary) ONLY — never from the live
// state.player.primary, which is reset at every round start.
// 'none' -> pistol; an owned pick -> the pick; anything else ->
// the first owned primary, else pistol.
export function spawnWeaponFor(state) {
  const lp = state.player.loadoutPrimary;
  const owned = ownedPrimaries(state);
  if (lp === 'none') return 'pistol';
  if (typeof lp === 'string' && owned.includes(lp)) return lp;
  return owned[0] || 'pistol';
}

// The list key 2 / the wheel cycles through, by mode. In Bomb it is
// every owned primary (the in-match buy menu can add to it); in every
// other mode the spawn weapon is the ONLY primary — the loadout is
// fixed for the match.
export function primaryCycleList(state) {
  if (state.mode === 'bomb') return ownedPrimaries(state);
  const spawn = spawnWeaponFor(state);
  return PRIMARY_IDS.includes(spawn) ? [spawn] : [];
}

// The concrete weapon id slot 2 currently means: the player's stored
// preference (state.player.primary) when it is in the cycle list, else
// the first weapon in the cycle list, else null. 'none' is a spawn-only
// pick in Bomb: it empties slot 2 until a primary is bought in-match
// (togglePrimary / buyItem then fill it); in non-buy modes the cycle
// list holds the spawn weapon only, so 'none' empties slot 2 outright.
// Never mutates.
export function primaryForSlot(state) {
  const lp = state.player.loadoutPrimary;
  const list = primaryCycleList(state);
  if (lp === 'none' && !list.includes(state.player.primary)) return null;
  if (list.includes(state.player.primary)) return state.player.primary;
  return list[0] || null;
}

// Pressing key 2: with no primary in the cycle list it does nothing;
// otherwise it selects the current slot-2 weapon when you are not
// holding it, and advances to the next one when you are. From a null
// slot 2 (loadout 'none', nothing bought yet) the first press selects
// the first owned primary. Stores the choice on state.player.primary.
// Returns the weapon id to equip, or null.
export function togglePrimary(state) {
  const list = primaryCycleList(state);
  if (list.length === 0) return null;
  const cur = primaryForSlot(state);
  if (cur === null) { state.player.primary = list[0]; return list[0]; }
  if (state.player.weapon !== cur) { state.player.primary = cur; return cur; }
  const idx = list.indexOf(cur);
  const next = list[(idx + 1) % list.length];
  state.player.primary = next;
  return next;
}

// Concrete weapon id for a slot number (1-5), or null when the slot is
// empty / unavailable. Slot 2 resolves through primaryForSlot(), with
// a wheel-only fallback: when the pick is NONE the wheel still lands on
// the first owned primary instead of an empty slot (key 2, the HUD and
// the post-throw re-equip use primaryForSlot directly and do NOT get
// this fallback).
export function weaponForSlot(state, slot) {
  if (slot === 1) return 'pistol';
  if (slot === 2) {
    const p = primaryForSlot(state);
    if (p !== null) return p;
    const list = primaryCycleList(state);
    return list[0] || null;
  }
  if (slot === 3) return 'knife';
  if (slot === 4) return (state.player.weapons.grenade && state.player.weapons.grenade.count > 0) ? 'grenade' : null;
  if (slot === 5) return (state.player.weapons.smoke && state.player.weapons.smoke.count > 0) ? 'smoke' : null;
  return null;
}

// True when a slot can be selected right now (wheel cycling and key
// presses both use this — an empty consumable slot is skipped).
export function isSlotAvailable(state, slot) {
  return weaponForSlot(state, slot) !== null;
}

// Next/previous available slot from `fromSlot`, wrapping 1..5. Returns
// the slot number, or fromSlot unchanged when nothing else is available
// (knife + pistol are always available, so this only happens in theory).
export function nextSlot(state, fromSlot, dir = 1) {
  let s = fromSlot;
  for (let n = 0; n < SLOT_ORDER.length; n++) {
    s = ((s - 1 + dir + SLOT_ORDER.length) % SLOT_ORDER.length) + 1;
    if (isSlotAvailable(state, s)) return s;
  }
  return fromSlot;
}
export const prevSlot = (state, fromSlot) => nextSlot(state, fromSlot, -1);

// All currently available slot numbers, in order.
export function availableSlots(state) {
  return SLOT_ORDER.map((_, i) => i + 1).filter((s) => isSlotAvailable(state, s));
}

// Price to buy one more of a buy-menu item: 'pistol' | 'rifle' |
// 'sniper' | 'grenade' | 'smoke'. The knife costs $0 and is already
// owned, so it has no buy price (null).
export function buyPrice(itemId) {
  if (itemId === 'knife') return null;
  if (itemId === 'smoke') return SMOKE_PRICE;
  if (itemId === 'grenade') return GRENADE_PRICE;
  const def = WEAPONS[itemId];
  return def ? def.price : null;
}

// Buy one smoke grenade (the only loadout purchase owned by this file —
// guns and frag stay in rounds.js buyItem, which calls this for 'smoke').
// 1 max per round, like the frag. Returns true on a completed purchase.
export function loadoutBuySmoke(state) {
  const p = state.player;
  ensureLoadout(state);
  if (p.weapons.smoke.count >= 1 || state.money < SMOKE_PRICE) return false;
  state.money -= SMOKE_PRICE;
  p.weapons.smoke.count = 1;
  p.weapons.smoke.owned = true;
  return true;
}

// --- SMG viewmodel + shop skins (moved here from shop.js) --------------
// shop.js is pure data + state (three-free) so the lobby can import it
// without pulling the 3D engine; the three-dependent builders live here,
// next to the other viewmodels. SMG_DEF / SHOP_SKINS are data imports
// only — they carry no three.js dependency.

// Same parts style as the viewmodels in createWeapons() below:
// shared-material boxes + z-axis tubes, base pose (0.28, -0.26, -0.5),
// hidden until equipped. Compact SMG read: short receiver, suppressor,
// vertical foregrip, long curved mag.
export function buildSmgViewmodel() {
  const metal = new THREE.MeshStandardMaterial({ color: PALETTE.gunmetal, roughness: 0.5, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: PALETTE.gunmetalLight, roughness: 0.4, metalness: 0.45 });
  const grip = new THREE.MeshStandardMaterial({ color: PALETTE.gunPolymer, roughness: 0.9, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.1 });
  const brass = new THREE.MeshStandardMaterial({ color: PALETTE.brass, roughness: 0.35, metalness: 0.7 });
  const smg = new THREE.Group();
  const box = (mat, w, h, d, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    if (rz) m.rotation.z = rz;
    return m;
  };
  const tube = (mat, r, len, x, y, z, seg = 10) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  };
  smg.add(box(metal, 0.06, 0.09, 0.30, 0, 0, 0.02));              // receiver
  smg.add(box(steel, 0.028, 0.012, 0.40, 0, 0.051, -0.06));       // top rail
  smg.add(box(metal, 0.055, 0.065, 0.16, 0, 0.005, -0.20));       // handguard
  smg.add(tube(steel, 0.018, 0.16, 0, 0.01, -0.34));              // short barrel
  smg.add(tube(metal, 0.030, 0.14, 0, 0.01, -0.48));              // suppressor
  smg.add(box(metal, 0.058, 0.012, 0.02, 0, 0.01, -0.44));        // suppressor ring
  smg.add(box(metal, 0.048, 0.17, 0.085, 0, -0.115, 0.02, -0.22)); // long curved mag
  smg.add(box(brass, 0.05, 0.02, 0.085, 0, -0.04, 0.0, -0.22));   // mag top / feed
  smg.add(box(grip, 0.05, 0.11, 0.065, 0, -0.095, 0.15, 0.3));    // pistol grip
  smg.add(box(metal, 0.055, 0.08, 0.16, 0, -0.005, 0.25));        // stock
  smg.add(box(grip, 0.06, 0.10, 0.022, 0, -0.005, 0.335));        // butt plate
  smg.add(box(grip, 0.04, 0.10, 0.055, 0, -0.085, -0.20, 0.12));  // vertical foregrip
  smg.add(box(metal, 0.01, 0.04, 0.01, 0, 0.072, -0.26));         // front sight post
  smg.add(box(metal, 0.045, 0.025, 0.02, 0, 0.062, 0.13));        // rear sight
  smg.add(box(accent, 0.062, 0.012, 0.18, 0, 0.02, 0.02));        // receiver accent stripe
  smg.add(box(grip, 0.018, 0.028, 0.05, 0.038, 0.01, 0.08));      // charging handle
  smg.position.set(0.28, -0.26, -0.5);
  smg.visible = false;
  return smg;
}

// --- Skins: applying them ------------------------------------------------
// Viewmodel materials are SHARED across guns in createWeapons() (one
// `metal` material serves pistol, rifle and sniper), so recolouring the
// material would recolour every gun. applySkin therefore clones each
// mesh's material the first time a skin touches that weapon (the
// original hex, roughness and metalness are kept in mesh.userData
// _shopOrig / _shopOrigRough / _shopOrigMetal so 'default' restores
// them exactly), then recolours by ROLE, matched from the original hex:
//   PALETTE.gunmetal (0x2f333a)      -> body
//   PALETTE.gunmetalLight (0x5d636d) -> steel
//   PALETTE.gunPolymer (0x17181b)    -> grip
//   PALETTE.accent (0xf0a830)        -> accent
//   PALETTE.brass (0xc9a227)         -> brass (left as-is: brass stays brass)
//   PALETTE.scopeGlass               -> glass (left as-is: lenses stay lenses)
// A skin is a TEXTURE, not a flat recolour: body/steel/grip get the
// family's procedural CanvasTexture (skins.js, one pattern per family)
// and a WHITE colour, because a texture is multiplied by the material
// colour (map x colour) — any non-white colour would tint the whole
// pattern. The accent stripe stays flat (recolour only, no map).
// The knife blade is not in ROLE_BY_HEX, so it always stays factory
// steel. `models` is the `models` object returned by createWeapons()
// (keys: pistol, rifle, sniper, smg, knife, grenade, smoke).
// Returns true when a skin (or the factory finish) was applied, false
// when the weapon/skin does not exist. Skins are cosmetic only: no stat
// in any skin definition is ever read by the game.
const ROLE_BY_HEX = new Map([
  [PALETTE.gunmetal, 'body'],
  [PALETTE.gunmetalLight, 'steel'],
  [PALETTE.gunPolymer, 'grip'],
  [PALETTE.accent, 'accent'],
]);

export function applySkin(weaponId, skinId, models) {
  if (!models || !models[weaponId]) return false;
  const group = models[weaponId];
  let skin = null;
  if (skinId && skinId !== 'default') {
    skin = (SHOP_SKINS[weaponId] || []).find((s) => s.id === skinId) || null;
    if (!skin) return false;
  }
  let touched = false;
  group.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.material || !mesh.material.color) return;
    if (!mesh.userData._shopCloned) {
      mesh.material = mesh.material.clone();
      mesh.userData._shopOrig = mesh.material.color.getHex();
      mesh.userData._shopOrigRough = mesh.material.roughness;
      mesh.userData._shopOrigMetal = mesh.material.metalness;
      mesh.userData._shopCloned = true;
    }
    const role = ROLE_BY_HEX.get(mesh.userData._shopOrig);
    if (!role) return; // brass, glass, knife blade: never recoloured
    if (!skin) {
      // Factory finish: no texture, original colour and finish.
      mesh.material.map = null;
      mesh.material.color.setHex(mesh.userData._shopOrig);
      mesh.material.roughness = mesh.userData._shopOrigRough;
      mesh.material.metalness = mesh.userData._shopOrigMetal;
      mesh.material.needsUpdate = true;
      touched = true;
      return;
    }
    if (role === 'accent') {
      // Accent stays flat: recolour only, no texture.
      mesh.material.map = null;
      mesh.material.color.setHex(skin.colors.accent);
      mesh.material.roughness = mesh.userData._shopOrigRough;
      mesh.material.metalness = mesh.userData._shopOrigMetal;
      mesh.material.needsUpdate = true;
      touched = true;
      return;
    }
    // Textured roles: family texture + white colour (map x colour),
    // plus the family's finish (roughness / metalness) when defined.
    mesh.material.map = skinTexture(skin.id, role, skin.colors);
    mesh.material.color.setHex(0xffffff);
    const fin = skin.finish;
    if (fin) {
      if (typeof fin.roughness === 'number') mesh.material.roughness = fin.roughness;
      if (typeof fin.metalness === 'number') mesh.material.metalness = fin.metalness;
    }
    mesh.material.needsUpdate = true;
    touched = true;
  });
  return touched;
}

// Re-apply every equipped skin to a models object (boot + after any
// viewmodel rebuild). Safe to call when nothing is equipped: 'default'
// restores factory colours.
export function applyEquippedSkins(models) {
  let ok = true;
  for (const wid of Object.keys(SHOP_SKINS)) {
    const eq = getEquippedSkin(wid);
    if (models && models[wid]) ok = applySkin(wid, eq, models) && ok;
  }
  return ok;
}

export function createWeapons(camera) {
  const group = new THREE.Group();
  camera.add(group);
  const metal = new THREE.MeshStandardMaterial({ color: PALETTE.gunmetal, roughness: 0.5, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: PALETTE.gunmetalLight, roughness: 0.4, metalness: 0.45 });
  // Small warm light on the camera so the viewmodel never reads as a
  // black silhouette when its lit faces point away from the sun.
  // 2.2 (was 0.9): at 0.9 the rifle still rendered as a near-black blob
  // against the dark ground in every screenshot.
  const vmLight = new THREE.PointLight(0xffe0b3, 2.2, 3, 2);
  vmLight.position.set(0, 0.25, 0.1);
  camera.add(vmLight);
  // Cool rim light from the front-left: it catches the barrel/receiver
  // edges so the gun reads as a 3D object, not a flat dark cutout.
  const vmRim = new THREE.PointLight(0xbfd4ff, 1.1, 2.5, 2);
  vmRim.position.set(-0.35, 0.1, -0.3);
  camera.add(vmRim);
  const grip = new THREE.MeshStandardMaterial({ color: PALETTE.gunPolymer, roughness: 0.9, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.1 });
  const brass = new THREE.MeshStandardMaterial({ color: PALETTE.brass, roughness: 0.35, metalness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: PALETTE.scopeGlass, roughness: 0.15, metalness: 0.6 });
  const models = {};
  const box = (mat, w, h, d, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    if (rz) m.rotation.z = rz;
    return m;
  };
  // Cylinder along z (barrels, scopes, muzzle devices).
  const tube = (mat, r, len, x, y, z, seg = 10) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  };
  // --- SPARROW P9 pistol: slide + barrel, frame, trigger guard, angled
  // grip with base plate, front/rear sights, slide serrations. ---
  const pistol = new THREE.Group();
  pistol.add(box(metal, 0.055, 0.06, 0.24, 0, 0.012, 0));            // slide
  pistol.add(box(steel, 0.02, 0.014, 0.20, 0, 0.048, -0.01));        // slide top rib
  pistol.add(tube(steel, 0.016, 0.03, 0, 0.012, -0.13));             // muzzle
  pistol.add(box(metal, 0.05, 0.045, 0.22, 0, -0.032, 0.005));       // frame
  pistol.add(box(accent, 0.052, 0.008, 0.10, 0, 0.012, -0.06));      // slide accent stripe
  pistol.add(box(metal, 0.008, 0.02, 0.008, 0, 0.052, -0.105));      // front sight
  pistol.add(box(metal, 0.042, 0.018, 0.012, 0, 0.052, 0.10));       // rear sight
  pistol.add(box(grip, 0.05, 0.13, 0.07, 0, -0.10, 0.095, 0.28));    // grip, raked back
  pistol.add(box(metal, 0.056, 0.016, 0.08, 0, -0.165, 0.115, 0.28));// mag base plate
  pistol.add(box(metal, 0.012, 0.012, 0.09, 0, -0.068, -0.02));      // trigger-guard bottom
  pistol.add(box(metal, 0.012, 0.045, 0.012, 0, -0.048, -0.062));    // trigger-guard front
  pistol.add(box(steel, 0.01, 0.035, 0.012, 0, -0.05, -0.005, 0.15));// trigger
  for (const z of [0.055, 0.075, 0.095]) {                            // slide serrations
    pistol.add(box(grip, 0.057, 0.012, 0.008, 0, 0.02, z));
  }
  pistol.add(box(metal, 0.052, 0.008, 0.14, 0, -0.058, -0.02));       // frame rail
  pistol.add(box(metal, 0.012, 0.03, 0.012, 0, 0.055, 0.115, -0.3));  // hammer
  pistol.add(box(metal, 0.03, 0.028, 0.045, 0, 0.058, 0.055));        // red-dot sight body
  const pdot = new THREE.Mesh(new THREE.CircleGeometry(0.009, 10), glass);
  pdot.position.set(0, 0.058, 0.078);                                  // red-dot glass
  pistol.add(pdot);
  models.pistol = pistol;
  // --- HERON AR-4 rifle: receiver, railed handguard, barrel + muzzle
  // brake, curved magazine, pistol grip, stock, foregrip, iron sights. ---
  const rifle = new THREE.Group();
  rifle.add(box(metal, 0.065, 0.10, 0.34, 0, 0, 0.02));              // receiver
  rifle.add(box(steel, 0.03, 0.012, 0.52, 0, 0.056, -0.10));         // top rail
  rifle.add(box(metal, 0.06, 0.075, 0.30, 0, 0.005, -0.28));         // handguard
  for (const z of [-0.18, -0.24, -0.30, -0.36]) {                     // handguard vents
    rifle.add(box(grip, 0.062, 0.02, 0.02, 0, 0.03, z));
  }
  rifle.add(tube(steel, 0.02, 0.28, 0, 0.01, -0.56));                // barrel
  rifle.add(tube(metal, 0.028, 0.07, 0, 0.01, -0.72));               // muzzle brake
  rifle.add(box(metal, 0.058, 0.012, 0.02, 0, 0.01, -0.70));         // brake ring
  rifle.add(box(metal, 0.05, 0.16, 0.09, 0, -0.12, 0.04, -0.28));    // magazine, curved
  rifle.add(box(brass, 0.052, 0.02, 0.09, 0, -0.045, 0.02, -0.28));  // mag top / feed
  rifle.add(box(grip, 0.05, 0.12, 0.07, 0, -0.10, 0.16, 0.3));       // pistol grip
  rifle.add(box(metal, 0.06, 0.09, 0.20, 0, -0.01, 0.28));           // stock
  rifle.add(box(grip, 0.065, 0.12, 0.025, 0, -0.01, 0.385));         // butt plate
  rifle.add(box(grip, 0.045, 0.09, 0.06, 0, -0.085, -0.30, 0.15));   // foregrip
  rifle.add(box(grip, 0.035, 0.04, 0.10, 0, -0.045, -0.44));          // laser module under handguard
  rifle.add(box(new THREE.MeshStandardMaterial({ color: 0xff2a22, roughness: 0.4, emissive: 0x881108 }),
    0.012, 0.012, 0.012, 0, -0.045, -0.495));                          // laser lens
  rifle.add(box(metal, 0.01, 0.045, 0.01, 0, 0.08, -0.40));          // front sight post
  rifle.add(box(metal, 0.05, 0.012, 0.03, 0, 0.062, -0.40));         // front sight wings
  rifle.add(box(metal, 0.05, 0.03, 0.02, 0, 0.068, 0.15));           // rear sight
  rifle.add(box(accent, 0.067, 0.012, 0.20, 0, 0.02, 0.02));         // receiver accent stripe
  rifle.add(box(grip, 0.02, 0.03, 0.06, 0.04, 0.01, 0.10));          // charging handle
  rifle.add(box(metal, 0.035, 0.035, 0.06, 0, 0.085, -0.02));         // red-dot sight body
  const rdot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 10), glass);
  rdot.position.set(0, 0.085, 0.012);                                 // red-dot glass
  rifle.add(rdot);
  rifle.add(box(grip, 0.067, 0.03, 0.10, 0, 0.0, 0.06));              // ejection port
  rifle.add(box(grip, 0.062, 0.03, 0.12, 0, -0.01, -0.28));           // handguard rail cover
  models.rifle = rifle;
  models.smg = buildSmgViewmodel(); // VIPER SMG-9 (defined above) — the positioning loop below covers it.
  // --- LONGSHOT DMR sniper: long barrel, big scope, bolt handle, cheek
  // riser, folded bipod legs along the handguard. ---
  const sniper = new THREE.Group();
  sniper.add(box(metal, 0.06, 0.09, 0.42, 0, 0, 0.02));              // receiver
  sniper.add(box(metal, 0.055, 0.065, 0.30, 0, 0.005, -0.32));       // handguard
  sniper.add(tube(steel, 0.022, 0.50, 0, 0.01, -0.70));              // long barrel
  sniper.add(tube(metal, 0.032, 0.08, 0, 0.01, -0.97));              // muzzle brake
  sniper.add(box(metal, 0.05, 0.12, 0.10, 0, -0.10, 0.02, -0.2));    // magazine
  sniper.add(box(grip, 0.05, 0.12, 0.07, 0, -0.10, 0.16, 0.3));      // pistol grip
  sniper.add(box(metal, 0.06, 0.08, 0.22, 0, -0.01, 0.30));          // stock
  sniper.add(box(grip, 0.06, 0.05, 0.22, 0, 0.045, 0.30));           // cheek riser
  sniper.add(box(grip, 0.065, 0.13, 0.025, 0, -0.01, 0.415));        // butt plate
  sniper.add(tube(metal, 0.03, 0.24, 0, 0.095, -0.02));              // scope tube
  sniper.add(tube(metal, 0.046, 0.07, 0, 0.095, -0.16));             // objective bell
  sniper.add(tube(metal, 0.036, 0.05, 0, 0.095, 0.12));              // eyepiece
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.038, 12), glass);
  lens.position.set(0, 0.095, -0.196); lens.rotation.y = Math.PI;
  sniper.add(lens);
  sniper.add(box(metal, 0.02, 0.05, 0.03, 0, 0.062, -0.08));         // scope mount
  sniper.add(box(metal, 0.02, 0.05, 0.03, 0, 0.062, 0.04));          // scope mount
  const bolt = tube(steel, 0.011, 0.09, 0.055, 0.02, 0.12);          // bolt handle
  bolt.rotation.set(0, 0, Math.PI / 2);
  sniper.add(bolt);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), grip);
  knob.position.set(0.10, 0.02, 0.12);
  sniper.add(knob);
  sniper.add(box(metal, 0.016, 0.016, 0.30, -0.04, -0.055, -0.32, 0, 0.12)); // bipod leg L
  sniper.add(box(metal, 0.016, 0.016, 0.30, 0.04, -0.055, -0.32, 0, -0.12)); // bipod leg R
  sniper.add(box(accent, 0.062, 0.01, 0.16, 0, 0.02, 0.02));         // receiver accent
  sniper.add(tube(metal, 0.052, 0.09, 0, 0.095, -0.24));               // scope sunshade
  sniper.add(box(metal, 0.03, 0.03, 0.03, 0, 0.14, -0.02));           // elevation turret
  sniper.add(box(metal, 0.03, 0.03, 0.03, 0.045, 0.095, -0.02));      // windage turret
  models.sniper = sniper;
  for (const m of Object.values(models)) { m.position.set(0.28, -0.26, -0.5); m.visible = false; group.add(m); }
  // Grenade view model: a proper frag — ribbed yellow body, dark band,
  // top fuse, lever and pin ring.
  const grenade = new THREE.Group();
  const gBody = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.09, 12),
    new THREE.MeshStandardMaterial({ color: PALETTE.bombYellow, roughness: 0.5 }));
  grenade.add(gBody);
  const gBand = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.02, 12),
    new THREE.MeshStandardMaterial({ color: PALETTE.gunPolymer, roughness: 0.8 }));
  gBand.position.y = 0.01;
  grenade.add(gBand);
  const gTop = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: PALETTE.gunmetal, roughness: 0.4, metalness: 0.5 }));
  gTop.position.y = 0.045;
  grenade.add(gTop);
  grenade.add(box(new THREE.MeshStandardMaterial({ color: PALETTE.gunmetal, roughness: 0.4, metalness: 0.5 }),
    0.016, 0.09, 0.02, 0.05, 0.02, 0)); // lever
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.005, 6, 14), steel);
  ring.position.set(-0.055, 0.07, 0);
  ring.rotation.y = Math.PI / 2;
  grenade.add(ring);
  grenade.position.set(0.28, -0.26, -0.5);
  grenade.visible = false;
  group.add(grenade);
  models.grenade = grenade;
  // --- TALON K-1 knife: flat steel blade with a clipped tip, dark guard,
  // polymer handle with a pommel. Held blade-forward, slightly angled, so
  // the swing reads as a diagonal slash. Base pose matches the guns.
  const knife = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.22, metalness: 0.85 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.010, 0.22), bladeMat);
  blade.position.set(0, 0.01, -0.16);
  knife.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.08, 4), bladeMat);
  tip.rotation.x = -Math.PI / 2;
  tip.rotation.y = Math.PI / 4;
  tip.scale.set(1.4, 1, 0.32);
  tip.position.set(0, 0.01, -0.31);
  knife.add(tip);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.047, 0.003, 0.20),
    new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.15, metalness: 0.9 }));
  edge.position.set(0, 0.004, -0.15);
  knife.add(edge);
  knife.add(box(grip, 0.055, 0.014, 0.03, 0, 0.01, -0.03));          // guard
  knife.add(box(grip, 0.038, 0.028, 0.11, 0, 0.005, 0.045, -0.12));  // handle, raked
  knife.add(box(steel, 0.04, 0.02, 0.02, 0, 0.0, 0.105, -0.12));     // pommel
  knife.add(box(accent, 0.04, 0.006, 0.05, 0, 0.012, 0.02));         // handle accent
  knife.position.set(0.28, -0.26, -0.5);
  knife.rotation.y = 0.15;
  knife.visible = false;
  group.add(knife);
  models.knife = knife;
  // --- M-9 SMOKE grenade: grey-green canister (distinct from the yellow
  // frag at a glance), vented top cap, lever and pin ring.
  const smoke = new THREE.Group();
  const smokeBodyMat = new THREE.MeshStandardMaterial({ color: 0x6b7a5c, roughness: 0.55, metalness: 0.2 });
  const sBody = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.048, 0.10, 12), smokeBodyMat);
  smoke.add(sBody);
  const sBand = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.018, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a4034, roughness: 0.8 }));
  sBand.position.y = -0.01;
  smoke.add(sBand);
  const sTop = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.04, 0.035, 10),
    new THREE.MeshStandardMaterial({ color: PALETTE.gunmetal, roughness: 0.4, metalness: 0.5 }));
  sTop.position.y = 0.065;
  smoke.add(sTop);
  smoke.add(box(new THREE.MeshStandardMaterial({ color: PALETTE.gunmetal, roughness: 0.4, metalness: 0.5 }),
    0.016, 0.09, 0.02, 0.05, 0.02, 0)); // lever
  const sRing = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.005, 6, 14), steel);
  sRing.position.set(-0.05, 0.07, 0);
  sRing.rotation.y = Math.PI / 2;
  smoke.add(sRing);
  smoke.position.set(0.28, -0.26, -0.5);
  smoke.visible = false;
  group.add(smoke);
  models.smoke = smoke;

  const knifeBasePos = models.knife.position.clone();
  const knifeBaseRot = models.knife.rotation.clone();
  const w = {
    group, models, current: 'pistol', bloom: 0, bloomT: 0,
    cooldown: 0, reloadT: 0, switchT: 0, kick: 0,
    swingT: -1, swingDur: 0.45, // knife swing clock: -1 = idle, else 0..swingDur
    equip(id) {
      w.current = id;
      for (const [k, m] of Object.entries(models)) m.visible = (k === id);
      w.bloom = 0; w.switchT = 0.5;
      // A mid-swing switch leaves the knife mid-slash: restore its base
      // pose so it is never re-equipped rotated.
      w.swingT = -1;
      models.knife.position.copy(knifeBasePos);
      models.knife.rotation.copy(knifeBaseRot);
    },
    // Returns true when a shot may be fired this step.
    canFire() { return w.cooldown <= 0 && w.reloadT <= 0 && w.switchT <= 0; },
    // Start a knife swing. Returns false when the knife is still on its
    // 0.55 s interval, switching, or reloading. On true the coordinator
    // plays audio.knifeSwing() (KNIFE_SWING_SOUND) and then, at the
    // strike moment (~0.18 s in, when the blade crosses the centre),
    // calls knifeHitTest() and combat.damage() for a hit.
    startSwing() {
      if (w.current !== 'knife' || !w.canFire()) return false;
      w.cooldown = WEAPONS.knife.interval;
      w.swingT = 0;
      w._struck = false;
      return true;
    },
    knifeSwingActive() { return w.swingT >= 0; },
    // Strike moment: true once per swing, at ~40% through the slash.
    // The coordinator checks this each step after calling startSwing().
    knifeStrikeNow() {
      return w.swingT >= 0 && w.swingT >= w.swingDur * 0.4 && !w._struck;
    },
    markStruck() { w._struck = true; },
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
      // Knife swing: a diagonal slash over swingDur. Rotation sweeps
      // +0.8 -> -0.8 rad around z while the blade dips and pushes
      // forward at mid-swing, then returns to the base pose exactly.
      if (w.swingT >= 0) {
        w.swingT += dt;
        const k = Math.min(1, w.swingT / w.swingDur);
        const arc = Math.sin(k * Math.PI);
        models.knife.rotation.set(
          knifeBaseRot.x - 0.3 * arc,
          knifeBaseRot.y,
          knifeBaseRot.z + 0.8 - 1.6 * k,
        );
        models.knife.position.set(
          knifeBasePos.x - 0.15 * arc,
          knifeBasePos.y + 0.06 * arc,
          knifeBasePos.z - 0.08 * arc,
        );
        if (k >= 1) {
          w.swingT = -1;
          models.knife.position.copy(knifeBasePos);
          models.knife.rotation.copy(knifeBaseRot);
        }
      }
    },
  };
  w.equip('pistol');
  return w;
}

// Reload: move reserve into the magazine. Returns [moved, done].
export function startReload(state) {
  const slot = state.player.weapons[state.player.weapon];
  // Melee and throwables have no magazine: the knife entry has mag 0,
  // so without this guard it would report "reloadable" and finishReload
  // would write NaN ammo. (Grenade was already guarded; knife/smoke join it.)
  if (!slot || state.player.weapon === 'grenade' || state.player.weapon === 'knife'
      || state.player.weapon === 'smoke') return false;
  const def = WEAPONS[state.player.weapon];
  if (!def) return false;
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

// ---- Knife melee hit test (pure geometry, no raycast) ----
// origin/dir: the player's eye position and look direction (THREE.Vector3
// or {x,y,z}). Tests every living ENEMY bot (team !== shooterTeam,
// default 'B' — the player): the bot's chest point must be within
// KNIFE_RANGE + 0.4 m (body radius) and inside a ~45 deg cone around the
// look direction. Returns the nearest hit
//   { target, part: 'torso', point: {x,y,z}, dist, damage: 50 }
// or null. The coordinator applies it with combat.damage(state, target,
// KNIFE_DAMAGE, 'torso', { id:'you', name:'You', weapon:'knife',
// team:'B' }, point) — damage() pushes the 'hit' event, so the hitmarker,
// floating damage number and damage total come through the SAME feedback
// path as gun and grenade hits (main.js drains 'hit' events). Friendly
// bots are never hit (same no-friendly-fire rule as fireShot).
export function knifeHitTest(state, origin, dir, shooterTeam = 'B') {
  const ox = origin.x || 0, oy = origin.y || 0, oz = origin.z || 0;
  const dl = Math.hypot(dir.x || 0, dir.y || 0, dir.z || 0) || 1;
  const dx = (dir.x || 0) / dl, dy = (dir.y || 0) / dl, dz = (dir.z || 0) / dl;
  let best = null;
  for (const b of state.bots) {
    if (!b.alive || b.team === shooterTeam) continue;
    const cy = b.crouched ? 0.62 : 1.0; // chest height (bots.js BOT_TUNING)
    const tx = b.x - ox, ty = cy - oy, tz = b.z - oz;
    const dist = Math.hypot(tx, ty, tz);
    if (dist > KNIFE_RANGE + 0.4) continue;
    if (dist <= 0.001) continue;
    const dot = (tx * dx + ty * dy + tz * dz) / dist;
    if (dot < 0.7) continue; // outside the ~45 deg swing cone
    if (!best || dist < best.dist) {
      best = {
        target: b, part: 'torso',
        point: { x: b.x, y: cy, z: b.z },
        dist, damage: KNIFE_DAMAGE,
      };
    }
  }
  return best;
}

// ---- Smoke grenade throw (mirrors combat.throwGrenade) ----
// Creates a 'smoke' projectile on state.grenades: same 14 m/s throw and
// gravity/bounce physics as the frag, fuse 1.6 s. The coordinator's
// stepGrenades patch (see WIRING) skips kind === 'smoke' there; the smoke
// flight is stepped by stepSmokeGrenades() below and detonates into
// fx.spawnSmoke(). Returns the projectile record.
export function throwSmokeGrenade(state, thrower, origin, dir) {
  const g = {
    kind: 'smoke',
    x: origin.x, y: origin.y, z: origin.z,
    vx: dir.x * 14 + (thrower.vx || 0) * 0.5,
    vy: dir.y * 14,
    vz: dir.z * 14 + (thrower.vz || 0) * 0.5,
    fuse: 1.6, bounces: 0,
  };
  state.grenades.push(g);
  return g;
}

// Step ONLY the smoke projectiles in state.grenades (same gravity and
// floor bounce as the frag in combat.js). `mesh` is the smoke projectile
// mesh the coordinator owns (main.js); `onDetonate(pos)` is called once
// per smoke grenade when its fuse expires — the coordinator passes
// (pos) => fx.spawnSmoke(pos) (and audio.smoke()).
// Returns the number of smoke grenades detonated this step. The frag
// stepper in combat.js must skip kind === 'smoke' (one-line guard, see
// WIRING) or the smoke would be double-stepped and frag-detonated.
export function stepSmokeGrenades(state, dt, mesh, onDetonate) {
  let detonated = 0;
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    if (g.kind !== 'smoke') continue;
    g.fuse -= dt;
    g.vy -= BALLISTIC_GRAVITY * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.1) {
      g.y = 0.1;
      if (g.bounces === 0) { g.vy = -g.vy * 0.45; g.vx *= 0.7; g.vz *= 0.7; g.bounces++; }
      else { g.vy = 0; g.vx *= 0.9; g.vz *= 0.9; }
    }
    if (mesh) { mesh.position.set(g.x, g.y, g.z); mesh.visible = true; }
    if (g.fuse <= 0) {
      state.grenades.splice(i, 1);
      if (mesh) mesh.visible = false;
      detonated++;
      if (onDetonate) onDetonate({ x: g.x, y: Math.max(0.3, g.y), z: g.z });
    }
  }
  return detonated;
}

// ---------------------------------------------------------------- WIRING (coordinator)
// main.js / combat.js / rounds.js / state.js / bots.js / audio.js are NOT
// this file's — the coordinator applies these exact patches:
//
// 1. state.js createGameState(): after the player.weapons literal, add
//      knife: { owned: true },
//      smoke: { owned: false, count: 0 },
//    (or call ensureLoadout(state) once after createGameState in main.js —
//    same result, no state.js edit needed).
// 2. main.js boot: ensureLoadout(state) once; expose window.__ferroline
//    unchanged. In doFire(), BEFORE the gun path, add:
//      if (p.weapon === 'knife') {
//        if (!weapons.startSwing()) return false;
//        audio.knifeSwing();              // NEW audio.js method, see (7)
//        return true;                     // hit is resolved at the strike
//      }                                  // moment, see (3)
//      if (p.weapon === 'smoke') {
//        if (p.weapons.smoke.count < 1) return false;
//        cameraForward(p.yaw, p.pitch, _fwd);
//        _origin.set(p.x, p.y + eyeHeight(move), p.z);
//        throwSmokeGrenade(state, { x:p.x, z:p.z, vx:move.vx, vz:move.vz }, _origin, _fwd);
//        p.weapons.smoke.count = 0;
//        weapons.equip(p.weapons.rifle.owned ? 'rifle' : p.weapons.sniper.owned ? 'sniper' : 'pistol');
//        p.weapon = weapons.current; const slot = p.weapons[p.weapon];
//        p.mag = slot.mag; p.reserve = slot.reserve;
//        audio.shot('smoke');             // throw whoosh (reuse 'grenade' sound)
//        return true;
//      }
//    (Mirror the existing frag branch; the frag branch itself is unchanged.)
// 3. main.js step(), after weapons.step(dt): resolve the knife strike:
//      if (weapons.knifeStrikeNow()) {
//        weapons.markStruck();
//        cameraForward(p.yaw, p.pitch, _fwd);
//        _origin.set(p.x, p.y + eyeHeight(move), p.z);
//        const hit = knifeHitTest(state, _origin, _fwd);
//        if (hit) damage(state, hit.target, KNIFE_DAMAGE, 'torso',
//          { id: 'you', name: 'You', weapon: 'knife', team: 'B' }, hit.point);
//      }
//    damage() pushes the 'hit' event — hitmarker + damage number + damage
//    total come free through the existing event drain. No new HUD path.
// 4. main.js switchWeapon(id) / cycleWeapon() / key handling: replace the
//    4-item order with the 5-slot helpers —
//      switchWeapon('primary') -> togglePrimary(state) then equip result;
//      switchWeapon('knife'|'smoke') like 'grenade' (count check for smoke,
//      knife always available); Digit1..Digit5 -> pistol/primary/knife/
//      grenade/smoke; cycleWeapon uses nextSlot(state, slotOfWeapon(p.weapon), dir)
//      and equips weaponForSlot(state, slot); popup text via
//      displayNameForWeapon(id) (primary shows the concrete rifle/sniper name).
//    Aim-down-sights exclusion (wantAim) must also exclude 'knife' and
//    'smoke' alongside 'grenade'; the speed lookup `WEAPONS[p.weapon] ||
//    WEAPONS.pistol` already works for knife (speedMul 1.05) — for
//    grenade/smoke it falls back to pistol speed, as today.
// 5. main.js step(), grenade stepping: add a smoke projectile mesh
//    (grey-green sphere, like grenadeMesh) and call, next to stepGrenades:
//      stepSmokeGrenades(state, FIXED_STEP, smokeMesh,
//        (pos) => { fx.spawnSmoke(new THREE.Vector3(pos.x, pos.y, pos.z)); audio.smoke(); });
//    combat.js stepGrenades(): add ONE guard at the top of its loop body:
//      if (g.kind === 'smoke') continue;
//    (so the frag stepper never moves or frag-detonates a smoke grenade).
//    fx.update(dt) already steps live smoke clouds (see fx.js).
// 6. rounds.js buyItem(state, itemId): add
//      if (itemId === 'smoke') { if (loadoutBuySmoke(state)) { p.weapon = 'smoke'; return true; } return false; }
//      if (itemId === 'knife') return false; // already owned, never bought
//    and main.js buy keys become Digit1..Digit5 ->
//    pistol/rifle/sniper/grenade/smoke. startRound()/reviveAll()/
//    respawnFighter() reset `p.weapons.grenade.count = 0` — add the same
//    line for smoke (`p.weapons.smoke.count = 0`) in each of those three
//    places, or smoke would carry across rounds. TDM startRound gives the
//    player the rifle; the knife stays available (always owned) there too.
// 7. audio.js: add knifeSwing() (short bandpass-noise whoosh, ~0.18 s,
//    same _noise/_tone helpers as shot()) and smoke() (soft pop + 0.8 s
//    filtered-noise hiss). No other audio change; knife hits reuse hit().
// 8. bots.js canSee(): after the wall-raycast loop, before `return
//    { dist, headOnly, aimY: ty }`, add:
//      import { segmentBlockedBySmoke } from './fx.js';
//      if (segmentBlockedBySmoke({x:bot.x,y:eyeY,z:bot.z}, {x:target.x,y:ty,z:target.z})) continue;
//    i.e. a sight line through any active smoke volume does NOT count as
//    seen (try the chest line, then the head line; both blocked = unseen).
//    That is the whole bot-side smoke change — the registry lives in fx.js.
// 9. hud.js (this task's file) already renders the 5-slot buy menu and the
//    loadout strip; main.js render() must call hud.setLoadout(
//    slotOfWeapon(p.weapon), p.weapons.grenade.count,
//    p.weapons.smoke.count, displayNameForWeapon(primaryForSlot(state)))
//    once per frame, and pass `smoke: ...count > 0, knife: true` in the
//    `owned` object it builds for renderBuy().
// 10. CONTROLS HINT (user steer 2026-11-15): hud.js now renders the
//    persistent in-game controls line (#controls-hint) with the exact
//    scheme — WASD move, mouse aim, click fire, RIGHT MOUSE scope,
//    LEFT SHIFT sprint, Z crouch, R reload, E plant/defuse, B buy,
//    1-5 switch, M mute, H home, Esc pause. Two places still show the
//    OLD scheme and are NOT this file's to fix:
//      - main.js showStart() overlay body (~lines 649-651): still says
//        '1–4 weapons / buy', 'Ctrl/C crouch', 'Shift slow walk'. Replace
//        with: '<b>W A S D</b> move &nbsp; <b>Mouse</b> look &nbsp;
//        <b>Click</b> fire &nbsp; <b>Right mouse</b> scope<br><b>1–5</b>
//        weapons / buy &nbsp; <b>E</b> plant &nbsp; <b>B</b> buy menu &nbsp;
//        <b>Left Shift</b> sprint &nbsp; <b>Z</b> crouch (hold)<br>
//        <b>R</b> reload &nbsp; <b>Space</b> jump &nbsp; <b>M</b> mute &nbsp;
//        <b>H</b> home &nbsp; <b>Esc</b> pause'.
//      - index.html home-foot: ALREADY correct (LEFT SHIFT sprint, Z
//        crouch, 1–5 switch) — verified 2026-11-15, no change needed.
