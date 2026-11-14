// palette.js — colours only. One source of truth for the depot-at-dawn
// look; no other colour literal may appear in game code or CSS except
// shades produced by lighting on these values.
export const PALETTE = {
  canvas: 0x14161a,      // sky / fog / page background
  surface: 0x1e2228,     // walls, floor panels, HUD panels
  hairline: 0x2c323a,    // wagons, trim, weapon grip
  ink: 0xe9e6df,         // HUD text, bot torso, weapon body
  muted: 0x98a0a8,       // secondary HUD text, fill light
  accent: 0xf0a830,      // Breaker amber, Site A, muzzle flash, hitmarker
  wagonTeal: 0x2e6f6a,   // freight wagons, Site B
  wagonRust: 0xb4552d,   // rust wagons, hazard striping
  defenderBlue: 0x4da3ff,// Warden team, defender spawn marking
  bombYellow: 0xffcf3d,  // bomb, plant zone pulse, bomb timer
  dangerRed: 0xe5484d,   // damage direction, low health, round-loss text
  groundConcrete: 0x3a3f45, // depot floor, ballast
};

export const CSS = {
  canvas: '#14161a', surface: '#1e2228', hairline: '#2c323a',
  ink: '#e9e6df', muted: '#98a0a8', accent: '#f0a830',
  wagonTeal: '#2e6f6a', wagonRust: '#b4552d', defenderBlue: '#4da3ff',
  bombYellow: '#ffcf3d', dangerRed: '#e5484d', groundConcrete: '#3a3f45',
};
