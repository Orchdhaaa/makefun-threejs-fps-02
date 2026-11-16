// menu.js — FERROLINE lobby (home screen), v2 redesign.
//
// Layout language borrowed from a tactical-FPS lobby reference, all
// FERROLINE's own content: dark background, amber/gold highlights, our
// own soldier model, operator names and palette. No reference art, names
// or characters are copied.
//
// The menu is pure DOM + CSS plus ONE small three.js showcase scene
// (a single soldier on a dark stage, rendered by its own renderer on
// its own canvas — it never touches the game renderer/scene). No
// network, no external assets. Mode/map cards are rendered from the
// lists passed in by the caller — the menu never hard-codes a mode or
// map list itself. The game coordinator (main.js) wires it in;
// index.html also carries a small standalone bootstrap with fallback
// data so the menu works before that wiring lands.
//
// DECOUPLING (v2): this file's ONLY top-level import is settings.js
// (which imports nothing). three.js + palette.js load only via dynamic
// import() inside initShowcase()/initShopPreview(), and shop.js only
// via dynamic import() when the shop is needed — so a truncated
// three.js or shop.js can never take down the pickers or PLAY.
// Pickers are STATIC HTML in index.html; this file HYDRATES them
// (attaches listeners, re-applies selection) instead of rebuilding
// them, and never blanks a container before its replacement is ready.
//
// NOTE — soldier model: bots.js does NOT export its soldier builder
// (buildRifle + the rig are local to createBots), so the showcase
// soldier is built here from the SAME parts and proportions as the bot
// rig (same torso/head/helmet/vest/leg/boot sizes and positions, same
// held-rifle construction). A shared export from bots.js
// (e.g. export function buildSoldier(accent)) would be cleaner and
// would keep the two in sync — recommended for integration, but this
// file must not touch bots.js.
//
// API
// ---
//   import { createHomeScreen, OPERATORS, LOADOUT_SLOTS, renderLoadout }
//     from './menu.js';
//
//   const menu = createHomeScreen({
//     modes:       [{ id, name, desc }, ...],
//     maps:        [{ id, name, desc }, ...],
//     onPlay:      ({ mode, mapId, operatorId }) => { ... },
//     onMuteToggle:(muted) => { ... },   // optional: wire to audio.js
//     operators:   OPERATORS,            // optional, defaults to OPERATORS
//     loadout:     { pistol: true, ... } // optional, see renderLoadout
//     defaultMode: 'bomb',
//     defaultMapId:'depot9',
//     defaultOperator: 'vex',
//   });
//
//   menu.show() / menu.hide() / menu.isVisible() — as before. hide()
//   also stops the showcase animation loop; show() restarts it.
//   menu.getSelection() — { mode, mapId }.
//   menu.setSelection(mode, mapId) — as before.
//   menu.getOperator() — the selected operator object.
//   menu.setOperator(id) — select an operator (recolours the showcase).
//   menu.getLoadout() / menu.setLoadout(owned) — the 5-slot loadout map.
//   menu.isMuted() / menu.setMuted(m) — lobby sound setting.
//   menu.getSettings() — the live settings object (settings.js).
//   menu.openSettings() / menu.closeSettings() / menu.toggleSettings() /
//   menu.isSettingsOpen() / menu.syncSettings() — the settings panel.
//   menu.openShop(tab?) / menu.closeShop() / menu.toggleShop() /
//   menu.isShopOpen() / menu.syncShop() — the shop panel.
//
// SETTINGS PANEL (this file owns the panel UI + persistence wiring;
// the coordinator owns the game-side effects — see the SETTINGS
// WIRING CONTRACT below). The panel lives in #home-settings-panel
// (index.html) and opens from the SETTINGS nav button. Four groups,
// all persisted via settings.js (localStorage 'ferroline.settings.v1'):
//   GRAPHICS     LOW/MEDIUM/ULTRA buttons -> setSettings({ quality }).
//   SOUND        #home-volume slider (0-100) -> setSettings({ volume });
//                #home-mute-btn -> setMuted(m) -> setSettings({ muted })
//                + the onMuteToggle(m) callback when the coordinator
//                passes one. #home-motion-btn is the lobby-only idle
//                showcase motion toggle (not a persisted setting).
//                Volume presets (QUIET 40% / BALANCED 75% / LOUD 100%)
//                only write the existing volume setting.
//   SENSITIVITY  7 sliders (data-sens=hipfire|pistol|primary|sniper|
//                knife|scopeSniper|scopeIron, 0.3-2.5) ->
//                setSensitivity(); #home-sens-reset -> resetSensitivity();
//                the EFFECTIVE block reads effectiveSensitivity() for
//                rifle hipfire, sniper scoped and rifle iron sights.
//   CONTROLS     static keybind table (moved from the footer).
//   menu.syncSettings() re-reads settings.js into every control; it
//   runs whenever the panel opens, so a reopen always shows the saved
//   values — including values changed in-game by the coordinator.
//
// --- SETTINGS WIRING CONTRACT (coordinator: main.js / audio.js / world.js / fx.js) ---
//   The panel only writes settings.js; these are the game-side reads:
//   GRAPHICS  main.js boot (and on PLAY, after the menu closes): read
//     qualityPreset(getSettings().quality) and apply:
//       renderer.setPixelRatio(Math.min(devicePixelRatio, preset.pixelRatioMax));
//       renderer.shadowMap.enabled = preset.shadows;
//       world.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize)
//         + sun.shadow.map.dispose(); sun.shadow.map = null; (size 0 = shadows off)
//     world.js: atmosphere extras (cloud planes, sun disc, mountain ring)
//       visible = preset.atmosphere — world.js must tag them first
//       (e.g. group.userData.atmosphere); it does not expose them today.
//     fx.js: particle burst counts x preset.particleScale (0.35 / 1 / 1.6).
//   SOUND  audio.js needs a setVolume(v): master.gain.value =
//     muted ? 0 : MASTER_GAIN * v, where v = getSettings().volume (0..1).
//     main.js boot: audio.setMuted(getSettings().muted) and
//     audio.setVolume(getSettings().volume). The 'M' key handler must
//     also write back via setSettings({ muted }) so the lobby stays in
//     sync. Pass onMuteToggle: (m) => audio.setMuted(m) in the
//     createHomeScreen options in main.js (it is NOT passed today, so
//     the lobby mute currently only persists — it does not yet reach
//     the audio engine until the coordinator wires that one line).
//   SENSITIVITY  main.js look step (~L352): replace the constant SENS
//     with SENS * effectiveSensitivity(getSettings(), p.weapon, aiming,
//     p.weapon === 'sniper'). Weapon ids 'pistol' | 'rifle' | 'sniper' |
//     'knife' map to the pistol/primary/sniper/knife multipliers;
//     'grenade'/'smoke' get no weapon multiplier. ---
//
//   PLAY fires onPlay({ mode, mapId, operatorId }) first, then hides.
//   Enter while visible == PLAY. The operator choice is persisted in
//   localStorage ('ferroline.operator') and restored on next load.
//
// LOADOUT STRIP (data-driven — the 5-slot loadout strip derives live
// from the shop save on every paint; see buildDisplayLoadout):
//   renderLoadout(container, display, skinMap, hintText) draws the five
//   slots by key. display shape: { pistol, primary, knife, frag, smoke }
//   where each value is { state, name, detail, weaponId?, price? }.
//   state is one of: picked (IN LOADOUT), not-picked (NOT PICKED —
//   CLICK TO PICK), none-picked (PISTOL ONLY), not-owned (NOT OWNED ·
//   {price} CR), fixed (ALWAYS CARRIED), off (NOT CARRIED — CLICK TO
//   ADD · FREE). The word LOCKED never appears on the strip.
//   Default (shop not loaded yet): DEFAULT_LOADOUT — pistol + knife
//   always carried, primary not owned, frag/smoke not carried.
//   The strip is clickable: slot 2 cycles the primary pick
//   (shop.js cycleLoadoutPrimary), slots 4/5 toggle the throwables
//   (shop.js setLoadoutThrowable). No external seeding: setLoadout()
//   is a compatibility shim that just repaints.
//
// SHOP (this file owns the panel UI; all state lives in shop.js,
// localStorage 'ferroline.shop.v1'). Three tabs — WEAPONS / SKINS /
// OUTFITS — with a preview stage (own renderer, own camera) that shows
// the selected item large. Skins are families (one name, one price,
// per weapon); outfits are universal lobby-only appearance sets.
// Buying never touches the game: it only writes shop.js localStorage;
// the coordinator applies unlocks + skins at match start (see the
// shop.js WIRING CONTRACT). The ONE state rule per card: exactly one
// signal on the LEFT (price / OWNED / EQUIPPED pill); the RIGHT holds
// an action button only when an action exists. An unaffordable BUY is
// never disabled — it stays live as NEED n MORE and explains the
// shortfall + earn math on click.
//
// OUTFITS — precedence (one writer, no second opinion): paintSoldier()
// is the only function that writes soldier colours. The OPERATOR
// contributes skill/name/role/callsign/quote and the rifle variant
// (sniper bool) — nothing about colours. The OUTFIT (equipped, or the
// preview outfit on the separate preview soldier) contributes
// uniform/vest/helmet/accent/pants/boots and WINS over the operator
// for every colour. The operator accent (--op-accent) survives only in
// the UI cue places: portrait tile tint, role tag, name-plate rule.
//
// Re-entrant: calling createHomeScreen() again updates the existing
// menu in place instead of building a second one. The live instance is
// exposed as window.__ferrolineMenu; lobby debug state (operator,
// loadout, showcase status) as window.__ferrolineLobby.
import { getSettings, setSettings, setSensitivity, resetSensitivity,
  effectiveSensitivity } from './settings.js';

const DEFAULT_MODE = 'bomb';
const DEFAULT_MAP = 'depot9';
const DEFAULT_OPERATOR = 'vex';
const OPERATOR_KEY = 'ferroline.operator';

// --- Operators: FERROLINE's own names/callsigns. Each operator has
// a REAL passive skill, defined here as plain numbers the game can
// multiply by — NOT a label. The lobby only carries the data and the
// display; the coordinator wires the multipliers into the game systems
// (see WIRING CONTRACT below). Visual variant (vest/helmet/accent +
// rifle vs long-scope rifle for Recon) rides on the same record.
// --- WIRING CONTRACT (coordinator: main.js / combat.js / rounds.js) ---
//   onPlay now fires { mode, mapId, operatorId } AND the full record is
//   available as window.__ferrolineMenu.getOperator() / OPERATORS.
//   Read the selected operator once at match start (or on every use —
//   the values are constants) and apply exactly these multipliers:
//   reloadMul       VEX    main.js ~L343: weapons.reloadT =
//                          WEAPONS[p.weapon].reload * reloadMul, and the
//                          same value as the fx.startReload duration.
//   speedMul        SABLE  main.js ~L374: playerStep(move, keys, dt,
//                          (p.weapon==='grenade'?1:def.speedMul) * speedMul)
//   damageTakenMul  ANVIL  combat.js damage(): when target.id === 'you',
//                          amount *= damageTakenMul BEFORE target.hp -=
//                          amount (and before the 'hit' event amount).
//   channelMul      WRAITH main.js plant channel ONLY: the player
//                          completes at ROUND.plantTime * channelMul
//                          (4s -> 3.2s); use the same effective time in
//                          the fx.setChannelProgress / hud.setChannel
//                          denominators. The player never defuses —
//                          defuse is bot-only (bots.js updateDefuse, raw
//                          5 s clock, no channelMul) — so the skill is
//                          sold as plant-only, not plant+defuse.
//   Default (no operator / unknown id): every multiplier is 1.
//   Store the pick on the player, e.g. state.player.operatorId, so a
//   ?mode=/?map= reload after PLAY can re-apply it (menu passes
//   operatorId in onPlay; main.js must carry it into the reload URL or
//   re-read localStorage 'ferroline.operator'). ---
// Operator accents are UI cues only (tile tint, role tag, name-plate
// rule) — they NEVER re-theme the lobby (brand amber is constant).
// VEX is violet so the default operator's cue is visible at all.
export const OPERATORS = [
  { id: 'vex', name: 'VEX', callsign: 'MARA VOSS', role: 'ASSAULT',
    line: 'Breaches first. Holds the line.',
    skill: { id: 'rapid-hands', name: 'RAPID HANDS',
      desc: 'Reloads 20% faster.', mods: { reloadMul: 0.80 } },
    vest: 0xd98a1f, helmet: 0x6b5a34, accent: '#9b7bff', sniper: false },
  { id: 'sable', name: 'SABLE', callsign: 'DARA KINT', role: 'RECON',
    line: 'Long sightlines. One shot, then gone.',
    skill: { id: 'light-foot', name: 'LIGHT FOOT',
      desc: 'Moves 10% faster.', mods: { speedMul: 1.10 } },
    vest: 0x27655f, helmet: 0x2e4a3f, accent: '#2f9e8f', sniper: true },
  { id: 'anvil', name: 'ANVIL', callsign: 'BRAM HOLT', role: 'SUPPORT',
    line: 'Ammo, cover, and a wall that shoots back.',
    skill: { id: 'plated-vest', name: 'PLATED VEST',
      desc: 'Takes 15% less damage.', mods: { damageTakenMul: 0.85 } },
    vest: 0x8a4a28, helmet: 0x4a3527, accent: '#b4552d', sniper: false },
  { id: 'wraith', name: 'WRAITH', callsign: 'ILYA SORREN', role: 'BREACHER',
    line: 'Smoke, flash, straight through the door.',
    skill: { id: 'sapper', name: 'SAPPER',
      desc: 'Plants 20% faster.', mods: { channelMul: 0.80 } },
    vest: 0x2f6fd0, helmet: 0x2e4a66, accent: '#4da3ff', sniper: false },
];

// --- Loadout slots: the five slots, by key. Names come from weapons.js
// where they exist (SPARROW P9 / HERON AR-4 / FRAG); the knife and the
// smoke grenade are lobby-only names until the loadout specialist
// lands them in-game. ---
export const LOADOUT_SLOTS = [
  { key: 'pistol', label: 'PISTOL', name: 'SPARROW P9' },
  { key: 'primary', label: 'PRIMARY', name: 'HERON AR-4' },
  { key: 'knife', label: 'KNIFE', name: 'TALON K-1' },
  { key: 'frag', label: 'FRAG', name: 'FRAG GRENADE' },
  { key: 'smoke', label: 'SMOKE', name: 'SMOKE GRENADE' },
];

export const DEFAULT_LOADOUT = {
  pistol: { state: 'fixed', name: 'SPARROW P9', detail: '12/36' },
  primary: { state: 'not-owned', name: 'NO PRIMARY', detail: 'Buy in the shop · from 1,200 CR', price: 1200 },
  knife: { state: 'fixed', name: 'TALON K-1', detail: 'MELEE' },
  frag: { state: 'off', name: 'FRAG GRENADE', detail: 'Free — click to add · round-based modes only' },
  smoke: { state: 'off', name: 'SMOKE GRENADE', detail: 'Free — click to add · round-based modes only' },
};

// Default outfit (DEPOT STANDARD): the current look; every profile
// starts in it. Used until the shop module loads (it is the source of
// truth for outfit data — this is only the fallback). Colours are
// numeric hexes, matching shop.js SHOP_OUTFITS.
const DEFAULT_OUTFIT = {
  id: 'depot-standard', name: 'DEPOT STANDARD', price: 0,
  desc: 'The current look; every profile starts in it.',
  colors: { uniform: 0x4a4a38, vest: 0xd98a1f, helmet: 0x6b5a34,
    accent: 0xf0a830, pants: 0x2b2b26, boots: 0x14161a },
  pairsWith: 'DUNE',
};

// Factory finish colours for the shop preview (PALETTE gunmetal /
// gunmetalLight / gunPolymer / accent — hardcoded here because this
// file must not import palette.js statically; see DECOUPLING above).
const FACTORY_COLORS = { body: 0x2f333a, steel: 0x5d636d, grip: 0x17181b, accent: 0xf0a830 };

// Map identity until real thumbnails exist: a 4px top strip in a
// distinct, fixed, muted tone per map.
const MAP_STRIP = { depot9: '#f0a830', foundry: '#b4552d', dustline: '#c9a06a' };
// SHORT_DESC — lobby display copy for mode/map cards. The registries in
// rounds.js / world.js carry the full flavour text (also shown in-match),
// but a mode card at 1280px has ~92px of text width on its selected
// state (3 lines x ~16 chars) and a map card ~93px (3 lines x ~17
// chars), so the lobby shows these shortened lines instead. Keep every
// entry <= 36 chars (modes) / <= 38 chars (maps) so no card ever
// ellipsises — the ABOUT detail tile and the mode meta line
// (FIRST TO n KILLS / 5 v 5) carry the dropped detail.
const SHORT_DESC = {
  mode: {
    bomb: 'Plant the charge, wipe the Wardens.',
    tdm: 'First to 20 kills wins. Respawns.',
    attack: 'Breakers storm the shed. Hold out.',
    domination: 'Hold A, B, C to score. First to 100.',
    frontline: 'Push the front into the enemy base.',
  },
  map: {
    depot9: 'Rail depot at dawn. Open lanes, cover.',
    foundry: 'Sodium-lit factory. Tight lanes.',
    dustline: 'Desert canyon. Long sightlines.',
  },
};
function shortDesc(kind, item) {
  return (SHORT_DESC[kind] && SHORT_DESC[kind][item.id]) || item.desc || '';
}

let instance = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function hexCss(n) { return '#' + n.toString(16).padStart(6, '0'); }

function rgbaFromHex(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function normOwned(v) {
  if (v && typeof v === 'object') return {
    state: v.state || (v.owned ? 'picked' : 'not-owned'),
    name: v.name || '',
    detail: v.detail || '',
    weaponId: v.weaponId || null,
    price: typeof v.price === 'number' ? v.price : null,
    owned: !!v.owned,
  };
  return { state: 'not-owned', name: '', detail: '', weaponId: null, price: null, owned: !!v };
}

// --- Inline SVG glyphs (schematic silhouettes, single-colour) --------
// One glyph per weapon class, shared by the loadout strip, the shop
// cards and the preview fallback. Geometric outlines only — they make a
// pistol and a DMR distinguishable at a glance, which text alone never
// did. No art assets, no network.
const GLYPHS = {
  pistol: '<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="3" y="8" width="19" height="6" fill="currentColor"/><rect x="15" y="14" width="5" height="10" fill="currentColor" transform="rotate(10 17 19)"/></svg>',
  smg: '<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="4" y="11" width="16" height="4" fill="currentColor"/><rect x="20" y="12" width="5" height="2" fill="currentColor"/><rect x="9" y="15" width="3" height="6" fill="currentColor"/><rect x="15" y="15" width="3" height="5" fill="currentColor"/></svg>',
  rifle: '<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="2" y="11" width="24" height="4" fill="currentColor"/><rect x="10" y="15" width="4" height="6" fill="currentColor" transform="rotate(-12 12 18)"/><rect x="18" y="15" width="4" height="5" fill="currentColor" transform="rotate(12 20 17)"/></svg>',
  sniper: '<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="12" width="26" height="3" fill="currentColor"/><rect x="10" y="8" width="8" height="4" fill="currentColor"/><rect x="12" y="15" width="3" height="6" fill="currentColor"/></svg>',
  knife: '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 23 L21 5 L23 7 L9 24 Z" fill="currentColor"/><rect x="3" y="20" width="7" height="3" fill="currentColor" transform="rotate(-45 6 21)"/></svg>',
  grenade: '<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="17" r="7" fill="currentColor"/><rect x="12" y="6" width="4" height="5" fill="currentColor"/><path d="M16 7 L22 4" stroke="currentColor" stroke-width="2"/></svg>',
};
function glyphFor(weaponId) {
  if (weaponId === 'primary') return GLYPHS.rifle;
  return GLYPHS[weaponId] || GLYPHS.rifle;
}

// Operator portrait tile: a bust silhouette (helmet dome + shoulders)
// in --op-accent. Schematic and honest about having no portrait
// renders, but it reads as a person, which a letter never does.
const BUST_SVG = '<svg viewBox="0 0 56 76" aria-hidden="true"><path d="M14 38 A14 14 0 0 1 42 38 L42 40 L14 40 Z" fill="currentColor"/><rect x="10" y="38" width="36" height="4" fill="currentColor"/><path d="M8 76 L16 50 L40 50 L48 76 Z" fill="currentColor" opacity="0.85"/></svg>';

// Draw the five loadout slots into `container` from the display map.
// Exported so the coordinator (or a test) can render the strip anywhere
// without going through createHomeScreen. `skinMap` (optional) maps a
// weapon id to its equipped skin object ({ id, name, colors }) — an
// equipped skin shows as a 4px accent chip and its family name in the
// detail line. `hintText` (optional) is rendered as the hint line, the
// LAST child of the container. Atomic: builds off-DOM, swaps in one
// replaceChildren.
//
// Slot states (never the word LOCKED — a slot is always in exactly one
// of these): picked (IN LOADOUT), not-picked (NOT PICKED — CLICK TO
// PICK), none-picked (PISTOL ONLY), not-owned (NOT OWNED · {price} CR),
// fixed (ALWAYS CARRIED), off (NOT CARRIED — CLICK TO ADD · FREE).
// Slots 2 (primary) and 4/5 (frag/smoke) are clickable buttons; slots
// 1 (pistol) and 3 (knife) are always carried and are not buttons.
export function renderLoadout(container, owned = {}, skinMap = {}, hintText = '') {
  if (!container) return;
  const frag = document.createDocumentFragment();
  for (const slot of LOADOUT_SLOTS) {
    const st = normOwned(owned ? owned[slot.key] : undefined);
    const card = el('div', 'loadout-slot' + (st.state ? ' ' + st.state : ''));
    card.dataset.slot = slot.key;
    const clickable = slot.key === 'primary' || slot.key === 'frag' || slot.key === 'smoke';
    if (clickable) {
      card.classList.add('clickable');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      if (st.state === 'picked') card.title = 'In your loadout — click to change';
      else if (st.state === 'not-picked') card.title = 'Owned — click to make it your primary';
      else if (st.state === 'none-picked') card.title = 'Pistol only — click to pick a primary';
      else if (st.state === 'not-owned') card.title = 'Not owned — click to open the shop';
      else if (st.state === 'off') card.title = 'Not carried — click to add it free';
    }
    const glyph = el('span', 'loadout-glyph');
    glyph.innerHTML = glyphFor(slot.key === 'frag' || slot.key === 'smoke' ? 'grenade' : slot.key);
    card.appendChild(glyph);
    const text = el('span', 'loadout-text');
    const top = el('span', 'loadout-top');
    top.appendChild(el('span', 'loadout-slot-key', slot.label));
    const pill = st.state === 'picked' ? 'IN LOADOUT'
      : st.state === 'not-picked' ? 'NOT PICKED — CLICK TO PICK'
      : st.state === 'none-picked' ? 'PISTOL ONLY'
      : st.state === 'not-owned' ? `NOT OWNED · ${st.price !== null ? st.price.toLocaleString('en-US') : '—'} CR`
      : st.state === 'fixed' ? 'ALWAYS CARRIED'
      : st.state === 'off' ? 'NOT CARRIED — CLICK TO ADD · FREE'
      : (st.owned ? 'OWNED' : '');
    top.appendChild(el('span', 'loadout-slot-state', pill));
    text.appendChild(top);
    text.appendChild(el('span', 'loadout-slot-name', st.name || slot.name));
    const wid = st.weaponId || null;
    const skin = wid && skinMap ? skinMap[wid] : null;
    let detail = st.detail || '';
    if (skin && st.weaponId) detail = `${detail} · ${skin.name}`;
    text.appendChild(el('span', 'loadout-slot-detail', detail));
    card.appendChild(text);
    const chip = el('span', 'loadout-skinchip');
    if (skin && st.weaponId) {
      chip.style.background = hexCss(skin.colors.accent);
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
    card.appendChild(chip);
    frag.appendChild(card);
  }
  if (hintText) {
    const hint = el('div', 'loadout-hint', hintText);
    hint.id = 'home-loadout-hint';
    frag.appendChild(hint);
  }
  container.replaceChildren(frag);
}

// --- Showcase soldier -------------------------------------------------
// Same parts/proportions as the bot rig in bots.js: torso box
// 0.52x0.78x0.30 at y 1.0, head sphere r 0.16 at y 1.53, helmet
// hemisphere, vest plates front/back, pouches, straps, belt, legs,
// boots, arms angled forward to a held rifle. Colours that vary per
// outfit (uniform / vest / helmet / accent / pants / boots) are kept
// as separate materials so paintSoldierMats can recolour them in
// place; the rifle is rebuilt when switching to/from the Recon
// long-scope variant. THREE and PALETTE are passed in (dynamic
// import) — this file must not import them statically.
function buildShowcaseSoldier(THREE, PALETTE) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: PALETTE.skin, roughness: 0.7 });
  const skinDark = new THREE.MeshStandardMaterial({ color: PALETTE.skinDark, roughness: 0.75 });
  const uniform = new THREE.MeshStandardMaterial({ color: PALETTE.uniformBreaker, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: PALETTE.pantsDark, roughness: 0.95 });
  const boots = new THREE.MeshStandardMaterial({ color: PALETTE.bootDark, roughness: 0.9 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: PALETTE.gunmetal, roughness: 0.45, metalness: 0.5 });
  const gunGrip = new THREE.MeshStandardMaterial({ color: PALETTE.gunPolymer, roughness: 0.9 });
  const vestMat = new THREE.MeshStandardMaterial({ color: 0xd98a1f, roughness: 0.75 });
  // R2: ALL gear used to be one amber (vestMat 0xd98a1f) — at 720p the
  // kit read as amber lumps. Pouches are a dark bronze-olive and
  // straps/shoulder pads a dark brown, so plates / pouches / straps
  // read as three separate kit layers. paintSoldierMats() derives both
  // from the outfit's vest colour, so recolours stay coherent.
  const pouchMat = new THREE.MeshStandardMaterial({ color: 0x774c11, roughness: 0.85 });
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x462c0a, roughness: 0.9 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0x6b5a34, roughness: 0.8 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.7 });

  const add = (geo, m, x, y, z, rx = 0, ry = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  const torso = add(new THREE.BoxGeometry(0.52, 0.78, 0.30), uniform, 0, 1.0, 0);
  const head = add(new THREE.SphereGeometry(0.16, 12, 10), skin, 0, 1.53, 0);
  const helmet = add(new THREE.SphereGeometry(0.185, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat, 0, 1.56, 0);
  add(new THREE.BoxGeometry(0.37, 0.05, 0.37), accentMat, 0, 1.60, 0); // helmet band
  add(new THREE.BoxGeometry(0.24, 0.07, 0.05), gunGrip, 0, 1.57, -0.16); // goggles
  add(new THREE.BoxGeometry(0.20, 0.12, 0.04), skinDark, 0, 1.44, -0.14); // mask
  add(new THREE.BoxGeometry(0.46, 0.52, 0.05), vestMat, 0, 1.08, -0.155); // vest front
  add(new THREE.BoxGeometry(0.46, 0.52, 0.05), vestMat, 0, 1.08, 0.155); // vest back
  add(new THREE.BoxGeometry(0.16, 0.13, 0.05), pouchMat, -0.12, 0.95, -0.19); // pouch L
  add(new THREE.BoxGeometry(0.16, 0.13, 0.05), pouchMat, 0.12, 0.95, -0.19); // pouch R
  add(new THREE.BoxGeometry(0.10, 0.04, 0.34), strapMat, -0.16, 1.40, 0); // strap L
  add(new THREE.BoxGeometry(0.10, 0.04, 0.34), strapMat, 0.16, 1.40, 0); // strap R
  add(new THREE.BoxGeometry(0.54, 0.08, 0.32), boots, 0, 0.64, 0); // belt
  add(new THREE.BoxGeometry(0.13, 0.02, 0.13), accentMat, -0.20, 1.395, -0.05); // patch
  // --- DF-bar gear detail (2026-11-15 gfx push): the soldier must read
  // as kitted-out, not a bare mannequin. All static, same materials —
  // no pose or hold changes, so the two-handed fix is untouched. ---
  add(new THREE.BoxGeometry(0.10, 0.14, 0.04), pouchMat, 0.14, 1.22, -0.19); // chest radio
  add(new THREE.BoxGeometry(0.03, 0.03, 0.03), accentMat, 0.14, 1.30, -0.20); // radio antenna tip
  add(new THREE.BoxGeometry(0.14, 0.12, 0.05), pouchMat, -0.13, 0.82, -0.19); // lower pouch L
  add(new THREE.BoxGeometry(0.14, 0.12, 0.05), pouchMat, 0.13, 0.82, -0.19); // lower pouch R
  add(new THREE.BoxGeometry(0.09, 0.16, 0.05), pouchMat, -0.05, 1.05, -0.20); // mag pouch L
  add(new THREE.BoxGeometry(0.09, 0.16, 0.05), pouchMat, 0.05, 1.05, -0.20); // mag pouch R
  add(new THREE.BoxGeometry(0.16, 0.06, 0.24), strapMat, -0.26, 1.36, 0); // shoulder pad L
  add(new THREE.BoxGeometry(0.16, 0.06, 0.24), strapMat, 0.26, 1.36, 0); // shoulder pad R
  add(new THREE.BoxGeometry(0.20, 0.14, 0.06), boots, -0.14, 0.32, -0.12); // knee pad L
  add(new THREE.BoxGeometry(0.20, 0.14, 0.06), boots, 0.14, 0.32, -0.12); // knee pad R
  add(new THREE.BoxGeometry(0.08, 0.06, 0.06), gunGrip, 0, 1.62, -0.17); // helmet NVG mount
  add(new THREE.BoxGeometry(0.30, 0.02, 0.12), helmetMat, 0, 1.63, -0.12); // helmet brim
  add(new THREE.BoxGeometry(0.12, 0.10, 0.06), boots, -0.24, 0.62, -0.05); // belt pouch L
  add(new THREE.BoxGeometry(0.12, 0.10, 0.06), boots, 0.24, 0.62, -0.05); // belt pouch R
  add(new THREE.BoxGeometry(0.22, 0.03, 0.34), boots, -0.14, 0.015, -0.03); // boot sole L
  add(new THREE.BoxGeometry(0.22, 0.03, 0.34), boots, 0.14, 0.015, -0.03); // boot sole R
  const legL = add(new THREE.BoxGeometry(0.19, 0.62, 0.21), pants, -0.14, 0.31, 0);
  const legR = add(new THREE.BoxGeometry(0.19, 0.62, 0.21), pants, 0.14, 0.31, 0);
  add(new THREE.BoxGeometry(0.20, 0.12, 0.32), boots, -0.14, 0.06, -0.03);
  add(new THREE.BoxGeometry(0.20, 0.12, 0.32), boots, 0.14, 0.06, -0.03);
  // Arms + hands — showcase hold (weapon-before fix, 2026-11-15;
  // trigger-hand correction, 2026-11-15 round 2).
  // The bot rig's rotation.x = -1.05 swings an arm's lower end
  // BACKWARD (+z, toward the back): R_x(-1.05)*(0,-1,0) =
  // (0,-0.50,+0.87), leaving a 0.43-0.45 m gap to the hands. The arms
  // below are posed as bars from the shoulder to the hand instead:
  // each centre is the shoulder/hand midpoint and each Euler aims the
  // box's long axis at the hand (solved with three.js setFromUnitVectors;
  // see verify-shots/weapon-harness2.mjs).
  // armR spans the right shoulder (0.26, 1.34, -0.06) to the trigger
  // hand in 0.443 m against a 0.52 m box, so it overshoots each end by
  // 0.038 m: the lower tip hides inside the fist ball and the upper
  // tip stops at y 1.37, below the torso top (1.39).
  // armL spans the ANATOMICAL left shoulder (-0.26, 1.34, -0.06) to
  // the front hand in 0.708 m, so its box is 0.71 m long (ends land
  // 0.001 m from shoulder and hand). The shoulder joint itself sits
  // inside the torso silhouette, so the visible bar emerges from the
  // upper vest — that is occlusion, not a detached arm.
  // Hands: the rear (trigger) fist sits off the pistol-grip centre
  // toward the camera: (0.20, 0.96, -0.28) vs grip (0.16, 1.01, -0.28),
  // 0.064 m away, inside its 0.07 m ball. The +x offset is the
  // knuckle side — local +x faces the showcase camera, so the fist
  // bulges past the grip toward the viewer instead of hiding behind
  // it. (Round 2 first tried a centred 0.06 m ball dropped 0.04 m:
  // the re-shoot showed only a 14-px sliver — the arm band and the
  // magazine sandwich a centred ball. The offset + larger fist is
  // what makes the hand read: ~20 clip px of knuckles below-left of
  // the grip.) The front hand is at (0.16, 1.05, -0.55): 0.05 m below
  // the receiver centreline (y 1.10), cupping the receiver's front
  // third from underneath, 0.16 m ahead of the magazine centre
  // (z -0.39) and just behind the handguard's rear edge. The far
  // handguard is 0.71 m from the left shoulder — the receiver-front
  // grip is the reachable hold.
  const armR = add(new THREE.BoxGeometry(0.11, 0.52, 0.11), uniform, 0.23, 1.15, -0.17, 0.52, -0.04);
  const armL = add(new THREE.BoxGeometry(0.11, 0.71, 0.11), uniform, -0.05, 1.195, -0.305, 0.81, 0.30);
  armR.rotation.z = -0.14;
  armL.rotation.z = 0.67;
  // Gloves (dark, not skin): DF operators wear gloves, and dark fists
  // read as gear against the rifle instead of bare hands.
  add(new THREE.SphereGeometry(0.07, 8, 6), gunGrip, 0.20, 0.96, -0.28);
  add(new THREE.SphereGeometry(0.06, 8, 6), gunGrip, 0.16, 1.05, -0.55);
  add(new THREE.BoxGeometry(0.09, 0.06, 0.09), gunGrip, 0.21, 1.01, -0.24); // glove cuff R
  add(new THREE.BoxGeometry(0.08, 0.06, 0.08), gunGrip, 0.14, 1.10, -0.52); // glove cuff L

  // Held rifle — same construction as bots.js buildRifle; the Recon
  // variant gets the longer barrel + scope. Factory gunmetal, always:
  // the soldier's rifle is never re-tinted by a skin preview.
  function buildRifle(sniper) {
    const g = new THREE.Group();
    const radd = (geo, m, x, y, z, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      if (rx) mesh.rotation.x = rx;
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    radd(new THREE.BoxGeometry(0.07, 0.10, 0.42), gunMetal, 0, 0, 0);
    radd(new THREE.BoxGeometry(0.06, 0.07, 0.26), gunMetal, 0, 0.005, -0.3);
    const barrel = radd(new THREE.CylinderGeometry(0.022, 0.022, sniper ? 0.52 : 0.34, 8),
      gunMetal, 0, 0.01, sniper ? -0.55 : -0.48);
    barrel.rotation.x = Math.PI / 2;
    const muzzle = radd(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 8),
      gunMetal, 0, 0.01, sniper ? -0.82 : -0.66);
    muzzle.rotation.x = Math.PI / 2;
    radd(new THREE.BoxGeometry(0.05, 0.15, 0.09), gunGrip, 0, -0.11, 0.03, 0.28);
    radd(new THREE.BoxGeometry(0.06, 0.09, 0.18), gunGrip, 0, -0.01, 0.28);
    radd(new THREE.BoxGeometry(0.05, 0.11, 0.07), gunGrip, 0, -0.09, 0.14, 0.3);
    radd(new THREE.BoxGeometry(0.03, 0.05, 0.03), gunMetal, 0, 0.075, -0.16);
    // DF-bar rifle detail (2026-11-15 gfx push): laser module under the
    // handguard, vertical foregrip, full top rail, red-dot sight (the
    // sniper keeps its scope instead). All on the rifle group — the
    // hold position and hands never move.
    radd(new THREE.BoxGeometry(0.035, 0.04, 0.10), gunGrip, 0, -0.045, -0.38); // laser module
    radd(new THREE.BoxGeometry(0.012, 0.012, 0.012),
      new THREE.MeshBasicMaterial({ color: 0xff2a22 }), 0, -0.045, -0.435); // laser lens
    radd(new THREE.BoxGeometry(0.04, 0.09, 0.055), gunGrip, 0, -0.085, -0.32, 0.12); // vertical foregrip
    radd(new THREE.BoxGeometry(0.028, 0.012, 0.52), gunMetal, 0, 0.056, -0.10); // top rail
    if (!sniper) {
      radd(new THREE.BoxGeometry(0.035, 0.035, 0.06), gunMetal, 0, 0.085, -0.02); // red-dot body
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 10),
        new THREE.MeshBasicMaterial({ color: 0x1a2f3a }));
      dot.position.set(0, 0.085, 0.012);
      g.add(dot);
    }
    if (sniper) {
      const scope = radd(new THREE.CylinderGeometry(0.032, 0.032, 0.24, 10), gunMetal, 0, 0.09, -0.04);
      scope.rotation.x = Math.PI / 2;
      const bell = radd(new THREE.CylinderGeometry(0.048, 0.036, 0.07, 10), gunMetal, 0, 0.09, -0.18);
      bell.rotation.x = Math.PI / 2;
    }
    // Showcase hold (weapon-before fix, 2026-11-15; z -0.42 in round 2):
    // the rifle sits 0.12 m further forward than the bot rig's
    // z = -0.30, so the receiver rear (local z +0.21 -> world -0.21)
    // clears the vest front (z = -0.18) by 0.03 m instead of burying
    // 0.09 m into the torso.
    // STOCK, honestly: the butt is NOT visible and NOT "against the
    // body" in any readable sense — the stock rear (world z -0.05)
    // still terminates 0.10 m inside the torso front face, and from
    // the showcase camera the stock is colinear behind the receiver
    // inside the torso's projected silhouette (harness: stock rear
    // projects to (241,182) stage px, inside the silhouette; even a
    // stock extended to local z 0.49 stays inside at (228,181)). No
    // rearward extension can show it from this angle — it would only
    // add hidden geometry — so none is added. What this fix guarantees
    // is the RECEIVER clear of the vest; the butt stays hidden behind
    // the receiver/torso, as on a rifle shouldered tight to the body.
    g.position.set(0.16, 1.10, -0.42);
    return g;
  }

  let rifle = buildRifle(false);
  group.add(rifle);
  return {
    group, torso, head, legL, legR, armL, armR,
    mats: { vest: vestMat, vestDark: pouchMat, vestStrap: strapMat,
      helmet: helmetMat, accent: accentMat, uniform, pants, boots },
    setRifle(sniper) {
      group.remove(rifle);
      rifle = buildRifle(sniper);
      group.add(rifle);
    },
  };
}

// Darken a hex colour by a factor (0..1), per channel — used so the
// pouch/strap shades track the outfit's vest colour instead of staying
// amber when the vest itself is recoloured (e.g. SABLE's teal vest
// gets dark-teal pouches, not brown ones).
function shadeHex(hex, f) {
  const r = Math.round(((hex >> 16) & 255) * f);
  const g = Math.round(((hex >> 8) & 255) * f);
  const b = Math.round((hex & 255) * f);
  return (r << 16) | (g << 8) | b;
}

// THE single writer of soldier colours. `outfit` is an outfit object
// ({ colors: { uniform, vest, helmet, accent, pants, boots } }); the
// outfit WINS over the operator for every colour. Head/hands (skin)
// and the rifle are never recoloured.
function paintSoldierMats(soldier, outfit) {
  if (!soldier || !outfit) return;
  const c = outfit.colors || outfit;
  const m = soldier.mats;
  m.uniform.color.setHex(c.uniform);
  m.vest.color.setHex(c.vest);
  // Pouches/straps stay visibly darker than the plates they sit on,
  // in the same hue family as the outfit's vest.
  if (m.vestDark) m.vestDark.color.setHex(shadeHex(c.vest, 0.55));
  if (m.vestStrap) m.vestStrap.color.setHex(shadeHex(c.vest, 0.32));
  m.helmet.color.setHex(c.helmet);
  m.accent.color.setHex(c.accent);
  m.pants.color.setHex(c.pants);
  m.boots.color.setHex(c.boots);
}

// ================================================================
// createHomeScreen
// ================================================================
export function createHomeScreen(options = {}) {
  const root = document.getElementById('home-screen');
  if (!root) throw new Error('menu.js: #home-screen not found — check index.html');
  if (instance) { instance._update(options); return instance.api; }

  // --- Element refs (all static HTML from index.html) ------------
  const modeBox = document.getElementById('home-mode-cards');
  const mapBox = document.getElementById('home-map-cards');
  const opBox = document.getElementById('home-operator-cards');
  const loadoutBox = document.getElementById('home-loadout');
  const showcaseWrap = document.getElementById('home-showcase');
  const opNameEl = document.getElementById('home-operator-name');
  const opRoleEl = document.getElementById('home-operator-role');
  const opLineEl = document.getElementById('home-operator-line');
  const opSkillEl = document.getElementById('home-operator-skill');
  const outfitTextEl = document.getElementById('home-operator-outfit-text');
  const outfitChipEl = document.getElementById('home-operator-outfit-chip');
  const summaryEl = document.getElementById('home-summary');
  const summaryMobileEl = document.getElementById('home-summary-mobile');
  const playBtn = document.getElementById('home-play');
  // There is a single PLAY button (#home-play) — it sits in the fixed
  // bottom bar on both desktop and mobile. Kept as a null so the
  // null-guarded uses below stay harmless.
  const playBtnMobile = null;
  const noticeEl = document.getElementById('home-notice');
  const creditsEl = document.getElementById('home-credits');
  const shopPanel = document.getElementById('home-shop-panel');
  const shopGrid = document.getElementById('home-shop-grid');
  const shopMsg = document.getElementById('home-shop-msg');
  const shopTabBtns = [...(shopPanel ? shopPanel.querySelectorAll('[data-shop-tab]') : [])];
  const previewWrap = document.getElementById('home-shop-preview-wrap');
  const previewFallbackEl = document.getElementById('home-shop-preview-fallback');
  const previewNameEl = document.getElementById('home-shop-preview-name');
  const previewSubEl = document.getElementById('home-shop-preview-sub');
  const previewTextEl = document.getElementById('home-shop-preview-text');
  const previewChipsEl = document.getElementById('home-shop-preview-chips');
  const settingsPanel = document.getElementById('home-settings-panel');
  const legacyOverlay = document.getElementById('menu');
  const nojsNote = document.getElementById('home-nojs-note');

  // --- State ------------------------------------------------------
  const state = {
    modes: [],
    maps: [],
    operators: OPERATORS,
    mode: null,
    mapId: null,
    operatorId: null,
    onPlay: null,
    onMuteToggle: null,
    defaultMode: DEFAULT_MODE,
    defaultMapId: DEFAULT_MAP,
    defaultOperator: DEFAULT_OPERATOR,
    equippedOutfit: DEFAULT_OUTFIT, // outfit object (name + colours)
    previewOutfit: null,
    showcaseMotion: true,
  };
  let shopTab = 'weapons';
  let previewSel = { tab: 'weapons', weaponId: 'pistol', skinId: 'default', outfitId: null, outfitObj: null };
  let shopRenderToken = 0;
  let shopModPromise = null;
  let shopMod = null;
  // Skin textures (skins.js, dynamic): loaded on shop open (pre-warm)
  // and cached in _skinsP. skinsMod is the resolved module, or null
  // until it loads. swatchCache holds one 48px swatch canvas per skin
  // family, drawn once and reused by every skin card.
  let skinsMod = null;
  let _skinsP = null;
  const swatchCache = new Map();
  let lastShopState = null;
  let lastCredits = null; // unknown until the shop module loads — the pill shows ◆ — CR meanwhile

  // --- Shop module loading (dynamic, cached, fire-and-forget) -----
  function loadShopModule() {
    if (!shopModPromise) {
      shopModPromise = import('./shop.js').then((m) => {
        shopMod = m;
        lastShopState = m.getShopState();
        lastCredits = m.getCredits();
        applyEquippedOutfitFromShop();
        return m;
      }).catch(() => null);
    }
    return shopModPromise;
  }
  function applyEquippedOutfitFromShop() {
    if (!shopMod) return;
    const id = shopMod.getEquippedOutfit();
    const found = (shopMod.SHOP_OUTFITS || []).find((o) => o.id === id);
    state.equippedOutfit = found || DEFAULT_OUTFIT;
    paintSoldier();
    updateOutfitLine();
    updateLoadoutSkins();
  }
  function currentSkinMap() {
    const map = {};
    if (!shopMod) return map;
    for (const wid of ['pistol', 'smg', 'rifle', 'sniper', 'knife']) {
      const eq = shopMod.getEquippedSkin(wid);
      if (eq && eq !== 'default') {
        const skin = (shopMod.SHOP_SKINS[wid] || []).find((s) => s.id === eq);
        if (skin) map[wid] = skin;
      }
    }
    return map;
  }

  // --- Showcase (three.js, dynamic import, own renderer) ---------
  const showcase = { ok: false, failed: false, raf: 0, clock: 0, soldier: null,
    renderer: null, scene: null, camera: null, THREE: null };
  function radialTexture(THREE, inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  async function initShowcase() {
    if (!showcaseWrap || showcase.ok || showcase.failed) return;
    try {
      const [THREE, pal] = await Promise.all([import('three'), import('./palette.js')]);
      const PALETTE = pal.PALETTE;
      const canvas = document.createElement('canvas');
      canvas.id = 'home-showcase-canvas';
      canvas.setAttribute('aria-label', 'Selected operator, 3D showcase');
      showcaseWrap.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
      camera.position.set(0, 1.35, 5.0);
      // Framing is solved by frameShowcase() (below) — it sizes and
      // positions the soldier into the zone above the name plate for
      // the actual stage height, instead of a fixed lookAt that only
      // fits one viewport.
      scene.add(new THREE.AmbientLight(0xffffff, 0.45));
      // Warm key from front-right-top, stronger than before (2.2->3.2):
      // the old key left the figure's front flat, so the only "rim"
      // the eye caught was the halo sprite behind the soldier.
      const sun = new THREE.DirectionalLight(0xffe0b3, 3.2);
      sun.position.set(2.5, 4, 3);
      scene.add(sun);
      // Amber rim from back-left (as before, stronger: 26->48) + a cool
      // TEAL rim from back-right (20->44): the DF hangar look is teal +
      // amber, and the two rims together carve the soldier out of the
      // dark backdrop. At ~3.3 m with decay 2, 48 reads as a hard amber
      // edge on the vest/helmet and 44 as a teal edge on the far side.
      const rim = new THREE.PointLight(0xf0a830, 48, 8, 2);
      rim.position.set(-2.2, 2.2, -1.2);
      scene.add(rim);
      const rimTeal = new THREE.PointLight(0x35c4b5, 44, 8, 2);
      rimTeal.position.set(2.4, 2.0, -1.5);
      scene.add(rimTeal);
      const fill = new THREE.DirectionalLight(0xbfd4ff, 0.9);
      fill.position.set(-2, 1.5, 3);
      scene.add(fill);
      // Depth haze: the backdrop sits further from the camera than the
      // soldier, so it fades into the dark while the soldier stays crisp.
      scene.fog = new THREE.Fog(0x14161a, 6.5, 11);
      // Floor: dark radial-gradient disc (centre #23262C -> edge
      // #14161A), a soft contact shadow under the boots, and an amber
      // rim ring marking the stage.
      const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40),
        new THREE.MeshStandardMaterial({ map: radialTexture(THREE, '#23262c', '#14161a'), roughness: 0.95 }));
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);
      const contact = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32),
        new THREE.MeshBasicMaterial({ map: radialTexture(THREE, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
      contact.rotation.x = -Math.PI / 2;
      contact.position.y = 0.01;
      scene.add(contact);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.62, 48),
        new THREE.MeshBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      scene.add(ring);
      // --- Layered depot-hangar backdrop (DF frame-14 bar, OUR depot) ---
      // The old stage was a soldier on a flat CSS gradient. Now the
      // stage is a PLACE, in depth layers: far back wall -> gantry
      // frame -> side crates -> teal light strip -> haze sprites.
      // Everything sits behind the soldier (z <= -1.5) and the scene
      // fog (6.5-11) hazes the far layers more than the near ones.
      // R2: the backdrop crates were untextured flat-colour boxes and
      // the back wall a flat slab — at 720p the stage read as clip-art.
      // Same procedural textures as the in-game crates/walls (pal is
      // the palette module, already imported above).
      const backdropMat = new THREE.MeshStandardMaterial({ map: pal.texWall(0x23262c, 11, 2, 1), roughness: 1 });
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.7, metalness: 0.4 });
      const crateMat = new THREE.MeshStandardMaterial({ map: pal.texWood(0x5a5c3f, 3, 'DEPOT 9'), roughness: 0.9 });
      const crateRust = new THREE.MeshStandardMaterial({ map: pal.texCorrugated(0x6b4a2e, 6, 2, 1), roughness: 0.9, metalness: 0.15 });
      const badd = (geo, m, x, y, z, ry = 0) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        if (ry) mesh.rotation.y = ry;
        scene.add(mesh);
        return mesh;
      };
      badd(new THREE.PlaneGeometry(9, 4.5), backdropMat, 0, 2.0, -2.6); // far back wall
      badd(new THREE.BoxGeometry(0.18, 3.2, 0.18), steelMat, -1.9, 1.6, -2.0); // gantry leg L
      badd(new THREE.BoxGeometry(0.18, 3.2, 0.18), steelMat, 1.9, 1.6, -2.0); // gantry leg R
      badd(new THREE.BoxGeometry(4.4, 0.22, 0.22), steelMat, 0, 3.1, -2.0); // gantry beam
      badd(new THREE.BoxGeometry(0.5, 0.4, 0.5), steelMat, -0.7, 2.75, -2.0); // hoist block
      badd(new THREE.BoxGeometry(0.9, 0.9, 0.9), crateMat, 1.55, 0.45, -1.9, 0.2); // crate stack R
      badd(new THREE.BoxGeometry(0.7, 0.7, 0.7), crateRust, 1.45, 1.25, -1.9, -0.15);
      badd(new THREE.BoxGeometry(0.8, 0.8, 0.8), crateRust, -1.6, 0.4, -1.9, -0.1); // crate L
      badd(new THREE.BoxGeometry(0.6, 0.6, 0.6), crateMat, -1.55, 1.1, -1.9, 0.3);
      // Teal light strip on the right (the DF hangar's cyan accent) +
      // a warm lamp dot on the left, both with soft glow sprites.
      const strip = badd(new THREE.BoxGeometry(0.07, 1.7, 0.07),
        new THREE.MeshBasicMaterial({ color: 0x35c4b5 }), 2.15, 1.7, -2.2);
      strip.castShadow = false;
      const stripGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: radialTexture(THREE, 'rgba(53,196,181,0.55)', 'rgba(53,196,181,0)'),
        transparent: true, depthWrite: false }));
      stripGlow.position.set(2.15, 1.7, -2.1);
      stripGlow.scale.set(1.6, 2.4, 1);
      scene.add(stripGlow);
      const lampDot = badd(new THREE.SphereGeometry(0.06, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), -2.1, 2.6, -2.2);
      lampDot.castShadow = false;
      const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: radialTexture(THREE, 'rgba(255,217,160,0.7)', 'rgba(255,217,160,0)'),
        transparent: true, depthWrite: false }));
      lampGlow.position.set(-2.1, 2.6, -2.1);
      lampGlow.scale.set(1.2, 1.2, 1);
      scene.add(lampGlow);
      // Haze: two big soft sprites drifting the mid-ground so the air
      // reads as lit dust, not empty transparency.
      for (const [hx, hy, hs] of [[-1.2, 1.2, 2.6], [1.3, 2.2, 2.2]]) {
        const hz = new THREE.Sprite(new THREE.SpriteMaterial({
          map: radialTexture(THREE, 'rgba(180,190,205,0.10)', 'rgba(180,190,205,0)'),
          transparent: true, depthWrite: false }));
        hz.position.set(hx, hy, -1.9);
        hz.scale.set(hs, hs * 0.6, 1);
        scene.add(hz);
      }
      // Warm halo behind the soldier so the figure pops against the
      // darker backdrop (the DF lobby lights the operator against a
      // brighter background). R2: 0.28->0.22 — the halo was doing the
      // rim's job; the real rim lights above do it now.
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: radialTexture(THREE, 'rgba(255,200,120,0.22)', 'rgba(255,200,120,0)'),
        transparent: true, depthWrite: false }));
      halo.position.set(0, 1.2, -1.6);
      halo.scale.set(3.2, 3.2, 1);
      scene.add(halo);
      const soldier = buildShowcaseSoldier(THREE, PALETTE);
      // Showcase yaw (weapon-before fix, 2026-11-15): PI + 0.85, not
      // PI + 0.35. At 0.35 the barrel points 20 deg off the camera axis,
      // so it foreshortens to a 57 px stub tilted 5.5 deg down-right and
      // the tilt wobbles with the idle sway. At 0.85 the soldier stands
      // in 3/4 profile: the rifle reads 131 px long at 1.3 deg (0.6-2.2
      // deg across the sway range) while the barrel stays exactly
      // aligned with the soldier's facing (the whole soldier turns, the
      // rifle is never yawed relative to it).
      soldier.group.rotation.y = Math.PI + 0.85;
      scene.add(soldier.group);
      Object.assign(showcase, { ok: true, renderer, scene, camera, soldier, THREE });
      resizeShowcase();
      paintSoldier();
      measureShowcaseFrame();
      startShowcase();
    } catch (e) {
      showcase.failed = true;
      if (showcaseWrap) showcaseWrap.classList.add('showcase-failed');
    }
  }
  // Frame the showcase soldier into the zone above the name plate.
  // The plate is a fixed-height overlay at the column bottom, so the
  // clear zone shrinks as the stage gets shorter (desktop 500px,
  // tablet 320px): a fixed lookAt only fits one viewport. This solves
  // both knobs from the measured stage/plate heights, before the first
  // render, so nothing visibly jumps:
  //   1) SIZE — shrink the soldier (pull the camera back) only if it
  //      can't fit the zone at its natural size (never grow it past
  //      the desktop framing, 0.62 * stage height).
  //   2) POSITION — nudge lookAt until the projected boots land 24px
  //      above the plate top (boots fraction rises ~0.28 per unit
  //      lookAt at z=5, less at larger z). By construction the helmet
  //      then sits >=24px below the stage top.
  function frameShowcase() {
    if (!showcase.ok) return;
    const h = showcaseWrap.clientHeight || 500;
    const plate = document.querySelector('.showcase-plate');
    const plateH = plate ? Math.round(plate.getBoundingClientRect().height) : 146;
    const bootsTarget = h - plateH - 24;
    // DF-bar framing: the operator fills ~62% of the stage height
    // (was 47.8% — a 239px soldier in a 500px stage read as a
    // mannequin). The boots-target constraint still caps the size, so
    // the helmet keeps its headroom on short stages.
    const natural = 0.62 * h;
    // -28 (not -24): the soldier runs ~4px taller than the distance
    // formula predicts, so keep a small margin for the headroom.
    const want = Math.min(natural, bootsTarget - 28);
    const dist = 5.0 * natural / Math.max(want, 1);
    showcase.camera.position.set(0, 1.35, dist);
    showcase.camera.updateProjectionMatrix();
    let lookY = 0.58;
    for (let i = 0; i < 4; i++) {
      showcase.camera.lookAt(0, lookY, 0);
      showcase.camera.updateMatrixWorld();
      const bot = new showcase.THREE.Vector3(0, 0, 0).project(showcase.camera);
      const bootsPx = Math.round((1 - bot.y) / 2 * h);
      const err = bootsTarget - bootsPx;
      if (Math.abs(err) < 1) break;
      lookY += err / h / 0.28 * (dist / 5.0);
    }
    measureShowcaseFrame();
  }
  function resizeShowcase() {
    if (!showcase.ok) return;
    const w = showcaseWrap.clientWidth || 300;
    const h = showcaseWrap.clientHeight || 420;
    showcase.renderer.setSize(w, h, false);
    showcase.camera.aspect = w / h;
    showcase.camera.updateProjectionMatrix();
    frameShowcase();
  }
  function measureShowcaseFrame() {
    if (!showcase.ok || !window.__ferrolineLobby) return;
    // The view matrix is only valid after the camera's world matrix
    // has been updated (a render, or an explicit update) — projecting
    // before that reads an identity view matrix and returns a frame
    // that ignores lookAt entirely. Update it first.
    showcase.camera.updateMatrixWorld();
    const h = showcaseWrap.clientHeight || 0;
    const w = showcaseWrap.clientWidth || 0;
    const top = new showcase.THREE.Vector3(0, 1.75, 0).project(showcase.camera);
    const bot = new showcase.THREE.Vector3(0, 0, 0).project(showcase.camera);
    const topPx = Math.round((1 - top.y) / 2 * h);
    const botPx = Math.round((1 - bot.y) / 2 * h);
    window.__ferrolineLobby.showcaseFrame = { topPx, bottomPx: botPx, stageH: h, stageW: w, soldierPx: botPx - topPx };
  }
  function tickShowcase(t) {
    if (!showcase.ok) return;
    const s = showcase.soldier;
    const tm = t * 0.001;
    const amp = state.showcaseMotion ? 0.12 : 0;
    s.group.rotation.y = Math.PI + 0.85 + Math.sin(tm * 0.35) * amp;
    // Breathing moves the WHOLE soldier group (not the torso alone):
    // the torso, arms, hands and rifle bob together, so the hold never
    // separates. The old torso-only bob was ±8 mm — invisible; the
    // group bob is ±20 mm and reads as a living idle.
    const br = state.showcaseMotion ? Math.sin(tm * 1.4) * 0.02 : 0;
    s.group.position.y = br;
    s.torso.position.y = 1.0;
    s.torso.rotation.x = 0;
    s.head.position.y = 1.53;
    s.legL.rotation.x = state.showcaseMotion ? Math.sin(tm * 0.9) * 0.015 : 0;
    s.legR.rotation.x = -s.legL.rotation.x;
    // Arm bases are the showcase-hold Eulers from buildShowcaseSoldier
    // (0.52 / 0.81), not the bot rig's -1.05: the tick overwrites
    // rotation.x every frame, so the hold values must live here too.
    // Only x is swung (the walk-sway); y/z stay as built.
    s.armL.rotation.x = 0.81 + (state.showcaseMotion ? Math.sin(tm * 0.9) * 0.02 : 0);
    s.armR.rotation.x = 0.52 + (state.showcaseMotion ? Math.cos(tm * 0.9) * 0.02 : 0);
    showcase.renderer.render(showcase.scene, showcase.camera);
    // Re-measure once after the first real render, so the published
    // frame reflects the live view matrix, not the pre-render one.
    if (!showcase._measured) { showcase._measured = true; measureShowcaseFrame(); }
  }
  function startShowcase() {
    if (!showcase.ok || showcase.raf) return;
    const loop = (t) => { showcase.raf = requestAnimationFrame(loop); tickShowcase(t); };
    showcase.raf = requestAnimationFrame(loop);
  }
  function stopShowcase() {
    if (showcase.raf) { cancelAnimationFrame(showcase.raf); showcase.raf = 0; }
  }

  // --- Paint the lobby soldier: operator = skill/identity + rifle
  // variant only; outfit = all six colours, and WINS. --------------
  function paintSoldier() {
    if (!showcase.ok || !showcase.soldier) return;
    paintSoldierMats(showcase.soldier, state.equippedOutfit);
    const op = getOperator();
    if (op) showcase.soldier.setRifle(!!op.sniper);
  }
  function updateOutfitLine() {
    const outfit = state.equippedOutfit;
    if (outfitTextEl) outfitTextEl.textContent = `OUTFIT — ${outfit.name}`;
    if (outfitChipEl) outfitChipEl.style.background = hexCss(outfit.colors.accent);
  }

  // --- Notice -------------------------------------------------------
  function showNotice(text) {
    if (!noticeEl) return;
    noticeEl.textContent = text;
    noticeEl.classList.add('show');
  }

  // --- Mode / map cards (hydrate static, else render) -------------
  function buildMenuCard(item, i, kind) {
    const card = el('button', 'menu-card');
    card.type = 'button';
    card.dataset.id = item.id;
    card.dataset.kind = kind;
    card.setAttribute('aria-pressed', 'false');
    if (kind === 'map') {
      const strip = el('span', 'menu-card-strip');
      strip.style.background = MAP_STRIP[item.id] || '#f0a830';
      card.appendChild(strip);
    }
    const top = el('span', 'menu-card-topline');
    if (kind === 'mode') top.appendChild(el('span', 'menu-card-index', String(i + 1).padStart(2, '0') + ' · '));
    top.appendChild(el('span', 'menu-card-name', item.name));
    card.appendChild(top);
    card.appendChild(el('span', 'menu-card-desc', shortDesc(kind, item)));
    card.addEventListener('click', () => select(kind, item.id));
    return card;
  }
  function renderCards(box, items, kind) {
    if (!box) return;
    const frag = document.createDocumentFragment();
    items.forEach((item, i) => frag.appendChild(buildMenuCard(item, i, kind)));
    if (kind === 'mode') {
      const tile = document.getElementById('home-mode-detail');
      if (tile) frag.appendChild(tile); // the detail tile is the 6th cell — never lost
    }
    box.replaceChildren(frag);
  }
  function hydrateCards(box, items, kind) {
    if (!box) return;
    try {
      const cards = [...box.querySelectorAll(':scope > button.menu-card[data-id]')];
      const want = items.map((i) => i.id);
      const got = cards.map((c) => c.dataset.id);
      if (got.length === want.length && want.every((id, i) => got[i] === id)) {
        for (const card of cards) card.addEventListener('click', () => select(kind, card.dataset.id));
        return;
      }
    } catch (e) { /* fall through to render */ }
    try {
      renderCards(box, items, kind);
    } catch (e) {
      showNotice(`${kind === 'mode' ? 'Modes' : 'Maps'} couldn't be made interactive — browsing only.`);
    }
  }
  function modeMeta(mode) {
    if (mode.killTarget) return `FIRST TO ${mode.killTarget} KILLS`;
    if (mode.scoreTarget) return `FIRST TO ${mode.scoreTarget} POINTS`;
    return '5 v 5 · ROUND-BASED';
  }
  function updateDetailTile() {
    const tile = document.getElementById('home-mode-detail');
    if (!tile) return;
    const mode = state.modes.find((m) => m.id === state.mode);
    if (!mode) return;
    const head = tile.querySelector('.detail-head');
    const desc = tile.querySelector('.detail-desc');
    const meta = tile.querySelector('.detail-meta');
    if (head) head.textContent = `ABOUT — ${mode.name.toUpperCase()}`;
    if (desc) desc.textContent = shortDesc('mode', mode);
    if (meta) meta.textContent = modeMeta(mode);
  }

  // --- Operators (hydrate static, else render) --------------------
  function buildOperatorCard(op) {
    const card = el('button', 'operator-card');
    card.type = 'button';
    card.dataset.id = op.id;
    card.setAttribute('aria-pressed', 'false');
    card.style.setProperty('--op-accent', op.accent);
    const tile = el('span', 'op-tile');
    tile.innerHTML = BUST_SVG;
    tile.appendChild(el('span', 'op-tile-role', op.role));
    const body = el('span', 'op-body');
    const top = el('span', 'op-top');
    top.appendChild(el('span', 'operator-name', op.name));
    top.appendChild(el('span', 'operator-role', op.role));
    body.appendChild(top);
    body.appendChild(el('span', 'operator-callsign', op.callsign));
    const skill = el('span', 'operator-skill');
    if (op.skill) {
      skill.appendChild(el('b', null, `SKILL — ${op.skill.name}:`));
      skill.appendChild(document.createTextNode(` ${op.skill.desc}`));
    }
    body.appendChild(skill);
    card.appendChild(tile);
    card.appendChild(body);
    card.addEventListener('click', () => setOperator(op.id));
    return card;
  }
  function paintOperatorTiles() {
    if (!opBox) return;
    for (const card of opBox.children) {
      const tile = card.querySelector('.op-tile');
      if (!tile) continue;
      const accent = card.style.getPropertyValue('--op-accent') || '#9b7bff';
      const sel = card.classList.contains('selected');
      tile.style.background = rgbaFromHex(accent, sel ? 0.25 : 0.12);
      tile.style.borderColor = rgbaFromHex(accent, 0.4);
    }
  }
  function renderOperators() {
    if (!opBox) return;
    const frag = document.createDocumentFragment();
    for (const op of state.operators) frag.appendChild(buildOperatorCard(op));
    opBox.replaceChildren(frag);
    paintOperatorTiles();
  }
  function hydrateOperators() {
    if (!opBox) return;
    try {
      const cards = [...opBox.querySelectorAll(':scope > button.operator-card[data-id]')];
      const want = state.operators.map((o) => o.id);
      const got = cards.map((c) => c.dataset.id);
      if (got.length === want.length && want.every((id, i) => got[i] === id)) {
        for (const card of cards) card.addEventListener('click', () => setOperator(card.dataset.id));
        paintOperatorTiles();
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      renderOperators();
    } catch (e) {
      showNotice('Operators couldn\'t be made interactive — browsing only.');
    }
  }
  function getOperator() {
    return state.operators.find((o) => o.id === state.operatorId) || null;
  }
  function applyOperator() {
    const op = getOperator();
    if (!op) return;
    paintSoldier();
    root.style.setProperty('--op-accent', op.accent);
    if (opNameEl) opNameEl.textContent = op.name;
    if (opRoleEl) opRoleEl.textContent = `${op.callsign} · ${op.role}`;
    if (opLineEl) opLineEl.textContent = op.line;
    if (opSkillEl && op.skill) opSkillEl.textContent = `SKILL — ${op.skill.name}: ${op.skill.desc}`;
    const fb = document.getElementById('home-showcase-fallback-initial');
    if (fb) fb.textContent = op.name.charAt(0);
    if (window.__ferrolineLobby) {
      window.__ferrolineLobby.operatorId = op.id;
      window.__ferrolineLobby.operatorSkill = op.skill ? { ...op.skill } : null;
    }
    if (opBox) {
      for (const card of opBox.children) {
        const on = card.dataset.id === op.id;
        card.classList.toggle('selected', on);
        card.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      paintOperatorTiles();
    }
    updateOutfitLine();
    try { localStorage.setItem(OPERATOR_KEY, op.id); } catch (e) {}
  }
  function setOperator(id) {
    if (!state.operators.some((o) => o.id === id)) return false;
    state.operatorId = id;
    applyOperator();
    return true;
  }

  // --- Selection ----------------------------------------------------
  function paintSelection() {
    const paint = (box, selectedId) => {
      if (!box) return;
      for (const card of box.children) {
        if (!card.dataset || !card.dataset.id) continue;
        const on = card.dataset.id === selectedId;
        card.classList.toggle('selected', on);
        card.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };
    paint(modeBox, state.mode);
    paint(mapBox, state.mapId);
    const mode = state.modes.find((m) => m.id === state.mode);
    const map = state.maps.find((m) => m.id === state.mapId);
    const summary = mode && map ? `${mode.name.toUpperCase()} · ${map.name.toUpperCase()}` : 'SELECT A MODE AND A MAP';
    if (summaryEl) summaryEl.textContent = summary;
    if (summaryMobileEl) summaryMobileEl.textContent = summary;
    const ready = !!(mode && map);
    if (playBtn) playBtn.disabled = !ready;
    if (playBtnMobile) playBtnMobile.disabled = !ready;
    updateDetailTile();
  }
  function select(kind, id) {
    const list = kind === 'mode' ? state.modes : state.maps;
    if (!list.some((i) => i.id === id)) return;
    if (kind === 'mode') state.mode = id;
    else state.mapId = id;
    paintSelection();
  }
  function getSelection() {
    return { mode: state.mode, mapId: state.mapId };
  }
  function setSelection(mode, mapId) {
    if (mode) state.mode = mode;
    if (mapId) state.mapId = mapId;
    paintSelection();
    return getSelection();
  }

  // --- Loadout ------------------------------------------------------
  // Display map for the lobby loadout strip, derived live from the shop
  // state + the saved loadout + the selected mode. Pure except for one
  // input: the SHOP_WEAPONS table, read from the shopMod closure
  // (menu.js must not import shop.js statically — see DECOUPLING).
  //   pistol / knife: always carried (fixed).
  //   primary: picked when the saved pick is an owned primary;
  //     not-picked when the pick is null — the strip shows the fallback
  //     (first owned primary) and the first click confirms it;
  //     none-picked (PISTOL ONLY) when the pick is 'none'; not-owned
  //     when no primary is owned at all (cheapest primary price shown).
  //   frag / smoke: picked when the toggle is on, off when it is not.
  // A primary's detail is its mag/reserve from the shop stat
  // (e.g. '30/90'); the name is the weapon name from SHOP_WEAPONS.
  function buildDisplayLoadout(shopState, loadout, selectedModeId) {
    const owned = (shopState && shopState.ownedWeapons) || [];
    const weapons = (shopMod && shopMod.SHOP_WEAPONS) || [];
    const defFor = (id) => weapons.find((w) => w.id === id) || null;
    const magReserve = (def) => {
      if (!def || !def.stat) return '';
      const parts = String(def.stat).split('—');
      return parts.length ? parts[parts.length - 1].trim() : '';
    };
    const primaries = weapons.filter((w) => w.kind === 'primary');
    const ownedPrimaries = primaries.filter((w) => owned.includes(w.id));
    const cheapest = primaries.length ? Math.min(...primaries.map((w) => w.price)) : 1200;
    const pick = loadout ? loadout.primary : null;
    const pistolDef = defFor('pistol');
    const knifeDef = defFor('knife');
    const out = {
      pistol: { state: 'fixed', name: pistolDef ? pistolDef.name : 'SPARROW P9', detail: magReserve(pistolDef) || '12/36', weaponId: 'pistol' },
      knife: { state: 'fixed', name: knifeDef ? knifeDef.name : 'TALON K-1', detail: 'MELEE', weaponId: 'knife' },
      frag: loadout && loadout.frag === true
        ? { state: 'picked', name: 'FRAG GRENADE', detail: 'Free — in your loadout · round-based modes only', weaponId: null }
        : { state: 'off', name: 'FRAG GRENADE', detail: 'Free — click to add · round-based modes only', weaponId: null },
      smoke: loadout && loadout.smoke === true
        ? { state: 'picked', name: 'SMOKE GRENADE', detail: 'Free — in your loadout · round-based modes only', weaponId: null }
        : { state: 'off', name: 'SMOKE GRENADE', detail: 'Free — click to add · round-based modes only', weaponId: null },
    };
    if (pick === 'none') {
      out.primary = { state: 'none-picked', name: 'NO PRIMARY',
        detail: selectedModeId === 'bomb'
          ? 'Pistol only at spawn — buying a primary fills this slot'
          : 'Pistol only in this mode — click to pick a primary',
        weaponId: null };
    } else if (typeof pick === 'string' && ownedPrimaries.some((w) => w.id === pick)) {
      const def = defFor(pick);
      out.primary = { state: 'picked', name: def ? def.name : pick.toUpperCase(), detail: magReserve(def), weaponId: pick };
    } else if (ownedPrimaries.length > 0) {
      const def = ownedPrimaries[0];
      out.primary = { state: 'not-picked', name: def.name, detail: magReserve(def), weaponId: def.id };
    } else {
      out.primary = { state: 'not-owned', name: 'NO PRIMARY', detail: `Buy in the shop · from ${cheapest.toLocaleString('en-US')} CR`, price: cheapest, weaponId: null };
    }
    return out;
  }

  // Hint line under the strip: what the clickable slots do, plus the
  // live balance once the shop has loaded.
  function loadoutHintText() {
    const base = 'Click PRIMARY to cycle your owned guns · Click FRAG / SMOKE to add them free · Buy more guns in the SHOP';
    if (!shopMod) return base + '.';
    return `${base} — you have ${fmtCredits(shopMod.getCredits())}.`;
  }

  function paintLoadout() {
    if (!shopMod) {
      renderLoadout(loadoutBox, DEFAULT_LOADOUT, currentSkinMap(), loadoutHintText());
      // Shop still loading: the clickable slots are dimmed and inert
      // until the first paint from the real shop state.
      if (loadoutBox) {
        for (const s of loadoutBox.querySelectorAll('.loadout-slot.clickable')) {
          s.classList.add('loading');
          s.setAttribute('aria-disabled', 'true');
        }
      }
      return;
    }
    renderLoadout(loadoutBox, buildDisplayLoadout(shopMod.getShopState(), shopMod.getShopLoadout(), state.mode), currentSkinMap(), loadoutHintText());
    if (window.__ferrolineLobby) window.__ferrolineLobby.loadout = getLoadout();
  }
  function updateLoadoutSkins() {
    paintLoadout();
  }
  function hydrateLoadout() {
    if (!loadoutBox) return;
    try {
      const slots = [...loadoutBox.querySelectorAll(':scope > .loadout-slot[data-slot]')];
      const want = LOADOUT_SLOTS.map((s) => s.key);
      const got = slots.map((s) => s.dataset.slot);
      if (got.length === want.length && want.every((k, i) => got[i] === k)) {
        paintLoadout(); // re-render: same slots, plus skin chips once shop loads
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      paintLoadout();
    } catch (e) {
      showNotice('Loadout couldn\'t be made interactive — browsing only.');
    }
  }
  function getLoadout() {
    if (shopMod) return buildDisplayLoadout(shopMod.getShopState(), shopMod.getShopLoadout(), state.mode);
    return JSON.parse(JSON.stringify(DEFAULT_LOADOUT));
  }
  // Compatibility shim: the strip derives from the shop save, so an
  // externally passed loadout map is ignored — this just repaints.
  function setLoadout(/* owned — ignored */) {
    paintLoadout();
    if (window.__ferrolineLobby) window.__ferrolineLobby.loadout = getLoadout();
    return getLoadout();
  }

  // --- Muted --------------------------------------------------------
  function isMuted() {
    return !!getSettings().muted;
  }
  function setMuted(m) {
    const v = !!m;
    setSettings({ muted: v });
    if (typeof state.onMuteToggle === 'function') state.onMuteToggle(v);
    syncSettingsUI();
    return v;
  }

  // Credits, formatted the way the lobby shows them: 2,000,000 CR.
  function fmtCredits(n) {
    return `${Number(n || 0).toLocaleString('en-US')} CR`;
  }

  // --- Credits ------------------------------------------------------
  async function refreshCredits() {
    const mod = await loadShopModule();
    if (mod) {
      lastCredits = mod.getCredits();
      lastShopState = mod.getShopState();
      if (creditsEl) creditsEl.textContent = `◆ ${fmtCredits(lastCredits)}`;
    }
    if (window.__ferrolineLobby) {
      window.__ferrolineLobby.shop = lastShopState;
      window.__ferrolineLobby.credits = lastCredits;
    }
  }
  function pulseCredits() {
    if (!creditsEl) return;
    creditsEl.classList.remove('pulse');
    void creditsEl.offsetWidth;
    creditsEl.classList.add('pulse');
  }
  function shopMessage(text, ok = true) {
    if (!shopMsg) return;
    shopMsg.textContent = text;
    shopMsg.classList.toggle('error', !ok);
  }
  function onNeedMore(need) {
    shopMessage(`Short ${need} CR — a losing match pays ~100–150 CR, a win ~425 CR.`, false);
    pulseCredits();
  }

  // --- Shop preview stage (own renderer, own camera) --------------
  const preview = { ok: false, failed: false, renderer: null, scene: null,
    camera: null, THREE: null, soldier: null, gun: null };
  async function initShopPreview() {
    if (!previewWrap || preview.ok || preview.failed) return;
    try {
      const [THREE, pal] = await Promise.all([import('three'), import('./palette.js')]);
      const canvas = document.createElement('canvas');
      canvas.id = 'home-shop-preview-canvas';
      canvas.setAttribute('aria-label', 'Shop item preview');
      previewWrap.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      // ACES tone mapping (exposure 1.25): the preview reads like the
      // game, so a textured skin in the shop looks like the same skin
      // on the viewmodel in-match.
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
      camera.position.set(0.55, 0.25, 1.6);
      camera.lookAt(0, 0, 0);
      // Preview lighting: bright enough that a dark factory-finish
      // viewmodel reads against the (now lighter) stage backdrop. The
      // old rig (ambient 0.75 / key 1.2 / fill 0.5, no rim, no floor)
      // left the default pistol nearly black-on-black. A rim light
      // from behind-top edges the silhouette, and a floor disc grounds
      // the weapon instead of floating it on void.
      scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      const dir = new THREE.DirectionalLight(0xfff2dd, 2.0);
      dir.position.set(1.5, 2, 2);
      scene.add(dir);
      const pfill = new THREE.DirectionalLight(0xbfd4ff, 0.9);
      pfill.position.set(-1.5, 0.5, 2);
      scene.add(pfill);
      const prim = new THREE.DirectionalLight(0xffffff, 1.3);
      prim.position.set(-0.5, 1.5, -2);
      scene.add(prim);
      const pfloor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40),
        new THREE.MeshStandardMaterial({ map: radialTexture(THREE, '#4a5058', '#2c3038'), roughness: 0.95 }));
      pfloor.rotation.x = -Math.PI / 2;
      pfloor.position.y = -0.32;
      scene.add(pfloor);
      const soldier = buildShowcaseSoldier(THREE, pal.PALETTE);
      // Same 3/4 presentation yaw as the lobby showcase (PI + 0.85):
      // the fixed hold reads level and full-length from this angle.
      soldier.group.rotation.y = Math.PI + 0.85;
      soldier.group.visible = false;
      scene.add(soldier.group);
      Object.assign(preview, { ok: true, renderer, scene, camera, THREE, soldier });
      resizePreview();
      updatePreview();
    } catch (e) {
      preview.failed = true;
      showPreviewFallback();
    }
  }
  function resizePreview() {
    if (!preview.ok) return;
    const w = previewWrap.clientWidth || 300;
    const h = previewWrap.clientHeight || 300;
    preview.renderer.setSize(w, h, false);
    preview.camera.aspect = w / h;
    preview.camera.updateProjectionMatrix();
    renderPreview();
  }
  function renderPreview() {
    if (!preview.ok) return;
    preview.renderer.render(preview.scene, preview.camera);
  }
  function showPreviewFallback() {
    if (!previewFallbackEl) return;
    previewFallbackEl.hidden = false;
    const glyphEl = document.getElementById('home-shop-preview-fallback-glyph');
    if (glyphEl) glyphEl.innerHTML = previewSel.tab === 'outfits' ? BUST_SVG : glyphFor(previewSel.weaponId);
  }
  function buildPreviewWeapon(THREE, weaponId, colors, skinId = 'default') {
    const c = colors || FACTORY_COLORS;
    // Real factory finish (matches the viewmodel materials in
    // weapons.js createWeapons): body 0.5/0.3, steel 0.4/0.45,
    // grip 0.9/0.05, accent 0.5/0.1.
    const body = new THREE.MeshStandardMaterial({ color: c.body, roughness: 0.5, metalness: 0.3 });
    const steel = new THREE.MeshStandardMaterial({ color: c.steel, roughness: 0.4, metalness: 0.45 });
    const grip = new THREE.MeshStandardMaterial({ color: c.grip, roughness: 0.9, metalness: 0.05 });
    const accent = new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.5, metalness: 0.1 });
    // A skin is a texture, not a flat recolour: body/steel/grip get the
    // family's procedural CanvasTexture (skins.js) and a WHITE colour
    // (map x colour). The accent stripe stays flat. The knife blade is
    // a separate material below and is never touched. Before skins.js
    // loads, the preview is flat — never blank.
    if (skinId && skinId !== 'default' && skinsMod) {
      const fam = shopMod ? (shopMod.SHOP_SKINS[weaponId] || []).find((s) => s.id === skinId) : null;
      const tex = (role) => skinsMod.skinTexture(skinId, role, c);
      body.map = tex('body'); body.color.setHex(0xffffff);
      steel.map = tex('steel'); steel.color.setHex(0xffffff);
      grip.map = tex('grip'); grip.color.setHex(0xffffff);
      if (fam && fam.finish) {
        for (const m of [body, steel, grip]) {
          if (typeof fam.finish.roughness === 'number') m.roughness = fam.finish.roughness;
          if (typeof fam.finish.metalness === 'number') m.metalness = fam.finish.metalness;
        }
      }
    }
    const g = new THREE.Group();
    const box = (mat, w, h, d, x, y, z, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      if (rz) m.rotation.z = rz;
      g.add(m);
      return m;
    };
    const tube = (mat, r, len, x, y, z) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    if (weaponId === 'pistol') {
      box(body, 0.09, 0.10, 0.40, 0, 0.02, 0);
      box(steel, 0.03, 0.02, 0.34, 0, 0.08, -0.01);
      tube(steel, 0.026, 0.05, 0, 0.02, -0.22);
      box(body, 0.08, 0.08, 0.36, 0, -0.05, 0.01);
      box(accent, 0.085, 0.013, 0.17, 0, 0.02, -0.10);
      box(grip, 0.08, 0.22, 0.11, 0, -0.17, 0.16, 0.28);
      box(body, 0.09, 0.03, 0.13, 0, -0.28, 0.19, 0.28);
      box(steel, 0.02, 0.06, 0.02, 0, -0.08, -0.03, 0.15);
    } else if (weaponId === 'smg') {
      box(body, 0.10, 0.15, 0.50, 0, 0, 0.03);
      box(steel, 0.045, 0.02, 0.66, 0, 0.085, -0.10);
      box(body, 0.09, 0.11, 0.27, 0, 0.01, -0.33);
      tube(steel, 0.03, 0.27, 0, 0.015, -0.57);
      tube(body, 0.05, 0.23, 0, 0.015, -0.80);
      box(body, 0.08, 0.28, 0.14, 0, -0.19, 0.03, -0.22);
      box(grip, 0.08, 0.18, 0.11, 0, -0.16, 0.25, 0.3);
      box(body, 0.09, 0.13, 0.27, 0, -0.01, 0.42);
      box(accent, 0.102, 0.02, 0.30, 0, 0.03, 0.03);
      box(grip, 0.065, 0.16, 0.09, 0, -0.14, -0.33, 0.12);
    } else if (weaponId === 'sniper') {
      box(body, 0.10, 0.15, 0.70, 0, 0, 0.03);
      box(body, 0.09, 0.11, 0.50, 0, 0.01, -0.53);
      tube(steel, 0.036, 0.83, 0, 0.015, -1.16);
      tube(body, 0.052, 0.13, 0, 0.015, -1.60);
      tube(body, 0.05, 0.40, 0, 0.16, -0.03);
      tube(body, 0.075, 0.12, 0, 0.16, -0.26);
      tube(body, 0.058, 0.08, 0, 0.16, 0.20);
      box(body, 0.08, 0.20, 0.17, 0, -0.17, 0.03, -0.2);
      box(grip, 0.08, 0.20, 0.11, 0, -0.17, 0.27, 0.3);
      box(body, 0.10, 0.13, 0.37, 0, -0.01, 0.50);
      box(accent, 0.102, 0.016, 0.27, 0, 0.03, 0.03);
      box(body, 0.026, 0.026, 0.50, -0.065, -0.09, -0.53, 0, 0.12);
      box(body, 0.026, 0.026, 0.50, 0.065, -0.09, -0.53, 0, -0.12);
    } else if (weaponId === 'knife') {
      const blade = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.22, metalness: 0.85 });
      box(blade, 0.075, 0.016, 0.36, 0, 0.015, -0.26);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 4), blade);
      tip.rotation.x = -Math.PI / 2;
      tip.rotation.y = Math.PI / 4;
      tip.scale.set(1.5, 1, 0.5);
      tip.position.set(0, 0.015, -0.50);
      g.add(tip);
      box(grip, 0.09, 0.022, 0.05, 0, 0.015, -0.05);
      box(grip, 0.06, 0.045, 0.18, 0, 0.008, 0.07, -0.12);
      box(steel, 0.065, 0.032, 0.03, 0, 0, 0.17, -0.12);
      box(accent, 0.065, 0.01, 0.08, 0, 0.02, 0.03);
    } else { // rifle (default)
      box(body, 0.105, 0.16, 0.56, 0, 0, 0.03);
      box(steel, 0.048, 0.02, 0.86, 0, 0.09, -0.17);
      box(body, 0.095, 0.12, 0.49, 0, 0.01, -0.46);
      tube(steel, 0.032, 0.46, 0, 0.015, -0.92);
      tube(body, 0.045, 0.11, 0, 0.015, -1.18);
      box(body, 0.08, 0.26, 0.15, 0, -0.20, 0.06, -0.28);
      box(grip, 0.08, 0.20, 0.11, 0, -0.17, 0.26, 0.3);
      box(body, 0.095, 0.15, 0.33, 0, -0.01, 0.46);
      box(accent, 0.107, 0.02, 0.33, 0, 0.03, 0.03);
      box(grip, 0.07, 0.15, 0.10, 0, -0.14, -0.49, 0.15);
    }
    g.rotation.y = -0.5;
    g.rotation.x = 0.08;
    const scale = weaponId === 'pistol' ? 1.8 : weaponId === 'knife' ? 1.4
      : weaponId === 'smg' ? 0.85 : weaponId === 'sniper' ? 0.55 : 0.65;
    g.scale.setScalar(scale);
    return g;
  }
  function setPreviewChips(colors, labels) {
    if (previewChipsEl) {
      previewChipsEl.replaceChildren();
      colors.forEach((c, i) => {
        const chip = el('span', 'chip');
        chip.style.background = hexCss(c);
        chip.title = labels[i] || '';
        previewChipsEl.appendChild(chip);
      });
    }
    const fbChips = document.getElementById('home-shop-preview-fallback-chips');
    if (fbChips) {
      fbChips.replaceChildren();
      colors.forEach((c, i) => {
        const chip = el('span', 'chip');
        chip.style.background = hexCss(c);
        chip.title = labels[i] || '';
        fbChips.appendChild(chip);
      });
    }
  }
  function updatePreviewText() {
    if (!previewNameEl) return;
    const sel = previewSel;
    if (sel.tab === 'outfits') {
      const o = sel.outfitObj || state.equippedOutfit;
      previewNameEl.textContent = o.name;
      previewSubEl.textContent = `OUTFIT — ALL OPERATORS · ${o.price === 0 ? 'FREE' : o.price.toLocaleString('en-US') + ' CR'}`;
      previewTextEl.textContent = `${o.desc} Lobby only — not visible in-match. Cosmetic only.`;
      setPreviewChips(Object.values(o.colors), ['UNIFORM', 'VEST', 'HELMET', 'ACCENT', 'PANTS', 'BOOTS']);
      const fbText = document.getElementById('home-shop-preview-fallback-text');
      if (fbText) fbText.textContent = `${o.name} · LOBBY ONLY`;
    } else if (sel.tab === 'skins') {
      const wdef = shopMod ? shopMod.SHOP_WEAPONS.find((w) => w.id === sel.weaponId) : null;
      const skin = shopMod ? (shopMod.SHOP_SKINS[sel.weaponId] || []).find((s) => s.id === sel.skinId) : null;
      const wname = wdef ? wdef.name : sel.weaponId.toUpperCase();
      previewNameEl.textContent = skin ? skin.name : 'FACTORY FINISH';
      previewSubEl.textContent = `${wname} · ${skin ? skin.price.toLocaleString('en-US') + ' CR · PER WEAPON' : 'FACTORY FINISH'}`;
      previewTextEl.textContent = skin
        ? `${skin.desc} Recolours the ${wname} — body, steel, grip, accent. Cosmetic only.`
        : `Factory finish for the ${wname}.`;
      setPreviewChips(skin ? [skin.colors.body, skin.colors.steel, skin.colors.grip, skin.colors.accent]
        : [FACTORY_COLORS.body, FACTORY_COLORS.steel, FACTORY_COLORS.grip, FACTORY_COLORS.accent],
        ['BODY', 'STEEL', 'GRIP', 'ACCENT']);
      const fbText = document.getElementById('home-shop-preview-fallback-text');
      if (fbText) fbText.textContent = skin ? `${skin.name} · ${wname}` : `${wname} · FACTORY FINISH`;
    } else {
      const wdef = shopMod ? shopMod.SHOP_WEAPONS.find((w) => w.id === sel.weaponId) : null;
      const wname = wdef ? wdef.name : sel.weaponId.toUpperCase();
      previewNameEl.textContent = wname;
      previewSubEl.textContent = wdef ? `${wdef.kind.toUpperCase()} · ${wdef.stat}` : 'FACTORY FINISH';
      previewTextEl.textContent = wdef ? wdef.desc : '';
      setPreviewChips([FACTORY_COLORS.body, FACTORY_COLORS.steel, FACTORY_COLORS.grip, FACTORY_COLORS.accent],
        ['BODY', 'STEEL', 'GRIP', 'ACCENT']);
      const fbText = document.getElementById('home-shop-preview-fallback-text');
      if (fbText) fbText.textContent = `${wname} · FACTORY FINISH`;
    }
  }
  function updatePreview() {
    updatePreviewText();
    if (!preview.ok) { if (preview.failed) showPreviewFallback(); return; }
    if (previewSel.tab === 'outfits') {
      if (preview.gun) { preview.scene.remove(preview.gun); preview.gun = null; }
      preview.camera.fov = 38;
      preview.camera.position.set(0.4, 1.1, 4.2);
      preview.camera.lookAt(0, 0.95, 0);
      preview.camera.updateProjectionMatrix();
      const outfit = previewSel.outfitObj || state.equippedOutfit;
      paintSoldierMats(preview.soldier, outfit);
      const op = getOperator();
      if (op) preview.soldier.setRifle(!!op.sniper);
      preview.soldier.group.visible = true;
    } else {
      if (preview.soldier) preview.soldier.group.visible = false;
      if (preview.gun) { preview.scene.remove(preview.gun); preview.gun = null; }
      preview.camera.fov = 35;
      preview.camera.position.set(0.55, 0.25, 1.6);
      preview.camera.lookAt(0, 0, 0);
      preview.camera.updateProjectionMatrix();
      const skin = previewSel.skinId && previewSel.skinId !== 'default' && shopMod
        ? (shopMod.SHOP_SKINS[previewSel.weaponId] || []).find((s) => s.id === previewSel.skinId) : null;
      preview.gun = buildPreviewWeapon(preview.THREE, previewSel.weaponId, skin ? skin.colors : null, skin ? skin.id : 'default');
      preview.scene.add(preview.gun);
    }
    renderPreview();
  }

  // --- Shop cards ---------------------------------------------------
  function markPreviewing(card) {
    if (!shopGrid) return;
    for (const c of shopGrid.querySelectorAll('.shop-card')) c.classList.remove('previewing');
    if (card) card.classList.add('previewing');
  }
  function previewZoneWeapon(wid) {
    const z = el('div', 'shop-preview weapon');
    const glyph = el('span', 'shop-glyph');
    glyph.innerHTML = glyphFor(wid);
    z.appendChild(glyph);
    return z;
  }
  function previewZoneSkin(wid, skin) {
    const z = el('div', 'shop-preview skin');
    const glyph = el('span', 'shop-glyph');
    glyph.innerHTML = glyphFor(wid);
    z.appendChild(glyph);
    // 48px swatch: the family's body texture scaled down from the
    // cached canvas — the real pattern, not a flat chip. The 48px
    // source canvas is drawn once per family (swatchCache) and reused
    // by every card. Before skins.js loads, the card shows the 4
    // colour chips instead — never blank.
    if (skinsMod) {
      let src = swatchCache.get(skin.id);
      if (!src) {
        src = document.createElement('canvas');
        src.width = 48; src.height = 48;
        const tex = skinsMod.skinTexture(skin.id, 'body', skin.colors);
        if (tex && tex.image) src.getContext('2d').drawImage(tex.image, 0, 0, 48, 48);
        swatchCache.set(skin.id, src);
      }
      const cv = document.createElement('canvas');
      cv.width = 48; cv.height = 48;
      cv.className = 'shop-swatch';
      cv.getContext('2d').drawImage(src, 0, 0);
      z.appendChild(cv);
    } else {
      const chips = el('span', 'shop-chips');
      for (const c of [skin.colors.body, skin.colors.steel, skin.colors.grip, skin.colors.accent]) {
        const chip = el('span', 'chip');
        chip.style.background = hexCss(c);
        chips.appendChild(chip);
      }
      z.appendChild(chips);
    }
    return z;
  }
  function previewZoneOutfit(outfit) {
    const z = el('div', 'shop-preview outfit');
    const stack = el('div', 'figure-stack');
    const c = outfit.colors;
    const mk = (cls, hex) => { const d = el('div', cls); d.style.background = hexCss(hex); return d; };
    stack.appendChild(mk('fig-helmet', c.helmet));
    stack.appendChild(mk('fig-torso', c.uniform));
    stack.appendChild(mk('fig-vest', c.vest));
    stack.appendChild(mk('fig-stripe', c.accent));
    stack.appendChild(mk('fig-legs', c.pants));
    stack.appendChild(mk('fig-boots', c.boots));
    z.appendChild(stack);
    return z;
  }
  function selectPreviewSkin(card, wid, skin) {
    previewSel = { tab: 'skins', weaponId: wid, skinId: skin.id, outfitId: null, outfitObj: null };
    markPreviewing(card);
    updatePreview();
  }
  function selectPreviewOutfit(card, outfit) {
    previewSel = { tab: 'outfits', weaponId: null, skinId: null, outfitId: outfit.id, outfitObj: outfit };
    state.previewOutfit = outfit;
    markPreviewing(card);
    updatePreview();
  }
  function buyButton(mod, price, onBuy, buyLabel = 'BUY') {
    const credits = mod.getCredits();
    const btn = el('button', 'shop-btn');
    btn.type = 'button';
    if (credits >= price) {
      btn.textContent = buyLabel;
      btn.addEventListener('click', onBuy);
    } else {
      const need = price - credits;
      btn.textContent = `NEED ${need} MORE`;
      btn.classList.add('need');
      btn.setAttribute('aria-disabled', 'true');
      btn.addEventListener('click', () => onNeedMore(need));
    }
    return btn;
  }
  function buildWeaponCards(mod, frag) {
    for (const w of mod.SHOP_WEAPONS) {
      const owned = mod.isWeaponOwned(w.id);
      const card = el('div', 'shop-card' + (owned ? ' owned' : ''));
      card.dataset.weapon = w.id;
      card.appendChild(previewZoneWeapon(w.id));
      const nameRow = el('div', 'shop-card-name');
      nameRow.appendChild(el('span', null, w.name));
      card.appendChild(nameRow);
      const forLine = w.id === 'pistol' ? 'SIDEARM · FREE'
        : w.id === 'knife' ? 'MELEE · FREE'
        : `${w.kind.toUpperCase()} · IN-MATCH $${w.inMatchPrice.toLocaleString('en-US')}`;
      card.appendChild(el('div', 'shop-for', forLine));
      const desc = el('div', 'shop-card-desc');
      desc.appendChild(el('span', 'mono', w.stat));
      desc.appendChild(document.createTextNode(' — ' + w.desc));
      card.appendChild(desc);
      const foot = el('div', 'shop-card-foot');
      if (owned) {
        if (w.kind === 'primary') {
          // Owned primary: the pick lives on the strip, but the shop
          // card is where a player compares guns — SET AS PRIMARY here,
          // PRIMARY ✓ on the card that is already the pick.
          const pick = mod.getShopLoadout ? mod.getShopLoadout().primary : null;
          if (pick === w.id) {
            const b = el('button', 'shop-btn primary-picked', 'PRIMARY ✓');
            b.type = 'button';
            b.disabled = true;
            foot.appendChild(b);
          } else {
            const b = el('button', 'shop-btn set-primary', 'SET AS PRIMARY');
            b.type = 'button';
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              if (mod.setLoadoutPrimary(w.id)) {
                renderShop();
                paintLoadout();
              } else {
                shopMessage('Could not set that weapon as primary.', false);
              }
            });
            foot.appendChild(b);
          }
        } else {
          foot.appendChild(el('span', 'shop-pill', 'OWNED'));
        }
      } else {
        const pw = el('span', 'shop-price-wrap');
        pw.appendChild(el('span', 'shop-price', `${w.price.toLocaleString('en-US')} CR`));
        foot.appendChild(pw);
        foot.appendChild(buyButton(mod, w.price, () => {
          const r = mod.buyWeapon(w.id);
          if (r.ok) shopMessage(`${w.name} unlocked — yours forever.`);
          else shopMessage(r.reason, false);
          renderShop();
        }));
      }
      card.appendChild(foot);
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        previewSel = { tab: 'weapons', weaponId: w.id, skinId: 'default', outfitId: null, outfitObj: null };
        markPreviewing(card);
        updatePreview();
      });
      card.addEventListener('mouseenter', () => {
        previewSel = { tab: 'weapons', weaponId: w.id, skinId: 'default', outfitId: null, outfitObj: null };
        markPreviewing(card);
        updatePreview();
      });
      frag.appendChild(card);
    }
  }
  function buildSkinCards(mod, frag) {
    for (const wid of ['pistol', 'smg', 'rifle', 'sniper', 'knife']) {
      const wdef = mod.SHOP_WEAPONS.find((w) => w.id === wid);
      const wname = wdef ? wdef.name : wid.toUpperCase();
      frag.appendChild(el('div', 'shop-group-head', `${wname} — SKINS`));
      for (const skin of mod.SHOP_SKINS[wid]) {
        const owned = mod.isSkinOwned(wid, skin.id);
        const equipped = mod.getEquippedSkin(wid) === skin.id;
        const card = el('div', 'shop-card' + (owned ? ' owned' : '') + (equipped ? ' equipped' : ''));
        card.dataset.weapon = wid;
        card.dataset.skin = skin.id;
        card.appendChild(previewZoneSkin(wid, skin));
        const nameRow = el('div', 'shop-card-name');
        nameRow.appendChild(el('span', null, skin.name));
        nameRow.appendChild(el('span', 'shop-rarity', skin.rarity));
        card.appendChild(nameRow);
        card.appendChild(el('div', 'shop-for', `FOR — ${wname}`));
        card.appendChild(el('div', 'shop-card-desc',
          `Recolours the ${wname} — body, steel, grip, accent. Cosmetic only.`));
        const foot = el('div', 'shop-card-foot');
        if (equipped) {
          foot.appendChild(el('span', 'shop-pill equipped', 'EQUIPPED'));
        } else if (owned) {
          foot.appendChild(el('span', 'shop-pill', 'OWNED'));
          const btn = el('button', 'shop-btn outline');
          btn.type = 'button';
          btn.textContent = 'EQUIP';
          btn.addEventListener('click', () => {
            if (mod.equipSkin(wid, skin.id)) shopMessage(`${skin.name} equipped on ${wname}.`);
            else shopMessage('Could not equip that skin.', false);
            renderShop();
          });
          foot.appendChild(btn);
        } else {
          const pw = el('span', 'shop-price-wrap');
          pw.appendChild(el('span', 'shop-price', `${skin.price.toLocaleString('en-US')} CR`));
          pw.appendChild(el('span', 'shop-per', 'PER WEAPON'));
          foot.appendChild(pw);
          foot.appendChild(buyButton(mod, skin.price, () => {
            const r = mod.buySkin(wid, skin.id);
            if (r.ok) shopMessage(`${skin.name} unlocked and equipped on ${wname}.`);
            else shopMessage(r.reason, false);
            renderShop();
          }));
        }
        card.appendChild(foot);
        card.addEventListener('click', (e) => { if (e.target.closest('button')) return; selectPreviewSkin(card, wid, skin); });
        card.addEventListener('mouseenter', () => selectPreviewSkin(card, wid, skin));
        frag.appendChild(card);
      }
    }
  }
  function buildOutfitCards(mod, frag) {
    for (const outfit of mod.SHOP_OUTFITS) {
      const owned = mod.isOutfitOwned(outfit.id);
      const equipped = mod.getEquippedOutfit() === outfit.id;
      const card = el('div', 'shop-card outfit' + (owned ? ' owned' : '') + (equipped ? ' equipped' : ''));
      card.dataset.outfit = outfit.id;
      card.appendChild(previewZoneOutfit(outfit));
      const nameRow = el('div', 'shop-card-name');
      nameRow.appendChild(el('span', null, outfit.name));
      card.appendChild(nameRow);
      card.appendChild(el('div', 'shop-for', 'FOR — ALL OPERATORS'));
      const pairs = el('div', 'shop-pairs');
      pairs.appendChild(document.createTextNode('PAIRS WITH '));
      pairs.appendChild(el('b', null, `${outfit.pairsWith} SKINS`));
      card.appendChild(pairs);
      card.appendChild(el('div', 'shop-card-desc',
        'Re-dresses the showcase soldier and operator card: uniform, vest, helmet, accent. Lobby only — not visible in-match. Cosmetic only.'));
      const foot = el('div', 'shop-card-foot');
      if (equipped) {
        foot.appendChild(el('span', 'shop-pill equipped', 'EQUIPPED'));
      } else if (owned) {
        foot.appendChild(el('span', 'shop-pill', 'OWNED'));
        const btn = el('button', 'shop-btn outline');
        btn.type = 'button';
        btn.textContent = 'EQUIP';
        btn.addEventListener('click', () => {
          if (mod.equipOutfit(outfit.id)) {
            state.equippedOutfit = outfit;
            paintSoldier();
            updateOutfitLine();
            shopMessage(`${outfit.name} equipped.`);
          } else shopMessage('Could not equip that outfit.', false);
          renderShop();
        });
        foot.appendChild(btn);
      } else {
        const pw = el('span', 'shop-price-wrap');
        pw.appendChild(el('span', 'shop-price', outfit.price === 0 ? 'FREE' : `${outfit.price.toLocaleString('en-US')} CR`));
        foot.appendChild(pw);
        foot.appendChild(buyButton(mod, outfit.price, () => {
          const r = mod.buyOutfit(outfit.id);
          if (r.ok) {
            state.equippedOutfit = outfit;
            paintSoldier();
            updateOutfitLine();
            shopMessage(`${outfit.name} unlocked and equipped.`);
          } else shopMessage(r.reason, false);
          renderShop();
        }, outfit.price === 0 ? 'EQUIP' : 'BUY'));
      }
      card.appendChild(foot);
      card.addEventListener('click', (e) => { if (e.target.closest('button')) return; selectPreviewOutfit(card, outfit); });
      card.addEventListener('mouseenter', () => selectPreviewOutfit(card, outfit));
      frag.appendChild(card);
    }
  }
  function buildShopUnavailable() {
    const box = el('div', 'shop-unavailable');
    box.appendChild(document.createTextNode('SHOP UNAVAILABLE — RETRY'));
    const btn = el('button', 'shop-btn');
    btn.type = 'button';
    btn.textContent = 'RETRY';
    btn.addEventListener('click', () => { shopModPromise = null; shopMod = null; renderShop(); });
    box.appendChild(btn);
    return box;
  }
  async function renderShop() {
    if (!shopGrid) return;
    const tok = ++shopRenderToken;
    for (const b of shopTabBtns) {
      const on = b.dataset.shopTab === shopTab;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const skinsNote = document.getElementById('home-shop-skins-note');
    if (skinsNote) skinsNote.hidden = shopTab !== 'skins';
    const mod = await loadShopModule();
    if (tok !== shopRenderToken) return;
    if (!mod) {
      shopGrid.replaceChildren(buildShopUnavailable());
      return;
    }
    refreshCredits();
    const frag = document.createDocumentFragment();
    if (shopTab === 'weapons') buildWeaponCards(mod, frag);
    else if (shopTab === 'skins') buildSkinCards(mod, frag);
    else buildOutfitCards(mod, frag);
    shopGrid.replaceChildren(frag);
    if (!shopMsg.textContent) setShopHint();
    updateLoadoutSkins();
    updatePreview();
  }
  function setShopHint() {
    if (!shopMod) return;
    const credits = shopMod.getCredits();
    const ownedAnySkin = Object.values(shopMod.getShopState().ownedSkins).some((l) => l.length > 0);
    let shown = false;
    try { shown = localStorage.getItem('ferroline.shop.repriceNoteShown') === '1'; } catch (e) {}
    if (ownedAnySkin && !shown) {
      shopMessage('Skin prices rebalanced — your owned skins are unchanged.');
      try { localStorage.setItem('ferroline.shop.repriceNoteShown', '1'); } catch (e) {}
    } else {
      shopMessage(`You have ${fmtCredits(credits)} — starter grant: try everything in the shop. Earn more by playing: kill +15, round win +50, losing match ~100–150 CR.`);
    }
  }

  // --- Shop open / close --------------------------------------------
  function setNavActive(nav, on) {
    for (const b of root.querySelectorAll('[data-nav]')) {
      if (b.dataset.nav === nav) b.classList.toggle('active', !!on);
    }
  }
  function isShopOpen() {
    return !!shopPanel && shopPanel.classList.contains('open');
  }
  function openShop(tab) {
    if (tab === 'weapons' || tab === 'skins' || tab === 'outfits') shopTab = tab;
    if (settingsPanel) settingsPanel.classList.remove('open');
    setNavActive('settings', false);
    if (!shopPanel) return;
    shopPanel.classList.add('open');
    setNavActive('shop', true);
    state.previewOutfit = null;
    if (shopTab === 'weapons') previewSel = { tab: 'weapons', weaponId: 'pistol', skinId: 'default', outfitId: null, outfitObj: null };
    else if (shopTab === 'skins') previewSel = { tab: 'skins', weaponId: 'rifle', skinId: 'dune', outfitId: null, outfitObj: null };
    else previewSel = { tab: 'outfits', weaponId: null, skinId: null, outfitId: state.equippedOutfit.id, outfitObj: state.equippedOutfit };
    // Pre-warm the skin textures (skins.js) so the first hover after
    // opening the shop already shows a texture. Unconditional repaint
    // on resolution — updatePreview() reads the LIVE previewSel, so a
    // stale paint is impossible by construction (no token, no guard).
    // initShopPreview() is async; it is kicked off synchronously below.
    // Staging-only: ?delaySkinsMs=N delays the import by N ms (default
    // 0) so the G.7 hover-during-import check can be run.
    if (!_skinsP) {
      let _delay = 0;
      try { _delay = parseInt(new URLSearchParams(location.search).get('delaySkinsMs') || '0', 10) || 0; } catch (e) { _delay = 0; }
      _skinsP = _delay > 0
        ? new Promise((res, rej) => setTimeout(() => { import('./skins.js').then(res, rej); }, _delay))
        : import('./skins.js');
    }
    _skinsP.then((m) => { skinsMod = m; updatePreviewText(); updatePreview(); if (isShopOpen()) renderShop(); }).catch(() => {});
    initShopPreview();
    renderShop();
  }
  function closeShop() {
    if (shopPanel) shopPanel.classList.remove('open');
    setNavActive('shop', false);
    state.previewOutfit = null;
  }
  function toggleShop(tab) {
    if (isShopOpen()) closeShop();
    else openShop(tab);
  }
  function syncShop() {
    refreshCredits();
    renderShop();
  }

  // --- Settings panel -----------------------------------------------
  function fmtSens(v) {
    return 'x' + (Math.round(v * 100) / 100).toFixed(2);
  }
  function syncSettingsUI() {
    if (!settingsPanel) return;
    const s = getSettings();
    const qBtns = [...settingsPanel.querySelectorAll('[data-quality]')];
    for (const b of qBtns) {
      const on = b.dataset.quality === s.quality;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const vol = settingsPanel.querySelector('#home-volume');
    if (vol) vol.value = String(Math.round(s.volume * 100));
    const volVal = settingsPanel.querySelector('#home-volume-val');
    if (volVal) volVal.textContent = `${Math.round(s.volume * 100)}%`;
    const muteBtn = settingsPanel.querySelector('#home-mute-btn');
    if (muteBtn) {
      muteBtn.classList.toggle('selected', !!s.muted);
      muteBtn.setAttribute('aria-pressed', s.muted ? 'true' : 'false');
    }
    const motionBtn = settingsPanel.querySelector('#home-motion-btn');
    if (motionBtn) {
      motionBtn.classList.toggle('selected', state.showcaseMotion);
      motionBtn.setAttribute('aria-pressed', state.showcaseMotion ? 'true' : 'false');
    }
    const presetBtns = [...settingsPanel.querySelectorAll('[data-volume-preset]')];
    for (const b of presetBtns) {
      const on = Math.abs(parseFloat(b.dataset.volumePreset) - s.volume) < 0.01;
      b.classList.toggle('preset-on', on);
    }
    const sensInputs = [...settingsPanel.querySelectorAll('[data-sens]')];
    for (const inp of sensInputs) {
      const key = inp.dataset.sens;
      const v = s.sensitivity[key] !== undefined ? s.sensitivity[key] : 1.0;
      inp.value = String(v);
      const val = settingsPanel.querySelector(`[data-sens-val="${key}"]`);
      if (val) val.textContent = fmtSens(v);
    }
    const eff = settingsPanel.querySelector('[data-eff]');
    if (eff) {
      const set = (key, v) => {
        const n = settingsPanel.querySelector(`[data-eff="${key}"]`);
        if (n) n.textContent = fmtSens(v);
      };
      set('rifle-hip', effectiveSensitivity(s, 'rifle', false, false));
      set('sniper-scoped', effectiveSensitivity(s, 'sniper', true, true));
      set('rifle-iron', effectiveSensitivity(s, 'rifle', true, false));
    }
  }
  function wireSettingsPanel() {
    if (!settingsPanel) return;
    for (const b of settingsPanel.querySelectorAll('[data-quality]')) {
      b.addEventListener('click', () => { setSettings({ quality: b.dataset.quality }); syncSettingsUI(); });
    }
    const vol = settingsPanel.querySelector('#home-volume');
    if (vol) vol.addEventListener('input', () => {
      setSettings({ volume: parseFloat(vol.value) / 100 });
      syncSettingsUI();
    });
    const muteBtn = settingsPanel.querySelector('#home-mute-btn');
    if (muteBtn) muteBtn.addEventListener('click', () => setMuted(!isMuted()));
    const motionBtn = settingsPanel.querySelector('#home-motion-btn');
    if (motionBtn) motionBtn.addEventListener('click', () => {
      state.showcaseMotion = !state.showcaseMotion;
      syncSettingsUI();
    });
    for (const b of settingsPanel.querySelectorAll('[data-volume-preset]')) {
      b.addEventListener('click', () => {
        setSettings({ volume: parseFloat(b.dataset.volumePreset) });
        syncSettingsUI();
      });
    }
    for (const inp of settingsPanel.querySelectorAll('[data-sens]')) {
      inp.addEventListener('input', () => {
        setSensitivity({ [inp.dataset.sens]: parseFloat(inp.value) });
        syncSettingsUI();
      });
    }
    const resetBtn = settingsPanel.querySelector('#home-sens-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => { resetSensitivity(); syncSettingsUI(); });
    const closeBtn = document.getElementById('home-settings-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { closeSettings(); setNavActive('settings', false); });
  }
  function openSettings() {
    closeShop();
    if (!settingsPanel) return;
    settingsPanel.classList.add('open');
    setNavActive('settings', true);
    syncSettingsUI();
  }
  function closeSettings() {
    if (settingsPanel) settingsPanel.classList.remove('open');
    setNavActive('settings', false);
  }
  function toggleSettings() {
    if (settingsPanel && settingsPanel.classList.contains('open')) closeSettings();
    else openSettings();
  }
  function isSettingsOpen() {
    return !!settingsPanel && settingsPanel.classList.contains('open');
  }
  function syncSettings() {
    syncSettingsUI();
  }

  // --- Show / hide / play --------------------------------------------
  function show() {
    if (legacyOverlay) legacyOverlay.style.display = 'none';
    document.body.classList.add('lobby');
    document.body.classList.remove('in-match');
    root.style.display = '';
    root.classList.add('visible');
    startShowcase();
  }
  function hide() {
    stopShowcase();
    root.style.display = 'none';
    root.classList.remove('visible');
    document.body.classList.remove('lobby');
    document.body.classList.add('in-match');
  }
  function isVisible() {
    return root.style.display !== 'none';
  }
  function play() {
    const sel = getSelection();
    if (!sel.mode || !sel.mapId) return;
    const op = getOperator();
    const data = { mode: sel.mode, mapId: sel.mapId, operatorId: op ? op.id : null };
    try {
      if (typeof state.onPlay === 'function') state.onPlay(data);
    } finally {
      hide();
    }
  }

  // --- _update -------------------------------------------------------
  function _update(opts) {
    if (Array.isArray(opts.modes)) state.modes = opts.modes;
    if (Array.isArray(opts.maps)) state.maps = opts.maps;
    if (Array.isArray(opts.operators) && opts.operators.length) state.operators = opts.operators;
    if (typeof opts.onPlay === 'function') state.onPlay = opts.onPlay;
    if (typeof opts.onMuteToggle === 'function') state.onMuteToggle = opts.onMuteToggle;
    if (opts.defaultMode) state.defaultMode = opts.defaultMode;
    if (opts.defaultMapId) state.defaultMapId = opts.defaultMapId;
    if (opts.defaultOperator) state.defaultOperator = opts.defaultOperator;
    if (opts.loadout) setLoadout(opts.loadout);
    hydrateCards(modeBox, state.modes, 'mode');
    hydrateCards(mapBox, state.maps, 'map');
    hydrateOperators();
    hydrateLoadout();
    // Loadout strip clicks (delegated — the strip re-renders on every
    // paint, so the listeners live on the container, not the slots).
    // Slot 2 cycles the primary pick (first click confirms the
    // fallback); slots 4/5 toggle the throwables. Slots 1/3 are always
    // carried and do nothing. Keyboard: Enter / Space on a slot.
    if (loadoutBox) {
      const onStripActivate = (ev) => {
        const slotEl = ev.target && ev.target.closest ? ev.target.closest('.loadout-slot') : null;
        if (!slotEl || !loadoutBox.contains(slotEl)) return;
        const key = slotEl.dataset.slot;
        if (key !== 'primary' && key !== 'frag' && key !== 'smoke') return;
        if (!shopMod) { showNotice('Shop still loading — try again in a second.'); return; }
        if (key === 'primary') {
          const next = shopMod.cycleLoadoutPrimary();
          if (next === null) openShop('weapons');
          else paintLoadout();
        } else {
          const cur = shopMod.getShopLoadout();
          const on = !(cur && cur[key] === true);
          if (shopMod.setLoadoutThrowable(key, on)) paintLoadout();
          else showNotice('Could not change that loadout slot.');
        }
      };
      loadoutBox.addEventListener('click', onStripActivate);
      loadoutBox.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onStripActivate(ev); }
      });
    }
    const pickDefault = (list, pref) => {
      if (!list.length) return null;
      return list.find((i) => i.id === pref) || list[0];
    };
    state.mode = pickDefault(state.modes, state.mode || state.defaultMode)?.id ?? null;
    state.mapId = pickDefault(state.maps, state.mapId || state.defaultMapId)?.id ?? null;
    let storedOp = null;
    try { storedOp = localStorage.getItem(OPERATOR_KEY); } catch (e) {}
    state.operatorId = pickDefault(state.operators, state.operatorId || storedOp || state.defaultOperator)?.id ?? null;
    paintSelection();
    applyOperator();
    updateDetailTile();
    syncSettingsUI();
    refreshCredits();
    renderShop();
    // v3 migration notice (once): a pre-v3 save was topped up to the
    // 2,000,000 CR grant and the loadout is new. shopMod is still null
    // while the dynamic import is in flight, so the check runs on the
    // module promise — the flag is already set by then, because
    // loadShopModule() sanitizes (and migrates) before it resolves.
    loadShopModule().then((m) => {
      if (m && m.wasMigratedV3 && m.wasMigratedV3()) {
        showNotice('Loadout is new: pick your primary — click slot 2. Your Credits were topped up to 2,000,000 CR.');
      }
    }).catch(() => {});
  }

  // --- Nav ------------------------------------------------------------
  function flashSection(id) {
    const target = document.getElementById(id);
    if (!target) return;
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
    const h = target.querySelector('h2');
    if (h) h.focus({ preventScroll: true });
    setTimeout(() => target.classList.remove('flash'), 650);
  }
  const mqMobile = window.matchMedia('(max-width: 1020px)');
  function isMobile() { return mqMobile.matches; }
  const mTabBtns = [...root.querySelectorAll('[data-mtab]')];
  function setMobileTab(tab) {
    const map = { modes: 'home-section-modes', maps: 'home-section-maps',
      operators: 'home-section-operators', loadout: 'home-section-loadout' };
    for (const [key, id] of Object.entries(map)) {
      const sec = document.getElementById(id);
      if (sec) sec.classList.toggle('m-active', key === tab);
    }
    for (const b of mTabBtns) b.classList.toggle('m-active', b.dataset.mtab === tab);
  }
  for (const b of mTabBtns) b.addEventListener('click', () => setMobileTab(b.dataset.mtab));
  function placeLoadout() {
    const strip = document.getElementById('home-loadout');
    if (!strip) return;
    if (mqMobile.matches) {
      const host = document.getElementById('home-loadout-mobile-host');
      if (host && strip.parentElement !== host) host.appendChild(strip);
    } else {
      const row = document.querySelector('#home-bottombar .bb-row2');
      if (row && strip.parentElement !== row) row.insertBefore(strip, document.getElementById('home-play'));
    }
  }
  mqMobile.addEventListener('change', placeLoadout);
  root.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'shop') { toggleShop(); return; }
      if (nav === 'settings') { toggleSettings(); return; }
      closeShop();
      closeSettings();
      if (isMobile()) {
        setMobileTab(nav === 'modes' ? 'modes' : nav === 'maps' ? 'maps'
          : nav === 'operators' ? 'operators' : nav === 'loadout' ? 'loadout' : 'modes');
        return;
      }
      flashSection(nav === 'modes' ? 'home-section-modes'
        : nav === 'maps' ? 'home-section-maps'
        : nav === 'operators' ? 'home-section-operators'
        : nav === 'loadout' ? 'home-bottombar' : 'home-section-modes');
    });
  });

  // --- Wiring ---------------------------------------------------------
  for (const b of shopTabBtns) {
    b.addEventListener('click', () => {
      shopTab = b.dataset.shopTab;
      state.previewOutfit = null;
      if (shopTab === 'weapons') previewSel = { tab: 'weapons', weaponId: 'pistol', skinId: 'default', outfitId: null, outfitObj: null };
      else if (shopTab === 'skins') previewSel = { tab: 'skins', weaponId: 'rifle', skinId: 'dune', outfitId: null, outfitObj: null };
      else previewSel = { tab: 'outfits', weaponId: null, skinId: null, outfitId: state.equippedOutfit.id, outfitObj: state.equippedOutfit };
      renderShop();
    });
  }
  const shopCloseBtn = document.getElementById('home-shop-close');
  if (shopCloseBtn) shopCloseBtn.addEventListener('click', closeShop);
  if (playBtn) playBtn.addEventListener('click', play);
  if (playBtnMobile) playBtnMobile.addEventListener('click', play);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (isShopOpen()) { closeShop(); return; }
      if (isSettingsOpen()) { closeSettings(); return; }
    }
    if (e.code === 'Enter' && isVisible() && !isShopOpen() && !isSettingsOpen()) play();
  });
  window.addEventListener('resize', () => { resizeShowcase(); resizePreview(); placeLoadout(); });

  // --- API ------------------------------------------------------------
  const api = {
    show, hide, isVisible, play,
    getSelection, setSelection, getOperator, setOperator,
    getLoadout, setLoadout, isMuted, setMuted,
    getSettings, openSettings, closeSettings, toggleSettings, isSettingsOpen, syncSettings,
    openShop, closeShop, toggleShop, isShopOpen, syncShop,
    getCredits: () => { loadShopModule(); return lastCredits; },
    getShopState: () => { loadShopModule(); return lastShopState ? JSON.parse(JSON.stringify(lastShopState)) : null; },
  };

  // --- Boot -----------------------------------------------------------
  wireSettingsPanel();
  loadShopModule(); // fire-and-forget: paints the equipped outfit + credits without blocking pickers
  _update(options);
  placeLoadout();
  // JS booted: enable PLAY (paintSelection already set it) and hide
  // the "JavaScript is required" note.
  if (nojsNote) nojsNote.classList.remove('show');
  initShowcase();
  show();
  // A slow boot may have fired the 12 s watchdog banner at #fb —
  // the lobby is up now, remove it.
  const wb = document.getElementById('fb');
  if (wb) wb.remove();
  window.__ferrolineMenu = api;
  window.__ferrolineLobby = {
    operatorId: state.operatorId,
    operatorSkill: getOperator() && getOperator().skill ? { ...getOperator().skill } : null,
    loadout: getLoadout(),
    showcase: showcase.ok ? 'ok' : (showcase.failed ? 'failed' : 'loading'),
    operators: OPERATORS.map((o) => ({ id: o.id, name: o.name, accent: o.accent })),
    settings: getSettings(),
    credits: lastCredits,
    shop: lastShopState,
  };

  instance = { api, _update };
  return api;
}
