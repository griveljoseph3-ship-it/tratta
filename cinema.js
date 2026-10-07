/**
 * Tratta — cinema.js  (menu cinematografico, personaggi, dialoghi, cutscene) — Three.js 0.160
 *
 * Dipendenze: 'three', './story.js' (CHAPTERS, PROTAGONIST), './cars.js' (makeCar).
 * Il modulo usa un SUO canvas/renderer WebGL (sopra al gioco) per menu e cutscene: non tocca
 * la scena dell'host. L'host deve mettere in pausa la guida quando riceve 'cinema' {active:true}.
 *
 * API (ES module):
 *   init(ctx)                         ctx = {ui?: HTMLElement (default body), onEvent?(name,data), quality?: 0|1|2}
 *   openMenu(handlers) -> void        menu principale. handlers = {onStoria, onFree, onGarage, onSettings}
 *                                     (ogni handler chiamato DOPO la transizione; il menu si chiude da solo)
 *   closeMenu() -> Promise            dissolvenza e distruzione dello sfondo 3D
 *   isMenuOpen() -> bool
 *   CHARACTERS                        {id:{name, role, color, svg}}  id: nico, tano, lola, bruni, dario, serpe, radio
 *   portrait(id) -> string            data-URI SVG del ritratto (usabile in <img src>)
 *   say(lines, opts?) -> Promise      dialogo stile visual novel. lines = [{who:'tano', text:'...'}]
 *                                     tap/click/Spazio/Invio = completa testo / avanti; pulsante "Salta" = fine.
 *   playCutscene(id, ctx?) -> Promise<{skipped:bool}>
 *                                     id: 'intro' | 'chapterN' (intro capitolo N, 1..6) | 'twistN' (colpo di scena fine cap. N)
 *                                     barre letterbox, sottotitoli, pulsante "Salta ▸▸". Usa i testi di story.js.
 *   listCutscenes() -> string[]
 *   isPlaying() -> bool
 * Eventi (ctx.onEvent): 'cinema' {active, kind:'menu'|'cutscene'|'dialog', id?}, 'menuAction' {action}
 * Asset: i ritratti sono SVG generati qui (copie in cinema/*.svg). Nessun file esterno richiesto.
 */
import * as THREE from 'three';
import { CHAPTERS, PROTAGONIST } from './story.js';
import { makeCar } from './cars.js';

// ---------------------------------------------------------------- personaggi (SVG)
function face({ skin, hair, hairStyle, bg, accent, extra = '', eyes = 'normal', mouth = 'flat', beard = '' }) {
  const hairs = {
    short: `<path d="M58 78 Q60 34 100 32 Q142 34 142 80 Q132 56 100 56 Q70 56 58 78Z" fill="${hair}"/>`,
    slick: `<path d="M56 82 Q54 30 104 30 Q146 34 144 84 Q140 52 112 50 Q84 50 64 62 Z" fill="${hair}"/>`,
    bald: `<path d="M60 80 Q62 70 66 66 L66 84Z M140 80 Q138 70 134 66 L134 84Z" fill="${hair}"/>`,
    bob: `<path d="M52 120 Q44 34 100 30 Q156 34 148 120 L136 120 Q140 66 100 58 Q66 60 64 120Z" fill="${hair}"/>`,
    cap: `<path d="M56 80 Q58 36 100 36 Q142 36 144 80Z" fill="${hair}"/><rect x="50" y="72" width="100" height="12" rx="4" fill="${accent}"/><circle cx="100" cy="56" r="7" fill="#e9c46a"/>`,
    messy: `<path d="M56 84 L62 50 L74 60 L80 36 L94 52 L104 30 L114 50 L128 38 L130 58 L144 54 L144 86 Q130 58 100 58 Q70 58 56 84Z" fill="${hair}"/>`
  };
  const eye = eyes === 'narrow'
    ? `<path d="M74 92 h16 M110 92 h16" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round"/>`
    : `<ellipse cx="82" cy="92" rx="5" ry="6" fill="#1a1a1a"/><ellipse cx="118" cy="92" rx="5" ry="6" fill="#1a1a1a"/>`;
  const mouths = { flat: '<path d="M88 124 h24" stroke="#5a2c22" stroke-width="4" stroke-linecap="round"/>',
    smirk: '<path d="M88 124 q14 6 26 -4" stroke="#5a2c22" stroke-width="4" fill="none" stroke-linecap="round"/>',
    frown: '<path d="M88 128 q12 -8 24 0" stroke="#5a2c22" stroke-width="4" fill="none" stroke-linecap="round"/>' };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#0b0d12"/></linearGradient></defs>
<rect width="200" height="200" fill="url(#g)"/>
<circle cx="100" cy="100" r="86" fill="none" stroke="${accent}" stroke-opacity=".35" stroke-width="2"/>
<path d="M30 200 Q36 150 100 146 Q164 150 170 200Z" fill="${accent}"/>
<path d="M84 146 L100 170 L116 146Z" fill="#f1f1f1" fill-opacity=".85"/>
<rect x="88" y="126" width="24" height="24" fill="${skin}"/>
<ellipse cx="100" cy="92" rx="42" ry="48" fill="${skin}"/>
<ellipse cx="100" cy="92" rx="42" ry="48" fill="#000" fill-opacity=".08" transform="translate(6 0)" clip-path="inset(0 0 0 50%)"/>
${beard}${hairs[hairStyle]}
<path d="M72 80 h20 M108 80 h20" stroke="${hair}" stroke-width="5" stroke-linecap="round"/>
${eye}<path d="M100 96 l-5 16 h8" stroke="#000" stroke-opacity=".25" stroke-width="3" fill="none"/>
${mouths[mouth]}${extra}</svg>`;
}
const SVGS = {
  nico: face({ skin: '#e0ac86', hair: '#2b1d14', hairStyle: 'messy', bg: '#3a1d22', accent: '#e63946', mouth: 'smirk',
    extra: '<path d="M60 150 Q100 160 140 150" stroke="#222" stroke-width="6" fill="none"/>' }),
  tano: face({ skin: '#d29a76', hair: '#9a9a9a', hairStyle: 'bald', bg: '#2a2418', accent: '#3d3428', mouth: 'frown', eyes: 'narrow',
    beard: '<path d="M62 100 Q64 146 100 146 Q136 146 138 100 Q130 128 100 128 Q70 128 62 100Z" fill="#a8a8a8"/>',
    extra: '<rect x="66" y="84" width="28" height="14" rx="4" fill="#111" fill-opacity=".85"/><rect x="106" y="84" width="28" height="14" rx="4" fill="#111" fill-opacity=".85"/><path d="M94 90 h12" stroke="#111" stroke-width="3"/>' }),
  lola: face({ skin: '#f0c4a2', hair: '#7b2cbf', hairStyle: 'bob', bg: '#1d1838', accent: '#4cc9f0', mouth: 'smirk',
    extra: '<circle cx="82" cy="92" r="11" fill="none" stroke="#4cc9f0" stroke-width="3"/><circle cx="118" cy="92" r="11" fill="none" stroke="#4cc9f0" stroke-width="3"/><path d="M93 92 h14" stroke="#4cc9f0" stroke-width="3"/>' }),
  bruni: face({ skin: '#dba582', hair: '#1f2a44', hairStyle: 'cap', bg: '#14213d', accent: '#1d3557', mouth: 'flat', eyes: 'narrow',
    beard: '<path d="M80 114 Q100 106 120 114 Q100 120 80 114Z" fill="#3a2a20"/>' }),
  dario: face({ skin: '#e0ac86', hair: '#2b1d14', hairStyle: 'slick', bg: '#2b2b2b', accent: '#c9a227', mouth: 'smirk',
    extra: '<path d="M120 70 l10 30" stroke="#a0522d" stroke-width="3" stroke-opacity=".7"/>' }),
  serpe: face({ skin: '#c79a74', hair: '#0f3d2e', hairStyle: 'short', bg: '#0e2a20', accent: '#2a9d8f', mouth: 'smirk', eyes: 'narrow',
    extra: '<path d="M60 150 q20 -14 40 0 t40 0" stroke="#90be6d" stroke-width="5" fill="none"/><circle cx="140" cy="150" r="4" fill="#90be6d"/>' }),
  radio: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#111"/><rect x="62" y="60" width="76" height="110" rx="12" fill="#2b2d33"/><rect x="124" y="24" width="8" height="40" fill="#2b2d33"/><rect x="74" y="74" width="52" height="30" rx="4" fill="#90be6d" fill-opacity=".7"/><g fill="#555"><circle cx="86" cy="128" r="5"/><circle cx="100" cy="128" r="5"/><circle cx="114" cy="128" r="5"/><circle cx="86" cy="148" r="5"/><circle cx="100" cy="148" r="5"/><circle cx="114" cy="148" r="5"/></g></svg>`
};
export const CHARACTERS = {
  nico:  { name: PROTAGONIST.name, role: 'Autista della banda', color: '#e63946' },
  tano:  { name: 'Zio Tano', role: 'Boss dei Gatti Neri', color: '#c2a878' },
  lola:  { name: 'Lola', role: 'Hacker della banda', color: '#4cc9f0' },
  bruni: { name: 'Commissario Bruni', role: 'Polizia — da che parte sta?', color: '#6c8ebf' },
  dario: { name: 'Dario', role: 'Il fratello di Nico', color: '#c9a227' },
  serpe: { name: 'Il Serpe', role: 'Capo dei Serpenti', color: '#90be6d' },
  radio: { name: 'Radio', role: 'Frequenza della polizia', color: '#90be6d' }
};
for (const k in CHARACTERS) CHARACTERS[k].svg = SVGS[k];
export const portrait = id => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SVGS[id] || SVGS.nico);

// ---------------------------------------------------------------- stato / util
const C = { ctx: {}, root: null, menu: null, menuGL: null, playing: false };
const emit = (n, d) => { try { C.ctx.onEvent && C.ctx.onEvent(n, d || {}); } catch (e) { console.error(e); } };
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const strip = s => s.replace(/<[^>]+>/g, '').trim();
const FONT = "'Inter','Segoe UI',system-ui,-apple-system,sans-serif";

const CSS = `
.tc-root{position:fixed;inset:0;pointer-events:none;z-index:50;font-family:${FONT};color:#f4f1ea;-webkit-user-select:none;user-select:none}
.tc-root *{box-sizing:border-box}
.tc-layer{position:absolute;inset:0;pointer-events:auto;transition:opacity .6s ease}
.tc-layer canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.tc-vign{position:absolute;inset:0;background:radial-gradient(ellipse at 60% 50%,transparent 35%,rgba(0,0,0,.75) 100%),linear-gradient(90deg,rgba(6,7,10,.85) 0%,rgba(6,7,10,.35) 45%,transparent 70%)}
.tc-menu{position:absolute;left:clamp(24px,7vw,96px);top:50%;transform:translateY(-50%);width:min(380px,80vw)}
.tc-kick{font-size:12px;letter-spacing:.42em;color:#e63946;font-weight:600;margin-bottom:10px}
.tc-title{font-size:clamp(56px,10vw,108px);font-weight:800;letter-spacing:.14em;line-height:.95;margin:0 0 6px}
.tc-sub{font-size:14px;opacity:.6;margin:0 0 34px;letter-spacing:.04em}
.tc-btn{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:56px;margin:0 0 10px;padding:0 20px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(14,16,22,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#f4f1ea;font:600 18px ${FONT};letter-spacing:.04em;cursor:pointer;transition:background .25s,border-color .25s,transform .25s;touch-action:manipulation;opacity:0;transform:translateX(-14px);animation:tcIn .6s ease forwards}
.tc-btn span{opacity:.45;font-weight:400;font-size:14px}
.tc-btn:hover,.tc-btn:focus-visible{background:rgba(230,57,70,.18);border-color:#e63946;outline:none;transform:translateX(4px)}
.tc-btn:active{transform:scale(.98)}
.tc-foot{position:absolute;right:24px;bottom:18px;font-size:12px;opacity:.4;letter-spacing:.1em}
@keyframes tcIn{to{opacity:1;transform:none}}
.tc-fade{position:absolute;inset:0;background:#000;opacity:1;transition:opacity .7s ease;pointer-events:none}
.tc-bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height .7s cubic-bezier(.7,0,.3,1);z-index:2}
.tc-bar.t{top:0}.tc-bar.b{bottom:0}
.tc-subt{position:absolute;left:50%;bottom:calc(13vh + 18px);transform:translateX(-50%);max-width:min(820px,90vw);text-align:center;font-size:clamp(17px,2.2vw,22px);line-height:1.4;text-shadow:0 2px 6px #000;opacity:0;transition:opacity .4s;z-index:3}
.tc-chap{position:absolute;left:clamp(24px,6vw,80px);top:calc(13vh + 22px);z-index:3;opacity:0;transition:opacity .8s}
.tc-chap b{display:block;font-size:12px;letter-spacing:.4em;color:#e63946}.tc-chap i{font-style:normal;font-size:clamp(24px,3.4vw,38px);font-weight:800;letter-spacing:.06em}
.tc-skip{position:absolute;right:18px;top:18px;z-index:6;min-height:44px;padding:0 18px;border-radius:22px;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.45);color:#fff;font:600 14px ${FONT};letter-spacing:.08em;cursor:pointer;touch-action:manipulation}
.tc-dlg{position:absolute;inset:0;pointer-events:auto;z-index:5;cursor:pointer;touch-action:manipulation}
.tc-box{position:absolute;left:50%;bottom:clamp(16px,4vh,40px);transform:translateX(-50%);width:min(900px,94vw);min-height:150px;display:flex;gap:20px;align-items:flex-start;padding:20px 24px 22px;border-radius:14px;background:linear-gradient(180deg,rgba(16,18,26,.92),rgba(8,9,13,.96));border:1px solid rgba(255,255,255,.1);box-shadow:0 20px 50px rgba(0,0,0,.5);animation:tcUp .35s ease}
@keyframes tcUp{from{opacity:0;transform:translate(-50%,16px)}}
.tc-por{flex:0 0 auto;width:clamp(84px,12vw,124px);aspect-ratio:1;border-radius:12px;overflow:hidden;border:2px solid var(--c,#e63946)}
.tc-por img{width:100%;height:100%;display:block}
.tc-txt{flex:1;min-width:0}
.tc-name{font-weight:800;font-size:18px;letter-spacing:.05em;color:var(--c,#e63946)}
.tc-role{font-size:12px;opacity:.55;letter-spacing:.08em;margin:2px 0 10px;text-transform:uppercase}
.tc-line{font-size:clamp(17px,2vw,20px);line-height:1.45;min-height:2.9em}
.tc-next{position:absolute;right:20px;bottom:14px;font-size:12px;opacity:.5;letter-spacing:.1em;animation:tcBl 1.2s infinite}
@keyframes tcBl{50%{opacity:.15}}
`;

export function init(ctx = {}) {
  C.ctx = ctx;
  if (C.root) return;
  if (!document.getElementById('tc-css')) { const s = el('style'); s.id = 'tc-css'; s.textContent = CSS; document.head.appendChild(s); }
  C.root = el('div', 'tc-root'); (ctx.ui || document.body).appendChild(C.root);
}
const ensure = () => { if (!C.root) init(C.ctx); };

// ---------------------------------------------------------------- mini-motore 3D (scena propria)
function makeStage(parent, env = 'city') {
  const canvas = el('canvas'); parent.appendChild(canvas);
  const q = C.ctx.quality ?? 1;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q > 0, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q > 1 ? 2 : 1.25));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = q > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const P = { city: { sky: 0x1a2235, fog: 0x1a2235, ground: 0x23262b, road: 0x2a2c30, sun: 0xffc9a0 },
    jungle: { sky: 0x1e2b22, fog: 0x22301f, ground: 0x253a1f, road: 0x4a3a2a, sun: 0xd8f0c0 },
    desert: { sky: 0x6a4a3a, fog: 0x8a6448, ground: 0xb08a5a, road: 0x9a7a52, sun: 0xffd9a0 } }[env] || {};
  scene.background = new THREE.Color(P.sky); scene.fog = new THREE.Fog(P.fog, 25, 140);
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 400);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, P.ground, .9));
  const sun = new THREE.DirectionalLight(P.sun, 2.2); sun.position.set(-20, 18, 10); sun.castShadow = q > 0;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 }); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x6fa8ff, 1.0); rim.position.set(15, 6, -20); scene.add(rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: P.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(12, 600), new THREE.MeshStandardMaterial({ color: P.road, roughness: .85, metalness: 0 }));
  road.rotation.x = -Math.PI / 2; road.position.y = .01; road.receiveShadow = true; scene.add(road);
  const dashM = new THREE.MeshBasicMaterial({ color: env === 'city' ? 0xeeeeee : 0x6a5a40 });
  for (let z = -300; z < 300; z += 9) { const d = new THREE.Mesh(new THREE.PlaneGeometry(.15, 3.5), dashM); d.rotation.x = -Math.PI / 2; d.position.set(0, .02, z); scene.add(d); }
  // scenografia semplice
  const propM = new THREE.MeshStandardMaterial({ color: env === 'city' ? 0x3a3f4a : env === 'jungle' ? 0x1f4d1f : 0xc49a62, roughness: .9 });
  const winM = new THREE.MeshBasicMaterial({ color: 0xffd28a });
  for (let i = 0; i < 70; i++) {
    const side = i % 2 ? 1 : -1, z = -280 + i * 8 + Math.random() * 4, x = side * (14 + Math.random() * 30);
    let m;
    if (env === 'city') { const h = 8 + Math.random() * 26; m = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8), propM); m.position.set(x, h / 2, z);
      for (let k = 0; k < 4; k++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .8), winM); w.position.set(-side * 4.02, 2 + Math.random() * (h - 3), (Math.random() - .5) * 6); w.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; m.add(w); } }
    else if (env === 'jungle') { const h = 6 + Math.random() * 8; m = new THREE.Mesh(new THREE.ConeGeometry(2.5 + Math.random() * 2, h, 7), propM); m.position.set(x * .7, h / 2, z); }
    else { const r = 6 + Math.random() * 10; m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), propM); m.scale.y = .3; m.position.set(x * 1.4, 0, z); }
    m.castShadow = env !== 'desert'; scene.add(m);
  }
  const resize = () => { const w = parent.clientWidth || innerWidth, h = parent.clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize(); addEventListener('resize', resize);
  let raf = 0, last = performance.now(), alive = true; const tick = [];
  const loop = now => { if (!alive) return; const dt = Math.min(.05, (now - last) / 1000); last = now; for (const f of tick) f(dt); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  const dispose = () => { alive = false; cancelAnimationFrame(raf); removeEventListener('resize', resize);
    scene.traverse(o => { if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose?.(); });
    renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove(); };
  return { scene, camera, renderer, tick, dispose };
}
function addCar(scene, type, color) {
  let car; try { car = makeCar(type, color != null ? { color } : {}); } catch (e) { console.error(e); car = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 4.4), new THREE.MeshStandardMaterial({ color: color || 0x9aa4b1 })); car.position.y = .65; car = new THREE.Group().add(car); car.userData = {}; }
  scene.add(car); return car;
}
function sirenLights(car, scene) {
  const b = new THREE.PointLight(0x2a6cff, 0, 14), r = new THREE.PointLight(0xff2a2a, 0, 14);
  b.position.set(-.5, 1.9, 0); r.position.set(.5, 1.9, 0); car.add(b, r);
  return t => { const p = Math.floor(t * 6) % 2; b.intensity = p ? 30 : 0; r.intensity = p ? 0 : 30;
    const s = car.userData.lights || {}; if (s.siren) s.siren.visible = !!p; if (s.siren2) s.siren2.visible = !p; };
}

// ---------------------------------------------------------------- MENU
export function isMenuOpen() { return !!C.menu; }
export function openMenu(h = {}) {
  ensure(); if (C.menu) return;
  const L = el('div', 'tc-layer'); L.style.opacity = '0'; C.root.appendChild(L); C.menu = L;
  const st = makeStage(L, 'city'); C.menuGL = st;
  const car = addCar(st.scene, 'supercar', 0xb3121f); car.rotation.y = Math.PI * .1;
  const spot = new THREE.SpotLight(0xffffff, 60, 30, .5, .6); spot.position.set(0, 10, 3); spot.target = car; st.scene.add(spot);
  let t = 0; st.tick.push(dt => { t += dt; const a = t * .12; st.camera.position.set(Math.sin(a) * 8.5, 1.6 + Math.sin(t * .3) * .25, Math.cos(a) * 8.5);
    st.camera.lookAt(0, .7, 0); car.userData.spin && car.userData.spin(0); });
  L.appendChild(el('div', 'tc-vign'));
  const m = el('div', 'tc-menu'); L.appendChild(m);
  m.appendChild(el('div', 'tc-kick', 'UNA STORIA DI FUGHE'));
  m.appendChild(el('h1', 'tc-title', 'TRATTA'));
  m.appendChild(el('p', 'tc-sub', 'Tu non entri mai. Aspetti col motore acceso.'));
  const items = [['Storia', '6 capitoli', 'storia', h.onStoria], ['Guida libera', 'città · giungla · deserto', 'free', h.onFree],
    ['Garage', 'le tue auto', 'garage', h.onGarage], ['Impostazioni', 'grafica e comandi', 'settings', h.onSettings]];
  items.forEach(([lab, sub, act, fn], i) => {
    const b = el('button', 'tc-btn', `${lab}<span>${sub}</span>`); b.style.animationDelay = (.25 + i * .08) + 's';
    b.onclick = async () => { emit('menuAction', { action: act }); await closeMenu(); fn && fn(); };
    m.appendChild(b);
  });
  L.appendChild(el('div', 'tc-foot', 'v2 · ' + PROTAGONIST.name.toUpperCase()));
  requestAnimationFrame(() => requestAnimationFrame(() => { L.style.opacity = '1'; }));
  emit('cinema', { active: true, kind: 'menu' });
}
export async function closeMenu() {
  const L = C.menu; if (!L) return; C.menu = null; L.style.opacity = '0'; L.style.pointerEvents = 'none';
  await wait(600); C.menuGL && C.menuGL.dispose(); C.menuGL = null; L.remove(); emit('cinema', { active: false, kind: 'menu' });
}

// ---------------------------------------------------------------- DIALOGHI
export function say(lines, opts = {}) {
  ensure();
  return new Promise(resolve => {
    const host = opts.parent || C.root;
    const D = el('div', 'tc-dlg'); host.appendChild(D);
    if (!opts.parent) emit('cinema', { active: true, kind: 'dialog' });
    const skip = el('button', 'tc-skip', 'Salta ▸▸'); D.appendChild(skip);
    let i = -1, typing = null, full = '', done = false, lineEl;
    const finish = () => { if (done) return; done = true; clearInterval(typing); removeEventListener('keydown', key); D.remove(); if (!opts.parent) emit('cinema', { active: false, kind: 'dialog' }); resolve(); };
    const next = () => {
      if (typing) { clearInterval(typing); typing = null; lineEl.textContent = full; return; }
      if (++i >= lines.length) return finish();
      const L = lines[i], ch = CHARACTERS[L.who] || CHARACTERS.nico;
      D.querySelector('.tc-box')?.remove();
      const box = el('div', 'tc-box'); box.style.setProperty('--c', ch.color);
      box.innerHTML = `<div class="tc-por"><img alt="" src="${portrait(L.who in CHARACTERS ? L.who : 'nico')}"></div><div class="tc-txt"><div class="tc-name"></div><div class="tc-role"></div><div class="tc-line"></div></div><div class="tc-next">TOCCA ▸</div>`;
      box.querySelector('.tc-name').textContent = ch.name; box.querySelector('.tc-role').textContent = ch.role;
      D.appendChild(box); lineEl = box.querySelector('.tc-line'); full = strip(L.text); let k = 0;
      typing = setInterval(() => { k += 1; lineEl.textContent = full.slice(0, k); if (k >= full.length) { clearInterval(typing); typing = null; } }, opts.speed || 26);
    };
    const key = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); } else if (e.key === 'Escape') finish(); };
    D.addEventListener('pointerup', e => { if (e.target !== skip) next(); });
    skip.addEventListener('pointerup', e => { e.stopPropagation(); finish(); });
    addEventListener('keydown', key);
    if (opts.until) opts.until.then(finish);
    next();
  });
}

// ---------------------------------------------------------------- CUTSCENE
// speaker per riga (split <br>) di intro/outro dei capitoli di story.js
const SPK = {
  intro: [['tano', 'nico', 'tano'], ['tano', 'nico'], ['lola', 'nico'], ['tano', 'nico'], ['nico', 'lola'], ['nico', 'nico']],
  outro: [['nico', 'tano', 'tano'], ['nico', 'serpe', 'nico'], ['nico', 'bruni', 'tano', 'nico'], ['nico', 'nico', 'lola'], ['lola', 'nico', 'lola'], ['nico', 'dario', 'nico', 'radio', 'nico']]
};
const toLines = (html, spk) => html.split(/<br\s*\/?>/i).map(strip).filter(Boolean).map((text, i) => ({ who: (spk && spk[i]) || 'nico', text }));
// shot: {kind, dur, sub}
const SHOTS = {
  arrive: { dur: 4.2 }, police: { dur: 4.5 }, escape: { dur: 4.5 }, orbit: { dur: 99 }
};
const PLAN = {
  intro: ['arrive', 'police', 'escape'],
  twist1: ['arrive'], twist2: ['police'], twist3: ['police'], twist4: ['escape'], twist5: ['arrive'], twist6: ['police', 'escape']
};
export function listCutscenes() { const a = ['intro']; CHAPTERS.forEach((_, i) => a.push('chapter' + (i + 1), 'twist' + (i + 1))); return a; }
export function isPlaying() { return C.playing; }

function buildCutscene(id) {
  const m = /^(chapter|twist)(\d)$/.exec(id); let ch = 0, kind = 'intro';
  if (m) { kind = m[1]; ch = +m[2] - 1; } else if (id !== 'intro') throw new Error('cutscene sconosciuta: ' + id);
  const C0 = CHAPTERS[ch]; if (!C0) throw new Error('capitolo inesistente: ' + id);
  const lines = kind === 'twist' ? toLines(C0.outro, SPK.outro[ch]) : toLines(C0.intro, SPK.intro[ch]);
  const shots = kind === 'chapter' ? ['arrive'] : PLAN[kind === 'intro' ? 'intro' : 'twist' + (ch + 1)];
  const subs = { arrive: kind === 'twist' ? 'Più tardi…' : C0.env === 'city' ? 'Banca d\'Oro, 02:47' : C0.env === 'jungle' ? 'Da qualche parte nella giungla' : 'Deserto, 45 gradi',
    police: 'Sirene. Tante sirene.', escape: '«VAI!»' };
  return { ch, kind, env: C0.env, title: C0.title, lines, shots, subs };
}

export async function playCutscene(id, ctx) {
  ensure(); if (ctx) C.ctx = Object.assign({}, C.ctx, ctx);
  if (C.playing) throw new Error('cutscene già in corso');
  const S = buildCutscene(id); C.playing = true; emit('cinema', { active: true, kind: 'cutscene', id });
  const L = el('div', 'tc-layer'); C.root.appendChild(L);
  const st = makeStage(L, S.env);
  const fade = el('div', 'tc-fade'), bt = el('div', 'tc-bar t'), bb = el('div', 'tc-bar b'), sub = el('div', 'tc-subt'), chap = el('div', 'tc-chap'), skip = el('button', 'tc-skip', 'Salta ▸▸');
  const [cn, ...rest] = S.title.split('—'); chap.innerHTML = `<b>${cn.trim().toUpperCase()}</b><i>${(rest.join('—') || '').trim()}</i>`;
  L.append(bt, bb, chap, sub, fade, skip);
  let skipped = false, abort; const aborted = new Promise(r => abort = r);
  const doSkip = () => { if (!skipped) { skipped = true; abort(); } };
  skip.addEventListener('pointerup', e => { e.stopPropagation(); doSkip(); });
  skip.addEventListener('click', e => { e.stopPropagation(); doSkip(); });
  const key = e => { if (e.key === 'Escape') doSkip(); }; addEventListener('keydown', key);

  // attori
  const hero = addCar(st.scene, S.ch >= 5 ? 'supercar' : S.env === 'city' ? 'berlina' : 'rally', S.ch >= 5 ? 0x111111 : 0xb3121f);
  const cops = [], sir = [];
  for (let i = 0; i < 3; i++) { const p = addCar(st.scene, 'police'); p.visible = false; cops.push(p); sir.push(sirenLights(p)); }
  let T = 0, shot = null, sT = 0;
  const setShot = k => { shot = k; sT = 0; for (const p of cops) p.visible = k !== 'arrive'; };
  st.tick.push(dt => {
    T += dt; sT += dt; const cam = st.camera; sir.forEach(f => f(T + 0.1));
    const spin = d => { hero.userData.spin && hero.userData.spin(d); };
    if (shot === 'arrive') { const z = 30 - Math.min(sT, 3.4) * 9 + Math.max(0, sT - 3.4) * 0; const v = sT < 3.4 ? 9 : 0; hero.position.set(1.8, 0, z); spin(v * dt);
      cam.position.set(-4 + sT * .5, 1.1, 6 - sT * .4); cam.lookAt(hero.position.x, .8, hero.position.z); }
    else if (shot === 'police') { hero.position.set(1.8, 0, 0);
      cops.forEach((p, i) => { const tz = [-9, 9, -4][i], tx = [-2.5, -2, 6][i]; const k = Math.min(1, sT / 2.5); p.position.set(tx, 0, tz * (1 + (1 - k) * 4)); p.rotation.y = i === 2 ? Math.PI / 2 : (i === 1 ? Math.PI : 0); });
      const a = .6 + sT * .12; cam.position.set(Math.sin(a) * 13, 3 + sT * .3, Math.cos(a) * 13); cam.lookAt(0, .8, 0); }
    else if (shot === 'escape') { const v = 8 + sT * 14; hero.position.set(1.8, 0, -sT * v * .5); spin(v * dt);
      cops.forEach((p, i) => { p.rotation.y = 0; p.position.set(i % 2 ? -1.8 : 1.8, 0, hero.position.z + 9 + i * 7); p.userData.spin && p.userData.spin(v * dt); });
      cam.position.set(hero.position.x - 2.6, .7, hero.position.z - 7); cam.lookAt(hero.position.x, .9, hero.position.z + 4); }
    else if (shot === 'orbit') { const a = T * .1; cam.position.set(hero.position.x + Math.sin(a) * 7, 1.5, hero.position.z + Math.cos(a) * 7); cam.lookAt(hero.position.x, .7, hero.position.z); }
    hero.userData.steer && hero.userData.steer(shot === 'escape' ? Math.sin(T * 2) * .1 : 0);
  });

  const race = p => Promise.race([p, aborted]);
  try {
    setShot(S.shots[0]);
    await wait(60); fade.style.opacity = '0'; bt.style.height = bb.style.height = '13vh';
    if (S.kind !== 'twist') { await race(wait(300)); chap.style.opacity = '1'; }
    for (const k of S.shots) {
      if (skipped) break; setShot(k); sub.textContent = S.subs[k]; sub.style.opacity = '1';
      await race(wait(SHOTS[k].dur * 1000 - 400)); sub.style.opacity = '0'; await race(wait(400));
      if (S.kind !== 'twist') chap.style.opacity = '0';
    }
    if (!skipped) { setShot('orbit'); chap.style.opacity = '0'; await race(say(S.lines, { parent: L, until: aborted })); }
  } finally {
    removeEventListener('keydown', key);
    fade.style.opacity = '1'; await wait(650); st.dispose(); L.remove(); C.playing = false;
    emit('cinema', { active: false, kind: 'cutscene', id });
  }
  return { skipped };
}

export default { init, openMenu, closeMenu, isMenuOpen, say, playCutscene, listCutscenes, isPlaying, CHARACTERS, portrait };
