// shop.js — FERROLINE meta shop (lobby Credits store).
//
// A META layer around the tactical-FPS core: it never changes a game
// rule, never adds an active ability, and never touches real money.
// Credits are earned ONLY by playing (kills, round wins, match wins)
// and spent ONLY on permanent weapon unlocks and cosmetic skins /
// outfits.
//
// This file is PURE DATA + STATE: it imports nothing (no three.js),
// so the lobby (menu.js) can import it without pulling the 3D engine
// into the picker boot path. The three-dependent skin applicators
// (buildSmgViewmodel, applySkin, applyEquippedSkins) live in
// weapons.js, which already imports three.js.
//
// Persistence: ONE versioned localStorage key, 'ferroline.shop.v1':
//   { version: 2, credits, totalEarned, ownedWeapons: [...],
//     ownedSkins: { pistol: [...], smg: [...], rifle: [...],
//                   sniper: [...], knife: [...] },
//     equippedSkins: { pistol: 'default' | skinId, ... },
//     ownedOutfits: [...], equippedOutfit: 'depot-standard' | outfitId }
// Everything is restored on load; the lobby re-reads it every open.
// Version 2 adds the outfit fields and the knife skin slot; old
// v1 saves migrate cleanly (dune/pine/ember ids are unchanged, and
// sanitize() carries credits/weapons/skins forward).
//
// API (the coordinator reads the WIRING CONTRACT at the bottom):
//   getCredits() / earnCredits(amount, reason) -> new balance
//   SHOP_WEAPONS / SHOP_SKINS / SHOP_OUTFITS / EARN / SMG_DEF /
//   STARTING_CREDITS
//   buyWeapon(id) / buySkin(weaponId, skinId) / buyOutfit(id)
//     -> { ok, reason?, ... }
//   getUnlockedWeapons() — owned weapon ids (pistol + knife always in it)
//   isWeaponOwned(id) / isSkinOwned(weaponId, skinId) /
//   isOutfitOwned(id)
//   equipSkin(weaponId, skinId) / getEquippedSkin(weaponId) /
//   equipOutfit(id) / getEquippedOutfit()
//   getOwnedSkins(weaponId) / getOwnedOutfits() / getShopState()
//   (Skin application lives in weapons.js: applySkin(),
//   applyEquippedSkins(), buildSmgViewmodel().)
export const SHOP_KEY = 'ferroline.shop.v1';
export const SHOP_VERSION = 3;

// Starter grant for a fresh profile: 2,000,000 CR — enough to buy
// everything in the shop and still have ~1,979,100 CR left
// (all three primaries 1,200 + 2,000 + 3,200 = 6,400 CR,
// all 30 skins 6 x (150 + 250 + 350 + 450 + 550 + 650) = 12,000 CR,
// all 5 paid outfits 300 + 400 + 500 + 600 + 700 = 2,500 CR;
// total 20,900 CR). Try everything first, earn more by playing.
export const STARTING_CREDITS = 2000000;

// Primaries that can be picked as the match loadout (slot 2 cycles
// these, plus NONE). Pistol and knife are always carried and are
// never part of the pick.
export const PRIMARY_LOADOUT_IDS = ['rifle', 'sniper', 'smg'];

// --- Earn rates (Credits). A typical bomb match (~8 rounds, ~5 kills,
// a win) pays 5*15 + 4*50 + 150 = 425 CR: a few hundred per match, as
// designed. A losing match pays ~100-150 CR. A skin (150-650 CR) takes
// 1-2 matches; the SMG (1,200 CR) takes ~3 matches; the rifle
// (2,000 CR) and sniper (3,200 CR) take several matches each. ---
export const EARN = {
  kill: 15,        // per player kill (combat.js damage() kill credit)
  roundWin: 50,    // per round the player's team wins (rounds.js endRound, won)
  roundLoss: 10,   // consolation per round lost (still played, still paid)
  matchWin: 150,   // per match the player's team wins (endRound/endMatch)
  matchLoss: 25,   // consolation per match lost
};

// --- Weapons sold in the shop ------------------------------------------
// price = Credits (meta currency). inMatchPrice = the $ the gun costs in
// the in-match buy menu once unlocked (rounds.js buyItem) — the SMG is
// cheaper than the rifle ($2,900) so it is a real early-round option.
// pistol and knife are free and always owned; the knife is listed here
// (OWNED) so all five loadout items appear in the shop.
export const SHOP_WEAPONS = [
  { id: 'pistol', name: 'SPARROW P9', kind: 'sidearm', price: 0,
    stat: '26 dmg — 333 RPM — 12/36', desc: 'Standard-issue sidearm. Free, always owned.',
    inMatchPrice: 350 },
  { id: 'smg', name: 'VIPER SMG-9', kind: 'primary', price: 1200,
    stat: '22 dmg — 857 RPM — 28/84', desc: 'Fast, close-quarters SMG. Low damage, short range, huge fire rate.',
    inMatchPrice: 1400 },
  { id: 'rifle', name: 'HERON AR-4', kind: 'primary', price: 2000,
    stat: '33 dmg — 600 RPM — 30/90', desc: 'The workhorse rifle. Accurate, reliable, full-auto.',
    inMatchPrice: 2900 },
  { id: 'sniper', name: 'LONGSHOT DMR', kind: 'primary', price: 3200,
    stat: '100 dmg — 50 RPM — 5/15', desc: 'One shot, one kill at long range. Bolt-action, scoped.',
    inMatchPrice: 4900 },
  { id: 'knife', name: 'TALON K-1', kind: 'melee', price: 0,
    stat: '50 dmg — melee — 2.0 m range', desc: 'Standard-issue blade. Free, always owned.',
    inMatchPrice: 0 },
];

// The SMG as a full weapon definition, matching the exact shape of the
// WEAPONS entries in weapons.js (same keys, same units). The coordinator
// copies this object into WEAPONS as `smg:` — see WIRING CONTRACT.
export const SMG_DEF = {
  id: 'smg', name: 'VIPER SMG-9', price: 1400, body: 22, headMul: 3,
  interval: 0.07, auto: true, mag: 28, reserve: 84, reload: 1.6,
  velocity: 240,
  spread: 0.010, bloomPerShot: 0.003, bloomMax: 0.024,
  recoilPitch: 0.007, recoilYaw: 0.004, speedMul: 0.97,
  stat: '22 dmg — 857 RPM — 28/84',
};

// --- Skins ---------------------------------------------------------------
// FERROLINE-original designs. A skin is a FAMILY: one name, one price,
// sold for every weapon. The same family on a different weapon is the
// SAME family at the SAME price — never a different name, never a
// different price. Price is PER WEAPON: owning DUNE on all five
// weapons costs 5 x 150 CR; the shop discloses this on every skin card
// and in the tab header. Each skin recolours the weapon's viewmodel
// by material role (see applySkin in weapons.js): body = main metal,
// steel = barrel / machined highlights, grip = polymer parts,
// accent = the stripe. `default` is not a skin entry: it is the
// factory finish, restored by applySkin(weaponId, 'default', models).
// Rarity is display only (no gameplay effect): STANDARD / DELUXE / ELITE.
// Existing owners: family ids dune/pine/ember are unchanged from v1,
// so owned skins migrate cleanly; two families got cheaper
// (PINEWATCH 350 -> 250, EMBERLINE 400-550 -> 350). No refund: Credits
// were never real money, they are earned by playing.
const SKIN_FAMILIES = [
  { id: 'dune', name: 'DUNE', price: 150, rarity: 'STANDARD',
    desc: 'Warm desert tan — the classic.',
    pattern: 'camo', finish: { roughness: 0.55, metalness: 0.25 },
    colors: { body: 0xc9a06a, steel: 0x8a6b42, grip: 0x5a3d24, accent: 0xf0a830 } },
  { id: 'pine', name: 'PINEWATCH', price: 250, rarity: 'STANDARD',
    desc: 'Deep forest green, teal accent.',
    pattern: 'leaf', finish: { roughness: 0.6, metalness: 0.2 },
    colors: { body: 0x2e4a3f, steel: 0x5d636d, grip: 0x1d2b22, accent: 0x2f9e8f } },
  { id: 'ember', name: 'EMBERLINE', price: 350, rarity: 'DELUXE',
    desc: 'Depot-at-dawn crimson, gold stripe.',
    pattern: 'brushed', finish: { roughness: 0.35, metalness: 0.55 },
    colors: { body: 0x8a2a24, steel: 0x6b1f1a, grip: 0x17181b, accent: 0xffcf3d } },
  { id: 'glacier', name: 'GLACIER', price: 450, rarity: 'DELUXE',
    desc: 'Pale cold steel, ice-blue accent.',
    pattern: 'frost', finish: { roughness: 0.4, metalness: 0.3 },
    colors: { body: 0xd7dee6, steel: 0x8fa3b5, grip: 0x2a3542, accent: 0x7fd4ff } },
  { id: 'volt', name: 'VOLTSTRIKE', price: 550, rarity: 'ELITE',
    desc: 'Hi-vis lime and safety orange — the loud one.',
    pattern: 'digital', finish: { roughness: 0.5, metalness: 0.35 },
    colors: { body: 0xc8d400, steel: 0x3a3f2a, grip: 0x14161a, accent: 0xff5a1f } },
  { id: 'nocturne', name: 'NOCTURNE', price: 650, rarity: 'ELITE',
    desc: 'Dark navy-violet — the night skin.',
    pattern: 'carbon', finish: { roughness: 0.45, metalness: 0.4 },
    colors: { body: 0x232a4a, steel: 0x4a5578, grip: 0x0e1016, accent: 0x9b7bff } },
];
export const SKIN_FAMILIES_LIST = SKIN_FAMILIES;

// 30 skins: 6 families x 5 weapons (knife included).
export const SHOP_SKINS = {
  pistol: SKIN_FAMILIES.map((f) => ({ ...f, colors: { ...f.colors } })),
  smg: SKIN_FAMILIES.map((f) => ({ ...f, colors: { ...f.colors } })),
  rifle: SKIN_FAMILIES.map((f) => ({ ...f, colors: { ...f.colors } })),
  sniper: SKIN_FAMILIES.map((f) => ({ ...f, colors: { ...f.colors } })),
  knife: SKIN_FAMILIES.map((f) => ({ ...f, colors: { ...f.colors } })),
};

export const SKIN_WEAPONS = Object.keys(SHOP_SKINS);

// --- Outfits ---------------------------------------------------------------
// An outfit is a full operator appearance set: uniform, vest, helmet,
// accent, pants, boots. UNIVERSAL (any operator can wear any outfit)
// and COSMETIC ONLY (no stat, skill, speed or gameplay effect).
// LOBBY-ONLY, stated on every card: the player is first-person and
// never sees their own soldier, and in-match soldiers are bots built
// with team colours — so an outfit is visible in the lobby only
// (showcase soldier, operator card tile, name-plate rule). The top
// outfit is 700 CR, priced for lobby-only value. `pairsWith` is the
// skin family that shares the outfit's hue (cross-sell line on the
// card, exact mapping below — do not invent another).
export const SHOP_OUTFITS = [
  { id: 'depot-standard', name: 'DEPOT STANDARD', price: 0,
    desc: 'The current look; every profile starts in it.',
    colors: { uniform: 0x4a4a38, vest: 0xd98a1f, helmet: 0x6b5a34, accent: 0xf0a830, pants: 0x2b2b26, boots: 0x14161a },
    pairsWith: 'DUNE' },
  { id: 'nightshift', name: 'NIGHTSHIFT', price: 300,
    desc: 'All-black night ops; amber accent only.',
    colors: { uniform: 0x1b1e24, vest: 0x262b33, helmet: 0x14161a, accent: 0xf0a830, pants: 0x14161a, boots: 0x0e1016 },
    pairsWith: 'NOCTURNE' },
  { id: 'dustline-ranger', name: 'DUSTLINE RANGER', price: 400,
    desc: 'Sun-baked desert patrol.',
    colors: { uniform: 0x8a6b42, vest: 0xc9a06a, helmet: 0x5a3d24, accent: 0xffcf3d, pants: 0x5a3d24, boots: 0x2b2b26 },
    pairsWith: 'DUNE' },
  { id: 'frostbite', name: 'FROSTBITE', price: 500,
    desc: 'Arctic white; the pale outfit.',
    colors: { uniform: 0xd7dee6, vest: 0x8fa3b5, helmet: 0xe8edf2, accent: 0x7fd4ff, pants: 0x8fa3b5, boots: 0x2a3542 },
    pairsWith: 'GLACIER' },
  { id: 'harbour-rain', name: 'HARBOUR RAIN', price: 600,
    desc: 'Rain-slick navy, hi-vis yellow.',
    colors: { uniform: 0x232a4a, vest: 0x2a3542, helmet: 0x1b1e24, accent: 0xffc61a, pants: 0x1b1e24, boots: 0x0e1016 },
    pairsWith: 'NOCTURNE' },
  { id: 'ember-crew', name: 'EMBER CREW', price: 700,
    desc: 'Crimson crew; the premium outfit.',
    colors: { uniform: 0x17181b, vest: 0x8a2a24, helmet: 0x3a1512, accent: 0xff5a1f, pants: 0x14161a, boots: 0x0e1016 },
    pairsWith: 'EMBERLINE' },
];

// --- State ---------------------------------------------------------------
function defaultState() {
  return {
    version: SHOP_VERSION,
    credits: STARTING_CREDITS,
    totalEarned: 0,
    ownedWeapons: ['pistol', 'knife'],
    ownedSkins: { pistol: [], smg: [], rifle: [], sniper: [], knife: [] },
    equippedSkins: { pistol: 'default', smg: 'default', rifle: 'default', sniper: 'default', knife: 'default' },
    ownedOutfits: ['depot-standard'],
    equippedOutfit: 'depot-standard',
    // Match loadout: primary is null (fallback to first owned primary),
    // 'none' (pistol only), or a weapon id from PRIMARY_LOADOUT_IDS.
    loadout: { primary: null, frag: false, smoke: false },
  };
}

function sanitize(raw) {
  const out = defaultState();
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.credits === 'number' && Number.isFinite(raw.credits)) {
    out.credits = Math.max(0, Math.floor(raw.credits));
  }
  if (typeof raw.totalEarned === 'number' && Number.isFinite(raw.totalEarned)) {
    out.totalEarned = Math.max(0, Math.floor(raw.totalEarned));
  }
  // v3 migration (one-way): a pre-v3 save is topped up to the
  // 2,000,000 CR starter grant. A v3 save keeps its own balance,
  // even if it is below the grant.
  if (typeof raw.version === 'number' && raw.version < 3) {
    out.credits = Math.max(out.credits, STARTING_CREDITS);
    _migratedV3 = true;
  }
  if (Array.isArray(raw.ownedWeapons)) {
    out.ownedWeapons = [...new Set(raw.ownedWeapons.filter((id) =>
      SHOP_WEAPONS.some((w) => w.id === id)))];
  }
  if (!out.ownedWeapons.includes('pistol')) out.ownedWeapons.unshift('pistol');
  if (!out.ownedWeapons.includes('knife')) out.ownedWeapons.push('knife');
  if (raw.ownedSkins && typeof raw.ownedSkins === 'object') {
    for (const wid of SKIN_WEAPONS) {
      const list = raw.ownedSkins[wid];
      if (Array.isArray(list)) {
        out.ownedSkins[wid] = [...new Set(list.filter((sid) =>
          (SHOP_SKINS[wid] || []).some((s) => s.id === sid)))];
      }
    }
  }
  if (raw.equippedSkins && typeof raw.equippedSkins === 'object') {
    for (const wid of SKIN_WEAPONS) {
      const eq = raw.equippedSkins[wid];
      if (eq === 'default' || (SHOP_SKINS[wid] || []).some((s) => s.id === eq)) {
        out.equippedSkins[wid] = eq;
      }
    }
  }
  if (Array.isArray(raw.ownedOutfits)) {
    out.ownedOutfits = [...new Set(raw.ownedOutfits.filter((id) =>
      SHOP_OUTFITS.some((o) => o.id === id)))];
  }
  if (!out.ownedOutfits.includes('depot-standard')) out.ownedOutfits.unshift('depot-standard');
  if (typeof raw.equippedOutfit === 'string') {
    if (raw.equippedOutfit === 'depot-standard' || out.ownedOutfits.includes(raw.equippedOutfit)) {
      out.equippedOutfit = raw.equippedOutfit;
    }
  }
  // Match loadout (v3): validated ONLY against the sanitized owned
  // list above — never against raw.ownedWeapons. A pick of a weapon
  // the player does not own falls back to null (first owned primary).
  const lo = raw.loadout;
  if (lo && typeof lo === 'object') {
    if (lo.primary === 'none') out.loadout.primary = 'none';
    else if (typeof lo.primary === 'string' && PRIMARY_LOADOUT_IDS.includes(lo.primary)
      && out.ownedWeapons.includes(lo.primary)) out.loadout.primary = lo.primary;
    else out.loadout.primary = null;
    out.loadout.frag = lo.frag === true;
    out.loadout.smoke = lo.smoke === true;
  }
  return out;
}

let _migratedV3 = false;

// True when the most recent loadShop()/sanitize() migrated a pre-v3
// save (topped the balance up to the 2,000,000 CR grant). The lobby
// shows the migration notice once from this flag.
export function wasMigratedV3() {
  return _migratedV3;
}

let cached = null;

function readStored() {
  try {
    const raw = localStorage.getItem(SHOP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function loadShop() {
  cached = sanitize(readStored());
  save(); // write-through: a fresh profile gets its key immediately,
  // so the persisted state exists from the first lobby load on.
  return cached;
}

export function getShopState() {
  if (!cached) return loadShop();
  return JSON.parse(JSON.stringify(cached));
}

// The match loadout (a copy; mutate via setLoadoutPrimary /
// setLoadoutThrowable). Lazy-loads the shop the same way getShopState
// does, so the lobby strip can paint from it before any other call.
export function getShopLoadout() {
  if (!cached) loadShop();
  return JSON.parse(JSON.stringify(cached.loadout));
}

// Set the lobby primary pick. null clears the pick (fallback to the
// first owned primary); 'none' means pistol only. A weapon id must be
// an owned primary. Returns true on success, false when the id is not
// a valid pick (state unchanged).
export function setLoadoutPrimary(id) {
  if (!cached) loadShop();
  if (id === null || id === 'none') {
    cached.loadout.primary = id;
    save();
    return true;
  }
  if (typeof id !== 'string' || !PRIMARY_LOADOUT_IDS.includes(id) || !cached.ownedWeapons.includes(id)) {
    return false;
  }
  cached.loadout.primary = id;
  save();
  return true;
}

// Set one throwables toggle ('frag' | 'smoke'). Any truthy value is
// coerced to a boolean; an unknown kind is ignored.
export function setLoadoutThrowable(kind, on) {
  if (!cached) loadShop();
  if (kind !== 'frag' && kind !== 'smoke') return false;
  cached.loadout[kind] = on === true;
  save();
  return true;
}

// Cycle the primary pick for the lobby strip (slot 2). From null the
// first click CONFIRMS the fallback (the first owned primary) instead
// of cycling past it. Returns the new pick, or null when no primary
// is owned (the strip then opens the shop instead).
export function cycleLoadoutPrimary() {
  if (!cached) loadShop();
  const owned = PRIMARY_LOADOUT_IDS.filter((id) => cached.ownedWeapons.includes(id));
  if (owned.length === 0) return null;
  const cur = cached.loadout.primary;
  if (cur === null) {
    cached.loadout.primary = owned[0];
    save();
    return owned[0];
  }
  const list = [...owned, 'none'];
  const idx = list.indexOf(cur);
  const next = list[(idx + 1) % list.length];
  cached.loadout.primary = next;
  save();
  return next;
}

function save() {
  try { localStorage.setItem(SHOP_KEY, JSON.stringify(cached)); } catch { /* storage unavailable: keep in-memory */ }
  return cached;
}

export function getCredits() {
  if (!cached) loadShop();
  return cached.credits;
}

// Earn Credits from play. Called ONLY by the coordinator's wiring
// (see WIRING CONTRACT) — never by the shop UI. Returns the new balance.
export function earnCredits(amount, reason = '') {
  if (!cached) loadShop();
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n <= 0) return cached.credits;
  cached.credits += n;
  cached.totalEarned += n;
  save();
  if (typeof window !== 'undefined') {
    window.__ferrolineShop = window.__ferrolineShop || {};
    window.__ferrolineShop.lastEarn = { amount: n, reason, balance: cached.credits };
  }
  return cached.credits;
}

export function canAfford(price) {
  return getCredits() >= price;
}

export function isWeaponOwned(id) {
  if (!cached) loadShop();
  return cached.ownedWeapons.includes(id);
}

// Every weapon the player permanently owns in the meta shop. The
// coordinator applies this at match start (see WIRING CONTRACT) so a
// shop-bought gun shows as OWNED in the in-match buy menu.
export function getUnlockedWeapons() {
  if (!cached) loadShop();
  return [...cached.ownedWeapons];
}
export const getOwnedWeapons = getUnlockedWeapons;

export function buyWeapon(id) {
  if (!cached) loadShop();
  const def = SHOP_WEAPONS.find((w) => w.id === id);
  if (!def) return { ok: false, reason: `Unknown weapon: ${id}` };
  if (cached.ownedWeapons.includes(id)) {
    return { ok: false, reason: `${def.name} is already owned.` };
  }
  if (cached.credits < def.price) {
    return { ok: false, reason: `Not enough Credits — ${def.name} costs ${def.price.toLocaleString('en-US')} CR, you have ${cached.credits.toLocaleString('en-US')} CR.` };
  }
  cached.credits -= def.price;
  cached.ownedWeapons.push(id);
  // First primary bought: it becomes the loadout pick at once, so the
  // strip shows it in loadout without a further click. Never overrides
  // an existing pick ('none' included).
  if (PRIMARY_LOADOUT_IDS.includes(id) && cached.loadout.primary === null) {
    cached.loadout.primary = id;
  }
  save();
  return { ok: true, credits: cached.credits, weaponId: id };
}

export function isSkinOwned(weaponId, skinId) {
  if (!cached) loadShop();
  return (cached.ownedSkins[weaponId] || []).includes(skinId);
}

export function getOwnedSkins(weaponId) {
  if (!cached) loadShop();
  return [...(cached.ownedSkins[weaponId] || [])];
}

export function getEquippedSkin(weaponId) {
  if (!cached) loadShop();
  return cached.equippedSkins[weaponId] || 'default';
}

export function buySkin(weaponId, skinId) {
  if (!cached) loadShop();
  const list = SHOP_SKINS[weaponId];
  if (!list) return { ok: false, reason: `No skins for weapon: ${weaponId}` };
  const skin = list.find((s) => s.id === skinId);
  if (!skin) return { ok: false, reason: `Unknown skin: ${skinId}` };
  if ((cached.ownedSkins[weaponId] || []).includes(skinId)) {
    return { ok: false, reason: `${skin.name} is already owned.` };
  }
  if (cached.credits < skin.price) {
    return { ok: false, reason: `Not enough Credits — ${skin.name} costs ${skin.price.toLocaleString('en-US')} CR, you have ${cached.credits.toLocaleString('en-US')} CR.` };
  }
  cached.credits -= skin.price;
  cached.ownedSkins[weaponId].push(skinId);
  cached.equippedSkins[weaponId] = skinId; // buying equips it at once
  save();
  return { ok: true, credits: cached.credits, weaponId, skinId };
}

// Equip an owned skin (or 'default' for the factory finish). Returns
// false when the skin is not owned. The in-game recolour itself is
// applySkin() in weapons.js, called by the coordinator — see WIRING
// CONTRACT.
export function equipSkin(weaponId, skinId) {
  if (!cached) loadShop();
  if (skinId !== 'default' && !isSkinOwned(weaponId, skinId)) return false;
  if (!SHOP_SKINS[weaponId] && skinId !== 'default') return false;
  cached.equippedSkins[weaponId] = skinId;
  save();
  return true;
}

// --- Outfits -------------------------------------------------------------
export function isOutfitOwned(id) {
  if (!cached) loadShop();
  return cached.ownedOutfits.includes(id);
}

export function getOwnedOutfits() {
  if (!cached) loadShop();
  return [...cached.ownedOutfits];
}

export function getEquippedOutfit() {
  if (!cached) loadShop();
  return cached.equippedOutfit || 'depot-standard';
}

// Buying an outfit equips it at once (same pattern as skins).
export function buyOutfit(id) {
  if (!cached) loadShop();
  const def = SHOP_OUTFITS.find((o) => o.id === id);
  if (!def) return { ok: false, reason: `Unknown outfit: ${id}` };
  if (cached.ownedOutfits.includes(id)) {
    return { ok: false, reason: `${def.name} is already owned.` };
  }
  if (cached.credits < def.price) {
    return { ok: false, reason: `Not enough Credits — ${def.name} costs ${def.price} CR, you have ${cached.credits} CR.` };
  }
  cached.credits -= def.price;
  cached.ownedOutfits.push(id);
  cached.equippedOutfit = id; // buying equips it at once
  save();
  return { ok: true, credits: cached.credits, outfitId: id };
}

// Equip an owned outfit (or 'depot-standard', the free default).
// Returns false when the outfit is not owned.
export function equipOutfit(id) {
  if (!cached) loadShop();
  if (id !== 'depot-standard' && !cached.ownedOutfits.includes(id)) return false;
  cached.equippedOutfit = id;
  save();
  return true;
}

// Debug/test hook: wipe the shop back to a fresh profile.
export function resetShop() {
  cached = defaultState();
  save();
  return getShopState();
}

// ---------------------------------------------------------------------------
// WIRING CONTRACT (coordinator: main.js / rounds.js / combat.js / weapons.js)
// This file owns the shop data + persistence + UI (menu.js). The lines
// below are the ONLY integration the coordinator must add; nothing here
// is wired by this file itself.
//
// 1. EARNING — main.js step() event drain (the ONE feedback path) +
//    rounds.js endRound / endMatch. Call earnCredits(amount, reason):
//      a. KILL: combat.js damage() already pays $250 and pushes the
//         'hit' event with { kill: true } when shooter.id === 'you'.
//         In main.js step(), in the `ev.kind === 'hit'` branch, when
//         ev.data.kill is true: earnCredits(EARN.kill, 'kill').
//      b. ROUND WIN: rounds.js endRound(state, winner, reason) — at its
//         end (after the economy payout), if winner === 'B':
//         earnCredits(EARN.roundWin, 'round-win'); else
//         earnCredits(EARN.roundLoss, 'round-loss'). endRound is also
//         called for Domination/Frontline/TDM-adjacent rounds, so this
//         covers every round-based mode; TDM has no rounds (no payout).
//      c. MATCH WIN: rounds.js endRound() sets state.matchOver, and
//         endMatch() ends TDM/Domination/Frontline matches. In BOTH,
//         right where state.matchWinner is assigned, if it is 'B':
//         earnCredits(EARN.matchWin, 'match-win'); else if not null:
//         earnCredits(EARN.matchLoss, 'match-loss'). (Draw: no payout.)
//    Import earnCredits + EARN from './shop.js' in rounds.js / main.js.
//    NEVER call earnCredits from a render path or the lobby — only from
//    the three game events above, or Credits are farmed by reloading.
//
// 2. SMG — weapons.js (3 edits, all in that file):
//      a. WEAPONS: add `smg: { ...SMG_DEF }` — import SMG_DEF from
//         './shop.js' and spread it in, or copy the literal. Its
//         in-match price is SMG_DEF.price = $1,400 (cheaper than the
//         rifle's $2,900). Add 'smg' to PRIMARY_IDS so ownedPrimaries()
//         / togglePrimary() / primaryForSlot() treat it as a primary:
//         PRIMARY_IDS = ['rifle', 'sniper', 'smg'] — key 2 then CYCLES
//         through ALL owned primaries (rifle -> sniper -> smg -> rifle),
//         not just two. togglePrimary() already cycles an N-length list,
//         so no logic change is needed beyond the array.
//      b. VIEWMODEL: in createWeapons(), after the rifle block, add
//         `models.smg = buildSmgViewmodel();` (the builder lives in
//         weapons.js now, next to the other viewmodels) and include it
//         in the `for (const m of Object.values(models))` positioning
//         loop — that loop already covers every models entry, so no
//         extra positioning is needed. The builder sets the same base
//         pose (0.28, -0.26, -0.5).
//      c. BUY MENU: hud.js renderBuy() rows are hardcoded; the
//         coordinator adds an SMG row there (key '6' is free — buy keys
//         are 1-5 today, so use '6' for the SMG) and rounds.js buyItem()
//         already handles any WEAPONS entry generically (the `if (!def)`
//         guard + owned/money check), so buyItem(state, 'smg') works
//         with NO edit once WEAPONS.smg exists. main.js buy keys add
//         ['Digit6', 'smg']. startReload()/finishReload() already read
//         WEAPONS[state.player.weapon] generically — the SMG reloads
//         with no edit. startRound()/reviveAll()/respawnFighter() refill
//         only rifle/sniper by id; add the same two lines for smg
//         (mag 28 / reserve 84) in each of those three places, and
//         extend the `p.weapon = ... owned ? ...` fallback chain with
//         the SMG (after rifle, before sniper — or after sniper; the
//         order only decides the default equip).
//
// 3. MATCH-START UNLOCKS — main.js boot, right after
//    ensureLoadout(state):
//         import { getUnlockedWeapons } from './shop.js';
//         for (const id of getUnlockedWeapons()) {
//           if (state.player.weapons[id]) {
//             state.player.weapons[id].owned = true;
//             state.player.weapons[id].mag = WEAPONS[id].mag;
//             state.player.weapons[id].reserve = WEAPONS[id].reserve;
//           }
//         }
//    That is the whole hook: a shop-bought gun then shows as OWNED in
//    the in-match buy menu (hud.renderBuy reads state.player.weapons.*
//    .owned via main.js render()) and can be bought/equipped for $0
//    in-match — it is already owned, so buyItem() returns false on the
//    owned check and the row renders OWNED. NOTE: this grants the gun
//    for the match WITHOUT charging in-match $ (the player already paid
//    Credits in the lobby). Do NOT also charge $ in buyItem for it.
//    TDM startRound() force-grants the rifle regardless; leave that.
//
// 4. SKINS IN-GAME — main.js boot, right after createWeapons(camera):
//         import { applyEquippedSkins } from './weapons.js';
//         applyEquippedSkins(weapons.models);
//    And after every weapons.equip(id) that changes the visible gun
//    (switchWeapon + the equip calls in doFire/buy paths), the equipped
//    skin for that gun must be (re-)applied — cheapest correct place:
//    inside switchWeapon(), after weapons.equip(id):
//         applySkin(id, getEquippedSkin(id), weapons.models);
//    (applySkin is idempotent and cheap: materials are cloned once, so
//    re-applying costs one traverse.) The lobby equip button only writes
//    localStorage; the game reads it at boot + on equip, so a skin
//    bought/equipped in the lobby shows in the very next match.
//    The scope lens, brass and knife blade are never recoloured.
