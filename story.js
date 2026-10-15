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
 * Storia: 6 capitoli x 2 missioni (2-3 min) ≈ 30-40 min, colpi di scena solo nei cap. 3, 5 e nel finale, retry istantaneo.
 * Tipi missione: distance, escape, delivery, timetrial, survive.
 * Salvataggio localStorage 'tratta_story_v2': {unlocked, best, cars:[ids], car}
 * Tutto è finzione da videogioco, stile cartoon.
 */

const SAVE_KEY = 'tratta_story_v2';

export const PROTAGONIST = {
  name: 'Nico "Ruota" Santoro',
  bio: 'L\'autista più veloce di Napoli. Guida per i Gatti Neri di Zio Tano solo per ripagare il debito di suo fratello Dario, morto tre anni fa. Lui non entra mai: aspetta col motore acceso.',
  motive: 'Ripagare a Zio Tano i 200.000 € lasciati da Dario, prima che si prenda la trattoria di mamma.'
};

export const ENVS = {
  city:   { id: 'city',   name: 'Città / Autostrada', desc: 'Asfalto, luci al neon, traffico.', speedLimitKmh: 130 },
  jungle: { id: 'jungle', name: 'Giungla',            desc: 'Vegetazione fitta, strada di fango, poca aderenza.', speedLimitKmh: 90, gripMul: 0.75 },
  desert: { id: 'desert', name: 'Deserto con dune',   desc: 'Sabbia, dune, cactus, sole a picco.', speedLimitKmh: 110, gripMul: 0.85 },
  mountain: { id: 'mountain', name: 'Montagna / Passo', desc: 'Tornanti, guardrail, strapiombi e salite.', speedLimitKmh: 90 }
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

// Prologo: chi sei e perché guidi. Cutscene 'intro' (cinema.js) prima del Cap. 1.
export const PROLOGUE = {
  title: 'Prologo — Il Debito', env: 'city', time: 'night', place: 'Trattoria Santoro, Napoli. Chiusura.',
  lines: [
    { who: 'nico', text: 'Tre anni fa mio fratello Dario è finito fuori strada sulla Domiziana. Guidava per Zio Tano.' },
    { who: 'nico', text: 'L\'auto l\'hanno ripescata. Lui no.' },
    { who: 'tano', text: 'Bella trattoria. Tua madre fa ancora il ragù la domenica?' },
    { who: 'nico', text: 'Dimmi quanto, Tano.' },
    { who: 'tano', text: 'Duecentomila. Dario me li doveva. Ora li devi tu.' },
    { who: 'tano', text: 'Oppure questo posto diventa mio. Coi tavoli e con le sedie.' },
    { who: 'nico', text: 'Un anno. Guido per te un anno, e siamo pari.' },
    { who: 'tano', text: 'Lo diceva pure lui, guagliò.' }
  ]
};

const L = (who, text) => ({ who, text });
const NAMES = { nico: 'Nico', tano: 'Zio Tano', lola: 'Lola', bruni: 'Bruni', dario: 'Dario', serpe: 'Il Serpe', radio: 'Radio' };
const toHtml = lines => lines.map(l => l.who === 'nico' ? '<i>' + l.text + '</i>' : '<b>' + NAMES[l.who] + ':</b> ' + l.text).join('<br>');

// Ritmo: i colpi di scena veri arrivano solo nei cap. 3 (Bruni) e 5 (Dario), più il finale.
// Gli altri capitoli servono ad affezionarsi a Tano, Lola e alla memoria di Dario.
// time: 'night' | 'day' | 'dusk' — il gameplay usa la stessa ora della cutscene.
const RAW = [
  { title: 'Cap. 1 — Il Colpo', env: 'city', time: 'night', place: 'Banca d\'Oro, 02:47',
    introLines: [
      L('tano', 'Tre minuti, Ruota. Non uno di più.'),
      L('nico', 'Ne bastano due. Tu pensa a non inciampare.'),
      L('lola', 'Telecamere spente. Avete novanta secondi di buio, ragazzi.'),
      L('tano', 'Sentito? Pure la ragazzina mi mette fretta.'),
      L('nico', 'Sirene. In anticipo. Sali, Tano, sali!')
    ],
    outroLines: [
      L('tano', 'Ah, che serata! Come ai vecchi tempi.'),
      L('lola', 'Ai vecchi tempi avevi meno pancia, Tano.'),
      L('tano', 'Ruota, quella curva sul lungomare... Dario la faceva uguale. Col freno a mano.'),
      L('nico', 'Me l\'ha insegnata lui. Avevo quindici anni.'),
      L('tano', 'Tieni. Diecimila. Ne mancano centonovanta.')
    ],
    missions: [
      { type: 'escape',  text: 'Semina le volanti: allontanati finché le stelle si spengono', heatStart: 0.4, difficulty: 2, policeLevel: 2 },
      { type: 'delivery', text: 'Porta la banda al covo: 6 km in 2:50', target: 6000, time: 170, difficulty: 2, policeLevel: 1 }
    ] },
  { title: 'Cap. 2 — Il Pacco', env: 'city', time: 'day', place: 'Porto di Napoli, mezzogiorno',
    introLines: [
      L('lola', 'Quindi tu sei il fratello. Hai la stessa faccia da santo.'),
      L('nico', 'Lui era il santo. Io guido e basta.'),
      L('tano', 'Questo va ai Serpenti, al molo 9. Non aprirlo. Non scuoterlo.'),
      L('lola', 'E non frenare troppo forte. Così, per curiosità.')
    ],
    outroLines: [
      L('serpe', 'Puntuale. Tano sa scegliere gli autisti.'),
      L('nico', 'Contato, firmato, me ne vado.'),
      L('lola', 'Offro io. Una sfogliatella per l\'eroe del molo.'),
      L('lola', 'Dario mi portava sempre qui. Diceva che un giorno avrebbe aperto un posto suo.'),
      L('nico', 'Ce l\'aveva già, un posto. La trattoria di mamma.')
    ],
    missions: [
      { type: 'delivery', text: 'Consegna il pacco al porto: 7 km in 3:00', target: 7000, time: 180, difficulty: 3, policeLevel: 1 },
      { type: 'survive', text: 'I Serpenti ti mettono alla prova: resisti 2:00', time: 120, difficulty: 4, policeLevel: 2 }
    ] },
  { title: 'Cap. 3 — Fango', env: 'jungle', time: 'dusk', place: 'Il rifugio nella giungla, al tramonto',
    introLines: [
      L('tano', 'Si cambia aria. Il rifugio è oltre il fiume.'),
      L('lola', 'Lì il segnale non arriva. Né il mio, né quello della polizia.'),
      L('nico', 'Strada di fango, di sera. Che bel regalo.'),
      L('tano', 'Dario ci veniva a pescare. Diceva che era l\'unico posto silenzioso al mondo.')
    ],
    outroLines: [
      L('nico', 'Una jeep davanti al rifugio. Un uomo in divisa che fuma.'),
      L('bruni', 'Commissario Bruni. Tu devi essere Santoro.'),
      L('tano', 'Puntuale, Commissario. La busta è sul sedile.'),
      L('bruni', 'Guidi meglio di tuo fratello. E lui guidava bene. Fino all\'ultimo.'),
      L('nico', 'Bruni è sul libro paga di Tano. E di Dario sa qualcosa che io non so.')
    ],
    missions: [
      { type: 'timetrial', text: 'Arriva al rifugio: 6 km di fango in 2:40', target: 6000, time: 160, difficulty: 4, policeLevel: 0 },
      { type: 'escape', text: 'Pick-up dei Serpenti alle spalle: seminali', heatStart: 0.5, difficulty: 5, policeLevel: 2 }
    ] },
  { title: 'Cap. 4 — Il Prezzo', env: 'mountain', time: 'night', place: 'Passo del Lupo, notte fonda',
    introLines: [
      L('nico', 'Tano, quella notte. Bruni c\'era, vero?'),
      L('tano', 'C\'ero pure io, Ruota. Ho visto l\'auto nel fiume. Ho pianto come un fesso.'),
      L('tano', 'Tuo fratello era l\'unico che mi chiamava zio sul serio.'),
      L('lola', 'Fari giù per i tornanti. Tanti. Troppi.'),
      L('tano', 'Bruni vuole il doppio. E stanotte se lo viene a prendere.')
    ],
    outroLines: [
      L('tano', 'Fermati qui. Scendo io.'),
      L('nico', 'Ti prendono, Tano.'),
      L('tano', 'Vecchio sono. In cella si mangia male, ma si dorme.'),
      L('tano', 'Il debito è chiuso, Nico. Di\' a tua madre che il ragù me lo deve ancora.'),
      L('lola', 'Lo hanno preso. E io ho un messaggio: «Deserto. Vieni solo.»')
    ],
    missions: [
      { type: 'survive', text: 'Sul passo le volanti di Bruni vi braccano: resisti 2:20', time: 140, difficulty: 6, policeLevel: 3 },
      { type: 'distance', text: 'Porta Lola giù dal passo: 7 km', target: 7000, difficulty: 6, policeLevel: 2 }
    ] },
  { title: 'Cap. 5 — Mare di Sabbia', env: 'desert', time: 'day', place: 'Deserto, 45 gradi',
    introLines: [
      L('lola', 'Chi ti ha scritto sa cose che sapevamo solo noi. Io vengo con te.'),
      L('nico', 'Hai paura?'),
      L('lola', 'Di morire no. Di avere ragione, sì.'),
      L('nico', 'Pattuglie sulle dune. Bruni non si arrende.')
    ],
    outroLines: [
      L('nico', 'All\'oasi c\'è un\'auto. La sua auto. Quella del fiume, rimessa a nuovo.'),
      L('dario', 'Ciao, fratellino. Hai fatto presto. Come sempre.'),
      L('nico', 'Tre anni. Mamma ha pianto tre anni. Io ho pagato il tuo debito.'),
      L('dario', 'Lo so. Bruni mi ha tirato fuori dall\'acqua. In cambio, lavoro per lui.'),
      L('lola', 'Allora anche Tano... l\'hai venduto tu.'),
      L('dario', 'Tano mi avrebbe fatto ammazzare. Ho scelto di vivere. Ora scegli tu, Nico.')
    ],
    missions: [
      { type: 'escape', text: 'Pattuglie sulle dune: seminale', heatStart: 0.6, difficulty: 7, policeLevel: 3 },
      { type: 'delivery', text: 'Raggiungi l\'oasi: 7 km in 2:50', target: 7000, time: 170, difficulty: 7, policeLevel: 2 }
    ] },
  { title: 'Cap. 6 — L\'Ultima Tratta', env: 'city', time: 'night', place: 'Caveau Centrale, 03:10',
    introLines: [
      L('dario', 'L\'ultimo lavoro per Bruni: il Caveau Centrale. Poi siamo liberi. Tutti e due.'),
      L('nico', 'Libero eri già. Eri morto.'),
      L('lola', 'Il registro dei pagamenti di Bruni è nel caveau. Se lo prendiamo, Tano esce.'),
      L('nico', 'Allora guido io. Come una volta, Dario. Ma stavolta decido io dove si va.')
    ],
    outroLines: [
      L('dario', 'Alba. Il lungomare. Ti ricordi quando mi rubavi la Vespa?'),
      L('nico', 'Te la riportavo sempre col pieno.'),
      L('lola', 'Il registro è in Procura. Bruni è finito. Tano esce tra un mese.'),
      L('radio', 'A tutte le unità: arrestare il Commissario Bruni.'),
      L('dario', 'E io? Per tutti sono morto.'),
      L('nico', 'Allora resta morto per tutti. Tranne che per mamma. Domenica c\'è il ragù.')
    ],
    missions: [
      { type: 'timetrial', text: 'Fuga dal Caveau: 8 km in 3:00', target: 8000, time: 180, difficulty: 9, policeLevel: 4 },
      { type: 'survive', text: 'Bruni in persona ti insegue: resisti 2:30', time: 150, difficulty: 10, policeLevel: 5 }
    ] }
];
export const CHAPTERS = RAW.map(c => Object.assign(c, { intro: toHtml(c.introLines), outro: toHtml(c.outroLines) }));

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
const BTN = 'display:block;width:100%;text-align:left;margin:7px 0;padding:12px 16px;font-size:16px;font-weight:600;border:1px solid rgba(140,220,255,.2);border-radius:12px;color:#eaf6ff;cursor:pointer;background:linear-gradient(90deg,rgba(34,225,255,.10),rgba(255,255,255,.03))';
const BOX = 'background:linear-gradient(180deg,rgba(16,20,34,.95),rgba(8,10,18,.95));border:1px solid rgba(140,220,255,.18);border-top:2px solid #22e1ff;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.5);padding:26px;font-family:system-ui,sans-serif;color:#fff;max-width:560px;width:92%;max-height:88vh;overflow:auto';

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
  const box = el('div', 'max-width:640px;padding:32px;background:linear-gradient(180deg,rgba(16,20,34,.94),rgba(8,10,18,.94));border:1px solid rgba(140,220,255,.18);border-left:3px solid #ff2d6f;border-radius:18px;font-family:system-ui,sans-serif;color:#fff;');
  box.appendChild(el('div', 'font-size:13px;letter-spacing:3px;color:#e63946;margin-bottom:8px', PROTAGONIST.name.toUpperCase()));
  box.appendChild(el('h2', 'margin:0 0 14px;font-size:28px', title));
  box.appendChild(el('p', 'font-size:18px;line-height:1.5;margin:0 0 22px;opacity:.92', text));
  const b = el('button', 'padding:12px 28px;font-size:17px;background:linear-gradient(90deg,#ff2d6f,#ff5a3c);border-radius:12px;box-shadow:0 0 18px rgba(255,45,111,.35);color:#fff;border:0;cursor:pointer;font-weight:700', btn);
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

export const hooks = {};
export function setHooks(h) { Object.assign(hooks, h); }
export { openFreeRoamMenu };
export function openMainMenu() {
  S.gen = (S.gen || 0) + 1;
  if (hooks.mainMenu) { if (S.menu) S.menu.style.display = 'none'; S.active = false; setPaused(true); hooks.mainMenu(); return; }
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
// premio sfida del giorno: sblocca la prossima auto ancora chiusa (null se tutte sbloccate)
export function grantNextCar() { const c = CARS.find(x => !isUnlocked(x)); if (!c) return null; S.save.cars.push(c.id); persist(); return c; }
export { openFreeRoamMenu as freeRoamMenu };
function storyDoneUnlocks() { if (!S.save.cars.includes('interceptor')) S.save.cars.push('interceptor'); }

function openFreeRoamMenu() {
  const box = menuBox('Guida libera', 'Nessuna missione. La polizia arriva solo se superi il limite o fai incidenti.');
  box.appendChild(el('div', 'margin:6px 0;font-size:14px', 'Auto: <b>' + carById(S.save.car).name + '</b>'));
  btn(box, '🚗 Cambia auto', () => openGarage(openFreeRoamMenu));
  if (hooks.daily) btn(box, '📅 Sfida del giorno <small style="opacity:.6">— stesso percorso per tutti oggi, classifica</small>', () => { S.menu.style.display = 'none'; hooks.daily(); });
  if (hooks.infinite) btn(box, '♾ Infinita <small style="opacity:.6">— obiettivi casuali, punteggio e moltiplicatore</small>', () => { S.menu.style.display = 'none'; hooks.infinite(); });
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
  if (hooks.beforeChapter) { const g = S.gen; S.active = false; setPaused(true); return Promise.resolve(hooks.beforeChapter(i)).catch(() => {}).then(() => { if (S.gen === g) startChapterNow(i); }); }
  return startChapterNow(i);
}
function startChapterNow(i) {
  S.mode = 'story'; S.chapter = i; S.mission = -1;
  const c = CHAPTERS[i];
  applyEnv(c.env);
  applyCar(S.save.car);
  emit('chapterIntro', { chapter: i, title: c.title, env: c.env, time: c.time });
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
    trafficDensity: Math.min(1, 0.2 + m.difficulty * 0.08), heat: S.heat, env: c.env, time: c.time, car: carById(S.save.car) });
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
  const go = () => showOverlay(CHAPTERS[i].title, CHAPTERS[i].outro + extra, last ? 'Titoli di coda' : 'Prossimo capitolo', () => {
    if (last) { emit('storyComplete', {}); openMainMenu(); } else startChapter(i + 1);
  });
  if (hooks.afterChapter) { setPaused(true); Promise.resolve(hooks.afterChapter(i)).catch(() => {}).then(go); } else go();
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
  S.hud = el('div', 'position:absolute;top:14px;left:14px;min-width:240px;padding:10px 14px;background:rgba(0,0,0,.55);color:#fff;font-family:system-ui,sans-serif;display:none'); S.hud.id = 'storyHud';
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
