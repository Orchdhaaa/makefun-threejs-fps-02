// hud.js — DOM HUD + overlays + buy menu. Push-only: main.js and rounds.js
// push numbers in; hud.js never reads `state` directly and never touches
// the sim. Values are cached and DOM writes skipped when unchanged.
// Every element in DESIGN §7 is here.
//
// 5-SLOT LOADOUT (slots 1-5): pistol / primary / knife / frag / smoke.
// The buy menu lists all five slots (primary expanded into its two guns:
// rifle + sniper — the buy keys 1-5 buy pistol/rifle/sniper/frag/smoke,
// while in-game keys 1-5 select slots). The loadout strip is created by
// createHud() itself (index.html has no slot element — hud.js appends a
// #loadout-strip div with inline styles) and shows the current slot plus
// frag/smoke counts; main.js calls hud.setLoadout() once per frame.
// CONTROLS HINT: hud.js also renders the persistent in-game controls line
// (#controls-hint, created by createHud below) — the exact user-specified
// scheme: WASD move, mouse aim, click fire, RIGHT MOUSE scope,
// LEFT SHIFT sprint, Z crouch (hold), R reload, E plant/defuse, B buy,
// 1-5 switch, M mute, H home, Esc pause. Never Ctrl/C for crouch, never
// Shift as slow-walk. (The start/pause overlay text lives in main.js
// showStart() — coordinator-owned — and still lists the old scheme; see
// the WIRING note at the bottom of weapons.js.)
import { WEAPONS, GRENADE_PRICE, SMOKE_PRICE, KNIFE_PRICE } from './weapons.js';
import { ECONOMY } from './rounds.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    health: $('health-num'), healthBar: $('health-fill'), ammo: $('ammo-num'),
    money: $('money'), timer: $('timer'), score: $('score'),
    alive: $('alive'), bomb: $('bomb'), bombArrow: $('bomb-arrow'),
    modeInfo: $('mode-info'),
    killfeed: $('killfeed'), hitmarker: $('hitmarker'),
    dmgLayer: $('dmg-layer'), dmgTotalNum: $('dmg-total-num'),
    crosshair: $('crosshair'), damageDir: $('damage-dir'),
    channel: $('channel'), banner: $('banner'), spectate: $('spectate'),
    buyMenu: $('buy-menu'), overlay: $('overlay'),
    overlayTitle: $('overlay-title'), overlayBody: $('overlay-body'),
    overlayHint: $('overlay-hint'), deathBanner: $('death-banner'),
    scope: $('scope'), weaponPopup: $('weapon-popup'),
    holdoverPip: $('holdover-pip'), scopePip: $('scope-pip'),
  };
  const last = {};
  let weaponTimer = 0;   // hide timer for the weapon-switch popup
  let hitTimer = 0;      // hide timer for the hitmarker
  let damageTotal = 0;   // running damage dealt (see addDamage/setDamageTotal)
  // Loadout strip (current slot + frag/smoke counts). index.html has no
  // element for it, so hud.js creates one: bottom-right, above the money
  // readout, same monospace look as the rest of the HUD. Inline styles
  // only — no index.html / CSS change needed.
  let loadoutStrip = document.getElementById('loadout-strip');
  if (!loadoutStrip) {
    loadoutStrip = document.createElement('div');
    loadoutStrip.id = 'loadout-strip';
    loadoutStrip.className = 'hud';
    loadoutStrip.style.cssText = 'right:24px;bottom:140px;font-size:13px;letter-spacing:1px;text-align:right;';
    document.body.appendChild(loadoutStrip);
  }
  // Persistent in-game controls hint (bottom-centre, small muted text —
  // the health block is bottom-left, ammo bottom-right, so the centre is
  // free). Exact user-specified scheme; see the header comment. Created
  // here because index.html has no element for it.
  let controlsHint = document.getElementById('controls-hint');
  if (!controlsHint) {
    controlsHint = document.createElement('div');
    controlsHint.id = 'controls-hint';
    controlsHint.className = 'hud';
    controlsHint.style.cssText = 'left:50%;bottom:6px;transform:translateX(-50%);font-size:11px;letter-spacing:1px;color:#98a0a8;text-align:center;white-space:nowrap;max-width:96vw;overflow:hidden;text-overflow:ellipsis;';
    controlsHint.textContent = 'WASD MOVE · MOUSE AIM · CLICK FIRE · RIGHT MOUSE SCOPE · LEFT SHIFT SPRINT · Z CROUCH · R RELOAD · E PLANT/DEFUSE · B BUY · 1-5 SWITCH · M MUTE · H HOME · ESC PAUSE';
    document.body.appendChild(controlsHint);
  }
  const set = (key, el, text) => {
    if (!el || last[key] === text) return;
    last[key] = text;
    el.textContent = text;
  };
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  const hud = {
    els,
    setHealth(hp, dead) {
      set('hp', els.health, dead ? '0' : String(hp));
      document.getElementById('health').classList.toggle('low', hp < 30 && !dead);
      if (els.healthBar) els.healthBar.style.width = Math.max(0, hp) + '%';
    },
    setAmmo(mag, reserve, reloading, weaponName) {
      // Melee / throwables have no magazine: the knife shows a dash, a
      // held grenade shows its count. Guns keep the "mag / reserve" form.
      let text;
      if (weaponName === 'TALON K-1') text = '—';
      else if (weaponName === 'M-7 FRAG' || weaponName === 'M-9 SMOKE') text = '×1';
      else text = reloading ? 'RELOADING' : `${mag} / ${reserve}`;
      set('ammo', els.ammo, text);
      document.getElementById('ammo').classList.toggle('empty', mag === 0 && !reloading
        && weaponName !== 'TALON K-1' && weaponName !== 'M-7 FRAG' && weaponName !== 'M-9 SMOKE');
      set('ammoLabel', $('ammo-label'), weaponName || '');
    },
    // Loadout strip: current slot + grenade counts, updated once per
    // frame by main.js render(). slot: 1-5 (see weapons.js slotOfWeapon).
    // fragCount / smokeCount: 0 or 1 (1 max per round each). primaryName:
    // the concrete primary currently in slot 2 ('HERON AR-4' /
    // 'LONGSHOT DMR'), or '' when no primary is owned (shows 'PRIMARY —').
    // Empty consumable slots are dimmed; the current slot is amber.
    setLoadout(slot, fragCount, smokeCount, primaryName) {
      if (!loadoutStrip) return;
      const frag = fragCount || 0, smoke = smokeCount || 0;
      const chips = [
        { n: 1, label: 'SPARROW P9', on: true },
        { n: 2, label: primaryName || 'PRIMARY —', on: !!primaryName },
        { n: 3, label: 'TALON K-1', on: true },
        { n: 4, label: `M-7 FRAG ×${frag}`, on: frag > 0 },
        { n: 5, label: `M-9 SMOKE ×${smoke}`, on: smoke > 0 },
      ];
      const html = chips.map((c) => {
        const cur = c.n === slot;
        const col = cur ? '#f0a830' : c.on ? '#e9e6df' : '#5a6068';
        const weight = cur ? '700' : '400';
        return `<span style="color:${col};font-weight:${weight}">[${c.n}] ${c.label}</span>`;
      }).join(' &nbsp; ');
      if (last.loadout !== html) { last.loadout = html; loadoutStrip.innerHTML = html; }
    },
    // Show/hide the persistent controls hint line (visible by default).
    // The coordinator can hide it on the match-end screen if it ever
    // collides with the overlay. The hint text is set at creation and
    // re-written only when the mode changes (main.js applyControlsHint:
    // loadout modes drop the B BUY entry) — never per frame.
    showControlsHint(on) { show(controlsHint, !!on); },
    // Replace the controls hint text (mode-aware: see above).
    setControlsHint(text) {
      if (controlsHint) controlsHint.textContent = text;
    },
    setMoney(m) {
      set('money', els.money, '$' + m);
      els.money.classList.remove('flash');
      void els.money.offsetWidth;
      els.money.classList.add('flash');
    },
    setTimer(text, danger, bomb) {
      set('timer', els.timer, text);
      els.timer.classList.toggle('danger', !!danger);
      els.timer.classList.toggle('bomb', !!bomb);
    },
    setScore(b, w, round, maxRounds, roundLabel) {
      set('score', els.score, `BREAKERS ${b} — ${w} WARDENS`);
      // roundLabel overrides the round counter (Team Deathmatch has no
      // rounds — it shows "FIRST TO 20 KILLS" instead of "ROUND 1/11").
      set('round', $('round'), roundLabel || `ROUND ${round}/${maxRounds}`);
    },
    setModeInfo(text) {
      set('modeInfo', els.modeInfo, text || '');
      show(els.modeInfo, !!text);
    },
    setAlive(breakers, wardens, playerAlive) {
      // Five pips per team; the player's pip is a filled diamond.
      const row = (aliveList, cls, selfIdx) => aliveList.map((a, i) =>
        `<span class="pip ${cls}${a ? '' : ' dead'}${i === selfIdx ? ' self' : ''}"></span>`).join('');
      const html = row(breakers, 'b', 0) + '<span class="vs">vs</span>' + row(wardens, 'w', -1);
      if (last.aliveHtml !== html) { last.aliveHtml = html; els.alive.innerHTML = html; }
    },
    setBomb(text) {
      set('bomb', els.bomb, text || '');
      show(els.bomb, !!text);
    },
    setBombArrow(visible, angleDeg, dist) {
      show(els.bombArrow, visible);
      if (visible) {
        els.bombArrow.style.transform = `rotate(${angleDeg}deg)`;
        els.bombArrow.textContent = `➤ ${dist} m`;
      }
    },
    setKillfeed(entries) {
      const html = entries.map((e) =>
        `<div class="kf${e.head ? ' head' : ''}">${e.text}</div>`).join('');
      if (last.kf !== html) { last.kf = html; els.killfeed.innerHTML = html; }
    },
    hitmarker(kill, ms) {
      // Obvious feedback: bigger/brighter via CSS, stays up ~250 ms for a
      // hit and ~500 ms for a kill (was a 90 ms flash). A fresh hit resets
      // the hide timer so rapid hits never cut the marker short.
      clearTimeout(hitTimer);
      els.hitmarker.classList.toggle('kill', !!kill);
      els.hitmarker.style.opacity = '1';
      hitTimer = setTimeout(() => { els.hitmarker.style.opacity = '0'; },
        ms || (kill ? 500 : 250));
    },
    // Floating damage number near the crosshair: shows the damage amount,
    // rises and fades over ~0.9 s (CSS animation), then removes itself.
    // opts: { dx, dy } px offset from screen centre, { headshot, kill }.
    showDamageNumber(amount, opts) {
      if (!els.dmgLayer) return;
      const o = opts || {};
      const n = Math.max(0, Math.round(amount));
      const el = document.createElement('span');
      el.className = 'dmg-num' + (o.kill ? ' kill' : o.headshot ? ' head' : '');
      el.textContent = String(n);
      const dx = (o.dx ?? 0) + (Math.random() * 56 - 28);
      const dy = (o.dy ?? 0) + (Math.random() * 40 - 20);
      el.style.marginLeft = dx + 'px';
      el.style.marginTop = dy + 'px';
      els.dmgLayer.appendChild(el);
      setTimeout(() => el.remove(), 950);
    },
    // Persistent running total of damage the player has dealt. The
    // coordinator calls addDamage(amount) on every confirmed hit and
    // resetDamageTotal() at round start; setDamageTotal(n) sets it directly.
    addDamage(amount) {
      damageTotal += Math.max(0, Math.round(amount));
      set('dmgTotal', els.dmgTotalNum, String(damageTotal));
    },
    setDamageTotal(n) {
      damageTotal = Math.max(0, Math.round(n));
      set('dmgTotal', els.dmgTotalNum, String(damageTotal));
    },
    resetDamageTotal() { this.setDamageTotal(0); },
    getDamageTotal() { return damageTotal; },
    setCrosshair(gapPx, visible) {
      show(els.crosshair, visible);
      els.crosshair.style.setProperty('--gap', Math.round(gapPx) + 'px');
    },
    // Holdover pip (ballistics): one 3 px dot on the crosshair/scope
    // vertical line, marking where a centre-aimed bullet lands at the
    // measured range — "put the dot on what you want to hit." px is the
    // offset below centre, or null to hide. The same translateY is
    // written to both pips; whichever container (#crosshair / #scope) is
    // hidden hides its pip with it.
    setHoldover(px) {
      const v = (px === null || px === undefined || !Number.isFinite(px)) ? null : px;
      if (last.holdover === v) return;
      last.holdover = v;
      for (const el of [els.holdoverPip, els.scopePip]) {
        if (!el) continue;
        if (v === null) el.style.display = 'none';
        else {
          el.style.display = 'block';
          el.style.transform = `translate(-50%, -50%) translateY(${v.toFixed(1)}px)`;
        }
      }
    },
    // Sniper scope overlay (dark ring + crosshair); shown only while
    // aiming down sights with the sniper. The viewmodel is hidden then.
    // Sets display explicitly: the generic show() helper clears the
    // inline style, but #scope's CSS rule itself is display:none, so
    // clearing it would keep the overlay hidden.
    setScope(on) { if (els.scope) els.scope.style.display = on ? 'block' : 'none'; },
    // Brief weapon-name popup on switch (keys 1-5 or mouse wheel).
    showWeaponPopup(name) {
      if (!els.weaponPopup) return;
      els.weaponPopup.textContent = name;
      els.weaponPopup.style.opacity = '1';
      clearTimeout(weaponTimer);
      weaponTimer = setTimeout(() => { els.weaponPopup.style.opacity = '0'; }, 1200);
    },
    damageDir(angleDeg) {
      els.damageDir.style.transform = `rotate(${angleDeg}deg)`;
      els.damageDir.style.opacity = '1';
      setTimeout(() => { els.damageDir.style.opacity = '0'; }, 600);
    },
    setChannel(text, frac) {
      show(els.channel, !!text);
      if (text) {
        set('channel', $('channel-text'), text);
        els.channel.style.setProperty('--frac', frac.toFixed(2));
      }
    },
    setBanner(text) {
      set('banner', els.banner, text || '');
      show(els.banner, !!text);
    },
    setSpectate(text) {
      set('spectate', els.spectate, text || '');
      show(els.spectate, !!text);
    },
    setDeathBanner(text) {
      set('death', els.deathBanner, text || '');
      show(els.deathBanner, !!text);
    },
    // Buy menu: keyboard-only under pointer lock (§4.3). Rows are not clickable.
    // All five slots are listed; the primary slot expands into its three
    // guns (rifle [2], sniper [3], smg [6]) because each is bought separately,
    // while the knife row is always OWNED (free, $0 — no buy key, shown
    // as '–'). Buy keys 1-6: pistol / rifle / sniper / smg / frag / smoke.
    // `owned`: { pistol, rifle, sniper, knife, grenade, smoke } — knife
    // defaults to owned, smoke to "count > 0" when the caller passes a
    // count instead; missing keys are tolerated (old callers).
    renderBuy(money, owned, round) {
      const o = owned || {};
      const smokeOwned = o.smoke === true || o.smokeCount > 0;
      const rows = [
        { id: 'pistol', key: '1', name: WEAPONS.pistol.name, stat: WEAPONS.pistol.stat, price: 350, owned: !!o.pistol },
        { id: 'rifle', key: '2', name: WEAPONS.rifle.name, stat: WEAPONS.rifle.stat, price: 2900, owned: !!o.rifle },
        { id: 'sniper', key: '3', name: WEAPONS.sniper.name, stat: WEAPONS.sniper.stat, price: 4900, owned: !!o.sniper },
        { id: 'smg', key: '6', name: WEAPONS.smg.name, stat: WEAPONS.smg.stat, price: 1400, owned: !!o.smg },
        { id: 'knife', key: '–', name: WEAPONS.knife.name, stat: WEAPONS.knife.stat, price: KNIFE_PRICE, owned: true },
        { id: 'grenade', key: '4', name: 'M-7 FRAG', stat: '120 dmg — 6 m blast — 1 per round', price: GRENADE_PRICE, owned: !!o.grenade },
        { id: 'smoke', key: '5', name: 'M-9 SMOKE', stat: '12 s smoke — blocks sight — 1 per round', price: SMOKE_PRICE, owned: smokeOwned },
      ];
      const html = `<h2>BUY — ROUND ${round}</h2><div class="buy-money">$${money}</div>` +
        rows.map((r) => {
          const isOwned = r.owned;
          const afford = money >= r.price;
          const stateTxt = isOwned ? 'OWNED' : afford ? 'BUY' : 'CANNOT AFFORD';
          return `<div class="buy-row${isOwned ? ' owned' : ''}${!isOwned && !afford ? ' poor' : ''}">` +
            `<span class="buy-key">[${r.key}]</span> <b>${r.name}</b> <span class="buy-stat">${r.stat}</span>` +
            `<span class="buy-price">$${r.price}</span> <span class="buy-state">${stateTxt}</span></div>`;
        }).join('') +
        `<div class="buy-hint">Owned guns are yours — $0, no re-buy. Frag / smoke cost $ only when you did not bring one in your loadout. Knife equips free. Keys 1–6 buy while this menu is open. B closes. Firing is disabled.</div>`;
      if (last.buy !== html) { last.buy = html; els.buyMenu.innerHTML = html; }
      show(els.buyMenu, true);
    },
    hideBuy() { show(els.buyMenu, false); },
    showOverlay(title, body, hint) {
      els.overlayTitle.textContent = title;
      els.overlayBody.innerHTML = body;
      els.overlayHint.textContent = hint;
      show(els.overlay, true);
    },
    hideOverlay() { show(els.overlay, false); },
  };
  return hud;
}
