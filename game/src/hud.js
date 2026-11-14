// hud.js — DOM HUD + overlays + buy menu. Push-only: main.js and rounds.js
// push numbers in; hud.js never reads `state` directly and never touches
// the sim. Values are cached and DOM writes skipped when unchanged.
// Every element in DESIGN §7 is here.
import { WEAPONS, GRENADE_PRICE } from './weapons.js';
import { ECONOMY } from './rounds.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    health: $('health-num'), healthBar: $('health-fill'), ammo: $('ammo-num'),
    money: $('money'), timer: $('timer'), score: $('score'),
    alive: $('alive'), bomb: $('bomb'), bombArrow: $('bomb-arrow'),
    killfeed: $('killfeed'), hitmarker: $('hitmarker'),
    crosshair: $('crosshair'), damageDir: $('damage-dir'),
    channel: $('channel'), banner: $('banner'), spectate: $('spectate'),
    buyMenu: $('buy-menu'), overlay: $('overlay'),
    overlayTitle: $('overlay-title'), overlayBody: $('overlay-body'),
    overlayHint: $('overlay-hint'), deathBanner: $('death-banner'),
  };
  const last = {};
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
      set('ammo', els.ammo, reloading ? 'RELOADING' : `${mag} / ${reserve}`);
      document.getElementById('ammo').classList.toggle('empty', mag === 0 && !reloading);
      set('ammoLabel', $('ammo-label'), weaponName || '');
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
    setScore(b, w, round, maxRounds) {
      set('score', els.score, `BREAKERS ${b} — ${w} WARDENS`);
      set('round', $('round'), `ROUND ${round}/${maxRounds}`);
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
      els.hitmarker.classList.remove('kill');
      if (kill) els.hitmarker.classList.add('kill');
      els.hitmarker.style.opacity = '1';
      setTimeout(() => { els.hitmarker.style.opacity = '0'; }, ms || 90);
    },
    setCrosshair(gapPx, visible) {
      show(els.crosshair, visible);
      els.crosshair.style.setProperty('--gap', Math.round(gapPx) + 'px');
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
    renderBuy(money, owned, round) {
      const rows = [
        { id: 'pistol', key: '1', name: WEAPONS.pistol.name, stat: WEAPONS.pistol.stat, price: 350 },
        { id: 'rifle', key: '2', name: WEAPONS.rifle.name, stat: WEAPONS.rifle.stat, price: 2900 },
        { id: 'sniper', key: '3', name: WEAPONS.sniper.name, stat: WEAPONS.sniper.stat, price: 4900 },
        { id: 'grenade', key: '4', name: 'M-7 FRAG', stat: '120 dmg — 6 m blast — 1 per round', price: GRENADE_PRICE },
      ];
      const html = `<h2>BUY — ROUND ${round}</h2><div class="buy-money">$${money}</div>` +
        rows.map((r) => {
          const isOwned = owned[r.id];
          const afford = money >= r.price;
          const stateTxt = isOwned ? 'OWNED' : afford ? 'BUY' : 'CANNOT AFFORD';
          return `<div class="buy-row${isOwned ? ' owned' : ''}${!isOwned && !afford ? ' poor' : ''}">` +
            `<span class="buy-key">[${r.key}]</span> <b>${r.name}</b> <span class="buy-stat">${r.stat}</span>` +
            `<span class="buy-price">$${r.price}</span> <span class="buy-state">${stateTxt}</span></div>`;
        }).join('') +
        `<div class="buy-hint">Keys 1–4 buy while this menu is open. B closes. Firing is disabled.</div>`;
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
