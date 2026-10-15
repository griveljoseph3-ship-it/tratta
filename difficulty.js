/**
 * Tratta — difficulty.js (traffico, danni, near-miss, difficoltà)
 *
 * API (ES module):
 *   init(ctx)            crea pool traffico, HUD italiano (barra salute, bonus, livello).
 *   update(dt, ctx)      da chiamare ogni frame (dt in secondi).
 *   setDifficulty(n)     0=Facile 1=Normale 2=Difficile 3=Leggenda (accetta anche il nome).
 *   setMissionLevel(m)   moltiplicatore per missione (1 = base, +0.15 per livello).
 *   reset(ctx)           svuota traffico, salute piena, timer a zero.
 *   getState()           { difficulty, preset, elapsed, intensity, health, nearMissCombo, score }
 *   PRESETS              tabella dei preset.
 *
 * ctx = { THREE, scene, camera, player:{mesh,speed,lane,x,z,health}, road, ui, onEvent(name,data) }
 *   road (opzionale): { lanes:[x,...], laneWidth, forward:-1|1 }  default 4 corsie, avanti = -z.
 *   player.speed in unità/s; player.x/z se assenti si usa player.mesh.position.
 *   ui (opzionale): elemento DOM in cui montare l'HUD (default document.body).
 * Eventi onEvent: 'collision' {damage,health,vehicle}, 'nearMiss' {bonus,combo},
 *   'playerDestroyed' {}, 'difficultyChanged' {index,name}, 'intensity' {level}.
 * Il modulo scrive player.health (0..100) ma non ferma il gioco: lo decide chi integra.
 */

import { rand } from './rng.js';
export const PRESETS = [
  { name: 'Facile',    density: 0.6, speedMul: 0.85, aiAggro: 0.3, laneChange: 0.15, damageMul: 0.6, ramp: 0.004, maxCars: 14 },
  { name: 'Normale',   density: 1.0, speedMul: 1.0,  aiAggro: 0.5, laneChange: 0.3,  damageMul: 1.0, ramp: 0.007, maxCars: 22 },
  { name: 'Difficile', density: 1.45, speedMul: 1.15, aiAggro: 0.75, laneChange: 0.5, damageMul: 1.4, ramp: 0.011, maxCars: 30 },
  { name: 'Leggenda',  density: 2.0, speedMul: 1.3,  aiAggro: 1.0, laneChange: 0.8,  damageMul: 2.0, ramp: 0.016, maxCars: 40 },
];

const S = {
  diff: 1, mission: 1, elapsed: 0, intensity: 1, vehicles: [], spawnT: 0,
  combo: 0, comboT: 0, score: 0, invuln: 0, hud: null, destroyed: false, lastLvl: 1, ctx: null,
};

export function setDifficulty(n) {
  if (typeof n === 'string') n = PRESETS.findIndex(p => p.name.toLowerCase() === n.toLowerCase());
  S.diff = Math.max(0, Math.min(3, n | 0));
  S.ctx?.onEvent?.('difficultyChanged', { index: S.diff, name: PRESETS[S.diff].name });
  renderHud();
}
export function setMissionLevel(m) { S.mission = Math.max(1, +m || 1); }
export function getState() {
  return { difficulty: S.diff, preset: PRESETS[S.diff].name, elapsed: S.elapsed, intensity: S.intensity,
    health: S.ctx?.player?.health ?? 100, nearMissCombo: S.combo, score: Math.round(S.score) };
}

const lanesOf = ctx => ctx.road?.lanes || [-5.25, -1.75, 1.75, 5.25];
const fwd = ctx => ctx.road?.forward ?? -1;
const _pp = { x: 0, z: 0 }; const pPos = p => { _pp.x = p.x ?? p.mesh?.position.x ?? 0; _pp.z = p.z ?? p.mesh?.position.z ?? 0; return _pp; };

function makeVehicle(THREE, truck) {
  const g = new THREE.Group();
  const colors = [0xb0122b, 0x1d4ed8, 0xe5e7eb, 0x111827, 0x9ca3af, 0x0f766e, 0xf59e0b];
  const L = truck ? 9 : 4.3, W = truck ? 2.5 : 1.85, H = truck ? 3.2 : 1.35;
  const paint = new THREE.MeshStandardMaterial({ color: colors[(rand() * colors.length) | 0], metalness: 0.6, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.55, L), paint);
  const shared = globalThis.tratta?.makeCar?.(truck ? 'truck' : 'traffic');
  if (shared) g.add(shared);
  body.position.y = H * 0.35; body.castShadow = true; if (!shared) g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, H * 0.45, truck ? 2.2 : L * 0.5),
    new THREE.MeshStandardMaterial({ color: truck ? 0xdddddd : 0x111111, metalness: 0.9, roughness: 0.1 }));
  cab.position.set(0, H * 0.82, truck ? -L / 2 + 1.2 : 0.2); if (!shared) g.add(cab);
  if (truck) { const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, L - 2.6), new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.8 }));
    box.position.set(0, H * 0.6, 1.2); if (!shared) g.add(box); }
  const mk = c => new THREE.MeshBasicMaterial({ color: c });
  const lights = {};
  for (const s of [-1, 1]) {
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.05), mk(0x440000));
    brake.position.set(s * (W / 2 - 0.25), shared ? (truck ? 0.9 : 0.75) : H * 0.45, L / 2 + 0.03); g.add(brake);
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.06), mk(0x442200));
    ind.position.set(s * (W / 2 - 0.05), shared ? (truck ? 0.9 : 0.75) : H * 0.45, L / 2 + 0.04); g.add(ind);

    lights[s < 0 ? 'brakeL' : 'brakeR'] = brake; lights[s < 0 ? 'indL' : 'indR'] = ind;
  }
  return { mesh: g, lights, L, W, truck };
}

export function init(ctx) {
  S.ctx = ctx; reset(ctx); buildHud(ctx);
}
export function reset(ctx = S.ctx) {
  for (const v of S.vehicles) { ctx?.scene?.remove(v.mesh); POOL.push(v); }
  S.vehicles = []; S.seeded = false; newRunProfile(); S.elapsed = 0; S.combo = 0; S.score = 0; S.destroyed = false; S.invuln = 0; S.lastLvl = 1;
  if (ctx?.player) ctx.player.health = 100;
  renderHud();
}

// Profilo della corsa: cambia ogni partita (seme in rng.js) -> ondate di traffico, mix di veicoli, eventi.
const RUN = { phase: 0, waveLen: 30, truckP: .2, eventT: 20, ev: null };
function newRunProfile() { Object.assign(RUN, { phase: rand() * 6.28, waveLen: 18 + rand() * 30, truckP: .1 + rand() * .2, eventT: 12 + rand() * 18, ev: null }); }
function addVehicle(ctx, P, lane, rel, speed, truck) {
  const { THREE, scene, player } = ctx; const lanes = lanesOf(ctx); const pp = pPos(player);
  const z = pp.z + fwd(ctx) * rel;
  if (S.vehicles.some(o => (o.lane === lane || o.targetLane === lane) && Math.abs(o.mesh.position.z - z) < 16)) return null;
  // pool: niente nuove mesh/materiali durante la guida (evita GC e compilazioni shader a metà corsa)
  const pi = POOL.findIndex(o => o.truck === truck); const v = pi >= 0 ? POOL.splice(pi, 1)[0] : makeVehicle(THREE, truck); v.mesh.rotation.set(0, 0, 0);
  Object.assign(v, { lane, targetLane: lane, x: lanes[lane], speed, cruise: speed, signal: 0, signalT: 0,
    blink: 0, nearDone: false, hit: false, think: rand() * 2, x0: 0 });
  v.mesh.position.set(v.x, 0, z); v.mesh.rotation.y = fwd(ctx) < 0 ? 0 : Math.PI;
  scene.add(v.mesh); S.vehicles.push(v); return v;
}
function spawn(ctx, P, rel) {
  const lanes = lanesOf(ctx); const truck = rand() < RUN.truckP;
  const lane = truck ? (rand() < .7 ? 0 : 1) : (rand() * lanes.length) | 0; // camion a destra... cioè corsie lente
  const pS = ctx.player.speed || 20;
  if (rel == null) rel = rand() < 0.88 ? 90 + rand() * 130 : -(35 + rand() * 25);
  // civili più lenti del giocatore: li raggiungi e li sorpassi (corsie esterne più veloci)
  const laneMul = 0.8 + lane * 0.1;
  const base = (truck ? 15 + rand() * 4 : 17 + rand() * 9) * laneMul * P.speedMul;
  return addVehicle(ctx, P, lane, rel, rel < 0 ? Math.max(base, pS * 1.05) : base, truck);
}
function spawnEvent(ctx, P) {
  const lanes = lanesOf(ctx), n = lanes.length, type = ['convoy', 'jam', 'speeder', 'convoy', 'jam'][(rand() * 5) | 0];
  const rel = 170 + rand() * 40;
  if (type === 'convoy') { const gap = (rand() * n) | 0; for (let l = 0; l < n; l++) if (l !== gap) addVehicle(ctx, P, l, rel + rand() * 6, 15 * P.speedMul, l < 2 && rand() < .6); flash('Camion in carovana più avanti!', '#ffd23f'); }
  else if (type === 'jam') { for (let k = 0; k < 6; k++) addVehicle(ctx, P, (rand() * n) | 0, rel + k * 9, 9 + rand() * 4, false); flash('Coda più avanti: attento!', '#ffd23f'); }
  else { const v = addVehicle(ctx, P, n - 1, -45, (ctx.player.speed || 20) + 12, false); if (v) v.cruise = v.speed; }
}
const VPOOL = [], POOL = [];
export function prewarm(ctx, n = 24) { for (let i = 0; i < n; i++) POOL.push(makeVehicle(ctx.THREE, i % 5 === 0)); return POOL.map(v => v.mesh); }
 export function getVehicles() { VPOOL.length = S.vehicles.length; S.vehicles.forEach((v, i) => { const o = VPOOL[i] || (VPOOL[i] = {}); o.x = v.x; o.z = v.mesh.position.z; o.speed = v.speed; o.L = v.L; }); return VPOOL; }

const _gapR = { gap: 0, who: null }, _plObs = { speed: 0 };
function aheadGap(v, lane, ctx) {
  const f = fwd(ctx); let best = Infinity, who = null; const R = _gapR;
  for (const o of S.vehicles) if (o !== v && (o.lane === lane || o.targetLane === lane)) {
    const d = (o.mesh.position.z - v.mesh.position.z) * f;
    if (d > 0 && d < best) { best = d; who = o; }
  }
  const pl = ctx.player; // anche il giocatore è un ostacolo: i civili non ti tamponano
  if (pl && Math.abs((pl.x ?? 0) - lanesOf(ctx)[lane]) < 2.4) { const d = ((pl.z ?? 0) - v.mesh.position.z) * f; if (d > 0 && d < best) { best = d; _plObs.speed = pl.speed || 0; who = _plObs; } }
  R.gap = best; R.who = who; return R;
}

export function update(dt, ctx = S.ctx) {
  if (!ctx?.player || !dt) return; S.ctx = ctx; dt = Math.min(dt, 0.1);
  const P = PRESETS[S.diff]; const player = ctx.player; const pp = pPos(player); const f = fwd(ctx); const lanes = lanesOf(ctx);
  S.elapsed += dt;
  S.intensity = (1 + S.elapsed * P.ramp) * (1 + (S.mission - 1) * 0.15);
  const lvl = Math.floor(S.intensity * 4) / 4;
  if (lvl > S.lastLvl) { S.lastLvl = lvl; ctx.onEvent?.('intensity', { level: lvl }); flash(`Traffico in aumento! x${lvl.toFixed(2)}`); }

  // spawn
  const maxCars = Math.round(P.maxCars * Math.min(2, S.intensity));
  const wave = 0.65 + 0.55 * Math.sin(S.elapsed / RUN.waveLen * 6.28 + RUN.phase);
  S.spawnT -= dt * P.density * S.intensity * wave * (0.6 + Math.min(1.5, (player.speed || 0) / 40));
  if (S.spawnT <= 0 && S.vehicles.length < maxCars) { spawn(ctx, P); S.spawnT = 0.7 + rand() * 0.8; }
  RUN.eventT -= dt; if (RUN.eventT <= 0) { RUN.eventT = 22 + rand() * 25; if (!ctx.state?.cinema) spawnEvent(ctx, P); }
  if (!S.seeded) { S.seeded = true; for (let k = 0; k < 9; k++) spawn(ctx, P, 25 + k * 22 + rand() * 10); }

  const pW = 1.9, pL = 4.4;
  for (let i = S.vehicles.length - 1; i >= 0; i--) {
    const v = S.vehicles[i]; const m = v.mesh;
    // AI: cruise / brake behind slower car / lane change with indicator
    const { gap, who } = aheadGap(v, v.lane, ctx);
    let want = v.cruise * Math.min(1.6, S.intensity * 0.5 + 0.5);
    const braking = gap < 25 && who && who.speed < v.speed;
    if (braking) want = Math.min(want, who.speed - (gap < 12 ? 6 : 0));
    if (ctx.road.curveLimit) want = Math.min(want, ctx.road.curveLimit(-m.position.z)); // rallenta prima di curve e tornanti
    v.speed += Math.sign(want - v.speed) * Math.min(Math.abs(want - v.speed), (braking ? 14 : 5) * dt);
    v.think -= dt;
    if (v.signal === 0 && v.think <= 0) {
      v.think = 1.5 + rand() * 3;
      if ((braking || rand() < P.laneChange * 0.4) && !v.truck || rand() < P.laneChange * 0.15) {
        const dir = rand() < 0.5 ? -1 : 1; const nl = v.lane + dir;
        if (nl >= 0 && nl < lanes.length && aheadGap(v, nl, ctx).gap > 18 &&
            !S.vehicles.some(o => o !== v && o.lane === nl && Math.abs(o.mesh.position.z - m.position.z) < 10)) {
          v.signal = dir; v.signalT = 1.4 - P.aiAggro * 0.9; // leggenda: preavviso più corto
        }
      }
    }
    if (v.signal) { v.signalT -= dt; if (v.signalT <= 0 && v.targetLane === v.lane) v.targetLane = v.lane + v.signal; }
    const tx = lanes[v.targetLane];
    v.x += Math.sign(tx - v.x) * Math.min(Math.abs(tx - v.x), (2 + P.aiAggro * 2.5) * dt);
    if (v.targetLane !== v.lane && Math.abs(tx - v.x) < 0.05) { v.lane = v.targetLane; v.signal = 0; }
    m.position.x = v.x; m.position.z += f * v.speed * dt;
    m.rotation.z = 0; m.rotation.y = (f < 0 ? 0 : Math.PI) + (tx - v.x) * 0.04 * -f;
    // lights
    v.blink += dt; const on = (v.blink % 0.5) < 0.25;
    v.lights.brakeL.material.color.setHex(braking ? 0xff1a1a : 0x440000);
    v.lights.brakeR.material.color.setHex(braking ? 0xff1a1a : 0x440000);
    v.lights.indL.material.color.setHex(v.signal < 0 && on ? 0xffa500 : 0x442200);
    v.lights.indR.material.color.setHex(v.signal > 0 && on ? 0xffa500 : 0x442200);

    // collision / near miss vs player
    const dx = Math.abs(m.position.x - pp.x), dz = Math.abs(m.position.z - pp.z);
    const ox = (pW + v.W) / 2, oz = (pL + v.L) / 2;
    if (dx < ox && dz < oz && S.invuln <= 0 && !v.hit) {
      v.hit = true; S.invuln = 0.8;
      const rel = Math.abs((player.speed || 0) - v.speed);
      const dmg = Math.round(Math.min(60, (8 + rel * 0.9) * P.damageMul * (v.truck ? 1.6 : 1)));
      player.health = Math.max(0, (player.health ?? 100) - dmg);
      player.speed = (player.speed || 0) * 0.55; v.speed *= 0.7; S.combo = 0;
      ctx.onEvent?.('collision', { damage: dmg, health: player.health, vehicle: v });
      flash(`Incidente! -${dmg} salute`, '#ff4040');
      if (player.health <= 0 && !S.destroyed) { S.destroyed = true; ctx.onEvent?.('playerDestroyed', {}); flash('Auto distrutta!', '#ff4040'); }
    } else if (!v.nearDone && !v.hit && dz < oz && dx < ox + 1.3 && (player.speed || 0) > 20) {
      v.nearDone = true; S.combo++; S.comboT = 3;
      const bonus = Math.round(100 * S.combo * (1 + S.diff * 0.5));
      S.score += bonus; ctx.onEvent?.('nearMiss', { bonus, combo: S.combo });
      flash(`Sorpasso al limite! +${bonus}${S.combo > 1 ? `  combo x${S.combo}` : ''}`, '#ffd23f');
    }
    const rel = (m.position.z - pp.z) * f;
    if (rel < -60 || rel > 400) { ctx.scene.remove(m); POOL.push(v); S.vehicles.splice(i, 1); }
  }
  S.invuln -= dt; S.comboT -= dt; if (S.comboT <= 0) S.combo = 0;
  S.score += (player.speed || 0) * dt * 0.1;
  renderHud();
}

// ---------- HUD ----------
function buildHud(ctx) {
  if (typeof document === 'undefined') return;
  S.hud?.root.remove();
  const root = document.createElement('div'); root.id = 'diffHud';
  root.style.cssText = 'position:fixed;bottom:200px;left:18px;z-index:20;font:600 14px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none';
  root.innerHTML = `<div>Salute</div><div style="width:200px;height:12px;background:#0008;border:1px solid #fff6;border-radius:6px;overflow:hidden">
    <div data-h style="height:100%;width:100%;background:#3ddc84;transition:width .2s"></div></div>
    <div data-i style="margin-top:6px"></div><div data-f style="margin-top:8px;font-size:18px"></div>`;
  (ctx.ui instanceof HTMLElement ? ctx.ui : document.body).appendChild(root);
  S.hud = { root, h: root.querySelector('[data-h]'), i: root.querySelector('[data-i]'), f: root.querySelector('[data-f]'), ft: 0 };
}
let _hudLast = 0;
function renderHud(force) {
  const _now = performance.now(); if (!force && _now - _hudLast < 100) return; _hudLast = _now; // HUD a 10 Hz
  const H = S.hud; if (!H) return; const hp = S.ctx?.player?.health ?? 100;
  H.h.style.width = hp + '%'; H.h.style.background = hp > 60 ? '#3ddc84' : hp > 30 ? '#ffb020' : '#ff4040';
  H.i.textContent = `Difficoltà: ${PRESETS[S.diff].name} · Traffico x${S.intensity.toFixed(2)} · Punti ${Math.round(S.score)}`;
}
function flash(txt, color = '#fff') {
  const H = S.hud; if (!H) return; H.f.textContent = txt; H.f.style.color = color;
  clearTimeout(H.ft); H.ft = setTimeout(() => { H.f.textContent = ''; }, 1600);
}
