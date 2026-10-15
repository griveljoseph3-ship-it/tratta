// Tratta — world.js: scenografia da modelli GLB (Kenney, CC0) in InstancedMesh + terreno ai lati della strada su spline.
// Niente geometria procedurale per edifici/alberi/rocce: solo i nastri di terreno e i guardrail (strisce lungo la spline).
import * as THREE from 'three';
import * as Models from './models.js';
import * as Road from './road.js';

let scene, EDGE = 9.6, HALF = 7.2;
// Chunk alla Minecraft: la strada è divisa in pezzi da CH metri; ne esistono solo NCH (1 dietro + il resto davanti, dentro la nebbia).
// Quando ne superi uno, quello dietro viene riciclato come nuovo pezzo in fondo, con contenuto deciso dal seme del pezzo (sempre uguale).
export const CH = 110, NCH = 6; const SPAN = CH * NCH, BEHIND = 70;
// generatore locale: la scenografia non consuma il seme di gioco (traffico/polizia restano deterministici)
let seed = 1; const r = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rr = (a, b) => a + r() * (b - a);

// ---- elenco modelli per ambiente ----
// kind: { m:[modelli], n:quanti, off:[min,max] metri oltre il bordo, h:[altezza min,max] m (o w: larghezza), side:'both'|'up'|'down', face:true = fronte verso strada, step: spaziatura regolare }
const C = 'city/', N = 'nature/', RD = 'road/';
const ENVS = {
  city: [
    { m: ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n'].map(x => C + x), n: 46, off: [5, 9], w: [16, 22], face: true, step: 27, tint: true },
    { m: ['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e'].map(x => C + x), n: 14, off: [32, 70], w: [18, 28], face: true, tint: true },
    { m: ['house-a', 'house-c', 'house-f', 'house-k', 'house-o', 'house-r'].map(x => C + x), n: 8, off: [75, 120], w: [12, 16], face: true, tint: true },
    { m: [C + 'tree-large', C + 'tree-small'], n: 40, off: [2, 4], h: [6, 10] },
    { m: [RD + 'light-curved'], n: 26, off: [-1.2, -1.2], h: [8.5, 8.5], lamp: true, step: 50 },
  ],
  jungle: [
    { m: [N + 'tree_palmTall', N + 'tree_palmDetailedTall', N + 'tree_palmBend', N + 'tree_palmDetailedShort'], n: 90, off: [2, 30], h: [9, 16] },
    { m: [N + 'tree_detailed', N + 'tree_fat', N + 'tree_oak', N + 'tree_default'], n: 70, off: [6, 60], h: [16, 26] },
    { m: [N + 'plant_bushLarge', N + 'plant_bushDetailed', N + 'grass_leafsLarge', N + 'plant_flatTall'], n: 150, off: [.5, 14], h: [1.4, 3.2], noShadow: true },
    { m: [N + 'rock_largeA', N + 'rock_largeB', N + 'rock_tallA', N + 'stone_largeA', N + 'log_large', N + 'stump_old'], n: 30, off: [2, 25], h: [1.2, 4.5] },
  ],
  desert: [
    { m: [N + 'cactus_tall', N + 'cactus_short'], n: 70, off: [3, 60], h: [3, 7] },
    { m: [N + 'rock_largeA', N + 'rock_largeB', N + 'rock_largeC', N + 'rock_largeD', N + 'rock_tallB', N + 'rock_tallC'], n: 60, off: [4, 110], h: [2, 14] },
    { m: [N + 'cliff_block_rock', N + 'cliff_large_rock'], n: 14, off: [60, 160], h: [18, 40] },
    { m: [N + 'tree_palmDetailedShort', N + 'tree_palmBend'], n: 10, off: [8, 40], h: [6, 10] },
    { m: [RD + 'sign-highway'], n: 4, off: [.8, .8], h: [6, 6], step: 400, face: true },
  ],
  mountain: [
    { m: [N + 'tree_pineTallA_detailed', N + 'tree_pineRoundC'], n: 120, off: [3, 26], h: [9, 18] },
    { m: [N + 'rock_tallA', N + 'rock_tallB', N + 'rock_tallC'], n: 36, off: [4, 12], h: [9, 20], side: 'up' },
    { m: [N + 'rock_tallA', N + 'rock_tallB', N + 'rock_largeC', N + 'rock_largeD'], n: 40, off: [1.5, 20], h: [1.5, 6] },
    { m: [RD + 'road-sign-warning'], n: 6, off: [.6, .6], h: [2.2, 2.2], warn: true, face: true },
  ],
};
export const ALL_MODELS = [...new Set(Object.values(ENVS).flat().flatMap(k => k.m))];

// ---- profilo del terreno ai lati: colonne a distanza dal bordo (m) e quota relativa alla strada ----
const COLS = [0, 3, 10, 24, 50, 110];
const PROF = {
  city: { up: [-.02, 0, 0, 0, 0, 0], down: [-.02, 0, 0, 0, 0, 0] },
  jungle: { up: [-.05, .2, 1.4, 4, 9, 18], down: [-.05, .2, 1.2, 3, 7, 14] },
  desert: { up: [-.05, .1, .6, 2.5, 6, 12], down: [-.05, .1, .5, 2, 5, 10] },
  mountain: { up: [-.05, 1, 6, 15, 26, 40], down: [-.05, -.8, -6, -16, -30, -50] },
};
let ENV = 'city';
function sideOf(s, sd) { // +1 = lato "su" (parete), -1 = lato "giù" (dirupo)
  if (ENV !== 'mountain') return sd > 0 ? 1 : -1; return Road.uphillSide(s) === sd ? 1 : -1;
}
const noise = (s, k) => Math.sin(s * .013 + k * 1.7) * .5 + Math.sin(s * .041 + k * 3.1) * .3 + Math.sin(s * .11 + k) * .2;
export function groundH(s, off, sd) { // quota rispetto alla strada a distanza off dal bordo, lato sd
  const P = PROF[ENV], up = sideOf(s, sd) > 0, arr = up ? P.up : P.down;
  let i = 0; while (i < COLS.length - 2 && off > COLS[i + 1]) i++;
  const t = Math.max(0, Math.min(1, (off - COLS[i]) / (COLS[i + 1] - COLS[i])));
  let h = arr[i] + (arr[i + 1] - arr[i]) * t;
  if (ENV === 'desert' && off > 8) h += (noise(s, sd) + 1) * 3 * Math.min(1, (off - 8) / 30);
  else if (ENV === 'jungle' && off > 4) h *= .7 + .6 * (noise(s, sd * 2) + 1) * .5;
  else if (ENV === 'mountain' && off > 4) h *= .85 + .3 * (noise(s, sd * 3) + 1) * .5;
  return h;
}
// lato interno di una curva stretta: il terreno non può estendersi oltre il centro di curvatura
function maxOff(s, sd) { const k = Road.kappa(s); if (ENV === 'mountain' && Math.abs(k) < .02) return Math.min(Road.hairRadius(s) * 1.1 - EDGE, Math.sign(k) === sd && Math.abs(k) > 1e-4 ? .92 / Math.abs(k) - EDGE : 1e9); if (Math.sign(k) !== sd || Math.abs(k) < 1e-4) return 1e9; return Math.max(2, .92 / Math.abs(k) - EDGE); }

// ---- texture terreno (canvas, solo colore) ----
function canvasTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const speck = (base, n, f) => canvasTex(256, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { g.fillStyle = f(); g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 2, 2 + Math.random() * 2); } });
const TEX = {
  city: speck('#5a6b3a', 9000, () => `hsl(${70 + Math.random() * 30},${25 + Math.random() * 15}%,${20 + Math.random() * 14}%)`),
  jungle: speck('#26401b', 12000, () => `hsl(${85 + Math.random() * 40},${40 + Math.random() * 20}%,${10 + Math.random() * 16}%)`),
  desert: speck('#d7b07a', 10000, () => `hsl(${32 + Math.random() * 8},${40 + Math.random() * 15}%,${56 + Math.random() * 16}%)`),
  mountain: speck('#6f7064', 12000, () => Math.random() < .35 ? `hsl(${90 + Math.random() * 30},25%,${22 + Math.random() * 12}%)` : `hsl(40,${5 + Math.random() * 8}%,${30 + Math.random() * 25}%)`),
};
const sidewalkTex = speck('#9a9690', 5000, () => `rgba(0,0,0,${Math.random() * .12})`);
const groundMat = new THREE.MeshLambertMaterial({ map: TEX.city });

// ---- nastri di terreno (2 lati) ----
const TROWS = 132, TSTEP = 5;
function makeTerrain() {
  const nc = COLS.length, geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TROWS * nc * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(TROWS * nc * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(TROWS * nc * 2), 2));
  const idx = []; for (let rI = 0; rI < TROWS - 1; rI++) for (let c = 0; c < nc - 1; c++) { const a = rI * nc + c, b = a + nc; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  geo.setIndex(idx); const m = new THREE.Mesh(geo, groundMat); m.frustumCulled = false; m.receiveShadow = true; return m;
}
let terr = [], rails = null, railPosts = null, valley = null;
const railMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: .7, roughness: .35, side: THREE.DoubleSide });
function makeRail() { // striscia verticale (lama del guardrail) per lato
  const geo = new THREE.BufferGeometry(), n = TROWS * 2;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3 * 2), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3 * 2), 3));
  const idx = []; for (let sd = 0; sd < 2; sd++) for (let rI = 0; rI < TROWS - 1; rI++) { const a = sd * TROWS * 2 + rI * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  geo.setIndex(idx); const m = new THREE.Mesh(geo, railMat); m.frustumCulled = false; m.castShadow = false; return m;
}
const F = { x: 0, y: 0, z: 0, th: 0 };
let builtS = null, builtV = -1;
function rebuildStrips(s) {
  const s0 = Math.floor(s / TSTEP) * TSTEP - BEHIND;
  if (s0 === builtS && builtV === Road.ver) return; builtS = s0; builtV = Road.ver;
  const nc = COLS.length;
  // griglia dei punti strada (celle 16 m): il terreno di un tratto non deve coprire un altro tratto (tornanti, curve che si avvicinano)
  const grid = new Map(), CELL = 16, key = (x, z) => (Math.floor(x / CELL) * 73856093) ^ (Math.floor(z / CELL) * 19349663);
  for (let t = s0 - 300; t < s0 + TROWS * TSTEP + 300; t += 3) { const x = Road.x(t), z = Road.z(t), kk = key(x, z); let L = grid.get(kk); if (!L) grid.set(kk, L = []); L.push(t, x, z); }
  const clearY = (x, z, ss, y) => { const lim = (EDGE + 2) ** 2; let out = y; for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) { const L = grid.get(key(x + gx * CELL, z + gz * CELL)); if (!L) continue;
      for (let i = 0; i < L.length; i += 3) { if (Math.abs(L[i] - ss) < 30) continue; const dx = L[i + 1] - x, dz = L[i + 2] - z; if (dx * dx + dz * dz < lim) { const ry = Road.y(L[i]) - 1.2; if (out > ry) out = ry; } } } return out; };
  terr.forEach((m, k) => {
    const sd = k ? 1 : -1, P = m.geometry.attributes.position.array, U = m.geometry.attributes.uv.array;
    for (let rI = 0; rI < TROWS; rI++) {
      const ss = s0 + rI * TSTEP, th = Road.heading(ss), c = Math.cos(th), sn = Math.sin(th), x0 = Road.x(ss), z0 = Road.z(ss), y0 = Road.y(ss);
      const lim = maxOff(ss, sd), scale = lim < COLS[nc - 1] ? lim / COLS[nc - 1] : 1;
      for (let ci = 0; ci < nc; ci++) {
        const off = COLS[ci] * scale, lat = sd * (EDGE + off), i = (rI * nc + ci) * 3, u = (rI * nc + ci) * 2;
        P[i] = x0 + c * lat; P[i + 2] = z0 + sn * lat; P[i + 1] = ci < 2 ? y0 + groundH(ss, off, sd) : clearY(P[i], P[i + 2], ss, y0 + groundH(ss, off, sd));
        U[u] = lat / 8; U[u + 1] = ss / 8;
      }
    }
    if (sd > 0) { // ordine dei triangoli coerente: inverto le colonne sul lato destro
      const ix = m.geometry.index.array; let q = 0; for (let rI = 0; rI < TROWS - 1; rI++) for (let cI = 0; cI < nc - 1; cI++) { const a = rI * nc + cI, b = a + nc; ix[q++] = a; ix[q++] = a + 1; ix[q++] = b; ix[q++] = a + 1; ix[q++] = b + 1; ix[q++] = b; }
      m.geometry.index.needsUpdate = true;
    }
    m.geometry.attributes.position.needsUpdate = m.geometry.attributes.uv.needsUpdate = true; m.geometry.computeVertexNormals();
  });
  if (rails.visible) {
    const P = rails.geometry.attributes.position.array, Nn = rails.geometry.attributes.normal.array;
    for (let sdI = 0; sdI < 2; sdI++) { const sd = sdI ? 1 : -1;
      for (let rI = 0; rI < TROWS; rI++) { const ss = s0 + rI * TSTEP; Road.frame(ss, sd * (HALF + 2.75), F); const c = Math.cos(F.th), sn = Math.sin(F.th);
        const i = (sdI * TROWS * 2 + rI * 2) * 3; P[i] = F.x; P[i + 1] = F.y + .45; P[i + 2] = F.z; P[i + 3] = F.x; P[i + 4] = F.y + .85; P[i + 5] = F.z;
        for (let j = 0; j < 6; j += 3) { Nn[i + j] = -c * sd; Nn[i + j + 1] = 0; Nn[i + j + 2] = -sn * sd; } } }
    rails.geometry.attributes.position.needsUpdate = rails.geometry.attributes.normal.needsUpdate = true;
    // paletti ogni 4 m
    let n = 0; const s1 = Math.floor(s / 4) * 4 - 40;
    for (let ss = s1; ss < s1 + 360 && n < railPosts.instanceMatrix.count - 1; ss += 4) for (const sd of [-1, 1]) { Road.frame(ss, sd * (HALF + 2.85), F); D.position.set(F.x, F.y, F.z); D.rotation.set(0, -F.th, 0); D.scale.set(1, 1, 1); D.updateMatrix(); railPosts.setMatrixAt(n++, D.matrix); }
    railPosts.count = n; railPosts.instanceMatrix.needsUpdate = true;
  }
}

// ---- scenografia instanziata ----
const D = new THREE.Object3D();
let groups = {}; // env -> { meshes:[], items:[] }
const nightU = { value: 0 };
function windowsShader(mat) { // finestre accese di notte: i texel azzurri del colormap Kenney diventano luce calda (a caso per finestra)
  const m = mat.clone(); m.onBeforeCompile = sh => {
    sh.uniforms.uNight = nightU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * instanceMatrix * vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying vec3 vWP;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 c = diffuseColor.rgb; vec3 tx = texture2D(map, vMapUv).rgb; float win = step(.62, tx.b) * step(.3, tx.b - tx.r); // vetri #d0e8ff e #6794d9 del colormap
        float on = step(.45, fract(sin(dot(floor(vWP * vec3(.42, .3, .42)), vec3(12.9898, 78.233, 37.719))) * 43758.5453));
        totalEmissiveRadiance += win * on * uNight * vec3(1.6, 1.05, .55); diffuseColor.rgb = mix(c, c * .35, win * uNight); }`);
  }; m.customProgramCacheKey = () => 'win'; return m;
}
function buildEnv(env) {
  if (groups[env]) return groups[env];
  const G = { meshes: [], items: [], byModel: {} };
  ENVS[env].forEach((kind, ki) => { kind.ki = ki; });
  for (const kind of ENVS[env]) {
    const avail = kind.m.filter(p => Models.get(p)); if (!avail.length) continue;
    kind.per = Math.max(1, Math.round(kind.n / NCH)); const N = kind.per * NCH;
    const per = {}; for (let i = 0; i < N; i++) { const p = avail[i % avail.length]; (per[p] ||= []).push(i); }
    for (const p in per) {
      const parts = Models.parts(p), M = Models.get(p); if (!parts) continue;
      const count = per[p].length, ims = parts.map(pt => { const mat = env === 'city' && p.startsWith(C) && p.includes('building') ? (pt.material._win ||= windowsShader(pt.material)) : pt.material;
        const im = new THREE.InstancedMesh(pt.geometry, mat, count); if (kind.tint) for (let q = 0; q < count; q++) im.setColorAt(q, TC.set(0xffffff)); im.frustumCulled = false; im.castShadow = !kind.noShadow; im.receiveShadow = true; im.visible = false; scene.add(im); G.meshes.push(im); return im; });
      per[p].forEach((ki, slot) => G.items.push({ kind, model: p, M, ims, slot, idx: ki, k: Math.floor(ki / kind.per), j: ki % kind.per, s: 0, sd: 1 }));
    }
  }
  return groups[env] = G;
}
const WARN = [], TC = new THREE.Color();
const TINTS = [0xf6e7cf, 0xf0cf98, 0xe7a77c, 0xf3dfa6, 0xeab9a6, 0xe2e2e2, 0xd4dcbc, 0xf2c4a0];
function place(it, s) {
  const k = it.kind, M = it.M;
  it.s = s; it.sd = it.force ? it.force : k.side === 'up' ? (ENV === 'mountain' ? Road.uphillSide(s) || 1 : 1) : r() < .5 ? -1 : 1;
  const size = k.w ? rr(k.w[0], k.w[1]) : rr(k.h[0], k.h[1]);
  const sc = k.w ? size / Math.max(M.size.x, .01) : size / Math.max(M.size.y, .01);
  const depth = (k.face ? M.size.z : Math.max(M.size.x, M.size.z)) * sc;
  const rad = Math.max(M.size.x, M.size.z) * sc * .5; // ingombro reale: niente rocce/alberi che sporgono in carreggiata
  let off = rr(k.off[0], k.off[1]) + (k.face || k.w ? depth / 2 : rad + .6);
  if (k.lamp) off = -1.2; // sul marciapiede, braccio verso la strada
  const mo = maxOff(s, it.sd) - 1; let hideIn = false; if (!k.lamp && !k.warn && off > mo) { if (mo < rad + .6) hideIn = true; else off = mo; }
  const lat = it.sd * (EDGE + off);
  Road.frame(s, lat, F);
  let y = F.y + (k.lamp || k.warn ? 0 : groundH(s, off, it.sd));
  // non sopra un'altra tratta della strada (tornanti) e non dentro la carreggiata
  let hide = hideIn || off < -1.3 || (k.lamp ? false : onOtherRoad(F.x, F.z, s, k.face || k.w ? depth * .5 : rad));
  if (ENV === 'mountain' && sideOf(s, it.sd) < 0 && off > 4 && k.side !== 'up') y -= depth * .1; // radici nel pendio
  D.position.set(F.x, y - (M.bb.min.y * sc) - (k.h && !k.lamp ? .15 : 0), F.z);
  const facing = k.face || k.lamp ? Math.atan2(-it.sd * Math.cos(F.th), -it.sd * Math.sin(F.th)) : r() * 6.283;
  D.rotation.set(0, facing + (k.lamp ? Math.PI / 2 * 0 : 0), 0);
  D.scale.setScalar(hide ? 0 : sc); if (!k.face && !k.lamp && !k.warn) D.scale.y *= rr(.85, 1.15);
  D.updateMatrix(); const tint = k.tint ? TC.set(TINTS[(r() * TINTS.length) | 0]) : null;
  for (const im of it.ims) { im.setMatrixAt(it.slot, D.matrix); im.instanceMatrix.needsUpdate = true; if (tint && im.instanceColor) { im.setColorAt(it.slot, tint); im.instanceColor.needsUpdate = true; } }
  if (k.lamp && !hide) { Road.frame(s, it.sd * (EDGE - 1.2 - 1.9), F); it.head = [F.x, y + size * .97, F.z]; } else it.head = null;
}
const near = { x: 0, z: 0 };
function onOtherRoad(x, z, s, rad) { // controlla tutta la strada vicina (curve strette e tornanti ripiegano la strada su sé stessa)
  const lim = (EDGE + .3 + rad) ** 2;
  for (let t = s - 400; t < s + 400; t += 4) { const dx = Road.x(t) - x, dz = Road.z(t) - z; if (dx * dx + dz * dz < lim) return true; }
  return false;
}
let G = null;
export function setEnvironment(env) {
  ENV = env in ENVS ? env : 'city'; seed = 1234 + Road.ver * 7;
  for (const k in groups) for (const m of groups[k].meshes) m.visible = false;
  G = buildEnv(ENV); for (const m of G.meshes) m.visible = true;
  groundMat.map = TEX[ENV]; groundMat.color.set(ENV === 'city' ? 0xffffff : 0xffffff); groundMat.needsUpdate = true;
  rails.visible = railPosts.visible = true; // guardrail ovunque: il limite laterale si vede (niente muri invisibili)
  valley.visible = ENV === 'mountain'; valley.material.color.set(0x4a5a44);
  builtS = null; resetItems(0);
}
let itemsVer = -1; const slotChunk = new Int32Array(NCH).fill(-1 << 30);
const hash = n => { n = Math.imul(n ^ n >>> 16, 0x45d9f3b); n = Math.imul(n ^ n >>> 16, 0x45d9f3b); return (n ^ n >>> 16) | 0; };
function hideItem(it) { D.position.set(0, -9999, 0); D.scale.setScalar(0); D.updateMatrix(); for (const im of it.ims) { im.setMatrixAt(it.slot, D.matrix); im.instanceMatrix.needsUpdate = true; } it.head = null; }
function fillChunk(c, k) { // riempie lo slot k con il contenuto del pezzo c
  slotChunk[k] = c; const c0 = c * CH;
  for (const it of G.items) { if (it.k !== k) continue; const K = it.kind, j = it.j;
    seed = hash(c * 977 + K.ki * 131 + j * 7 + Road.ver * 7919);
    if (c0 + CH < -250) { hideItem(it); continue; }
    if (K.warn) { const h = firstHairIn(c0, c0 + CH); if (h == null || j) hideItem(it); else { it.force = 0; place(it, Math.max(c0, h - 45)); } continue; }
    if (K.step) { const n2 = K.per, sp = CH / Math.ceil(n2 / 2); it.force = j % 2 ? 1 : -1;
      if (K.step > CH && r() > CH / K.step) { hideItem(it); continue; }
      place(it, c0 + (j >> 1) * sp + (K.w ? (j % 2) * sp * .5 : 0) + (K.lamp ? 5 : 0)); continue; }
    it.force = 0; place(it, c0 + r() * CH);
  }
}
function firstHairIn(a, b) { for (let t = a; t < b; t += 5) if (Math.abs(Road.kappa(t + 45)) > .025) return t + 45; return null; }
function resetItems(s) { itemsVer = Road.ver; slotChunk.fill(-1 << 30); syncChunks(s); }
function syncChunks(s) {
  const cur = Math.floor((s - BEHIND) / CH);
  for (let c = cur; c < cur + NCH; c++) { const k = ((c % NCH) + NCH) % NCH; if (slotChunk[k] !== c) fillChunk(c, k); }
}
// costruisce tutti gli ambienti e li rende visibili per un attimo: il chiamante compila gli shader una volta sola (niente scatti al cambio ambiente)
export function showAllForCompile(on) { for (const e in ENVS) buildEnv(e); for (const k in groups) for (const m of groups[k].meshes) m.visible = on || k === ENV; }
export function debugClearance() { // per i test: posizioni e ingombri degli oggetti visibili + vertici del terreno
  const items = []; for (const it of G.items) { if (it.hidden) continue; const im = it.ims[0]; im.getMatrixAt(it.slot, _m); _v.setFromMatrixPosition(_m); const sc = _sc.setFromMatrixScale(_m).x; if (sc < 1e-6) continue;
    const k = it.kind, M = it.M; items.push({ x: _v.x, z: _v.z, y: _v.y, rad: (k.face || k.w ? M.size.z : Math.max(M.size.x, M.size.z)) * sc * .5, model: it.model, lamp: !!(k.lamp || k.warn) }); }
  const verts = []; for (const m of terr) { const a = m.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 3) verts.push([a[i], a[i + 1], a[i + 2]]); }
  return { items, verts, edge: EDGE };
}
const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _sc = new THREE.Vector3();
export function chunkInfo() { return { CH, NCH, slots: [...slotChunk] }; }
function nextHairAfter(s) { for (let t = s; t < s + 1500; t += 5) if (Math.abs(Road.kappa(t)) > .025) return t; return s + 800; }

// ---- aloni dei lampioni (notte, città) ----
let glowIM = null;
export function lampHeads() { return G ? G.items.filter(i => i.head).map(i => i.head) : []; }

export async function init(o) {
  scene = o.scene; EDGE = o.edge; HALF = o.half;
  terr = [makeTerrain(), makeTerrain()]; terr.forEach(m => scene.add(m));
  rails = makeRail(); scene.add(rails);
  railPosts = new THREE.InstancedMesh(new THREE.BoxGeometry(.14, .9, .14).translate(0, .45, 0), railMat, 200); railPosts.frustumCulled = false; scene.add(railPosts);
  valley = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4a5a44 })); valley.frustumCulled = false; scene.add(valley);
  glowIM = o.glow || null;
  await Models.loadAll(ALL_MODELS);
}
export function update(s, dt, camera) {
  if (!G) return;
  if (itemsVer !== Road.ver) resetItems(s);
  syncChunks(s); rebuildStrips(s);
  if (valley.visible) { Road.frame(s, 0, F); valley.position.set(F.x, F.y - 70, F.z); }
  void dt, camera;
}
export function setNight(v) { nightU.value = v; for (const m of terr) m.material.color.setScalar(1); }
export function info() { return { env: ENV, meshes: G?.meshes.length || 0, items: G?.items.length || 0, models: ALL_MODELS.filter(p => Models.get(p)).length + '/' + ALL_MODELS.length }; }
export const terrainMaterial = groundMat;
