/**
 * Tratta — story.js v2 (Storia, Missioni, Guida libera, Garage)
 *
 * API (ES module):
 *   init(ctx)                 una volta: crea overlay DOM, HUD, menu principale.
 *   update(dt, ctx)           ogni frame (dt in secondi).
 *   notify(name, data)        l'host segnala: 'policeHeat' {heat:0..1}, 'busted', 'playerDead',
 *                             'crash' {damage}  (in Guida libera i crash alzano la ricerca)
 *   openMainMenu(), openChapterSelect(), openGarage(), startChapter(i), startFreeRoam(carId, env)
 *   getState()                {mode, chapter, mission, active, paused, car, env, save}
 *   CHAPTERS, CARS, ENVS, PROTAGONIST
 *
 * ctx = {THREE, scene, camera, player:{mesh,speed,lane,x,z,health}, road, ui, onEvent(name,data),
 *        setEnvironment?(env), setCar?(carObj)}
 *   player.speed in unità/s (km/h = speed*3.6). ui = contenitore DOM (default document.body).
 *
 * Eventi via ctx.onEvent:
 *   'pause' {paused}            l'host DEVE fermare la guida quando paused=true
 *   'carSelected' {car}         car = elemento di CARS (anche ctx.setCar?.(car))
 *   'environment' {env}         env = 'city'|'jungle'|'desert' (anche ctx.setEnvironment?.(env))
 *   'chapterIntro' {chapter,title,env}
 *   'missionStart' {mode:'story', chapter, mission, type, difficulty 1..10, policeLevel 0..5,
 *                   trafficDensity 0..1, heat, env, car}
 *   'freeRoamStart' {mode:'free', env, car, policeLevel:0, difficulty:3, trafficDensity}
 *   'freeRoamPolice' {policeLevel, reason:'speed'|'crash'}  (Guida libera: polizia solo se corri/urti)
 *   'missionProgress' {progress}, 'missionComplete', 'missionFailed' {reason},
 *   'chapterComplete' {chapter, unlockedCars:[ids]}, 'storyComplete'
 *
 * Storia: 6 capitoli x 2 missioni (2-3 min) ≈ 30-40 min, colpo di scena a fine capitolo, retry istantaneo.
 * Tipi missione: distance, escape, delivery, timetrial, survive.
 * Salvataggio localStorage 'tratta_story_v2': {unlocked, best, cars:[ids], car}
 * Tutto è finzione da videogioco, stile cartoon.
 */

const SAVE_KEY = 'tratta_story_v2';

export const PROTAGONIST = {
  name: 'Nico "Ruota" Santoro',
  bio: 'L\'autista più veloce della città. Guida per la banda "I Gatti Neri": lui non entra mai, aspetta col motore acceso.'
};

export const ENVS = {
  city:   { id: 'city',   name: 'Città / Autostrada', desc: 'Asfalto, luci al neon, traffico.', speedLimitKmh: 130 },
  jungle: { id: 'jungle', name: 'Giungla',            desc: 'Vegetazione fitta, strada di fango, poca aderenza.', speedLimitKmh: 90, gripMul: 0.75 },
  desert: { id: 'desert', name: 'Deserto con dune',   desc: 'Sabbia, dune, cactus, sole a picco.', speedLimitKmh: 110, gripMul: 0.85 }
};

// stats 1..10; topSpeed in km/h. unlock: capitolo completato richiesto (0 = subito)
export const CARS = [
  { id: 'berlina',   name: 'Berlina Vespa 1.6',  type: 'berlina',     accel: 5, topSpeed: 200, grip: 6, handling: 6, unlock: 0, color: '#9aa4b1' },
  { id: 'furgone',   name: 'Furgone Postino',    type: 'furgone',     accel: 3, topSpeed: 160, grip: 5, handling: 4, unlock: 0, color: '#f1f1f1' },
  { id: 'coupe',     name: 'Coupé Lampo GT',     type: 'coupé',       accel: 7, topSpeed: 245, grip: 7, handling: 7, unlock: 1, color: '#e63946' },
  { id: 'pickup',    name: 'Pick-up Bufalo',     type: 'pick-up',     accel: 5, topSpeed: 185, grip: 7, handling: 5, unlock: 2, color: '#6b8f3a', offroad: true },
  { id: 'suv',       name: 'Fuoristrada Rinoceronte', type: 'SUV',    accel: 5, topSpeed: 190, grip: 8, handling: 5, unlock: 3, color: '#3d5a40', offroad: true },
  { id: 'muscle',    name: 'Muscle Toro 8V',     type: 'muscle car',  accel: 9, topSpeed: 260, grip: 5, handling: 5, unlock: 4, color: '#f4a261' },
  { id: 'rally',     name: 'Rally Falco Sterrato', type: 'rally',     accel: 8, topSpeed: 230, grip: 9, handling: 9, unlock: 5, color: '#1d70b8', offroad: true },
  { id: 'supercar',  name: 'Supercar Fulmine X', type: 'supercar',    accel: 10, topSpeed: 330, grip: 8, handling: 8, unlock: 5, color: '#ffd60a' },
  { id: 'interceptor', name: 'Interceptor Fantasma', type: 'supercar', accel: 10, topSpeed: 350, grip: 9, handling: 9, unlock: 8, color: '#111111' }
];

export const CHAPTERS = [
  { title: 'Cap. 1 — Il Colpo', env: 'city',
    intro: '«Tre minuti, Ruota. Non uno di più.»<br>Zio Tano scende con la banda. Io resto col motore acceso davanti alla Banca d\'Oro.<br>Allarme. Sirene. «VAI!»',
    outro: 'Al covo apriamo i sacchi.<br>«...Sono vuoti.» Zio Tano mi fissa.<br>«Qualcuno ci ha venduti, Ruota. E tu eri l\'unico fuori.»',
    missions: [
      { type: 'escape',  text: 'Fuga dalla banca: semina le volanti', heatStart: 0.9, difficulty: 2, policeLevel: 2 },
      { type: 'delivery', text: 'Porta la banda al covo: 6 km in 170 s', target: 6000, time: 170, difficulty: 2, policeLevel: 1 }
    ] },
  { title: 'Cap. 2 — Il Pacco', env: 'city',
    intro: '«Vuoi dimostrare che sei pulito? Porta questo pacco ai Serpenti. Non aprirlo.»<br>Il pacco ticchetta. Ottimo.',
    outro: 'I Serpenti aprono il pacco. Dentro: un localizzatore GPS.<br>«Non è contrabbando, idiota. È un\'esca.»<br>Qualcuno ci stava seguendo. Da sempre.',
    missions: [
      { type: 'delivery', text: 'Consegna il pacco al porto: 7 km in 180 s', target: 7000, time: 180, difficulty: 3, policeLevel: 2 },
      { type: 'survive', text: 'Agguato dei Serpenti! Resisti 120 s', time: 120, difficulty: 4, policeLevel: 2 }
    ] },
  { title: 'Cap. 3 — Fango', env: 'jungle',
    intro: '«Il rifugio nella giungla. Lì nessuno ci trova.» dice Lola, la nostra hacker.<br>Strada di fango. Liane. Fari alle spalle.',
    outro: 'Il rifugio è circondato. Un uomo in divisa scende dalla jeep.<br>È il Commissario Bruni.<br>Zio Tano lo saluta: «Puntuale, Commissario.»<br><b>Il poliziotto è sul nostro libro paga.</b>',
    missions: [
      { type: 'timetrial', text: 'Attraversa la giungla: 6 km in 160 s', target: 6000, time: 160, difficulty: 4, policeLevel: 1 },
      { type: 'escape', text: 'Pick-up dei Serpenti alle spalle: seminali', heatStart: 0.9, difficulty: 5, policeLevel: 3 }
    ] },
  { title: 'Cap. 4 — Doppio Gioco', env: 'jungle',
    intro: '«Bruni ci copre,» dice Tano. «Ma vuole la sua parte. Stanotte.»<br>Poi Bruni chiama i rinforzi. Contro di noi.',
    outro: 'Bruni non lavorava per Tano. Lavorava per i Serpenti.<br>Tano è preso. Lola sparisce con la cassa.<br>Un SMS: <i>«Deserto. Vieni solo. — L»</i>',
    missions: [
      { type: 'survive', text: 'Bruni ti tradisce: resisti 140 s', time: 140, difficulty: 6, policeLevel: 3 },
      { type: 'distance', text: 'Esci dalla giungla: 7 km', target: 7000, difficulty: 6, policeLevel: 3 }
    ] },
  { title: 'Cap. 5 — Mare di Sabbia', env: 'desert',
    intro: 'Dune. Cactus. 45 gradi.<br>Lola è all\'oasi. «Ti spiego tutto, Ruota. Ma prima seminali.»',
    outro: '«Il colpo era finto fin dall\'inizio,» dice Lola. «I sacchi vuoti, il GPS, Bruni... tutto per far cadere Tano.»<br>«Chi l\'ha organizzato?»<br>Lei sorride. «Tuo fratello.»',
    missions: [
      { type: 'escape', text: 'Pattuglie sulle dune: seminale', heatStart: 1.0, difficulty: 7, policeLevel: 4 },
      { type: 'delivery', text: 'Raggiungi l\'oasi: 7 km in 170 s', target: 7000, time: 170, difficulty: 7, policeLevel: 3 }
    ] },
  { title: 'Cap. 6 — L\'Ultima Tratta', env: 'city',
    intro: 'Dario. Mio fratello. Morto da tre anni... o così credevo.<br>Ha preso il posto di Tano. E vuole me alla guida per il colpo vero: il Caveau Centrale.',
    outro: 'Fuori città, all\'alba. Dario conta i soldi. «Insieme, come una volta.»<br>Gli lancio le chiavi... di un\'auto vuota.<br>La radio gracchia: <i>«Qui Bruni. Lo abbiamo, Ruota. Ottimo lavoro, agente Santoro.»</i><br><b>Ero sotto copertura. Da sempre.</b> FINE.',
    missions: [
      { type: 'timetrial', text: 'Fuga dal Caveau: 8 km in 180 s', target: 8000, time: 180, difficulty: 9, policeLevel: 5 },
      { type: 'survive', text: 'Ultimo inseguimento: 150 s', time: 150, difficulty: 10, policeLevel: 5 }
    ] }
];

const S = {
  ctx: null, root: null, hud: null, overlay: null, menu: null,
  save: { unlocked: 1, best: {}, cars: [], car: 'berlina' },
  mode: 'menu', env: 'city', chapter: -1, mission: -1, m: null, active: false, paused: false,
  t: 0, lastZ: 0, dist: 0, heat: 0, calmT: 0, overT: 0, freePolice: 0
};

const carById = id => CARS.find(c => c.id === id) || CARS[0];
const isUnlocked = c => c.unlock === 0 || S.save.cars.includes(c.id) || (c.unlock <= CHAPTERS.length && S.save.best[c.unlock - 1] != null);

function load() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.unlocked) S.save = Object.assign(S.save, s); } catch (e) {}
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S.save)); } catch (e) {} }
function emit(n, d) { try { S.ctx && S.ctx.onEvent && S.ctx.onEvent(n, d || {}); } catch (e) { console.error(e); } }
function el(tag, css, html) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
function fmt(s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
function setPaused(p) { S.paused = p; emit('pause', { paused: p }); }
const BTN = 'display:block;width:100%;text-align:left;margin:6px 0;padding:10px 14px;font-size:16px;border:0;color:#fff;cursor:pointer;background:#1d3557';
const BOX = 'background:rgba(10,10,14,.92);padding:26px;font-family:system-ui,sans-serif;color:#fff;max-width:560px;width:92%;max-height:88vh;overflow:auto';

function applyEnv(env) {
  S.env = ENVS[env] ? env : 'city';
  try { S.ctx.setEnvironment && S.ctx.setEnvironment(S.env); } catch (e) { console.error(e); }
  emit('environment', { env: S.env });
}
function applyCar(id) {
  const c = carById(id); S.save.car = c.id; persist();
  try { S.ctx.setCar && S.ctx.setCar(c); } catch (e) { console.error(e); }
  emit('carSelected', { car: c });
  return c;
}

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

function menuBox(title, sub) {
  setPaused(true); S.active = false; S.mode = 'menu'; S.hud.style.display = 'none';
  S.menu.innerHTML = '';
  const box = el('div', BOX);
  box.appendChild(el('h2', 'margin:0 0 6px', title));
  if (sub) box.appendChild(el('p', 'margin:0 0 14px;opacity:.8;font-size:14px', sub));
  S.menu.appendChild(box); S.menu.style.display = 'flex';
  return box;
}
function btn(box, label, fn, disabled) {
  const b = el('button', BTN + (disabled ? ';background:#333;color:#777;cursor:not-allowed' : ''), label);
  if (!disabled) b.onclick = fn; box.appendChild(b); return b;
}

export function openMainMenu() {
  S.gen = (S.gen || 0) + 1;
  const box = menuBox('TRATTA', PROTAGONIST.bio);
  btn(box, '▶ Storia', openChapterSelect);
  btn(box, '🌍 Guida libera', openFreeRoamMenu);
  btn(box, '🚗 Garage (' + carById(S.save.car).name + ')', openGarage);
}

export function openChapterSelect() {
  const box = menuBox('Storia — I Gatti Neri', 'Capitoli sbloccati: ' + S.save.unlocked + '/' + CHAPTERS.length);
  CHAPTERS.forEach((c, i) => {
    const locked = i + 1 > S.save.unlocked, done = S.save.best[i] != null;
    btn(box, (locked ? '🔒 ' : done ? '✅ ' : '▶ ') + c.title + ' <small style="opacity:.6">· ' + ENVS[c.env].name + '</small>', () => { S.menu.style.display = 'none'; startChapter(i); }, locked);
  });
  btn(box, '← Indietro', openMainMenu);
  const r = el('button', 'margin-top:10px;padding:6px 12px;background:none;color:#aaa;border:1px solid #555;cursor:pointer', 'Azzera progressi');
  r.onclick = () => { if (confirm('Cancellare i progressi?')) { S.save = { unlocked: 1, best: {}, cars: [], car: 'berlina' }; persist(); openChapterSelect(); } };
  box.appendChild(r);
}

function statBar(v) { return '<span style="display:inline-block;width:60px;height:6px;background:#333;vertical-align:middle"><span style="display:block;height:100%;width:' + v * 10 + '%;background:#e63946"></span></span>'; }
function carLabel(c) {
  return '<b>' + c.name + '</b> <small style="opacity:.6">' + c.type + ' · ' + c.topSpeed + ' km/h</small><br><small>Acc ' + statBar(c.accel) + ' Grip ' + statBar(c.grip) + ' Guida ' + statBar(c.handling) + '</small>';
}

export function openGarage(after) {
  const box = menuBox('Garage', 'Completa i capitoli per sbloccare nuove auto.');
  CARS.forEach(c => {
    const ok = isUnlocked(c), sel = c.id === S.save.car;
    btn(box, (ok ? (sel ? '✔ ' : '') : '🔒 ') + carLabel(c) + (ok ? '' : '<br><small>Sblocco: completa il capitolo ' + c.unlock + (c.unlock > CHAPTERS.length ? ' (finisci la storia)' : '') + '</small>'),
      () => { applyCar(c.id); typeof after === 'function' ? after() : openGarage(); }, !ok);
  });
  btn(box, '← Indietro', typeof after === 'function' ? after : openMainMenu);
}
// sblocco extra: interceptor (unlock 8) = storia completata
function storyDoneUnlocks() { if (!S.save.cars.includes('interceptor')) S.save.cars.push('interceptor'); }

function openFreeRoamMenu() {
  const box = menuBox('Guida libera', 'Nessuna missione. La polizia arriva solo se superi il limite o fai incidenti.');
  box.appendChild(el('div', 'margin:6px 0;font-size:14px', 'Auto: <b>' + carById(S.save.car).name + '</b>'));
  btn(box, '🚗 Cambia auto', () => openGarage(openFreeRoamMenu));
  Object.values(ENVS).forEach(e => btn(box, '▶ ' + e.name + ' <small style="opacity:.6">— ' + e.desc + ' Limite ' + e.speedLimitKmh + ' km/h</small>', () => { S.menu.style.display = 'none'; startFreeRoam(S.save.car, e.id); }));
  btn(box, '← Indietro', openMainMenu);
}

export function startFreeRoam(carId, env) {
  S.gen = (S.gen || 0) + 1; if (S.menu) S.menu.style.display = 'none';
  const car = applyCar(carId || S.save.car); applyEnv(env || 'city');
  S.mode = 'free'; S.m = null; S.active = true; S.t = 0; S.dist = 0; S.heat = 0; S.overT = 0; S.freePolice = 0; S.calmT = 0;
  S.lastZ = (S.ctx.player && S.ctx.player.z) || 0;
  setPaused(false);
  emit('freeRoamStart', { mode: 'free', env: S.env, car, policeLevel: 0, difficulty: 3, trafficDensity: 0.4 });
}

export function startChapter(i) {
  S.gen = (S.gen || 0) + 1; if (S.menu) S.menu.style.display = 'none';
  S.mode = 'story'; S.chapter = i; S.mission = -1;
  const c = CHAPTERS[i];
  applyEnv(c.env);
  applyCar(S.save.car);
  emit('chapterIntro', { chapter: i, title: c.title, env: c.env });
  showOverlay(c.title, c.intro + '<br><br><small style="opacity:.7">📍 ' + ENVS[c.env].name + ' · 🚗 ' + carById(S.save.car).name + '</small>', 'Guida', nextMission);
}

function nextMission() {
  S.mission++;
  const c = CHAPTERS[S.chapter];
  if (S.mission >= c.missions.length) return chapterDone();
  const m = c.missions[S.mission], p = S.ctx.player || {};
  S.m = m; S.t = 0; S.dist = 0; S.lastZ = p.z || 0; S.heat = m.heatStart || 0; S.calmT = 0;
  S.active = true;
  emit('missionStart', { mode: 'story', chapter: S.chapter, mission: S.mission, type: m.type, difficulty: m.difficulty, policeLevel: m.policeLevel,
    trafficDensity: Math.min(1, 0.2 + m.difficulty * 0.08), heat: S.heat, env: c.env, car: carById(S.save.car) });
  renderHud();
}

function chapterDone() {
  const i = S.chapter; S.active = false;
  const before = CARS.filter(isUnlocked).map(c => c.id);
  S.save.unlocked = Math.max(S.save.unlocked, Math.min(CHAPTERS.length, i + 2));
  S.save.best[i] = Date.now();
  const last = i === CHAPTERS.length - 1;
  if (last) storyDoneUnlocks();
  persist();
  const newCars = CARS.filter(c => isUnlocked(c) && !before.includes(c.id));
  emit('chapterComplete', { chapter: i, unlockedCars: newCars.map(c => c.id) });
  S.hud.style.display = 'none';
  const extra = newCars.length ? '<br><br>🔓 Nuova auto: <b>' + newCars.map(c => c.name).join(', ') + '</b>' : '';
  showOverlay(CHAPTERS[i].title, CHAPTERS[i].outro + extra, last ? 'Titoli di coda' : 'Prossimo capitolo', () => {
    if (last) { emit('storyComplete', {}); openMainMenu(); } else startChapter(i + 1);
  });
}

function finish(ok, reason) {
  if (!S.active) return; // evita doppio esito (es. arresto + distrutta nello stesso frame)
  S.active = false; const gen = S.gen = (S.gen || 0) + 1;
  if (ok) {
    emit('missionComplete', { chapter: S.chapter, mission: S.mission, time: S.t });
    flash('✔ MISSIONE COMPLETATA', '#2a9d8f');
    setTimeout(() => { if (S.gen === gen) nextMission(); }, 1600);
  } else {
    emit('missionFailed', { chapter: S.chapter, mission: S.mission, reason });
    // retry istantaneo: nessun menu, riparte la stessa missione dopo 1.2 s
    flash('✖ ' + reason + '<br><small style="font-size:20px">Riprova...</small>', '#e63946');
    setTimeout(() => { if (S.gen === gen) { S.mission--; nextMission(); } }, 1200);
  }
}

function flash(txt, color) {
  const f = el('div', 'position:absolute;top:35%;left:0;right:0;text-align:center;font:900 42px system-ui,sans-serif;color:' + color + ';text-shadow:0 3px 12px #000;pointer-events:none', txt);
  S.root.appendChild(f); setTimeout(() => f.remove(), 1500);
}
const stars = h => { const n = Math.ceil(h * 5); return '★'.repeat(n) + '☆'.repeat(5 - n); };

function renderHud() {
  if (S.mode === 'free') {
    const kmh = Math.round(((S.ctx.player && S.ctx.player.speed) || 0) * 3.6);
    S.hud.style.display = 'block';
    S.hud.innerHTML = '<div style="font-size:12px;color:#e63946;letter-spacing:2px">GUIDA LIBERA · ' + ENVS[S.env].name.toUpperCase() + '</div>' +
      '<div style="font-size:15px;margin-top:3px">' + (S.dist / 1000).toFixed(2) + ' km · ' + fmt(S.t) + ' · limite ' + ENVS[S.env].speedLimitKmh + ' km/h' + (kmh > ENVS[S.env].speedLimitKmh ? ' ⚠️' : '') + '</div>' +
      '<div style="font-size:15px">Polizia: ' + stars(S.heat) + '</div><div style="font-size:11px;opacity:.6">Esc = menu</div>';
    return 0;
  }
  const m = S.m; if (!m) return 0;
  let line = '', prog = 0;
  switch (m.type) {
    case 'distance': prog = S.dist / m.target; line = (S.dist / 1000).toFixed(2) + ' / ' + (m.target / 1000) + ' km'; break;
    case 'delivery': case 'timetrial': prog = S.dist / m.target; line = (S.dist / 1000).toFixed(2) + ' / ' + (m.target / 1000) + ' km · ⏱ ' + fmt(m.time - S.t); break;
    case 'survive': prog = S.t / m.time; line = '⏱ ' + fmt(m.time - S.t); break;
    case 'escape': prog = 1 - S.heat; line = 'Ricerca: ' + stars(S.heat) + (S.calmT > 0 ? ' · nascosto ' + S.calmT.toFixed(1) + 's' : ''); break;
  }
  prog = Math.max(0, Math.min(1, prog));
  S.hud.style.display = 'block';
  S.hud.innerHTML = '<div style="font-size:12px;color:#e63946;letter-spacing:2px">' + CHAPTERS[S.chapter].title.toUpperCase() + ' · ' + (S.mission + 1) + '/' + CHAPTERS[S.chapter].missions.length + '</div>' +
    '<div style="font-size:17px;font-weight:700;margin:3px 0">' + m.text + '</div><div style="font-size:15px">' + line + '</div>' +
    '<div style="height:5px;background:#333;margin-top:6px"><div style="height:100%;width:' + (prog * 100).toFixed(1) + '%;background:#e63946"></div></div>';
  return prog;
}

function freePoliceTo(level, reason) {
  level = Math.max(0, Math.min(5, level));
  if (level !== S.freePolice) { S.freePolice = level; emit('freeRoamPolice', { policeLevel: level, reason }); }
}

export function notify(name, data) {
  data = data || {};
  if (!S.active) return;
  if (name === 'policeHeat' && typeof data.heat === 'number') S.heat = data.heat;
  if (S.mode === 'free') {
    if (name === 'crash') { S.heat = Math.min(1, S.heat + 0.2 + (data.damage || 0) / 200); freePoliceTo(Math.ceil(S.heat * 5), 'crash'); }
    if (name === 'busted') { flash('🚔 FERMATO', '#e63946'); S.heat = 0; freePoliceTo(0, 'crash'); }
    return;
  }
  if (name === 'busted') finish(false, 'Ti hanno preso. La banda dovrà trovarsi un altro autista.');
  if (name === 'playerDead') finish(false, 'Auto distrutta.');
}

export function getState() { return { mode: S.mode, chapter: S.chapter, mission: S.mission, active: S.active, paused: S.paused, car: carById(S.save.car), env: S.env, save: S.save }; }

export function init(ctx) {
  S.ctx = ctx; load();
  const parent = (ctx.ui && ctx.ui.appendChild) ? ctx.ui : document.body;
  S.root = el('div', 'position:fixed;inset:0;pointer-events:none;z-index:50');
  S.hud = el('div', 'position:absolute;top:14px;left:14px;min-width:260px;padding:10px 14px;background:rgba(0,0,0,.55);color:#fff;font-family:system-ui,sans-serif;display:none');
  S.overlay = el('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);pointer-events:auto');
  S.menu = el('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);pointer-events:auto');
  S.root.append(S.hud, S.overlay, S.menu);
  parent.appendChild(S.root);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && S.overlay.style.display !== 'flex') openMainMenu(); });
  applyCar(S.save.car);
  openMainMenu();
}

let hudAcc = 0;
export function update(dt, ctx) {
  if (ctx) S.ctx = ctx;
  if (!S.active || S.paused) return;
  const p = S.ctx.player || {};
  S.t += dt;
  const z = p.z || 0, dz = Math.abs(z - S.lastZ); S.lastZ = z;
  S.dist += dz < 200 ? dz : (p.speed || 0) * dt;
  const kmh = (p.speed || 0) * 3.6;

  if (S.mode === 'free') {
    const lim = ENVS[S.env].speedLimitKmh;
    if (kmh > lim + 10) { S.overT += dt; if (S.overT > 2) S.heat = Math.min(1, S.heat + dt * 0.04 * (kmh / lim)); }
    else { S.overT = 0; S.heat = Math.max(0, S.heat - dt * 0.03); }
    const lvl = Math.ceil(S.heat * 5);
    if (lvl > S.freePolice) freePoliceTo(lvl, 'speed'); else if (lvl < S.freePolice) freePoliceTo(lvl, 'speed');
    if (p.health != null && p.health <= 0) { flash('💥 Auto distrutta', '#e63946'); setTimeout(() => S.mode === 'free' && startFreeRoam(S.save.car, S.env), 1500); S.active = false; }
  } else {
    const m = S.m; if (!m) return;
    if (p.health != null && p.health <= 0) return finish(false, 'Auto distrutta.');
    if (m.type === 'escape') {
      S.heat = Math.max(0, S.heat - dt * (kmh > 140 ? 0.05 : 0.01) / (1 + m.policeLevel * 0.3));
      if (S.heat <= 0.02) { S.calmT += dt; if (S.calmT >= 3) return finish(true); } else S.calmT = 0;
    }
    if ((m.type === 'distance' || m.type === 'delivery' || m.type === 'timetrial') && S.dist >= m.target) return finish(true);
    if ((m.type === 'delivery' || m.type === 'timetrial') && S.t >= m.time) return finish(false, m.type === 'delivery' ? 'Il pacco è arrivato in ritardo. Zio Tano non è contento.' : 'Troppo lento.');
    if (m.type === 'survive' && S.t >= m.time) return finish(true);
  }
  hudAcc += dt;
  if (hudAcc > 0.1) { hudAcc = 0; const pr = renderHud(); if (S.mode === 'story') emit('missionProgress', { progress: pr }); }
}
