// Tratta – environments.js (Three.js 0.160). Avanti = -Z. Scenario posizionato a x = road.centerX(z) + offset.
// API: setEnvironment(env, ctx)  env: 'city'|'jungle'|'desert';  update(dt, ctx) ricicla lo scenario.
// Opzionale: ctx.roadMaterial / ctx.groundMaterial (se presenti vengono aggiornati map/color), ctx.road.centerX(z).
import * as THREE from 'three';

const SPAN = 600;           // metri di scenario davanti/dietro
const rnd = (a, b) => a + Math.random() * (b - a);
let root = null, sets = [], current = null, sun = null, hemi = null, dunes = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();

function tex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(...rep);
  t.colorSpace = THREE.SRGBColorSpace; return t;
}
const dots = (g, w, h, n, f, s = 2) => { for (let i = 0; i < n; i++) { g.fillStyle = f(); g.fillRect(Math.random() * w, Math.random() * h, s, s); } };
const ROAD = {
  city: () => tex(256, 512, (g, w, h) => { g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, w, h); dots(g, w, h, 9000, () => `rgba(${Math.random() > .5 ? 255 : 0},${Math.random() > .5 ? 255 : 0},255,.05)`);
    g.fillStyle = '#eee'; g.fillRect(6, 0, 6, h); g.fillRect(w - 12, 0, 6, h); for (const x of [w / 4, w / 2, 3 * w / 4]) for (let y = 0; y < h; y += 128) g.fillRect(x - 3, y, 6, 64); }),
  jungle: () => tex(256, 512, (g, w, h) => { g.fillStyle = '#5a3f24'; g.fillRect(0, 0, w, h); dots(g, w, h, 12000, () => `hsl(28,${30 + Math.random() * 20}%,${12 + Math.random() * 20}%)`, 3);
    g.fillStyle = 'rgba(30,18,8,.55)'; for (const x of [.3, .38, .62, .7]) g.fillRect(w * x, 0, 14, h); g.fillStyle = 'rgba(60,90,40,.5)'; g.fillRect(w * .48, 0, 12, h); }),
  desert: () => tex(256, 512, (g, w, h) => { g.fillStyle = '#b08a5a'; g.fillRect(0, 0, w, h); dots(g, w, h, 12000, () => `hsl(30,${30 + Math.random() * 20}%,${35 + Math.random() * 25}%)`);
    g.fillStyle = 'rgba(80,55,30,.35)'; for (const x of [.25, .75]) g.fillRect(w * x, 0, 18, h); g.fillStyle = 'rgba(230,200,150,.4)'; g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h); }),
};
const GROUND = {
  city: () => tex(256, 256, (g, w, h) => { g.fillStyle = '#56702f'; g.fillRect(0, 0, w, h); dots(g, w, h, 8000, () => `hsl(${80 + Math.random() * 20},35%,${18 + Math.random() * 15}%)`); }, [200, 200]),
  jungle: () => tex(256, 256, (g, w, h) => { g.fillStyle = '#22381a'; g.fillRect(0, 0, w, h); dots(g, w, h, 10000, () => `hsl(${95 + Math.random() * 30},45%,${8 + Math.random() * 15}%)`, 3); }, [200, 200]),
  desert: () => tex(256, 256, (g, w, h) => { g.fillStyle = '#dcb67c'; g.fillRect(0, 0, w, h); dots(g, w, h, 8000, () => `hsl(36,50%,${60 + Math.random() * 18}%)`); }, [120, 120]),
};
const texCache = {};
const getTex = (k, env) => (texCache[k + env] ||= (k === 'road' ? ROAD : GROUND)[env]());

// ---- geometrie base (merge manuale per pochi draw call) ----
function merge(parts) { // parts: [geometry, matrix, color]
  const geos = parts.map(([g, m, col]) => { const x = g.index ? g.toNonIndexed() : g.clone(); x.applyMatrix4(m); x.deleteAttribute('uv');
    const n = x.attributes.position.count, c = new Float32Array(n * 3); _c.set(col); for (let i = 0; i < n; i++) _c.toArray(c, i * 3); x.setAttribute('color', new THREE.BufferAttribute(c, 3)); return x; });
  let total = 0; geos.forEach(g => total += g.attributes.position.count);
  const out = new THREE.BufferGeometry(); const P = new Float32Array(total * 3), N = new Float32Array(total * 3), C = new Float32Array(total * 3); let o = 0;
  for (const g of geos) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}
const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(.5, .5, 1, 8), cone = new THREE.ConeGeometry(.5, 1, 8), ico = new THREE.IcosahedronGeometry(.5, 1), sph = new THREE.SphereGeometry(.5, 8, 6);

const PROTOS = {
  // palazzo italiano: corpo, cornicione, finestre/persiane, tetto in coppi
  palazzo: () => { const p = [[box, M(0, .5, 0), 0xffffff]]; // corpo tinto da instanceColor
    p.push([box, M(0, 1.01, 0, 1.06, .04, 1.06), 0xd9d2c0]);
    for (let f = 0; f < 4; f++) for (let i = -1; i <= 1; i++) { p.push([box, M(i * .28, .18 + f * .22, .505, .12, .12, .01), 0x3c4a3a]); p.push([box, M(.505, .18 + f * .22, i * .28, .01, .12, .12), 0x3c4a3a]); p.push([box, M(-.505, .18 + f * .22, i * .28, .01, .12, .12), 0x3c4a3a]); }
    p.push([box, M(0, 1.06, 0, 1.08, .08, 1.08, 0, 0), 0xa0482c]); return merge(p); },
  lamp: () => merge([[cyl, M(0, 3.5, 0, .15, 7, .15), 0x2a2a2a], [box, M(.7, 7, 0, 1.5, .1, .1), 0x2a2a2a], [box, M(1.4, 6.85, 0, .5, .2, .3), 0xfff2c0]]),
  rail: () => merge([[box, M(0, .65, 0, .08, .3, 4), 0xb8bcc0], [box, M(0, .35, -1.8, .12, .7, .12), 0x777], [box, M(0, .35, 1.8, .12, .7, .12), 0x777]]),
  cypress: () => merge([[cyl, M(0, .5, 0, .3, 1, .3), 0x4a3424], [cone, M(0, 3.5, 0, 1.6, 6.5, 1.6), 0xffffff]]),
  tree: () => merge([[cyl, M(0, 2, 0, .5, 4, .5), 0x4a3424], [ico, M(0, 5, 0, 4.5, 3.8, 4.5), 0xffffff], [ico, M(1.2, 6, .6, 3, 2.6, 3), 0xffffff], [ico, M(-1, 6.2, -.8, 2.8, 2.4, 2.8), 0xffffff]]),
  palm: () => { const p = []; for (let i = 0; i < 6; i++) p.push([cyl, M(Math.sin(i * .25) * .4 * i / 5, i * 1.4 + .7, 0, .45 - i * .03, 1.45, .45 - i * .03, 0, 0, .06), 0x6b5236]);
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; p.push([box, M(Math.cos(a) * 1.8 + 1.2, 8.3, Math.sin(a) * 1.8, 3.6, .08, .8, -a, 0, -.35), 0xffffff]); } return merge(p); },
  fern: () => { const p = []; for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; p.push([box, M(Math.cos(a) * .7, .5, Math.sin(a) * .7, 1.6, .05, .4, -a, 0, .6), 0xffffff]); } return merge(p); },
  bigtree: () => merge([[cyl, M(0, 6, 0, 1.2, 12, 1.2), 0x3e2c1c], [sph, M(0, 13, 0, 10, 6, 10), 0xffffff], [sph, M(3, 11, 2, 6, 4, 6), 0xffffff], [cyl, M(.9, 1, 0, .2, 2, .2, 0, 0, .5), 0x3e2c1c]]),
  cactus: () => merge([[cyl, M(0, 2, 0, .6, 4, .6), 0xffffff], [sph, M(0, 4, 0, .6, .5, .6), 0xffffff], [cyl, M(.7, 2, 0, .4, .3, .4, 0, 0, Math.PI / 2), 0xffffff], [cyl, M(.9, 2.7, 0, .4, 1.4, .4), 0xffffff], [cyl, M(-.6, 2.6, 0, .35, .3, .35, 0, 0, Math.PI / 2), 0xffffff], [cyl, M(-.75, 3.1, 0, .35, 1, .35), 0xffffff]]),
  rock: () => merge([[new THREE.DodecahedronGeometry(1, 0), M(0, .4, 0, 1, .7, 1.2), 0xffffff], [new THREE.DodecahedronGeometry(.6, 0), M(.9, .2, .3), 0xffffff]]),
  shrub: () => merge([[ico, M(0, .4, 0, 1.4, .8, 1.4), 0xffffff]]),
};
const protoCache = {};
const proto = k => (protoCache[k] ||= PROTOS[k]());
const MAT = new THREE.MeshLambertMaterial({ vertexColors: true }); // luce semplice, economica su iPad

// spec: { proto, count, side: [minOff,maxOff], scale:[min,max] | fn, colors:[...], sy?:[min,max], y? }
function addSet(spec, ctx) {
  const im = new THREE.InstancedMesh(proto(spec.proto), MAT, spec.count);
  im.castShadow = !!spec.shadow; im.receiveShadow = false; im.frustumCulled = false;
  const items = [];
  for (let i = 0; i < spec.count; i++) {
    const it = { z: -SPAN + (i / spec.count) * SPAN * 2 + rnd(-3, 3) * (spec.regular ? 0 : 1) };
    if (spec.regular) it.z = -SPAN + (i / spec.count) * SPAN * 2;
    seed(it, spec); items.push(it);
    im.setColorAt(i, _c.set(spec.colors[(Math.random() * spec.colors.length) | 0]).offsetHSL(0, 0, rnd(-.04, .04)));
  }
  im.instanceColor.needsUpdate = true; root.add(im);
  const set = { im, items, spec }; sets.push(set); return set;
}
function seed(it, s) {
  const side = s.oneSide ?? (Math.random() < .5 ? -1 : 1);
  it.off = side * rnd(s.side[0], s.side[1]); it.ry = s.faceRoad ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : rnd(0, Math.PI * 2);
  const k = rnd(s.scale[0], s.scale[1]); it.sx = s.sxz ? rnd(...s.sxz) : k; it.sz = s.sxz ? rnd(...s.sxz) : k; it.sy = s.sy ? rnd(...s.sy) : k;
  if (s.faceRoad) it.ry = 0;
}
function place(set, ctx) {
  const cx = ctx.road?.centerX || (() => 0), sl = ctx.road?.slope || (() => 0);
  set.items.forEach((it, i) => { const ry = it.ry;
    _p.set(cx(it.z) + it.off, set.spec.y || 0, it.z); _q.setFromEuler(_e.set(0, set.spec.alignRoad ? Math.atan(sl(it.z)) : ry, 0)); _s.set(it.sx, it.sy, it.sz);
    set.im.setMatrixAt(i, _m.compose(_p, _q, _s)); });
  set.im.instanceMatrix.needsUpdate = true;
}

const HW = ctx => ctx.road?.halfWidth ?? ((ctx.road?.width ?? 14) / 2);
const ENVS = {
  city: { fog: [0xc8d3dc, .0016], hemi: [0xdfeaff, 0x5a5a4a, 1.0], sun: [0xfff0dc, 2.2, [60, 120, 40]], bg: 0xa9c4dc, road: [0xffffff, .9],
    sets: hw => [
      { proto: 'palazzo', count: 70, side: [hw + 14, hw + 30], scale: [1, 1], sxz: [10, 18], sy: [12, 26], colors: [0xe8c38a, 0xd9935f, 0xc9704f, 0xf0dcb0, 0xe0b070, 0xb85c40, 0xf2e6d0], faceRoad: true, alignRoad: true, shadow: true },
      { proto: 'lamp', count: 60, side: [hw + 1.5, hw + 1.5], scale: [1, 1], colors: [0xffffff], regular: true, alignRoad: true },
      { proto: 'rail', count: 150, side: [hw + .8, hw + .8], scale: [1, 1], colors: [0xffffff], regular: true, alignRoad: true, oneSide: -1 },
      { proto: 'rail', count: 150, side: [hw + .8, hw + .8], scale: [1, 1], colors: [0xffffff], regular: true, alignRoad: true, oneSide: 1 },
      { proto: 'cypress', count: 60, side: [hw + 5, hw + 12], scale: [.8, 1.3], colors: [0x2f4a22, 0x3a5a2a] },
      { proto: 'tree', count: 30, side: [hw + 6, hw + 40], scale: [.7, 1.1], colors: [0x4f7a30, 0x5d8a36, 0x3f6a28] },
    ] },
  jungle: { fog: [0x8fa88a, .0065], hemi: [0xcfe6c0, 0x1e2e14, .95], sun: [0xe8ffd0, 1.6, [30, 150, 20]], bg: 0x93ad8c, road: [0xffffff, 1],
    sets: hw => [
      { proto: 'bigtree', count: 90, side: [hw + 8, hw + 45], scale: [.7, 1.4], colors: [0x2f5a1e, 0x3d6e24, 0x24481a, 0x4a7a2a] },
      { proto: 'palm', count: 110, side: [hw + 3, hw + 25], scale: [.8, 1.3], colors: [0x3f7a26, 0x4d8a2e, 0x2e6a1e] },
      { proto: 'fern', count: 260, side: [hw + 1, hw + 14], scale: [.8, 2.2], colors: [0x3a7a24, 0x4f9a30, 0x2a5a1a] },
      { proto: 'shrub', count: 160, side: [hw + 1.5, hw + 20], scale: [.8, 2], colors: [0x2c5a1c, 0x3a6a22] },
    ] },
  desert: { fog: [0xe9d3ad, .0012], hemi: [0xfff0d8, 0x9a7448, 1.1], sun: [0xffe6c0, 2.8, [80, 90, -30]], bg: 0xe6cfa6, road: [0xffffff, 1],
    sets: hw => [
      { proto: 'cactus', count: 70, side: [hw + 4, hw + 40], scale: [.8, 1.6], colors: [0x4f7a3a, 0x5d8a44, 0x3f6a30] },
      { proto: 'rock', count: 90, side: [hw + 3, hw + 60], scale: [.6, 3.5], colors: [0xa0704a, 0x8a5e3e, 0xb88a5a] },
      { proto: 'shrub', count: 60, side: [hw + 3, hw + 30], scale: [.3, .7], colors: [0x8a8a4a, 0x7a6a3a] },
    ] },
};

function makeDunes(ctx) {
  const g = new THREE.PlaneGeometry(1600, 1600, 120, 120); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i);
    let h = 6 * Math.sin(x * .012 + Math.sin(z * .006) * 2) * Math.cos(z * .009) + 3 * Math.sin(x * .03 + z * .02) + 1.2 * Math.sin(x * .09 - z * .05);
    h = Math.max(0, h + 4); p.setY(i, h); _c.setHSL(.09, .5, .62 + h * .008).toArray(col, i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); m.receiveShadow = true;
  m.userData.mask = true; return m;
}

export function setEnvironment(env, ctx) {
  const E = ENVS[env] || ENVS.city; current = env in ENVS ? env : 'city';
  const scene = ctx.scene; dispose(ctx);
  root = new THREE.Group(); root.name = 'tratta-env'; scene.add(root);
  scene.fog = new THREE.FogExp2(E.fog[0], E.fog[1]); if (!ctx.keepBackground) scene.background = new THREE.Color(E.bg);
  hemi = new THREE.HemisphereLight(...E.hemi); root.add(hemi);
  sun = new THREE.DirectionalLight(E.sun[0], E.sun[1]); sun.position.set(...E.sun[2]); sun.userData.offset = E.sun[2];
  sun.castShadow = !!ctx.shadows; if (sun.castShadow) { sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 400 }); }
  root.add(sun, sun.target);
  // strada nettamente diversa dal terreno
  const roadTex = getTex('road', current), groundTex = getTex('ground', current);
  for (const mat of [ctx.roadMaterial, ctx.road?.material].filter(Boolean)) { mat.map = roadTex; mat.color?.set(E.road[0]); if ('roughness' in mat) mat.roughness = E.road[1]; mat.needsUpdate = true; }
  ctx.road && (ctx.road.texture = roadTex, ctx.road.grip = current === 'jungle' ? .75 : current === 'desert' ? .85 : 1);
  if (ctx.groundMaterial) { ctx.groundMaterial.map = groundTex; ctx.groundMaterial.needsUpdate = true; }
  else { const gr = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshLambertMaterial({ map: groundTex })); gr.rotation.x = -Math.PI / 2; gr.position.y = -.06; gr.receiveShadow = true; gr.userData.follow = true; root.add(gr); }
  if (current === 'desert') { dunes = makeDunes(ctx); dunes.position.y = -.1; root.add(dunes); } else dunes = null;
  const hw = HW(ctx);
  E.sets(hw).forEach(s => place(addSet(s, ctx), ctx));
  update(0, ctx); return root;
}

export function update(dt, ctx) {
  if (!root) return;
  const pz = ctx.player?.z ?? ctx.camera?.position.z ?? 0, cx = ctx.road?.centerX || (() => 0);
  for (const set of sets) { let moved = false;
    for (const it of set.items) {
      if (it.z > pz + SPAN * .25) { it.z -= SPAN * 2 * .625 + SPAN * .75; moved = true; if (!set.spec.regular) seed(it, set.spec); } // passato dietro -> davanti
      else if (it.z < pz - SPAN * 1.75) { it.z += SPAN * 2; moved = true; }
    }
    if (moved || ctx.road?.centerX) place(set, ctx);
  }
  for (const o of root.children) if (o.userData.follow) { o.position.x = cx(pz); o.position.z = pz; }
  if (dunes) { // dune: buco sotto la strada simulato abbassando i vertici vicino al centro strada
    dunes.position.set(0, -.1, Math.round(pz / 200) * 200); carveDunes(ctx);
  }
  if (sun) { const o = sun.userData.offset; sun.position.set(cx(pz) + o[0], o[1], pz + o[2]); sun.target.position.set(cx(pz), 0, pz); }
}
let carvedZ = null;
function carveDunes(ctx) {
  if (carvedZ === dunes.position.z) return; carvedZ = dunes.position.z;
  const p = dunes.geometry.attributes.position, cx = ctx.road?.centerX || (() => 0), hw = HW(ctx) + 6;
  if (!dunes.userData.base) dunes.userData.base = Float32Array.from({ length: p.count }, (_, i) => p.getY(i));
  const b = dunes.userData.base;
  for (let i = 0; i < p.count; i++) { const wz = p.getZ(i) + carvedZ, d = Math.abs(p.getX(i) - cx(wz)); const k = THREE.MathUtils.smoothstep(d, hw, hw + 25); p.setY(i, b[i] * k - (d < hw ? 1 : 0)); }
  p.needsUpdate = true; dunes.geometry.computeVertexNormals();
}

function dispose(ctx) {
  if (!root) return; root.parent?.remove(root);
  root.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.isMesh && !o.isInstancedMesh && o.geometry !== undefined && o.userData) o.geometry.dispose(); });
  root = null; sets = []; dunes = null; carvedZ = null;
}
export function getEnvironment() { return current; }
export default { setEnvironment, update, getEnvironment };
