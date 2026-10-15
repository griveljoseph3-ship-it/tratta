/**
 * Tratta — police.js (modulo polizia intelligente)
 *
 * API
 *   init(ctx)          crea materiali/pool, HUD. Chiamare una volta.
 *   update(dt, ctx)    da chiamare ogni frame (dt in secondi).
 *   setHeat(level)     forza il livello di ricercato 0..5 (0 = nessuno).
 *   getState()         { heat, cooldown, units, busted, bustMeter }
 *   reset()            rimuove tutte le unità e azzera lo stato.
 *   addHeat(amount)    aumenta la "notorietà" (es. dopo collisione/infrazione).
 *
 * ctx = { THREE, scene, camera, player:{mesh,speed,lane,x,z,health}, road, ui, onEvent(name,data) }
 *   road (opzionale): { lanes:[-6,-2,2,6], zOffset:8, forward:1 }
 *     Coordinate come game.js: le unità hanno z RELATIVA al giocatore (z>0 = davanti),
 *     posizione mesh = (x, y, z*forward + zOffset).
 *   ui (opzionale): HTMLElement in cui inserire l'HUD; altrimenti document.body.
 *
 * Eventi emessi via ctx.onEvent:
 *   'heatChange' {from,to}   'busted' {heat}   'escaped' {heat}
 *   'damage' {amount}        (contatto con polizia/spuntoni; il gioco decide come applicarlo)
 *
 * Meccanica: intercettazione predittiva della posizione futura, tattiche coordinate
 * (inseguire, affiancare, chiudere a scatola, bloccare corsie), heat 1-5 con posti di blocco (3+),
 * strisce chiodate (4+), elicottero con faro (5). Si sfugge restando lontani/fuori vista
 * per il tempo di cooldown. Arresto se fermo/circondato a lungo.
 */

import { rand } from './rng.js';
let T, S, C, unitsRoot;
const units = [];      // auto polizia
const blocks = [];     // posti di blocco / chiodi
let heli = null;
let heat = 0, notoriety = 0, cooldown = 0, bustMeter = 0, busted = false;
let spawnTimer = 0, blockTimer = 0, time = 0, roleT = 0;
let hud = null, mats = null;

const HEAT_CFG = [
  null,
  { max: 1, speed: 1.05, aggr: 0.3, cool: 6 },
  { max: 2, speed: 1.12, aggr: 0.5, cool: 9 },
  { max: 3, speed: 1.2, aggr: 0.7, cool: 12 },
  { max: 5, speed: 1.28, aggr: 0.85, cool: 16 },
  { max: 6, speed: 1.36, aggr: 1.0, cool: 22 },
];
const HEAT_THRESH = [0, 1, 25, 60, 110, 180];
const LOSE_DIST = 70;

function lanes(ctx) { return (ctx.road && ctx.road.lanes) || [-6, -2, 2, 6]; }
function zOff(ctx) { return (ctx.road && ctx.road.zOffset != null) ? ctx.road.zOffset : 8; }
function fwd(ctx) { return (ctx.road && ctx.road.forward) || 1; }
function emit(ctx, n, d) { try { ctx.onEvent && ctx.onEvent(n, d); } catch (e) { console.warn(e); } }

function makeMats() {
  return {
    body: new T.MeshStandardMaterial({ color: 0x0d1a3a, metalness: 0.8, roughness: 0.28 }),
    white: new T.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.6, roughness: 0.3 }),
    glass: new T.MeshStandardMaterial({ color: 0x111418, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.85 }),
    tire: new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
    red: new T.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1020, emissiveIntensity: 0 }),
    blue: new T.MeshStandardMaterial({ color: 0x000833, emissive: 0x1040ff, emissiveIntensity: 0 }),
    barrier: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    stripe: new T.MeshStandardMaterial({ color: 0xff3300, emissive: 0x551100, roughness: 0.5 }),
    spike: new T.MeshStandardMaterial({ color: 0x777777, metalness: 0.9, roughness: 0.3 }),
  };
}

function makeCar() {
  const g = new T.Group();
  const shared = globalThis.tratta?.makeCar?.('police');
  if (shared) g.add(shared); else {
  const body = new T.Mesh(new T.BoxGeometry(1.9, 0.6, 4.2), mats.body); body.position.y = 0.45; g.add(body);
  const door = new T.Mesh(new T.BoxGeometry(1.92, 0.25, 2.0), mats.white); door.position.y = 0.5; g.add(door);
  const cab = new T.Mesh(new T.BoxGeometry(1.6, 0.5, 2.0), mats.glass); cab.position.set(0, 0.98, -0.2); g.add(cab);
  const tg = new T.CylinderGeometry(0.36, 0.36, 0.3, 14); tg.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
    const w = new T.Mesh(tg, mats.tire); w.position.set(x, 0.36, z); g.add(w);
  } }
  const bar = new T.Group(); bar.position.set(0, shared ? 1.62 : 1.28, 0.1); bar.visible = !shared;
  const r = new T.Mesh(new T.BoxGeometry(0.6, 0.14, 0.3), mats.red.clone()); r.position.x = -0.33;
  const b = new T.Mesh(new T.BoxGeometry(0.6, 0.14, 0.3), mats.blue.clone()); b.position.x = 0.33;
  bar.add(r, b); g.add(bar);
  const rl = new T.Object3D(), bl = new T.Object3D(); rl.intensity = bl.intensity = 0; // niente point light (luci più sobrie)
  g.add(rl, bl);
  g.castShadow = true;
  g.userData = { r, b, rl, bl };
  return g;
}

function makeHeli() {
  const g = new T.Group();
  const body = new T.Mesh(new T.SphereGeometry(1.2, 16, 12), mats.body); body.scale.set(1, 0.8, 1.8); g.add(body);
  const tail = new T.Mesh(new T.BoxGeometry(0.3, 0.3, 4), mats.body); tail.position.z = -3; g.add(tail);
  const rotor = new T.Mesh(new T.BoxGeometry(7, 0.05, 0.3), mats.tire); rotor.position.y = 1.1; g.add(rotor);
  const spot = new T.SpotLight(0xfff6dd, 60, 80, 0.32, 0.5, 1);
  spot.position.set(0, -1, 0); g.add(spot);
  const target = new T.Object3D(); S.add(target); spot.target = target;
  const cone = new T.Mesh(new T.ConeGeometry(5, 26, 24, 1, true),
    new T.MeshBasicMaterial({ color: 0xfff6dd, transparent: true, opacity: 0.07, depthWrite: false }));
  cone.position.y = -13; g.add(cone);
  const r = new T.Mesh(new T.SphereGeometry(0.15), mats.red.clone()); r.position.set(0, -0.8, 1.5); g.add(r);
  g.userData = { rotor, spot, target, cone, r };
  return { mesh: g, x: 0, z: -30, y: 22 };
}

function makeHud() {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:50;font:700 15px system-ui,sans-serif;color:#fff;text-align:right;text-shadow:0 2px 4px #000;pointer-events:none';
  el.innerHTML = '<div data-s style="font-size:22px;letter-spacing:3px"></div><div data-t></div><div data-b style="height:6px;background:#300;margin-top:4px;width:160px;margin-left:auto"><div style="height:100%;width:0;background:#f22"></div></div>';
  ((C && C.ui instanceof (globalThis.HTMLElement || Object)) ? C.ui : document.body).appendChild(el);
  return el;
}

let _hudLast = 0; const CARPOOL = [];
export function prewarm(n = 7) { for (let i = 0; i < n; i++) CARPOOL.push(makeCar()); return CARPOOL; }
function renderHud(force) {
  const _now = performance.now(); if (!force && _now - _hudLast < 100) return; _hudLast = _now; // HUD a 10 Hz
  if (!hud) return;
  const s = hud.querySelector('[data-s]'), t = hud.querySelector('[data-t]'), bar = hud.querySelector('[data-b]');
  if (busted) { s.textContent = 'ARRESTATO'; t.textContent = 'La polizia ti ha fermato!'; return; }
  if (heat === 0) { s.textContent = ''; t.textContent = ''; bar.style.display = 'none'; return; }
  bar.style.display = '';
  s.textContent = '★'.repeat(heat) + '☆'.repeat(5 - heat);
  s.style.color = (Math.floor(time * 4) % 2) ? '#ff3344' : '#4477ff';
  const msgs = ['', 'Polizia in allerta', 'Inseguimento in corso', 'Posti di blocco attivi!', 'Strisce chiodate sulla strada!', 'Elicottero in volo! Nasconditi!'];
  const vista = anyoneSees() ? 'Ti vedono' : `Fuori vista — fuga tra ${Math.max(0, cooldown).toFixed(1)}s`;
  t.innerHTML = `${msgs[heat]}<br>${vista}${bustMeter > 0.05 ? '<br><span style="color:#f44">Ti stanno circondando!</span>' : ''}`;
  bar.firstChild.style.width = (bustMeter * 100).toFixed(0) + '%';
}

let _ctxForSee = null;
function anyoneSees() {
  if (heli && heat >= 5) return true;
  return units.some(u => Math.abs(u.z) < LOSE_DIST && u.alive);
}

function setHeatInternal(lv, ctx) {
  lv = Math.max(0, Math.min(5, lv | 0));
  if (lv === heat) return;
  const from = heat; heat = lv;
  if (lv > 0) { notoriety = Math.max(notoriety, HEAT_THRESH[lv]); cooldown = HEAT_CFG[lv].cool; }
  else notoriety = 0;
  emit(ctx || C, 'heatChange', { from, to: lv });
}

export function setHeat(level) { if (level > 0) { busted = false; bustMeter = 0; } setHeatInternal(level, C); }
export function addHeat(amount) {
  notoriety += amount;
  let lv = heat; while (lv < 5 && notoriety >= HEAT_THRESH[lv + 1]) lv++;
  if (lv > heat) setHeatInternal(lv, C);
  if (heat > 0) cooldown = HEAT_CFG[heat].cool;
}
export function nearest(px = 0) { let b = null; for (const u of units) if (u.alive) { const d = Math.hypot(u.z, u.x - px); if (!b || d < b.dist) b = { dist: d, pan: (u.x - px) / 8 }; } return heat > 0 ? b : null; }
export function getState() { return { heat, cooldown, units: units.length, busted, bustMeter }; }

export function reset() {
  for (const u of units) { unitsRoot.remove(u.mesh); CARPOOL.push(u.mesh); }
  for (const b of blocks) unitsRoot.remove(b.mesh);
  units.length = 0; blocks.length = 0; _hudLast = 0;
  if (heli) { unitsRoot.remove(heli.mesh); S.remove(heli.mesh.userData.target); heli = null; }
  heat = 0; notoriety = 0; cooldown = 0; bustMeter = 0; busted = false;
  renderHud();
}

export function init(ctx) {
  C = ctx; T = ctx.THREE; S = ctx.scene;
  mats = makeMats();
  unitsRoot = new T.Group(); unitsRoot.name = 'police'; S.add(unitsRoot);
  hud = makeHud();
  renderHud();
}

// Ogni unità è un'auto indipendente: posizione/velocità proprie, tempo di reazione e abilità proprie.
// z = distanza lungo la strada RELATIVA al giocatore (z>0 davanti). Il movimento laterale ha limiti
// fisici (non copia mai lo sterzo del giocatore): l'unità stima dove sarai e va a chiuderti la strada.
function spawnUnit(ctx, behind) {
  const L = lanes(ctx);
  const lane = (rand() * L.length) | 0;
  const mesh = CARPOOL.pop() || makeCar(); mesh.rotation.set(0, 0, 0); unitsRoot.add(mesh);
  const pS = ctx.player.speed || 20;
  const u = { mesh, x: L[lane], vx: 0, z: behind ? -45 - rand() * 25 : 150 + rand() * 70,
    speed: behind ? pS * (1.05 + rand() * .15) : pS * (.35 + rand() * .3), role: behind ? 'chase' : 'block',
    alive: true, crash: 0, react: .25 + rand() * .45, skill: .7 + rand() * .45, estX: ctx.player.x || 0, estV: 0,
    think: 0, tx: L[lane], tz: 0, lane: L[lane], hitCd: 0 };
  units.push(u);
}

// Ruoli coordinati: davanti = sbarramento su corsie diverse; dietro = speronamento, affiancamento, sorpasso per bloccare.
function assignRoles(L, px) {
  const alive = units.filter(u => u.alive);
  const ahead = alive.filter(u => u.z > 10).sort((a, b) => a.z - b.z);
  const behind = alive.filter(u => u.z <= 10).sort((a, b) => b.z - a.z);
  const pl = laneIndex(L, px), order = [pl, pl - 1, pl + 1, pl - 2, pl + 2].filter(i => i >= 0 && i < L.length);
  ahead.forEach((u, i) => { u.role = 'block'; u.blockLane = order[i % order.length]; });
  const leftRoom = px - L[0], rightRoom = L[L.length - 1] - px;
  behind.forEach((u, i) => {
    if (u.role === 'overtake' && u.z < 10) return; // sta già sorpassando per mettersi davanti
    if (i === 0) u.role = 'ram';
    else if (i === 1) u.role = heat >= 2 && u.skill > .85 ? 'pit' : leftRoom > rightRoom ? 'flankL' : 'flankR';
    else if (i === 2) u.role = leftRoom > rightRoom ? 'flankR' : 'flankL';
    else u.role = u.skill > .9 ? 'overtake' : 'chase';
  });
}

const _tn = { hit: null, dodge: 0 };
function trafficNear(ctx, u, pz) {
  const list = ctx.traffic?.() || [];
  let hit = null, dodge = 0; const out = _tn;
  for (const v of list) {
    const rz = (pz - v.z) - u.z; // >0: traffico davanti all'unità
    const dx = v.x - u.x;
    if (Math.abs(rz) < 4.4 && Math.abs(dx) < 2) hit = v;
    else if (rz > 0 && rz < 18 + u.speed * .4 && Math.abs(dx) < 2.6) dodge += dx > 0 ? -1 : 1;
  }
  out.hit = hit; out.dodge = dodge; return out;
}

function spawnBlock(ctx, type) {
  const L = lanes(ctx);
  const g = new T.Group();
  const z = 120;
  let gapLane = (rand() * L.length) | 0;
  if (type === 'roadblock') {
    L.forEach((lx, i) => {
      if (i === gapLane) return;
      const bar = new T.Mesh(new T.BoxGeometry(3.4, 1, 0.4), mats.barrier); bar.position.set(lx, 0.6, 0); g.add(bar);
      const st = new T.Mesh(new T.BoxGeometry(3.42, 0.25, 0.42), mats.stripe); st.position.set(lx, 0.7, 0); g.add(st);
      const car = makeCar(); car.rotation.y = Math.PI / 2; car.position.set(lx, 0, 2.5); g.add(car);
    });
  } else {
    const lanesHit = [gapLane, Math.min(L.length - 1, gapLane + 1)];
    gapLane = -1;
    for (const li of lanesHit) for (let k = -6; k <= 6; k++) {
      const s = new T.Mesh(new T.ConeGeometry(0.08, 0.25, 4), mats.spike);
      s.position.set(L[li] + k * 0.28, 0.12, 0); g.add(s);
    }
    g.userData.lanes = lanesHit;
  }
  unitsRoot.add(g);
  blocks.push({ mesh: g, type, z, gapLane, lanesHit: g.userData.lanes, hit: false });
}

function laneIndex(L, x) {
  let best = 0; for (let i = 1; i < L.length; i++) if (Math.abs(L[i] - x) < Math.abs(L[best] - x)) best = i; return best;
}

export function update(dt, ctx) {
  ctx = ctx || C; C = ctx; if (!T || busted) { renderHud(); return; }
  dt = Math.min(dt, 0.1); time += dt;
  const p = ctx.player, L = lanes(ctx), off = zOff(ctx), f = fwd(ctx);
  const px = p.x != null ? p.x : (p.mesh ? p.mesh.position.x : 0);
  const pSpeed = p.speed || 0;
  if (heat === 0) {
    // velocità eccessiva attira la polizia
    if (pSpeed > 45 && !ctx.state?.noSpeedTrap) notoriety += dt * (pSpeed - 45) * 0.15;
    if (notoriety >= HEAT_THRESH[1]) setHeatInternal(1, ctx);
    renderHud(); return;
  }
  const cfg = HEAT_CFG[heat];
  // escalation passiva mentre ti vedono
  const seen = anyoneSees();
  if (seen) { notoriety += dt * 2.2; cooldown = Math.min(cfg.cool, cooldown + dt * 2); }
  else cooldown -= dt;
  let lv = heat; while (lv < 5 && notoriety >= HEAT_THRESH[lv + 1]) lv++;
  if (lv > heat) setHeatInternal(lv, ctx);
  if (cooldown <= 0 && !seen) {
    const h = heat; reset(); emit(ctx, 'escaped', { heat: h }); return;
  }

  // spawn
  spawnTimer -= dt;
  let aliveN = 0; for (const u of units) if (u.alive) aliveN++;
  if (aliveN < cfg.max && spawnTimer <= 0) {
    spawnUnit(ctx, rand() < 0.6 - heat * .06); spawnTimer = (3.8 - heat * 0.45) * (.7 + rand() * .6);
  }
  if (heat >= 3) {
    blockTimer -= dt;
    if (blockTimer <= 0) { spawnBlock(ctx, heat >= 4 && rand() < 0.5 ? 'spikes' : 'roadblock'); blockTimer = 14 - heat * 1.5; }
  }
  if (heat >= 5 && !heli) { heli = makeHeli(); unitsRoot.add(heli.mesh); }

  // previsione: posizione laterale futura del giocatore
  const pvx = (px - (update._lastX ?? px)) / Math.max(dt, 1e-3); update._lastX = px;
  const tPred = 0.6 + cfg.aggr * 0.6;
  const predX = Math.max(L[0], Math.min(L[L.length - 1], px + pvx * tPred));
  const flash = Math.floor(time * 8) % 2;
  let close = 0;

  roleT -= dt; if (roleT <= 0) { assignRoles(L, px); roleT = .5; }
  const pz = p.z || 0, xMax = (ctx.road?.halfWidth ?? 7.2) + 1.4, xMin = -xMax;
  units.forEach((u, i) => {
    const ud = u.mesh.userData;
    ud.r.material.emissiveIntensity = flash ? 3 : 0.2; ud.b.material.emissiveIntensity = flash ? 0.2 : 3;
    if (!u.alive) { u.crash += dt; u.speed = Math.max(0, u.speed - 18 * dt); u.z += (u.speed - pSpeed) * dt; u.mesh.rotation.y += dt * 3 * Math.max(0, 1 - u.crash / 1.5); }
    else {
      // percezione con ritardo personale: l'unità non "sa" lo sterzo, vede solo dove sei con un po' di lag
      const k = Math.min(1, dt / u.react);
      u.estV += ((px - u.estX) / Math.max(dt, 1e-3) * k - u.estV) * Math.min(1, dt * 2); u.estX += (px - u.estX) * k;
      u.think -= dt;
      if (u.think <= 0) { // decide un nuovo piano ogni 0.3–0.8 s
        u.think = .3 + rand() * .5 / u.skill;
        const tPred = Math.max(.3, Math.min(2.5, u.role === 'block' ? u.z / Math.max(4, pSpeed - u.speed) : .8));
        const pred = Math.max(xMin, Math.min(xMax, u.estX + u.estV * tPred * cfg.aggr));
        switch (u.role) {
          case 'block': { const bl = L[u.blockLane ?? laneIndex(L, pred)]; u.tx = u.z < 45 ? pred * .6 + bl * .4 : bl; u.tz = 0; break; }
          case 'ram': u.tx = pred; u.tz = -2; break;
          case 'pit': { // manovra PIT: si affianca al posteriore e spinge il muso contro la tua coda
            const sd = u.pitSide || (u.pitSide = pred > 0 ? -1 : 1); u.tz = -2.6;
            if (Math.abs(u.z + 2.6) < 1.4 && Math.abs(u.x - (pred + sd * 2.1)) < .7 && !u.pitT) { u.pitT = .55; }
            u.tx = u.pitT ? pred : pred + sd * 2.1; break; }
          case 'flankL': u.tx = Math.max(xMin, pred - 2.4); u.tz = .5; break;
          case 'flankR': u.tx = Math.min(xMax, pred + 2.4); u.tz = .5; break;
          case 'overtake': { const sideL = pred - L[0] > L[L.length - 1] - pred; u.tx = sideL ? L[0] : L[L.length - 1]; u.tz = 30; if (u.z > 22) u.role = 'block'; break; }
          default: u.tx = pred + (u.skill - .9) * 3; u.tz = -9;
        }
      }
      // velocità longitudinale
      let want;
      if (u.role === 'block') { // sbarramento: rallenta davanti a te, frena forte quando sei vicino
        const closeF = Math.max(0, 1 - u.z / 60);
        want = Math.max(7, pSpeed * (.85 - .45 * closeF * cfg.aggr));
      } else {
        const dz = u.tz - u.z;
        want = pSpeed + Math.max(-12, Math.min(22, dz * 1.1)) * cfg.speed;
      }
      want = Math.max(0, Math.min(want, Math.max(pSpeed, 30) * cfg.speed + 12));
      const acc = want > u.speed ? 9 * u.skill : 14;
      u.speed += Math.sign(want - u.speed) * Math.min(Math.abs(want - u.speed), acc * dt);
      u.z += (u.speed - pSpeed) * dt;
      // laterale: accelerazione e velocità laterale limitate (fisica, non copia)
      const tn = trafficNear(ctx, u, pz);
      let tx = u.tx + tn.dodge * 3;
      if (u.pitT) { u.pitT = Math.max(0, u.pitT - dt); if (!u.pitT) { u.role = 'chase'; u.pitSide = 0; } }
      const maxVx = u.pitT ? 6.5 : Math.min(2.5 + 3.5 * u.skill * cfg.aggr, .2 * Math.max(u.speed, 6));
      const wantVx = Math.max(-maxVx, Math.min(maxVx, (tx - u.x) * 1.6));
      u.vx += Math.sign(wantVx - u.vx) * Math.min(Math.abs(wantVx - u.vx), 7 * dt);
      // separazione tra unità
      units.forEach((o, j) => { if (j !== i && o.alive && Math.abs(o.z - u.z) < 6 && Math.abs(o.x - u.x) < 2.2) {
        // tagli aggressivi che a volte falliscono: due volanti che si toccano forte si schiantano
        if (Math.abs(o.z - u.z) < 3.8 && Math.abs(o.x - u.x) < 1.6 && Math.abs(u.vx - o.vx) > 2.6) { u.alive = o.alive = false; emit(ctx, 'policeCrash', { unit: u }); }
        else u.vx += Math.sign(u.x - o.x || 1) * dt * 6; } });
      const ox = u.x; u.x += u.vx * dt;
      // scorciatoie: la barriera di paletti non perdona chi la attraversa di lato
      const sc = ctx.shortcutAt?.(pz - u.z);
      if (sc && sc.inner && Math.sign(ox) === sc.side && (Math.abs(ox) - sc.line) * (Math.abs(u.x) - sc.line) < 0 && Math.sign(u.x) === sc.side) { u.alive = false; emit(ctx, 'policeCrash', { unit: u, why: 'paletti' }); }
      if (u.x < xMin || u.x > xMax) { u.x = Math.max(xMin, Math.min(xMax, u.x)); u.vx *= -.2; }
      u.mesh.rotation.y = -Math.atan2(u.vx, Math.max(u.speed, 5)); // orientata dalla SUA velocità
      if (tn.hit && u.speed > 8) { u.alive = false; emit(ctx, 'policeCrash', { unit: u }); } // si schianta nel traffico
      // contatto col giocatore
      u.hitCd -= dt;
      if (Math.abs(u.z) < 4.2 && Math.abs(u.x - px) < 2) {
        close += 1.5;
        if (u.hitCd <= 0 && u.pitT && u.z < -.8) { u.hitCd = 1.2; u.pitT = 0; emit(ctx, 'pit', { dir: Math.sign(px - u.x) || 1, unit: u }); }
        if (u.hitCd <= 0) {
          u.hitCd = .7; const rel = Math.abs(u.speed - pSpeed) + Math.abs(u.vx) * 2;
          emit(ctx, 'damage', { amount: Math.min(14, 2 + rel * .5) * (.6 + heat * .15), source: 'police' });
          emit(ctx, 'policeHit', { side: Math.sign(px - u.x) || 1, push: u.vx });
          if (u.z > 0) { p.speed = Math.max(0, pSpeed * .8); u.speed = Math.max(u.speed, pSpeed * .85); } // ti taglia la strada
          else p.speed = Math.min(pSpeed + 2, pSpeed * 1.04);
          if (p.x != null) p.x += Math.sign(px - u.x || 1) * Math.min(1.2, .3 + Math.abs(u.vx) * .25);
        }
        u.x += Math.sign(u.x - px || 1) * dt * 3; u.vx *= .6;
      } else if (Math.abs(u.z) < 8 && Math.abs(u.x - px) < 4.6) close += 1;
    }
    u.mesh.position.set(u.x, 0, u.z * f + off);
  });
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.z < -140 || u.z > 260 || u.crash > 6) { unitsRoot.remove(u.mesh); CARPOOL.push(u.mesh); units.splice(i, 1); }
  }

  // posti di blocco e chiodi
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    b.z -= pSpeed * dt;
    b.mesh.position.set(0, 0, b.z * f + off);
    if (!b.hit && Math.abs(b.z) < 1.2) {
      const li = laneIndex(L, px);
      if (b.type === 'roadblock' && li !== b.gapLane) { b.hit = true; close += 6; emit(ctx, 'damage', { amount: 35 }); notoriety += 15; }
      if (b.type === 'spikes' && b.lanesHit.includes(li)) { b.hit = true; emit(ctx, 'damage', { amount: 20, spikes: true }); if (p.speed) p.speed *= 0.6; }
    }
    if (b.z < -40) { unitsRoot.remove(b.mesh); blocks.splice(i, 1); }
  }

  // elicottero
  if (heli) {
    const hd = heli.mesh.userData;
    heli.x += (px - heli.x) * dt * 0.8; heli.z += (8 - heli.z) * dt * 0.5;
    heli.mesh.position.set(heli.x + Math.sin(time) * 2, heli.y + Math.sin(time * 1.3), heli.z * f + off);
    hd.rotor.rotation.y += dt * 30;
    hd.target.position.set(px + Math.sin(time * 2) * 1.5, 0, off);
    hd.r.material.emissiveIntensity = flash ? 3 : 0;
    if (heat < 5) { unitsRoot.remove(heli.mesh); S.remove(hd.target); heli = null; }
  }

  // arresto: circondato e lento
  const slow = pSpeed < 8 ? 1.5 : pSpeed < 20 ? 0.5 : 0; // ti arrestano solo se rallenti
  if (close >= 2) bustMeter += dt * 0.12 * close * slow * (0.6 + cfg.aggr);
  else bustMeter -= dt * 0.25;
  if (p.health != null && p.health <= 0) bustMeter = 1;
  bustMeter = Math.max(0, Math.min(1, bustMeter));
  if (bustMeter >= 1) { busted = true; emit(ctx, 'busted', { heat }); renderHud(true); }
  renderHud();
}
