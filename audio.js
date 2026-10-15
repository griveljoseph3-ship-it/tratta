// Tratta — audio.js: motore a strati legato agli RPM, vento e rotolamento con la velocità,
// stridio gomme in derapata, sirene spaziali (pan + distanza). Tutto sintetizzato con WebAudio (zero file).
let A = null, M, eng = [], engF, wind, windF, roll, rollF, screech, sir, sirG, sirP;
function noiseBuf(ac) { const b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = b.getChannelData(0); let l = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; l = (l + .02 * w) / 1.02; d[i] = w * .5 + l * 2; } return b; }
function noise(ac, type, f, q) { const s = ac.createBufferSource(); s.buffer = noiseBuf(ac); s.loop = true; const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ac.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(M); s.start(); return [g, fl]; }
export function unlock() {
  if (A) { if (A.state === 'suspended') A.resume(); return; }
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return;
  A = new AC(); M = A.createGain(); M.gain.value = .55; M.connect(A.destination);
  engF = A.createBiquadFilter(); engF.type = 'lowpass'; engF.frequency.value = 900; engF.Q.value = 2; engF.connect(M);
  for (const [t, m, v] of [['sawtooth', 1, .16], ['square', .5, .1], ['sawtooth', 2.01, .05]]) { const o = A.createOscillator(); o.type = t; const g = A.createGain(); g.gain.value = 0; o.connect(g).connect(engF); o.start(); eng.push({ o, g, m, v }); }
  [wind, windF] = noise(A, 'bandpass', 800, .6); [roll, rollF] = noise(A, 'lowpass', 160, 1); [screech] = noise(A, 'bandpass', 2400, 8);
  sir = A.createOscillator(); sir.type = 'triangle'; sirG = A.createGain(); sirG.gain.value = 0; sirP = A.createStereoPanner ? A.createStereoPanner() : A.createGain();
  sir.connect(sirG).connect(sirP).connect(M); sir.start();
}
const set = (p, v, t = .08) => p.setTargetAtTime(v, A.currentTime, t);
// st = {rpm 0..1, gear, speed m/s, throttle bool, drift 0..1, siren:{dist, pan}|null, muted}
export function update(st) {
  if (!A || A.state !== 'running') return;
  M.gain.value = st.muted ? 0 : .55;
  const rpm = Math.max(.12, Math.min(1.05, st.rpm || 0)), jitter = 1 + (Math.random() - .5) * .012;
  const f = (38 + rpm * 150) * jitter;
  for (const e of eng) { set(e.o.frequency, f * e.m, .03); set(e.g.gain, e.v * (st.throttle ? 1 : .55) * (.5 + rpm * .6)); }
  set(engF.frequency, 500 + rpm * 2200 * (st.throttle ? 1 : .6));
  const s = st.speed || 0;
  set(wind.gain, Math.min(.5, s * s * .00016) * (st.hood ? .7 : 1)); set(windF.frequency, 500 + s * 28);
  set(roll.gain, Math.min(.3, s * .006) + (st.offroad ? Math.min(.35, s * .02) : 0)); set(rollF.frequency, (st.offroad ? 60 : 90) + s * 3); // rombo della banchina
  set(screech.gain, Math.min(.18, (st.drift || 0) * .2 * Math.min(1, s / 15)), .05);
  if (st.siren) { const d = st.siren.dist; const ph = (A.currentTime * 1.6) % 2; set(sir.frequency, ph < 1 ? 650 + ph * 450 : 1100 - (ph - 1) * 450, .02); set(sirG.gain, Math.min(.12, 6 / Math.max(6, d)) * .12 / .12); if (sirP.pan) set(sirP.pan, Math.max(-1, Math.min(1, st.siren.pan))); }
  else set(sirG.gain, 0, .3);
}
export function thump(strength = 1) { // impatto: colpo basso breve
  if (!A || A.state !== 'running') return; const o = A.createOscillator(), g = A.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(90, A.currentTime); o.frequency.exponentialRampToValueAtTime(35, A.currentTime + .25);
  g.gain.setValueAtTime(.5 * strength, A.currentTime); g.gain.exponentialRampToValueAtTime(.001, A.currentTime + .3); o.connect(g).connect(M); o.start(); o.stop(A.currentTime + .32);
}
export function whoosh() {
  if (!A || A.state !== 'running') return; const s = A.createBufferSource(); s.buffer = noiseBuf(A); const f = A.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; const g = A.createGain();
  f.frequency.setValueAtTime(400, A.currentTime); f.frequency.exponentialRampToValueAtTime(3000, A.currentTime + .35); g.gain.setValueAtTime(.0001, A.currentTime); g.gain.exponentialRampToValueAtTime(.4, A.currentTime + .1); g.gain.exponentialRampToValueAtTime(.001, A.currentTime + .5);
  s.connect(f).connect(g).connect(M); s.start(); s.stop(A.currentTime + .55);
}
export default { unlock, update, thump, whoosh };
