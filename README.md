# FERROLINE — three.js tactical FPS

A round-based tactical first-person shooter built with three.js: two teams,
short rounds, bots, a buy economy, and bullet-drop ballistics.

![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)
![rank](https://make.fun/badge/threejs-fps-02/Orchdhaaa/makefun-threejs-fps-02/rank.svg)
![reward](https://make.fun/badge/threejs-fps-02/Orchdhaaa/makefun-threejs-fps-02/reward.svg)
Built for the make.fun bounty: https://make.fun/bounty/threejs-fps-02

## Modes

- Bomb Mission — plant or defuse, rounds decide the match.
- Team Deathmatch — first team to the kill target wins.
- Domination — hold sectors A, B and C to score.
- Frontline — push through the enemy base.
- Attack and Defend — take every sector in order.

## Maps

Depot9, Dustline and Foundry — each with its own lanes, cover and sightlines.

## Combat

Rifles, pistols, snipers and grenades with real projectile ballistics:
bullets drop over distance, spread grows while moving, and headshots pay off.
Buy weapons and skins between rounds with match credits.
## How to run locally

```sh
cd game
python3 -m http.server 8000
```

Then open http://127.0.0.1:8000/index.html in a desktop browser with WebGL 2.
