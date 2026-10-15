// Tratta — hud.js: HUD noir-neon (tachimetro con arco giri e marcia, minimappa, comandi touch minimal).
// Touch: metà sinistra = cursore di sterzo (trascina); destra = cluster sotto il pollice GAS (grande) · FRENO · DRIFT · NITRO.
import * as Road from './road.js';

const CSS = `
:root{--neo:#22e1ff;--neo2:#ff2d6f;--ink:rgba(8,10,18,.62);--line:rgba(140,220,255,.18)}
#ui,#hudX,.hx{font-family:"Rajdhani","SF Pro Display","Segoe UI",system-ui,sans-serif}
.hx{position:fixed;pointer-events:none;z-index:40;color:#eaf6ff}
.glass{background:linear-gradient(180deg,rgba(14,18,30,.72),rgba(6,8,14,.62));border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
#speedo{right:18px;bottom:16px;width:188px;height:188px}
body.touch #speedo{right:auto;left:50%;transform:translateX(-50%);bottom:6px;width:168px;height:168px}
#speedo svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 4px 14px rgba(0,0,0,.55))}
#speedo .num{font:800 54px/1 "SF Pro Display","Segoe UI",system-ui;font-variant-numeric:tabular-nums;fill:#fff}
#speedo .unit{font:600 11px system-ui;letter-spacing:3px;fill:#9fb3c8}
#speedo .gear{font:800 20px system-ui;fill:var(--neo)}
#speedo .tag{font:800 11px system-ui;letter-spacing:2px;fill:var(--neo2)}
#mmap{right:16px;top:14px;width:132px;height:132px;border-radius:50%;overflow:hidden}
#mmap canvas{width:100%;height:100%;display:block}
#hxTop{right:158px;top:18px;display:flex;gap:8px;pointer-events:auto}
.ibtn{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#cfefff;font:700 17px system-ui;cursor:pointer}
@keyframes pulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.12);opacity:1}}
#hxStars{animation:pulse .9s ease-in-out infinite;right:16px;top:152px;width:132px;text-align:center;font:800 17px system-ui;letter-spacing:4px;color:#ff3355;text-shadow:0 0 10px rgba(255,40,80,.7)}
#hxAir{left:50%;top:22%;transform:translateX(-50%);font:900 28px system-ui;letter-spacing:6px;color:#fff;text-shadow:0 0 18px var(--neo);opacity:0;transition:opacity .2s}
/* touch */
#tc{position:fixed;inset:0;z-index:30;pointer-events:none;display:none}
body.touch #tc{display:block}
#tSteer{position:absolute;left:0;bottom:0;width:42%;height:58%;pointer-events:auto;touch-action:none}
#tTrack{position:absolute;left:28px;bottom:36px;width:min(300px,32vw);height:6px;border-radius:3px;background:linear-gradient(90deg,rgba(34,225,255,.0),rgba(34,225,255,.35),rgba(34,225,255,.0))}
#tKnob{position:absolute;top:50%;left:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;border:2px solid var(--neo);background:radial-gradient(circle,rgba(34,225,255,.28),rgba(8,10,18,.55) 70%);box-shadow:0 0 18px rgba(34,225,255,.45)}
#tCl{position:absolute;right:16px;bottom:14px;width:262px;height:206px;pointer-events:none}
.tb{position:absolute;pointer-events:auto;touch-action:none;display:grid;place-items:center;text-align:center;font:800 12px "Rajdhani","Segoe UI",system-ui;letter-spacing:2px;color:#eaf6ff;border-radius:50%;border:1.5px solid var(--c);background:radial-gradient(circle at 50% 38%,color-mix(in srgb,var(--c) 26%,transparent),rgba(8,10,18,.62) 72%);box-shadow:0 0 16px color-mix(in srgb,var(--c) 30%,transparent);transition:transform .08s,background .08s}
.tb.on{transform:scale(.92);background:radial-gradient(circle,color-mix(in srgb,var(--c) 65%,transparent),rgba(8,10,18,.7) 78%);box-shadow:0 0 26px var(--c)}
#tG{--c:#3ddc84;right:0;bottom:0;width:116px;height:116px;font-size:15px}
#tB{--c:#ff2d6f;right:126px;bottom:0;width:86px;height:86px}
#tH{--c:#ffb020;right:128px;bottom:98px;width:72px;height:72px;font-size:11px}
#tN{--c:#22e1ff;right:22px;bottom:126px;width:76px;height:76px;font-size:11px}
#tN svg{position:absolute;inset:-6px;width:88px;height:88px;transform:rotate(-90deg)}
/* restyling dei pannelli dei moduli */
#storyHud{top:14px!important;left:14px!important;border-radius:14px!important;background:linear-gradient(180deg,rgba(14,18,30,.74),rgba(6,8,14,.62))!important;border:1px solid var(--line)!important;border-left:3px solid var(--neo2)!important;box-shadow:0 8px 30px rgba(0,0,0,.35)!important;max-width:min(380px,40vw)}
#modesHud{border-radius:14px!important;background:linear-gradient(180deg,rgba(14,18,30,.74),rgba(6,8,14,.62))!important;border:1px solid var(--line)!important;border-bottom:2px solid var(--neo)!important}
#policeHud{display:none!important}
#diffHud{display:none!important}
.panel{background:linear-gradient(180deg,rgba(16,20,34,.94),rgba(8,10,18,.94))!important;border:1px solid var(--line)!important;border-top:2px solid var(--neo)!important;border-radius:18px!important}
.go{background:linear-gradient(90deg,#ff2d6f,#ff5a3c)!important;border-radius:12px!important;box-shadow:0 0 18px rgba(255,45,111,.35)}
.choice.active{border-color:var(--neo)!important;background:rgba(34,225,255,.12)!important}
#msg{font:900 30px system-ui!important;letter-spacing:2px;text-shadow:0 0 18px rgba(34,225,255,.6),0 3px 10px #000!important}
`;
const R = 84, ARC = 270, C0 = 135; // arco giri: da 135° a 405°
const arcLen = 2 * Math.PI * R * ARC / 360;
const pt = (a, r) => { const t = a * Math.PI / 180; return [100 + Math.cos(t) * r, 100 + Math.sin(t) * r]; };
const arcPath = (a0, a1, r) => { const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };

let ctx, E = {}, touch = false, mm, mg, getDots;
export const input = { steer: 0 };
let steerId = null, x0 = 0;

function el(tag, id, cls, html, parent = document.body) { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (html) e.innerHTML = html; parent.appendChild(e); return e; }

export function init(o) {
  ctx = o.ctx; touch = o.isTouch; getDots = o.getDots;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  if (touch) document.body.classList.add('touch');
  // tachimetro
  const ticks = Array.from({ length: 10 }, (_, i) => { const a = C0 + ARC * i / 9, [x0_, y0_] = pt(a, R + 9), [x1, y1] = pt(a, R + (i % 3 ? 13 : 16)); return `<line x1="${x0_}" y1="${y0_}" x2="${x1}" y2="${y1}" stroke="${i >= 8 ? '#ff2d6f' : '#9fd8ff'}" stroke-opacity=".7" stroke-width="${i % 3 ? 1.5 : 2.5}"/>`; }).join('');
  E.speedo = el('div', 'speedo', 'hx', `<svg viewBox="0 0 200 200">
    <defs><linearGradient id="gR" x1="0" x2="1"><stop offset="0" stop-color="#22e1ff"/><stop offset=".7" stop-color="#7a5cff"/><stop offset="1" stop-color="#ff2d6f"/></linearGradient>
    <radialGradient id="gB"><stop offset=".6" stop-color="rgba(6,8,14,.82)"/><stop offset="1" stop-color="rgba(6,8,14,.35)"/></radialGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <circle cx="100" cy="100" r="98" fill="url(#gB)" stroke="rgba(140,220,255,.16)"/>
    ${ticks}
    <path d="${arcPath(C0, C0 + ARC, R)}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="9" stroke-linecap="round"/>
    <path d="${arcPath(C0 + ARC * .88, C0 + ARC, R)}" fill="none" stroke="rgba(255,45,111,.25)" stroke-width="9"/>
    <path id="hxRpm" d="${arcPath(C0, C0 + ARC, R)}" fill="none" stroke="url(#gR)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${arcLen} ${arcLen}" stroke-dashoffset="${arcLen}" filter="url(#glow)"/>
    <path id="hxNit" d="${arcPath(150, 210, 66)}" fill="none" stroke="#22e1ff" stroke-width="4" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * 66 / 6} 999" opacity=".9"/>
    <path id="hxHp" d="${arcPath(330, 390, 66)}" fill="none" stroke="#3ddc84" stroke-width="4" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * 66 / 6} 999" opacity=".9"/>
    <text x="100" y="108" text-anchor="middle" class="num" id="hxSpd">0</text>
    <text x="100" y="126" text-anchor="middle" class="unit">KM/H</text>
    <rect x="86" y="140" width="28" height="26" rx="7" fill="rgba(34,225,255,.12)" stroke="rgba(34,225,255,.5)"/>
    <text x="100" y="160" text-anchor="middle" class="gear" id="hxGear">1</text>
    <text x="100" y="62" text-anchor="middle" class="tag" id="hxTag"></text>
    <text x="52" y="128" text-anchor="middle" class="unit" style="font-size:8px">N2O</text><text x="148" y="128" text-anchor="middle" class="unit" style="font-size:8px">HP</text>
  </svg>`);
  E.rpm = E.speedo.querySelector('#hxRpm'); E.spd = E.speedo.querySelector('#hxSpd'); E.gear = E.speedo.querySelector('#hxGear'); E.tag = E.speedo.querySelector('#hxTag'); E.nit = E.speedo.querySelector('#hxNit'); E.hp = E.speedo.querySelector('#hxHp');
  // minimappa
  E.mm = el('div', 'mmap', 'hx glass', '<canvas width="264" height="264"></canvas>'); mm = E.mm.firstChild; mg = mm.getContext('2d');
  E.stars = el('div', 'hxStars', 'hx', '');
  E.air = el('div', 'hxAir', 'hx', 'IN VOLO');
  // linee di velocità: canvas a mezza risoluzione, disegnato solo oltre ~100 km/h o col nitro
  E.sl = el('canvas', 'hxLines', 'hx', ''); E.sl.style.cssText = 'inset:0;width:100%;height:100%;z-index:5;mix-blend-mode:screen'; E.slg = E.sl.getContext('2d');
  const rs = () => { E.sl.width = innerWidth >> 1; E.sl.height = innerHeight >> 1; }; rs(); addEventListener('resize', rs);
  E.lines = Array.from({ length: 46 }, () => ({ a: Math.random() * 6.283, r: Math.random(), v: .6 + Math.random() * .8 }));
  E.top = el('div', 'hxTop', 'hx', '');
  // touch
  const tc = el('div', 'tc', '', `<div id="tSteer"><div id="tTrack"><div id="tKnob"></div></div></div><div id="tCl"><div id="tG" class="tb">GAS</div><div id="tB" class="tb">FRENO</div><div id="tH" class="tb">DRIFT</div><div id="tN" class="tb"><svg viewBox="0 0 88 88"><circle cx="44" cy="44" r="41" fill="none" stroke="rgba(34,225,255,.18)" stroke-width="3"/><circle id="tNr" cx="44" cy="44" r="41" fill="none" stroke="#22e1ff" stroke-width="3" stroke-dasharray="258 258" stroke-dashoffset="0" stroke-linecap="round"/></svg>NITRO</div></div>`);
  E.knob = tc.querySelector('#tKnob'); E.track = tc.querySelector('#tTrack'); E.tNr = tc.querySelector('#tNr');
  const zone = tc.querySelector('#tSteer'), keys = ctx.keys;
  const prevent = e => { e.preventDefault(); };
  zone.addEventListener('pointerdown', e => { prevent(e); steerId = e.pointerId; x0 = e.clientX; try { zone.setPointerCapture(e.pointerId); } catch {} setSteer(0); });
  zone.addEventListener('pointermove', e => { if (e.pointerId !== steerId) return; setSteer((e.clientX - x0) / 70); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, e => { if (e.pointerId !== steerId) return; steerId = null; setSteer(0); });
  zone.addEventListener('contextmenu', prevent);
  // cluster destro: GAS grande, FRENO, DRIFT (freno a mano), NITRO — glow + vibrazione quando premuti
  for (const [id, k, buzz] of [['tG', 'ArrowUp', 8], ['tB', 'ArrowDown', 14], ['tH', 'Handbrake', 20], ['tN', 'Space', 30]]) {
    const b = tc.querySelector('#' + id); E[id] = b;
    b.addEventListener('pointerdown', e => { prevent(e); try { b.setPointerCapture(e.pointerId); } catch {} keys[k] = true; b.classList.add('on'); navigator.vibrate?.(buzz); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { keys[k] = false; b.classList.remove('on'); });
    b.addEventListener('contextmenu', prevent);
  }
}
export function topButton(label, title, fn) { const b = el('button', null, 'ibtn glass', label, E.top); b.title = title; b.onclick = fn; return b; }
function setSteer(v) { input.steer = Math.max(-1, Math.min(1, v)); const w = E.track.clientWidth || 260; E.knob.style.transform = `translateX(${(input.steer * w * .42).toFixed(1)}px)`; }

export function tick() {}
let t20 = 0, t10 = 0, lastStars = '';
export function update(dt, show) {
  const vis = show ? '' : 'none';
  if (E.speedo.style.display !== vis) { for (const k of ['speedo', 'mm', 'stars', 'air', 'sl']) E[k].style.display = vis; document.getElementById('tc').style.visibility = show ? 'visible' : 'hidden'; }
  if (!show) return;
  t20 += dt; t10 += dt; const p = ctx.player;
  if (t20 >= .05) { t20 = 0;
    E.spd.textContent = Math.round(p.speed * 3.6);
    const r = Math.min(1, Math.max(0, p.rpm || 0)); E.rpm.setAttribute('stroke-dashoffset', (arcLen * (1 - r)).toFixed(1));
    E.gear.textContent = p.shiftT > 0 ? '·' : p.speed < .5 && ctx.keys.ArrowDown ? 'R' : p.gear;
    E.tag.textContent = p.air ? 'IN VOLO' : p.drift > .35 ? 'DRIFT' : ctx.keys.Space && p.nitro > 0 ? 'NITRO' : '';
    const L = 2 * Math.PI * 66 / 6; E.nit.setAttribute('stroke-dasharray', `${(L * p.nitro).toFixed(1)} 999`); E.hp.setAttribute('stroke-dasharray', `${(L * Math.max(0, p.health) / (p.maxHealth || 100)).toFixed(1)} 999`);
    E.hp.setAttribute('stroke', p.health < 35 ? '#ff2d6f' : p.health < 65 ? '#ffb020' : '#3ddc84');
    E.air.style.opacity = p.air && p.airT > .35 ? 1 : 0;
    if (touch) E.tNr.setAttribute('stroke-dashoffset', (251 * (1 - p.nitro)).toFixed(0));
  }
  speedLines(dt);
  if (t10 >= .1) { t10 = 0; drawMap(); const h = ctx.debug.Police?.getState?.().heat || 0; const s = h ? '★'.repeat(h) + '☆'.repeat(5 - h) : ''; if (s !== lastStars) { E.stars.textContent = s; lastStars = s; } }
}
let slT = 0, slOn = false;
function speedLines(dt) {
  const p = ctx.player, nit = ctx.keys.Space && p.nitro > 0, k = Math.max(0, Math.min(1, (p.speed - 28) / 30)) + (nit ? .5 : 0);
  slT += dt; if (slT < 1 / 30) return; const d = slT; slT = 0;
  const g = E.slg, W = E.sl.width, H = E.sl.height;
  if (k <= 0 || ctx.state.cinema) { if (slOn) { g.clearRect(0, 0, W, H); slOn = false; } return; } slOn = true;
  g.clearRect(0, 0, W, H); const cx = W / 2, cy = H * .46, R = Math.hypot(W, H) * .55;
  g.lineCap = 'round'; g.strokeStyle = nit ? 'rgba(120,230,255,.55)' : 'rgba(255,255,255,.38)';
  for (const l of E.lines) { l.r += l.v * d * (1.2 + k * 2.2); if (l.r > 1) { l.r = .35 + Math.random() * .2; l.a = Math.random() * 6.283; }
    const r0 = R * l.r, r1 = R * Math.min(1.05, l.r + .07 + k * .12), c = Math.cos(l.a), sn = Math.sin(l.a);
    if (Math.abs(sn) > .9 && sn < 0) continue; // niente linee sul cielo in alto al centro
    g.globalAlpha = Math.min(1, k) * l.r; g.lineWidth = 1 + l.r * 2.2; g.beginPath(); g.moveTo(cx + c * r0, cy + sn * r0 * .7); g.lineTo(cx + c * r1, cy + sn * r1 * .7); g.stroke(); }
  g.globalAlpha = 1;
}
const F = { x: 0, y: 0, z: 0, th: 0 };
function drawMap() {
  const g = mg, W = 264, p = ctx.player, s = -p.z; Road.frame(s, p.x, F);
  const px = F.x, pz = F.z, th = F.th - p.h, c = Math.cos(th), sn = Math.sin(th), K = .62; // px per metro (canvas 2x)
  const tx = (x, z) => { const dx = x - px, dz = z - pz; return [W / 2 + (dx * c + dz * sn) * K, W * .64 + (-dx * sn + dz * c) * K]; };
  g.clearRect(0, 0, W, W); g.fillStyle = 'rgba(4,6,12,.55)'; g.fillRect(0, 0, W, W);
  g.lineCap = g.lineJoin = 'round';
  const path = () => { g.beginPath(); for (let t = s - 120; t <= s + 330; t += 6) { const [a, b] = tx(Road.x(t), Road.z(t)); t === s - 120 ? g.moveTo(a, b) : g.lineTo(a, b); } };
  path(); g.strokeStyle = 'rgba(34,225,255,.25)'; g.lineWidth = 22; g.stroke();
  path(); g.strokeStyle = '#141a26'; g.lineWidth = 14; g.stroke();
  path(); g.strokeStyle = 'rgba(34,225,255,.8)'; g.lineWidth = 2; g.stroke();
  const dots = getDots ? getDots() : [];
  for (const d of dots) { const [a, b] = tx(d.x, d.z); if (a < -10 || a > W + 10 || b < -10 || b > W + 10) continue; g.fillStyle = d.cop ? (performance.now() % 500 < 250 ? '#ff2d55' : '#3b7bff') : 'rgba(235,240,255,.85)'; g.beginPath(); g.arc(a, b, d.cop ? 6 : 4.5, 0, 7); g.fill(); }
  // giocatore
  g.save(); g.translate(W / 2, W * .64); g.fillStyle = '#fff'; g.shadowColor = '#22e1ff'; g.shadowBlur = 12; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 5); g.lineTo(-8, 9); g.closePath(); g.fill(); g.restore();
}
