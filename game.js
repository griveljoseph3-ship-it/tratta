// Tratta — core grafico + integrazione moduli.
// Convenzioni: avanti = -Z, metri, m/s. ctx condiviso con story/police/difficulty.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as RNG from './rng.js';
import * as Audio from './audio.js';
import * as Modes from './modes.js';
import * as Road from './road.js';
import * as World from './world.js';
import * as Models from './models.js';
import * as HUD from './hud.js';

const $ = id => document.getElementById(id);
const LANES = 4, LW = 3.6, ROAD_W = LANES * LW;
const road = { lanes: LANES, laneWidth: LW, width: ROAD_W, laneX: i => (i - (LANES - 1) / 2) * LW, halfWidth: ROAD_W / 2 };

const IS_TOUCH = matchMedia('(pointer: coarse)').matches || /iPad|iPhone|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
let quality = +(localStorage.getItem('tratta-q') ?? (IS_TOUCH ? 1 : 2)); // iPad: Media di default
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc9926e, 0.0019);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);

// Cielo (Sky shader) + una luce solare + emisfero. Niente bloom.
const sky = new Sky(); sky.scale.setScalar(1000); scene.add(sky);
const su = sky.material.uniforms; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
const pmrem = new THREE.PMREMGenerator(renderer);
const hemi = new THREE.HemisphereLight(0xdfeaff, 0x4a4a3a, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.4); sun.castShadow = true;
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 320; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
scene.add(sun, sun.target);
// ---------- Strada su spline (road.js): s = metri lungo la strada = -z nello spazio corsia ----------
function randomizeRoad() { Road.reset(ENV); road.ver = Road.ver; }
const kap = z => ctx.debug.noCurve ? 0 : Road.kappa(-z);
road.curveLimit = s => Math.sqrt(7.5 / Math.max(2e-4, Road.maxKappaAhead(s, 48))); // velocità massima sensata per l'IA
road.frame = (s, lat, out) => Road.frame(s, lat, out);
// Tutto ciò che sta "in corsia" (giocatore, traffico, polizia) vive in laneSpace e viene piegato sulla curva al render.
const laneSpace = new THREE.Group(); scene.add(laneSpace);

function canvasTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(...rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const noise = (g, w, h, n, f) => { for (let i = 0; i < n; i++) { g.fillStyle = f(); g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } };
const SH = 2.4, CURB = 0.5, TOTAL_W = ROAD_W + SH * 2;
function roadTex(kind) {
  return canvasTex(512, 512, (g, w, h) => {
    const px = m => (m / TOTAL_W) * w;
    if (kind === 'mud') {
      g.fillStyle = '#5a4128'; g.fillRect(0, 0, w, h);
      noise(g, w, h, 30000, () => `hsl(28,${30 + Math.random() * 20}%,${14 + Math.random() * 18}%)`);
      g.fillStyle = 'rgba(30,20,10,.45)'; for (const l of [0.3, 0.7]) g.fillRect(l * w - 30, 0, 60, h); // solchi
      g.fillStyle = 'rgba(90,110,40,.5)'; g.fillRect(0, 0, px(SH), h); g.fillRect(w - px(SH), 0, px(SH), h);
      return;
    }
    const base = kind === 'sand' ? [118, 112, 104] : [84, 86, 90];
    g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, w, h);
    noise(g, w, h, 40000, () => { const v = (Math.random() - .5) * 34; return `rgb(${base.map(c => c + v | 0)})`; });
    g.fillStyle = kind === 'sand' ? '#a8977a' : '#6c6e72'; g.fillRect(0, 0, px(SH), h); g.fillRect(w - px(SH), 0, px(SH), h); // banchine
    noise(g, px(SH), h, 3000, () => 'rgba(40,40,40,.4)');
    const edge = kind === 'sand' ? '#e8c64a' : '#f4f4f4';
    g.fillStyle = edge; g.fillRect(px(SH) - 6, 0, 8, h); g.fillRect(w - px(SH) - 2, 0, 8, h);
    g.fillStyle = '#efefef'; for (let l = 1; l < LANES; l++) { const x = px(SH + l * LW) - 3; g.fillRect(x, 0, 6, h * 0.25); }
    g.fillStyle = 'rgba(25,25,28,.22)'; for (let l = 0; l < LANES; l++) { const c = px(SH + (l + .5) * LW); g.fillRect(c - 40, 0, 18, h); g.fillRect(c + 22, 0, 18, h); }
  });
}
const ROAD_TEX = { asphalt: roadTex('asphalt'), mud: roadTex('mud'), sand: roadTex('sand') };
const curbTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#c62828'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h / 2); });
// Nastro stradale ricostruito ogni frame lungo la curva
const ROWS = 200, STEP = 4;
function makeRibbon(x0, x1, y, mat, vLen) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(ROWS * 2 * 3), uv = new Float32Array(ROWS * 2 * 2), idx = [];
  for (let r = 0; r < ROWS - 1; r++) { const a = r * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const nrm = new Float32Array(ROWS * 2 * 3); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); // strada piatta: normali fisse
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
  return { m, x0, x1, y, vLen };
}
const roadMat = new THREE.MeshStandardMaterial({ map: ROAD_TEX.asphalt, roughness: .88, metalness: 0, side: THREE.DoubleSide });
const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: .7, side: THREE.DoubleSide });
const ribbons = [
  makeRibbon(-TOTAL_W / 2, TOTAL_W / 2, 0.02, roadMat, 12),
  makeRibbon(-TOTAL_W / 2 - CURB, -TOTAL_W / 2, 0.1, curbMat, 2),
  makeRibbon(TOTAL_W / 2, TOTAL_W / 2 + CURB, 0.1, curbMat, 2),
];
let ribS = null, ribV = -1; const RF = { x: 0, y: 0, z: 0, th: 0 };
function updateRibbons(pz) {
  const s0 = Math.floor(-pz / STEP) * STEP - 60;
  if (s0 === ribS && ribV === Road.ver) return; ribS = s0; ribV = Road.ver;
  for (const rb of ribbons) {
    const p = rb.m.geometry.attributes.position.array, u = rb.m.geometry.attributes.uv.array, nr = rb.m.geometry.attributes.normal.array;
    for (let r = 0; r < ROWS; r++) {
      const s = s0 + r * STEP, th = Road.heading(s), c = Math.cos(th), sn = Math.sin(th), x = Road.x(s), z = Road.z(s), y = Road.y(s) + rb.y, sl = Road.slope(s);
      const o = r * 6, q = r * 4, v = s / rb.vLen;
      p[o] = x + rb.x0 * c; p[o + 1] = y; p[o + 2] = z + rb.x0 * sn; p[o + 3] = x + rb.x1 * c; p[o + 4] = y; p[o + 5] = z + rb.x1 * sn;
      const nl = 1 / Math.sqrt(1 + sl * sl), nx = -sl * Math.sin(th) * nl, nz = sl * Math.cos(th) * nl; // normale inclinata con la pendenza
      nr[o] = nr[o + 3] = nx; nr[o + 1] = nr[o + 4] = nl; nr[o + 2] = nr[o + 5] = nz;
      u[q] = 0; u[q + 1] = v; u[q + 2] = 1; u[q + 3] = v;
    }
    rb.m.geometry.attributes.position.needsUpdate = rb.m.geometry.attributes.uv.needsUpdate = rb.m.geometry.attributes.normal.needsUpdate = true;
  }
}
const dummy = new THREE.Object3D();
const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.random() * a.length | 0];
let ENV = 'city';
const ENV_LOOK = {
  city: { fog: 0xc8d3dc, density: .0030, sun: [72, 200], hemi: [0xdfeaff, 0x4a4a3a, 1.1], sunC: 0xfff0dc, sunI: 2.4, road: 'asphalt', turb: 6, ray: 1.6 },
  jungle: { fog: 0x9fb39a, density: .0045, sun: [55, 150], hemi: [0xcfe6c0, 0x2a3a1e, .9], sunC: 0xfff3d0, sunI: 2.0, road: 'mud', turb: 10, ray: 2.5 },
  desert: { fog: 0xe8d6b8, density: .0026, sun: [40, 170], hemi: [0xfff0d8, 0x8a6a40, 1.15], sunC: 0xfff2d6, sunI: 3.0, road: 'sand', turb: 4, ray: 1 },
  mountain: { fog: 0xb8c4d0, density: .0032, sun: [48, 210], hemi: [0xdde8ff, 0x3c4232, 1.0], sunC: 0xfff4e4, sunI: 2.6, road: 'asphalt', turb: 3, ray: 1.2 },
};
const sunDir = new THREE.Vector3();
function setEnvironment(env) {
  if (env && typeof env === 'object') env = env.id;
  if (!ENV_LOOK[env]) env = 'city';
  ENV = env; const L = ENV_LOOK[env];
  if (Road.getEnv() !== env || !Road.ver) { Road.reset(env); road.ver = Road.ver; }
  scene.fog.color.set(L.fog); scene.fog.density = L.density;
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(L.sun[0]), THREE.MathUtils.degToRad(L.sun[1]));
  su.sunPosition.value.copy(sunDir); su.turbidity.value = L.turb; su.rayleigh.value = L.ray;
  hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2];
  sun.color.set(L.sunC); sun.intensity = L.sunI;
  roadMat.map = ROAD_TEX[L.road]; roadMat.needsUpdate = true;
  for (const rb of ribbons.slice(1)) rb.m.visible = env !== 'jungle';
  if (envMap) envMap.dispose(); skyScene.add(sky); envMap = pmrem.fromScene(skyScene, 0.04).texture; scene.add(sky); scene.environment = envMap;
  road.grip = env === 'jungle' ? .75 : env === 'desert' ? .85 : 1;
  try { World.setEnvironment(env); } catch (e) { console.error(e); }
  hemi.visible = sun.visible = true;
  scene.traverse(o => { if (o.userData) delete o.userData.base; }); if (scene.fog) delete scene.fog._base;
  if (typeof setTimeOfDay === 'function' && todReady) setTimeOfDay(TOD);
}
let Cinema = null;
let envMap = null; const skyScene = new THREE.Scene();

function updateScenery(pz, dt = 0) {
  try { World.update(-pz, dt, camera); } catch (e) { console.error(e); }
  updateRibbons(pz);
}

// ---------- Auto: Kenney Car Kit (CC0) in /assets/cars — modelli distinti per giocatore, traffico e polizia ----------
const CAR_FILES = ['sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'van', 'truck', 'taxi', 'race', 'race-future', 'police', 'delivery', 'truck-flat', 'ambulance', 'firetruck', 'garbage-truck'];
const TYPE_MODEL = { berlina: 'sedan', furgone: 'van', 'coupé': 'hatchback-sports', coupe: 'hatchback-sports', 'pick-up': 'truck', SUV: 'suv-luxury', suv: 'suv-luxury', 'muscle car': 'sedan-sports', muscle: 'sedan-sports', rally: 'race-future', supercar: 'race', police: 'police', truck: 'delivery', taxi: 'taxi' };
const TRAFFIC = ['sedan', 'sedan', 'suv', 'taxi', 'van', 'hatchback-sports', 'suv', 'truck', 'sedan', 'ambulance'];
const LEN = { delivery: 7.2, 'truck-flat': 7.4, 'garbage-truck': 7.6, firetruck: 8.2, ambulance: 5.6, van: 5, truck: 5.3, suv: 4.7, 'suv-luxury': 4.8, race: 4.5, 'race-future': 4.4 };
const carModel = n => Models.get('cars/' + n);
function makeCar(kind = 'traffic', opts = {}) {
  const name = kind === 'traffic' ? pick(TRAFFIC) : kind === 'truck' ? pick(['delivery', 'truck-flat', 'garbage-truck']) : (CAR_FILES.includes(kind) ? kind : TYPE_MODEL[kind] || 'sedan');
  const M = carModel(name); const g = new THREE.Group();
  if (!M) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.2, 4.4).translate(0, .6, 0), new THREE.MeshStandardMaterial({ color: 0x8899aa })); g.add(b); g.userData.wheels = []; g.userData.size = { L: 4.4, W: 1.85 }; return g; } // solo se gli asset non caricano
  const len = LEN[name] || 4.4, sc = len / Math.max(M.size.z, M.size.x), cxm = (M.bb.min.x + M.bb.max.x) / 2, czm = (M.bb.min.z + M.bb.max.z) / 2;
  if (kind !== 'player' && !opts.full) { // traffico/polizia: geometria fusa per materiale -> 1 draw call per auto
    for (const pt of Models.parts('cars/' + name)) { const me = new THREE.Mesh(pt.geometry, pt.material); me.castShadow = true; me.scale.setScalar(sc); me.position.set(cxm * sc, -M.bb.min.y * sc, czm * sc); me.rotation.y = Math.PI; g.add(me); }
    g.userData.wheels = []; g.userData.size = { L: len, W: M.size.x * sc }; g.userData.model = name; return g;
  }
  const inst = M.root.clone(true); inst.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  inst.scale.setScalar(sc); inst.position.set(cxm * sc, -M.bb.min.y * sc, czm * sc); inst.rotation.y = Math.PI; // i modelli Kenney guardano +z; noi avanziamo verso -z
  g.add(inst); g.userData.wheels = []; inst.traverse(o => { if (/^wheel/i.test(o.name)) g.userData.wheels.push(o); });
  g.userData.size = { L: len, W: M.size.x * sc }; g.userData.model = name; return g;
}

// ---------- Garage: stats -> fisica ----------
let CARS = [{ id: 'berlina', name: 'Berlina', type: 'berlina', accel: 5, topSpeed: 200, grip: 6, handling: 6, color: '#9aa4b1' }];
let carDef = CARS[0];
const player = { y: 0, vy: 0, air: false, airT: 0, mesh: null, body: null, speed: 0, lane: 1, x: road.laneX(1), z: 0, health: 100, maxHealth: 100, h: 0, steer: 0, nitro: 1, distance: 0, gear: 1, rpm: 0, shiftT: 0, drift: 0, roll: 0, pitch: 0 };
function physOf(c) {
  return { max: (c.topSpeed || 200) / 3.6, power: 2.0 + (c.accel || 5) * .56, grip: 6.5 + (c.grip || 6) * .45, steer: .9 + (c.handling || 6) * .1, offroad: !!c.offroad,
    dmg: c.type === 'supercar' ? 1.25 : c.type === 'furgone' || c.type === 'SUV' || c.type === 'pick-up' ? .8 : 1 };
}
function buildPlayer() {
  if (player.mesh) laneSpace.remove(player.mesh);
  const col = carDef.color ? new THREE.Color(carDef.color).getHex() : undefined;
  player.mesh = new THREE.Group(); player.body = makeCar(carDef.type || 'berlina', { color: col, full: true }); player.mesh.add(player.body, headlight, hlTarget, coneMesh); laneSpace.add(player.mesh);
  player.phys = physOf(carDef);
}
function setCar(c) { if (!c) return; carDef = typeof c === 'string' ? (CARS.find(x => x.id === c) || CARS[0]) : c; buildPlayer(); }

// ---------- Post (niente bloom: luce sobria) ----------
let composer, useComposer = false, dynPR = 9, lowT = 0, highT = 0;
function setupPost() {
  const pr = Math.min([0.7, Math.min(devicePixelRatio, 1), Math.min(devicePixelRatio, 1.25)][quality], dynPR);
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = quality === 2; sun.castShadow = quality === 2;
  const ms = quality === 2 ? 1536 : 1024; sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  if (quality === 2 && !IS_TOUCH) composer.addPass(new SMAAPass(innerWidth * pr, innerHeight * pr));
  useComposer = quality === 2 && !IS_TOUCH; // altrimenti render diretto: niente passaggi a schermo intero extra
  composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// Input
const keys = {};
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => Audio.unlock(), { passive: true });
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); }); addEventListener('keyup', e => keys[e.code] = false);

// ---------- UI + eventi ----------
let msgT;
const ui = {
  setHeat: n => $('heat').textContent = n > 0 ? '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n)) : '',
  flash: (t, ms = 1800) => { const m = $('msg'); m.textContent = t; m.style.opacity = 1; clearTimeout(msgT); msgT = setTimeout(() => m.style.opacity = 0, ms); },
  show: id => $(id).classList.remove('hidden'), hide: id => $(id).classList.add('hidden'), el: $,
};
const listeners = {};
function on(n, f) { (listeners[n] ||= []).push(f); }
function emit(n, d) { (listeners[n] || []).forEach(f => { try { f(d, ctx); } catch (e) { console.error(e); } }); }
road.lanes = [0, 1, 2, 3].map(road.laneX); road.forward = -1; road.zOffset = 0; road.grip = 1;
function makeProp(path, width) { const M = Models.get(path), parts = Models.parts(path), g = new THREE.Group(); if (!M || !parts) return null; const sc = width / Math.max(.01, M.size.x);
  for (const pt of parts) { const m = new THREE.Mesh(pt.geometry, pt.material); m.castShadow = true; m.scale.setScalar(sc); m.position.y = -M.bb.min.y * sc; g.add(m); } return g; }
const ctx = { THREE, scene, camera, renderer, player, road, ui: $('ui'), hud: ui, makeCar, makeProp, keys, setEnvironment, setCar, state: { running: false, paused: false, time: 0 }, onEvent: emit, on, emit };
window.tratta = ctx; ctx.debug = {};
const modCtx = Object.create(ctx); modCtx.scene = laneSpace; // i moduli piazzano in coordinate di corsia
const DOTS = []; const DT = { x: 0, y: 0, z: 0, th: 0 };
function getDots() { // auto e volanti per la minimappa (coordinate mondo)
  let n = 0; const push = (x, z, cop) => { const d = DOTS[n] || (DOTS[n] = {}); Road.frame(-z, x, DT); d.x = DT.x; d.z = DT.z; d.cop = cop; n++; };
  for (const o of laneSpace.children) { if (o === player.mesh || !o.visible || o.isPoints || o.isInstancedMesh || !o.isGroup) continue;
    if (o.name === 'police') { for (const c of o.children) if (c.visible && c.isObject3D) push(c.position.x, player.z + c.position.z, true); } else push(o.position.x, o.position.z, false); }
  DOTS.length = n; return DOTS;
}
let Story, Police, Diff, shake = 0, slowT = 0, hitStop = 0;
// ---------- Radio di bordo: Lola, Tano (poi Dario) reagiscono a quello che fai ----------
const radioEl = document.createElement('div');
radioEl.style.cssText = 'position:fixed;left:50%;top:84px;transform:translateX(-50%);max-width:80vw;background:rgba(8,10,16,.82);border-left:4px solid #e63946;border-radius:8px;padding:8px 14px;font:600 16px system-ui,sans-serif;color:#fff;z-index:60;pointer-events:none;opacity:0;transition:opacity .25s';
document.body.appendChild(radioEl);
const RADIO = {
  near: [['lola', 'Per un pelo, Ruota!'], ['tano', 'Bravo Ruota! Così si guida!'], ['lola', 'L\'hai scampata per un pelo.'], ['tano', 'Madonna! Il cuore mio...']],
  heat: [['lola', 'Altre volanti in arrivo, sbrigati.'], ['tano', 'Ci stanno addosso, Ruota!'], ['lola', 'Li sento alla radio: ti vogliono chiudere davanti.']],
  heli: [['lola', 'Elicottero! Esci dalla sua luce!']],
  crash: [['tano', 'Una volante in meno! Ah-ah!'], ['lola', 'Si sono fatti male da soli. Adoro.']],
  hurt: [['lola', 'La macchina non regge, Ruota. Attento!'], ['tano', 'Me la riporti intera, sì?']],
  spin: [['tano', 'Piano! Mica è un autoscontro!'], ['lola', 'Controsterza, Ruota, controsterza!']],
  pit: [['lola', 'Ti hanno girato! Controsterza!'], ['tano', 'Bastardi, la manovra PIT!']],
  shortcut: [['lola', 'Bella scorciatoia, Ruota.'], ['tano', 'Questa la conosceva solo Dario!']],
  escaped: [['lola', 'Seminati. Respira.'], ['tano', 'Puliti. Lo sapevo io.']],
};
let radioT = 0, radioCd = 0;
function radio(kind, force) {
  if (!ctx.state.running || ctx.state.cinema || (radioCd > 0 && !force)) return;
  const l = RNG.pick(RADIO[kind] || []); if (!l) return;
  const N = { lola: ['Lola', '#c77dff'], tano: ['Zio Tano', '#e9c46a'], dario: ['Dario', '#4cc9f0'] }[l[0]];
  radioEl.innerHTML = `<span style="color:${N[1]}">📻 ${N[0]}:</span> ${l[1]}`; radioEl.style.opacity = 1;
  radioT = 2.6; radioCd = 6;
}
setInterval(() => { radioT -= .25; radioCd -= .25; if (radioT <= 0) radioEl.style.opacity = 0; }, 250);

on('damage', d => { const a = (typeof d === 'number' ? d : d?.amount || 0) * (player.phys?.dmg || 1); player.health = Math.max(0, player.health - a); shake = Math.min(1, shake + a / 25); if (player.health <= 0) { emit('playerDestroyed'); } });
on('collision', d => { shake = Math.min(1, shake + (d?.damage || 5) / 25); player.h += (Math.random() - .5) * .25; Story?.notify('crash', d); });
on('playerDestroyed', () => Story?.notify('playerDead'));
on('heatChange', d => { ui.setHeat(d.to); Story?.notify('policeHeat', { heat: d.to / 5 }); });
on('busted', () => Story?.notify('busted'));
on('nearMiss', d => { Audio.whoosh(); slowT = d?.combo > 2 ? .6 : .4; shake = Math.min(1, shake + .15); navigator.vibrate?.(20); if (d?.combo >= 2 || RNG.rand() < .5) radio('near'); });
on('heatChange', d => { if (d.to > d.from) radio(d.to >= 5 ? 'heli' : 'heat'); });
on('pit', d => { if (!player.spinRate && player.speed > 12) { player.spinRate = d.dir * (1.6 + RNG.rand()); ui.flash('Manovra PIT!', 1000); radio('pit', true); shake = Math.min(1, shake + .4); Audio.thump(.9); navigator.vibrate?.(80); } });
on('spinStart', () => { shake = Math.min(1, shake + .2); if (RNG.rand() < .6) radio('spin'); });
on('policeCrash', () => { Audio.thump(.8); radio('crash', true); shake = Math.min(1, shake + .3); });
on('collision', d => { Audio.thump(Math.min(1, (d?.damage || 5) / 25)); if ((d?.damage || 0) > 15) { hitStop = .07; navigator.vibrate?.(60); } if (player.health < 35) radio('hurt'); });
on('escaped', () => radio('escaped', true));
on('policeCrash', () => ui.flash('Volante fuori gioco!', 1200));
on('escaped', () => { ui.flash('Seminati!'); Story?.notify('policeHeat', { heat: 0 }); });
on('pause', d => ctx.state.paused = !!d.paused);
on('cinema', d => ctx.state.cinema = !!d.active);
on('environment', d => setEnvironment(d.env));
on('chapterIntro', d => { if (d.time) setTimeOfDay(d.time); });
on('carSelected', d => setCar(d.car));
on('freeRoamPolice', d => Police?.setHeat(d.policeLevel));
function startLevel(d) {
  ctx.state.noSpeedTrap = d.mode === 'story' && d.type === 'escape';
  if (d.env) setEnvironment(d.env); setTimeOfDay(d.time || (d.mode === 'free' ? 'day' : TOD)); if (d.car) setCar(d.car);
  resetRun();
  Diff?.setDifficulty(d.difficulty >= 8 ? 3 : d.difficulty >= 5 ? 2 : d.difficulty <= 1 ? 0 : 1);
  Diff?.setMissionLevel(1 + ((d.difficulty || 1) - 1) * .15);
  Police?.setHeat(d.policeLevel > 0 ? d.policeLevel : 0);
  ui.hide('menu');
}
on('missionStart', d => { ctx.state.noSpeedTrap = d.type === 'escape'; if (!ctx.state.running || d.mission === 0 || ctx.state.failed) startLevel(d); else { Diff?.setMissionLevel(1 + ((d.difficulty || 1) - 1) * .15); if (d.policeLevel > 0) Police?.setHeat(Math.max(d.policeLevel, Police.getState().heat)); } ctx.state.failed = false; });
on('freeRoamStart', d => startLevel(d));
on('missionFailed', () => { ctx.state.running = false; ctx.state.failed = true; });
on('storyComplete', () => { ctx.state.running = false; });

function resetRun() {
  ctx.state.seed = RNG.reseed(ctx.debug.seed); randomizeRoad(); shortcuts.length = 0; nextSC = -300 - RNG.rand() * 200; prevX = road.laneX(1);
  buildPlayer(); Object.assign(player, { y: 0, vy: 0, air: false, airT: 0, spin: 0, spinRate: 0, spinRecover: false, speed: 14, x: road.laneX(1), z: 0, h: 0, steer: 0, lane: 1, nitro: 1, distance: 0, maxHealth: 100, health: 100, gear: 2, shiftT: 0, drift: 0 });
  ctx.state.time = 0; ctx.state.running = true; shake = 0; lastSector = null;
  Diff?.reset(modCtx); Police?.reset(); ui.setHeat(0);
}

// ---------- Fisica: marce, inerzia, freni, sterzo dipendente dalla velocità, aderenza/derapata, rollio ----------
const GEARS = [.24, .40, .55, .70, .85, 1];
function updatePlayer(dt) {
  const P = player.phys, k = keys;
  let gas = k.ArrowUp || k.KeyW, brake = k.ArrowDown || k.KeyS;
  if (ctx.debug.autopilot && ctx.debug.autoBrake !== false) { const lim = Math.sqrt(11 / Math.max(2e-4, Road.maxKappaAhead(-player.z, 40))); if (player.speed > lim) { gas = false; brake = player.speed > lim + 2; } } // pilota automatico (test): frena prima dei tornanti
  const nitro = k.Space && player.nitro > 0 && gas;
  const env = road.grip * (P.offroad && ENV !== 'city' ? 1.15 : 1);
  const max = P.max * (nitro ? 1.1 : 1) * (ENV === 'jungle' && !P.offroad ? .85 : 1);
  const v = player.speed, spd0 = Math.max(v, 1);
  // cambio automatico
  const top = max * GEARS[player.gear - 1];
  player.rpm = THREE.MathUtils.clamp(v / top, 0, 1.05);
  if (player.shiftT > 0) player.shiftT -= dt;
  else if (player.rpm > .97 && player.gear < 6) { player.gear++; player.shiftT = .22; }
  else if (player.gear > 1 && v < max * GEARS[player.gear - 2] * .62) player.gear--;
  const torque = .55 + .45 * Math.sin(Math.PI * Math.min(1, .25 + player.rpm * .8));
  let acc = 0;
  if (gas && player.shiftT <= 0) acc = P.power * torque * (1.45 - player.gear * .12) * (nitro ? 1.6 : 1) * (1 - Math.pow(v / max, 4));
  const drag = .4 + v * v * .00025 + (ENV === 'jungle' ? .8 : 0);
  if (brake) acc -= v > .5 ? 11 * Math.min(1, env + .2) : 0;
  acc -= drag;
  player.speed = Math.max(0, v + acc * dt);
  player.accel = acc;
  player.nitro = THREE.MathUtils.clamp(player.nitro + (nitro ? -.3 : .04) * dt, 0, 1);
  // sterzo: angolo massimo cala con la velocità; inerzia dello sterzo
  let st = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
  if (!st && HUD.input.steer) st = Math.abs(HUD.input.steer) < .06 ? 0 : HUD.input.steer; // cursore touch analogico
  if (ctx.debug.autopilot) { const tx = road.laneX(ctx.debug.autoLane ?? 1); const want = THREE.MathUtils.clamp(-(tx - player.x) * .08, -.35, .35); st = THREE.MathUtils.clamp((player.h - want) * 6 + kap(player.z) * spd0 * 40, -1, 1); }
  player.steer += (st - player.steer) * Math.min(1, dt * (st ? 4 : 6));
  const spd = Math.max(player.speed, 1);
  let yaw = -player.steer * P.steer * 1.6 / (1 + spd / 16);
  // Aderenza arcade-sim: tanta presa. Derapata SOLO col freno a mano (o sterzo estremo ad alta velocità);
  // testacoda solo se esageri davvero (freno a mano + tutto sterzo a velocità alta, senza controsterzare).
  const hb = !!(k.KeyH || k.ShiftLeft || k.ShiftRight || k.Handbrake) && spd > 10;
  const gripBase = (P.grip * 1.35 + 2) * env;           // ~15 m/s² laterali per la berlina
  const grip = gripBase * (hb ? .5 : 1);
  const lat = Math.abs(yaw) * spd;
  const extreme = !hb && lat > gripBase * 1.45 && spd > 38 && Math.abs(player.steer) > .9;
  if (hb || extreme) { // derapata progressiva e controllabile
    player.drift = Math.min(1, player.drift + dt * (hb ? 2.2 : 1.2));
    if (lat > grip) { yaw = Math.sign(yaw) * (grip / spd) * (1 + player.drift * .45); player.speed -= (lat - grip) * .25 * dt; }
    player.overT = (player.overT || 0) + (hb && Math.abs(player.steer) > .95 && spd > 34 && !(st && Math.sign(-st) !== Math.sign(yaw)) ? dt : -dt * 2);
  } else {
    player.drift = Math.max(0, player.drift - dt * 2.2); player.overT = Math.max(0, (player.overT || 0) - dt * 2);
    if (lat > grip) { yaw = Math.sign(yaw) * grip / spd; player.speed -= (lat - grip) * .3 * dt; } // sottosterzo dolce: allarga la traiettoria
  }
  if (player.overT > .9 && !player.spinRate) { player.spinRate = Math.sign(yaw) * 2.2; player.overT = 0; emit('spinStart', {}); }
  if (player.spinRate) {
    const counter = st && Math.sign(-st) === -Math.sign(player.spinRate) ? 1 : 0; // controsterzo = sterzo opposto alla rotazione
    player.spinRate += Math.sign(player.spinRate) * (gas ? .6 : .2) * dt - player.spinRate * (counter ? 3 : .9) * dt;
    player.spin += player.spinRate * dt; player.speed *= 1 - Math.min(.5, Math.abs(player.spinRate) * .18) * dt; player.drift = 1;
    if (Math.abs(player.spinRate) < .35 || player.speed < 3) { player.spinRate = 0; player.spinRecover = true; }
  } else if (player.spinRecover) { const tgt = Math.round(player.spin / (Math.PI * 2)) * Math.PI * 2; player.spin += (tgt - player.spin) * Math.min(1, dt * 3); if (Math.abs(tgt - player.spin) < .02) { player.spin = 0; player.spinRecover = false; } }
  // la strada curva sotto di te: se non sterzi, vai dritto verso il bordo
  if (player.air && player.airT > .06) yaw *= .15; // in volo lo sterzo quasi non conta
  player.h += (yaw + kap(player.z) * spd) * dt;
  if (!st) player.h *= 1 - Math.min(1, dt * .9); // allineamento naturale (aiuto guida)
  player.h = THREE.MathUtils.clamp(player.h, -.55, .55);
  player.x += -spd * Math.sin(player.h) * dt * (player.speed > 0.2 ? 1 : 0) + player.drift * Math.sign(-yaw) * -1.2 * dt;
  const lim = road.halfWidth + SH - 1;
  if (Math.abs(player.x) > lim) {
    const hit = Math.abs(player.h) * player.speed;
    player.x = Math.sign(player.x) * lim; player.h *= -.3; player.speed = Math.max(0, player.speed - (hit > 2 ? hit * .5 : 6 * dt));
    if (hit > 2) emit('damage', { amount: Math.min(12, hit * .6), source: 'guardrail' });
  }
  if (Math.abs(player.x) > road.halfWidth && !(shortcutAt(player.z) && Math.abs(player.x) > SC_LINE)) player.speed -= (ENV === 'city' ? 2 : 4) * dt; // banchina rallenta
  player.z -= player.speed * Math.cos(player.h) * dt; player.distance += player.speed * dt;
  player.lane = THREE.MathUtils.clamp(Math.round(player.x / LW + (LANES - 1) / 2), 0, LANES - 1);
  // rollio e beccheggio del corpo
  // quota: segue la strada; se la strada scende più in fretta della gravità (dossi, rampe) l'auto decolla
  const sR = -player.z, yR = Road.y(sR), GR = 15.5;
  if (player.air) {
    player.vy -= GR * dt; player.y += player.vy * dt; player.airT += dt;
    if (player.y <= yR) { const imp = Math.max(0, Road.slope(sR) * spd - player.vy); player.y = yR; player.air = false; player.vy = 0;
      if (player.airT > .25) { shake = Math.min(1, shake + Math.min(.6, imp * .05)); Audio.thump(Math.min(1, imp / 14)); player.speed *= imp > 12 ? .93 : .985; if (imp > 14) emit('damage', { amount: Math.min(10, (imp - 14) * 1.2), source: 'atterraggio' }); emit('landing', { airT: player.airT, impact: imp }); } }
  } else {
    const vyRoad = Road.slope(sR) * spd, ypp = (Road.y(sR + 1.5) - 2 * yR + Road.y(sR - 1.5)) / 2.25; // curvatura verticale della strada
    if (ypp * spd * spd < -GR && spd > 8) { player.air = true; player.airT = 0; player.vy = vyRoad; player.y = yR + .01; emit('airborne', {}); }
    else { player.y = yR; player.vy = vyRoad; }
  }
  const latAcc = (yaw + kap(player.z) * spd) * spd;
  player.roll += (THREE.MathUtils.clamp(latAcc * .014, -.12, .12) - player.roll) * Math.min(1, dt * 5);
  player.pitch += (THREE.MathUtils.clamp(-acc * .008, -.07, .07) - player.pitch) * Math.min(1, dt * 4);
  const m = player.mesh; m.position.set(player.x, player.y - yR, player.z); m.rotation.y = player.h + player.drift * -player.steer * .25 + (player.spin || 0);
  if (player.drift > .4 && player.speed > 8 && !player.air) emitDust(player.x, player.z + 1.8, player.drift);
  const airPitch = player.air ? Math.atan2(player.vy, spd) - Math.atan(Road.slope(sR)) : 0;
  player.body.rotation.set(player.pitch + airPitch * .8, 0, player.roll);
  for (const w of player.body.userData.wheels || []) w.rotation.x -= player.speed * dt / .35;
}

// laneSpace -> mondo curvo: sposto/ruoto prima del render, ripristino dopo
const bent = [];
const BF = { x: 0, y: 0, z: 0, th: 0 };
function bendObj(o, baseZ) {
  const s = -(baseZ + o.position.z);
  bent.push(o, o.position.x, o.position.y, o.position.z, o.rotation.y, o.rotation.x, o.rotation.order);
  Road.frame(s, o.position.x, BF);
  o.position.x = BF.x; o.position.y += BF.y; o.position.z = BF.z; o.rotation.order = 'YXZ'; o.rotation.y += -BF.th; o.rotation.x += Math.atan(Road.slope(s));
}
function bend() {
  for (const o of laneSpace.children) {
    if (o.name === 'police') { o.position.z = player.z; for (const c of o.children) bendObj(c, player.z); }
    else bendObj(o, 0);
  }
}
function unbend() { for (let i = 0; i < bent.length; i += 7) { const o = bent[i]; o.position.x = bent[i + 1]; o.position.y = bent[i + 2]; o.position.z = bent[i + 3]; o.rotation.y = bent[i + 4]; o.rotation.x = bent[i + 5]; o.rotation.order = bent[i + 6]; } bent.length = 0; }

const camPos = new THREE.Vector3(), look = new THREE.Vector3(), camBase = new THREE.Vector3(0, 3, 8), camVel = new THREE.Vector3(); let camT = 0;
// Camera: 'chase' (dietro) o 'hood' (cofano/abitacolo). Sensazione di velocità: FOV, vibrazione strada, guardare dentro la curva.
let camMode = localStorage.getItem('tratta-cam') || 'chase';
function toggleCam() { camMode = camMode === 'chase' ? 'hood' : 'chase'; localStorage.setItem('tratta-cam', camMode); ui.flash(camMode === 'hood' ? 'Visuale cofano' : 'Visuale esterna', 900); camBase.copy(camPos); camVel.set(0, 0, 0); }
addEventListener('keydown', e => { if (e.code === 'KeyC') toggleCam(); });
const lookOff = { v: 0 };
function updateCamera(dt) {
  const sp = player.speed, nit = keys.Space && player.nitro > 0 && (keys.ArrowUp || keys.KeyW), hood = camMode === 'hood';
  const fovT = (hood ? 66 : 60) + sp * .3 + (nit ? 12 : 0) - (slowT > 0 ? 8 : 0);
  camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
  const s = -player.z; Road.frame(s, player.x, BF); const wx = BF.x, wz = BF.z, wy = player.y ?? BF.y;
  const head = -BF.th + player.h + (player.spin || 0) * (hood ? 1 : 0); // direzione dell'auto nel mondo (rotation.y)
  // guardo dentro la curva: sterzo + curvatura davanti
  lookOff.v += ((player.steer * 1.6 + THREE.MathUtils.clamp(Road.kappa(s + 20) * 260, -5, 5)) - lookOff.v) * Math.min(1, dt * 3);
  if (hood) {
    camPos.set(wx - Math.sin(head) * .2, wy + 1.22 + (player.pitch || 0) * 2, wz - Math.cos(head) * .2);
    camBase.copy(camPos); camVel.set(0, 0, 0);
  } else {
    const ang = -BF.th + player.h * .35;
    const dist = 7 + sp * .025, hgt = 2.4 + sp * .006;
    camPos.set(wx + Math.sin(ang) * dist, Math.max(wy, Road.y(s - dist)) + hgt, wz + Math.cos(ang) * dist);
    const w = 9, kx = Math.min(dt, 1 / 30); // molla a smorzamento critico
    camBase.x += camVel.x * kx; camBase.y += camVel.y * kx; camBase.z += camVel.z * kx;
    camVel.x += (-2 * w * camVel.x - w * w * (camBase.x - camPos.x)) * kx; camVel.y += (-2 * w * camVel.y - w * w * (camBase.y - camPos.y)) * kx; camVel.z += (-2 * w * camVel.z - w * w * (camBase.z - camPos.z)) * kx;
    if (camBase.distanceToSquared(camPos) > 900) { camBase.copy(camPos); camVel.set(0, 0, 0); }
  }
  camera.position.copy(camBase);
  camT += dt; if (shake > 0) { camera.position.x += Math.sin(camT * 47) * shake * .25; camera.position.y += Math.sin(camT * 61 + 1) * shake * .15; shake = Math.max(0, shake - dt * 2.5); }
  // vibrazione della strada: cresce con la velocità, forte sulla banchina
  const off = Math.abs(player.x) > road.halfWidth && !player.air, rum = (sp > 20 ? (sp - 20) * .0009 : 0) * (hood ? 1.6 : 1) + (off && sp > 5 ? .035 : 0);
  if (rum) { camera.position.y += (Math.sin(camT * 71) * .6 + Math.sin(camT * 113) * .4) * rum; camera.position.x += Math.sin(camT * 89) * rum * .5; }
  sky.position.copy(camera.position); // cielo agganciato alla camera (far plane 1200 m)
  if (hood) { const fx = -Math.sin(head), fz = -Math.cos(head), rx = Math.cos(head), rz = -Math.sin(head); const L = lookOff.v * .5;
    look.set(camera.position.x + fx * 20 + rx * L, camera.position.y - .4 + Road.slope(s) * 20, camera.position.z + fz * 20 + rz * L); }
  else { Road.frame(s + 14, player.x * .9 + lookOff.v * .8, BF); look.set(BF.x, (wy + BF.y) / 2 + 1.2, BF.z); }
  camera.lookAt(look);
  if (hood) camera.rotateZ(-(player.roll || 0) * 1.5); // la carrozzeria rolla, e anche tu
  player.mesh.visible = !hood || Math.abs(player.spin || 0) > .3; // in abitacolo non vedi la tua auto da fuori
  sun.position.set(wx + sunDir.x * 150, wy + sunDir.y * 150, wz + sunDir.z * 150); sun.target.position.set(wx, wy, wz);
}


let lastSector = null;
const FIXED = 1 / 120; let acc = 0, steps = 0;
const clock = new THREE.Clock(); let fpsAcc = 0, fpsN = 0;
function step(dt) {
  try { Story?.update(dt, modCtx); } catch (e) { console.error(e); }
  if (ctx.state.running && !ctx.state.paused && !ctx.state.cinema) {
    const sec = Road.sectorAt(-player.z); if (sec && sec !== lastSector) { if (lastSector) { ui.flash(sec.name, 1800); Audio.whoosh?.(); } lastSector = sec; }
    ctx.state.time += dt; updatePlayer(dt); updateShortcuts(dt); Modes.update(dt);
    if (ctx.debug.ffLeft > 0) { const j = Math.min(150, ctx.debug.ffLeft); player.z -= j; player.distance += j; ctx.debug.ffLeft -= j; }
    for (const m of [ctx.debug.noTraffic ? null : Diff, ctx.debug.noPolice ? null : Police]) { try { m?.update(dt, modCtx); } catch (e) { console.error(e); } }
    if (ctx.debug.god) player.health = 100;
  } else if (player.mesh && !ctx.state.running) { player.z -= 10 * dt; player.y = Road.y(-player.z); player.air = false; player.mesh.position.set(player.x, 0, player.z); }
}
function loop() {
  requestAnimationFrame(loop);
  // Fisica a passo fisso (1/120 s): identica a 60 Hz e a 120 Hz ProMotion, niente scatti legati al frame rate.
  const raw = Math.min(clock.getDelta(), 1 / 15);
  if (hitStop > 0) { hitStop -= raw; }
  slowT = Math.max(0, slowT - raw); const ts = hitStop > 0 ? 0.05 : slowT > 0 ? 0.35 : 1;
  const dt = raw * ts;
  try { HUD.update(raw, ctx.state.running && !ctx.state.cinema && !ctx.state.paused); } catch (e) { console.error(e); }
  const n = ctx.debug.substeps || 1; // solo per test automatici
  const P0 = performance.now();
  if (n > 1) for (let i = 0; i < n; i++) step(1 / 20);
  else { acc += dt; let k = 0; while (acc >= FIXED && k++ < 16) { step(FIXED); acc -= FIXED; } if (k >= 16) acc = 0; steps = k; }
  HUD.tick(raw, ctx.state.running && !ctx.state.paused && !ctx.state.cinema);
  try { Audio.update({ rpm: player.rpm, speed: ctx.state.running && !ctx.state.paused ? player.speed : 0, throttle: !!(keys.ArrowUp || keys.KeyW), drift: player.drift, hood: camMode === 'hood', offroad: Math.abs(player.x) > road.halfWidth && !player.air, siren: ctx.state.running && !ctx.state.cinema ? Police?.nearest?.(player.x) : null, muted: !!ctx.state.cinema || !ctx.state.running }); } catch (e) {}
  updateDust(dt);
  if (player.mesh) { updateCamera(dt); updateScenery(player.z, dt); updateGlows(); updateNeon(player.z); }
  const P1 = performance.now();
  if (!(ctx.state.cinema && Cinema?.isMenuOpen?.())) { bend(); if (useComposer) composer.render(dt); else renderer.render(scene, camera); unbend(); }
  if (ctx.debug.prof) { const P2 = performance.now(); ctx.debug.prof.push([P1 - P0, P2 - P1, steps]); }
  fpsAcc += dt; fpsN++; if (fpsAcc > 2) { ctx.state.fps = fpsN / fpsAcc; fpsAcc = fpsN = 0; adaptQuality(ctx.state.fps); }
}

// Qualità adattiva: se gli FPS scendono sotto 45 abbassa la risoluzione interna (mai sotto 0.7), poi la rialza.
function adaptQuality(fps) {
  if (!ctx.state.running || ctx.state.paused || ctx.state.cinema || ctx.debug.noAdapt) return;
  const cur = renderer.getPixelRatio();
  if (fps < 45) { highT = 0; if (++lowT >= 2 && cur > .7) { dynPR = Math.max(.7, cur - .15); setupPost(); lowT = 0; } }
  else if (fps > 58) { lowT = 0; if (++highT >= 4 && dynPR < 9) { dynPR = cur + .1; if (dynPR >= [0.7, Math.min(devicePixelRatio, 1), Math.min(devicePixelRatio, 1.25)][quality]) dynPR = 9; setupPost(); highT = 0; } }
}

// ---------- Polvere/fumo in derapata: pool di Points, costo minimo ----------
const DUST_N = 160, dustPos = new Float32Array(DUST_N * 3), dustLife = new Float32Array(DUST_N), dustVel = new Float32Array(DUST_N * 3); let dustI = 0;
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0xcfc6b8, size: 1.1, transparent: true, opacity: .45, depthWrite: false });
const dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; scene.add(dust); // in coordinate mondo
for (let i = 0; i < DUST_N; i++) dustPos[i * 3 + 1] = -9999;
const DF = { x: 0, y: 0, z: 0, th: 0 };
function emitDust(x, z, k) { Road.frame(-z, x, DF); const c = Math.cos(DF.th), sn = Math.sin(DF.th); for (let n = 0; n < 2; n++) { const i = dustI++ % DUST_N, j = i * 3, l = (RNG.rand() - .5) * 1.6; dustPos[j] = DF.x + c * l; dustPos[j + 1] = DF.y + .3; dustPos[j + 2] = DF.z + sn * l; const b = 2 + RNG.rand() * 2; dustVel[j] = (RNG.rand() - .5) * 2 - Math.sin(DF.th) * b; dustVel[j + 1] = 1 + RNG.rand(); dustVel[j + 2] = Math.cos(DF.th) * b; dustLife[i] = .9 * k; } }
function updateDust(dt) { for (let i = 0; i < DUST_N; i++) { if (dustLife[i] <= 0) continue; dustLife[i] -= dt; for (let a = 0; a < 3; a++) dustPos[i * 3 + a] += dustVel[i * 3 + a] * dt; if (dustLife[i] <= 0) dustPos[i * 3 + 1] = -9999; } dustGeo.attributes.position.needsUpdate = true;
  dustMat.color.set(ENV === 'desert' ? 0xe0c08a : ENV === 'jungle' ? 0x7a6040 : 0xcfcfcf); }

// Luci notturne economiche: aloni additivi sui lampioni (instanced, niente luci reali) + cielo a gradiente
const glowTex = canvasTex(64, 64, (g, w, h) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,220,150,1)'); r.addColorStop(.3, 'rgba(255,180,90,.5)'); r.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 40);
glows.frustumCulled = false; glows.visible = false; scene.add(glows);
function updateGlows() { if (!glows.visible) return; const H = World.lampHeads(); let n = 0; for (const h of H) { if (n >= 40) break; dummy.position.set(h[0], h[1], h[2]); dummy.quaternion.copy(camera.quaternion); dummy.scale.setScalar(1); dummy.updateMatrix(); glows.setMatrixAt(n++, dummy.matrix); } glows.count = n; glows.instanceMatrix.needsUpdate = true; }
const nightSky = canvasTex(4, 256, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, '#02040a'); r.addColorStop(.55, '#0b1430'); r.addColorStop(.8, '#2a2340'); r.addColorStop(1, '#3a2a30'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
nightSky.wrapS = nightSky.wrapT = THREE.ClampToEdgeWrapping;

// ---------- Scorciatoie: corsia stretta sulla banchina, separata da paletti. Entri solo dall'imbocco;
// dentro niente traffico e la polizia che prova a seguirti di lato si schianta sui paletti. ----------
const SC_LINE = road.halfWidth + .25, SC_LEN = 130;
const shortcuts = []; let nextSC = -350;
const bollardM = new THREE.MeshLambertMaterial({ color: 0xffc400 });
const bollards = new THREE.InstancedMesh(new THREE.CylinderGeometry(.14, .16, 1, 6).translate(0, .5, 0), bollardM, 80); bollards.frustumCulled = false; bollards.count = 0; scene.add(bollards); // mondo: posizioni dalla spline
const arrowTex = canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#111'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffc400'; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(14 + i * 38, 10); g.lineTo(40 + i * 38, 32); g.lineTo(14 + i * 38, 54); g.lineTo(26 + i * 38, 54); g.lineTo(52 + i * 38, 32); g.lineTo(26 + i * 38, 10); g.fill(); } });
const scSigns = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .9), new THREE.MeshBasicMaterial({ map: arrowTex })); m.position.y = 1.6; m.visible = false; laneSpace.add(m); return m; });
function shortcutAt(z) { for (const c of shortcuts) if (z <= c.z0 && z >= c.z0 - c.len) return { side: c.side, line: SC_LINE, inner: z < c.z0 - 5, c }; return null; }
function updateShortcuts(dt) {
  const pz = player.z; bollCd -= dt;
  if (pz < nextSC + 260 && shortcuts.length < 2) { shortcuts.push({ z0: nextSC, len: SC_LEN, side: RNG.rand() < .5 ? -1 : 1, used: false, inside: false }); nextSC -= 420 + RNG.rand() * 380; }
  for (let i = shortcuts.length - 1; i >= 0; i--) if (pz < shortcuts[i].z0 - shortcuts[i].len - 40) shortcuts.splice(i, 1);
  let n = 0; scSigns.forEach(m => m.visible = false);
  shortcuts.forEach((c, k) => { for (let z = c.z0 - 2; z > c.z0 - c.len && n < 80; z -= 4.2) { Road.frame(-z, c.side * SC_LINE, DF); dummy.position.set(DF.x, DF.y, DF.z); dummy.rotation.set(0, -DF.th, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bollards.setMatrixAt(n++, dummy.matrix); }
    const sg = scSigns[k]; if (sg) { sg.visible = true; sg.position.set(c.side * (SC_LINE + 1.2), 1.6, c.z0 + 6); sg.rotation.y = 0; sg.scale.x = c.side; } });
  bollards.count = n; bollards.instanceMatrix.needsUpdate = true;
  // giocatore
  const sc = shortcutAt(pz), inLane = Math.abs(player.x) > SC_LINE && Math.sign(player.x) === sc?.side;
  if (sc) {
    if (sc.inner && Math.sign(player.x) === sc.side && (Math.abs(prevX) - SC_LINE) * (Math.abs(player.x) - SC_LINE) < 0) { // attraversa i paletti di lato
      player.x = prevX; player.h *= -.3; if (bollCd <= 0) { bollCd = .6; player.speed *= .85; emit('damage', { amount: 6, source: 'paletti' }); shake = Math.min(1, shake + .3); Audio.thump(.6); }
    } else if (inLane && !sc.c.inside) { sc.c.inside = true; }
  }
  for (const c of shortcuts) if (c.inside && !c.used && pz < c.z0 - c.len) { c.used = true; player.nitro = Math.min(1, player.nitro + .5); ui.flash('Scorciatoia! +nitro', 1300); emit('shortcut', {}); radio('shortcut', true); }
  prevX = player.x;
}
let prevX = 0, bollCd = 0;
// insegne al neon (solo città di notte): 3 instanced mesh, un draw call ciascuna
const NEON = ['PIZZA', 'BAR', 'HOTEL'].map((t, k) => { const col = ['#ff3b6b', '#3bf0ff', '#c77dff'][k];
  const tx = canvasTex(256, 96, (g, w, h) => { g.fillStyle = '#0a0a10'; g.fillRect(0, 0, w, h); g.strokeStyle = col; g.lineWidth = 5; g.shadowColor = col; g.shadowBlur = 18; g.strokeRect(8, 8, w - 16, h - 16); g.font = 'bold 56px system-ui'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText(t, w / 2, 68); });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 1.2), new THREE.MeshBasicMaterial({ map: tx, fog: true }), 8); im.frustumCulled = false; im.visible = false; scene.add(im); return im; });
function updateNeon(pz) { if (!NEON[0].visible) return; NEON.forEach((im, k) => { for (let i = 0; i < 8; i++) { const z = Math.floor(pz / 90) * 90 - i * 90 - k * 30 + 10, sd = (i + k) % 2 ? 1 : -1;
  Road.frame(-z, sd * (TOTAL_W / 2 + 4.6), DF); dummy.position.set(DF.x, DF.y + 4.5 + ((i * 7 + k * 3) % 3), DF.z); dummy.rotation.set(0, -DF.th + (sd > 0 ? -1 : 1) * 1.2, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); } im.instanceMatrix.needsUpdate = true; }); }
// cono dei fari: mesh additiva, niente luce volumetrica
const coneMesh = new THREE.Mesh(new THREE.ConeGeometry(4.5, 26, 16, 1, true).rotateX(Math.PI / 2).translate(0, .9, -14), new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: .035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
coneMesh.visible = false;
// env map notturna: scena minuscola con strisce calde -> riflessi sull'asfalto bagnato e sulle auto
const nightEnvScene = new THREE.Scene(); nightEnvScene.background = new THREE.Color(0x05070d);
for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(2, .5, 8), new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffb060 : 0x60c0ff })); const a = i / 10 * Math.PI * 2; m.position.set(Math.cos(a) * 20, 6 + (i % 3) * 3, Math.sin(a) * 20); m.lookAt(0, 0, 0); nightEnvScene.add(m); }
let nightEnv = null;

// ---------- Ora del giorno (deve combaciare con le cutscene) ----------
let TOD = "day"; var todReady = true;
const headlight = new THREE.SpotLight(0xfff2d0, 0, 90, .55, .6, 1.2); headlight.position.set(0, 1, -1.5); const hlTarget = new THREE.Object3D(); hlTarget.position.set(0, 0, -30); headlight.target = hlTarget;
function setTimeOfDay(t) {
  TOD = t === 'night' || t === 'dusk' ? t : 'day';
  const L = ENV_LOOK[ENV], night = TOD === 'night', dusk = TOD === 'dusk';
  const elev = night ? -6 : dusk ? 4 : L.sun[0] > 60 ? 50 : L.sun[0];
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(L.sun[1]));
  su.sunPosition.value.copy(sunDir); su.rayleigh.value = night ? .2 : dusk ? 3 : L.ray; su.turbidity.value = night ? 1 : L.turb;
  const lights = []; scene.traverse(o => { if (o.isHemisphereLight || o.isDirectionalLight) lights.push(o); });
  for (const o of lights) {
    o.userData.base ??= { i: o.intensity, c: o.color.getHex() };
    o.intensity = o.userData.base.i * (night ? (o.isHemisphereLight ? .28 : .12) : dusk ? .65 : 1);
    o.color.set(o.userData.base.c); if (night) o.color.lerp(new THREE.Color(0x6f86c8), .6); else if (dusk) o.color.lerp(new THREE.Color(0xff9a5a), .45);
  }
  if (scene.fog) { scene.fog._base ??= scene.fog.color.getHex(); scene.fog.color.set(night ? 0x0b1020 : dusk ? 0x6a4a52 : scene.fog._base); }
  if (envMap) envMap.dispose(); skyScene.add(sky); envMap = pmrem.fromScene(skyScene, 0.04).texture; scene.add(sky); scene.environment = envMap;
  scene.background = night ? nightSky : null; sky.visible = !night; glows.visible = night && (ENV === 'city');
  NEON.forEach(m => m.visible = night && ENV === 'city'); coneMesh.visible = night;
  try { World.setNight(night ? 1 : dusk ? .3 : 0); } catch (e) {}
  if (night) { nightEnv ||= pmrem.fromScene(nightEnvScene, 0.02).texture; scene.environment = nightEnv; }
  roadMat.roughness = night ? .42 : .88; roadMat.metalness = night ? .15 : 0; roadMat.envMapIntensity = night ? 1.4 : 1; roadMat.needsUpdate = true;
  renderer.toneMappingExposure = night ? 1.15 : dusk ? .95 : .9;
  headlight.intensity = night ? 140 : dusk ? 40 : 0;
  ctx.state.timeOfDay = TOD;
}

// ---------- Menu impostazioni ----------
function markQ() { document.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('active', +x.dataset.q === quality)); }
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { quality = +b.dataset.q; localStorage.setItem('tratta-q', quality); markQ(); setupPost(); if (true || Env) setEnvironment(ENV); });
$('ovRetry').onclick = () => ui.hide('over'); $('ovMenu').onclick = () => { ui.hide('over'); Story?.openMainMenu?.(); };
HUD.init({ ctx, isTouch: IS_TOUCH, getDots });
HUD.topButton('☰', 'Menu', () => { if (ctx.state.running) Story?.openMainMenu?.(); });
HUD.topButton('🎥', 'Visuale (C)', () => toggleCam());
HUD.topButton('⚙', 'Grafica', () => $('menu').classList.toggle('hidden'));
$('menuClose').onclick = () => { ui.hide('menu'); if (ctx.state.settingsFromMenu) { ctx.state.settingsFromMenu = false; ctx.openMainMenu?.(); } };

async function loadModules() {
  const imp = async n => { try { return await import(`./${n}.js`); } catch (e) { console.error('modulo', n, e); } };
  Diff = await imp('difficulty'); Police = await imp('police'); Story = await imp('story');
  if (Story?.CARS) { CARS = Story.CARS; carDef = Story.getState?.().car || CARS[0]; }
  Cinema = await imp('cinema');
  if (Story && Cinema) {
    try { Cinema.init({ ui: document.body, onEvent: emit, quality }); } catch (e) { console.error(e); Cinema = null; }
  }
  if (Story && Cinema) {
    const cut = id => ctx.debug.skipCinema ? null : Cinema.playCutscene(id, ctx);
    ctx.openMainMenu = () => { ctx.state.running = false; Cinema.openMenu({
      onStoria: () => { if (!localStorage.getItem('tratta-intro') && !ctx.debug.skipCinema) { localStorage.setItem('tratta-intro', '1'); Promise.resolve(Cinema.playCutscene('intro', ctx)).finally(() => Story.openChapterSelect()); } else Story.openChapterSelect(); },
      onFree: () => Story.openFreeRoamMenu(), onGarage: () => Story.openGarage(), onSettings: () => { ctx.state.settingsFromMenu = true; ui.show('menu'); } }); };
    Story.setHooks({ mainMenu: ctx.openMainMenu, beforeChapter: i => cut('chapter' + (i + 1)), afterChapter: i => cut('twist' + (i + 1)) });
  }
  let trafCache = [], trafFrame = -1;
  modCtx.traffic = () => { if (trafFrame !== ctx.state.time) { trafFrame = ctx.state.time; trafCache = Diff?.getVehicles?.() || []; } return trafCache; }; modCtx.shortcutAt = shortcutAt; ctx.debug.shortcuts = shortcuts; ctx.debug.bollards = bollards;
  try { Modes.init(ctx, Story, Police); Story?.setHooks?.({ daily: () => Modes.startDaily(), infinite: () => Modes.startInfinite() }); } catch (e) { console.error(e); }
  Diff?.init(modCtx); Police?.init(modCtx); Story?.init(modCtx);
  Object.assign(ctx.debug, { Road, World, HUD, Story, Police, Diff, Cinema, closeCinema: () => Cinema?.isMenuOpen?.() ? Cinema.closeMenu() : null, modCtx, laneSpace, ff: m => { ctx.debug.ffLeft = m; } });
}

markQ(); setupPost();
// modelli GLB (auto + scenografia) prima di tutto: niente cubi provvisori a schermo
const loadT0 = performance.now();
await Promise.all([Models.loadAll([...CAR_FILES.map(n => 'cars/' + n), 'road/construction-barrier']), World.init({ scene, edge: TOTAL_W / 2 + CURB, half: ROAD_W / 2 })]).catch(e => console.error(e));
ctx.debug.loadMs = performance.now() - loadT0;
await loadModules().catch(e => console.error(e));

// Precompila shader e carica su GPU tutte le auto del pool prima di guidare: niente scatti alla prima volante/auto
function prewarm() {
  try {
    const meshes = [...(Diff?.prewarm?.(modCtx) || []), ...(Police?.prewarm?.() || [])];
    meshes.forEach((m, i) => { m.position.set((i % 6 - 3) * 3, 0, player.z - 20 - (i / 6 | 0) * 6); laneSpace.add(m); });
    World.showAllForCompile(true); renderer.compile(scene, camera); World.showAllForCompile(false); bend(); renderer.render(scene, camera); unbend();
    meshes.forEach(m => laneSpace.remove(m));
  } catch (e) { console.error(e); }
}
setEnvironment(Story?.getState?.().env || 'city'); buildPlayer(); player.speed = 10; prewarm();
loop();
