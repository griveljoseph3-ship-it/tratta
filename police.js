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

let T, S, C, unitsRoot;
const units = [];      // auto polizia
const blocks = [];     // posti di blocco / chiodi
let heli = null;
let heat = 0, notoriety = 0, cooldown = 0, bustMeter = 0, busted = false;
let spawnTimer = 0, blockTimer = 0, time = 0;
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

function renderHud() {
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
export function getState() { return { heat, cooldown, units: units.length, busted, bustMeter }; }

export function reset() {
  for (const u of units) unitsRoot.remove(u.mesh);
  for (const b of blocks) unitsRoot.remove(b.mesh);
  units.length = 0; blocks.length = 0;
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

function spawnUnit(ctx, behind) {
  const L = lanes(ctx);
  const lane = (Math.random() * L.length) | 0;
  const mesh = makeCar(); unitsRoot.add(mesh);
  const roles = ['chase', 'flankL', 'flankR', 'block', 'box'];
  const u = { mesh, x: L[lane], z: behind ? -40 - Math.random() * 20 : 90 + Math.random() * 30,
    speed: (ctx.player.speed || 20) * (behind ? 1.1 : 0.6), role: roles[units.length % roles.length],
    alive: true, crash: 0 };
  units.push(u);
}

function spawnBlock(ctx, type) {
  const L = lanes(ctx);
  const g = new T.Group();
  const z = 120;
  let gapLane = (Math.random() * L.length) | 0;
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
  if (units.filter(u => u.alive).length < cfg.max && spawnTimer <= 0) {
    spawnUnit(ctx, Math.random() < 0.7); spawnTimer = 3.5 - heat * 0.5;
  }
  if (heat >= 3) {
    blockTimer -= dt;
    if (blockTimer <= 0) { spawnBlock(ctx, heat >= 4 && Math.random() < 0.5 ? 'spikes' : 'roadblock'); blockTimer = 14 - heat * 1.5; }
  }
  if (heat >= 5 && !heli) { heli = makeHeli(); unitsRoot.add(heli.mesh); }

  // previsione: posizione laterale futura del giocatore
  const pvx = (px - (update._lastX ?? px)) / Math.max(dt, 1e-3); update._lastX = px;
  const tPred = 0.6 + cfg.aggr * 0.6;
  const predX = Math.max(L[0], Math.min(L[L.length - 1], px + pvx * tPred));
  const flash = Math.floor(time * 8) % 2;
  let close = 0;

  units.forEach((u, i) => {
    const ud = u.mesh.userData;
    ud.r.material.emissiveIntensity = flash ? 3 : 0.2; ud.b.material.emissiveIntensity = flash ? 0.2 : 3;
    ud.rl.intensity = flash ? 6 : 0; ud.bl.intensity = flash ? 0 : 6;
    if (!u.alive) { u.crash += dt; u.z -= pSpeed * dt; u.mesh.rotation.y += dt * 4; }
    else {
      // velocità target: raggiungi il punto di intercetto
      let targetZ = -6, targetX = predX;
      if (u.role === 'flankL') { targetZ = 0; targetX = Math.max(L[0], predX - 3.6); }
      else if (u.role === 'flankR') { targetZ = 0; targetX = Math.min(L[L.length - 1], predX + 3.6); }
      else if (u.role === 'block') { targetZ = 12; targetX = predX; }
      else if (u.role === 'box') { targetZ = 6; targetX = L[laneIndex(L, px)]; }
      const dz = targetZ - u.z;
      const want = pSpeed + Math.max(-15, Math.min(25, dz * 1.2)) * cfg.speed;
      u.speed += (want - u.speed) * Math.min(1, dt * (1 + cfg.aggr * 2));
      u.speed = Math.min(u.speed, Math.max(pSpeed, 30) * cfg.speed + 10);
      u.z += (u.speed - pSpeed) * dt;
      const dx = targetX - u.x;
      u.x += Math.sign(dx) * Math.min(Math.abs(dx), dt * (5 + cfg.aggr * 6));
      // separazione tra unità
      units.forEach((o, j) => { if (j !== i && o.alive && Math.abs(o.z - u.z) < 5 && Math.abs(o.x - u.x) < 2) u.x += Math.sign(u.x - o.x || 1) * dt * 4; });
      u.mesh.rotation.y = -Math.atan2(dx, 8) * 0.4;
      // contatto
      if (Math.abs(u.z) < 3.6 && Math.abs(u.x - px) < 2) {
        close += 1.5; emit(ctx, 'damage', { amount: 4 * dt * heat });
        u.x += Math.sign(u.x - px || 1) * dt * 3;
      } else if (Math.abs(u.z) < 7 && Math.abs(u.x - px) < 4.5) close += 1;
    }
    u.mesh.position.set(u.x, 0, u.z * f + off);
  });
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.z < -140 || u.z > 220 || u.crash > 4) { unitsRoot.remove(u.mesh); units.splice(i, 1); }
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
  if (bustMeter >= 1) { busted = true; emit(ctx, 'busted', { heat }); }
  renderHud();
}
