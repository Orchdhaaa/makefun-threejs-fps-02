// world.js — DEPOT 9, a decommissioned mountain rail depot at dawn.
// MAP is data, not code: the build loop reads it, so the map is rebalanced
// by editing numbers. Open-field map: no interior walls, only the 16 cover
// pieces below plus the outer walls. Every cover piece is one mesh, one
// AABB collider and one raycast shootable.
//
// VISUALS ONLY in this file: layout, colliders, spawn points and bomb
// sites are unchanged. All extra detail (rails, props, signs, sky) is
// decor with no collider and is never added to `shootables`, so bullets
// and movement behave exactly as before.
import * as THREE from 'three';
import {
  PALETTE,
  texConcrete, texWall, texWood, texCorrugated, texBallast, texHazard,
  texSiteLetter, texFloorText, texSky, texCloud, texMountains,
  texSand, texSandstone, texMetalPanel, texSkyDesert, texSkyFoundry, texMesas,
  texGlow, texSunDisc, texBeam, texRoughNoise, texSkyDome,
} from './palette.js';
import { getSettings, qualityPreset } from './settings.js';

// [centreX, centreZ, width, height, depth, colourKey]
export const COVER = [
  [-24, -16, 1.2, 1.1, 1.2, 'hairline'], // Shed A crate
  [24, -16, 1.2, 1.1, 1.2, 'hairline'],  // Shed B crate
  [-26, -8, 1.2, 1.1, 1.2, 'hairline'],  // West lane crate
  [26, -8, 1.2, 1.1, 1.2, 'hairline'],   // East lane crate
  [0, -8, 8, 2.2, 4, 'surface'],         // Pump House
  [-3, -3, 4, 2.6, 2, 'wagonTeal'],      // Twin Wagon west
  [3, -3, 4, 2.6, 2, 'wagonRust'],       // Twin Wagon east (2 m gap at x=0)
  [0, 5, 12, 2.6, 2, 'wagonTeal'],       // Long Wagon
  [-16, 0, 1.2, 1.1, 1.2, 'hairline'],   // Crossing crate west
  [16, 0, 1.2, 1.1, 1.2, 'hairline'],    // Crossing crate east
  [-24, 6, 1.2, 1.1, 1.2, 'hairline'],   // West approach crate
  [24, 6, 1.2, 1.1, 1.2, 'hairline'],    // East approach crate
  [-13, 11, 2, 2.2, 2, 'surface'],       // Gantry Leg west
  [13, 11, 2, 2.2, 2, 'surface'],        // Gantry Leg east
  [-3, 14, 1.2, 1.1, 1.2, 'hairline'],   // Spawn crate west
  [3, 14, 1.2, 1.1, 1.2, 'hairline'],    // Spawn crate east
];

// FOUNDRY-7 cover: [centreX, centreZ, width, height, depth, kind]
// Tight factory floor: a central furnace, two presses, a low conveyor,
// benches, racks along the north wall, roof pillars and pipe columns.
export const COVER_FOUNDRY = [
  [0, -6, 10, 3.4, 4, 'furnace'],        // Central furnace block
  [-11, -2, 4, 2.8, 3, 'press'],         // Press west
  [11, -2, 4, 2.8, 3, 'press'],          // Press east
  [0, 3, 10, 1.0, 2, 'conveyor'],        // Low conveyor (shoot over it)
  [-18, 2, 1.2, 1.1, 1.2, 'crate'],      // West lane crate
  [18, 2, 1.2, 1.1, 1.2, 'crate'],       // East lane crate
  [-8, 10, 2.4, 2.2, 1.2, 'crates'],     // Crate stack south-west
  [8, 10, 2.4, 2.2, 1.2, 'crates'],      // Crate stack south-east
  [-14, 12, 5, 1.1, 1.6, 'bench'],       // Workbench west
  [14, 12, 5, 1.1, 1.6, 'bench'],        // Workbench east
  [-6, -15, 5, 3.0, 1.2, 'rack'],        // Storage rack north-west
  [6, -15, 5, 3.0, 1.2, 'rack'],         // Storage rack north-east
  [-4, -1, 1, 7, 1, 'pillar'],           // Roof pillar west
  [4, -1, 1, 7, 1, 'pillar'],            // Roof pillar east
  [-21, -8, 0.8, 7, 0.8, 'pipe'],        // Pipe column NW
  [21, -8, 0.8, 7, 0.8, 'pipe'],         // Pipe column NE
  [-21, 0, 0.8, 7, 0.8, 'pipe'],         // Pipe column W
  [21, 0, 0.8, 7, 0.8, 'pipe'],          // Pipe column E
  [-21, 8, 0.8, 7, 0.8, 'pipe'],         // Pipe column SW
  [21, 8, 0.8, 7, 0.8, 'pipe'],          // Pipe column SE
];

// DUSTLINE cover: [centreX, centreZ, width, height, depth, kind]
// Open canyon: big mesas, a central butte, rock slabs, watchtowers,
// boulders, fins, supply crates, shacks and a low dune ridge.
export const COVER_DUSTLINE = [
  [-24, -8, 10, 4.5, 6, 'mesa'],         // Mesa west
  [24, -8, 10, 4.5, 6, 'mesa'],          // Mesa east
  [0, -12, 8, 5, 5, 'butte'],            // Central butte (north)
  [-14, 4, 6, 2.2, 3, 'slab'],           // Rock slab west-mid
  [14, 4, 6, 2.2, 3, 'slab'],            // Rock slab east-mid
  [-8, 14, 1.2, 1.1, 1.2, 'crate'],      // Supply crate SW
  [8, 14, 1.2, 1.1, 1.2, 'crate'],       // Supply crate SE
  [-30, 6, 1.2, 1.1, 1.2, 'crate'],      // Supply crate west
  [30, 6, 1.2, 1.1, 1.2, 'crate'],       // Supply crate east
  [-20, 18, 1.2, 1.1, 1.2, 'crate'],     // Supply crate NW approach
  [20, 18, 1.2, 1.1, 1.2, 'crate'],      // Supply crate NE approach
  [-32, 8, 3, 5, 3, 'tower'],            // Watchtower west
  [32, 8, 3, 5, 3, 'tower'],             // Watchtower east
  [-6, -4, 2, 1.6, 2, 'boulder'],        // Boulder west-mid
  [6, -4, 2, 1.6, 2, 'boulder'],         // Boulder east-mid
  [-36, -2, 1.5, 3, 8, 'fin'],           // Rock fin west wall
  [36, -2, 1.5, 3, 8, 'fin'],            // Rock fin east wall
  [0, 20, 16, 1.2, 2, 'dune'],           // Low dune ridge (shoot over it)
  [-36, 18, 4, 2.6, 3, 'shack'],         // Outpost shack west
  [36, 18, 4, 2.6, 3, 'shack'],          // Outpost shack east
];

export const MAPS = {
  depot9: {
    id: 'depot9',
    name: 'DEPOT 9',
    tagline: 'Mountain rail depot at dawn — open lanes, freight cover.',
    bounds: { minX: -32, maxX: 32, minZ: -22, maxZ: 22 },
    wallH: 4.6,
    sites: {
      A: { x: -24, z: -14, minX: -28, maxX: -20, minZ: -18, maxZ: -10, plantX: -24, plantZ: -13, colour: 'accent' },
      B: { x: 24, z: -14, minX: 20, maxX: 28, minZ: -18, maxZ: -10, plantX: 24, plantZ: -13, colour: 'wagonTeal' },
    },
    attackerSpawn: { x: 0, z: 19.5 },
    defenderSpawn: { x: 0, z: -19.5 },
    capturePoints: [
      { id: 'A', x: -24, z: -13, r: 4 },
      { id: 'B', x: 24, z: -13, r: 4 },
      { id: 'C', x: 0, z: 8, r: 4 },
    ],
  },
  foundry: {
    id: 'foundry',
    name: 'FOUNDRY-7',
    tagline: 'Sodium-lit factory floor — tight lanes, furnace cover.',
    bounds: { minX: -22, maxX: 22, minZ: -16, maxZ: 16 },
    wallH: 7,
    sites: {
      A: { x: -16, z: -10, minX: -20, maxX: -12, minZ: -14, maxZ: -6, plantX: -16, plantZ: -10, colour: 'accent' },
      B: { x: 16, z: -10, minX: 12, maxX: 20, minZ: -14, maxZ: -6, plantX: 16, plantZ: -10, colour: 'wagonTeal' },
    },
    attackerSpawn: { x: 0, z: 13 },
    defenderSpawn: { x: 0, z: -13 },
    capturePoints: [
      { id: 'A', x: -16, z: -10, r: 4 },
      { id: 'B', x: 16, z: -10, r: 4 },
      { id: 'C', x: 0, z: 8, r: 4 },
    ],
  },
  dustline: {
    id: 'dustline',
    name: 'DUSTLINE',
    tagline: 'Desert canyon outpost — long sightlines, mesa cover.',
    bounds: { minX: -40, maxX: 40, minZ: -28, maxZ: 28 },
    wallH: 6,
    sites: {
      A: { x: -32, z: -18, minX: -36, maxX: -28, minZ: -22, maxZ: -14, plantX: -32, plantZ: -18, colour: 'accent' },
      B: { x: 32, z: -18, minX: 28, maxX: 36, minZ: -22, maxZ: -14, plantX: 32, plantZ: -18, colour: 'wagonTeal' },
    },
    attackerSpawn: { x: 0, z: 25 },
    defenderSpawn: { x: 0, z: -25 },
    capturePoints: [
      { id: 'A', x: -32, z: -18, r: 4 },
      { id: 'B', x: 32, z: -18, r: 4 },
      { id: 'C', x: 0, z: 0, r: 4 },
    ],
  },
};

// Live binding: createWorld() re-points MAP at the built map, so existing
// code that reads MAP.sites / MAP.bounds / MAP.capturePoints keeps working
// (main.js, siteAt) without any change. Defaults to DEPOT 9, as before.
export let MAP = MAPS.depot9;

const _matCache = {};
function mat(color, rough, metal = 0.05) {
  const key = color + ':' + rough + ':' + metal;
  if (!_matCache[key]) _matCache[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  return _matCache[key];
}
// Shared speckle roughness texture (lazy): multiplies the roughness
// scalar so big flat surfaces stop reading as uniform plastic.
let _roughTex = null;
const _texMatCache = new Map();
function texMat(tex, rough = 0.9, metal = 0.05) {
  const key = tex.uuid + ':' + rough + ':' + metal;
  if (!_texMatCache.has(key)) {
    if (!_roughTex) _roughTex = texRoughNoise(5);
    _texMatCache.set(key, new THREE.MeshStandardMaterial({
      map: tex, roughness: rough, metalness: metal,
      // The colour canvas doubles as a bump map: speckle, grain and
      // panel lines get real micro-relief under the sun. 0.02 keeps it
      // subtle — texture, not geometry.
      roughnessMap: _roughTex, bumpMap: tex, bumpScale: 0.02,
    }));
  }
  return _texMatCache.get(key);
}

// --- Z-FIGHTING FIX (2026-11-15): stacked / flush surfaces -------------
// Root causes found by a headless geometric audit of the built scene
// (every mesh face vs every other face, same-facing overlap, gap < 0.5 mm):
//  (1) crate steel straps: outer faces EXACTLY on the crate faces;
//  (2) site corner brackets: the two arms of one corner shared one plane;
//  (3) floor decals stacked 4-15 mm apart (dash 8 mm over apron, bracket
//      5 mm over letter, letter 10 mm over zone);
//  (4) pump-house door exactly on the hazard band's front face;
//  (5) hazard bands, doors and wagon ribs only 10 mm proud;
//  (6) merlon faces flush with the coping faces; wall-corner faces flush.
// Fix policy: real physical separation (>= 20 mm wherever two faces can
// both be seen) PLUS polygonOffset on every painted decal layer, so the
// depth buffer still resolves the stack at distance / grazing angles.
// Decal layer heights above the floor top (y = 0) and their offset units:
//   strip / spawn paint 0.06 (units -1) -> zone 0.09 (-2) -> letter
//   0.115 (-3) -> bracket arm X 0.14 (-4) -> bracket arm Z 0.165 (-5).
// Ground patches: apron/wash 0.02 (-1), dirt/rock 0.04 (-2), oil 0.036 (-2).
function decalBasic(opts, units) {
  return new THREE.MeshBasicMaterial({
    ...opts, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: units,
  });
}
function decalStd(tex, rough = 0.95, po = -1) {
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = po;
  m.polygonOffsetUnits = po;
  return m;
}

// --- GRAPHICS PUSH (2026-11-15): quality tiers, atmosphere, dressing.
// The tier comes from src/settings.js (default medium): low has no
// shadows and no atmosphere extras, medium 1024 shadow map, ultra 2048.
// World-side application only — the renderer side (shadowMap.enabled,
// pixel ratio, tone mapping) is the coordinator's job in main.js.
// Deterministic RNG so dust motes / scatter land identically every load.
function _rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Apply the tier to a directional sun: shadow map size from the preset;
// size 0 / shadows off = no shadow map at all (dispose any existing one).
export function applySunQuality(sun, Q) {
  sun.castShadow = !!Q.shadows;
  if (Q.shadowMapSize > 0) sun.shadow.mapSize.set(Q.shadowMapSize, Q.shadowMapSize);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}

// Tag a mesh as an atmosphere extra: visible only when the tier has
// atmosphere (clouds, sun disc, mountain/mesa rings, glow sprites).
// The list lives on group.userData.atmosphere for inspection.
function atm(group, mesh, Q) {
  (group.userData.atmosphere = group.userData.atmosphere || []).push(mesh);
  mesh.visible = !!Q.atmosphere;
  return mesh;
}

// Drifting dust motes: one THREE.Points draw call. Count scales with the
// tier's particleScale; zero motes when atmosphere is off. The cloud
// slowly rotates + bobs via onBeforeRender (no per-point CPU updates).
function addDustMotes(group, Q, seed, count, area, yTop) {
  const n = Q.atmosphere ? Math.round(count * Q.particleScale) : 0;
  if (n <= 0) return null;
  const rand = _rng32(seed);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rand() * 2 - 1) * area.x;
    pos[i * 3 + 1] = 0.3 + rand() * yTop;
    pos[i * 3 + 2] = (rand() * 2 - 1) * area.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: texGlow(), color: 0xffe8c0, size: 0.13, transparent: true,
    opacity: 0.5, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    pts.rotation.y = t * 0.005;
    pts.position.y = Math.sin(t * 0.11) * 0.3;
  };
  group.add(pts);
  atm(group, pts, Q);
  return pts;
}

// Sky dome: a real sky you can look at — a BackSide sphere painted with
// the gradient + cloud-streak canvas from palette.texSkyDome. Replaces
// the flat scene.background gradient (a 4px canvas stretched over the
// whole backdrop, which is why the old sky read as a flat colour wash).
// Radius 170 sits inside the camera far plane (200) and outside the
// mountain/mesa rings (95/120), so the dome is always the backdrop.
function addSkyDome(scene, group, variant) {
  scene.background = null;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(170, 32, 20),
    new THREE.MeshBasicMaterial({ map: texSkyDome(variant), side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10;
  group.add(dome);
  return dome;
}

// Sun glow sprite: a big soft radial halo around the sun disc.
// opts (sun-smoke r4): { map, blending, renderOrder }. With no opts the
// call behaves exactly as before (texGlow(), NormalBlending, renderOrder
// 0) — so the Dustline call sites are behaviourally untouched. atm()
// tagging lives inside the helper, so every sun sprite is Low-tier
// hidden (atmosphere off hides all three).
function addSunGlow(group, Q, x, y, z, scale, color, opacity, opts = {}) {
  const sm = new THREE.SpriteMaterial({
    map: opts.map || texGlow(), color, transparent: true, opacity,
    depthWrite: false, fog: false,
    blending: opts.blending || THREE.NormalBlending,
  });
  const spr = new THREE.Sprite(sm);
  spr.position.set(x, y, z);
  spr.scale.set(scale, scale, 1);
  spr.renderOrder = opts.renderOrder !== undefined ? opts.renderOrder : 0;
  group.add(spr);
  atm(group, spr, Q);
  return spr;
}

// Light shafts: crossed additive gradient planes along the sun direction.
// spots: [x, y, z, width, height, rotZ, rotY, opacity].
function addLightShafts(group, Q, spots) {
  if (!Q.atmosphere) return;
  const beamTex = texBeam();
  for (const [x, y, z, w, h, rz, ry, op] of spots) {
    for (const cross of [0, Math.PI / 2]) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          map: beamTex, transparent: true, opacity: op,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }));
      m.position.set(x, y, z);
      m.rotation.set(0, ry + cross, rz);
      group.add(m);
      atm(group, m, Q);
    }
  }
}

// Warm volumetric cone under a hanging lamp (foundry): additive, fades
// toward the floor, tagged as an atmosphere extra.
function addLampCone(group, Q, x, z, topY, color, opacity) {
  if (!Q.atmosphere) return null;
  const h = topY - 0.4;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, h, 20, 1, true),
    new THREE.MeshBasicMaterial({
      map: texBeam(), color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
  cone.position.set(x, 0.4 + h / 2, z);
  group.add(cone);
  atm(group, cone, Q);
  return cone;
}

// DEPOT 9 builder — unchanged from the original createWorld body.
// Reads MAP (re-pointed by createWorld before the call), returns the same
// shape every builder returns.
function buildDepot9(scene, Q) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  // --- sky: a real dome (gradient + painted cloud streaks) + a big
  // low sun with a halo you cannot miss + a mountain ring in haze ---
  // The old sky was a 4px gradient as scene.background: a flat colour
  // wash. The old sun disc (r 3.2, glow 0.28) read as a pale moon.
  addSkyDome(scene, group, 'dawn');
  // Sun (sun-smoke r4, DEPOT 9 only): the old flat circles are gone —
  // the disc was a pale "moon" (r5.5 flat 0xffe6b0) under a sky-wide
  // wash (halos 72 @ 0.85 / 140 @ 0.38). The sun is now 3 co-centred
  // billboard sprites at (48, 30, -68) — the r1 move from (55, 16, -70),
  // ~20° elevation, disc bottom 26.5 m, painted-ridge clearance ~4°.
  // Draw order is by renderOrder, not depth-sort luck: outer -> inner
  // -> disc, so the opaque amber disc always overdraws the halos and
  // the limb can never be veiled. Known limitation (owned, r4 §2.4):
  // renderOrder 1-3 draws the sun after ALL renderOrder-0 transparents,
  // so an M-9 cloud / explosion smoke between camera and sun gets a
  // faint amber tint over a small patch — accepted, not claimed away.
  // Fallback (pre-computed, apply only if the spawn still shows the disc
  // < 40 px tall or not visibly amber): disc 7.0 -> 8.5, inner halo
  // 0.35 -> 0.45 (0.45 over #c98a4b -> (225,138,55), still amber, no
  // clip — Devil N2 corrected triple). Never restore the flat circle
  // or the 72/140 halos.
  addSunGlow(group, Q, 48, 30, -68, 50, 0xff7a1f, 0.15, { blending: THREE.AdditiveBlending, renderOrder: 1 });
  addSunGlow(group, Q, 48, 30, -68, 22, 0xff8a1f, 0.35, { renderOrder: 2 });
  addSunGlow(group, Q, 48, 30, -68, 7.0, 0xffffff, 1.0, { map: texSunDisc(), renderOrder: 3 });
  // Mountain ring beyond the walls: two ridges on one cylinder, BackSide.
  const ridge = new THREE.Mesh(
    new THREE.CylinderGeometry(95, 95, 26, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: texMountains(), side: THREE.BackSide, fog: false, transparent: true }));
  ridge.position.y = 14;
  group.add(ridge); atm(group, ridge, Q);
  // Clouds: 10 big billboards now (was 6 small ones) — they must read
  // as clouds at a glance, not faint smudges near the horizon.
  const cloudMat = new THREE.MeshBasicMaterial({
    map: texCloud(2), transparent: true, depthWrite: false, fog: false, opacity: 0.95,
  });
  const cloudSpots = [
    [-45, 30, -75, 52, 16], [30, 34, -80, 64, 19], [70, 28, -40, 46, 15],
    [-70, 32, 20, 58, 18], [10, 36, 75, 66, 19], [55, 30, 60, 46, 15],
    [-15, 40, -60, 56, 16], [85, 36, 10, 50, 15], [-85, 38, -30, 54, 17],
    [0, 44, -85, 72, 18],
  ];
  for (const [x, y, z, w, h] of cloudSpots) {
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cloudMat);
    cl.position.set(x, y, z);
    cl.lookAt(0, 4, 0);
    group.add(cl); atm(group, cl, Q);
  }

  // --- floor: textured concrete, not one flat grey slab ---
  const floorTex = texConcrete(PALETTE.groundConcrete, 7, 8, 6);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(64, 0.2, 44), texMat(floorTex, 0.95));
  floor.position.set(0, -0.1, 0);
  floor.receiveShadow = true;
  group.add(floor);

  // Worn asphalt aprons north and south of the rail bed.
  const apronTex = texConcrete(PALETTE.groundAsphalt, 17, 8, 2);
  for (const z of [-16.5, 16.5]) {
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(64, 7), decalStd(apronTex, 0.96, -1));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, 0.02, z);
    apron.receiveShadow = true;
    group.add(apron);
  }
  // Dirt / dust patches near the walls and corners.
  const dirtTex = texConcrete(PALETTE.groundDirt, 23, 2, 2);
  const dirtSpots = [[-28, -20, 7, 4], [28, -20, 7, 4], [-29, 19, 6, 4], [29, 19, 6, 4], [-8, -20, 8, 3], [10, 20, 8, 3]];
  for (const [x, z, w, d] of dirtSpots) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), decalStd(dirtTex, 1.0, -2));
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.04, z);
    p.receiveShadow = true;
    group.add(p);
  }
  // Oil stains: dark, flat, glossy-ish decals.
  const oilMat = new THREE.MeshStandardMaterial({ color: PALETTE.groundOil, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const oilSpots = [[-6, -5, 2.6, 1.6, 0.4], [14, 8, 2.2, 1.4, 1.1], [-18, 12, 1.8, 1.2, 2.0], [5, -14, 2.4, 1.5, 0.9], [26, 2, 1.6, 1.1, 0.2]];
  for (const [x, z, w, d, r] of oilSpots) {
    const o = new THREE.Mesh(new THREE.CircleGeometry(1, 20), oilMat);
    o.rotation.x = -Math.PI / 2; o.rotation.z = r;
    o.scale.set(w / 2, d / 2, 1);
    o.position.set(x, 0.036, z);
    group.add(o);
  }

  // --- rail bed: ballast + sleepers + twin steel rails down the middle ---
  const ballast = new THREE.Mesh(
    new THREE.BoxGeometry(64, 0.06, 6),
    texMat(texBallast(9, 8, 1), 1.0));
  ballast.position.set(0, 0.03, 0);
  ballast.receiveShadow = true;
  group.add(ballast);
  // Sleepers: one InstancedMesh, 40 ties across the bed.
  const sleeperGeo = new THREE.BoxGeometry(0.28, 0.07, 2.9);
  const sleeperMat = mat(PALETTE.sleeperWood, 1.0);
  const sleepers = new THREE.InstancedMesh(sleeperGeo, sleeperMat, 40);
  const _m4 = new THREE.Matrix4();
  for (let i = 0; i < 40; i++) {
    _m4.makeTranslation(-31.2 + i * 1.6, 0.07, 0);
    sleepers.setMatrixAt(i, _m4);
  }
  sleepers.receiveShadow = true;
  group.add(sleepers);
  // Rails: bright steel heads on dark webbing, running east-west.
  const railHeadMat = mat(PALETTE.railSteel, 0.3, 0.85);
  const railWebMat = mat(PALETTE.roofDark, 0.6, 0.4);
  for (const z of [-1.15, 1.15]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(63.9, 0.07, 0.09), railHeadMat);
    head.position.set(0, 0.14, z);
    head.castShadow = true; head.receiveShadow = true;
    group.add(head);
    const web = new THREE.Mesh(new THREE.BoxGeometry(63.8, 0.09, 0.05), railWebMat);
    web.position.set(0, 0.08, z);
    group.add(web);
  }
  // Faded yellow centre dashes along the two approach lanes.
  const dashMat = new THREE.MeshStandardMaterial({ color: PALETTE.hazardYellow, roughness: 0.9, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  for (const x of [-24, -8, 8, 24]) {
    for (const z of [-6, -2, 2, 6, 10, 14, 18]) {
      if (Math.abs(z) < 3.5) continue; // keep the rail bed clear
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.4), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.03, z);
      group.add(dash);
    }
  }
  // Low rubble: flat debris a player can walk over without clipping.
  const rubbleMat = mat(PALETTE.groundBallast, 1.0);
  const rubble = [
    [-10, -12, 0.5, 0.1, 0.35], [6, -16, 0.4, 0.08, 0.5], [18, 12, 0.6, 0.12, 0.3],
    [-20, 16, 0.45, 0.09, 0.4], [28, -4, 0.5, 0.1, 0.45], [-28, 2, 0.4, 0.08, 0.3],
  ];
  for (const [x, z, w, h, d] of rubble) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rubbleMat);
    r.position.set(x, h / 2 + 0.01, z);
    r.rotation.y = x * 0.7;
    r.castShadow = true; r.receiveShadow = true;
    group.add(r);
  }

  // --- outer walls: panelled concrete + coping + merlons + lamps ---
  const wallTex = texWall(PALETTE.surface, 11, 8, 1);
  const wallMat = texMat(wallTex, 0.9);
  const wallDefs = [
    { x: 0, z: -22.2, w: 64.8, d: 0.4 }, { x: 0, z: 22.2, w: 64.8, d: 0.4 },
    { x: -32.2, z: 0, w: 0.4, d: 44.8 }, { x: 32.2, z: 0, w: 0.4, d: 44.8 },
  ];
  for (const wd of wallDefs) {
    // F8: the E/W (side) walls render 20 mm further out and 20 mm lower
    // than the N/S walls, so no two wall / coping faces share a plane at
    // the corners (their top faces and outer faces were exactly flush).
    // Mesh only: the collider below still uses wd + MAP.wallH exactly.
    const side = wd.w < wd.d;
    const drop = side ? 0.02 : 0;
    const out = side ? Math.sign(wd.x) * 0.02 : 0;
    const meshH = MAP.wallH - drop;
    const m = new THREE.Mesh(new THREE.BoxGeometry(wd.w, meshH, wd.d), wallMat);
    m.position.set(wd.x + out, meshH / 2, wd.z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); shootables.push(m);
    colliders.push({ minX: wd.x - wd.w / 2, maxX: wd.x + wd.w / 2, minZ: wd.z - wd.d / 2, maxZ: wd.z + wd.d / 2, h: MAP.wallH });
    // Coping strip along the top edge.
    const coping = new THREE.Mesh(new THREE.BoxGeometry(wd.w + 0.15, 0.18, wd.d + 0.15), mat(PALETTE.wallTrim, 0.85));
    coping.position.set(wd.x + out, MAP.wallH - drop + 0.09, wd.z);
    coping.castShadow = true;
    group.add(coping);
    // Merlon blocks on top: a broken skyline instead of a flat rim.
    // F6: 0.65 deep, so each merlon face stands 50 mm proud of the
    // coping faces instead of flush with them.
    const along = wd.w > wd.d ? 'x' : 'z';
    const len = along === 'x' ? wd.w : wd.d;
    const n = Math.floor(len / 4);
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + 2 + i * 4;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? 1.6 : 0.65, 0.55, along === 'x' ? 0.65 : 1.6), wallMat);
      merlon.position.set(
        along === 'x' ? wd.x + t : wd.x + out,
        MAP.wallH - drop + 0.18 + 0.27,
        along === 'x' ? wd.z : wd.z + t);
      merlon.castShadow = true;
      group.add(merlon);
    }
  }
  // Wall lamps: warm emissive heads high on the walls (light comes from
  // the directional sun; these are glow only, no extra point lights).
  const lampMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallTrim, roughness: 0.7 });
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: PALETTE.sunDisc });
  const lampSpots = [
    [-16, -21.95, 0], [16, -21.95, 0], [-16, 21.95, Math.PI], [16, 21.95, Math.PI],
    [-31.95, -8, Math.PI / 2], [-31.95, 8, Math.PI / 2], [31.95, -8, -Math.PI / 2], [31.95, 8, -Math.PI / 2],
  ];
  for (const [x, z, ry] of lampSpots) {
    const lamp = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.5), lampMat);
    arm.position.set(0, 0, 0.2);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.22), lampMat);
    head.position.set(0, -0.04, 0.42);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.16), lampGlowMat);
    glow.position.set(0, -0.1, 0.42);
    lamp.add(arm, head, glow);
    lamp.position.set(x, 3.7, z);
    lamp.rotation.y = ry;
    group.add(lamp);
  }
  // Floodlight poles in the four corners (thin, tucked into the corner so
  // they read as scenery; no collider, same as the old gantry beam).
  const poleMat = mat(PALETTE.roofDark, 0.6, 0.5);
  for (const [x, z] of [[-31, -21], [31, -21], [-31, 21], [31, 21]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.4, 8), poleMat);
    pole.position.set(x, 3.2, z);
    pole.castShadow = true;
    group.add(pole);
    const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), lampMat);
    lampHead.position.set(x, 6.4, z);
    lampHead.lookAt(0, 1, 0);
    group.add(lampHead);
    const lampGlow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.2), lampGlowMat);
    lampGlow.position.copy(lampHead.position);
    lampGlow.rotation.copy(lampHead.rotation);
    lampGlow.translateY(-0.1);
    group.add(lampGlow);
  }

  // --- distant gantry crane (DF frame-14 bar, OUR depot): a huge
  // structure beyond the north wall, silhouetted against the dawn sky.
  // It gives the depot scale from the spawn/lobby camera the way the
  // transport plane does in the reference — a big shape at a different
  // depth from the walls, crates and mountains. No collider (it stands
  // outside the playable bounds, z = -30).
  // R2: the jib/cab/beacon used to hide EXACTLY behind the signal
  // gantry beam (28 m beam at (0,3.4,11)) from spawn — from the spawn
  // eye (y 1.6, z 19.5) the beam top (y 3.6, z 11) subtends the same
  // sightline as anything below y ~13.2 at z=-30, and the old jib sat
  // at 12.6. So the whole crane moved +4 m east (the jib tip and
  // beacon now clear the beam's east end from spawn) and the jib/top
  // beam rose +1.5 m (12.6->14.1, 13.2->14.7), clearing the beam by
  // ~0.15-0.2 m on the sightline. The beacon grew 0.18->0.35 so it
  // reads as a red dot at 50 m. Legs/cab/cable/hook rose with the
  // beams (legs lengthened 13->14.7 m) — raising only the beams would
  // have left the top beam floating 1.7 m above the legs.
  const craneMat = mat(0x4a4640, 0.7, 0.3); // mid-grey steel: the crane
  // must silhouette against the sky/mountains, not vanish into them
  // (roofDark was camouflaged against the dark ridge).
  const crane = new THREE.Group();
  const cadd = (geo, m, x, y, z) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    crane.add(mesh);
    return mesh;
  };
  cadd(new THREE.BoxGeometry(0.8, 14.7, 0.8), craneMat, -22, 7.35, -30); // leg W
  cadd(new THREE.BoxGeometry(0.8, 14.7, 0.8), craneMat, -18, 7.35, -30); // leg E
  cadd(new THREE.BoxGeometry(5.6, 0.7, 0.7), craneMat, -20, 14.7, -30); // top beam
  cadd(new THREE.BoxGeometry(16, 0.6, 0.6), craneMat, -12, 14.1, -30); // jib (east reach)
  cadd(new THREE.BoxGeometry(4, 0.5, 0.5), craneMat, -25, 14.1, -30); // counter-jib
  cadd(new THREE.BoxGeometry(1.6, 1.4, 1.4), craneMat, -20, 13.3, -30); // cab
  cadd(new THREE.BoxGeometry(0.06, 4.5, 0.06), craneMat, -8, 11.7, -30); // hook cable
  cadd(new THREE.BoxGeometry(0.7, 0.9, 0.7), craneMat, -8, 9.1, -30); // hook block
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff5a3c }));
  beacon.position.set(-4.2, 14.5, -30);
  crane.add(beacon);
  group.add(crane);

  // --- cover pieces, dressed: same boxes, same colliders, real surfaces ---
  const woodTexA = texWood(PALETTE.crateWood, 3, 'DEPOT 9');
  const woodTexB = texWood(PALETTE.crateOlive, 5, 'FERROLINE');
  const corrTeal = texCorrugated(PALETTE.wagonTeal, 5, 2, 1);
  const corrRust = texCorrugated(PALETTE.wagonRust, 6, 2, 1);
  const corrGrey = texCorrugated(0x4a4a44, 7, 3, 1);
  const hazardTex = texHazard(2, 1);
  let crateIdx = 0;
  for (const [cx, cz, w, h, d, key] of COVER) {
    let material;
    let isCrate = false, isWagon = false, isPump = false;
    if (key === 'hairline') { isCrate = true; material = texMat(crateIdx % 2 ? woodTexB : woodTexA, 0.85); crateIdx++; }
    else if (key === 'wagonTeal') { isWagon = true; material = texMat(corrTeal, 0.55, 0.25); }
    else if (key === 'wagonRust') { isWagon = true; material = texMat(corrRust, 0.6, 0.2); }
    else if (w === 8) { isPump = true; material = texMat(corrGrey, 0.7, 0.15); }
    else { material = texMat(texConcrete(PALETTE.surface, 13, 1, 1), 0.9); }
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(cx, h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); shootables.push(m);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
    // Dressing, all visual-only and inside (or on top of) the collider box.
    if (isCrate) {
      // Steel corner straps so the crate reads as banded timber, not a cube.
      // F1: the old 0.06-wide strap centred at +-(w/2-0.03) had its outer
      // faces EXACTLY on the crate faces (gap 0) — the whole crate side
      // shimmered while walking. Now 0.10 wide at +-(w/2-0.02): 30 mm
      // proud on the sides, 30 mm proud front/back.
      const strapMat = mat(PALETTE.roofDark, 0.6, 0.4);
      for (const sx of [-w / 2 + 0.02, w / 2 - 0.02]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.10, h - 0.06, d + 0.06), strapMat);
        strap.position.set(cx + sx, h / 2, cz);
        group.add(strap);
      }
    }
    if (isWagon) {
      // Roof slab + walkway, side ribs, and a roof vent box.
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.12, d + 0.2), mat(PALETTE.roofDark, 0.7, 0.2));
      roof.position.set(cx, h + 0.06, cz);
      roof.castShadow = true;
      group.add(roof);
      const ribMat = mat(PALETTE.roofDark, 0.6, 0.3);
      const ribs = Math.max(2, Math.floor(w / 1.3));
      for (let i = 0; i < ribs; i++) {
        const rx = cx - w / 2 + 0.4 + (i * (w - 0.8)) / Math.max(1, ribs - 1);
        for (const rz of [cz - d / 2 - 0.005, cz + d / 2 + 0.005]) {
          const rib = new THREE.Mesh(new THREE.BoxGeometry(0.14, h - 0.3, 0.05), ribMat);
          rib.position.set(rx, h / 2, rz);
          group.add(rib);
        }
      }
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.5), mat(PALETTE.hairline, 0.7));
      vent.position.set(cx + w / 4, h + 0.24, cz);
      group.add(vent);
    }
    if (isPump) {
      // Roof overhang, door on the south face, roof vent, hazard base band.
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.14, d + 0.3), mat(PALETTE.roofDark, 0.7, 0.2));
      roof.position.set(cx, h + 0.07, cz);
      roof.castShadow = true;
      group.add(roof);
      // F4: door 30 mm proud of the pump face (20 mm proud of the hazard
      // band front) — it used to sit exactly on the band's front face.
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.8), mat(PALETTE.wallTrim, 0.8));
      door.position.set(cx - 2, 0.9, cz + d / 2 + 0.03);
      group.add(door);
      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.04), mat(PALETTE.hazardYellow, 0.7));
      doorFrame.position.set(cx - 2, 1.84, cz + d / 2 + 0.045);
      group.add(doorFrame);
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), mat(PALETTE.hairline, 0.7));
      vent.position.set(cx + 2.4, h + 0.3, cz);
      vent.castShadow = true;
      group.add(vent);
      // F5: band 20 mm proud (was 10 mm) so it can never tie with a face.
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.28, d + 0.04), texMat(hazardTex, 0.8));
      band.position.set(cx, 0.14, cz);
      group.add(band);
      // A barrel and a small crate parked on the pump-house roof (out of
      // reach, so no collider is ever needed for them).
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 0.8, 14),
        texMat(texCorrugated(PALETTE.wagonRust, 12, 1, 1), 0.6, 0.2));
      barrel.position.set(cx - 2.6, h + 0.14 + 0.4, cz - 0.8);
      barrel.castShadow = true;
      group.add(barrel);
      const roofCrate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), texMat(woodTexA, 0.85));
      roofCrate.position.set(cx + 1.2, h + 0.14 + 0.45, cz + 0.9);
      roofCrate.rotation.y = 0.4;
      roofCrate.castShadow = true;
      group.add(roofCrate);
    }
    if (w === 2 && h === 2.2 && key === 'surface') {
      // Gantry legs: hazard base band + a small conduit up the inner face.
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.3, d + 0.04), texMat(hazardTex, 0.8));
      band.position.set(cx, 0.15, cz);
      group.add(band);
    }
  }

  // --- extra set dressing: barrels, sandbags, cables, signs ---
  // Barrels: solid props with honest colliders + shootables, tucked in
  // dead zones (corners, against walls) so no lane or sightline closes.
  const barrelTexRust = texCorrugated(PALETTE.wagonRust, 12, 1, 1);
  const barrelTexTeal = texCorrugated(PALETTE.wagonTeal, 14, 1, 1);
  const barrelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.8, 14);
  function addBarrel(x, z, teal) {
    const b = new THREE.Mesh(barrelGeo, texMat(teal ? barrelTexTeal : barrelTexRust, 0.6, 0.2));
    b.position.set(x, 0.4, z);
    b.castShadow = true; b.receiveShadow = true;
    group.add(b); shootables.push(b);
    colliders.push({ minX: x - 0.32, maxX: x + 0.32, minZ: z - 0.32, maxZ: z + 0.32, h: 0.8 });
  }
  for (const [x, z, teal] of [[-28, -20.5, false], [-27.2, -19.6, true], [-28.4, -19.2, false], [28, -20.5, true], [27.2, -19.6, false], [28.4, -19.2, true]]) addBarrel(x, z, teal);
  // Sandbag rows flanking the south spawn wall (low, behind the spawn).
  const bagMat = texMat(texSand(PALETTE.sandDark, 81, 2, 1), 1.0);
  const bagGeo = new THREE.SphereGeometry(0.42, 10, 8);
  function addSandbags(cx, cz, n) {
    for (let i = 0; i < n; i++) {
      const bag = new THREE.Mesh(bagGeo, bagMat);
      bag.scale.set(1, 0.42, 0.62);
      bag.position.set(cx - (n - 1) * 0.45 + i * 0.9, 0.16, cz + (i % 2) * 0.12);
      bag.rotation.y = (i % 2) * 0.3;
      bag.castShadow = true; bag.receiveShadow = true;
      group.add(bag); shootables.push(bag);
    }
    colliders.push({ minX: cx - n * 0.45, maxX: cx + n * 0.45, minZ: cz - 0.35, maxZ: cz + 0.35, h: 0.4 });
  }
  addSandbags(-8, 20.5, 4); addSandbags(8, 20.5, 4);
  // Hanging cables from the gantry beam (above head height, no collider).
  const cableMat2 = mat(PALETTE.roofDark, 0.8);
  for (const x of [-8, 8]) {
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 4), cableMat2);
    cab.position.set(x, 2.75, 11);
    group.add(cab);
  }
  // Wall signs on the north wall (40 mm off the face, like the site signs).
  for (const sg of [{ text: 'DEPOT 9', sub: 'FREIGHT TERMINAL', col: PALETTE.accent, x: -8 }, { text: 'PLATFORM 2', sub: 'MIND THE GAP', col: PALETTE.ink, x: 8 }]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25),
      new THREE.MeshBasicMaterial({ map: texFloorText(sg.text, sg.col, sg.sub), transparent: true, opacity: 0.95 }));
    sign.position.set(sg.x, 3.6, -21.96);
    group.add(sign);
  }
  // Crates parked on the wagon roofs (out of reach, no collider needed).
  for (const [x, z] of [[-3, -3], [3, -3], [0, 5]]) {
    const rc = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), texMat(woodTexA, 0.85));
    rc.position.set(x + 1, 3.17, z);
    rc.rotation.y = 0.35;
    rc.castShadow = true;
    group.add(rc);
  }

  // --- plant zones: painted markings, frames, wall signs ---
  const zoneMats = {};
    // F3: decal stack re-layered (strip 0.06 -> zone 0.09 -> letter 0.115
    // -> bracket arms 0.14 / 0.165) with polygonOffset per layer. F2: the
    // two arms of one corner no longer share a plane (they overlapped in
    // the 0.3x0.3 corner square at exactly the same height).
  for (const [name, s] of Object.entries(MAP.sites)) {
    const col = PALETTE[s.colour];
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      decalBasic({ color: col, transparent: true, opacity: 0.10, side: THREE.DoubleSide }, -2));
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(s.x, 0.09, s.z);
    group.add(zone);
    zoneMats[name] = zone;
    // Big painted site letter in a ring, readable from across the map.
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 5.5),
      decalBasic({ map: texSiteLetter(name, col), transparent: true, opacity: 0.95, depthWrite: false }, -3));
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(s.x, 0.115, s.z);
    group.add(letter);
    // Painted corner brackets framing the 8x8 plant zone.
    const bracketMatX = decalBasic({ color: col, transparent: true, opacity: 0.85 }, -4);
    const bracketMatZ = decalBasic({ color: col, transparent: true, opacity: 0.85 }, -5);
    const B = 4, L = 1.6, T = 0.3;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const bx = new THREE.Mesh(new THREE.PlaneGeometry(L, T), bracketMatX);
      bx.rotation.x = -Math.PI / 2;
      bx.position.set(s.x + sx * B - sx * L / 2 + sx * T / 2, 0.14, s.z + sz * B);
      group.add(bx);
      const bz = new THREE.Mesh(new THREE.PlaneGeometry(T, L), bracketMatZ);
      bz.rotation.x = -Math.PI / 2;
      bz.position.set(s.x + sx * B, 0.165, s.z + sz * B - sz * L / 2 + sz * T / 2);
      group.add(bz);
    }
    // Hazard border strips along the zone's south edge (the approach).
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.5), decalStd(texHazard(4, 1), 0.85, -1));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(s.x, 0.06, s.z + 4.25);
    group.add(strip);
    // Site sign board high on the north wall above the shed.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.5),
      new THREE.MeshBasicMaterial({ map: texFloorText(`SITE ${name}`, col, 'PLANT ZONE'), transparent: true, opacity: 0.95 }));
    sign.position.set(s.x, 3.6, -21.96);
    group.add(sign);
  }

  // --- spawn markings: painted crew names on the floor ---
  const spawnMarks = [
    { text: 'BREAKERS', sub: 'ATTACK — PLANT THE CHARGE', col: PALETTE.accent, x: 0, z: 19.5, ry: Math.PI },
    { text: 'WARDENS', sub: 'DEFEND — HOLD THE SHEDS', col: PALETTE.defenderBlue, x: 0, z: -19.5, ry: 0 },
  ];
  for (const sm of spawnMarks) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 1.75),
      decalBasic({ map: texFloorText(sm.text, sm.col, sm.sub), transparent: true, opacity: 0.9, depthWrite: false }, -1));
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = sm.ry;
    p.position.set(sm.x, 0.06, sm.z);
    group.add(p);
  }

  // Signal gantry beam over Mid — visual only, NO collider: bullets pass.
  const beam = new THREE.Mesh(new THREE.BoxGeometry(28, 0.4, 0.6), mat(PALETTE.hairline, 0.6));
  beam.position.set(0, 3.4, 11);
  beam.castShadow = true;
  group.add(beam);
  // Hanging signal head under the beam: dark housing + red/green lamps.
  const sigBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.25), mat(PALETTE.roofDark, 0.7));
  sigBox.position.set(0, 2.95, 11);
  group.add(sigBox);
  const sigRed = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: PALETTE.dangerRed }));
  sigRed.position.set(0, 3.1, 10.86);
  group.add(sigRed);
  const sigGreen = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0x3ddc78 }));
  sigGreen.position.set(0, 2.82, 10.86);
  group.add(sigGreen);
  // Support cables from the beam to the gantry legs (thin, dark).
  const cableMat = mat(PALETTE.roofDark, 0.8);
  for (const sx of [-13, 13]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.35, 4), cableMat);
    cable.position.set(sx, 2.75, 11);
    cable.rotation.z = sx < 0 ? 0.5 : -0.5;
    group.add(cable);
  }

  // --- atmosphere: drifting dust motes + low sun shafts ---
  // Shafts moved out to the flanks and narrowed: the old centre shafts
  // (x=8/-10, w=7/6, op 0.05) read as a giant pale triangle when the
  // player looked through one, and were invisible the rest of the time.
  addDustMotes(group, Q, 11, 200, { x: 30, z: 20 }, 5);
  addLightShafts(group, Q, [
    [18, 7, -4, 5, 18, -0.6, 0.3, 0.10],
    [-18, 7, -8, 4.5, 16, -0.6, 0.9, 0.08],
    [16, 7, 10, 4, 15, -0.6, -0.4, 0.07],
  ]);

  // --- dawn lighting: warm key, cool sky fill, warm south bounce ---
  // The depot reads at a glance now: the hemisphere fill is strong
  // enough that no face the player can stand on or shoot across sits
  // near black, and the south bounce below lights the far wall the
  // sun only grazes (its inner face points south, away from the key).
  const sun = new THREE.DirectionalLight(0xffc27a, 4.2);
  sun.position.set(20, 14, 6);
  applySunQuality(sun, Q);
  sun.shadow.camera.left = -34; sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  // Cool dawn sky above, warm ground bounce below: the floor and the
  // walls facing away from the sun read as concrete, not void.
  scene.add(new THREE.HemisphereLight(0x8fa8cc, 0x6b5a48, 2.6));
  const fill = new THREE.DirectionalLight(0x9db4d6, 1.6);
  fill.position.set(-12, 10, -14);
  scene.add(fill);
  // Warm bounce from the south, behind the player: it is the only
  // light that reaches the south-facing sides of the far wall, the
  // wagons and the pump house — the faces the player looks at when
  // holding an angle to the north. Without it those faces sit black
  // no matter how bright the sun is, because the sun comes from the
  // south-east and only grazes them.
  const bounce = new THREE.DirectionalLight(0xffd9a8, 4.0);
  bounce.position.set(0, 14, 26);
  scene.add(bounce);
  // Fog in a dawn blue-grey that matches the sky, pushed out so the
  // far wall and both sites stay clear across the map instead of
  // sinking into black at twenty metres.
  scene.fog = new THREE.Fog(0x46536b, 18, 90);

  return { group, colliders, shootables, sites: MAP.sites, zoneMats, sun, quality: Q };
}

// ---------------------------------------------------------------------------
// Shared builder helpers (FOUNDRY-7 + DUSTLINE; DEPOT 9 keeps its own
// inline code above, untouched).
// ---------------------------------------------------------------------------

// Outer walls from the map def: box + collider + shootable per side.
// opts: { coping: bool, merlons: bool } — depot-style rim dressing.
function addWalls(group, colliders, shootables, def, wallMat, opts = {}) {
  const b = def.bounds;
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const wallDefs = [
    { x: cx, z: b.minZ - 0.2, w: w + 0.8, d: 0.4 },
    { x: cx, z: b.maxZ + 0.2, w: w + 0.8, d: 0.4 },
    { x: b.minX - 0.2, z: cz, w: 0.4, d: d + 0.8 },
    { x: b.maxX + 0.2, z: cz, w: 0.4, d: d + 0.8 },
  ];
  for (const wd of wallDefs) {
    // F8: side (E/W) walls render 20 mm further out and 20 mm lower so no
    // two wall / coping faces share a plane at the corners. Mesh only:
    // the collider still uses wd + def.wallH exactly.
    const side = wd.w < wd.d;
    const drop = side ? 0.02 : 0;
    const out = side ? Math.sign(wd.x) * 0.02 : 0;
    const meshH = def.wallH - drop;
    const m = new THREE.Mesh(new THREE.BoxGeometry(wd.w, meshH, wd.d), wallMat);
    m.position.set(wd.x + out, meshH / 2, wd.z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); shootables.push(m);
    colliders.push({ minX: wd.x - wd.w / 2, maxX: wd.x + wd.w / 2, minZ: wd.z - wd.d / 2, maxZ: wd.z + wd.d / 2, h: def.wallH });
    if (opts.coping) {
      const coping = new THREE.Mesh(new THREE.BoxGeometry(wd.w + 0.15, 0.18, wd.d + 0.15), mat(PALETTE.wallTrim, 0.85));
      coping.position.set(wd.x + out, def.wallH - drop + 0.09, wd.z);
      coping.castShadow = true;
      group.add(coping);
    }
    if (opts.merlons) {
      // F6: 0.65 deep so merlon faces stand 50 mm proud of the coping.
      const along = wd.w > wd.d ? 'x' : 'z';
      const len = along === 'x' ? wd.w : wd.d;
      const n = Math.floor(len / 4);
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + 2 + i * 4;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? 1.6 : 0.65, 0.55, along === 'x' ? 0.65 : 1.6), wallMat);
        merlon.position.set(
          along === 'x' ? wd.x + t : wd.x + out,
          def.wallH - drop + 0.18 + 0.27,
          along === 'x' ? wd.z : wd.z + t);
        merlon.castShadow = true;
        group.add(merlon);
      }
    }
  }
}

// Plant zones: painted zone plane, site letter, corner brackets, hazard
// strip on the approach edge, and a sign board on the north wall.
// signZ = inner face of the north wall; signY = sign height.
function addSiteZones(group, def, zoneMats, signZ, signY) {
    // F3: decal stack re-layered (strip 0.06 -> zone 0.09 -> letter 0.115
    // -> bracket arms 0.14 / 0.165) with polygonOffset per layer. F2: the
    // two arms of one corner no longer share a plane.
  for (const [name, s] of Object.entries(def.sites)) {
    const col = PALETTE[s.colour];
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      decalBasic({ color: col, transparent: true, opacity: 0.10, side: THREE.DoubleSide }, -2));
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(s.x, 0.09, s.z);
    group.add(zone);
    zoneMats[name] = zone;
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 5.5),
      decalBasic({ map: texSiteLetter(name, col), transparent: true, opacity: 0.95, depthWrite: false }, -3));
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(s.x, 0.115, s.z);
    group.add(letter);
    const bracketMatX = decalBasic({ color: col, transparent: true, opacity: 0.85 }, -4);
    const bracketMatZ = decalBasic({ color: col, transparent: true, opacity: 0.85 }, -5);
    const B = 4, L = 1.6, T = 0.3;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const bx = new THREE.Mesh(new THREE.PlaneGeometry(L, T), bracketMatX);
      bx.rotation.x = -Math.PI / 2;
      bx.position.set(s.x + sx * B - sx * L / 2 + sx * T / 2, 0.14, s.z + sz * B);
      group.add(bx);
      const bz = new THREE.Mesh(new THREE.PlaneGeometry(T, L), bracketMatZ);
      bz.rotation.x = -Math.PI / 2;
      bz.position.set(s.x + sx * B, 0.165, s.z + sz * B - sz * L / 2 + sz * T / 2);
      group.add(bz);
    }
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.5), decalStd(texHazard(4, 1), 0.85, -1));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(s.x, 0.06, s.z + 4.25);
    group.add(strip);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.5),
      new THREE.MeshBasicMaterial({ map: texFloorText(`SITE ${name}`, col, 'PLANT ZONE'), transparent: true, opacity: 0.95 }));
    sign.position.set(s.x, signY, signZ);
    group.add(sign);
  }
}

// Painted crew names on the floor at both spawns.
function addSpawnMarks(group, def) {
  const spawnMarks = [
    { text: 'BREAKERS', sub: 'ATTACK — PLANT THE CHARGE', col: PALETTE.accent, x: def.attackerSpawn.x, z: def.attackerSpawn.z, ry: Math.PI },
    { text: 'WARDENS', sub: 'DEFEND — HOLD THE SITE', col: PALETTE.defenderBlue, x: def.defenderSpawn.x, z: def.defenderSpawn.z, ry: 0 },
  ];
  for (const sm of spawnMarks) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 1.75),
      decalBasic({ map: texFloorText(sm.text, sm.col, sm.sub), transparent: true, opacity: 0.9, depthWrite: false }, -1));
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = sm.ry;
    p.position.set(sm.x, 0.06, sm.z);
    group.add(p);
  }
}

// Lighting rig from a config: directional sun (+shadow), hemisphere,
// optional fill/bounce directionals, fog. Returns the sun.
function addLighting(scene, def, Q, cfg) {
  const b = def.bounds;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const sun = new THREE.DirectionalLight(cfg.sunColor, cfg.sunIntensity);
  sun.position.set(...cfg.sunPos);
  applySunQuality(sun, Q);
  sun.shadow.camera.left = -span - 6; sun.shadow.camera.right = span + 6;
  sun.shadow.camera.top = span + 6; sun.shadow.camera.bottom = -span - 6;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = cfg.sunFar || 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(cfg.hemiSky, cfg.hemiGround, cfg.hemiIntensity));
  if (cfg.fill) {
    const fill = new THREE.DirectionalLight(cfg.fill.color, cfg.fill.intensity);
    fill.position.set(...cfg.fill.pos);
    scene.add(fill);
  }
  if (cfg.bounce) {
    const bounce = new THREE.DirectionalLight(cfg.bounce.color, cfg.bounce.intensity);
    bounce.position.set(...cfg.bounce.pos);
    scene.add(bounce);
  }
  scene.fog = new THREE.Fog(cfg.fogColor, cfg.fogNear, cfg.fogFar);
  return sun;
}

// ---------------------------------------------------------------------------
// FOUNDRY-7 — enclosed industrial warehouse / factory interior.
// Smaller than DEPOT 9 (44 x 32), taller walls (7 m), warm sodium lamps,
// orange/grey palette, dark moody atmosphere. Roof trusses overhead and
// a crane beam sell the interior; there is no ceiling mesh, so the warm
// key light still reaches the floor.
// ---------------------------------------------------------------------------
function buildFoundry(scene, Q) {
  const def = MAPS.foundry;
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];
  const zoneMats = {};
  const b = def.bounds;

  // Dark smoky interior sky (no sun disc, no clouds, no mountains).
  scene.background = texSkyFoundry();

  // Floor: dark oiled concrete + oil stains + hazard lane markings.
  const floorTex = texConcrete(PALETTE.foundryFloor, 41, 6, 5);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(44, 0.2, 32), texMat(floorTex, 0.95));
  floor.position.set(0, -0.1, 0);
  floor.receiveShadow = true;
  group.add(floor);
  const oilMat = new THREE.MeshStandardMaterial({ color: PALETTE.groundOil, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  for (const [x, z, w, d, r] of [[-6, 6, 2.6, 1.6, 0.4], [12, -6, 2.2, 1.4, 1.1], [-16, 6, 1.8, 1.2, 2.0], [4, 12, 2.4, 1.5, 0.9], [16, 8, 1.6, 1.1, 0.2]]) {
    const o = new THREE.Mesh(new THREE.CircleGeometry(1, 20), oilMat);
    o.rotation.x = -Math.PI / 2; o.rotation.z = r;
    o.scale.set(w / 2, d / 2, 1);
    o.position.set(x, 0.036, z);
    group.add(o);
  }
  // Hazard stripes along the two approach lanes.
  const hazardTex = texHazard(3, 1);
  for (const x of [-18, 18]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 26), decalStd(hazardTex, 0.85, -1));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.035, 0);
    group.add(strip);
  }

  // Walls: riveted steel panels, coping on top, no merlons (interior).
  const wallTex = texMetalPanel(PALETTE.foundryWall, 37, 8, 3);
  addWalls(group, colliders, shootables, def, texMat(wallTex, 0.75, 0.25), { coping: true });

  // Roof trusses overhead (visual only): dark steel beams + a yellow
  // crane beam with a hoist block, so the space reads as a factory hall.
  const trussMat = mat(PALETTE.foundryDark, 0.7, 0.3);
  for (const z of [-12, -4, 4, 12]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(44, 0.5, 0.8), trussMat);
    beam.position.set(0, 6.8, z);
    beam.castShadow = true;
    group.add(beam);
  }
  const crane = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 0.6), mat(PALETTE.hazardYellow, 0.6, 0.2));
  crane.position.set(0, 6.2, 2);
  crane.castShadow = true;
  group.add(crane);
  const hoist = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.8), mat(PALETTE.foundrySteel, 0.6, 0.4));
  hoist.position.set(-6, 5.55, 2);
  group.add(hoist);
  const hookCable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4), mat(PALETTE.roofDark, 0.8));
  hookCable.position.set(-6, 4.6, 2);
  group.add(hookCable);

  // Cover pieces, dressed per kind. Every piece: one mesh, one AABB
  // collider, one raycast shootable — same contract as DEPOT 9.
  const woodTex = texWood(PALETTE.crateWood, 43, 'FOUNDRY-7');
  const corrRust = texCorrugated(PALETTE.wagonRust, 45, 2, 1);
  const steelTex = texMetalPanel(PALETTE.foundrySteel, 47, 2, 1);
  const pipeTex = texCorrugated(PALETTE.pipeRust, 49, 2, 1);
  const hazardMat = texMat(hazardTex, 0.8);
  for (const [cx, cz, w, h, d, kind] of COVER_FOUNDRY) {
    let material;
    if (kind === 'crate' || kind === 'crates') material = texMat(woodTex, 0.85);
    else if (kind === 'pipe') material = texMat(pipeTex, 0.55, 0.3);
    else if (kind === 'furnace' || kind === 'press') material = texMat(steelTex, 0.6, 0.35);
    else if (kind === 'conveyor') material = texMat(texConcrete(PALETTE.foundrySteel, 51, 2, 1), 0.9);
    else material = texMat(texConcrete(PALETTE.foundryWall, 53, 1, 1), 0.9);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(cx, h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); shootables.push(m);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
    if (kind === 'furnace') {
      // Glowing furnace mouth on the south face + chimney stack on top.
      // Mouth plane sits clearly in front of its frame (frame front at
      // face+0.02, mouth at face+0.05), so the ember rectangle reads.
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6),
        new THREE.MeshBasicMaterial({ color: PALETTE.furnaceGlow }));
      mouth.position.set(cx, 1.3, cz + d / 2 + 0.05);
      group.add(mouth);
      const mouthFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.0, 0.04), mat(PALETTE.foundryDark, 0.7, 0.3));
      mouthFrame.position.set(cx, 1.3, cz + d / 2 + 0.005);
      group.add(mouthFrame);
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 3.4, 12), texMat(pipeTex, 0.6, 0.3));
      stack.position.set(cx - 3, h + 1.7, cz);
      stack.castShadow = true;
      group.add(stack);
      // Hazard base band.
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.28, d + 0.04), hazardMat);
      band.position.set(cx, 0.14, cz);
      group.add(band);
    }
    if (kind === 'press') {
      // Piston head on top + hazard band + side vent.
      const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 12), mat(PALETTE.foundrySteel, 0.5, 0.5));
      piston.position.set(cx, h + 0.45, cz);
      piston.castShadow = true;
      group.add(piston);
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.28, d + 0.04), hazardMat);
      band.position.set(cx, 0.14, cz);
      group.add(band);
    }
    if (kind === 'conveyor') {
      // Belt rollers: dark cylinders along the top edge.
      const rollerMat = mat(PALETTE.roofDark, 0.5, 0.5);
      for (let i = 0; i < 6; i++) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, d - 0.2, 10), rollerMat);
        roller.rotation.x = Math.PI / 2;
        roller.position.set(cx - w / 2 + 0.8 + i * 1.7, h + 0.05, cz);
        group.add(roller);
      }
    }
    if (kind === 'crates') {
      // Second crate stacked on top, offset and rotated.
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), texMat(woodTex, 0.85));
      top.position.set(cx + 0.3, h + 0.55, cz);
      top.rotation.y = 0.5;
      top.castShadow = true;
      group.add(top);
    }
    if (kind === 'rack') {
      // Shelf bars on the south face.
      const barMat = mat(PALETTE.foundryDark, 0.7, 0.3);
      for (const by of [1.0, 2.0]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.08, 0.06), barMat);
        bar.position.set(cx, by, cz + d / 2 + 0.01);
        group.add(bar);
      }
    }
  }

  // Pipes running along the top of the walls (visual only).
  const pipeRunMat = texMat(pipeTex, 0.55, 0.3);
  for (const z of [b.minZ + 0.6, b.maxZ - 0.6]) {
    const run = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 44, 10), pipeRunMat);
    run.rotation.z = Math.PI / 2;
    run.position.set(0, 5.6, z);
    group.add(run);
  }
  for (const x of [b.minX + 0.6, b.maxX - 0.6]) {
    const run = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 32, 10), pipeRunMat);
    run.rotation.x = Math.PI / 2;
    run.position.set(x, 5.6, 0);
    group.add(run);
  }

  // Sodium lamps: hanging heads with warm glow + real point lights.
  const lampMat = mat(PALETTE.foundrySteel, 0.6, 0.4);
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: PALETTE.sodium });
  const lampSpots = [[-11, -2], [11, -2], [0, 8], [-16, -10], [16, -10]];
  for (const [x, z] of lampSpots) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 4), mat(PALETTE.roofDark, 0.8));
    cable.position.set(x, 6.1, z);
    group.add(cable);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.3, 12), lampMat);
    head.position.set(x, 5.35, z);
    group.add(head);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), lampGlowMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(x, 5.18, z);
    group.add(glow);
    const pl = new THREE.PointLight(PALETTE.sodium, 110, 24, 1.8);
    pl.position.set(x, 5.0, z);
    scene.add(pl);
  }
  // Furnace ember light.
  const furnaceLight = new THREE.PointLight(PALETTE.furnaceGlow, 85, 18, 1.8);
  furnaceLight.position.set(0, 1.6, -3.2);
  scene.add(furnaceLight);

  // --- extra set dressing: barrels, hanging chains, wall pipes, grate ---
  const fBarrelTex = texCorrugated(PALETTE.pipeRust, 55, 1, 1);
  const fBarrelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.8, 14);
  function addFBarrel(x, z) {
    const b = new THREE.Mesh(fBarrelGeo, texMat(fBarrelTex, 0.6, 0.2));
    b.position.set(x, 0.4, z);
    b.castShadow = true; b.receiveShadow = true;
    group.add(b); shootables.push(b);
    colliders.push({ minX: x - 0.32, maxX: x + 0.32, minZ: z - 0.32, maxZ: z + 0.32, h: 0.8 });
  }
  for (const [x, z] of [[-20.5, -8], [-19.7, -7.1], [20.5, -8], [19.7, -7.1], [-20.5, 12], [20.5, 12]]) addFBarrel(x, z);
  // Hanging chains from the roof trusses (above head height).
  const chainMat = mat(PALETTE.foundryDark, 0.7, 0.3);
  for (const [x, z] of [[-6, -12], [6, -4], [-6, 4], [6, 12]]) {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 4), chainMat);
    ch.position.set(x, 6.0, z);
    group.add(ch);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.06), chainMat);
    hook.position.set(x, 5.2, z);
    group.add(hook);
  }
  // Vertical pipes down the north wall (solid: thin colliders).
  const vPipeMat = texMat(pipeTex, 0.55, 0.3);
  for (const x of [-16, -8, 8, 16]) {
    const vp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5.4, 10), vPipeMat);
    vp.position.set(x, 2.9, b.minZ + 0.25);
    vp.castShadow = true;
    group.add(vp); shootables.push(vp);
    colliders.push({ minX: x - 0.15, maxX: x + 0.15, minZ: b.minZ, maxZ: b.minZ + 0.4, h: 5.6 });
  }
  // Floor grate in front of the furnace + wall signs.
  const grate = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.2), decalStd(texMetalPanel(PALETTE.foundryDark, 57, 1, 1), 0.9, -1));
  grate.rotation.x = -Math.PI / 2;
  grate.position.set(0, 0.05, -1.2);
  group.add(grate);
  for (const sg of [{ text: 'FOUNDRY-7', sub: 'MOLTEN STEEL', col: PALETTE.sodium, x: -8 }, { text: 'DANGER', sub: 'KEEP CLEAR', col: PALETTE.dangerRed, x: 8 }]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25),
      new THREE.MeshBasicMaterial({ map: texFloorText(sg.text, sg.col, sg.sub), transparent: true, opacity: 0.95 }));
    sign.position.set(sg.x, 4.6, b.minZ + 0.04);
    group.add(sign);
  }
  // --- atmosphere: dust motes + warm cones under two sodium lamps ---
  // Cones doubled in opacity: at 0.10/0.08 they were invisible, and the
  // foundry read as plain black instead of sodium-lit.
  addDustMotes(group, Q, 13, 150, { x: 20, z: 14 }, 5.5);
  addLampCone(group, Q, 0, 8, 5.2, PALETTE.sodium, 0.20);
  addLampCone(group, Q, -11, -2, 5.2, PALETTE.sodium, 0.16);

  addSiteZones(group, def, zoneMats, b.minZ + 0.04, 4.6);
  addSpawnMarks(group, def);

  // Lighting: dim warm key (through the roof gap), warm hemisphere,
  // no fill/bounce — the sodium point lights do the mood work.
  const sun = addLighting(scene, def, Q, {
    sunColor: 0xffb45e, sunIntensity: 2.0, sunPos: [14, 20, 10], sunFar: 90,
    hemiSky: 0x4a3826, hemiGround: 0x1c1410, hemiIntensity: 2.4,
    fogColor: PALETTE.foundryFog, fogNear: 10, fogFar: 60,
  });
  return { group, colliders, shootables, sites: def.sites, zoneMats, sun, quality: Q };
}

// ---------------------------------------------------------------------------
// DUSTLINE — desert canyon outpost. Larger than DEPOT 9 (80 x 56), bright
// harsh noon sun, sand ground, sandstone mesas and boulders, long
// sightlines down the side lanes and across the central wash.
// ---------------------------------------------------------------------------
function buildDustline(scene, Q) {
  const def = MAPS.dustline;
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];
  const zoneMats = {};
  const b = def.bounds;

  // Bright desert sky dome (gradient + painted cloud streaks) + a big
  // high white sun with a halo + mesa ring + a few clouds. The old sky
  // was the same flat 4px gradient trick as DEPOT 9, and the old sun
  // disc (r 4, glow 0.5) sat out of the usual sightlines, unseen.
  addSkyDome(scene, group, 'desert');
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(6, 32),
    new THREE.MeshBasicMaterial({ color: PALETTE.desertSun, fog: false, transparent: true, opacity: 1 }));
  sunDisc.position.set(38, 42, -60);
  sunDisc.lookAt(0, 2, 0);
  group.add(sunDisc); atm(group, sunDisc, Q);
  // Harsh-noon halo around the sun disc. R2: same raise as DEPOT 9
  // (72 @ 0.85, 140 @ 0.38) — the old halo was invisible in stills.
  addSunGlow(group, Q, 38, 42, -60, 72, PALETTE.desertSun, 0.85);
  addSunGlow(group, Q, 38, 42, -60, 140, 0xfff2c0, 0.38);
  const mesaRing = new THREE.Mesh(
    new THREE.CylinderGeometry(120, 120, 36, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: texMesas(), side: THREE.BackSide, fog: false, transparent: true }));
  mesaRing.position.y = 18;
  group.add(mesaRing); atm(group, mesaRing, Q);
  const cloudMat = new THREE.MeshBasicMaterial({
    map: texCloud(7), transparent: true, depthWrite: false, fog: false, opacity: 0.9,
  });
  for (const [x, y, z, w, h] of [[-60, 42, -70, 60, 15], [50, 46, -60, 72, 17], [70, 40, 40, 52, 14], [-50, 44, 60, 64, 16], [0, 48, -80, 80, 16], [-80, 40, 30, 56, 14], [20, 44, 70, 60, 15]]) {
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cloudMat);
    cl.position.set(x, y, z);
    cl.lookAt(0, 4, 0);
    group.add(cl); atm(group, cl, Q);
  }

  // Floor: rippled sand + a darker dry wash down the middle + rock patches.
  const sandTex = texSand(PALETTE.sand, 31, 10, 7);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(80, 0.2, 56), texMat(sandTex, 1.0));
  floor.position.set(0, -0.1, 0);
  floor.receiveShadow = true;
  group.add(floor);
  const washTex = texSand(PALETTE.sandDark, 59, 2, 8);
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(7, 56), decalStd(washTex, 1.0, -1));
  wash.rotation.x = -Math.PI / 2;
  wash.position.set(0, 0.02, 0);
  wash.receiveShadow = true;
  group.add(wash);
  const rockTex = texConcrete(PALETTE.rockGrey, 61, 3, 2);
  for (const [x, z, w, d] of [[-36, -24, 7, 4], [36, -24, 7, 4], [-37, 22, 6, 4], [37, 22, 6, 4], [-12, -24, 8, 3], [14, 24, 8, 3]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), decalStd(rockTex, 1.0, -2));
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.04, z);
    p.receiveShadow = true;
    group.add(p);
  }
  // Scattered small rocks (visual only, flat enough to walk over).
  const pebbleMat = mat(PALETTE.rockGrey, 1.0);
  const pebbles = [
    [-10, -16, 0.5, 0.12, 0.4], [8, -20, 0.4, 0.1, 0.5], [20, 14, 0.6, 0.14, 0.35],
    [-24, 14, 0.45, 0.1, 0.4], [30, -6, 0.5, 0.12, 0.45], [-32, -6, 0.4, 0.1, 0.3],
    [4, 10, 0.55, 0.12, 0.4], [-4, 18, 0.4, 0.1, 0.35],
  ];
  for (const [x, z, w, h, d] of pebbles) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pebbleMat);
    r.position.set(x, h / 2 + 0.01, z);
    r.rotation.y = x * 0.7;
    r.castShadow = true; r.receiveShadow = true;
    group.add(r);
  }

  // Perimeter: canyon rock walls (sandstone strata, coping, no merlons —
  // the mesa ring beyond the walls is the skyline).
  const wallTex = texSandstone(PALETTE.sandstone, 63, 12, 2);
  addWalls(group, colliders, shootables, def, texMat(wallTex, 0.95), { coping: true });

  // Cover pieces, dressed per kind.
  const sandstoneTex = texSandstone(PALETTE.sandstone, 65, 2, 2);
  const sandstoneDarkTex = texSandstone(PALETTE.sandstoneDark, 67, 2, 1);
  const woodTex = texWood(PALETTE.crateWood, 69, 'DUSTLINE');
  const crateOliveTex = texWood(PALETTE.crateOlive, 71, 'OUTPOST');
  let crateIdx = 0;
  for (const [cx, cz, w, h, d, kind] of COVER_DUSTLINE) {
    let material;
    if (kind === 'crate') { material = texMat(crateIdx % 2 ? crateOliveTex : woodTex, 0.9); crateIdx++; }
    else if (kind === 'mesa' || kind === 'butte') material = texMat(sandstoneTex, 0.95);
    else if (kind === 'slab' || kind === 'boulder' || kind === 'fin') material = texMat(sandstoneDarkTex, 1.0);
    else if (kind === 'tower') material = texMat(texWood(PALETTE.crateWoodDark, 73, ''), 0.9);
    else if (kind === 'shack') material = texMat(woodTex, 0.9);
    else material = texMat(texSand(PALETTE.sandDark, 75, 2, 1), 1.0); // dune
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(cx, h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); shootables.push(m);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
    if (kind === 'mesa' || kind === 'butte') {
      // Cap rock: a slightly wider, darker slab on top.
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), texMat(sandstoneDarkTex, 1.0));
      cap.position.set(cx, h + 0.25, cz);
      cap.castShadow = true;
      group.add(cap);
      // A scrub bush on top (visual only, out of reach).
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), mat(0x5a6b35, 1.0));
      bush.position.set(cx + w / 4, h + 0.9, cz - d / 4);
      bush.scale.y = 0.6;
      group.add(bush);
    }
    if (kind === 'tower') {
      // Platform + railing + roof on the watchtower.
      const platform = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.2, d + 0.6), texMat(woodTex, 0.9));
      platform.position.set(cx, h + 0.1, cz);
      platform.castShadow = true;
      group.add(platform);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.0, 0.12, d + 1.0), mat(PALETTE.roofDark, 0.8));
      roof.position.set(cx, h + 2.2, cz);
      roof.castShadow = true;
      group.add(roof);
      for (const [px, pz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 6), mat(PALETTE.roofDark, 0.8));
        post.position.set(cx + px, h + 1.2, cz + pz);
        group.add(post);
      }
    }
    if (kind === 'shack') {
      // Pitched roof + door on the south face.
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.14, d + 0.4), mat(PALETTE.roofDark, 0.8));
      roof.position.set(cx, h + 0.07, cz);
      roof.castShadow = true;
      group.add(roof);
      // F4: door 30 mm proud of the shack face (was 10 mm).
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.8), mat(PALETTE.wallTrim, 0.8));
      door.position.set(cx, 0.9, cz + d / 2 + 0.03);
      group.add(door);
    }
    if (kind === 'boulder') {
      // Rounded top: a squashed icosahedron sitting on the box.
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), texMat(sandstoneDarkTex, 1.0));
      top.position.set(cx, h + 0.3, cz);
      top.scale.set(w / 2, 0.5, d / 2);
      top.castShadow = true;
      group.add(top);
    }
  }

  // Dead scrub bushes scattered in the open (visual only).
  const scrubMat = mat(0x6b6b3a, 1.0);
  for (const [x, z, s] of [[-18, -16, 0.8], [18, -18, 0.9], [-10, 10, 0.7], [12, 12, 0.8], [-28, 14, 0.9], [28, -14, 0.7], [4, -8, 0.6], [-4, 20, 0.7], [-24, -20, 0.8], [24, 20, 0.85], [-14, -10, 0.6], [10, 22, 0.75]]) {
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), scrubMat);
    bush.position.set(x, s * 0.45, z);
    bush.scale.y = 0.55;
    bush.castShadow = true;
    group.add(bush);
  }

  // --- extra set dressing: rocks, sandbags, barrels, cacti, signs ---
  const pebbleMat2 = mat(PALETTE.rockGrey, 1.0);
  for (const [x, z, w, h, d] of [[-16, -20, 0.7, 0.16, 0.5], [16, -22, 0.6, 0.14, 0.45], [-26, -12, 0.55, 0.12, 0.4], [26, 18, 0.65, 0.15, 0.5], [0, -20, 0.5, 0.1, 0.35], [-12, 22, 0.6, 0.13, 0.4]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pebbleMat2);
    r.position.set(x, h / 2 + 0.01, z);
    r.rotation.y = x * 0.7;
    r.castShadow = true; r.receiveShadow = true;
    group.add(r);
  }
  // Sandbag rows flanking the shacks.
  const dBagMat = texMat(texSand(PALETTE.sandDark, 83, 2, 1), 1.0);
  const dBagGeo = new THREE.SphereGeometry(0.42, 10, 8);
  function addDBags(cx, cz, n) {
    for (let i = 0; i < n; i++) {
      const bag = new THREE.Mesh(dBagGeo, dBagMat);
      bag.scale.set(1, 0.42, 0.62);
      bag.position.set(cx - (n - 1) * 0.45 + i * 0.9, 0.16, cz + (i % 2) * 0.12);
      bag.rotation.y = (i % 2) * 0.3;
      bag.castShadow = true; bag.receiveShadow = true;
      group.add(bag); shootables.push(bag);
    }
    colliders.push({ minX: cx - n * 0.45, maxX: cx + n * 0.45, minZ: cz - 0.35, maxZ: cz + 0.35, h: 0.4 });
  }
  addDBags(-31, 18, 4); addDBags(31, 18, 4);
  // Barrels by the shacks + cacti in the corners (solid, with colliders).
  const dBarrelTex = texCorrugated(PALETTE.wagonRust, 77, 1, 1);
  const dBarrelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.8, 14);
  for (const [x, z] of [[-33, 20.5], [33, 20.5], [-38, -20], [38, -20]]) {
    const b = new THREE.Mesh(dBarrelGeo, texMat(dBarrelTex, 0.6, 0.2));
    b.position.set(x, 0.4, z);
    b.castShadow = true; b.receiveShadow = true;
    group.add(b); shootables.push(b);
    colliders.push({ minX: x - 0.32, maxX: x + 0.32, minZ: z - 0.32, maxZ: z + 0.32, h: 0.8 });
  }
  const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4a6b2f, roughness: 0.9 });
  function addCactus(x, z) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 2.2, 8), cactusMat);
    trunk.position.y = 1.1; trunk.castShadow = true;
    g.add(trunk);
    for (const sx of [-1, 1]) {
      const conn = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.45, 8), cactusMat);
      conn.rotation.z = Math.PI / 2;
      conn.position.set(sx * 0.25, 1.2, 0);
      g.add(conn);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.7, 8), cactusMat);
      arm.position.set(sx * 0.42, 1.55, 0);
      arm.castShadow = true;
      g.add(arm);
    }
    g.position.set(x, 0, z);
    group.add(g);
    shootables.push(trunk);
    colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, h: 2.2 });
  }
  addCactus(-38, -24); addCactus(38, 24); addCactus(-38, 24);
  // Wall signs on the north wall.
  for (const sg of [{ text: 'DUSTLINE', sub: 'OUTPOST 7', col: PALETTE.sandLight, x: -8 }, { text: 'WATER', sub: '2 KM EAST', col: PALETTE.ink, x: 8 }]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25),
      new THREE.MeshBasicMaterial({ map: texFloorText(sg.text, sg.col, sg.sub), transparent: true, opacity: 0.95 }));
    sign.position.set(sg.x, 4.6, b.minZ + 0.04);
    group.add(sign);
  }
  // --- atmosphere: drifting dust motes ---
  addDustMotes(group, Q, 17, 220, { x: 36, z: 24 }, 5);

  addSiteZones(group, def, zoneMats, b.minZ + 0.04, 4.6);
  addSpawnMarks(group, def);

  // Lighting: harsh high noon sun, bright blue-sky hemisphere, cool fill
  // from the north-west, long heat-haze fog pushed far out.
  const sun = addLighting(scene, def, Q, {
    sunColor: 0xfff6da, sunIntensity: 4.6, sunPos: [30, 34, 12], sunFar: 160,
    hemiSky: 0xbfd9ff, hemiGround: 0xc9a06a, hemiIntensity: 2.3,
    fill: { color: 0x9db4d6, intensity: 1.2, pos: [-20, 14, -24] },
    fogColor: PALETTE.desertFog, fogNear: 40, fogFar: 140,
  });
  return { group, colliders, shootables, sites: def.sites, zoneMats, sun, quality: Q };
}

// ---------------------------------------------------------------------------
// Dispatcher: build any of the 3 maps. mapId defaults to 'depot9', so the
// existing call createWorld(scene) keeps building DEPOT 9 exactly as
// before. Re-points the live MAP binding first, so MAP.sites / MAP.bounds
// / MAP.capturePoints read the built map afterwards.
// ---------------------------------------------------------------------------
export function createWorld(scene, mapId = 'depot9') {
  MAP = MAPS[mapId] || MAPS.depot9;
  // Graphics quality tier (src/settings.js): low / medium / ultra.
  // The world scales its shadows, atmosphere extras and dust motes from
  // this preset; the renderer side (shadowMap.enabled, pixel ratio,
  // tone mapping) is the coordinator's job in main.js.
  const Q = qualityPreset(getSettings().quality);
  if (MAP.id === 'foundry') return buildFoundry(scene, Q);
  if (MAP.id === 'dustline') return buildDustline(scene, Q);
  return buildDepot9(scene, Q);
}

// Point-in-site test for plant checks.
export function siteAt(x, z) {
  for (const [name, s] of Object.entries(MAP.sites)) {
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return name;
  }
  return null;
}
