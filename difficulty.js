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
const pPos = p => ({ x: p.x ?? p.mesh?.position.x ?? 0, z: p.z ?? p.mesh?.position.z ?? 0 });

function makeVehicle(THREE, truck) {
  const g = new THREE.Group();
  const colors = [0xb0122b, 0x1d4ed8, 0xe5e7eb, 0x111827, 0x9ca3af, 0x0f766e, 0xf59e0b];
  const L = truck ? 9 : 4.3, W = truck ? 2.5 : 1.85, H = truck ? 3.2 : 1.35;
  const paint = new THREE.MeshStandardMaterial({ color: colors[(Math.random() * colors.length) | 0], metalness: 0.6, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.55, L), paint);
  body.position.y = H * 0.35; body.castShadow = true; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, H * 0.45, truck ? 2.2 : L * 0.5),
    new THREE.MeshStandardMaterial({ color: truck ? 0xdddddd : 0x111111, metalness: 0.9, roughness: 0.1 }));
  cab.position.set(0, H * 0.82, truck ? -L / 2 + 1.2 : 0.2); g.add(cab);
  if (truck) { const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, L - 2.6), new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.8 }));
    box.position.set(0, H * 0.6, 1.2); g.add(box); }
  const mk = c => new THREE.MeshBasicMaterial({ color: c });
  const lights = {};
  for (const s of [-1, 1]) {
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.05), mk(0x440000));
    brake.position.set(s * (W / 2 - 0.25), H * 0.45, L / 2 + 0.01); g.add(brake);
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.06), mk(0x442200));
    ind.position.set(s * (W / 2 - 0.05), H * 0.45, L / 2 + 0.02); g.add(ind);
    const indF = ind.clone(); indF.material = ind.material; indF.position.z = -L / 2 - 0.02; g.add(indF);
    lights[s < 0 ? 'brakeL' : 'brakeR'] = brake; lights[s < 0 ? 'indL' : 'indR'] = ind;
  }
  return { mesh: g, lights, L, W, truck };
}

export function init(ctx) {
  S.ctx = ctx; reset(ctx); buildHud(ctx);
}
export function reset(ctx = S.ctx) {
  for (const v of S.vehicles) ctx?.scene?.remove(v.mesh);
  S.vehicles = []; S.elapsed = 0; S.combo = 0; S.score = 0; S.destroyed = false; S.invuln = 0; S.lastLvl = 1;
  if (ctx?.player) ctx.player.health = 100;
  renderHud();
}

function spawn(ctx, P) {
  const { THREE, scene, player } = ctx; const lanes = lanesOf(ctx); const pp = pPos(player);
  const truck = Math.random() < 0.22;
  const v = makeVehicle(THREE, truck);
  const lane = (Math.random() * lanes.length) | 0;
  const ahead = Math.random() < 0.85;
  const dist = ahead ? 140 + Math.random() * 120 : -(40 + Math.random() * 30);
  const z = pp.z + fwd(ctx) * dist;
  if (S.vehicles.some(o => o.lane === lane && Math.abs(o.mesh.position.z - z) < 14)) return;
  const base = (truck ? 18 : 24 + Math.random() * 14) * P.speedMul;
  Object.assign(v, { lane, targetLane: lane, x: lanes[lane], speed: base, cruise: base, signal: 0, signalT: 0,
    blink: 0, nearDone: false, hit: false, think: Math.random() * 2 });
  v.mesh.position.set(v.x, 0, z); if (fwd(ctx) < 0) v.mesh.rotation.y = 0; else v.mesh.rotation.y = Math.PI;
  scene.add(v.mesh); S.vehicles.push(v);
}

function aheadGap(v, lane, ctx) {
  const f = fwd(ctx); let best = Infinity, who = null;
  for (const o of S.vehicles) if (o !== v && (o.lane === lane || o.targetLane === lane)) {
    const d = (o.mesh.position.z - v.mesh.position.z) * f;
    if (d > 0 && d < best) { best = d; who = o; }
  }
  return { gap: best, who };
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
  S.spawnT -= dt * P.density * S.intensity * (0.6 + Math.min(1.5, (player.speed || 0) / 40));
  if (S.spawnT <= 0 && S.vehicles.length < maxCars) { spawn(ctx, P); S.spawnT = 0.9 + Math.random() * 0.6; }

  const pW = 1.9, pL = 4.4;
  for (let i = S.vehicles.length - 1; i >= 0; i--) {
    const v = S.vehicles[i]; const m = v.mesh;
    // AI: cruise / brake behind slower car / lane change with indicator
    const { gap, who } = aheadGap(v, v.lane, ctx);
    let want = v.cruise * Math.min(1.6, S.intensity * 0.5 + 0.5);
    const braking = gap < 25 && who && who.speed < v.speed;
    if (braking) want = Math.min(want, who.speed - (gap < 12 ? 6 : 0));
    v.speed += Math.sign(want - v.speed) * Math.min(Math.abs(want - v.speed), (braking ? 14 : 5) * dt);
    v.think -= dt;
    if (v.signal === 0 && v.think <= 0) {
      v.think = 1.5 + Math.random() * 3;
      if ((braking || Math.random() < P.laneChange * 0.4) && !v.truck || Math.random() < P.laneChange * 0.15) {
        const dir = Math.random() < 0.5 ? -1 : 1; const nl = v.lane + dir;
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
    if (rel < -60 || rel > 400) { ctx.scene.remove(m); S.vehicles.splice(i, 1); }
  }
  S.invuln -= dt; S.comboT -= dt; if (S.comboT <= 0) S.combo = 0;
  S.score += (player.speed || 0) * dt * 0.1;
  renderHud();
}

// ---------- HUD ----------
function buildHud(ctx) {
  if (typeof document === 'undefined') return;
  S.hud?.root.remove();
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;bottom:200px;left:18px;z-index:20;font:600 14px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none';
  root.innerHTML = `<div>Salute</div><div style="width:200px;height:12px;background:#0008;border:1px solid #fff6;border-radius:6px;overflow:hidden">
    <div data-h style="height:100%;width:100%;background:#3ddc84;transition:width .2s"></div></div>
    <div data-i style="margin-top:6px"></div><div data-f style="margin-top:8px;font-size:18px"></div>`;
  (ctx.ui instanceof HTMLElement ? ctx.ui : document.body).appendChild(root);
  S.hud = { root, h: root.querySelector('[data-h]'), i: root.querySelector('[data-i]'), f: root.querySelector('[data-f]'), ft: 0 };
}
function renderHud() {
  const H = S.hud; if (!H) return; const hp = S.ctx?.player?.health ?? 100;
  H.h.style.width = hp + '%'; H.h.style.background = hp > 60 ? '#3ddc84' : hp > 30 ? '#ffb020' : '#ff4040';
  H.i.textContent = `Difficoltà: ${PRESETS[S.diff].name} · Traffico x${S.intensity.toFixed(2)} · Punti ${Math.round(S.score)}`;
}
function flash(txt, color = '#fff') {
  const H = S.hud; if (!H) return; H.f.textContent = txt; H.f.style.color = color;
  clearTimeout(H.ft); H.ft = setTimeout(() => { H.f.textContent = ''; }, 1600);
}
