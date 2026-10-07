// Tratta — cars.js: procedural cars (Three.js 0.160). Units: metres. Cars face -Z, origin = ground centre.
// makeCar(type, opts) -> THREE.Group; userData.wheels = [Mesh...] (spin with wheel.rotation.x), userData.size = {L,W,H}
// Draw calls per car: ~5-7 merged meshes + 4 wheels (2 material groups each). Materials/geometries are cached & shared.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CAR_STATS = {
  berlina:     { accel: 5, topSpeed: 205, grip: 6, handling: 6, mass: 1450 },
  coupe:       { accel: 6, topSpeed: 230, grip: 7, handling: 8, mass: 1300 },
  supercar:    { accel: 9, topSpeed: 320, grip: 9, handling: 8, mass: 1400 },
  suv:         { accel: 5, topSpeed: 195, grip: 5, handling: 4, mass: 2100, offroad: true },
  pickup:      { accel: 5, topSpeed: 180, grip: 5, handling: 4, mass: 2200, offroad: true },
  muscle:      { accel: 8, topSpeed: 260, grip: 5, handling: 5, mass: 1700 },
  rally:       { accel: 7, topSpeed: 225, grip: 8, handling: 9, mass: 1250, offroad: true },
  furgone:     { accel: 3, topSpeed: 160, grip: 4, handling: 3, mass: 2500 },
  police:      { accel: 7, topSpeed: 240, grip: 7, handling: 7, mass: 1600 },
  truck:       { accel: 2, topSpeed: 120, grip: 4, handling: 2, mass: 9000 },
  interceptor: { accel: 9, topSpeed: 290, grip: 8, handling: 8, mass: 1650 },
};
const ALIAS = { 'coupé': 'coupe', 'pick-up': 'pickup', SUV: 'suv', 'muscle car': 'muscle', van: 'furgone', taxi: 'berlina', traffic: null };
const TRAFFIC = ['berlina', 'berlina', 'coupe', 'suv', 'suv', 'pickup', 'furgone', 'furgone', 'muscle', 'truck'];
const TRAFFIC_COLORS = [0xb8bec6, 0x1d2329, 0xf2f2f0, 0x8a1c1c, 0x1f3b6b, 0x50565c, 0x2f4f3a, 0xc9b48a, 0x6b2a5a, 0xd9d9d9];

// ---- profiles: side outline points [u (forward +), v (up)], front-bottom -> over top -> rear-bottom.
// cabin: closed glass polygon. axles: [front u, rear u], r: wheel radius.
const S = {
  berlina: { L: 4.6, W: 1.82, r: .33, axles: [1.42, -1.38], cw: .86,
    body: [[2.3, .32], [2.32, .58], [2.2, .74], [1.0, .86], [.62, .9], [-1.2, .92], [-1.95, .94], [-2.28, .9], [-2.3, .34]],
    cabin: [[.62, .9], [-.05, 1.38], [-1.05, 1.4], [-1.85, .94]] },
  coupe: { L: 4.4, W: 1.84, r: .33, axles: [1.38, -1.3], cw: .84,
    body: [[2.2, .3], [2.22, .54], [2.1, .7], [.9, .82], [.5, .86], [-1.6, .9], [-2.15, .9], [-2.2, .32]],
    cabin: [[.5, .86], [-.25, 1.28], [-.9, 1.3], [-1.9, .9]] },
  supercar: { L: 4.5, W: 1.98, r: .34, axles: [1.45, -1.35], cw: .78,
    body: [[2.25, .2], [2.28, .42], [1.8, .58], [.8, .74], [.4, .78], [-1.4, .86], [-2.2, .9], [-2.25, .3]],
    cabin: [[.6, .76], [-.2, 1.12], [-.8, 1.13], [-1.8, .86]] },
  suv: { L: 4.75, W: 1.95, r: .4, axles: [1.45, -1.45], cw: .9,
    body: [[2.37, .45], [2.4, .82], [2.28, 1.05], [1.2, 1.14], [.85, 1.16], [-2.3, 1.18], [-2.37, .5]],
    cabin: [[.85, 1.16], [.15, 1.72], [-2.15, 1.74], [-2.32, 1.18]] },
  pickup: { L: 5.3, W: 1.98, r: .42, axles: [1.75, -1.6], cw: .9,
    body: [[2.65, .48], [2.68, .9], [2.55, 1.12], [1.35, 1.18], [1.0, 1.2], [-.55, 1.2], [-.6, 1.12], [-2.6, 1.12], [-2.65, .5]],
    cabin: [[1.0, 1.2], [.4, 1.78], [-.45, 1.8], [-.55, 1.2]] },
  muscle: { L: 4.85, W: 1.92, r: .36, axles: [1.55, -1.42], cw: .82,
    body: [[2.42, .3], [2.45, .66], [2.3, .82], [.8, .9], [.45, .94], [-1.55, .96], [-2.38, .98], [-2.42, .34]],
    cabin: [[.45, .94], [-.3, 1.32], [-1.0, 1.33], [-1.75, .96]] },
  rally: { L: 4.2, W: 1.86, r: .34, axles: [1.3, -1.25], cw: .86,
    body: [[2.1, .36], [2.12, .64], [2.0, .78], [1.0, .9], [.6, .92], [-1.6, .98], [-2.05, .98], [-2.1, .4]],
    cabin: [[.6, .92], [-.1, 1.42], [-1.45, 1.42], [-1.95, .98]] },
  furgone: { L: 5.3, W: 2.0, r: .36, axles: [1.75, -1.65], cw: .94,
    body: [[2.65, .38], [2.68, .78], [2.5, 1.02], [1.75, 1.18], [1.5, 1.25], [-2.6, 1.3], [-2.65, .42]],
    cabin: [[1.5, 1.25], [.95, 2.15], [-2.55, 2.2], [-2.62, 1.3]], cabinPaint: true },
  police: { L: 4.7, W: 1.86, r: .34, axles: [1.45, -1.4], cw: .86,
    body: [[2.35, .32], [2.37, .6], [2.25, .76], [1.0, .88], [.62, .92], [-1.2, .94], [-2.0, .96], [-2.33, .92], [-2.35, .34]],
    cabin: [[.62, .92], [-.05, 1.4], [-1.05, 1.42], [-1.9, .96]] },
  interceptor: { L: 4.8, W: 1.95, r: .36, axles: [1.5, -1.45], cw: .82,
    body: [[2.4, .28], [2.42, .58], [2.25, .74], [.9, .86], [.5, .9], [-1.5, .94], [-2.38, .96], [-2.4, .32]],
    cabin: [[.5, .9], [-.3, 1.26], [-1.0, 1.27], [-1.8, .94]] },
  truck: { L: 7.6, W: 2.4, r: .5, axles: [2.6, -2.4], cw: .96,
    body: [[3.8, .55], [3.82, 1.2], [3.75, 1.55], [2.3, 1.6], [2.2, 1.6], [2.2, 1.0], [-3.8, 1.0], [-3.8, .6]],
    cabin: [[3.72, 1.6], [3.55, 2.9], [2.25, 2.95], [2.25, 1.6]], cabinPaint: true },
};
const DEF_COLOR = { berlina: 0x9aa4b1, coupe: 0xd23a1e, supercar: 0xf2b705, suv: 0x2a2f36, pickup: 0x6d7a52, muscle: 0x15306b,
  rally: 0x1b5fbf, furgone: 0xeeeeea, police: 0x2a6fb5, truck: 0xe9e6dc, interceptor: 0x111316 };

// ---- shared materials
const MC = new Map();
function mat(key, f) { if (!MC.has(key)) MC.set(key, f()); return MC.get(key); }
const paintMat = c => mat('p' + c, () => new THREE.MeshStandardMaterial({ color: c, metalness: .45, roughness: .35 }));
const M = {
  glass: () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x0d141c, metalness: .6, roughness: .12 })),
  trim: () => mat('trim', () => new THREE.MeshStandardMaterial({ color: 0x141518, roughness: .8 })),
  chrome: () => mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: .25 })),
  head: () => mat('head', () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.2 })),
  tail: () => mat('tail', () => new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a10, emissiveIntensity: 1 })),
  tire: () => mat('tire', () => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .95 })),
  rim: () => mat('rim', () => new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: .9, roughness: .3 })),
  blue: () => mat('blue', () => new THREE.MeshStandardMaterial({ color: 0x0030ff, emissive: 0x1040ff, emissiveIntensity: 2 })),
  red: () => mat('red', () => new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff1010, emissiveIntensity: 2 })),
  white: () => mat('white', () => new THREE.MeshStandardMaterial({ color: 0xf4f4f4, metalness: .3, roughness: .4 })),
};

// ---- geometry helpers
// extrude side profile across width w (centred), mapping u -> -z (forward) and v -> y
function extrudeProfile(pts, w, bevel = .06, holes = []) {
  const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  holes.forEach(h => sh.holes.push(h));
  const b = Math.min(bevel, w * .2);
  const g = new THREE.ExtrudeGeometry(sh, { depth: w - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * .8, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(w - 2 * b) / 2); g.rotateY(Math.PI / 2); // shape x -> -z
  return g.toNonIndexed ? g : g;
}
// body outline with wheel-arch cutouts along the bottom
function bodyShapePts(s) {
  const top = s.body, [fa, ra] = s.axles, R = s.r + .07, out = [];
  const front = top[0], rear = top[top.length - 1];
  out.push(...top);
  // bottom from rear to front, cutting arches
  const yb = Math.max(rear[1], front[1]) * .5 + Math.min(rear[1], front[1]) * .5;
  const arch = (cu) => { const pts = []; const cy = s.r; const half = Math.acos(Math.min(.99, (yb - cy) / R));
    for (let i = 0; i <= 10; i++) { const a = -half + (2 * half * i) / 10; pts.push([cu + Math.sin(a) * R, cy + Math.cos(a) * R]); } return pts; };
  out.push([rear[0], yb]);
  out.push(...arch(ra)); out.push(...arch(fa));
  out.push([front[0], yb]);
  return out;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const toNI = g => (g.index ? g.toNonIndexed() : g);
function mergeAll(list) { const gs = list.filter(Boolean).map(g => { g = toNI(g); ['uv', 'uv1', 'uv2'].forEach(a => a !== 'uv' && g.deleteAttribute(a)); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }); return gs.length ? mergeGeometries(gs) : null; }

// wheel geometry (tire + rim groups), cached per radius/width
const WG = new Map();
function wheelGeo(r, w) {
  const k = r + '_' + w; if (WG.has(k)) return WG.get(k);
  const tire = new THREE.CylinderGeometry(r, r, w, 20, 1).rotateZ(Math.PI / 2);
  const rimParts = [new THREE.CylinderGeometry(r * .62, r * .62, w + .02, 16).rotateZ(Math.PI / 2)];
  for (let i = 0; i < 5; i++) rimParts.push(new THREE.BoxGeometry(w * .3, r * 1.1, r * .12).rotateX(i * Math.PI / 2.5).translate(w * .38, 0, 0));
  const rim = mergeAll(rimParts), t = toNI(tire);
  const g = mergeGeometries([t, rim], true); WG.set(k, g); return g;
}

// part cache per type+variant (geometry is colour-independent)
const PC = new Map();
function parts(type) {
  if (PC.has(type)) return PC.get(type);
  const s = S[type], W = s.W, L = s.L, P = { paint: [], glass: [], trim: [], chrome: [], head: [], tail: [], white: [], blue: [], red: [], paint2: [] };
  P.paint.push(extrudeProfile(bodyShapePts(s), W, .09));
  const cw = W * s.cw;
  // greenhouse: glass + painted roof + pillars
  P[s.cabinPaint ? 'paint' : 'glass'].push(extrudeProfile(s.cabin, cw, .05));
  const c = s.cabin, roofF = c[1], roofR = c[2];
  if (!s.cabinPaint) {
    P.paint.push(extrudeProfile([[roofF[0] + .02, roofF[1] - .03], [roofF[0] - .02, roofF[1] + .03], [roofR[0], roofR[1] + .03], [roofR[0] - .03, roofR[1] - .03]], cw + .02, .02));
    const bu = (c[0][0] + c[3][0]) / 2 + .1, bh = (roofF[1] + c[0][1]) / 2;
    P.paint.push(box(cw + .03, roofF[1] - c[0][1] - .02, .1, 0, bh, -bu)); // B pillar
  } else { // side windows on boxy cabins
    const y0 = c[0][1] + .15, y1 = Math.min(c[1][1], c[2][1]) - .15;
    P.glass.push(box(cw + .04, y1 - y0, Math.abs(c[1][0] - c[2][0]) * (type === 'truck' ? .7 : .35), 0, (y0 + y1) / 2, -(c[1][0] - (type === 'truck' ? .55 : .5))));
    // windscreen
    P.glass.push(new THREE.PlaneGeometry(cw * .9, (y1 - y0) * 1.05).rotateY(0).rotateX(-Math.atan2(c[0][0] - c[1][0], c[1][1] - c[0][1])).translate(0, (y0 + y1) / 2 + .05, -((c[0][0] + c[1][0]) / 2) - .03));
  }
  // lights, grille, bumpers, mirrors
  const f = s.body[0][0], fy = s.body[1][1], r = s.body[s.body.length - 1][0], ry = s.body[s.body.length - 2][1];
  const lw = type === 'supercar' ? .42 : .32, lh = type === 'muscle' ? .12 : .1;
  for (const sx of [-1, 1]) {
    P.head.push(box(lw, lh, .06, sx * (W / 2 - lw / 2 - .12), fy - .05, -f + .02));
    P.tail.push(box(lw + .05, .1, .06, sx * (W / 2 - lw / 2 - .1), ry - .08, -r - .02));
    if (type !== 'truck') P.trim.push(box(.16, .1, .2, sx * (cw / 2 + .08), c[0][1] + .1, -(c[0][0] - .15))); // mirrors
    else P.trim.push(box(.08, .5, .25, sx * (W / 2 + .1), 2.1, -3.4));
  }
  P.trim.push(box(W * .5, type === 'suv' || type === 'pickup' || type === 'truck' ? .3 : .14, .06, 0, fy - .2, -f + .01)); // grille
  P.trim.push(box(W * .96, .14, .14, 0, s.body[0][1] + .07, -f + .05));  // front bumper lip
  P.trim.push(box(W * .96, .14, .14, 0, s.body[s.body.length - 1][1] + .07, -r - .05));
  P.trim.push(box(.05, .06, (s.axles[0] - s.axles[1]) * .6, W / 2 + .005, s.body[0][1] + .25, -(s.axles[0] + s.axles[1]) / 2)); // side trim
  P.trim.push(box(.05, .06, (s.axles[0] - s.axles[1]) * .6, -W / 2 - .005, s.body[0][1] + .25, -(s.axles[0] + s.axles[1]) / 2));
  // type extras
  if (type === 'supercar') { P.trim.push(box(W * .9, .05, .35, 0, 1.12, 1.95), box(.06, .25, .1, .6, 1.0, 1.95), box(.06, .25, .1, -.6, 1.0, 1.95));
    for (const sx of [-1, 1]) P.trim.push(box(.06, .22, .7, sx * (W / 2 + .01), .55, .4)); }
  if (type === 'muscle') { P.paint.push(box(.6, .1, .9, 0, .95, -1.4)); P.trim.push(box(.45, .04, .1, 0, .99, -1.86)); P.white.push(box(.22, .012, L * .98, .2, 0, 0), box(.22, .012, L * .98, -.2, 0, 0)); }
  if (type === 'rally') { P.trim.push(box(W * .85, .05, .3, 0, 1.25, 1.95), box(.05, .3, .08, .55, 1.1, 1.95), box(.05, .3, .08, -.55, 1.1, 1.95), box(.35, .1, .5, 0, 1.46, -.1));
    for (const sx of [-1, 1]) P.head.push(new THREE.CylinderGeometry(.11, .11, .06, 12).rotateX(Math.PI / 2).translate(sx * .3, .98, -2.15)); }
  if (type === 'pickup') { P.trim.push(box(W - .2, .06, 1.95, 0, 1.08, 1.55)); P.trim.push(box(W - .3, .08, .08, 0, 1.92, -.1)); }
  if (type === 'suv') { for (const sx of [-1, 1]) P.chrome.push(box(.05, .05, 2.2, sx * cw * .38, 1.78, .9)); }
  if (type === 'furgone') { P.trim.push(box(.02, .9, .02, W / 2 + .01, 1.6, .2)); }
  if (type === 'truck') { P.paint2.push(box(W, 2.6, 5.7, 0, 2.3, .85)); P.trim.push(box(W * .9, .2, 5.6, 0, .9, .85)); }
  if (type === 'police' || type === 'interceptor') {
    const ry2 = c[1][1] + .08, rz = -(c[1][0] + c[2][0]) / 2;
    if (type === 'police') { P.trim.push(box(1.1, .05, .26, 0, ry2 - .02, rz)); P.blue.push(box(.5, .1, .22, -.27, ry2 + .05, rz)); P.blue.push(box(.5, .1, .22, .27, ry2 + .05, rz));
      for (const sx of [-1, 1]) P.white.push(box(.02, .18, L * .82, sx * (W / 2 + .01), .62, -.05)); }
    else { P.blue.push(box(.3, .05, .04, .25, fy - .2, -f - .02)); P.red.push(box(.3, .05, .04, -.25, fy - .2, -f - .02)); P.blue.push(box(.5, .04, .04, .3, c[0][1] + .05, -(c[0][0] - .1))); P.red.push(box(.5, .04, .04, -.3, c[0][1] + .05, -(c[0][0] - .1))); }
  }
  const out = {}; for (const k in P) out[k] = mergeAll(P[k]); PC.set(type, out); return out;
}

export function makeCar(type = 'traffic', opts = {}) {
  type = ALIAS[type] !== undefined ? ALIAS[type] : type;
  if (!type) type = TRAFFIC[(Math.random() * TRAFFIC.length) | 0];
  if (!S[type]) type = 'berlina';
  const traffic = opts.traffic;
  const color = opts.color ?? (traffic ? TRAFFIC_COLORS[(Math.random() * TRAFFIC_COLORS.length) | 0] : DEF_COLOR[type]);
  const s = S[type], P = parts(type), g = new THREE.Group(); g.name = 'car_' + type;
  const mats = { paint: paintMat(color), glass: M.glass(), trim: M.trim(), chrome: M.chrome(), head: M.head(), tail: M.tail(), white: M.white(), blue: M.blue(), red: M.red(), paint2: paintMat(opts.color2 ?? 0xe9e6dc) };
  const shadows = opts.shadows !== false;
  for (const k in P) if (P[k]) { const m = new THREE.Mesh(P[k], mats[k]); m.name = k; m.castShadow = shadows && (k === 'paint' || k === 'paint2'); g.add(m); }
  // wheels
  const wg = wheelGeo(s.r, type === 'truck' ? .38 : type === 'supercar' || type === 'muscle' ? .3 : .26), wm = [M.tire(), M.rim()];
  g.userData.wheels = [];
  const wx = s.W / 2 - .17;
  for (const [n, u] of [['F', s.axles[0]], ['R', s.axles[1]]]) for (const [side, sx] of [['L', -1], ['R', 1]]) {
    const w = new THREE.Mesh(wg, wm); w.name = 'wheel_' + n + side; w.position.set(sx * wx, s.r, -u); if (sx < 0) w.rotation.y = Math.PI; // rim faces out
    w.castShadow = shadows && !traffic; g.add(w); g.userData.wheels.push(w);
  }
  // front-wheel steer helper: g.userData.steer(a)
  g.userData.steer = a => { for (const w of g.userData.wheels) if (w.name[6] === 'F') w.rotation.y = (w.position.x < 0 ? Math.PI : 0) + a; };
  g.userData.spin = d => { for (const w of g.userData.wheels) w.rotation.x -= d / s.r; };
  g.userData.lights = { siren: g.getObjectByName('blue'), siren2: g.getObjectByName('red') };
  g.userData.size = { L: s.L, W: s.W, H: Math.max(...s.cabin.map(p => p[1])) };
  g.userData.type = type; g.userData.stats = CAR_STATS[type];
  return g;
}
export const CAR_TYPES = Object.keys(S);
export default makeCar;
