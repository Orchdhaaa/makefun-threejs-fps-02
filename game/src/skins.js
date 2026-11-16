// skins.js — procedural skin textures for FERROLINE.
//
// ONE pattern per family, drawn on 2D canvases — no external images, no
// network. Textures are cached per `${familyId}:${role}` in a module-level
// Map, so every gun / preview / swatch that wants the same family+role
// shares one texture. Deterministic: all randomness comes from
// mulberry32 (state.js) seeded by seedFor(familyId) — never Math.random().
//
// Sizes: body 256x256, steel/grip 128x128. Cell sizes halve on steel/grip
// (digital 24 -> 12 px, carbon 12 -> 6 px). CanvasTexture defaults stay
// (mipmaps on, anisotropy 4, SRGB, RepeatWrapping).
//
// Patterns are chosen to survive the existing per-face UV stretch (large
// soft blobs, high-contrast value bands, direction-agnostic noise). No
// geometry change, no UV remap; the screenshot gate (G.6) is the judge.
//
// Exports ONLY skinTexture() + seedFor() (+ skinCacheSize() for the boot
// budget probe). There is NO second applicator here: applySkin() in
// weapons.js is the single applicator. No window write anywhere in this
// file: main.js reads the cache size after window.__ferroline exists.
import * as THREE from 'three';
import { SKIN_FAMILIES_LIST } from './shop.js';
import { mulberry32 } from './state.js';

const _cache = new Map();

export function skinCacheSize() { return _cache.size; }

// FNV-1a over the family id — a stable per-family seed.
export function seedFor(familyId) {
  let h = 2166136261 >>> 0;
  const s = String(familyId || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function familyDef(familyId) {
  return (SKIN_FAMILIES_LIST || []).find((f) => f.id === familyId) || null;
}

function css(n) { return '#' + (n >>> 0).toString(16).padStart(6, '0'); }

// Lighten/darken a hex colour by f (-1..1) for camo tone steps.
function shade(n, f) {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

function sizeFor(role) { return role === 'body' ? 256 : 128; }
function cellFor(role, base) {
  return role === 'body' ? base : Math.max(4, Math.round(base / 2));
}

// --- Generators (one per pattern; ctx is already sized) ---------------

// DUNE — desert camo: large soft blobs in 3 tones over the tan base.
function _camo(ctx, size, colors, rng) {
  ctx.fillStyle = css(colors.body);
  ctx.fillRect(0, 0, size, size);
  const tones = [shade(colors.steel, 0.15), shade(colors.grip, 0.25), shade(colors.body, -0.22)];
  for (let i = 0; i < 26; i++) {
    const x = rng() * size, y = rng() * size;
    const rx = size * (0.10 + rng() * 0.16), ry = size * (0.07 + rng() * 0.11);
    const rot = rng() * Math.PI;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = 0.55 + rng() * 0.3;
    ctx.fillStyle = css(tones[i % tones.length]);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// PINEWATCH — woodland leaf-litter camo: many small leaf ellipses +
// speckles over the forest-green base.
function _camoLeaf(ctx, size, colors, rng) {
  ctx.fillStyle = css(colors.body);
  ctx.fillRect(0, 0, size, size);
  const tones = [shade(colors.steel, 0.1), shade(colors.grip, 0.3), shade(colors.body, -0.3), colors.accent];
  for (let i = 0; i < 240; i++) {
    const x = rng() * size, y = rng() * size;
    const rx = size * (0.012 + rng() * 0.03), ry = rx * (0.4 + rng() * 0.4);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * Math.PI);
    ctx.globalAlpha = 0.5 + rng() * 0.45;
    ctx.fillStyle = css(tones[(rng() * tones.length) | 0]);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // A few larger soft blobs so the pattern reads at a distance too.
  for (let i = 0; i < 8; i++) {
    const x = rng() * size, y = rng() * size;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = css(shade(colors.grip, 0.1));
    ctx.beginPath();
    ctx.ellipse(x, y, size * 0.14, size * 0.09, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// EMBERLINE — brushed metal + heat tint: horizontal brush lines over the
// crimson base, with a cool heat-tint band along one edge.
function _brushed(ctx, size, colors, rng) {
  ctx.fillStyle = css(colors.body);
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    const v = rng();
    ctx.globalAlpha = 0.05 + v * 0.12;
    ctx.fillStyle = v > 0.5 ? css(shade(colors.body, 0.25)) : css(shade(colors.body, -0.25));
    ctx.fillRect(0, y, size, 1);
  }
  ctx.globalAlpha = 1;
  // Heat tint: a cool blue-violet band fading in from the bottom edge.
  const grad = ctx.createLinearGradient(0, size * 0.7, 0, size);
  grad.addColorStop(0, 'rgba(90,110,200,0)');
  grad.addColorStop(1, 'rgba(90,110,200,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, size * 0.7, size, size * 0.3);
  // A thin hot accent line where the tint starts.
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = css(colors.accent);
  ctx.fillRect(0, size * 0.7, size, Math.max(1, size / 128));
  ctx.globalAlpha = 1;
}

// GLACIER — frost crystal: pale base, shard polygons + ice-blue veins.
function _frost(ctx, size, colors, rng) {
  ctx.fillStyle = css(colors.body);
  ctx.fillRect(0, 0, size, size);
  // Soft cold blotches.
  for (let i = 0; i < 14; i++) {
    const x = rng() * size, y = rng() * size;
    ctx.save();
    ctx.globalAlpha = 0.18 + rng() * 0.2;
    ctx.fillStyle = css(shade(colors.steel, 0.3));
    ctx.beginPath();
    ctx.ellipse(x, y, size * (0.08 + rng() * 0.12), size * (0.06 + rng() * 0.09), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Crystal shards: thin bright polygons.
  for (let i = 0; i < 46; i++) {
    const x = rng() * size, y = rng() * size;
    const len = size * (0.05 + rng() * 0.12);
    const ang = rng() * Math.PI;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.globalAlpha = 0.5 + rng() * 0.4;
    ctx.fillStyle = i % 3 === 0 ? css(colors.accent) : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.lineTo(0, -len * 0.12);
    ctx.lineTo(len / 2, 0);
    ctx.lineTo(0, len * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// VOLTSTRIKE — digital pixel camo (24 px cells on body, halved on
// steel/grip) + hazard stripes along one corner.
function _digital(ctx, size, colors, rng, cell) {
  ctx.fillStyle = css(colors.body);
  ctx.fillRect(0, 0, size, size);
  const tones = [colors.body, colors.steel, colors.grip, colors.accent];
  const n = Math.max(2, Math.round(size / cell));
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const r = rng();
      if (r < 0.45) continue; // keep the base dominant
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = css(tones[(rng() * tones.length) | 0]);
      ctx.fillRect(gx * cell, gy * cell, cell, cell);
    }
  }
  ctx.globalAlpha = 1;
  // Hazard stripes: diagonal accent/dark bands across the top-left corner.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size * 0.45, size * 0.45);
  ctx.clip();
  ctx.translate(size * 0.1, size * 0.1);
  ctx.rotate(-Math.PI / 4);
  for (let i = -6; i < 6; i++) {
    ctx.fillStyle = i % 2 === 0 ? css(colors.accent) : css(colors.grip);
    ctx.fillRect(i * size * 0.06, -size, size * 0.03, size * 2);
  }
  ctx.restore();
}

// NOCTURNE — carbon-fibre weave (12 px tows on body, halved on
// steel/grip): alternating horizontal/vertical tows with a sheen.
function _carbon(ctx, size, colors, rng, cell) {
  ctx.fillStyle = css(colors.body);
  ctx.fillRect(0, 0, size, size);
  const n = Math.max(2, Math.round(size / cell));
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const horiz = (gx + gy) % 2 === 0;
      const light = 0.06 + rng() * 0.10;
      ctx.fillStyle = horiz
        ? css(shade(colors.body, light))
        : css(shade(colors.body, -light * 0.5));
      if (horiz) ctx.fillRect(gx * cell + 1, gy * cell, cell - 2, cell);
      else ctx.fillRect(gx * cell, gy * cell + 1, cell, cell - 2);
    }
  }
  // Sheen: one soft diagonal highlight so the weave reads as fibre, not flat.
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(155,123,255,0.08)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
}

const GENERATORS = {
  camo: (ctx, size, colors, rng) => _camo(ctx, size, colors, rng),
  leaf: (ctx, size, colors, rng) => _camoLeaf(ctx, size, colors, rng),
  brushed: (ctx, size, colors, rng) => _brushed(ctx, size, colors, rng),
  frost: (ctx, size, colors, rng) => _frost(ctx, size, colors, rng),
  digital: (ctx, size, colors, rng, cell) => _digital(ctx, size, colors, rng, cell),
  carbon: (ctx, size, colors, rng, cell) => _carbon(ctx, size, colors, rng, cell),
};

// The one texture factory. familyId: 'dune' | 'pine' | 'ember' |
// 'glacier' | 'volt' | 'nocturne'. role: 'body' | 'steel' | 'grip'
// ('accent' never gets a texture — it stays flat). colors: the family
// colour set ({body, steel, grip, accent}); seed defaults to
// seedFor(familyId) so the same family always paints the same pattern.
export function skinTexture(familyId, role, colors, seed) {
  const key = `${familyId}:${role}`;
  const hit = _cache.get(key);
  if (hit) return hit;
  const fam = familyDef(familyId);
  const cols = colors || (fam ? fam.colors : null) ||
    { body: 0x888888, steel: 0x666666, grip: 0x222222, accent: 0xffffff };
  const size = sizeFor(role);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const rng = mulberry32(seed === undefined ? seedFor(familyId) : seed);
  const pattern = (fam && fam.pattern) || 'camo';
  const gen = GENERATORS[pattern] || GENERATORS.camo;
  const baseCell = pattern === 'digital' ? 24 : pattern === 'carbon' ? 12 : 24;
  gen(ctx, size, cols, rng, cellFor(role, baseCell));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  _cache.set(key, tex);
  return tex;
}
