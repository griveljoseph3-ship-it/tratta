// Tratta — road.js: strada vera su spline (curve, tornanti, salite, dossi, salti).
// Parametro s = metri percorsi lungo la strada (nello "spazio corsia" s = -z).
// Tabelle a passo 1 m: X,Z (mondo), heading θ (0 = verso -Z, positivo = curva a destra), curvatura κ, quota Y, pendenza.
import * as RNG from './rng.js';
const STEP = 1, CAP = 40000, OFF = 300; // OFF: la tabella parte 300 m prima dello start (strada dietro la camera)
const X = new Float32Array(CAP), Z = new Float32Array(CAP), TH = new Float32Array(CAP), K = new Float32Array(CAP), Y = new Float32Array(CAP), G = new Float32Array(CAP);
let n = 0, env = 'city', segs = [], seg = null, segLeft = 0, k0 = 0, g0 = 0, bumps = [];
export let ver = 0;
const smooth = t => t * t * (3 - 2 * t);

// generatore di segmenti per ambiente: {len, k (curvatura), g (pendenza), bump?}
// Settori lunghi (2.5–4.5 km), ognuno con un carattere diverso; l'ordine è rimescolato dal seme a ogni partita.
const SECTORS = {
  city: [['Viale lungomare', 'viale'], ['Centro storico', 'centro'], ['Tangenziale', 'tang'], ['Saliscendi di collina', 'colli']],
  jungle: [['Sentiero del fango', 'sentiero'], ['I salti del fiume', 'salti'], ['Ansa larga', 'ansa'], ['Radici e dossi', 'dossi']],
  desert: [['Rettifilo infinito', 'rett'], ['Mare di dune', 'dune'], ['Canyon rosso', 'canyon'], ['Pista dei salti', 'salti']],
  mountain: [['Tornanti del Lupo', 'tornanti'], ['Cresta panoramica', 'cresta'], ['Discesa rapida', 'discesa'], ['Tornanti stretti', 'tornanti2']],
};
let secOrder = [], secI = 0, secEnd = 0, style = '', secList = [];
function newSector(at) {
  const L = SECTORS[env] || SECTORS.city;
  if (secI >= secOrder.length) { const prev = secOrder[secOrder.length - 1]; secOrder = L.map((_, i) => i); for (let i = secOrder.length - 1; i > 0; i--) { const j = (RNG.rand() * (i + 1)) | 0; [secOrder[i], secOrder[j]] = [secOrder[j], secOrder[i]]; } if (secOrder[0] === prev) secOrder.push(secOrder.shift()); secI = 0; }
  const sec = L[secOrder[secI++]]; style = sec[1]; secEnd = at + 2500 + RNG.rand() * 2000; secList.push({ s: at, name: sec[0], style });
}
export function sectorAt(s) { let r = null; for (const q of secList) if (q.s <= s) r = q; return r; }
function nextSeg() {
  const r = RNG.rand, at = n * STEP - OFF;
  if (at >= secEnd) newSector(at);
  // curve che riportano verso la direzione media: la strada non si richiude mai su sé stessa
  const th = n ? TH[n - 1] : 0, sgn = () => (Math.abs(th) > 1.1 ? -Math.sign(th) : r() < .5 ? -1 : 1);
  const straight = (a, b) => ({ len: Math.round(a + r() * (b - a)), k: 0, g: 0 });
  const curve = (l0, l1, R0, R1, g) => ({ len: Math.round(l0 + r() * (l1 - l0)), k: sgn() / (R0 + r() * (R1 - R0)), g: g ?? (r() - .5) * .04 });
  const bump = (jumpP, h0, h1) => ({ len: 80, k: 0, g: 0, bump: { at: 25, len: 16 + r() * 12, h: h0 + r() * (h1 - h0), jump: r() < jumpP } });
  const t = r();
  switch (style) {
    case 'tornanti': case 'tornanti2': { // rettilinei in salita/discesa + curve a 180° esatte (gambe parallele)
      climbN++; const dir = Math.floor(n / 1700) % 2 ? -1 : 1;
      if (climbN % 2) return { len: Math.round((style === 'tornanti2' ? 80 : 120) + r() * 120), k: 0, g: dir * (.05 + r() * .035), climb: dir };
      const R = (style === 'tornanti2' ? 20 : 24) + r() * 6; lastHair = -lastHair; return { len: Math.round(2 * Math.PI * R), k: lastHair, R, g: dir * .025, hair: true, climb: dir };
    }
    case 'cresta': return t < .3 ? straight(60, 140) : curve(80, 160, 70, 130, (r() - .5) * .08);
    case 'discesa': return t < .5 ? { ...straight(150, 300), g: -.06 - r() * .03 } : curve(90, 180, 90, 160, -.05);
    case 'viale': return t < .6 ? straight(180, 360) : curve(120, 220, 220, 400, 0);
    case 'centro': return t < .3 ? straight(50, 110) : curve(50, 90, 55, 90, (r() - .5) * .02);
    case 'tang': return curve(160, 320, 160, 260, (r() - .5) * .05);
    case 'colli': return t < .45 ? bump(0, 1.2, 2.2) : curve(80, 160, 120, 220, (r() - .5) * .07);
    case 'sentiero': return t < .15 ? bump(.3, 1.2, 2) : curve(40, 90, 60, 100, (r() - .5) * .07);
    case 'salti': return t < .45 ? bump(.85, 1.6, 3) : curve(60, 120, 110, 200, (r() - .5) * .05);
    case 'ansa': return t < .2 ? straight(80, 160) : curve(150, 260, 140, 240, (r() - .5) * .05);
    case 'dossi': return t < .55 ? bump(.15, 1.2, 2.6) : curve(60, 110, 90, 160, (r() - .5) * .06);
    case 'rett': return t < .7 ? straight(300, 600) : t < .85 ? bump(.5, 1.5, 2.5) : curve(150, 250, 300, 500, 0);
    case 'dune': return t < .5 ? bump(.25, 1.5, 3) : curve(100, 180, 170, 300, (r() - .5) * .06);
    case 'canyon': return t < .2 ? straight(60, 120) : curve(70, 130, 70, 120, (r() - .5) * .04);
    default: return t < .45 ? straight(80, 200) : curve(80, 220, 110, 310, (r() - .5) * .03);
  }
}
let lastHair = 1, climbN = 0;
export function reset(e) {
  env = e || env; n = 0; segs = []; bumps = []; seg = null; segLeft = 0; k0 = 0; g0 = 0; climbN = 0; lastHair = RNG.rand() < .5 ? 1 : -1; ver++; secOrder = []; secI = 0; secList = []; newSector(120);
  X[0] = 0; Z[0] = 0; TH[0] = 0; K[0] = 0; Y[0] = 0; G[0] = 0; n = 1;
  // 300 m dietro + primi 120 m dritti e piani: si parte sempre tranquilli
  seg = { len: 120 + OFF, k: 0, g: 0 }; segLeft = seg.len; segs.push({ s: -OFF, ...seg });
  ensure(1500 + OFF);
}
export function getEnv() { return env; }
function ensure(s) {
  const need = Math.min(CAP - 2, Math.ceil(s / STEP) + 2);
  while (n <= need) {
    if (segLeft <= 0) { seg = nextSeg(); segLeft = seg.len; segs.push({ s: n * STEP - OFF, ...seg }); if (seg.bump) bumps.push({ s: n * STEP - OFF + seg.bump.at, ...seg.bump }); }
    const i = n, p = i - 1, done = 1 - segLeft / seg.len;
    // curvatura e pendenza raccordate (niente spigoli): blend nei primi 25 m del segmento
    const blend = smooth(Math.min(1, (seg.len - segLeft) / Math.min(25, seg.len * .5)));
    const kt = seg.k;
    if (seg.hair) { const t = (seg.len - segLeft + .5) / seg.len; K[i] = seg.k * (Math.PI / seg.len) * (1 - Math.cos(2 * Math.PI * t)); } // ∫K = π esatto
    else K[i] = k0 + (kt - k0) * blend;
    const gg = g0 + (seg.g - g0) * blend;
    if (segLeft - STEP <= 0) { k0 = seg.hair ? 0 : kt; g0 = seg.g; }
    TH[i] = TH[p] + K[i] * STEP;
    X[i] = X[p] + Math.sin(TH[i]) * STEP; Z[i] = Z[p] - Math.cos(TH[i]) * STEP;
    let y = Y[p] + gg * STEP;
    if (env === 'city') y = Math.max(-6, Math.min(6, y)); else if (env === 'desert') y = Math.max(-12, Math.min(12, y)); else if (env === 'jungle') y = Math.max(-15, Math.min(15, y));
    Y[i] = y; segLeft -= STEP; n++; void done;
  }
  // dossi/salti: sommati alla quota (rampa ripida + caduta per i salti)
}
function bumpAt(s) {
  for (let i = bumps.length - 1; i >= 0; i--) { const b = bumps[i]; const t = (s - b.s) / b.len; if (t < 0 || t > 1) continue;
    return b.jump ? (t < .7 ? b.h * Math.pow(t / .7, 1.6) : b.h * (1 - smooth((t - .7) / .3))) : b.h * Math.sin(Math.PI * t); }
  return 0;
}
function lerpArr(A, s) { s += OFF; if (s < 0) s = 0; if (s > CAP - 420) s = CAP - 420; ensure(s + 400); const f = s / STEP, i = f | 0, t = f - i; return A[i] + (A[i + 1] - A[i]) * t; }
export const x = s => lerpArr(X, s), z = s => lerpArr(Z, s), heading = s => lerpArr(TH, s), kappa = s => lerpArr(K, s);
export const y = s => lerpArr(Y, s) + bumpAt(s);
export const slope = s => (y(s + .5) - y(s - .5));
export function isJump(s) { for (const b of bumps) if (b.jump && s > b.s && s < b.s + b.len) return true; return false; }
export function bumpsNear(s0, s1, out) { out.length = 0; for (const b of bumps) if (b.s + b.len > s0 && b.s < s1) out.push(b); return out; }
// curvatura massima nei prossimi d metri (per far frenare IA e mostrare avvisi)
export function maxKappaAhead(s, d) { let m = 0; for (let t = 0; t < d; t += 4) m = Math.max(m, Math.abs(kappa(s + t))); return m; }
export function frame(s, lat, out) { // posizione mondo di un punto a (s, offset laterale)
  const th = heading(s), c = Math.cos(th), sn = Math.sin(th);
  out.x = x(s) + c * lat; out.z = z(s) + sn * lat; out.y = y(s); out.th = th; return out;
}
// lato in salita (+1 destra, -1 sinistra) in montagna: interno del prossimo tornante (in discesa l'opposto)
export function uphillSide(s) { if (env !== 'mountain') return 0; ensure(s + OFF + 400); for (const q of segs) if (q.hair && q.s + q.len > s) return Math.sign(q.k) * (q.climb || 1); return 1; }
export function hairRadius(s) { for (const q of segs) if (q.hair && q.s + q.len > s) return q.R; return 30; }
export function segmentsBetween(a, b) { return segs.filter(q => q.s + q.len > a && q.s < b); }
export default { sectorAt, uphillSide, hairRadius, reset, x, z, y, heading, kappa, slope, frame, maxKappaAhead, isJump, getEnv, bumpsNear };
