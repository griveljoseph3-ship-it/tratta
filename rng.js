// Tratta — rng.js: casualità con seme per partita (ogni corsa diversa, ma riproducibile col seme).
let s = (Date.now() ^ (Math.random() * 2 ** 31)) >>> 0, seed0 = s;
export function reseed(seed) { s = seed0 = (seed == null ? (Date.now() ^ (Math.random() * 2 ** 31)) : seed) >>> 0 || 1; return seed0; }
export function getSeed() { return seed0; }
// mulberry32
export function rand() { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
export const range = (a, b) => a + rand() * (b - a);
export const pick = a => a[(rand() * a.length) | 0];
export default { reseed, getSeed, rand, range, pick };
