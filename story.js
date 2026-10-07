/**
 * Tratta — story.js (modulo Storia e Missioni)
 *
 * API:
 *   import * as Story from './story.js';
 *   Story.init(ctx)          -> chiamare una volta. Crea overlay DOM, HUD obiettivi, menu capitoli.
 *   Story.update(dt, ctx)    -> chiamare ogni frame (dt in secondi).
 *   Story.openChapterSelect() / Story.startChapter(i) / Story.getState()
 *   Story.notify(name, data) -> l'host segnala eventi al modulo:
 *       'crash' {damage}, 'busted', 'policeHeat' {heat:0..1}, 'playerDead'
 *
 * ctx = {THREE, scene, camera, player:{mesh,speed,lane,x,z,health}, road, ui, onEvent(name,data)}
 *   player.speed in unità/s (km/h stimati = speed*3.6), player.z avanza (assoluto: si usa la differenza).
 *   ui: elemento DOM contenitore (opzionale, default document.body).
 *
 * Eventi emessi via ctx.onEvent:
 *   'chapterIntro' {chapter, title}
 *   'missionStart' {chapter, mission, type, difficulty (1..10), policeLevel (0..5), trafficDensity (0..1)}
 *   'missionProgress' {progress 0..1}
 *   'missionComplete' {chapter, mission, time}
 *   'missionFailed' {chapter, mission, reason}
 *   'chapterComplete' {chapter}
 *   'storyComplete' {}
 *   'pause' {paused:bool} -> l'host deve fermare la guida mentre i testi sono a schermo
 *
 * Tipi missione: distance, escape, delivery, timetrial, survive.
 * Salvataggio: localStorage 'tratta_story_v1' {unlocked, best:{}}.
 */

const SAVE_KEY = 'tratta_story_v1';

export const PROTAGONIST = {
  name: 'Luca "Tratta" Ferri',
  bio: 'Ex corriere di Napoli, 24 anni. Guida per ripagare il debito del fratello Marco con il clan Russo.'
};

export const CHAPTERS = [
  { title: 'Capitolo 1 — La Prima Consegna',
    intro: 'Napoli, 2:14 di notte. Marco deve 40.000 euro a Don Russo. Io so solo guidare. "Porta il pacco a Caserta, e non fermarti," mi dicono.',
    outro: 'Il pacco è arrivato. Don Russo sorride. "Hai le mani giuste, ragazzo." Il debito è ancora lì.',
    missions: [
      { type: 'distance', text: 'Percorri 2 km sulla A1', target: 2000, difficulty: 1, policeLevel: 0 },
      { type: 'delivery', text: 'Consegna a Caserta: 3 km in 120 s', target: 3000, time: 120, difficulty: 2, policeLevel: 1 }
    ] },
  { title: 'Capitolo 2 — Sirene a Cassino',
    intro: 'Una pattuglia mi ha notato al casello. Qualcuno ha fatto il mio nome.',
    outro: 'Li ho seminati. Ma adesso la Stradale conosce la mia macchina.',
    missions: [
      { type: 'escape', text: 'Abbassa il livello di ricerca a zero', heatStart: 0.6, difficulty: 3, policeLevel: 2 },
      { type: 'survive', text: 'Resisti 60 s senza distruggere l\'auto', time: 60, difficulty: 3, policeLevel: 2 }
    ] },
  { title: 'Capitolo 3 — La Gara di Frosinone',
    intro: 'Don Russo scommette su di me in una gara clandestina. Se perdo, Marco paga.',
    outro: 'Primo. Lo scommettitore milanese, Vinci, mi guarda storto. Ha perso molto.',
    missions: [
      { type: 'timetrial', text: 'Fai 4 km in meno di 110 s', target: 4000, time: 110, difficulty: 4, policeLevel: 1 },
      { type: 'distance', text: 'Torna a casa: 3 km nel traffico', target: 3000, difficulty: 4, policeLevel: 2 }
    ] },
  { title: 'Capitolo 4 — Tradimento',
    intro: 'Vinci ha venduto la mia rotta alla polizia. Posti di blocco ovunque fino a Roma.',
    outro: 'Sono passato. Ma Marco è sparito. Un messaggio: "Vieni a Firenze da solo."',
    missions: [
      { type: 'escape', text: 'Sfuggi al posto di blocco', heatStart: 0.9, difficulty: 5, policeLevel: 3 },
      { type: 'delivery', text: 'Raggiungi Orte: 4 km in 150 s', target: 4000, time: 150, difficulty: 5, policeLevel: 3 }
    ] },
  { title: 'Capitolo 5 — Notte sull\'Appennino',
    intro: 'Pioggia, curve, e gli elicotteri della Polizia sopra di me. Vinci vuole il carico, non Marco.',
    outro: 'Firenze. Marco è vivo, legato in un capannone. Vinci vuole un\'ultima corsa.',
    missions: [
      { type: 'survive', text: 'Resisti 90 s all\'inseguimento', time: 90, difficulty: 6, policeLevel: 4 },
      { type: 'timetrial', text: 'Passo della Futa: 5 km in 140 s', target: 5000, time: 140, difficulty: 7, policeLevel: 3 }
    ] },
  { title: 'Capitolo 6 — Il Carico di Vinci',
    intro: 'Porto il carico a Bologna e Marco è libero. Ma la Stradale ha chiamato tutte le pattuglie del Nord.',
    outro: 'Marco è libero. Il carico? Pieno di prove contro Vinci. L\'ho consegnato ai Carabinieri.',
    missions: [
      { type: 'delivery', text: 'Bologna: 6 km in 170 s', target: 6000, time: 170, difficulty: 8, policeLevel: 4 },
      { type: 'escape', text: 'Seminali tutti', heatStart: 1.0, difficulty: 8, policeLevel: 5 }
    ] },
  { title: 'Capitolo 7 — Ultima Tratta',
    intro: 'Vinci è in fuga verso il confine. Sono l\'unico abbastanza veloce per prenderlo. La polizia, stavolta, è con me... quasi.',
    outro: 'Vinci arrestato al Brennero. Il debito è cancellato. Io e Marco ricominciamo. Fine.',
    missions: [
      { type: 'timetrial', text: 'Raggiungilo: 6 km in 150 s', target: 6000, time: 150, difficulty: 9, policeLevel: 4 },
      { type: 'survive', text: 'Ultimi 120 s: non mollare', time: 120, difficulty: 10, policeLevel: 5 }
    ] }
];

const S = {
  ctx: null, root: null, hud: null, overlay: null, menu: null,
  save: { unlocked: 1, best: {} },
  chapter: -1, mission: -1, m: null, active: false, paused: false,
  t: 0, startZ: 0, lastZ: 0, dist: 0, heat: 0, calmT: 0, startHealth: 100
};

function load() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.unlocked) S.save = { unlocked: s.unlocked, best: s.best || {} }; } catch (e) {}
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S.save)); } catch (e) {} }
function emit(n, d) { try { S.ctx && S.ctx.onEvent && S.ctx.onEvent(n, d || {}); } catch (e) { console.error(e); } }
function el(tag, css, html) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
function fmt(s) { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0'); }

function setPaused(p) { S.paused = p; emit('pause', { paused: p }); }

function showOverlay(title, text, btn, cb) {
  setPaused(true);
  S.overlay.innerHTML = '';
  const box = el('div', 'max-width:640px;padding:32px;background:rgba(10,10,14,.88);border-left:4px solid #e63946;font-family:system-ui,sans-serif;color:#fff;');
  box.appendChild(el('div', 'font-size:13px;letter-spacing:3px;color:#e63946;margin-bottom:8px', PROTAGONIST.name.toUpperCase()));
  box.appendChild(el('h2', 'margin:0 0 14px;font-size:28px', title));
  box.appendChild(el('p', 'font-size:18px;line-height:1.5;margin:0 0 22px;opacity:.92', text));
  const b = el('button', 'padding:10px 26px;font-size:17px;background:#e63946;color:#fff;border:0;cursor:pointer;font-weight:700', btn);
  b.onclick = () => { S.overlay.style.display = 'none'; setPaused(false); cb && cb(); };
  box.appendChild(b);
  S.overlay.appendChild(box);
  S.overlay.style.display = 'flex';
  setTimeout(() => b.focus(), 50);
}

export function openChapterSelect() {
  setPaused(true);
  S.active = false;
  S.menu.innerHTML = '';
  const box = el('div', 'background:rgba(10,10,14,.92);padding:28px;font-family:system-ui,sans-serif;color:#fff;max-width:520px;width:90%');
  box.appendChild(el('h2', 'margin:0 0 6px', 'Tratta — Storia'));
  box.appendChild(el('p', 'margin:0 0 16px;opacity:.8;font-size:14px', PROTAGONIST.bio));
  CHAPTERS.forEach((c, i) => {
    const locked = i + 1 > S.save.unlocked;
    const done = S.save.best[i] != null;
    const b = el('button', 'display:block;width:100%;text-align:left;margin:6px 0;padding:10px 14px;font-size:16px;border:0;cursor:' + (locked ? 'not-allowed' : 'pointer') + ';background:' + (locked ? '#333' : '#1d3557') + ';color:' + (locked ? '#777' : '#fff'),
      (locked ? '🔒 ' : done ? '✅ ' : '▶ ') + c.title);
    if (!locked) b.onclick = () => { S.menu.style.display = 'none'; startChapter(i); };
    box.appendChild(b);
  });
  const r = el('button', 'margin-top:12px;padding:6px 12px;background:none;color:#aaa;border:1px solid #555;cursor:pointer', 'Azzera progressi');
  r.onclick = () => { if (confirm('Cancellare i progressi?')) { S.save = { unlocked: 1, best: {} }; persist(); openChapterSelect(); } };
  box.appendChild(r);
  S.menu.appendChild(box);
  S.menu.style.display = 'flex';
}

export function startChapter(i) {
  S.chapter = i; S.mission = -1;
  const c = CHAPTERS[i];
  emit('chapterIntro', { chapter: i, title: c.title });
  showOverlay(c.title, c.intro, 'Guida', () => nextMission());
}

function nextMission() {
  S.mission++;
  const c = CHAPTERS[S.chapter];
  if (S.mission >= c.missions.length) return chapterDone();
  const m = c.missions[S.mission];
  const p = S.ctx.player || {};
  S.m = m; S.t = 0; S.dist = 0; S.startZ = p.z || 0; S.lastZ = S.startZ;
  S.heat = m.heatStart || 0; S.calmT = 0; S.startHealth = p.health != null ? p.health : 100;
  S.active = true;
  emit('missionStart', { chapter: S.chapter, mission: S.mission, type: m.type, difficulty: m.difficulty, policeLevel: m.policeLevel, trafficDensity: Math.min(1, 0.2 + m.difficulty * 0.08), heat: S.heat });
  renderHud();
}

function chapterDone() {
  const i = S.chapter;
  S.active = false;
  S.save.unlocked = Math.max(S.save.unlocked, Math.min(CHAPTERS.length, i + 2));
  S.save.best[i] = Date.now();
  persist();
  emit('chapterComplete', { chapter: i });
  S.hud.style.display = 'none';
  const last = i === CHAPTERS.length - 1;
  showOverlay(CHAPTERS[i].title, CHAPTERS[i].outro, last ? 'Titoli di coda' : 'Prossimo capitolo', () => {
    if (last) { emit('storyComplete', {}); openChapterSelect(); } else startChapter(i + 1);
  });
}

function finish(ok, reason) {
  S.active = false;
  const m = S.m;
  if (ok) {
    emit('missionComplete', { chapter: S.chapter, mission: S.mission, time: S.t });
    flash('✔ MISSIONE COMPLETATA', '#2a9d8f');
    setTimeout(nextMission, 1600);
  } else {
    emit('missionFailed', { chapter: S.chapter, mission: S.mission, reason });
    S.hud.style.display = 'none';
    showOverlay('Missione fallita', reason + '<br><br><i>' + m.text + '</i>', 'Riprova', () => { S.mission--; nextMission(); });
  }
}

function flash(txt, color) {
  const f = el('div', 'position:absolute;top:35%;left:0;right:0;text-align:center;font:900 42px system-ui,sans-serif;color:' + color + ';text-shadow:0 3px 12px #000;pointer-events:none', txt);
  S.root.appendChild(f); setTimeout(() => f.remove(), 1500);
}

function renderHud() {
  const m = S.m; if (!m) return;
  let line = '', prog = 0;
  switch (m.type) {
    case 'distance': prog = S.dist / m.target; line = (S.dist / 1000).toFixed(2) + ' / ' + (m.target / 1000) + ' km'; break;
    case 'delivery': case 'timetrial': prog = S.dist / m.target; line = (S.dist / 1000).toFixed(2) + ' / ' + (m.target / 1000) + ' km · ⏱ ' + fmt(m.time - S.t); break;
    case 'survive': prog = S.t / m.time; line = '⏱ ' + fmt(m.time - S.t); break;
    case 'escape': prog = 1 - S.heat; line = 'Ricerca: ' + '★'.repeat(Math.ceil(S.heat * 5)) + '☆'.repeat(5 - Math.ceil(S.heat * 5)) + (S.calmT > 0 ? ' · nascosto ' + S.calmT.toFixed(1) + 's' : ''); break;
  }
  prog = Math.max(0, Math.min(1, prog));
  S.hud.style.display = 'block';
  S.hud.innerHTML = '<div style="font-size:12px;color:#e63946;letter-spacing:2px">' + CHAPTERS[S.chapter].title.toUpperCase() + ' · ' + (S.mission + 1) + '/' + CHAPTERS[S.chapter].missions.length + '</div>' +
    '<div style="font-size:17px;font-weight:700;margin:3px 0">' + m.text + '</div><div style="font-size:15px">' + line + '</div>' +
    '<div style="height:5px;background:#333;margin-top:6px"><div style="height:100%;width:' + (prog * 100).toFixed(1) + '%;background:#e63946"></div></div>';
  return prog;
}

export function notify(name, data) {
  data = data || {};
  if (!S.active) return;
  if (name === 'policeHeat' && typeof data.heat === 'number') S.heat = data.heat;
  if (name === 'busted') finish(false, 'Ti hanno fermato. Marco conta su di te.');
  if (name === 'playerDead') finish(false, 'Auto distrutta.');
}

export function getState() { return { chapter: S.chapter, mission: S.mission, active: S.active, paused: S.paused, save: S.save }; }

export function init(ctx) {
  S.ctx = ctx; load();
  const parent = (ctx.ui && ctx.ui.appendChild) ? ctx.ui : document.body;
  S.root = el('div', 'position:fixed;inset:0;pointer-events:none;z-index:50');
  S.hud = el('div', 'position:absolute;top:14px;left:14px;min-width:260px;padding:10px 14px;background:rgba(0,0,0,.55);color:#fff;font-family:system-ui,sans-serif;display:none');
  S.overlay = el('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);pointer-events:auto');
  S.menu = el('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);pointer-events:auto');
  S.root.append(S.hud, S.overlay, S.menu);
  parent.appendChild(S.root);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !S.overlay.style.display.includes('flex')) openChapterSelect(); });
  openChapterSelect();
}

let hudAcc = 0;
export function update(dt, ctx) {
  if (ctx) S.ctx = ctx;
  if (!S.active || S.paused || !S.m) return;
  const p = S.ctx.player || {}, m = S.m;
  S.t += dt;
  const z = p.z || 0;
  const dz = Math.abs(z - S.lastZ); S.lastZ = z;
  S.dist += dz < 200 ? dz : (p.speed || 0) * dt; // ignora salti di posizione (respawn)
  if (p.health != null && p.health <= 0) return finish(false, 'Auto distrutta.');

  if (m.type === 'escape') {
    // se l'host non comunica heat, decresce con la velocità alta
    const kmh = (p.speed || 0) * 3.6;
    S.heat = Math.max(0, S.heat - dt * (kmh > 140 ? 0.05 : 0.01) / (1 + m.policeLevel * 0.3));
    if (S.heat <= 0.02) { S.calmT += dt; if (S.calmT >= 3) return finish(true); } else S.calmT = 0;
  }
  if ((m.type === 'distance' || m.type === 'delivery' || m.type === 'timetrial') && S.dist >= m.target) return finish(true);
  if ((m.type === 'delivery' || m.type === 'timetrial') && S.t >= m.time) return finish(false, m.type === 'delivery' ? 'Consegna in ritardo.' : 'Troppo lento.');
  if (m.type === 'survive' && S.t >= m.time) return finish(true);

  hudAcc += dt;
  if (hudAcc > 0.1) { hudAcc = 0; const pr = renderHud(); emit('missionProgress', { progress: pr }); }
}
