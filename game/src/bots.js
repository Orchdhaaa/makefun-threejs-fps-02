// bots.js — the nine bots: bodies, senses and the state machine.
// One controller; friend and foe differ only in team, spawn, role table
// and target selection. States are named per-state functions, not one giant
// step(): ROUTE, HOLD, ENGAGE, INVESTIGATE, PUSH, PLANT, GUARD, RETAKE,
// DEFUSE, HUNT (DESIGN §6.2). Difficulty is fixed: BOT_TUNING below.
// Bots never pick up the grenade and never throw one.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeFighter, FALLBACK_POINTS } from './state.js';
import { hitsCollider } from './player.js';
import { WEAPONS } from './weapons.js';
import { segmentBlockedBySmoke } from './fx.js';
import { MAP } from './world.js';

// Bot tuning — one table, the whole difficulty (DESIGN §6.4).
export const BOT_TUNING = {
  speed: 4.2, crouchSpeed: 2.0, // slower than the player (5.2)
  visionRange: 45, visionCone: 55, // degrees half-angle (110 total)
  hearShot: 22, hearStepRun: 10, hearStepWalk: 5, hearPlant: 15,
  reactionFoe: [0.45, 0.70], reactionFriend: [0.45, 0.70],
  aimBase: 0.014, aimPerMetre: 0.0008, aimCrouchMul: 1.4, aimMoveMul: 1.5, aimSprintMul: 1.3,
  aimHeadOnlyMul: 1.4, aimBloom: 0.004,
  burstRifle: 3, burstPause: 0.60, pistolInterval: 0.35, sniperWait: 1.5,
  eyeH: 1.5, chestH: 1.0, headH: 1.53, chestCrouchH: 0.62, headCrouchH: 0.96,
};

// --- map-generic site helpers -------------------------------------------
// MAP is the live binding re-pointed by createWorld(), so these read the
// CURRENT map on every call — never a hard-coded DEPOT 9 coordinate.
// Every formula below reproduces the old DEPOT 9 numbers exactly, so
// DEPOT 9 behaviour is unchanged; the other maps get their own sites,
// spawns and bounds instead.
//
//   siteDef / plantPoint / siteZone: a site's def, its plant point
//     (plantX/plantZ, falling back to the site centre) and its plant
//     rectangle (minX/maxX/minZ/maxZ, falling back to plant +/- 4).
//     The player's plant in main.js reads the same MAP.sites fields
//     (siteAt + plantX/plantZ), so bot and player plants now agree.
//   guardPosts(site): three hold posts around a site, offset from its
//     plant point and mirrored across the map centre. On DEPOT 9 they
//     land on the old hard-coded GUARD_A / GUARD_B coordinates exactly
//     ([-22,-7],[-19,-14],[-27,-17] for A, mirrored for B); on
//     FOUNDRY-7 / DUSTLINE they sit next to the real site instead of
//     outside the walls / inside a rock formation.
//   midLaneX(): the mid-lane x, one eighth of the map width (8 on
//     DEPOT 9, 5.5 on FOUNDRY-7, 10 on DUSTLINE).
//   laneRoutes() / huntRoute(): the lane and sweep routes, built from
//     the attacker/defender spawns and the plant points. On DEPOT 9
//     they are the old WEST / EAST / MID / RETAKE / HUNT tables
//     exactly; on the other maps they thread the same lanes to the
//     real sites. (RETAKE routes are kept for symmetry — the live
//     retake route is set map-generically by main.js on a plant.)
function siteDef(siteId) {
  const sites = MAP.sites || {};
  return sites[siteId] || sites.A;
}
function plantPoint(siteId) {
  const s = siteDef(siteId);
  return {
    x: s.plantX !== undefined ? s.plantX : s.x,
    z: s.plantZ !== undefined ? s.plantZ : s.z,
  };
}
function siteZone(siteId) {
  const s = siteDef(siteId);
  const p = plantPoint(siteId);
  return {
    minX: s.minX !== undefined ? s.minX : p.x - 4,
    maxX: s.maxX !== undefined ? s.maxX : p.x + 4,
    minZ: s.minZ !== undefined ? s.minZ : p.z - 4,
    maxZ: s.maxZ !== undefined ? s.maxZ : p.z + 4,
  };
}
function guardPosts(siteId) {
  const p = plantPoint(siteId);
  const b = MAP.bounds;
  const sign = p.x >= 0 ? 1 : -1;
  const dx = [-2, -5, 3], dz = [6, -1, -4];
  return dx.map((d, i) => [
    clamp(p.x + d * sign, b.minX + 1, b.maxX - 1),
    clamp(p.z + dz[i], b.minZ + 1, b.maxZ - 1),
  ]);
}
function midLaneX() { return (MAP.bounds.maxX - MAP.bounds.minX) / 8; }
function laneRoutes() {
  const a = MAP.attackerSpawn, d = MAP.defenderSpawn;
  const pa = plantPoint('A'), pb = plantPoint('B');
  const mx = midLaneX();
  return {
    west: [[a.x, a.z - 0.5], [pa.x + 11, a.z - 5.5], [pa.x + 4, a.z - 5.5],
      [pa.x + 4, a.z - 9.5], [pa.x + 1, pa.z + 8], [pa.x, pa.z]],
    east: [[a.x, a.z - 0.5], [pb.x - 11, a.z - 5.5], [pb.x - 4, a.z - 5.5],
      [pb.x - 4, a.z - 9.5], [pb.x - 1, pb.z + 8], [pb.x, pb.z]],
    mid: [[a.x, a.z - 0.5], [mx, a.z - 5.5], [mx, a.z - 9.5],
      [mx, pa.z + 15], [mx, pa.z + 5], [mx, pa.z]],
    retakeA: [[d.x, d.z], [pa.x + 16, pa.z], [pa.x + 4, pa.z], [pa.x, pa.z]],
    retakeB: [[d.x, d.z], [pb.x - 16, pb.z], [pb.x - 4, pb.z], [pb.x, pb.z]],
  };
}
function huntRoute() {
  const a = MAP.attackerSpawn;
  const pa = plantPoint('A');
  const mx = midLaneX();
  return [[pa.x, pa.z], [mx, pa.z], [mx, 0], [-mx, 0], [-mx, a.z - 5.5], [a.x, a.z - 0.5]];
}

function routeTo(bot, list) { bot.route = list.map(([x, z]) => ({ x, z })); bot.wp = 0; }

export function createBots(scene, world, state) {
  const group = new THREE.Group();
  scene.add(group);
  // HIT MESHES — DO NOT RESIZE OR MOVE: combat.js raycasts these, and
  // main.js ?shot=play asserts a ray hits the torso at this exact size
  // and height. The character is dressed AROUND them.
  const geoTorso = new THREE.BoxGeometry(0.52, 0.78, 0.30);
  const geoHead = new THREE.SphereGeometry(0.16, 12, 10);
  // Dressing geometry (shared by all nine bots).
  const geoLeg = new THREE.BoxGeometry(0.19, 0.62, 0.21);
  const geoBoot = new THREE.BoxGeometry(0.20, 0.12, 0.32);
  const geoArm = new THREE.BoxGeometry(0.11, 0.52, 0.11);
  const geoHand = new THREE.SphereGeometry(0.06, 8, 6);
  const geoVestF = new THREE.BoxGeometry(0.46, 0.52, 0.05);
  const geoVestB = new THREE.BoxGeometry(0.46, 0.52, 0.05);
  const geoPouch = new THREE.BoxGeometry(0.16, 0.13, 0.05);
  const geoStrap = new THREE.BoxGeometry(0.10, 0.04, 0.34);
  const geoBelt = new THREE.BoxGeometry(0.54, 0.08, 0.32);
  const geoHelmet = new THREE.SphereGeometry(0.185, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const geoBand = new THREE.BoxGeometry(0.37, 0.05, 0.37);
  const geoGoggles = new THREE.BoxGeometry(0.24, 0.07, 0.05);
  const geoMask = new THREE.BoxGeometry(0.20, 0.12, 0.04);
  const geoPatch = new THREE.BoxGeometry(0.13, 0.02, 0.13);
  // Rifle parts (shared; the sniper gets a longer barrel + scope).
  const geoRecv = new THREE.BoxGeometry(0.07, 0.10, 0.42);
  const geoGuard = new THREE.BoxGeometry(0.06, 0.07, 0.26);
  const geoMag = new THREE.BoxGeometry(0.05, 0.15, 0.09);
  const geoStock = new THREE.BoxGeometry(0.06, 0.09, 0.18);
  const geoGrip = new THREE.BoxGeometry(0.05, 0.11, 0.07);
  const geoBarrel = new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8);
  const geoBarrelLong = new THREE.CylinderGeometry(0.02, 0.02, 0.52, 8);
  const geoMuzzle = new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8);
  const geoSight = new THREE.BoxGeometry(0.03, 0.05, 0.03);
  const geoScope = new THREE.CylinderGeometry(0.032, 0.032, 0.24, 10);
  const geoScopeBell = new THREE.CylinderGeometry(0.048, 0.036, 0.07, 10);
  // Extra kit (shared): backpack + bedroll, shoulder/knee pads, radio.
  const geoBackpack = new THREE.BoxGeometry(0.40, 0.50, 0.18);
  const geoBedroll = new THREE.CylinderGeometry(0.09, 0.09, 0.42, 8);
  const geoShoulder = new THREE.BoxGeometry(0.16, 0.06, 0.20);
  const geoKnee = new THREE.BoxGeometry(0.16, 0.10, 0.05);
  const geoRadio = new THREE.BoxGeometry(0.08, 0.14, 0.04);
  const geoAntenna = new THREE.CylinderGeometry(0.008, 0.008, 0.30, 4);
  // Rifle extras: red-dot sight + front post; sniper sunshade + turrets.
  const geoRedDot = new THREE.CylinderGeometry(0.025, 0.025, 0.06, 8);
  const geoFrontPost = new THREE.BoxGeometry(0.02, 0.06, 0.02);
  const geoSunshade = new THREE.CylinderGeometry(0.05, 0.05, 0.10, 10);
  const geoTurret = new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6);

  const skin = new THREE.MeshStandardMaterial({ color: PALETTE.skin, roughness: 0.7 });
  const skinDark = new THREE.MeshStandardMaterial({ color: PALETTE.skinDark, roughness: 0.75 });
  const pants = new THREE.MeshStandardMaterial({ color: PALETTE.pantsDark, roughness: 0.95 });
  const boots = new THREE.MeshStandardMaterial({ color: PALETTE.bootDark, roughness: 0.9 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: PALETTE.gunmetal, roughness: 0.45, metalness: 0.5 });
  const gunGrip = new THREE.MeshStandardMaterial({ color: PALETTE.gunPolymer, roughness: 0.9 });
  const team = {
    B: {
      uniform: new THREE.MeshStandardMaterial({ color: PALETTE.uniformBreaker, roughness: 0.9 }),
      vest: new THREE.MeshStandardMaterial({ color: PALETTE.vestBreaker, roughness: 0.75 }),
      helmet: new THREE.MeshStandardMaterial({ color: PALETTE.helmetBreaker, roughness: 0.8 }),
      band: new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.7 }),
    },
    W: {
      uniform: new THREE.MeshStandardMaterial({ color: PALETTE.uniformWarden, roughness: 0.9 }),
      vest: new THREE.MeshStandardMaterial({ color: PALETTE.vestWarden, roughness: 0.75 }),
      helmet: new THREE.MeshStandardMaterial({ color: PALETTE.helmetWarden, roughness: 0.8 }),
      band: new THREE.MeshStandardMaterial({ color: PALETTE.defenderBlue, roughness: 0.7 }),
    },
  };

  // A held rifle: receiver, handguard, barrel + muzzle, angled magazine,
  // stock, grip, iron sight. Points forward (-z) in bot space.
  function buildRifle(sniper) {
    const g = new THREE.Group();
    const add = (geo, m, x, y, z, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      if (rx) mesh.rotation.x = rx;
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    add(geoRecv, gunMetal, 0, 0, 0);
    add(geoGuard, gunMetal, 0, 0.005, -0.3);
    const barrelGeo = sniper ? geoBarrelLong : geoBarrel;
    const barrel = add(barrelGeo, gunMetal, 0, 0.01, sniper ? -0.55 : -0.48);
    barrel.rotation.x = Math.PI / 2;
    const muzzle = add(geoMuzzle, gunMetal, 0, 0.01, sniper ? -0.82 : -0.66);
    muzzle.rotation.x = Math.PI / 2;
    add(geoMag, gunGrip, 0, -0.11, 0.03, 0.28);
    add(geoStock, gunGrip, 0, -0.01, 0.28);
    add(geoGrip, gunGrip, 0, -0.09, 0.14, 0.3);
    add(geoSight, gunMetal, 0, 0.075, -0.16);
    // Front sight post at the muzzle end of the handguard.
    add(geoFrontPost, gunMetal, 0, 0.075, -0.42);
    if (!sniper) {
      // Red-dot sight on the receiver rail (replaces the iron-sight picture).
      const rd = add(geoRedDot, gunMetal, 0, 0.085, -0.06);
      rd.rotation.x = Math.PI / 2;
      const rdl = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10),
        new THREE.MeshStandardMaterial({ color: PALETTE.scopeGlass, roughness: 0.15, metalness: 0.6 }));
      rdl.position.set(0, 0.085, -0.028);
      g.add(rdl);
    }
    if (sniper) {
      const scope = add(geoScope, gunMetal, 0, 0.09, -0.04);
      scope.rotation.x = Math.PI / 2;
      const bell = add(geoScopeBell, gunMetal, 0, 0.09, -0.18);
      bell.rotation.x = Math.PI / 2;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 10),
        new THREE.MeshStandardMaterial({ color: PALETTE.scopeGlass, roughness: 0.15, metalness: 0.6 }));
      lens.position.set(0, 0.09, -0.216);
      lens.rotation.y = Math.PI;
      g.add(lens);
      // Sunshade forward of the objective bell + elevation/windage turrets.
      const shade = add(geoSunshade, gunMetal, 0, 0.09, -0.26);
      shade.rotation.x = Math.PI / 2;
      add(geoTurret, gunMetal, 0, 0.14, -0.04);
      const turretS = add(geoTurret, gunMetal, 0.05, 0.09, -0.04);
      turretS.rotation.z = Math.PI / 2;
    }
    return g;
  }

  // Routes and holds are built from the current map (laneRoutes above):
  // on DEPOT 9 every coordinate below is the old table exactly; on the
  // other maps the lanes end at the real plant points and the Warden
  // holds sit at the real sites (guardPosts / near-site offsets).
  const routes = laneRoutes();
  const pa = plantPoint('A'), pb = plantPoint('B');
  const mx = midLaneX();
  const guardA = guardPosts('A'), guardB = guardPosts('B');
  const defs = [
    { name: 'Breaker-1', team: 'B', lane: 'west', route: routes.west, hold: [pa.x, pa.z], site: 'A' },
    { name: 'Breaker-2', team: 'B', lane: 'mid', route: routes.mid, hold: [mx, pa.z], site: 'A' },
    { name: 'Breaker-3', team: 'B', lane: 'east', route: routes.east, hold: [pb.x, pb.z], site: 'B' },
    { name: 'Breaker-4', team: 'B', lane: 'west', route: routes.west, hold: [pa.x, pa.z], site: 'A' },
    { name: 'Warden-1', team: 'W', lane: 'A1', route: [[MAP.defenderSpawn.x, MAP.defenderSpawn.z], [pa.x + 10, pa.z], [pa.x - 3, pa.z], guardA[2]], hold: guardA[2], site: 'A', holdYaw: Math.PI },
    { name: 'Warden-2', team: 'W', lane: 'A2', route: [[MAP.defenderSpawn.x, MAP.defenderSpawn.z], [pa.x + 10, pa.z], [pa.x + 3, pa.z], [pa.x + 3, pa.z + 2]], hold: [pa.x + 3, pa.z + 2], site: 'A' },
    { name: 'Warden-3', team: 'W', lane: 'B1', route: [[MAP.defenderSpawn.x, MAP.defenderSpawn.z], [pb.x - 10, pb.z], [pb.x + 3, pb.z], guardB[2]], hold: guardB[2], site: 'B', holdYaw: Math.PI, sniper: true },
    { name: 'Warden-4', team: 'W', lane: 'B2', route: [[MAP.defenderSpawn.x, MAP.defenderSpawn.z], [pb.x - 10, pb.z], [pb.x - 3, pb.z], [pb.x - 3, pb.z + 2]], hold: [pb.x - 3, pb.z + 2], site: 'B' },
    { name: 'Warden-5', team: 'W', lane: 'mid', route: [[MAP.defenderSpawn.x, MAP.defenderSpawn.z], [mx, pa.z], [mx, pa.z + 5]], hold: [mx, pa.z + 5], site: '', mid: true },
  ];
  const bots = [];
  // Warden spawn spread: the same offsets rounds.js uses for its own
  // respawns (SPAWN_OFFSETS_W), so each Warden starts on its own spot
  // instead of all five standing stacked on the defender spawn through
  // the buy phase. Breakers already had distinct offsets (kept as-is).
  const WARDEN_OFFS = [[-4, 0], [-2, 0], [2, 0], [4, 0], [0, 0]];
  let wardenIdx = 0;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    // Initial placement follows the map's team spawns (DEPOT 9 values on
    // DEPOT 9). startRound re-places fighters via rounds.js, but the
    // meshes only re-sync in botsStep (LIVE), so a depot-hardcoded
    // placement here would show bots standing at depot coords through
    // the whole BUY phase on the other maps.
    const spawn = d.team === 'B'
      ? [MAP.attackerSpawn.x + (d.name === 'Breaker-2' ? 2 : d.name === 'Breaker-3' ? 4 : -2 - (i % 2)), MAP.attackerSpawn.z - 0.5]
      : [MAP.defenderSpawn.x + WARDEN_OFFS[wardenIdx % WARDEN_OFFS.length][0],
        MAP.defenderSpawn.z + WARDEN_OFFS[wardenIdx % WARDEN_OFFS.length][1]];
    if (d.team === 'W') wardenIdx++;
    const b = makeFighter('bot' + i, d.name, d.team, spawn[0], spawn[1], d.team === 'B' ? 0 : Math.PI);
    b.role = d.lane; b.site = d.site; b.sniper = !!d.sniper; b.mid = !!d.mid;
    b.holdX = d.hold[0]; b.holdZ = d.hold[1];
    b.holdYaw = d.holdYaw !== undefined ? d.holdYaw : (d.team === 'B' ? 0 : Math.PI);
    b.weapon = 'rifle';
    b.mag = 30; b.reserve = 90;
    routeTo(b, d.route);
    b.homeRoute = d.route.map(([x, z]) => [x, z]);
    // Body: uniform torso + vest + helmet + goggles (the hit meshes),
    // legs + boots, two arms reaching to a held rifle, team band.
    // Torso and head keep their original size/position exactly.
    const t = team[d.team];
    const torso = new THREE.Mesh(geoTorso, t.uniform);
    torso.position.y = 1.0; torso.castShadow = true;
    const head = new THREE.Mesh(geoHead, skin);
    head.position.y = 1.53; head.castShadow = true;
    const helmet = new THREE.Mesh(geoHelmet, t.helmet);
    helmet.position.y = 1.56; helmet.castShadow = true;
    const headBand = new THREE.Mesh(geoBand, t.band);
    headBand.position.y = 1.60;
    const goggles = new THREE.Mesh(geoGoggles, gunGrip);
    goggles.position.set(0, 1.57, -0.16); // proud of the face (was flush at -0.13)
    const mask = new THREE.Mesh(geoMask, skinDark);
    mask.position.set(0, 1.44, -0.14);
    const vestF = new THREE.Mesh(geoVestF, t.vest);
    vestF.position.set(0, 1.08, -0.155); vestF.castShadow = true;
    const vestB = new THREE.Mesh(geoVestB, t.vest);
    vestB.position.set(0, 1.08, 0.155);
    const pouchL = new THREE.Mesh(geoPouch, t.vest);
    pouchL.position.set(-0.12, 0.95, -0.19);
    const pouchR = new THREE.Mesh(geoPouch, t.vest);
    pouchR.position.set(0.12, 0.95, -0.19);
    const strapL = new THREE.Mesh(geoStrap, t.vest);
    strapL.position.set(-0.16, 1.40, 0);
    const strapR = new THREE.Mesh(geoStrap, t.vest);
    strapR.position.set(0.16, 1.40, 0);
    const belt = new THREE.Mesh(geoBelt, boots);
    belt.position.y = 0.64;
    const patch = new THREE.Mesh(geoPatch, t.band);
    patch.position.set(-0.20, 1.395, -0.05);
    // Kit: backpack + bedroll on the back, shoulder pads, radio + antenna
    // on the left chest strap, knee pads on the legs.
    const pack = new THREE.Mesh(geoBackpack, t.vest);
    pack.position.set(0, 1.05, 0.26); pack.castShadow = true;
    const roll = new THREE.Mesh(geoBedroll, t.uniform);
    roll.position.set(0, 1.34, 0.26); roll.rotation.z = Math.PI / 2; roll.castShadow = true;
    const padL = new THREE.Mesh(geoShoulder, t.uniform);
    padL.position.set(-0.28, 1.38, 0);
    const padR = new THREE.Mesh(geoShoulder, t.uniform);
    padR.position.set(0.28, 1.38, 0);
    const radio = new THREE.Mesh(geoRadio, gunGrip);
    radio.position.set(-0.20, 1.22, -0.19);
    const antenna = new THREE.Mesh(geoAntenna, gunGrip);
    antenna.position.set(-0.20, 1.42, -0.19);
    const kneeL = new THREE.Mesh(geoKnee, t.vest);
    kneeL.position.set(-0.14, 0.32, -0.12);
    const kneeR = new THREE.Mesh(geoKnee, t.vest);
    kneeR.position.set(0.14, 0.32, -0.12);
    // Legs + boots (torso bottom is 0.61; legs fill the gap to the floor).
    const legL = new THREE.Mesh(geoLeg, pants);
    legL.position.set(-0.14, 0.31, 0); legL.castShadow = true;
    const legR = new THREE.Mesh(geoLeg, pants);
    legR.position.set(0.14, 0.31, 0); legR.castShadow = true;
    const bootL = new THREE.Mesh(geoBoot, boots);
    bootL.position.set(-0.14, 0.06, -0.03);
    const bootR = new THREE.Mesh(geoBoot, boots);
    bootR.position.set(0.14, 0.06, -0.03);
    // Arms angled forward to the rifle: right hand on the grip, left
    // hand forward on the handguard. Base rotations are stored for the
    // walk swing in syncBotMesh.
    const armR = new THREE.Mesh(geoArm, t.uniform);
    armR.position.set(0.30, 1.20, -0.16);
    armR.rotation.x = -1.05; armR.castShadow = true;
    const armL = new THREE.Mesh(geoArm, t.uniform);
    armL.position.set(-0.10, 1.18, -0.24);
    armL.rotation.x = -1.05; armL.rotation.y = 0.45; armL.castShadow = true;
    const handR = new THREE.Mesh(geoHand, skin);
    handR.position.set(0.28, 1.06, -0.36);
    const handL = new THREE.Mesh(geoHand, skin);
    handL.position.set(0.05, 1.05, -0.44);
    const gun = buildRifle(!!d.sniper);
    gun.position.set(0.16, 1.10, -0.30);
    const rig = new THREE.Group();
    rig.add(torso, head, helmet, headBand, goggles, mask,
      vestF, vestB, pouchL, pouchR, strapL, strapR, belt, patch,
      pack, roll, padL, padR, radio, antenna, kneeL, kneeR,
      legL, legR, bootL, bootR, armR, armL, handR, handL, gun);
    rig.position.set(b.x, 0, b.z);
    group.add(rig);
    torso.userData = { bot: b, part: 'torso' };
    head.userData = { bot: b, part: 'head' };
    b.meshes = { rig, torso, head, gun, legL, legR, armL, armR };
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
  // Smoke (M-9): a cloud on a sightline blocks that line — chest first,
  // then head (weapons.js wiring spec). Both blocked = unseen; a clear
  // head line still counts (headOnly), so a head poking out of a cloud
  // edge is visible even when the chest line clips the cloud. The old
  // code returned null on the chest line alone and over-blocked.
  const chestSmoke = segmentBlockedBySmoke({ x: bot.x, y: eyeY, z: bot.z }, { x: target.x, y: chestY, z: target.z });
  const headSmoke = chestSmoke && segmentBlockedBySmoke({ x: bot.x, y: eyeY, z: bot.z }, { x: target.x, y: headY, z: target.z });
  if (chestSmoke && headSmoke) return null;
  let headOnly = false;
  for (const [ty, isHead] of [[chestY, false], [headY, true]]) {
    if (!isHead && chestSmoke) continue; // chest line is smoked: only the head line can count
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
  // Cover contact: either axis step refused by a collider counts. The
  // mode updates read bot.contactT to decide when a bot has been rubbing
  // against cover long enough to need a detour (see startDetour). A step
  // that slides ALONG a face still refuses the into-the-wall axis, so
  // contact accumulates even while the bot is moving sideways — which is
  // exactly the Long Wagon trap: bots slid east/west along its face for
  // whole rounds while every distance-based watchdog said "progress".
  let blocked = false;
  if (!hitsCollider(colliders, nx, bot.z, h)) bot.x = nx; else blocked = true;
  if (!hitsCollider(colliders, bot.x, nz, h)) bot.z = nz; else blocked = true;
  bot.contactT = blocked ? (bot.contactT || 0) + dt : 0;
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
  const mode = modeOf(state);
  for (const bot of state.bots) {
    // Dead bots still sync their mesh so the death fall-over plays:
    // syncBotMesh rotates a dead rig to flat over 0.4 s. (Previously the
    // loop skipped dead bots entirely, so they stood frozen upright.)
    // Respawn is owned by rounds.js, not here: in TDM tdmStep counts
    // bot.respawnT down and calls respawnFighter (3 s, own-team spawn,
    // full health, kept weapon, rig stood back up); in every other mode
    // dead bots stay down until the next round resets them. bots.js only
    // notices the alive-transition below and clears its own AI-side
    // timers/targets, which respawnFighter does not know about. (An
    // earlier bots.js ran its own respawn on the same respawnT field and
    // double-counted it down, reviving bots in ~1.5 s instead of 3 s.)
    if (!bot.alive) {
      bot._wasAlive = false;
      syncBotMesh(bot, dt);
      continue;
    }
    if (bot._wasAlive === false) {
      // Just revived by rounds.js: drop stale AI state.
      bot._wasAlive = true;
      bot.target = null; bot.hearT = 0;
      bot.domTarget = null; bot.domT = 0;
      bot.detourT = null; bot.detourSide = undefined; bot.contactT = 0;
      bot.fightT = 0; bot.suppressT = 0; bot.investigateCd = 0;
      bot.chaseX = undefined; bot.chaseT = 0;
    }
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
          // Push-window suppression (attack/domination/frontline only):
          // a bot that broke off a long-range fight to advance on its
          // objective does not re-engage until the push window expires.
          // Bomb and TDM never set suppressT, so they are unaffected.
          if (bot.suppressT && state.time < bot.suppressT) {
            // Track the foe, keep moving to the objective.
          } else {
            bot.state = 'ENGAGE';
            const r = bot.team === 'W' ? BOT_TUNING.reactionFoe : BOT_TUNING.reactionFriend;
            bot.reaction = r[0] + state.rng() * (r[1] - r[0]);
            bot.burstLeft = 0; bot.burstPause = 0;
          }
        }
      } else if (bot.target) {
        bot.seeTimer -= 0.1;
        if (bot.seeTimer <= 0) bot.target = null;
      }
    }
    if (bot.target && !bot.target.alive) bot.target = null;
    // Hearing: a gunshot within 22 m turns the bot toward it (no move).
    // Suppressed during a push window (see below): otherwise every shot
    // heard mid-push would freeze the bot in INVESTIGATE for 2 s.
    // In objective modes there is a second guard: without a cooldown on
    // re-entering INVESTIGATE, a bot that keeps hearing nearby shots
    // flips HOLD -> INVESTIGATE on every step and never gets a mode
    // update (the state is INVESTIGATE at every dispatch), so it stands
    // at spawn forever while its teammates' gunfire refreshes hearT.
    // Bomb mode keeps the original behaviour exactly (no cooldown).
    if (bot.hearT > 0) {
      bot.hearT -= dt;
      const cooled = mode !== 'bomb' && bot.investigateCd && state.time < bot.investigateCd;
      if ((bot.state === 'ROUTE' || bot.state === 'HOLD')
          && !(bot.suppressT && state.time < bot.suppressT) && !cooled) bot.state = 'INVESTIGATE';
    }
    // A bot that is not fighting resets its fight clock.
    if (bot.state !== 'ENGAGE') bot.fightT = 0;
    if (mode === 'bomb') {
      // Bomb Mission: the original state machine, exactly as before.
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
          bot.state = 'HUNT'; bot.wp = 0; bot.route = huntRoute().map(([x, z]) => ({ x, z }));
        }
      }
    } else if (bot.state === 'ENGAGE' && bot.target) {
      // Shared in every mode: a bot that can see an enemy fights it.
      // Vision (above) is what puts the bot into ENGAGE.
      // Push break-off (attack/domination/frontline only): a long-range
      // duel (> 15 m) would otherwise pin an attacker at its spawn for
      // the whole round — on this open map the defenders are visible at
      // ~30 m the moment the round starts, and ENGAGE stands still. So
      // after 2.5 s of long-range fighting the bot breaks off and pushes
      // its objective for 3 s (vision/hearing suppressed, see above),
      // then fights again. Close fights never break off. Bomb and TDM
      // keep the old behaviour: fight to the finish.
      if ((mode === 'attack' || mode === 'domination' || mode === 'frontline')
          && Math.hypot(bot.target.x - bot.x, bot.target.z - bot.z) > 15) {
        bot.fightT = (bot.fightT || 0) + dt;
        if (bot.fightT > 2.5) {
          bot.fightT = 0;
          bot.suppressT = state.time + 3;
          bot.state = 'ROUTE';
          bot.target = null;
        } else {
          updateEngage(state, bot, world, combat, dt);
        }
      } else {
        updateEngage(state, bot, world, combat, dt);
      }
    } else if (bot.state === 'INVESTIGATE') {
      updateInvestigate(state, bot, dt);
    } else if (mode === 'tdm') {
      updateTdm(state, bot, dt, colliders);
    } else if (mode === 'attack') {
      updateAttack(state, bot, dt, colliders);
    } else if (mode === 'domination') {
      updateDomination(state, bot, dt, colliders);
    } else { // 'frontline'
      updateFrontline(state, bot, dt, colliders);
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
  // The A branch point is one third of the way from site A toward site B
  // (-8,-13 on DEPOT 9); the B branch goes straight to the B plant point.
  if (bot.role === 'mid' && bot.wp === 5 && bot.team === 'B' && bot.route.length === 6) {
    const toA = state.rng() < 0.5;
    bot.site = toA ? 'A' : 'B';
    const pa = plantPoint('A'), pb = plantPoint('B');
    const end = toA ? [pa.x + (pb.x - pa.x) / 3, pa.z] : [pb.x, pb.z];
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
      const mx = midLaneX();
      const pz = plantPoint('A').z;
      bot.holdX = bot.holdX === mx ? -mx : mx;
      bot.holdZ = pz + 5;
      bot.route = [{ x: bot.holdX, z: pz }, { x: bot.holdX, z: pz + 5 }];
      bot.wp = 0; bot.state = 'ROUTE';
    }
  }
  // Attackers go to GUARD once the bomb is planted: posts around the
  // real planted site (guardPosts), not the old DEPOT 9 tables.
  if (state.bomb.mode === 'planted' && bot.team === 'B') {
    const posts = guardPosts(state.bomb.site || 'A');
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
  if (foe.id === 'you' && state.player.sprinting) err *= BOT_TUNING.aimSprintMul;
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
  if (bot.scanT > 2) {
    bot.scanT = 0; bot.state = 'HOLD';
    // Cooldown on re-investigating (read by the hearing block): without
    // it a bot in earshot of continuous fire re-enters INVESTIGATE on
    // every step and never resumes moving. Bomb mode ignores this field.
    bot.investigateCd = state.time + 4;
  }
}

function updatePush(state, bot, dt, colliders) {
  const site = bot.site || 'A';
  const p = plantPoint(site);
  // Straight at the plant point, with the cover detour: on the other
  // maps the direct line crosses the factory presses / canyon mesas,
  // so a bot rubbing cover for 2 s detours around it (see
  // startDetour) instead of grinding against it for the whole round.
  if (followDetour(bot, dt, colliders)) return;
  if (rubbingCover(bot, state)) return;
  if (moveToward(bot, p.x, p.z, dt, colliders, BOT_TUNING.speed)) {
    bot.holdX = p.x; bot.holdZ = p.z; bot.state = 'HOLD';
  }
}

function updatePlant(state, bot, dt, colliders) {
  // The carrier channels 4 s in the plant zone (pauses outside it).
  // Zone and plant point come from the current map's sites — the same
  // fields the player's plant uses (siteAt + plantX/plantZ) — so the
  // bot plants inside the real site on every map, never outside the
  // walls (FOUNDRY-7) or in open ground off-site (DUSTLINE).
  const s = (state.bomb.site && MAP.sites[state.bomb.site]) ? state.bomb.site
    : (bot.site && MAP.sites[bot.site] ? bot.site : 'A');
  const zone = siteZone(s);
  const p = plantPoint(s);
  if (bot.x < zone.minX || bot.x > zone.maxX || bot.z < zone.minZ || bot.z > zone.maxZ) {
    if (followDetour(bot, dt, colliders)) return;
    if (rubbingCover(bot, state)) return;
    moveToward(bot, p.x, p.z, dt, colliders, BOT_TUNING.speed);
    return;
  }
  bot.plantT += dt;
  state.bomb.plantT = bot.plantT;
  if (bot.plantT >= 4) {
    state.bomb.mode = 'planted';
    state.bomb.site = s;
    state.bomb.x = p.x;
    state.bomb.z = p.z;
    state.bombTimer = 35;
    bot.plantT = 0;
    bot.state = 'GUARD';
  }
}

function updateGuard(state, bot, dt, colliders) {
  if (bot.wp < bot.route.length) {
    if (followDetour(bot, dt, colliders)) return;
    if (rubbingCover(bot, state)) return;
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

// --- modes: objective selection for tdm / attack / domination / frontline ---
// The modes task owns state.mode ('bomb' | 'tdm' | 'attack' | 'domination' |
// 'frontline') and the round/score rules for each mode; bots.js only reads
// it. Anything missing or unknown falls back to Bomb Mission behaviour,
// so the game plays exactly as before until the modes task lands.
const MODES = ['bomb', 'tdm', 'attack', 'domination', 'frontline'];
function modeOf(state) {
  const m = state && state.mode;
  return MODES.indexOf(m) >= 0 ? m : 'bomb';
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Capture points, mirroring rounds.js getCapturePoints() exactly: the
// points the caller passed to createGameState (state.capturePoints —
// normally MAP.capturePoints) when present, else FALLBACK_POINTS (site A,
// site B, mid — the same coordinates as MAP.sites). The mirror matters:
// the rules count captures inside THESE coordinates (domStep/frontStep
// via getCapturePoints, domination via state.domPoints built from them),
// so bots navigating to MAP.capturePoints while the rules used the
// fallback would stand 8 m from the real zone and never capture it.
// (Today main.js passes no points, so the live game runs the fallback:
// A (-24,-14), B (24,-14), C (0,0), r 4.5. When the coordinator wires
// MAP.capturePoints through, both sides follow automatically.)
// The world object carries no points (createWorld returns colliders /
// shootables / sites only), and MAP.capturePoints is deliberately NOT
// read here: it is not what the rules use unless it was passed in.
function capturePoints(state) {
  const list = Array.isArray(state.capturePoints) && state.capturePoints.length >= 3
    ? state.capturePoints : FALLBACK_POINTS;
  return list.map((p) => ({ id: p.id, x: p.x, z: p.z, r: p.r || 4.5 }));
}

// Ownership/contested state for a point. First source is state.domPoints
// — the rules' own live list (domStep updates owner/prog there; a point
// is contested while its capture is in progress, i.e. prog != 0 and
// |prog| < 1: neutral being captured, or owned being flipped). Legacy
// sources (state.points / state.domination.points / state.pointOwners /
// state.contestedPoints) are kept as fallbacks. state.capturePoints is
// NOT an ownership source: it holds the point definitions, no owners.
// When nothing is exposed every point reads as unowned: bots still push
// the nearest point and stand in it.
function pointStates(state, points) {
  let src = null;
  if (Array.isArray(state.domPoints) && state.domPoints.length) src = state.domPoints;
  else if (Array.isArray(state.points)) src = state.points;
  else if (state.domination && Array.isArray(state.domination.points)) src = state.domination.points;
  const owners = state.pointOwners || (state.domination && state.domination.owners) || null;
  const contestedIds = state.contestedPoints || (state.domination && state.domination.contested) || [];
  return points.map((p) => {
    let owner = null, contested = false;
    let x = p.x, z = p.z, r = p.r;
    if (src) {
      const e = src.find((q) => q && q.id === p.id);
      if (e) {
        owner = e.owner || e.team || null;
        if (e.prog !== undefined) contested = e.prog !== 0 && Math.abs(e.prog) < 1;
        else contested = !!e.contested;
        // Domination counts captures inside domPoints coordinates, so
        // use them when the live list carries them.
        if (e.x !== undefined) { x = e.x; z = e.z; r = e.r || r; }
      }
    }
    if (!owner && owners) owner = owners[p.id] || null;
    if (Array.isArray(contestedIds) && contestedIds.indexOf(p.id) >= 0) contested = true;
    return { id: p.id, x, z, r, owner, contested };
  });
}

// The three points ordered Breaker-side -> Warden-side (closest to the
// Breaker spawn first, ties broken by x) — the same order as rounds.js
// frontlineZones(). state.front is the index into THAT order (1 = the
// middle zone), not into the raw points array: on DEPOT 9 the raw array
// is [A, B, C] but the front order is [C, A, B], so zones[1] is A.
// (Indexing the raw array sent every bot to B — the frontline bug that
// stood out in the first verification runs.)
function frontlineZones(points) {
  return points.slice().sort((a, b) => (b.z - a.z) || (a.x - b.x));
}

// The contested front zone: state.front as an index into the B->W order
// above (default 1, the middle zone), or a zone id via state.frontId /
// state.frontZone. Out-of-range front (0..2 is the live range; the match
// ends the moment it leaves it) clamps to the nearest zone.
function frontPoint(state, points) {
  const zones = frontlineZones(points);
  if (typeof state.front === 'number') {
    return zones[clamp(state.front, 0, zones.length - 1)];
  }
  const id = state.frontId || state.frontZone || (typeof state.front === 'string' ? state.front : null);
  if (typeof id === 'string') {
    const p = zones.find((q) => q.id === id);
    if (p) return p;
  }
  return zones[1] || zones[0];
}

// The attacked site: state.attackSite / state.captureSite when exposed,
// else the bomb's site field, else site A.
function attackSite(state) {
  const s = state.attackSite || state.captureSite || (state.bomb && state.bomb.site) || 'A';
  return MAP.sites[s] ? s : 'A';
}

// Slow scan in place: yaw sweeps +/-35 deg over 3 s around baseYaw.
function scanHold(bot, dt, baseYaw) {
  bot.scanT += dt;
  bot.yaw = baseYaw + Math.sin(bot.scanT * (2 * Math.PI / 3)) * (35 * Math.PI / 180);
}

// Stuck watchdog, cover-contact edition. A bot that has spent 2 s with
// a move step refused by a collider is rubbing against cover: detour it
// around. (Two earlier designs failed in live TDM tests and are recorded
// here so nobody reintroduces them: distance-to-target is masked when the
// foe walks toward the bot, and projected toward-gain is satisfied by
// sliding along a wagon face after every nearest-foe switch.)
function clearProgress(bot) { bot.contactT = 0; }
function rubbingCover(bot, state) {
  if ((bot.contactT || 0) > 2) {
    bot.contactT = 0;
    startDetour(bot, state);
    return true;
  }
  return false;
}

// Detour: when a bot is pressed against long cover (the Long Wagon spans
// x -6..6, so a straight chase at it never gets through), route it around
// instead. A detour point 6-10 m to one side of the bot's facing is
// walked for up to 4 s, then the bot resumes its objective. The side is
// picked once per detour — moveToward's own sidestep alternates sides
// every check and just oscillates in place against a long obstacle.
function startDetour(bot, state) {
  const b = MAP.bounds;
  // Usually keep the same side as the last detour (70%): repeated
  // detours then walk consistently around ONE end of the obstacle instead
  // of ping-ponging east/west along its face.
  const side = (bot.detourSide !== undefined && state.rng() < 0.7)
    ? bot.detourSide : (state.rng() < 0.5 ? -1 : 1);
  bot.detourSide = side;
  const px = -Math.sin(bot.yaw + Math.PI / 2) * side;
  const pz = -Math.cos(bot.yaw + Math.PI / 2) * side;
  const len = 8 + state.rng() * 4;
  // Step sideways AND 2.5 m back away from the target: a detour point at
  // the same depth as the bot cannot be reached past a corner — the bot
  // wedges at the wagon's east/west end (radius 0.34) and the detour
  // itself expires unreached. Backing off first gives a clear lane
  // around the end. (bot.yaw faces the target here, so backward is
  // (sin yaw, cos yaw).)
  const bx = Math.sin(bot.yaw), bz = Math.cos(bot.yaw);
  bot.detourX = clamp(bot.x + px * len + bx * 2.5, b.minX + 1, b.maxX - 1);
  bot.detourZ = clamp(bot.z + pz * len + bz * 2.5, b.minZ + 1, b.maxZ - 1);
  bot.detourT = 4;
  clearProgress(bot);
}

// While a detour is active, walk it instead of the objective. Returns
// true when the bot spent this step on the detour.
function followDetour(bot, dt, colliders) {
  if (bot.detourT === undefined || bot.detourT === null) return false;
  bot.detourT -= dt;
  const d = Math.hypot(bot.detourX - bot.x, bot.detourZ - bot.z);
  if (bot.detourT <= 0 || d < 1) { bot.detourT = null; bot.contactT = 0; return false; }
  moveToward(bot, bot.detourX, bot.detourZ, dt, colliders, BOT_TUNING.speed);
  return true;
}

// --- TDM respawn: owned by rounds.js (see botsStep) ---
// tdmStep counts bot.respawnT down from 3 s and calls respawnFighter:
// own-team spawn, full health, kept weapon, state ROUTE, home route
// restored, rig stood back up. bots.js must not run a second respawn.

// TEAM DEATHMATCH: hunt the nearest living enemy, engage on sight (the
// shared vision/ENGAGE path in botsStep), keep fighting. No bomb, no
// sites, no plant/defuse.
function updateTdm(state, bot, dt, colliders) {
  bot.state = 'HUNT';
  const foes = nearestEnemy(state, bot);
  if (foes.length === 0) {
    // Nobody left to hunt (the other team is mid-respawn): patrol the
    // HUNT sweep until someone comes back.
    if (!bot.route.length) { bot.route = huntRoute().map(([x, z]) => ({ x, z })); bot.wp = 0; }
    updateHunt(state, bot, dt, colliders);
    return;
  }
  let foe = null, best = Infinity;
  for (const f of foes) {
    const d = Math.hypot(f.x - bot.x, f.z - bot.z);
    if (d < best) { best = d; foe = f; }
  }
  // Re-aim at the prey's current position twice a second.
  bot.chaseT = (bot.chaseT || 0) - dt;
  if (bot.chaseT <= 0 || bot.chaseX === undefined) {
    bot.chaseT = 0.5; bot.chaseX = foe.x; bot.chaseZ = foe.z;
  }
  // Chase the prey's position, refreshed twice a second. There is no
  // stand-and-fight radius here: when the bot can SEE the foe, the shared
  // vision/ENGAGE path takes over and it stops to shoot. Standing still
  // merely for being within 6 m was a trap — a foe 5 m away on the far
  // side of the Long Wagon is not shootable, and the bot would wait at
  // the wagon face forever instead of detouring around it.
  if (followDetour(bot, dt, colliders)) return;
  if (rubbingCover(bot, state)) {
    bot.chaseT = 0; // re-aim at the prey once the detour is done
    return;
  }
  moveToward(bot, bot.chaseX, bot.chaseZ, dt, colliders, BOT_TUNING.speed);
}

// ATTACK AND DEFEND: Breakers push into the attacked site and stand in
// it to capture; Wardens hold posts in/around the site, and converge on
// it when attackers are inside and the defender is near.
function updateAttack(state, bot, dt, colliders) {
  if (followDetour(bot, dt, colliders)) return;
  const siteId = attackSite(state);
  const s = MAP.sites[siteId];
  const inSite = (f) => f.x >= s.minX && f.x <= s.maxX && f.z >= s.minZ && f.z <= s.maxZ;
  if (bot.team === 'B') {
    if (inSite(bot)) {
      // Standing in the site: hold it and watch the southern approach.
      bot.state = 'HOLD'; bot.holdX = bot.x; bot.holdZ = bot.z;
      scanHold(bot, dt, Math.PI);
      clearProgress(bot);
      return;
    }
    bot.state = 'ROUTE';
    // Spread across the site so the team does not stack on one spot.
    const i = state.bots.indexOf(bot);
    const tx = clamp(s.x + ((i % 3) - 1) * 2.5, s.minX + 0.5, s.maxX - 0.5);
    const tz = clamp(s.z + (i % 2 ? 1.5 : -1.5), s.minZ + 0.5, s.maxZ - 0.5);
    if (rubbingCover(bot, state)) return;
    moveToward(bot, tx, tz, dt, colliders, BOT_TUNING.speed);
    return;
  }
  // Wardens.
  let attackersIn = 0;
  if (state.player.alive && state.player.team === 'B' && inSite(state.player)) attackersIn++;
  for (const b of state.bots) if (b.alive && b.team === 'B' && inSite(b)) attackersIn++;
  const dSite = Math.hypot(s.x - bot.x, s.z - bot.z);
  if (attackersIn > 0 && dSite < 20) {
    // The site is being captured and this defender is near: converge.
    bot.state = 'ROUTE';
    if (rubbingCover(bot, state)) return;
    moveToward(bot, s.x, s.z, dt, colliders, BOT_TUNING.speed);
    return;
  }
  // Otherwise hold an assigned post in/around the site, facing it.
  // Posts are derived from the real site (guardPosts), not the old
  // DEPOT 9 GUARD_A / GUARD_B tables.
  const posts = guardPosts(siteId);
  const post = posts[state.bots.indexOf(bot) % posts.length];
  const d = Math.hypot(post[0] - bot.x, post[1] - bot.z);
  if (d > 1) {
    bot.state = 'ROUTE';
    if (rubbingCover(bot, state)) return;
    moveToward(bot, post[0], post[1], dt, colliders, BOT_TUNING.speed);
    return;
  }
  bot.state = 'HOLD';
  scanHold(bot, dt, Math.atan2(-(s.x - bot.x), -(s.z - bot.z)));
  clearProgress(bot);
}

// DOMINATION: push the nearest point the team does not own (or a
// contested one), stand in its radius to capture; a couple of bots hold
// an owned point while the rest push the next one. Spread is enforced by
// charging each point per teammate already heading there.
function pickDomPoint(state, bot, info) {
  const mates = state.bots.filter((b) => b.alive && b.team === bot.team && b !== bot);
  const owned = info.filter((p) => p.owner === bot.team);
  // Holders: the two lowest-index living teammates stay on the nearest
  // owned point (if the team owns one).
  const rank = [...mates, bot]
    .sort((a, b) => state.bots.indexOf(a) - state.bots.indexOf(b))
    .indexOf(bot);
  if (owned.length && rank < 2) {
    let best = owned[0], bd = Infinity;
    for (const p of owned) {
      const d = Math.hypot(p.x - bot.x, p.z - bot.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best.id;
  }
  let best = null, bestScore = Infinity;
  for (const p of info) {
    if (p.owner === bot.team) continue; // holders cover owned points
    const d = Math.hypot(p.x - bot.x, p.z - bot.z);
    const holders = mates.filter((m) => m.domTarget === p.id).length;
    let score = d + holders * 12;
    if (p.contested) score -= 15;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  if (best) return best.id;
  // Everything is owned: fall back to the nearest point and hold it.
  let nearest = info[0], nd = Infinity;
  for (const p of info) {
    const d = Math.hypot(p.x - bot.x, p.z - bot.z);
    if (d < nd) { nd = d; nearest = p; }
  }
  return nearest.id;
}

function updateDomination(state, bot, dt, colliders) {
  if (followDetour(bot, dt, colliders)) return;
  const info = pointStates(state, capturePoints(state));
  bot.domT = (bot.domT || 0) - dt;
  const cur = info.find((p) => p.id === bot.domTarget);
  // Re-pick every 3 s, or at once when the current target is gone or is
  // now owned by our team and this bot is not a designated holder.
  if (bot.domT <= 0 || !cur) {
    if (!cur || cur.owner === bot.team) bot.domTarget = pickDomPoint(state, bot, info);
    bot.domT = 3;
  }
  const p = info.find((q) => q.id === bot.domTarget) || info[0];
  const d = Math.hypot(p.x - bot.x, p.z - bot.z);
  if (d <= Math.max(1.5, p.r * 0.8)) {
    bot.state = 'HOLD'; bot.holdX = bot.x; bot.holdZ = bot.z;
    scanHold(bot, dt, bot.holdYaw);
    clearProgress(bot);
    return;
  }
  bot.state = 'ROUTE';
  if (rubbingCover(bot, state)) return;
  moveToward(bot, p.x, p.z, dt, colliders, BOT_TUNING.speed);
}

// FRONTLINE: both teams converge on the current front zone. The team
// that holds it pushes forward by capturing it: the capture moves
// state.front one step toward the enemy (rounds.js frontStep) and every
// bot re-targets to the new front zone, so the push-forward emerges from
// following the front index — there is no owned-front state to chase
// (frontline tracks signed progress, state.frontProg, not an owner), and
// leaving the zone early to pre-position would stall the capture.
function updateFrontline(state, bot, dt, colliders) {
  if (followDetour(bot, dt, colliders)) return;
  const front = frontPoint(state, capturePoints(state));
  const d = Math.hypot(front.x - bot.x, front.z - bot.z);
  if (d <= Math.max(1.5, front.r * 0.8)) {
    bot.state = 'HOLD'; bot.holdX = bot.x; bot.holdZ = bot.z;
    scanHold(bot, dt, bot.team === 'B' ? 0 : Math.PI);
    clearProgress(bot);
    return;
  }
  bot.state = 'ROUTE';
  if (rubbingCover(bot, state)) return;
  moveToward(bot, front.x, front.z, dt, colliders, BOT_TUNING.speed);
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
  const phase = bot.x * 2 + bot.z * 2;
  m.rig.position.y = moving ? Math.abs(Math.sin(phase)) * 0.03 : 0;
  // Walk swing (visual only): legs alternate, arms counter-swing a little
  // around their forward-aim base pose. Idle bots stand at attention.
  if (m.legL && m.legR) {
    const s = moving ? Math.sin(phase) * 0.45 : 0;
    m.legL.rotation.x = s;
    m.legR.rotation.x = -s;
  }
  if (m.armL && m.armR) {
    const s = moving ? Math.sin(phase) * 0.18 : 0;
    m.armR.rotation.x = -1.05 + s;
    m.armL.rotation.x = -1.05 - s;
  }
}
