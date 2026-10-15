// Tratta — modes.js: Sfida del giorno (seme dalla data, classifica locale con nome, premio) e
// Infinita (obiettivi emergenti casuali, moltiplicatore, record). Anche la Guida libera riceve obiettivi casuali.
import * as RNG from './rng.js';
let C, Story, Police, hud, M = null;
const today = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
const LB = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const OBJ = [
  { id: 'near', t: n => `Sorpassa ${n} auto al limite`, n: () => 3 + (RNG.rand() * 3 | 0), time: 35, pts: 600 },
  { id: 'speed', t: n => `Raggiungi ${n} km/h`, n: () => 150 + (RNG.rand() * 5 | 0) * 10, time: 25, pts: 400 },
  { id: 'dist', t: n => `Percorri ${n} m in 30 s`, n: () => 800 + (RNG.rand() * 5 | 0) * 100, time: 30, pts: 500 },
  { id: 'clean', t: n => `Nessun urto per ${n} s`, n: () => 25 + (RNG.rand() * 3 | 0) * 5, time: 999, pts: 450 },
  { id: 'escape', t: () => 'Semina la polizia!', n: () => 0, time: 60, pts: 900 },
  { id: 'shortcut', t: () => 'Prendi una scorciatoia', n: () => 0, time: 45, pts: 500 },
];
function el(css, html) { const e = document.createElement('div'); e.style.cssText = css; e.innerHTML = html || ''; document.body.appendChild(e); return e; }
export function init(ctx, story, police) {
  C = ctx; Story = story; Police = police;
  hud = el('position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:55;background:rgba(6,8,14,.7);border:1px solid #ffffff22;border-radius:10px;padding:6px 14px;font:700 15px system-ui,sans-serif;color:#fff;text-align:center;pointer-events:none;display:none');
  ctx.on('nearMiss', () => { if (M?.obj?.id === 'near') M.obj.p++; });
  ctx.on('collision', () => { if (M) { M.mult = 1; if (M.obj?.id === 'clean') M.obj.p = 0; } });
  ctx.on('escaped', () => { if (M?.obj?.id === 'escape') M.obj.done = true; });
  ctx.on('shortcut', () => { if (M?.obj?.id === 'shortcut') M.obj.done = true; if (M) M.score += 250 * M.mult; });
  ctx.on('policeCrash', () => { if (M) M.score += 300 * M.mult; });
  ctx.on('missionStart', () => stop()); ctx.on('chapterIntro', () => stop());
  ctx.on('freeRoamStart', () => { if (C.state.pendingMode) C.state.pendingMode = null; else { C.debug.seed = undefined; start({ kind: 'free' }); } });
  ctx.on('playerDestroyed', () => { if (M && M.kind !== 'free') end('Auto distrutta'); });
  ctx.on('busted', () => { if (M && M.kind !== 'free') end('Arrestato'); });
}
function stop() { M = null; if (hud) hud.style.display = 'none'; C.debug.seed = undefined; }
function start(cfg) { M = Object.assign({ score: 0, mult: 1, t: 0, obj: null, nextObj: 8, done: 0, started: false, d0: C.player.distance }, cfg); hud.style.display = 'block'; }
export function startDaily() {
  const seed = today(); C.debug.seed = seed; RNG.reseed(seed);
  const envs = ['city', 'jungle', 'desert'], env = envs[seed % 3];
  start({ kind: 'daily', seed, limit: 120 }); C.state.pendingMode = 'daily';
  Story.startFreeRoam(null, env); M.started = true;
  setTimeout(() => Police.setHeat(2), 1500);
}
export function startInfinite() {
  start({ kind: 'infinite' }); C.state.pendingMode = 'infinite';
  Story.startFreeRoam(null, ['city', 'jungle', 'desert'][RNG.rand() * 3 | 0]); M.started = true;
}
function newObj() { const o = RNG.pick(OBJ.filter(x => x.id !== M.lastObj)); const n = o.n(); M.lastObj = o.id; M.obj = { ...o, n, p: 0, left: o.time, d0: C.player.distance, done: false };
  if (o.id === 'escape') Police.setHeat(Math.max(2, Police.getState().heat)); C.hud.flash('Obiettivo: ' + o.t(n), 1800); }
export function update(dt) {
  if (!M || !C.state.running || C.state.paused || C.state.cinema) return;
  M.t += dt; const p = C.player; M.score += p.speed * dt * .15 * M.mult;
  const o = M.obj;
  if (!o) { M.nextObj -= dt; if (M.nextObj <= 0) newObj(); }
  else {
    o.left -= dt;
    if (o.id === 'speed' && p.speed * 3.6 >= o.n) o.done = true;
    if (o.id === 'near' && o.p >= o.n) o.done = true;
    if (o.id === 'dist' && p.distance - o.d0 >= o.n) o.done = true;
    if (o.id === 'clean') { o.p += dt; if (o.p >= o.n) o.done = true; }
    if (o.done) { M.score += o.pts * M.mult; M.mult = Math.min(8, M.mult + 1); M.done++; C.hud.flash(`✔ Obiettivo! +${o.pts * (M.mult - 1)}  x${M.mult}`, 1500); M.obj = null; M.nextObj = 4 + RNG.rand() * 6; }
    else if (o.left <= 0) { C.hud.flash('✖ Obiettivo mancato', 1200); M.mult = Math.max(1, M.mult - 1); M.obj = null; M.nextObj = 6; }
  }
  const left = M.limit ? Math.max(0, M.limit - M.t) : null;
  const head = M.kind === 'daily' ? `📅 SFIDA DEL GIORNO · ⏱ ${Math.ceil(left)} s` : M.kind === 'infinite' ? '♾ INFINITA' : 'GUIDA LIBERA';
  hud.innerHTML = `<div style="font-size:12px;letter-spacing:2px;color:#ffb23e">${head}</div><div>${Math.round(M.score)} pt · x${M.mult}</div>` +
    (M.obj ? `<div style="font-size:13px;color:#9fe">${M.obj.t(M.obj.n)}${M.obj.time < 900 ? ' · ' + Math.ceil(M.obj.left) + ' s' : ''}${M.obj.id === 'near' ? ` (${M.obj.p}/${M.obj.n})` : ''}</div>` : '');
  if (left === 0) end('Tempo scaduto');
}
function end(reason) {
  if (!M || M.ended) return; M.ended = true; const R = M; C.state.running = false; hud.style.display = 'none';
  const score = Math.round(R.score), key = R.kind === 'daily' ? 'tratta-daily-' + R.seed : 'tratta-infinite';
  const wrap = el('position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(5,7,12,.75);font-family:system-ui,sans-serif;color:#fff');
  const lb = LB(key);
  wrap.innerHTML = `<div style="background:rgba(14,18,28,.95);border-left:4px solid #e63946;padding:24px;max-width:460px;width:90%">
    <div style="color:#e63946;letter-spacing:3px;font-size:12px">${R.kind === 'daily' ? 'SFIDA DEL GIORNO' : 'INFINITA'} · ${reason.toUpperCase()}</div>
    <h2 style="margin:6px 0">${score} punti</h2><div style="opacity:.8">${R.done} obiettivi · ${((C.player.distance - R.d0) / 1000).toFixed(2)} km</div>
    <div style="margin:12px 0 6px">Il tuo nome:</div><input maxlength="12" value="${localStorage.getItem('tratta-name') || ''}" style="font:600 18px system-ui;padding:8px;width:60%;border-radius:6px;border:0">
    <button data-save style="padding:9px 18px;margin-left:6px;background:#e63946;color:#fff;border:0;border-radius:6px;font-weight:700">Salva</button>
    <ol data-lb style="margin:14px 0 0;padding-left:22px;line-height:1.6"></ol><div data-rw style="color:#ffd23f;margin-top:8px"></div>
    <button data-menu style="margin-top:12px;padding:9px 18px;background:#334;color:#fff;border:0;border-radius:6px">Menu</button></div>`;
  const draw = l => wrap.querySelector('[data-lb]').innerHTML = l.slice(0, 10).map(e => `<li>${e.name.replace(/[<>&]/g, '')} — <b>${e.score}</b></li>`).join('') || '<i>Ancora nessun record</i>';
  draw(lb);
  const save = wrap.querySelector('[data-save]');
  save.onclick = () => { const name = (wrap.querySelector('input').value || 'Ruota').trim().slice(0, 12); localStorage.setItem('tratta-name', name);
    lb.push({ name, score, at: Date.now() }); lb.sort((a, b) => b.score - a.score); localStorage.setItem(key, JSON.stringify(lb.slice(0, 20))); draw(lb); save.disabled = true; save.textContent = 'Salvato';
    if (R.kind === 'daily' && score >= 8000 && !localStorage.getItem(key + '-reward')) { localStorage.setItem(key + '-reward', '1'); const c = Story.grantNextCar?.(); wrap.querySelector('[data-rw]').textContent = c ? `🏆 Premio: hai sbloccato ${c.name}!` : '🏆 Premio: medaglia d\'oro del giorno!'; } };
  wrap.querySelector('[data-menu]').onclick = () => { wrap.remove(); stop(); Police.reset(); Story.openMainMenu(); };
  M = null;
}
export function getState() { return M && { kind: M.kind, score: M.score, mult: M.mult, obj: M.obj?.id, t: M.t }; }
export default { init, update, startDaily, startInfinite, getState };
