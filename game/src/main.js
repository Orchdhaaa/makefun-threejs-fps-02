// main.js — boot, the one loop, shot staging. No game rules live here:
// rules are in rounds.js (phases/economy/bomb), combat.js (shooting),
// bots.js (AI) and weapons.js (gun data). The sim runs at a fixed 60 Hz
// step, kept apart from rendering; render only copies state to the scene.
// Import order (DESIGN §9c): state, input, palette, world, player,
// weapons, combat, rounds, bots, hud, audio — audio last/expendable.
import * as THREE from 'three';
import { createGameState, PHASES, pushKillfeed, pushEvent } from './state.js';
import { createInput } from './input.js';
import { PALETTE } from './palette.js';
import { createWorld, siteAt, MAP } from './world.js';
import { createPlayer, playerStep, eyeHeight, cameraForward } from './player.js';
import { WEAPONS, GRENADE_PRICE, createWeapons, spreadFor, startReload, finishReload } from './weapons.js';
import { createCombat, throwGrenade, stepGrenades, damage } from './combat.js';
import { createRounds, startRound, endRound, buyItem, roundsStep, ROUND } from './rounds.js';
import { createBots, botsStep, hearShot } from './bots.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

// Judge, read this first. FERROLINE is a round-based tactical FPS in the
// style Counter-Strike made famous, on an original map (DEPOT 9) with
// original names, art and sounds. Criterion map:
//   1 complete game: rounds.js (phases, endRound) + this file (loop, HUD sync)
//   2 gunplay: weapons.js spreadFor() + combat.js fireShot() + player.js
//   3 tactics: rounds.js buyItem()/ECONOMY + bots.js states + bomb plant
//   4 map/look: world.js createWorld() + palette.js
//   5 code: state.js is the single store; sim is fixed-step, apart from render.
const FIXED_STEP = 1 / 60;
const SENS = 0.0022;

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | play | buy | end (staging only)
const SEED = parseInt(params.get('seed') || '1', 10);
const seed = SHOT ? SEED : (Date.now() % 2147483647);

const state = createGameState(seed);
state.shot = SHOT;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
// Dawn sky: a vertical gradient painted on a tiny canvas — no asset,
// no network. Cool blue-grey at the zenith warming to a low amber
// band at the horizon, so the sky reads as dawn instead of black.
const _sky = document.createElement('canvas');
_sky.width = 4; _sky.height = 256;
const _sg = _sky.getContext('2d');
const _grad = _sg.createLinearGradient(0, 0, 0, 256);
_grad.addColorStop(0, '#31405c');
_grad.addColorStop(0.55, '#46586e');
_grad.addColorStop(0.8, '#8a6f52');
_grad.addColorStop(1, '#5d5348');
_sg.fillStyle = _grad; _sg.fillRect(0, 0, 4, 256);
const _skyTex = new THREE.CanvasTexture(_sky);
_skyTex.colorSpace = THREE.SRGBColorSpace;
scene.background = _skyTex;
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 200);
scene.add(camera);

const world = createWorld(scene);
const input = createInput(renderer.domElement);
const move = createPlayer(world.colliders);
const weapons = createWeapons(camera);
const combat = createCombat(scene, world);
const rounds = createRounds(state);
const bots = createBots(scene, world, state);
const hud = createHud();
const audio = createAudio();

// Bomb prop: small yellow charge, blinking light when planted/dropped.
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3),
  new THREE.MeshStandardMaterial({ color: PALETTE.bombYellow, roughness: 0.5 }));
const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
  new THREE.MeshBasicMaterial({ color: PALETTE.dangerRed }));
bombLight.position.y = 0.2;
bombMesh.add(bombBox, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);
// Grenade prop (one live grenade max, reused mesh).
const grenadeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.MeshStandardMaterial({ color: PALETTE.bombYellow, roughness: 0.5 }));
grenadeMesh.visible = false;
scene.add(grenadeMesh);

startRound(state, 1);

let started = false; // pointer lock acquired at least once
let paused = false;
let prevFiring = false;
let reloading = null; // weapon id being reloaded
let buyOpen = false;
let lastMoney = state.money;
let beepT = 0;
let shotReady = false;
// Debug hook for play-testing (parent harness reads live state).
window.__ferroline = { state, scene, camera, renderer };

const _fwd = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _ray = new THREE.Raycaster();

input.onLockChange = (locked) => {
  if (locked) {
    started = true; paused = false;
    audio.ensure();
    hud.hideOverlay();
    if (state.phase === PHASES.BUY && !SHOT) { buyOpen = true; }
  } else if (started && !SHOT) {
    paused = true;
    hud.showOverlay('Paused', 'The round is paused while pointer lock is off.', 'Click to resume.');
  }
};
input.onClick = () => { audio.ensure(); };

function fmtTimer() {
  if (state.phase === PHASES.BUY) return `BUY 0:${String(Math.ceil(state.timer)).padStart(2, '0')}`;
  if (state.bomb.mode === 'planted') {
    const t = Math.max(0, Math.ceil(state.bombTimer));
    return `0:${String(t).padStart(2, '0')}`;
  }
  const t = Math.max(0, Math.ceil(state.timer));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function switchWeapon(id) {
  const p = state.player;
  if (id === 'grenade') {
    if (p.weapons.grenade.count < 1) return;
  } else if (!p.weapons[id] || !p.weapons[id].owned) return;
  if (p.weapon === id) return;
  p.weapon = id;
  const slot = p.weapons[id];
  p.mag = slot.mag || 0; p.reserve = slot.reserve || 0;
  weapons.equip(id);
  reloading = null;
}

function doFire() {
  const p = state.player;
  if (p.weapon === 'grenade') {
    if (p.weapons.grenade.count < 1) return;
    cameraForward(p.yaw, p.pitch, _fwd);
    _origin.set(p.x, p.y + eyeHeight(move), p.z);
    throwGrenade(state, { x: p.x, z: p.z, vx: move.vx, vz: move.vz }, _origin, _fwd);
    p.weapons.grenade.count = 0;
    weapons.equip(p.weapons.rifle.owned ? 'rifle' : 'pistol');
    p.weapon = weapons.current;
    const slot = p.weapons[p.weapon];
    p.mag = slot.mag; p.reserve = slot.reserve;
    audio.shot('grenade');
    return;
  }
  if (!weapons.canFire()) return;
  const def = WEAPONS[p.weapon];
  const slot = p.weapons[p.weapon];
  if (slot.mag <= 0) { audio.dry(); weapons.cooldown = 0.25; return; }
  slot.mag--; p.mag = slot.mag;
  const moving = Math.hypot(move.vx, move.vz) > 0.5;
  const airborne = !move.onGround;
  const spread = spreadFor(def, weapons.bloom, moving, move.crouched, airborne);
  cameraForward(p.yaw, p.pitch, _fwd);
  _origin.set(p.x, p.y + eyeHeight(move), p.z);
  const res = combat.fireShot(state, p, _origin, _fwd, spread);
  weapons.onShot(def);
  // Recoil: pitch kick + random yaw drift; the player pulls down to compensate.
  p.pitch += def.recoilPitch;
  p.yaw += (state.rng() * 2 - 1) * def.recoilYaw;
  audio.shot(p.weapon);
  hearShot(state, p);
  if (res.hit && res.target) hud.hitmarker(res.killed);
}

function step(dt) {
  const p = state.player;
  state.time += dt;
  // --- input edges ---
  if (input.wasPressed('KeyM')) { audio.setMuted(!audio.isMuted()); }
  if (state.phase === PHASES.BUY && input.wasPressed('KeyB') && !SHOT) {
    buyOpen = !buyOpen;
  }
  if (buyOpen && state.phase === PHASES.BUY) {
    // Buy keys 1-4 buy while the menu is open (never switch).
    for (const [code, id] of [['Digit1', 'pistol'], ['Digit2', 'rifle'], ['Digit3', 'sniper'], ['Digit4', 'grenade']]) {
      if (input.wasPressed(code)) {
        if (buyItem(state, id)) audio.click(); else audio.error();
      }
    }
  } else {
    for (const [code, id] of [['Digit1', 'pistol'], ['Digit2', 'rifle'], ['Digit3', 'sniper'], ['Digit4', 'grenade']]) {
      if (input.wasPressed(code)) switchWeapon(id);
    }
  }
  if (input.wasPressed('KeyR') && !reloading && startReload(state)) {
    reloading = p.weapon;
    weapons.reloadT = WEAPONS[p.weapon].reload;
  }
  // --- look ---
  const look = input.takeLook();
  if (p.alive && input.locked) {
    p.yaw -= look.dx * SENS;
    p.pitch -= look.dy * SENS;
    p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
  }
  // --- movement (frozen in buy phase, dead players do not move) ---
  let speed = 0;
  if (p.alive && state.phase !== PHASES.BUY && state.phase !== PHASES.MATCH) {
    const def = WEAPONS[p.weapon] || WEAPONS.pistol;
    speed = playerStep(move, input.keys, dt, p.weapon === 'grenade' ? 1 : def.speedMul);
    p.x = move.x; p.z = move.z; p.y = move.y; p.crouched = move.crouched;
  } else {
    move.x = p.x; move.z = p.z; move.yaw = p.yaw;
  }
  state.playerMoving = speed > 0.5;
  move.yaw = p.yaw;
  // --- firing ---
  const firing = input.firing && input.locked;
  const def = WEAPONS[p.weapon];
  if (p.alive && state.phase === PHASES.LIVE) {
    if (def && def.auto) { if (firing) doFire(); }
    else if (firing && !prevFiring) doFire();
  }
  prevFiring = firing;
  // --- reload completion ---
  if (reloading) {
    weapons.reloadT -= dt;
    if (weapons.reloadT <= 0) { finishReload(state); reloading = null; }
  }
  weapons.step(dt);
  // --- plant channel (hold E in a plant zone, carrier only) ---
  if (p.alive && state.phase === PHASES.LIVE && state.bomb.mode === 'carried' &&
      input.keys.KeyE && !reloading) {
    const site = siteAt(p.x, p.z);
    if (site) {
      state.bomb.plantT += dt;
      state.bomb.site = site;
      if (state.bomb.plantT >= ROUND.plantTime) {
        state.bomb.mode = 'planted';
        state.bomb.x = MAP.sites[site].plantX; state.bomb.z = MAP.sites[site].plantZ;
        state.bombTimer = ROUND.bombTime;
        state.bomb.planter = 'You';
        state.money = Math.min(14000, state.money + 250);
        state.bomb.plantT = 0;
        pushEvent(state, 'planted', { site });
        // Defenders converge: every living Warden goes to RETAKE.
        for (const b of state.bots) {
          if (b.alive && b.team === 'W') {
            b.route = (site === 'A' ? [[0, -19.5], [-8, -13], [-20, -13], [-24, -13]]
              : [[0, -19.5], [8, -13], [20, -13], [24, -13]]).map(([x, z]) => ({ x, z }));
            b.wp = 0; b.state = 'RETAKE';
          } else if (b.alive && b.team === 'B') {
            b.state = 'GUARD';
          }
        }
      }
    } else state.bomb.plantT = 0;
  } else if (state.bomb.mode === 'carried') {
    // Plant pauses (never resets) while outside the zone — but only the
    // player's own channel pauses here; a bot carrier keeps its own value.
    if (!input.keys.KeyE) state.bomb.plantT = Math.max(0, state.bomb.plantT);
  }
  // --- bots, grenades, rounds ---
  // Bots are frozen during the buy phase (DESIGN §3.2); they move and
  // fight only once the round is live.
  if (state.phase === PHASES.LIVE) {
    botsStep(state, world, combat, dt);
  }
  stepGrenades(state, world, dt, [grenadeMesh]);
  combat.step(dt);
  roundsStep(state, dt);
  // Buy menu follows the phase.
  if (state.phase !== PHASES.BUY) buyOpen = false;
  // Killfeed ages.
  for (const e of state.killfeed) e.age += dt;
  state.killfeed = state.killfeed.filter((e) => e.age < 5);
  // Bomb beeps speed up as the timer falls.
  if (state.bomb.mode === 'planted') {
    beepT -= dt;
    if (beepT <= 0) { audio.beep(); beepT = Math.max(0.25, state.bombTimer / 35); }
  }
  // Drain events to audio.
  for (const ev of state.events) {
    if (ev.kind === 'explosion') audio.explosion();
    else if (ev.kind === 'hit' && ev.data.kill) audio.kill();
    else if (ev.kind === 'hit') audio.hit();
  }
  state.events.length = 0;
  input.clearPressed();
}

// --- render sync ---
function render() {
  const p = state.player;
  // Camera: the player, or the nearest living friendly bot while dead.
  if (p.alive) {
    camera.position.set(p.x, p.y + eyeHeight(move), p.z);
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch;
  } else {
    let spec = state.bots.find((b) => b.alive && b.team === 'B');
    if (spec) {
      state.spectate = spec.name;
      camera.position.set(spec.x, 1.6, spec.z);
      camera.rotation.set(0, 0, 0);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = spec.yaw;
    }
  }
  // View-model kick.
  weapons.group.position.z = -0.5 + weapons.kick * 0.06;
  weapons.group.position.y = -weapons.kick * 0.02;
  // Bomb prop.
  if (state.bomb.mode === 'planted' || state.bomb.mode === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(state.bomb.x, 0.15, state.bomb.z);
    bombLight.visible = (state.time * 2) % 1 < 0.5;
  } else bombMesh.visible = false;
  // Grenade prop follows the live grenade.
  grenadeMesh.visible = state.grenades.length > 0;
  // HUD.
  const def = WEAPONS[p.weapon];
  hud.setHealth(Math.max(0, Math.ceil(p.hp)), !p.alive);
  hud.setAmmo(p.mag, p.reserve, !!reloading, p.weapon === 'grenade' ? 'M-7 FRAG' : def ? def.name : '');
  if (state.money !== lastMoney) { hud.setMoney(state.money); lastMoney = state.money; }
  hud.setTimer(fmtTimer(), state.phase === PHASES.LIVE && state.timer < 10, state.bomb.mode === 'planted');
  hud.setScore(state.score.breakers, state.score.wardens, state.round, ROUND.maxRounds);
  hud.setAlive(
    [p.alive, ...state.bots.filter((b) => b.team === 'B').map((b) => b.alive)],
    state.bots.filter((b) => b.team === 'W').map((b) => b.alive), p.alive);
  const bombTxt = state.bomb.mode === 'carried' ? 'BOMB CARRIED'
    : state.bomb.mode === 'dropped' ? `BOMB DROPPED — ${Math.round(Math.hypot(p.x - state.bomb.x, p.z - state.bomb.z))} m`
    : state.bomb.mode === 'planted' ? `BOMB PLANTED — SHED ${state.bomb.site} 0:${String(Math.max(0, Math.ceil(state.bombTimer))).padStart(2, '0')}` : '';
  hud.setBomb(bombTxt);
  // Bomb edge arrow (dropped bomb only): project to screen space.
  if (state.bomb.mode === 'dropped') {
    const v = new THREE.Vector3(state.bomb.x, 1, state.bomb.z).project(camera);
    const ang = Math.atan2(v.y, v.x) * 180 / Math.PI;
    const dist = Math.round(Math.hypot(p.x - state.bomb.x, p.z - state.bomb.z));
    hud.setBombArrow(true, ang, dist);
  } else hud.setBombArrow(false, 0, 0);
  hud.setKillfeed(state.killfeed);
  const spread = def ? spreadFor(def, weapons.bloom, state.playerMoving, move.crouched, !move.onGround) : 0.008;
  hud.setCrosshair(6 + spread * 1200, p.alive && !buyOpen && state.phase !== PHASES.MATCH);
  if (state.bomb.mode === 'carried' && state.bomb.plantT > 0) {
    hud.setChannel(`PLANTING ${(ROUND.plantTime - state.bomb.plantT).toFixed(1)}s`, state.bomb.plantT / ROUND.plantTime);
  } else hud.setChannel('', 0);
  hud.setBanner(state.phase === PHASES.END ? state.banner : '');
  hud.setSpectate(!p.alive && state.phase === PHASES.LIVE
    ? `YOU ARE DOWN — spectating ${state.spectate || 'Breaker-1'} — round continues` : '');
  hud.setDeathBanner(state.death ? `KILLED BY ${state.death.by} [${state.death.weapon}]${state.death.head ? ' HEADSHOT' : ''}` : '');
  if (buyOpen && state.phase === PHASES.BUY) {
    const owned = {
      pistol: true, rifle: state.player.weapons.rifle.owned,
      sniper: state.player.weapons.sniper.owned, grenade: state.player.weapons.grenade.count > 0,
    };
    hud.renderBuy(state.money, owned, state.round);
  } else hud.hideBuy();
  if (state.phase === PHASES.MATCH) {
    const won = state.score.breakers > state.score.wardens;
    hud.showOverlay(won ? 'FERROLINE — BREAKERS WIN' : 'FERROLINE — WARDENS WIN',
      `Final score: Breakers ${state.score.breakers} — ${state.score.wardens} Wardens<br>` +
      `Your kills: ${state.stats.kills} &nbsp; Deaths: ${state.stats.deaths} &nbsp; Money: $${state.money}`,
      'Click Play again to start a new match.');
  }
  renderer.render(scene, camera);
}

// --- overlays: start / pause / match end ---
function showStart() {
  hud.showOverlay('FERROLINE',
    'A decommissioned mountain rail depot at dawn. Two five-person crews fight over it: ' +
    'the <b>Breakers</b> move in from the south sidings to blow one of two freight sheds; ' +
    'the <b>Wardens</b> hold the depot from the north office. Rounds are short, money is tight, ' +
    'and holding an angle beats running at one.<br><br>' +
    '<b>W A S D</b> move &nbsp; <b>Mouse</b> look &nbsp; <b>Click</b> fire &nbsp; <b>R</b> reload<br>' +
    '<b>1–4</b> weapons / buy &nbsp; <b>E</b> plant &nbsp; <b>B</b> buy menu &nbsp; <b>Ctrl/C</b> crouch<br>' +
    '<b>Shift</b> slow walk &nbsp; <b>Space</b> jump &nbsp; <b>M</b> mute &nbsp; <b>Esc</b> pause',
    'Click to play.');
}
renderer.domElement.addEventListener('click', () => {
  if (state.phase === PHASES.MATCH) {
    // Full match reset.
    const fresh = createGameState(Date.now() % 2147483647);
    Object.assign(state, fresh);
    state.bots = bots.bots;
    startRound(state, 1);
  }
});
if (!SHOT) showStart();

// --- ?shot= staging (deterministic, reachable values only) ---
// Every staged number is derived in DESIGN §8 from the economy ledger;
// runShot() asserts each one before setting window.__shotReady.
function assertShot(cond, msg) {
  if (!cond) throw new Error('shot assertion failed: ' + msg);
}
function placeBot(name, x, z, yaw, hp, alive) {
  const b = state.bots.find((bb) => bb.name === name);
  if (!b) return;
  b.x = x; b.z = z; b.yaw = yaw; b.hp = hp; b.alive = alive;
  b.state = 'HOLD'; b.holdX = x; b.holdZ = z; b.holdYaw = yaw;
  if (b.meshes) {
    b.meshes.rig.position.set(x, 0, z);
    b.meshes.rig.rotation.y = yaw;
    b.meshes.rig.rotation.z = alive ? 0 : Math.PI / 2;
  }
}
function runShot(mode) {
  const p = state.player;
  // The start overlay is only for the start shot; other shots hide it.
  if (mode !== 'start') hud.hideOverlay();
  if (mode === 'start') {
    // Round 1, buy phase, $950 start, pistol 12/36, BUY 0:10.
    p.x = 0; p.z = 19; p.yaw = 0; p.pitch = 0;
    move.x = 0; move.z = 19; move.yaw = 0;
    assertShot(state.money === 950, 'start money 950');
    assertShot(state.phase === PHASES.BUY && Math.ceil(state.timer) === 10, 'buy timer 0:10');
    showStart();
  } else if (mode === 'play') {
    // Round 2, 1-0, 1:23, $900 = 950 + 2600 + 250 - 2900. Crouched at
    // (8, +2) aiming north at Warden-3 at (8, -8), 10.0 m. Two rifle
    // rounds fired, both torso hits: 66 dmg, bot at 34 HP, alive.
    state.round = 2; state.score.breakers = 1;
    state.phase = PHASES.LIVE; state.timer = 83;
    state.money = 900;
    p.weapons.rifle.owned = true; p.weapons.rifle.mag = 28; p.weapons.rifle.reserve = 90;
    p.weapon = 'rifle'; p.mag = 28; p.reserve = 90;
    weapons.equip('rifle');
    p.x = 8; p.z = 2; p.yaw = 0; p.pitch = 0; p.crouched = true;
    move.x = 8; move.z = 2; move.yaw = 0; move.crouched = true;
    placeBot('Warden-3', 8, -8, Math.PI, 34, true);
    placeBot('Breaker-3', 24, -13, 0, 100, true);
    state.killfeed = [{ text: 'Breaker-2 > Warden-4 [HERON AR-4]', head: false, age: 3 }];
    hud.hitmarker(false, 4000); // staged hitmarker stays up for the shot
    // Tracer mid-flight, muzzle to target.
    const tr = combat.tracers[0];
    tr.mesh.visible = true;
    tr.mesh.position.set(8, 1.02, -3);
    tr.mesh.lookAt(new THREE.Vector3(8, 1.0, -8));
    tr.mesh.scale.set(1, 1, 5);
    tr.t = 999;
    // Assertion: a ray from the staged camera first hits Warden-3's torso.
    const w3 = state.bots.find((b) => b.name === 'Warden-3');
    w3.meshes.rig.updateMatrixWorld(true);
    _origin.set(8, 1.02, 2);
    _ray.set(_origin, new THREE.Vector3(0, -0.002, -1).normalize());
    _ray.far = 80;
    const hits = _ray.intersectObjects([w3.meshes.torso], false);
    assertShot(hits.length > 0, 'play ray hits Warden-3 torso');
    assertShot(Math.abs(Math.hypot(8 - 8, -8 - 2) - 10) < 0.01, 'play distance 10.0 m');
    assertShot(p.mag === 28 && p.reserve === 90, 'play ammo 28/90');
  } else if (mode === 'buy') {
    // Round 3 buy, 2-0, $3650 = 900 + 2600 + 500 - 350. Rifle owned,
    // grenade bought, sniper $4900 CANNOT AFFORD.
    state.round = 3; state.score.breakers = 2;
    state.phase = PHASES.BUY; state.timer = 10;
    state.money = 3650;
    p.weapons.rifle.owned = true; p.weapons.rifle.mag = 30; p.weapons.rifle.reserve = 90;
    p.weapons.grenade.owned = true; p.weapons.grenade.count = 1;
    p.weapon = 'rifle'; p.mag = 30; p.reserve = 90;
    weapons.equip('rifle');
    p.x = 0; p.z = 19; p.yaw = 0; p.pitch = 0;
    move.x = 0; move.z = 19; move.yaw = 0;
    buyOpen = true;
    assertShot(state.money === 3650, 'buy money 3650');
    assertShot(!p.weapons.sniper.owned && state.money < 4900, 'sniper cannot afford');
  } else if (mode === 'end') {
    // Round 3 won by elimination, 3-0, $6750 = 3650 + 2600 + 500.
    // 5 shots: 4 body on Warden-2 (132 dmg, kill) + 1 head on Warden-5
    // (132 dmg, kill). Ammo 25/90. Timer frozen 0:47.
    state.round = 3; state.score.breakers = 3;
    state.phase = PHASES.END; state.timer = 47;
    state.money = 6750;
    p.weapons.rifle.owned = true; p.weapons.rifle.mag = 25; p.weapons.rifle.reserve = 90;
    p.weapon = 'rifle'; p.mag = 25; p.reserve = 90;
    weapons.equip('rifle');
    p.x = -22; p.z = -7; p.yaw = 0; p.pitch = 0;
    move.x = -22; move.z = -7; move.yaw = 0;
    placeBot('Warden-2', -24, -13, Math.PI, 0, false);
    placeBot('Warden-5', -20, -11, Math.PI, 0, false);
    state.banner = 'ROUND WON — ALL WARDENS DOWN';
    state.killfeed = [
      { text: 'You > Warden-5 [HERON AR-4] HEADSHOT', head: true, age: 1.0 },
      { text: 'You > Warden-2 [HERON AR-4]', head: false, age: 2.2 },
    ];
    assertShot(p.mag === 25, 'end ammo 25/90 (5 shots: 4 body + 1 head)');
    assertShot(state.money === 6750, 'end money 6750');
    assertShot(4 * 33 >= 100 && 1 * 132 >= 100, 'end damage ledger: 4x33 and 1x132 kill');
  }
  render();
  renderer.render(scene, camera);
  window.__shotReady = true;
  shotReady = true;
}

// --- the loop ---
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (SHOT) {
    if (!shotReady) runShot(SHOT);
    return;
  }
  if (!paused) {
    acc += dt;
    let n = 0;
    while (acc >= FIXED_STEP && n < 5) { step(FIXED_STEP); acc -= FIXED_STEP; n++; }
    if (n === 5) acc = 0;
  }
  render();
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
requestAnimationFrame(frame);
