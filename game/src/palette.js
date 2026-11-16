// palette.js — colours + procedural textures. One source of truth for the
// depot-at-dawn look; no other colour literal may appear in game code or
// CSS except shades produced by lighting on these values.
//
// The palette is a warm dawn depot: cold blue-grey sky and steel against
// warm amber sun, rusted freight, weathered concrete and timber. The two
// crews read instantly at 40 m: Breakers in amber/orange, Wardens in blue.
//
// All textures are generated on tiny canvases in code — zero network,
// zero external files. Every texture is cached, so creating a hundred
// meshes that share one costs a single canvas.
import * as THREE from 'three';

export const PALETTE = {
  canvas: 0x14161a,      // sky / fog / page background
  surface: 0x2b2724,     // walls, floor panels, HUD panels (warm concrete)
  hairline: 0x33302b,    // wagons, trim, weapon grip
  ink: 0xe9e6df,         // HUD text, weapon body
  muted: 0x98a0a8,       // secondary HUD text, fill light
  accent: 0xf0a830,      // Breaker amber, Site A, muzzle flash, hitmarker
  wagonTeal: 0x27655f,   // freight wagons, Site B
  wagonRust: 0xb4552d,   // rust wagons, hazard striping
  defenderBlue: 0x4da3ff,// Warden team, defender spawn marking
  bombYellow: 0xffcf3d,  // bomb, plant zone pulse, bomb timer
  dangerRed: 0xe5484d,   // damage direction, low health, round-loss text
  groundConcrete: 0x4a453d, // depot floor, ballast

  // --- ground & track ---
  groundAsphalt: 0x35322e, // worn asphalt aprons
  groundBallast: 0x2e2b28, // rail ballast bed
  groundDirt: 0x4d4034,    // dirt / dust patches
  groundOil: 0x1c1a18,     // oil stains
  railSteel: 0x8a8f96,     // rail heads
  sleeperWood: 0x3d2f22,   // rail sleepers

  // --- structures & props ---
  crateWood: 0x8a6b42,     // timber crates
  crateWoodDark: 0x6b4f30, // timber crate shadow / frame
  crateOlive: 0x5a5c3f,    // military olive crates
  crateMetal: 0x4a5560,    // steel crates
  containerRust: 0x8a4a28, // rusted container
  roofDark: 0x24211d,      // roofs, dark trim
  wallTrim: 0x1f1c19,      // wall coping / base trim
  hazardYellow: 0xf5b81e,  // hazard striping
  hazardBlack: 0x17150f,   // hazard striping

  // --- sky ---
  skyZenith: 0x2c3a55,     // dawn zenith (deep indigo)
  skyMid: 0x51627e,        // dawn mid-sky (blue-grey)
  skyHorizon: 0xc98a4b,    // dawn horizon band (amber)
  sunDisc: 0xffd9a0,       // low sun
  mountainFar: 0x2a3349,   // distant ridge silhouette
  mountainNear: 0x202839,  // near ridge silhouette
  cloudWhite: 0xd8d2c8,    // dawn-lit cloud

  // --- FOUNDRY-7 (industrial interior, sodium-lit) ---
  foundryFloor: 0x2e2a26,  // dark oiled concrete floor
  foundryWall: 0x3a352f,   // soot-stained steel wall panels
  foundrySteel: 0x4a4640,  // machine housings, beams
  foundryDark: 0x211d19,   // deep shadow steel / roof trusses
  sodium: 0xff9a2a,        // sodium lamp orange
  sodiumGlow: 0xffb45e,    // sodium lamp glow
  furnaceGlow: 0xff6a1f,   // furnace mouth ember orange
  pipeRust: 0x6b4a2e,      // rusted pipework
  foundrySky: 0x0e0b09,    // interior "sky" — near-black smoke
  foundryFog: 0x191009,    // warm dark haze inside the foundry

  // --- DUSTLINE (desert canyon outpost, harsh noon sun) ---
  sand: 0xc9a06a,          // canyon sand ground
  sandLight: 0xd9b47e,     // sun-bleached sand
  sandDark: 0xa8824f,      // shaded sand / dry wash
  sandstone: 0xb0703f,     // mesa rock
  sandstoneDark: 0x8a4f2c, // mesa shadow strata
  sandstoneLight: 0xcf8f57,// mesa sunlit strata
  mesaFar: 0xa86a44,       // distant mesa silhouette
  mesaNear: 0x7e4a2e,      // near mesa silhouette
  desertZenith: 0x3f7fd0,  // harsh noon zenith blue
  desertMid: 0x7fb4e0,     // noon mid-sky
  desertHorizon: 0xf2d9a0, // pale heat-haze horizon
  desertSun: 0xfff6d8,     // white-hot sun disc
  desertFog: 0xe8c890,     // heat-haze fog
  rockGrey: 0x8a7a68,      // grey canyon boulders

  // --- crews (bots) ---
  skin: 0xc99878,          // skin tone
  skinDark: 0x8a6248,      // skin shadow / second tone
  uniformBreaker: 0x4a4436,// Breaker khaki-olive uniform
  uniformWarden: 0x333d4a, // Warden slate-navy uniform
  vestBreaker: 0xd98a1f,   // Breaker amber tactical vest
  vestWarden: 0x2f6fd0,    // Warden blue tactical vest
  pantsDark: 0x2b2b26,     // trousers, both crews
  helmetBreaker: 0x6b5a34, // Breaker helmet
  helmetWarden: 0x2e4a66,  // Warden helmet
  bootDark: 0x1d1a16,      // boots

  // --- weapons ---
  gunmetal: 0x2f333a,      // blued steel
  gunmetalLight: 0x5d636d, // machined steel highlights
  gunPolymer: 0x17181b,    // polymer grips / stocks
  gunWood: 0x5a3d24,       // wooden furniture accent
  scopeGlass: 0x1a2f3a,    // scope lens
  brass: 0xc9a227,         // cartridge brass
};

export const CSS = {
  canvas: '#14161a', surface: '#2b2724', hairline: '#33302b',
  ink: '#e9e6df', muted: '#98a0a8', accent: '#f0a830',
  wagonTeal: '#27655f', wagonRust: '#b4552d', defenderBlue: '#4da3ff',
  bombYellow: '#ffcf3d', dangerRed: '#e5484d', groundConcrete: '#4a453d',
};

// ---------------------------------------------------------------------------
// Procedural canvas textures (all cached by key).
// ---------------------------------------------------------------------------
const _texCache = new Map();

function _hex(n) {
  return '#' + n.toString(16).padStart(6, '0');
}

// Deterministic pseudo-random from a seed, so textures are stable.
function _rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function _finish(key, canvas, rx = 1, ry = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = 4;
  _texCache.set(key, tex);
  return tex;
}

function _speckle(ctx, w, h, rand, n, dark, light) {
  for (let i = 0; i < n; i++) {
    const v = rand();
    ctx.fillStyle = v > 0.5 ? dark : light;
    ctx.globalAlpha = 0.05 + rand() * 0.12;
    const s = 1 + rand() * 3;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

// Weathered concrete: speckle + stains + faint panel joints.
export function texConcrete(base = PALETTE.groundConcrete, seed = 7, rx = 1, ry = 1) {
  const key = `concrete:${base}:${seed}:${rx}x${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.fillStyle = _hex(base); ctx.fillRect(0, 0, w, h);
  _speckle(ctx, w, h, rand, 2600, '#000000', '#ffffff');
  // A few large soft stains — bigger and darker than before so the floor
  // reads as worn, not just speckled.
  for (let i = 0; i < 10; i++) {
    const x = rand() * w, y = rand() * h, r = 26 + rand() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Hairline cracks.
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    let x = rand() * w, y = rand() * h;
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (rand() - 0.5) * 60; y += (rand() - 0.5) * 60; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // Panel joints (formwork lines) — heavier now: the old 2px / 0.28
  // joints vanished at 10 m and the floor read as one flat slab.
  ctx.strokeStyle = 'rgba(0,0,0,0.42)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,235,200,0.10)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h / 2 + 3); ctx.lineTo(w, h / 2 + 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w / 2 + 3, 0); ctx.lineTo(w / 2 + 3, h); ctx.stroke();
  // Edge wear: darker vignette toward the tile edges + pale patches
  // where feet and wheels polish the concrete.
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.28, w / 2, h / 2, h * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 5; i++) {
    const x = rand() * w, y = rand() * h, r = 14 + rand() * 30;
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
    g2.addColorStop(0, 'rgba(255,240,210,0.07)'); g2.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return _finish(key, c, rx, ry);
}

// Concrete wall: large panels with joints, rust weep streaks, darker base.
export function texWall(base = PALETTE.surface, seed = 11, rx = 1, ry = 1) {
  const key = `wall:${base}:${seed}:${rx}x${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.fillStyle = _hex(base); ctx.fillRect(0, 0, w, h);
  _speckle(ctx, w, h, rand, 2200, '#000000', '#ffffff');
  // Top-light: the sun catches the top of the wall, so the upper half
  // reads a touch lighter instead of the whole wall sinking to black.
  const tl = ctx.createLinearGradient(0, 0, 0, h * 0.45);
  tl.addColorStop(0, 'rgba(255,230,190,0.13)'); tl.addColorStop(1, 'rgba(255,230,190,0)');
  ctx.fillStyle = tl; ctx.fillRect(0, 0, w, h * 0.45);
  // Panel joints: 4 m panels — heavier lines, plus a pale lower edge
  // so each panel reads as a separate slab at distance.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = 3;
  for (const x of [w * 0.25, w * 0.5, w * 0.75]) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,235,200,0.08)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h * 0.5 + 3); ctx.lineTo(w, h * 0.5 + 3); ctx.stroke();
  // Rust weep streaks from the top — more of them, longer.
  for (let i = 0; i < 9; i++) {
    const x = rand() * w, len = 30 + rand() * 90;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(120,70,30,0.35)'); g.addColorStop(1, 'rgba(120,70,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 3 + rand() * 5, len);
  }
  // Darker base band (grime at the foot of the wall).
  const g = ctx.createLinearGradient(0, h * 0.82, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, h * 0.82, w, h * 0.18);
  return _finish(key, c, rx, ry);
}

// Timber planks with grain, frame border and stencilled depot mark.
export function texWood(base = PALETTE.crateWood, seed = 3, label = 'DEPOT 9', rx = 1, ry = 1) {
  const key = `wood:${base}:${seed}:${label}:${rx}x${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.fillStyle = _hex(base); ctx.fillRect(0, 0, w, h);
  const plankH = h / 4;
  for (let p = 0; p < 4; p++) {
    // Per-plank tone shift.
    ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,220,160' : '0,0,0'},${0.05 + rand() * 0.08})`;
    ctx.fillRect(0, p * plankH, w, plankH);
    // Grain lines.
    ctx.strokeStyle = 'rgba(40,20,5,0.35)'; ctx.lineWidth = 1;
    for (let gLine = 0; gLine < 7; gLine++) {
      const y = p * plankH + rand() * plankH;
      ctx.beginPath(); ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + (rand() - 0.5) * 8, w * 0.7, y + (rand() - 0.5) * 8, w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, p * plankH); ctx.lineTo(w, p * plankH); ctx.stroke();
    // Nail heads.
    ctx.fillStyle = 'rgba(20,20,20,0.8)';
    ctx.beginPath(); ctx.arc(10, p * plankH + plankH / 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w - 10, p * plankH + plankH / 2, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Frame border + corner brackets.
  ctx.strokeStyle = _hex(PALETTE.crateWoodDark); ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, w - 14, h - 14);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (const [x, y] of [[0, 0], [w - 34, 0], [0, h - 34], [w - 34, h - 34]]) ctx.fillRect(x, y, 34, 34);
  // Stencil.
  if (label) {
    ctx.fillStyle = 'rgba(20,14,8,0.75)';
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2);
  }
  // Wear: pale scratches across the planks.
  ctx.strokeStyle = 'rgba(255,230,180,0.10)'; ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const y = rand() * h, x = rand() * w, len = 20 + rand() * 50;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + (rand() - 0.5) * 6); ctx.stroke();
  }
  return _finish(key, c, rx, ry);
}

// Corrugated freight metal: vertical ribs with light/shadow per rib.
export function texCorrugated(base, seed = 5, rx = 1, ry = 1) {
  const key = `corr:${base}:${seed}:${rx}x${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.fillStyle = _hex(base); ctx.fillRect(0, 0, w, h);
  const ribW = 16;
  for (let x = 0; x < w; x += ribW) {
    const g = ctx.createLinearGradient(x, 0, x + ribW, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, ribW, h);
  }
  _speckle(ctx, w, h, rand, 900, '#000000', '#ffffff');
  // Rust patches, heavier toward the bottom.
  for (let i = 0; i < 14; i++) {
    const x = rand() * w, y = h * (0.45 + rand() * 0.55), r = 6 + rand() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(122,62,22,0.5)'); g.addColorStop(1, 'rgba(122,62,22,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Wear: bright scratches where the ribs catch, and a pale top edge.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const x = rand() * w, y = rand() * h, len = 8 + rand() * 26;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 8, y + len); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,240,210,0.08)'; ctx.fillRect(0, 10, w, 4);
  // Top and bottom rails.
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
  return _finish(key, c, rx, ry);
}

// Loose rail ballast: dense gravel speckle.
export function texBallast(seed = 9, rx = 1, ry = 1) {
  const key = `ballast:${seed}:${rx}x${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.fillStyle = _hex(PALETTE.groundBallast); ctx.fillRect(0, 0, w, h);
  // Bigger stones, tighter value range: the old 2-7px stones with pure
  // black/white extremes read as TV static at 10 m. Mid greys + larger
  // stones read as gravel.
  const shades = ['#3a3733', '#2e2b28', '#4a463f', '#555049', '#262421'];
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = shades[(rand() * shades.length) | 0];
    ctx.globalAlpha = 0.7 + rand() * 0.3;
    const s = 3 + rand() * 6;
    ctx.beginPath();
    ctx.ellipse(rand() * w, rand() * h, s, s * (0.6 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return _finish(key, c, rx, ry);
}

// Diagonal hazard stripes (yellow / near-black).
export function texHazard(rx = 1, ry = 1) {
  const key = `hazard:${rx}x${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 128, h = 128, c = _canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = _hex(PALETTE.hazardYellow); ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = _hex(PALETTE.hazardBlack);
  for (let x = -h; x < w + h; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 16 + h, h); ctx.lineTo(x + h, h);
    ctx.closePath(); ctx.fill();
  }
  // Wear.
  const rand = _rng(4);
  _speckle(ctx, w, h, rand, 300, '#000000', '#ffffff');
  return _finish(key, c, rx, ry);
}

// Painted floor marking: a big stencilled letter inside a ring, on a
// transparent canvas so the concrete shows through around it.
export function texSiteLetter(letter, colour, ring = true) {
  const key = `siteletter:${letter}:${colour}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const col = _hex(colour);
  ctx.clearRect(0, 0, w, h);
  if (ring) {
    ctx.strokeStyle = col; ctx.globalAlpha = 0.9; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 108, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.45; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 92, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = col;
  ctx.font = 'bold 150px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, w / 2, h / 2 + 6);
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _texCache.set(key, tex);
  return tex;
}

// Painted floor text (spawn labels, lane words), transparent background.
export function texFloorText(text, colour, sub = '') {
  const key = `floortext:${text}:${colour}:${sub}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 512, h = 128, c = _canvas(w, h), ctx = c.getContext('2d');
  const col = _hex(colour);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = col; ctx.globalAlpha = 0.85;
  ctx.font = 'bold 56px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, sub ? h / 2 - 22 : h / 2);
  if (sub) {
    ctx.globalAlpha = 0.6; ctx.font = 'bold 30px monospace';
    ctx.fillText(sub, w / 2, h / 2 + 34);
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _texCache.set(key, tex);
  return tex;
}

// Dawn sky gradient (zenith indigo -> blue-grey -> amber horizon band).
export function texSky() {
  const key = 'sky';
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 4, h = 512, c = _canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, _hex(PALETTE.skyZenith));
  g.addColorStop(0.42, _hex(PALETTE.skyMid));
  g.addColorStop(0.68, '#7d6a58');
  g.addColorStop(0.82, _hex(PALETTE.skyHorizon));
  g.addColorStop(1.0, '#8a6a48');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

// Soft radial cloud puff (transparent), for billboard clouds.
export function texCloud(seed = 2) {
  const key = `cloud:${seed}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 128, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.clearRect(0, 0, w, h);
  // Denser, brighter puffs: the old 9-puff / 0.55-alpha cloud read as a
  // faint smudge at distance. 14 puffs with a hotter core + a flat lit
  // base so the cloud has a visible belly, not just a wisp.
  // R2: every puff is fully INSIDE the canvas (x 58..198, y 48..80,
  // r <= 46) so its radial gradient fades to zero before the canvas
  // edge — the old puffs could reach the border mid-fade and the plane
  // edge showed as a hard straight cut in stills.
  for (let i = 0; i < 14; i++) {
    const x = 58 + rand() * (w - 116), y = 48 + rand() * 32, r = 20 + rand() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(226,220,210,0.8)');
    g.addColorStop(0.6, 'rgba(216,210,200,0.35)');
    g.addColorStop(1, 'rgba(216,210,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Warm-lit base: dawn sun catches the underside. source-atop so the
  // tint only lands on the puffs themselves — a plain fillRect would
  // paint a visible rectangle (the whole canvas bottom at 0.22 alpha).
  ctx.globalCompositeOperation = 'source-atop';
  const base = ctx.createLinearGradient(0, h * 0.55, 0, h);
  base.addColorStop(0, 'rgba(255,205,150,0)');
  base.addColorStop(1, 'rgba(255,205,150,0.22)');
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

// Sun disc (DEPOT 9, sun-smoke r4): amber core, NOT near-white — the
// material colour must stay 0xffffff so these stops are final (no
// double-tint). Soft 8% edge falloff; limb is saturated orange.
// Compositing (r4, Devil-corrected): disc centre (255,205,110); inner
// halo 0.35 over horizon band #c98a4b -> (220,138,60); outer halo
// additive 0.15 over brightest cloud #d8d2c8 -> (254,228,205), no clip.
export function texSunDisc() {
  const key = 'sundisc';
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 128, h = 128, c = _canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0.00, 'rgba(255, 205, 110, 1)');
  g.addColorStop(0.50, 'rgba(255, 179, 71, 1)');   // 0xffb347
  g.addColorStop(0.75, 'rgba(255, 138, 31, 1)');   // 0xff8a1f
  g.addColorStop(0.92, 'rgba(255, 122, 31, 0.9)'); // saturated orange limb
  g.addColorStop(1.00, 'rgba(255, 122, 31, 0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

// Soft radial glow (sun halo, lamp glow, dust-mote sprite): white core
// fading to transparent. One texture, reused by every glow in the game.
export function texGlow() {
  const key = 'glow';
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 128, h = 128, c = _canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

// Vertical light-shaft gradient: bright at the top, fading down, with a
// soft horizontal falloff so a shaft plane reads as lit air, not a card.
export function texBeam() {
  const key = 'beam';
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 64, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // Horizontal falloff: erase the left/right edges.
  const gx = ctx.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, 'rgba(0,0,0,1)');
  gx.addColorStop(0.25, 'rgba(0,0,0,0)');
  gx.addColorStop(0.75, 'rgba(0,0,0,0)');
  gx.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = gx; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

// Grey speckle noise for roughnessMap: multiplies the roughness scalar so
// big flat surfaces (floors, walls) stop reading as uniform plastic.
// NOTE: linear (no sRGB) — roughness data, not colour.
export function texRoughNoise(seed = 5) {
  const key = `rough:${seed}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 5200; i++) {
    const v = Math.round((0.55 + rand() * 0.45) * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    const s = 1 + rand() * 3;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
  // A few smoother patches (lower roughness = polished by traffic).
  for (let i = 0; i < 6; i++) {
    const x = rand() * w, y = rand() * h, r = 18 + rand() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(120,120,120,0.5)'); g.addColorStop(1, 'rgba(120,120,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.anisotropy = 4;
  _texCache.set(key, tex);
  return tex;
}

// Distant mountain ridge silhouette (two ridges, far + near).
export function texMountains() {
  const key = 'mountains';
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 1024, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(21);
  ctx.clearRect(0, 0, w, h);
  // Far ridge.
  ctx.fillStyle = _hex(PALETTE.mountainFar);
  ctx.beginPath(); ctx.moveTo(0, h);
  let y = h * 0.42;
  for (let x = 0; x <= w; x += 32) {
    y += (rand() - 0.5) * 46;
    y = Math.max(h * 0.22, Math.min(h * 0.58, y));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  // Near ridge, darker and lower.
  ctx.fillStyle = _hex(PALETTE.mountainNear);
  ctx.beginPath(); ctx.moveTo(0, h);
  y = h * 0.62;
  for (let x = 0; x <= w; x += 48) {
    y += (rand() - 0.5) * 36;
    y = Math.max(h * 0.45, Math.min(h * 0.78, y));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  // Dawn snow-light on the far peaks.
  ctx.fillStyle = 'rgba(255,220,180,0.25)';
  for (let i = 0; i < 12; i++) {
    const x = rand() * w, py = h * (0.22 + rand() * 0.2);
    ctx.beginPath(); ctx.ellipse(x, py, 8 + rand() * 14, 3 + rand() * 4, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Warm dawn haze along the base: the ridge sits in lit air instead of
  // ending in a hard dark cut against the walls.
  const hz = ctx.createLinearGradient(0, h * 0.62, 0, h);
  hz.addColorStop(0, 'rgba(201,138,75,0)');
  hz.addColorStop(1, 'rgba(201,138,75,0.30)');
  ctx.fillStyle = hz; ctx.fillRect(0, h * 0.62, w, h * 0.38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  _texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// FOUNDRY-7 / DUSTLINE textures (same canvas-texture pattern, zero assets).
// ---------------------------------------------------------------------------

// Desert sand: warm base + wind-ripple bands + fine speckle.
export function texSand(base = PALETTE.sand, seed = 31, rx = 1, ry = 1) {
  const key = `sand:${base}:${seed}:${rx}x${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.fillStyle = _hex(base); ctx.fillRect(0, 0, w, h);
  // Wind ripples: soft sine bands across the tile — stronger contrast
  // than before so the sand reads as wind-blown, not flat beige.
  for (let y = 0; y < h; y += 9) {
    const a = 0.08 + 0.08 * Math.sin(y * 0.35 + seed);
    ctx.fillStyle = y % 18 < 9 ? `rgba(255,235,200,${a})` : `rgba(120,80,40,${a})`;
    ctx.fillRect(0, y, w, 4);
  }
  _speckle(ctx, w, h, rand, 2200, '#7a5a30', '#ffe9c0');
  // A few darker pebble dots.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(90,60,30,0.5)';
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, 1 + rand() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  return _finish(key, c, rx, ry);
}

// Sandstone: horizontal strata bands in alternating sun/shade tones,
// plus speckle and a few vertical weather cracks.
export function texSandstone(base = PALETTE.sandstone, seed = 33, rx = 1, ry = 1) {
  const key = `sandstone:${base}:${seed}:${rx}x${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.fillStyle = _hex(base); ctx.fillRect(0, 0, w, h);
  const tones = ['rgba(207,143,87,0.65)', 'rgba(138,79,44,0.65)', 'rgba(176,112,63,0.5)', 'rgba(90,50,25,0.55)'];
  let y = 0;
  while (y < h) {
    const bh = 12 + rand() * 26;
    ctx.fillStyle = tones[(rand() * tones.length) | 0];
    ctx.fillRect(0, y, w, bh);
    // Hard strata joint.
    ctx.fillStyle = 'rgba(60,30,12,0.5)';
    ctx.fillRect(0, y + bh - 2, w, 2);
    y += bh;
  }
  _speckle(ctx, w, h, rand, 1600, '#4a2410', '#ffd9a0');
  // Vertical weather cracks.
  ctx.strokeStyle = 'rgba(50,25,10,0.4)'; ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = rand() * w; ctx.beginPath(); ctx.moveTo(x, 0);
    for (let s = 0; s < 5; s++) { x += (rand() - 0.5) * 14; ctx.lineTo(x, (s + 1) * h / 5); }
    ctx.stroke();
  }
  // Edge wear: sun-bleached top edge, dark base.
  ctx.fillStyle = 'rgba(255,230,190,0.10)'; ctx.fillRect(0, 0, w, 6);
  const gb = ctx.createLinearGradient(0, h * 0.85, 0, h);
  gb.addColorStop(0, 'rgba(40,20,8,0)'); gb.addColorStop(1, 'rgba(40,20,8,0.30)');
  ctx.fillStyle = gb; ctx.fillRect(0, h * 0.85, w, h * 0.15);
  return _finish(key, c, rx, ry);
}

// Dark steel wall panels: riveted seams, grime, faint rust weep.
export function texMetalPanel(base = PALETTE.foundryWall, seed = 37, rx = 1, ry = 1) {
  const key = `metalpanel:${base}:${seed}:${rx}x${ry}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 256, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(seed);
  ctx.fillStyle = _hex(base); ctx.fillRect(0, 0, w, h);
  _speckle(ctx, w, h, rand, 1800, '#000000', '#ffffff');
  // Panel seams: 2x2 large plates.
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
  // Rivets along the seams.
  ctx.fillStyle = 'rgba(200,190,170,0.5)';
  for (const [rx2, ry2] of [[w / 4, 6], [w * 0.75, 6], [w / 4, h - 6], [w * 0.75, h - 6], [6, h / 4], [6, h * 0.75], [w - 6, h / 4], [w - 6, h * 0.75]]) {
    ctx.beginPath(); ctx.arc(rx2, ry2, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Rust weep + soot at the base.
  for (let i = 0; i < 5; i++) {
    const x = rand() * w, len = 30 + rand() * 70;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(122,70,30,0.4)'); g.addColorStop(1, 'rgba(122,70,30,0)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, 4 + rand() * 6, len);
  }
  const g = ctx.createLinearGradient(0, h * 0.8, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, h * 0.8, w, h * 0.2);
  // Edge wear: a pale top edge where the plate catches the light, and
  // chipped corners showing bare metal.
  ctx.fillStyle = 'rgba(255,235,200,0.10)'; ctx.fillRect(0, 0, w, 3);
  ctx.fillStyle = 'rgba(190,200,210,0.35)';
  for (const [x, y] of [[4, 4], [w - 8, 4], [4, h - 8], [w - 8, h - 8]]) ctx.fillRect(x, y, 4, 4);
  return _finish(key, c, rx, ry);
}

// Harsh noon desert sky: deep blue zenith -> pale heat-haze horizon.
export function texSkyDesert() {
  const key = 'skydesert';
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 4, h = 512, c = _canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, _hex(PALETTE.desertZenith));
  g.addColorStop(0.45, _hex(PALETTE.desertMid));
  g.addColorStop(0.75, _hex(PALETTE.desertHorizon));
  g.addColorStop(1.0, '#e8c890');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

// Foundry interior "sky": near-black smoke with a warm sodium glow low.
export function texSkyFoundry() {
  const key = 'skyfoundry';
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 4, h = 512, c = _canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, '#060505');
  g.addColorStop(0.55, '#0e0b09');
  g.addColorStop(0.85, '#2a1a0c');
  g.addColorStop(1.0, '#4a2c10');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

// Distant flat-topped mesas (two ranges, far + near), warm haze tones.
export function texMesas() {
  const key = 'mesas';
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 1024, h = 256, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(41);
  ctx.clearRect(0, 0, w, h);
  // Far range: low flat-topped mesas.
  ctx.fillStyle = _hex(PALETTE.mesaFar);
  ctx.beginPath(); ctx.moveTo(0, h);
  let x = 0;
  while (x < w) {
    const mw = 90 + rand() * 160, mh = h * (0.28 + rand() * 0.22);
    ctx.lineTo(x, h - mh * 0.4);
    ctx.lineTo(x + mw * 0.12, h - mh);
    ctx.lineTo(x + mw * 0.88, h - mh);
    ctx.lineTo(x + mw, h - mh * 0.4);
    x += mw + 20 + rand() * 60;
  }
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  // Near range: taller, darker mesas.
  ctx.fillStyle = _hex(PALETTE.mesaNear);
  ctx.beginPath(); ctx.moveTo(0, h);
  x = -40;
  while (x < w) {
    const mw = 140 + rand() * 200, mh = h * (0.5 + rand() * 0.28);
    ctx.lineTo(x, h - mh * 0.35);
    ctx.lineTo(x + mw * 0.15, h - mh);
    ctx.lineTo(x + mw * 0.85, h - mh);
    ctx.lineTo(x + mw, h - mh * 0.35);
    x += mw + 30 + rand() * 80;
  }
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  // Heat haze along the base of the near range.
  const hz = ctx.createLinearGradient(0, h * 0.55, 0, h);
  hz.addColorStop(0, 'rgba(242,217,160,0)');
  hz.addColorStop(1, 'rgba(242,217,160,0.35)');
  ctx.fillStyle = hz; ctx.fillRect(0, h * 0.55, w, h * 0.45);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  _texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Sky dome texture (1024x512, wraps around a BackSide sphere): a real sky
// you can look at, not a 4px gradient stretched over the background.
// Vertical gradient + painted high cloud streaks (elongated soft
// ellipses, wrap-safe horizontally) + a warm haze band at the horizon.
// The sun itself is a mesh + glow sprites (world.js), not painted here,
// so the disc and the dome can never disagree about where the sun is.
// Variants: 'dawn' (DEPOT 9) and 'desert' (DUSTLINE, harsh noon).
export function texSkyDome(variant = 'dawn') {
  const key = `skydome:${variant}`;
  if (_texCache.has(key)) return _texCache.get(key);
  const w = 1024, h = 512, c = _canvas(w, h), ctx = c.getContext('2d');
  const rand = _rng(variant === 'desert' ? 77 : 55);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (variant === 'desert') {
    g.addColorStop(0.0, '#2f6fc4');
    g.addColorStop(0.35, '#6fa8dc');
    g.addColorStop(0.62, '#a8c8e8');
    g.addColorStop(0.78, '#f2d9a0');
    g.addColorStop(1.0, '#e8c890');
  } else {
    g.addColorStop(0.0, '#232f4a');
    g.addColorStop(0.30, '#3d4f6e');
    g.addColorStop(0.55, '#5d6f88');
    g.addColorStop(0.72, '#8a6f52');
    g.addColorStop(0.84, '#c98a4b');
    g.addColorStop(1.0, '#7a5c40');
  }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // High cloud streaks: long, thin, soft — visible bands across the sky
  // that read at a glance, unlike the old flat gradient.
  const streaks = variant === 'desert' ? 7 : 11;
  for (let i = 0; i < streaks; i++) {
    const y = h * (0.10 + rand() * 0.42);
    const x = rand() * w;
    const rw = 90 + rand() * 190, rh = 5 + rand() * 10;
    const warm = variant !== 'desert' && y > h * 0.32;
    const col = warm ? '255,205,150' : '235,232,225';
    const a = (variant === 'desert' ? 0.10 : 0.14) + rand() * 0.12;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, rw);
    gg.addColorStop(0, `rgba(${col},${a})`);
    gg.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = gg;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, rh / rw);
    ctx.translate(-x, -y);
    ctx.beginPath(); ctx.arc(x, y, rw, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // Warm haze band hugging the horizon.
  const hz = ctx.createLinearGradient(0, h * 0.68, 0, h * 0.92);
  hz.addColorStop(0, 'rgba(255,190,110,0)');
  hz.addColorStop(1, variant === 'desert' ? 'rgba(255,220,160,0.20)' : 'rgba(255,170,90,0.28)');
  ctx.fillStyle = hz; ctx.fillRect(0, h * 0.68, w, h * 0.24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  _texCache.set(key, tex);
  return tex;
}
