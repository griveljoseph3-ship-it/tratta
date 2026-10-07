// Tratta — core grafico + integrazione moduli.
// Convenzioni: avanti = -Z, metri, m/s. ctx condiviso con story/police/difficulty.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = id => document.getElementById(id);
const LANES = 4, LW = 3.6, ROAD_W = LANES * LW;
const road = { lanes: LANES, laneWidth: LW, width: ROAD_W, laneX: i => (i - (LANES - 1) / 2) * LW, halfWidth: ROAD_W / 2 };

let quality = +(localStorage.getItem('tratta-q') ?? 2);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc9926e, 0.0019);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);

// Cielo (Sky shader) + una luce solare + emisfero. Niente bloom.
const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
const su = sky.material.uniforms; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
const pmrem = new THREE.PMREMGenerator(renderer);
const hemi = new THREE.HemisphereLight(0xdfeaff, 0x4a4a3a, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.4); sun.castShadow = true;
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 320; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
scene.add(sun, sun.target);
// ---------- Strada con curve: centro strada cx(z) ----------
const A1 = 90, K1 = 1 / 450, A2 = 35, K2 = 1 / 180;
const cx = z => A1 * Math.sin(z * K1) + A2 * Math.sin(z * K2 + 1);
const dcx = z => A1 * K1 * Math.cos(z * K1) + A2 * K2 * Math.cos(z * K2 + 1);
const ddcx = z => -A1 * K1 * K1 * Math.sin(z * K1) - A2 * K2 * K2 * Math.sin(z * K2 + 1);
road.centerX = cx; road.slope = dcx;
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
const groundTex = {
  city: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#4d6b2a'; g.fillRect(0, 0, w, h); noise(g, w, h, 12000, () => `hsl(${75 + Math.random() * 25},${35 + Math.random() * 15}%,${16 + Math.random() * 16}%)`); }),
  jungle: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#25401a'; g.fillRect(0, 0, w, h); noise(g, w, h, 14000, () => `hsl(${90 + Math.random() * 40},${40 + Math.random() * 20}%,${8 + Math.random() * 16}%)`); }),
  desert: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d8b47a'; g.fillRect(0, 0, w, h); noise(g, w, h, 12000, () => `hsl(${33 + Math.random() * 8},${45 + Math.random() * 15}%,${58 + Math.random() * 16}%)`); }),
};

// Nastro stradale ricostruito ogni frame lungo la curva
const ROWS = 200, STEP = 4;
function makeRibbon(x0, x1, y, mat, vLen) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(ROWS * 2 * 3), uv = new Float32Array(ROWS * 2 * 2), idx = [];
  for (let r = 0; r < ROWS - 1; r++) { const a = r * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
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
function updateRibbons(pz) {
  const z0 = Math.floor(pz / STEP) * STEP + 60;
  for (const rb of ribbons) {
    const p = rb.m.geometry.attributes.position.array, u = rb.m.geometry.attributes.uv.array;
    for (let r = 0; r < ROWS; r++) {
      const z = z0 - r * STEP, c = cx(z), s = dcx(z), n = 1 / Math.sqrt(1 + s * s);
      // normale laterale alla curva
      const nx = n, nz = -s * n;
      p.set([c + rb.x0 * nx, rb.y, z + rb.x0 * nz, c + rb.x1 * nx, rb.y, z + rb.x1 * nz], r * 6);
      u.set([0, -z / rb.vLen, 1, -z / rb.vLen], r * 4);
    }
    rb.m.geometry.attributes.position.needsUpdate = rb.m.geometry.attributes.uv.needsUpdate = true;
    rb.m.geometry.computeVertexNormals(); rb.m.geometry.computeBoundingSphere();
  }
}
const groundMat = new THREE.MeshStandardMaterial({ map: groundTex.city, roughness: 1 });
groundTex.city.repeat.set(160, 160); groundTex.jungle.repeat.set(160, 160); groundTex.desert.repeat.set(120, 120);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; scene.add(ground);

// ---------- Scenografia per ambiente (InstancedMesh, colori per istanza) ----------
const SC_SPAN = 1400;
const envSets = { city: [], jungle: [], desert: [] };
const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
function merge(list) { return BufferGeometryUtils.mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g), false); }
function scatter(env, geo, mat, items, opts = {}) {
  const im = new THREE.InstancedMesh(geo, mat, items.length); im.castShadow = opts.shadow !== false; im.receiveShadow = true; im.frustumCulled = false;
  items.forEach((it, i) => { if (it.col && !opts.nocol) im.setColorAt(i, tmpC.set(it.col)); });
  scene.add(im); envSets[env].push({ im, items });
}
const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.random() * a.length | 0];
const side = () => Math.random() < .5 ? -1 : 1;
function items(n, f) { return Array.from({ length: n }, (_, i) => Object.assign({ x: 0, z: -Math.random() * SC_SPAN, sx: 1, sy: 1, sz: 1, r: 0, y: 0 }, f(i))); }
const std = (c, o = {}) => new THREE.MeshStandardMaterial((({ flat, ...r }) => Object.assign({ color: c, roughness: .85, flatShading: !!flat }, r))(o));

// Muri con finestre e persiane verdi (texture), tinti per istanza
const wallTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); noise(g, w, h, 4000, () => `rgba(0,0,0,${Math.random() * .06})`);
  for (let fy = 0; fy < 2; fy++) for (let fx = 0; fx < 3; fx++) {
    const x = 26 + fx * 80, y = 30 + fy * 128;
    g.fillStyle = '#2f5a3a'; g.fillRect(x - 14, y, 12, 64); g.fillRect(x + 34, y, 12, 64);
    g.fillStyle = '#1b2430'; g.fillRect(x, y, 32, 64); g.fillStyle = '#e8e2d4'; g.fillRect(x - 3, y + 64, 38, 5);
  }
}, [1, 1]);
const house = std(0xffffff, { map: wallTex, roughness: .9 });
const roof = std(0xffffff, { flat: true, roughness: .8 });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const hip = (w, d, h) => { const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4); g.scale(w, h, d); return g.translate(0, h / 2, 0); };
const WALL_COLS = [0xf1dcb5, 0xe9b98a, 0xf3e6d0, 0xd99a74, 0xf0cfa0, 0xe7c3b0, 0xfaf3e3];
// varianti: casa, palazzina, villa lunga
const HV = [[8, 6, 7], [10, 13, 9], [16, 6.5, 8]];
HV.forEach(([w, h, d], vi) => {
  const its = items(vi === 1 ? 26 : 22, () => ({ x: side() * rnd(vi === 1 ? 20 : 26, 110), r: rnd(-.3, .3), col: pick(WALL_COLS), sx: rnd(.85, 1.2), sy: rnd(.9, 1.3), sz: rnd(.85, 1.2) }));
  const wg = box(w, h, d); wg.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 0) a[i] = v * w / 8; else a[i] = v * h / 6.5; });
  scatter('city', wg, house, its);
  scatter('city', hip(w * 1.12, d * 1.12, 2.6).translate(0, h, 0), roof, its.map(it => ({ ...it, col: pick([0xb5552f, 0xa8492a, 0xc0653b]) })));
});
// alberi città/campagna: cipressi, pini marittimi, latifoglie
const trunkM = std(0x5a3d26);
const cypT = new THREE.CylinderGeometry(.18, .25, 1.5, 6).translate(0, .75, 0), cypG = new THREE.CylinderGeometry(.15, 1.1, 9, 9).translate(0, 5.8, 0);
const leafM = std(0xffffff, { flat: true });
tree('city', cypT, cypG, items(140, () => ({ x: side() * rnd(12, 70), s: 1, sy: rnd(.8, 1.3), col: pick([0x2e4a22, 0x35522a, 0x283f1d]) })));
const pineCan = new THREE.IcosahedronGeometry(1, 1); pineCan.scale(4.2, 1.3, 4.2);
const pineT = new THREE.CylinderGeometry(.22, .35, 7, 6).translate(0, 3.5, 0).rotateZ(.08), pineG = pineCan.translate(.6, 7.4, 0);
tree('city', pineT, pineG, items(70, () => ({ x: side() * rnd(14, 90), r: rnd(0, 6), sy: rnd(.85, 1.2), sx: rnd(.8, 1.2), sz: rnd(.8, 1.2), col: pick([0x3c5a2a, 0x4a6630]) })));
const roundT = new THREE.CylinderGeometry(.2, .3, 3, 6).translate(0, 1.5, 0), roundG = merge([new THREE.IcosahedronGeometry(2.2, 1).translate(0, 4.2, 0), new THREE.IcosahedronGeometry(1.6, 1).translate(1.3, 3.6, .6), new THREE.IcosahedronGeometry(1.5, 1).translate(-1.1, 3.8, -.7)]);
tree('city', roundT, roundG, items(110, () => ({ x: side() * rnd(12, 80), r: rnd(0, 6), sx: rnd(.8, 1.3), sy: rnd(.8, 1.3), sz: rnd(.8, 1.3), col: pick([0x557a2e, 0x6b8a35, 0x4a6b28, 0x7a8f3a]) })));
// tronchi colorati: per semplicità il colore istanza tinge tutto l'albero (foglie), tronco scuro via vertexColors no -> accettato
function tree(env, tg, cg, its) { scatter(env, tg, trunkM, its, { nocol: true }); scatter(env, cg, leafM, its); }
const metal = new THREE.MeshStandardMaterial({ color: 0xa0a5ad, metalness: .8, roughness: .4 });
const lampG = merge([new THREE.CylinderGeometry(.09, .13, 8, 8).translate(0, 4, 0), new THREE.BoxGeometry(1.6, .12, .3).translate(-.8, 8, 0), new THREE.BoxGeometry(.6, .1, .3).translate(-1.3, 7.9, 0)]);
const lampItems = Array.from({ length: 56 }, (_, i) => ({ x: (i % 2 ? 1 : -1) * (TOTAL_W / 2 + 1.4), z: -(i >> 1) * 50, r: i % 2 ? 0 : Math.PI, sx: 1, sy: 1, sz: 1, y: 0, lane: true, span: 1400 }));
scatter('city', lampG, metal, lampItems);
const railG = merge([new THREE.BoxGeometry(.1, .32, 8.2).translate(0, .7, 0), new THREE.BoxGeometry(.12, .75, .12).translate(0, .37, 0)]);
const railItems = env => Array.from({ length: 300 }, (_, i) => ({ x: (i % 2 ? 1 : -1) * (TOTAL_W / 2 + CURB + .6), z: -(i >> 1) * 8, r: 0, sx: 1, sy: 1, sz: 1, y: 0, lane: true, span: 1200 }));
scatter('city', railG, metal, railItems());
scatter('desert', railG, metal, railItems());
// giungla: alberi alti a ombrello, palme, felci, liane (alberi fitti vicino alla strada)
const jTreeT = new THREE.CylinderGeometry(.35, .6, 14, 7).translate(0, 7, 0), jTree = merge([new THREE.IcosahedronGeometry(1, 1).scale(6, 2.2, 6).translate(0, 14.5, 0), new THREE.IcosahedronGeometry(1, 1).scale(4, 1.8, 4).translate(2, 11.5, 1)]);
tree('jungle', jTreeT, jTree, items(170, () => ({ x: side() * rnd(11, 60), r: rnd(0, 6), sx: rnd(.7, 1.3), sy: rnd(.7, 1.4), sz: rnd(.7, 1.3), col: pick([0x1f4d1a, 0x2d6a22, 0x245c1d, 0x3a7a28]) })));
const frond = () => new THREE.ConeGeometry(.6, 4.5, 4).scale(1, 1, .25).rotateZ(Math.PI / 2.4).translate(2, 0, 0);
const palmT = new THREE.CylinderGeometry(.2, .32, 9, 6).translate(0, 4.5, 0), palmParts = [];
for (let k = 0; k < 7; k++) palmParts.push(frond().rotateY(k * Math.PI * 2 / 7).translate(0, 9, 0));
const palmG = merge(palmParts);
tree('jungle', palmT, palmG, items(120, () => ({ x: side() * rnd(10, 50), r: rnd(0, 6), sy: rnd(.8, 1.2), col: pick([0x4b7a2a, 0x3f6e25, 0x5c8a30]) })));
const fernG = merge([0, 1, 2, 3, 4].map(k => new THREE.ConeGeometry(.5, 2.4, 4).scale(1, 1, .3).rotateZ(1).rotateY(k * 1.25).translate(0, .6, 0)));
scatter('jungle', fernG, leafM, items(260, () => ({ x: side() * rnd(TOTAL_W / 2 + 1.2, 25), r: rnd(0, 6), sx: rnd(.7, 1.6), sy: rnd(.7, 1.6), sz: rnd(.7, 1.6), col: pick([0x3d8a2a, 0x2f7020, 0x4f9a33]) }), { shadow: false }));
// deserto: dune, cactus saguaro, rocce, pali di legno
const sandM = std(0xe0b77c, { flat: false, roughness: 1 });
scatter('desert', new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), sandM, items(40, () => ({ x: side() * rnd(40, 260), sx: rnd(30, 70), sy: rnd(6, 18), sz: rnd(25, 60), r: rnd(0, 3), col: pick([0xe3bb80, 0xd9ac6c, 0xeac690]) })), { shadow: false });
const cactG = merge([new THREE.CylinderGeometry(.35, .4, 5, 8).translate(0, 2.5, 0), new THREE.CylinderGeometry(.25, .25, 1.4, 8).rotateZ(Math.PI / 2).translate(.8, 2.2, 0), new THREE.CylinderGeometry(.24, .26, 2, 8).translate(1.4, 3.1, 0), new THREE.CylinderGeometry(.22, .22, 1.1, 8).rotateZ(Math.PI / 2).translate(-.65, 2.9, 0), new THREE.CylinderGeometry(.2, .22, 1.5, 8).translate(-1.1, 3.6, 0)]);
scatter('desert', cactG, std(0xffffff), items(110, () => ({ x: side() * rnd(TOTAL_W / 2 + 3, 70), r: rnd(0, 6), sy: rnd(.7, 1.4), col: pick([0x4f7a3a, 0x5d8a44, 0x466d33]) })));
scatter('desert', new THREE.DodecahedronGeometry(1, 0), std(0xffffff, { flat: true }), items(90, () => ({ x: side() * rnd(TOTAL_W / 2 + 2, 90), r: rnd(0, 6), sx: rnd(.6, 3), sy: rnd(.4, 2), sz: rnd(.6, 3), y: 0.2, col: pick([0xa8714a, 0x9a6440, 0xb88158]) })));
const poleG = merge([new THREE.CylinderGeometry(.12, .15, 7, 6).translate(0, 3.5, 0), new THREE.BoxGeometry(1.8, .12, .12).translate(0, 6.5, 0)]);
scatter('desert', poleG, std(0x6b4a2e), Array.from({ length: 30 }, (_, i) => ({ x: TOTAL_W / 2 + 6, z: -i * 46, r: 0, sx: 1, sy: 1, sz: 1, y: 0, span: 1380 })));

let ENV = 'city';
const ENV_LOOK = {
  city: { fog: 0xc8d3dc, density: .0016, sun: [72, 200], hemi: [0xdfeaff, 0x4a4a3a, 1.1], sunC: 0xfff0dc, sunI: 2.4, road: 'asphalt', turb: 6, ray: 1.6 },
  jungle: { fog: 0x9fb39a, density: .0045, sun: [55, 150], hemi: [0xcfe6c0, 0x2a3a1e, .9], sunC: 0xfff3d0, sunI: 2.0, road: 'mud', turb: 10, ray: 2.5 },
  desert: { fog: 0xe8d6b8, density: .0013, sun: [40, 170], hemi: [0xfff0d8, 0x8a6a40, 1.15], sunC: 0xfff2d6, sunI: 3.0, road: 'sand', turb: 4, ray: 1 },
};
const sunDir = new THREE.Vector3();
function setEnvironment(env) {
  if (env && typeof env === 'object') env = env.id;
  if (!ENV_LOOK[env]) env = 'city';
  ENV = env; const L = ENV_LOOK[env];
  for (const k in envSets) for (const s of envSets[k]) s.im.visible = !Env && k === env;
  scene.fog.color.set(L.fog); scene.fog.density = L.density;
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(L.sun[0]), THREE.MathUtils.degToRad(L.sun[1]));
  su.sunPosition.value.copy(sunDir); su.turbidity.value = L.turb; su.rayleigh.value = L.ray;
  hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2];
  sun.color.set(L.sunC); sun.intensity = L.sunI;
  roadMat.map = ROAD_TEX[L.road]; roadMat.needsUpdate = true; groundMat.map = groundTex[env]; groundMat.needsUpdate = true;
  for (const rb of ribbons.slice(1)) rb.m.visible = env !== 'jungle';
  if (envMap) envMap.dispose(); skyScene.add(sky); envMap = pmrem.fromScene(skyScene, 0.04).texture; scene.add(sky); scene.environment = envMap;
  road.grip = env === 'jungle' ? .75 : env === 'desert' ? .85 : 1;
  if (Env) {
    try { envCtx.shadows = quality > 0; Env.setEnvironment(env, envCtx); } catch (e) { console.error(e); }
    hemi.visible = sun.visible = false; // luci e nebbia dal modulo ambienti (un sole + emisfero)
  } else { hemi.visible = sun.visible = true; scene.fog = scene.fog || new THREE.FogExp2(L.fog, L.density); }
}
let Env = null, Cars = null;
const envCtx = Object.create(null);
let envMap = null; const skyScene = new THREE.Scene();

function updateScenery(pz, dt = 0) {
  if (Env) { try { Env.update(dt, envCtx); } catch (e) { console.error(e); } }
  else for (const s of envSets[ENV]) {
    s.items.forEach((it, i) => {
      const span = it.span || SC_SPAN;
      while (it.z > pz + 40) it.z -= span; while (it.z < pz - span + 40) it.z += span;
      const sl = dcx(it.z);
      dummy.position.set(it.x + cx(it.z), it.y, it.z); dummy.rotation.set(0, it.r + (it.lane ? Math.atan(sl) : 0), 0); dummy.scale.set(it.sx, it.sy, it.sz); dummy.updateMatrix(); s.im.setMatrixAt(i, dummy.matrix);
    });
    s.im.instanceMatrix.needsUpdate = true;
  }
  updateRibbons(pz);
  ground.position.set(cx(pz), -0.05, pz); const t = groundMat.map; const rep = t.repeat.x; t.offset.set(cx(pz) / 2400 * rep, -pz / 2400 * rep);
}

// ---------- Auto: modelli Kenney Car Kit (CC0) + fallback geometrico ----------
const MODELS = {}; const MODEL_FILES = ['sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'van', 'truck', 'taxi', 'race', 'race-future', 'police', 'delivery', 'truck-flat'];
async function loadModels() {
  const loader = new GLTFLoader();
  await Promise.all(MODEL_FILES.map(n => loader.loadAsync(`./models/${n}.glb`).then(g => {
    const root = g.scene; root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace; o.material.roughness = .55; o.material.metalness = .15; } });
    const bb = new THREE.Box3().setFromObject(root); const size = bb.getSize(new THREE.Vector3());
    MODELS[n] = { root, size, minY: bb.min.y, cz: (bb.min.z + bb.max.z) / 2, cx: (bb.min.x + bb.max.x) / 2 };
  }).catch(e => console.warn('modello', n, e))));
}
const TYPE_MODEL = { berlina: 'sedan', furgone: 'van', 'coupé': 'hatchback-sports', coupe: 'hatchback-sports', 'pick-up': 'truck', SUV: 'suv', suv: 'suv-luxury', 'muscle car': 'sedan-sports', muscle: 'sedan-sports', rally: 'race-future', supercar: 'race', police: 'police', truck: 'delivery', taxi: 'taxi' };
const TRAFFIC = ['sedan', 'sedan', 'suv', 'taxi', 'van', 'hatchback-sports', 'suv-luxury', 'truck', 'sedan-sports'];
// Lunghezze reali (m) a cui scalare i modelli
const LEN = { delivery: 7.5, 'truck-flat': 7.5, van: 5, truck: 5.3, suv: 4.7, 'suv-luxury': 4.8, race: 4.5, 'race-future': 4.4 };
function makeCar(kind = 'traffic', opts = {}) {
  let name = kind === 'traffic' ? pick(TRAFFIC) : kind === 'truck' ? pick(['delivery', 'truck-flat']) : (MODELS[kind] ? kind : TYPE_MODEL[kind] || 'sedan');
  const M = MODELS[name]; const g = new THREE.Group();
  if (!M) return Cars ? Cars.makeCar(kind === 'traffic' ? 'traffic' : name, opts) : fallbackCar(opts.color ?? 0x8899aa);
  const inst = M.root.clone(true);
  const len = LEN[name] || 4.4, s = len / Math.max(M.size.z, M.size.x);
  inst.scale.setScalar(s); inst.position.set(-M.cx * s, -M.minY * s, -M.cz * s);
  inst.rotation.y = Math.PI; inst.position.z *= -1; inst.position.x *= -1; // i modelli Kenney guardano +z; noi avanziamo verso -z
  if (false) inst.traverse(o => { if (o.isMesh && /body/i.test(o.name + (o.parent?.name || ''))) { o.material = o.material.clone(); o.material.color.set(opts.color); } });
  g.add(inst); g.userData.wheels = []; inst.traverse(o => { if (/wheel/i.test(o.name)) g.userData.wheels.push(o); });
  g.userData.size = { L: len, W: M.size.x * s }; return g;
}
function fallbackCar(color) {
  const g = new THREE.Group(); const paint = std(color, { metalness: .4, roughness: .4 });
  const b = new THREE.Mesh(box(1.85, .6, 4.4), paint); b.position.y = .3; g.add(b);
  const c = new THREE.Mesh(box(1.6, .5, 2.2), std(0x1a2230)); c.position.set(0, .9, .2); g.add(c);
  g.userData.wheels = []; g.userData.size = { L: 4.4, W: 1.85 }; return g;
}

// ---------- Garage: stats -> fisica ----------
let CARS = [{ id: 'berlina', name: 'Berlina', type: 'berlina', accel: 5, topSpeed: 200, grip: 6, handling: 6, color: '#9aa4b1' }];
let carDef = CARS[0];
const player = { mesh: null, body: null, speed: 0, lane: 1, x: road.laneX(1), z: 0, health: 100, maxHealth: 100, h: 0, steer: 0, nitro: 1, distance: 0, gear: 1, rpm: 0, shiftT: 0, drift: 0, roll: 0, pitch: 0 };
function physOf(c) {
  return { max: (c.topSpeed || 200) / 3.6, power: 2.0 + (c.accel || 5) * .56, grip: 6.5 + (c.grip || 6) * .45, steer: .9 + (c.handling || 6) * .1, offroad: !!c.offroad,
    dmg: c.type === 'supercar' ? 1.25 : c.type === 'furgone' || c.type === 'SUV' || c.type === 'pick-up' ? .8 : 1 };
}
function buildPlayer() {
  if (player.mesh) laneSpace.remove(player.mesh);
  const col = carDef.color ? new THREE.Color(carDef.color).getHex() : undefined;
  player.mesh = new THREE.Group(); player.body = makeCar(carDef.type || 'berlina', { color: col }); player.mesh.add(player.body); laneSpace.add(player.mesh);
  player.phys = physOf(carDef);
}
function setCar(c) { if (!c) return; carDef = typeof c === 'string' ? (CARS.find(x => x.id === c) || CARS[0]) : c; buildPlayer(); }

// ---------- Post (niente bloom: luce sobria) ----------
let composer;
function setupPost() {
  const pr = [0.75, 1, Math.min(devicePixelRatio, 1.75)][quality];
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = quality > 0; sun.castShadow = quality > 0;
  const ms = quality === 2 ? 2048 : 1024; sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  if (quality === 2) composer.addPass(new SMAAPass(innerWidth * pr, innerHeight * pr));
  composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// Input
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); }); addEventListener('keyup', e => keys[e.code] = false);
for (const [id, k] of [['tL', 'ArrowLeft'], ['tR', 'ArrowRight'], ['tB', 'ArrowDown'], ['tG', 'ArrowUp'], ['tN', 'Space']]) {
  const b = $(id); const up = e => { keys[k] = false; if (k === 'Space') keys.ArrowUp = keys._gasHeld || false; };
  b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture?.(e.pointerId); } catch {} keys[k] = true; if (k === 'ArrowUp') keys._gasHeld = true; if (k === 'Space') keys.ArrowUp = true; });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, e => { if (k === 'ArrowUp') keys._gasHeld = false; up(e); });
  b.addEventListener('contextmenu', e => e.preventDefault());
}

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
const ctx = { THREE, scene, camera, renderer, player, road, ui: $('ui'), hud: ui, makeCar, keys, setEnvironment, setCar, state: { running: false, paused: false, time: 0 }, onEvent: emit, on, emit };
window.tratta = ctx; ctx.debug = {};
const modCtx = Object.create(ctx); modCtx.scene = laneSpace; // i moduli piazzano in coordinate di corsia
let Story, Police, Diff, shake = 0;

on('damage', d => { const a = (typeof d === 'number' ? d : d?.amount || 0) * (player.phys?.dmg || 1); player.health = Math.max(0, player.health - a); shake = Math.min(1, shake + a / 25); if (player.health <= 0) { emit('playerDestroyed'); } });
on('collision', d => { shake = Math.min(1, shake + (d?.damage || 5) / 25); player.h += (Math.random() - .5) * .25; Story?.notify('crash', d); });
on('playerDestroyed', () => Story?.notify('playerDead'));
on('heatChange', d => { ui.setHeat(d.to); Story?.notify('policeHeat', { heat: d.to / 5 }); });
on('busted', () => Story?.notify('busted'));
on('escaped', () => { ui.flash('Seminati!'); Story?.notify('policeHeat', { heat: 0 }); });
on('pause', d => ctx.state.paused = !!d.paused);
on('environment', d => setEnvironment(d.env));
on('carSelected', d => setCar(d.car));
on('freeRoamPolice', d => Police?.setHeat(d.policeLevel));
function startLevel(d) {
  ctx.state.noSpeedTrap = d.mode === 'story' && d.type === 'escape';
  if (d.env) setEnvironment(d.env); if (d.car) setCar(d.car);
  resetRun();
  Diff?.setDifficulty(d.difficulty >= 8 ? 3 : d.difficulty >= 5 ? 2 : d.difficulty <= 1 ? 0 : 1);
  Diff?.setMissionLevel(1 + ((d.difficulty || 1) - 1) * .15);
  Police?.setHeat(d.policeLevel > 0 ? Math.max(d.policeLevel, Math.round((d.heat || 0) * 5)) : 0);
  ui.hide('menu');
}
on('missionStart', d => { ctx.state.noSpeedTrap = d.type === 'escape'; if (!ctx.state.running || d.mission === 0 || ctx.state.failed) startLevel(d); else { Diff?.setMissionLevel(1 + ((d.difficulty || 1) - 1) * .15); if (d.policeLevel > 0) Police?.setHeat(Math.max(d.policeLevel, Police.getState().heat)); } ctx.state.failed = false; });
on('freeRoamStart', d => startLevel(d));
on('missionFailed', () => { ctx.state.running = false; ctx.state.failed = true; });
on('storyComplete', () => { ctx.state.running = false; });

function resetRun() {
  buildPlayer(); Object.assign(player, { speed: 14, x: road.laneX(1), z: 0, h: 0, steer: 0, lane: 1, nitro: 1, distance: 0, maxHealth: 100, health: 100, gear: 2, shiftT: 0, drift: 0 });
  ctx.state.time = 0; ctx.state.running = true; shake = 0;
  Diff?.reset(modCtx); Police?.reset(); ui.setHeat(0);
}

// ---------- Fisica: marce, inerzia, freni, sterzo dipendente dalla velocità, aderenza/derapata, rollio ----------
const GEARS = [.24, .40, .55, .70, .85, 1];
function updatePlayer(dt) {
  const P = player.phys, k = keys;
  const gas = k.ArrowUp || k.KeyW, brake = k.ArrowDown || k.KeyS, nitro = k.Space && player.nitro > 0 && gas;
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
  if (ctx.debug.autopilot) { const tx = road.laneX(ctx.debug.autoLane ?? 1); const want = THREE.MathUtils.clamp(-(tx - player.x) * .08, -.35, .35); st = THREE.MathUtils.clamp((player.h - want) * 6 + ddcx(player.z) * spd0 * 40, -1, 1); }
  player.steer += (st - player.steer) * Math.min(1, dt * (st ? 4 : 6));
  const spd = Math.max(player.speed, 1);
  let yaw = -player.steer * P.steer * 1.6 / (1 + spd / 16);
  const grip = P.grip * env;
  const lat = Math.abs(yaw) * spd;
  if (lat > grip) { // oltre il limite: sottosterzo/derapata
    player.drift = Math.min(1, player.drift + dt * 2);
    yaw = Math.sign(yaw) * grip / spd * 1.1;
    player.speed -= (lat - grip) * .35 * dt;
  } else player.drift = Math.max(0, player.drift - dt * 1.5);
  // la strada curva sotto di te: se non sterzi, vai dritto verso il bordo
  player.h += (yaw + ddcx(player.z) * spd) * dt;
  if (!st) player.h *= 1 - Math.min(1, dt * .9); // allineamento naturale (aiuto guida)
  player.h = THREE.MathUtils.clamp(player.h, -.55, .55);
  player.x += -spd * Math.sin(player.h) * dt * (player.speed > 0.2 ? 1 : 0) + player.drift * Math.sign(-yaw) * -1.2 * dt;
  const lim = road.halfWidth + SH - 1;
  if (Math.abs(player.x) > lim) {
    const hit = Math.abs(player.h) * player.speed;
    player.x = Math.sign(player.x) * lim; player.h *= -.3; player.speed = Math.max(0, player.speed - (hit > 2 ? hit * .5 : 6 * dt));
    if (hit > 2) emit('damage', { amount: Math.min(12, hit * .6), source: 'guardrail' });
  }
  if (Math.abs(player.x) > road.halfWidth) player.speed -= (ENV === 'city' ? 2 : 4) * dt; // banchina rallenta
  player.z -= player.speed * Math.cos(player.h) * dt; player.distance += player.speed * dt;
  player.lane = THREE.MathUtils.clamp(Math.round(player.x / LW + (LANES - 1) / 2), 0, LANES - 1);
  // rollio e beccheggio del corpo
  const latAcc = (yaw + ddcx(player.z) * spd) * spd;
  player.roll += (THREE.MathUtils.clamp(latAcc * .012, -.09, .09) - player.roll) * Math.min(1, dt * 5);
  player.pitch += (THREE.MathUtils.clamp(-acc * .006, -.05, .05) - player.pitch) * Math.min(1, dt * 4);
  const m = player.mesh; m.position.set(player.x, 0, player.z); m.rotation.y = player.h + player.drift * -player.steer * .25;
  player.body.rotation.set(player.pitch, 0, player.roll);
  for (const w of player.body.userData.wheels || []) w.rotation.x -= player.speed * dt / .35;
}

// laneSpace -> mondo curvo: sposto/ruoto prima del render, ripristino dopo
const bent = [];
function bendObj(o, baseZ) {
  const z = baseZ + o.position.z, s = dcx(z), n = 1 / Math.sqrt(1 + s * s);
  bent.push(o, o.position.x, o.position.z, o.rotation.y);
  const x = o.position.x; o.position.x = cx(z) + x * n; o.position.z += -x * s * n; o.rotation.y += Math.atan(s);
}
function bend() {
  for (const o of laneSpace.children) {
    if (o.name === 'police') { o.position.z = player.z; for (const c of o.children) bendObj(c, player.z); }
    else bendObj(o, 0);
  }
}
function unbend() { for (let i = 0; i < bent.length; i += 4) { const o = bent[i]; o.position.x = bent[i + 1]; o.position.z = bent[i + 2]; o.rotation.y = bent[i + 3]; } bent.length = 0; }

const camPos = new THREE.Vector3(), look = new THREE.Vector3();
function updateCamera(dt) {
  const sp = player.speed, nit = keys.Space && player.nitro > 0 && (keys.ArrowUp || keys.KeyW);
  camera.fov += ((60 + sp * .22 + (nit ? 7 : 0)) - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
  const pz = player.z, wx = cx(pz) + player.x, ang = Math.atan(dcx(pz)) + player.h * .6;
  const dist = 7 + sp * .02, hgt = 2.5 + sp * .006;
  const tx = wx + Math.sin(ang) * dist, tz = pz + Math.cos(ang) * dist;
  camPos.set(tx, hgt, tz);
  camera.position.lerp(camPos, Math.min(1, dt * 7));
  if (shake > 0) { camera.position.x += (Math.random() - .5) * shake * .5; camera.position.y += (Math.random() - .5) * shake * .3; shake = Math.max(0, shake - dt * 2); }
  if (sp > 45) camera.position.y += (Math.random() - .5) * (sp - 45) * .001;
  const lz = pz - 14; look.set(cx(lz) + player.x * .8, 1.2, lz); camera.lookAt(look);
  sun.position.set(wx + sunDir.x * 150, sunDir.y * 150, pz + sunDir.z * 150); sun.target.position.set(wx, 0, pz - 20);
}

function updateHUD() {
  $('speed').firstChild.nodeValue = Math.round(player.speed * 3.6);
  $('meta').textContent = `marcia ${player.gear} · ${(player.distance / 1000).toFixed(2)} km · nitro ${Math.round(player.nitro * 100)}%${player.drift > .3 ? ' · DERAPATA' : ''}`;
  $('rpm').style.width = Math.min(100, player.rpm * 100) + '%'; $('rpm').style.background = player.rpm > .9 ? '#ff4b2b' : '#ffb23e';
}

const clock = new THREE.Clock(); let fpsAcc = 0, fpsN = 0;
function step(dt) {
  try { Story?.update(dt, modCtx); } catch (e) { console.error(e); }
  if (ctx.state.running && !ctx.state.paused) {
    ctx.state.time += dt; updatePlayer(dt);
    if (ctx.debug.ffLeft > 0) { const j = Math.min(150, ctx.debug.ffLeft); player.z -= j; player.distance += j; ctx.debug.ffLeft -= j; }
    for (const m of [ctx.debug.noTraffic ? null : Diff, ctx.debug.noPolice ? null : Police]) { try { m?.update(dt, modCtx); } catch (e) { console.error(e); } }
    if (ctx.debug.god) player.health = 100;
  } else if (player.mesh && !ctx.state.running) { player.z -= 10 * dt; player.mesh.position.set(player.x, 0, player.z); }
}
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const n = ctx.debug.substeps || 1; // solo per test automatici
  for (let i = 0; i < n; i++) step(n > 1 ? 1 / 20 : dt);
  if (ctx.state.running) updateHUD();
  if (player.mesh) { updateCamera(dt); updateScenery(player.z, dt); }
  bend(); composer.render(dt); unbend();
  fpsAcc += dt; fpsN++; if (fpsAcc > 2) { ctx.state.fps = fpsN / fpsAcc; fpsAcc = fpsN = 0; }
}

// ---------- Menu impostazioni ----------
function markQ() { document.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('active', +x.dataset.q === quality)); }
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { quality = +b.dataset.q; localStorage.setItem('tratta-q', quality); markQ(); setupPost(); if (Env) setEnvironment(ENV); });
$('ovRetry').onclick = () => ui.hide('over'); $('ovMenu').onclick = () => { ui.hide('over'); Story?.openMainMenu?.(); };
const gear = document.createElement('button'); gear.textContent = '⚙'; gear.title = 'Grafica';
gear.style.cssText = 'position:fixed;right:14px;bottom:90px;z-index:50;width:44px;height:44px;border-radius:50%;border:1px solid #fff3;background:#0009;color:#fff;font-size:20px;pointer-events:auto';
gear.onclick = () => $('menu').classList.toggle('hidden'); document.body.appendChild(gear);
$('menuClose').onclick = () => ui.hide('menu');

async function loadModules() {
  const imp = async n => { try { return await import(`./${n}.js`); } catch (e) { console.error('modulo', n, e); } };
  Env = await imp('environments'); Cars = await imp('cars');
  Object.assign(envCtx, { THREE, scene, camera, player, keepBackground: true, groundMaterial: groundMat, road: Object.assign(Object.create(road), { halfWidth: TOTAL_W / 2 + CURB + 0.6 }) });
  Diff = await imp('difficulty'); Police = await imp('police'); Story = await imp('story');
  if (Story?.CARS) { CARS = Story.CARS; carDef = Story.getState?.().car || CARS[0]; }
  Diff?.init(modCtx); Police?.init(modCtx); Story?.init(modCtx);
  Object.assign(ctx.debug, { Story, Police, Diff, modCtx, laneSpace, ff: m => { ctx.debug.ffLeft = m; } });
}

markQ(); setupPost();
await loadModules().catch(e => console.error(e));
loadModels().then(() => { buildPlayer(); }); // auto vere appena caricate
setEnvironment(Story?.getState?.().env || 'city'); buildPlayer(); player.speed = 10;
loop();
