// world.js — DEPOT 9, a decommissioned mountain rail depot at dawn.
// MAP is data, not code: the build loop reads it, so the map is rebalanced
// by editing numbers. Open-field map: no interior walls, only the 16 cover
// pieces below plus the outer walls. Every cover piece is one mesh, one
// AABB collider and one raycast shootable.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

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

export const MAP = {
  bounds: { minX: -32, maxX: 32, minZ: -22, maxZ: 22 },
  wallH: 4.6,
  sites: {
    A: { x: -24, z: -14, minX: -28, maxX: -20, minZ: -18, maxZ: -10, plantX: -24, plantZ: -13, colour: 'accent' },
    B: { x: 24, z: -14, minX: 20, maxX: 28, minZ: -18, maxZ: -10, plantX: 24, plantZ: -13, colour: 'wagonTeal' },
  },
  attackerSpawn: { x: 0, z: 19.5 },
  defenderSpawn: { x: 0, z: -19.5 },
};

const _matCache = {};
function mat(color, rough) {
  const key = color + ':' + rough;
  if (!_matCache[key]) _matCache[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
  return _matCache[key];
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  // Floor: one big slab, ballast strip down the middle.
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(64, 0.2, 44),
    mat(PALETTE.groundConcrete, 0.95));
  floor.position.set(0, -0.1, 0);
  floor.receiveShadow = true;
  group.add(floor);
  const ballast = new THREE.Mesh(
    new THREE.BoxGeometry(64, 0.06, 6),
    mat(PALETTE.hairline, 0.95));
  ballast.position.set(0, 0.03, 0);
  ballast.receiveShadow = true;
  group.add(ballast);

  // Outer walls (4), each a collider.
  const wallDefs = [
    { x: 0, z: -22.2, w: 64.8, d: 0.4 }, { x: 0, z: 22.2, w: 64.8, d: 0.4 },
    { x: -32.2, z: 0, w: 0.4, d: 44.8 }, { x: 32.2, z: 0, w: 0.4, d: 44.8 },
  ];
  for (const wd of wallDefs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(wd.w, MAP.wallH, wd.d), mat(PALETTE.surface, 0.9));
    m.position.set(wd.x, MAP.wallH / 2, wd.z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); shootables.push(m);
    colliders.push({ minX: wd.x - wd.w / 2, maxX: wd.x + wd.w / 2, minZ: wd.z - wd.d / 2, maxZ: wd.z + wd.d / 2, h: MAP.wallH });
  }

  // Cover pieces.
  for (const [cx, cz, w, h, d, key] of COVER) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(PALETTE[key], key === 'wagonTeal' || key === 'wagonRust' ? 0.55 : 0.9));
    m.position.set(cx, h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m); shootables.push(m);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
  }

  // Plant zones: flat glowing frames on the floor + site letters from boxes.
  const zoneMats = {};
  for (const [name, s] of Object.entries(MAP.sites)) {
    const col = PALETTE[s.colour];
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.10, side: THREE.DoubleSide }));
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(s.x, 0.07, s.z);
    group.add(zone);
    zoneMats[name] = zone;
    // Site letter from thin boxes (no collider, no texture).
    const letter = new THREE.Group();
    const lm = new THREE.MeshBasicMaterial({ color: col });
    const bar = (w, d, x, z) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), lm);
      b.position.set(x, 0.06, z); letter.add(b);
    };
    if (name === 'A') {
      bar(0.3, 3, -0.9, 0); bar(0.3, 3, 0.9, 0); bar(2.1, 0.3, 0, -1.2); bar(1.2, 0.3, 0, 0.3);
    } else {
      bar(0.3, 3, -0.9, 0); bar(1.8, 0.3, 0, -1.35); bar(1.8, 0.3, 0, 0); bar(1.8, 0.3, 0, 1.35); bar(0.3, 1.5, 0.9, -0.7); bar(0.3, 1.5, 0.9, 0.7);
    }
    letter.position.set(s.x, 0, s.z);
    group.add(letter);
  }

  // Signal gantry beam over Mid — visual only, NO collider: bullets pass.
  const beam = new THREE.Mesh(new THREE.BoxGeometry(28, 0.4, 0.6), mat(PALETTE.hairline, 0.6));
  beam.position.set(0, 3.4, 11);
  group.add(beam);

  // Dawn light: warm key from the south-east, elevation ~34 deg.
  // The depot reads at a glance now: the hemisphere fill is strong
  // enough that no face the player can stand on or shoot across sits
  // near black, and the south bounce below lights the far wall the
  // sun only grazes (its inner face points south, away from the key).
  const sun = new THREE.DirectionalLight(0xffe0b3, 3.0);
  sun.position.set(20, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34; sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
  scene.add(sun);
  // Cool dawn sky above, warm ground bounce below: the floor and the
  // walls facing away from the sun read as concrete, not void.
  scene.add(new THREE.HemisphereLight(0x9db4d6, 0x5a5148, 2.4));
  const fill = new THREE.DirectionalLight(0x9db4d6, 1.8);
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
  scene.fog = new THREE.Fog(0x36455f, 14, 70);

  return { group, colliders, shootables, sites: MAP.sites, zoneMats, sun };
}

// Point-in-site test for plant checks.
export function siteAt(x, z) {
  for (const [name, s] of Object.entries(MAP.sites)) {
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return name;
  }
  return null;
}
