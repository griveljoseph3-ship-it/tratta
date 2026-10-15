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
function nextSeg() {
  const r = RNG.rand;
  // curve che riportano verso la direzione media: la strada non si richiude mai su sé stessa
  const th = n ? TH[n - 1] : 0, sgn = () => (Math.abs(th) > 1.1 ? -Math.sign(th) : r() < .5 ? -1 : 1);
  const straight = (a, b) => ({ len: a + r() * (b - a), k: 0, g: 0 });
  switch (env) {
    case 'mountain': { // tornanti: rettilinei in salita/discesa + curve a 180° esatte (le gambe restano parallele, a 2R)
      climbN++; const dir = Math.floor(n / 1700) % 2 ? -1 : 1;
      if (climbN % 2) return { len: 110 + r() * 130, k: 0, g: dir * (.05 + r() * .035), climb: dir };
      const R = 22 + r() * 6; lastHair = -lastHair; return { len: Math.round(2 * Math.PI * R), k: lastHair, R, g: dir * .025, hair: true, climb: dir };
    }
    case 'jungle': { // curve morbide, dossi e salti
      const t = r();
      if (t < .28) return { len: 80, k: 0, g: 0, bump: { at: 25, len: 16 + r() * 10, h: 1.4 + r() * 1.4, jump: r() < .55 } };
      return { len: 60 + r() * 120, k: sgn() / (95 + r() * 160), g: (r() - .5) * .07 };
    }
    case 'desert': return r() < .45 ? straight(120, 260) : { len: 100 + r() * 150, k: sgn() / (170 + r() * 250), g: (r() - .5) * .05, bump: r() < .3 ? { at: 30, len: 30 + r() * 20, h: 1.2 + r(), jump: false } : null };
    default: return r() < .45 ? straight(80, 200) : { len: 80 + r() * 140, k: sgn() / (110 + r() * 200), g: (r() - .5) * .03 };
  }
}
let lastHair = 1, climbN = 0;
export function reset(e) {
  env = e || env; n = 0; segs = []; bumps = []; seg = null; segLeft = 0; k0 = 0; g0 = 0; climbN = 0; lastHair = RNG.rand() < .5 ? 1 : -1; ver++;
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
export default { uphillSide, hairRadius, reset, x, z, y, heading, kappa, slope, frame, maxKappaAhead, isJump, getEnv, bumpsNear };
