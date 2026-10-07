// Tratta — core grafico + integrazione moduli.
// Convenzioni: avanti = -Z, metri, m/s. ctx condiviso con story/police/difficulty.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = id => document.getElementById(id);
const LANES = 4, LW = 3.6, ROAD_W = LANES * LW;
const road = { lanes: LANES, laneWidth: LW, width: ROAD_W, laneX: i => (i - (LANES - 1) / 2) * LW, halfWidth: ROAD_W / 2 };

let quality = +(localStorage.getItem('tratta-q') ?? 2);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc9926e, 0.0019);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);

// Cielo al tramonto (Sky shader) + sole
const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
const su = sky.material.uniforms;
su.turbidity.value = 8; su.rayleigh.value = 2.2; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.86;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(82), THREE.MathUtils.degToRad(115));
su.sunPosition.value.copy(sunDir);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(sky, 0.04).texture; sky.visible = true;

const hemi = new THREE.HemisphereLight(0xffd9b0, 0x3a3020, 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc48a, 3.2); sun.castShadow = true;
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40; sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 300; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// Texture procedurali
function canvasTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(...rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const asphalt = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#3b3d42'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) { const v = 40 + Math.random() * 50 | 0; g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
  g.fillStyle = '#eee'; g.fillRect(6, 0, 7, h); g.fillRect(w - 13, 0, 7, h);
  g.fillStyle = '#f2f2f2'; for (let l = 1; l < LANES; l++) { const x = l * w / LANES - 3; for (let y = 0; y < h; y += 128) g.fillRect(x, y, 6, 64); }
  g.fillStyle = 'rgba(20,20,20,.25)'; for (let l = 0; l < LANES; l++) g.fillRect((l + .5) * w / LANES - 30, 0, 60, h);
}, [1, 12]);
const grassTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#5d6b2e'; g.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { g.fillStyle = `hsl(${60 + Math.random() * 30},${35 + Math.random() * 20}%,${18 + Math.random() * 20}%)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 3); } }, [30, 300]);

const SEG = 400;
const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.82, metalness: 0.05 });
const roadMeshes = [];
for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W + 1.2, SEG), roadMat); m.rotation.x = -Math.PI / 2; m.receiveShadow = true; m.position.z = -i * SEG; scene.add(m); roadMeshes.push(m); }
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 3000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);

// Colline lontane
const hillMat = new THREE.MeshStandardMaterial({ color: 0x6d7a45, roughness: 1, flatShading: true });
const hills = [];
for (let i = 0; i < 26; i++) { const g = new THREE.ConeGeometry(60 + Math.random() * 90, 30 + Math.random() * 70, 7); const m = new THREE.Mesh(g, hillMat); const s = i % 2 ? 1 : -1; m.position.set(s * (180 + Math.random() * 260), 10, -Math.random() * 2400); scene.add(m); hills.push(m); }

// Scenografia istanziata (alberi, lampioni, guardrail, edifici) riciclata a blocchi
const scenery = []; const SC_SPAN = 1600;
function addInst(geo, mat, n, place, shadow = true) {
  const im = new THREE.InstancedMesh(geo, mat, n); im.castShadow = shadow; im.receiveShadow = true; scene.add(im);
  const items = []; for (let i = 0; i < n; i++) items.push(place(i)); scenery.push({ im, items }); return im;
}
const dummy = new THREE.Object3D();
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: .9 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f5a22, roughness: .8, flatShading: true });
const cypress = () => ({ x: (Math.random() < .5 ? -1 : 1) * (ROAD_W / 2 + 8 + Math.random() * 60), z: -Math.random() * SC_SPAN, s: .7 + Math.random() * .8, r: Math.random() * 6 });
const treePos = []; for (let i = 0; i < 260; i++) treePos.push(cypress());
addInst(new THREE.CylinderGeometry(.25, .35, 3, 6).translate(0, 1.5, 0), trunkMat, 260, i => treePos[i]);
addInst(new THREE.ConeGeometry(1.6, 9, 8).translate(0, 7, 0), leafMat, 260, i => treePos[i]);
const lampPos = []; for (let i = 0; i < 64; i++) lampPos.push({ x: (i % 2 ? 1 : -1) * (ROAD_W / 2 + 1.6), z: -(i >> 1) * 50, s: 1, r: i % 2 ? Math.PI : 0 });
const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: .9, roughness: .35 });
const lampG = new THREE.CylinderGeometry(.09, .12, 8, 8).translate(0, 4, 0).toNonIndexed();
addInst(lampG, metal, 64, i => lampPos[i]);
addInst(new THREE.BoxGeometry(1.6, .12, .3).translate(.8, 8, 0), metal, 64, i => lampPos[i]);
const lampGlow = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd28a, emissiveIntensity: 3 });
addInst(new THREE.BoxGeometry(.6, .08, .25).translate(1.3, 7.92, 0), lampGlow, 64, i => lampPos[i], false);
const railPos = []; for (let i = 0; i < 160; i++) railPos.push({ x: (i % 2 ? 1 : -1) * (ROAD_W / 2 + .9), z: -(i >> 1) * 20, s: 1, r: 0 });
addInst(new THREE.BoxGeometry(.12, .35, 20).translate(0, .75, 0), metal, 160, i => railPos[i]);
addInst(new THREE.BoxGeometry(.12, .8, .12).translate(0, .4, 0), metal, 160, i => railPos[i]);
const bPos = []; for (let i = 0; i < 40; i++) bPos.push({ x: (i % 2 ? 1 : -1) * (75 + Math.random() * 120), z: -Math.random() * SC_SPAN, s: 1 + Math.random() * 1.5, r: Math.random() * 3 });
const houseMat = new THREE.MeshStandardMaterial({ color: 0xe6c9a0, roughness: .85 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0xa04a2a, roughness: .7, flatShading: true });
addInst(new THREE.BoxGeometry(10, 7, 9).translate(0, 3.5, 0), houseMat, 40, i => bPos[i]);
addInst(new THREE.ConeGeometry(8, 3.5, 4).rotateY(Math.PI / 4).translate(0, 8.7, 0), roofMat, 40, i => bPos[i]);
function updateScenery(pz) {
  for (const s of scenery) { s.items.forEach((it, i) => {
    while (it.z > pz + 40) it.z -= SC_SPAN; while (it.z < pz - SC_SPAN + 40) it.z += SC_SPAN;
    dummy.position.set(it.x, 0, it.z); dummy.rotation.set(0, it.r, 0); dummy.scale.setScalar(it.s); dummy.updateMatrix(); s.im.setMatrixAt(i, dummy.matrix);
  }); s.im.instanceMatrix.needsUpdate = true; }
  for (const m of roadMeshes) { while (m.position.z > pz + SEG) m.position.z -= SEG * roadMeshes.length; }
  ground.position.z = pz - 1000; asphalt.offset.y = 0;
  for (const h of hills) if (h.position.z > pz + 300) h.position.z -= 2400;
}

// Auto costruite da geometria, PBR + luci emissive
const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1018, metalness: .2, roughness: .05, clearcoat: 1, transparent: true, opacity: .85 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .9 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: .25 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 4 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a10, emissiveIntensity: 3 });
const wheelG = new THREE.CylinderGeometry(.36, .36, .28, 18).rotateZ(Math.PI / 2);
const rimG = new THREE.CylinderGeometry(.24, .24, .3, 10).rotateZ(Math.PI / 2);
function makeCar(color = 0xc81e1e, opts = {}) {
  const L = opts.length || 4.4, W = opts.width || 1.85, H = opts.height || 1.3;
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: .6, roughness: .3, clearcoat: 1, clearcoatRoughness: .08 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H * .42, L), paint); body.position.y = .55; g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(W * .98, H * .18, L * .3), paint); nose.position.set(0, .82, -L * .33); nose.rotation.x = .08; g.add(nose);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W * .8, H * .36, L * .48), glass); cab.position.set(0, .98, L * .04); g.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W * .78, .06, L * .38), paint); roof.position.set(0, 1.2, L * .06); g.add(roof);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const w = new THREE.Mesh(wheelG, tireMat); w.position.set(x * W * .47, .36, z * L * .32); const r = new THREE.Mesh(rimG, rimMat); w.add(r); g.add(w); }
  for (const x of [-1, 1]) { const h = new THREE.Mesh(new THREE.BoxGeometry(.42, .14, .05), headMat); h.position.set(x * W * .33, .68, -L / 2 - .01); g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(.5, .12, .05), tailMat); t.position.set(x * W * .33, .72, L / 2 + .01); g.add(t); }
  if (opts.police) { const bar = new THREE.Group(); const red = new THREE.MeshStandardMaterial({ color: 0x300, emissive: 0xff0000, emissiveIntensity: 5 }); const blue = new THREE.MeshStandardMaterial({ color: 0x003, emissive: 0x2050ff, emissiveIntensity: 5 });
    const a = new THREE.Mesh(new THREE.BoxGeometry(.5, .12, .25), red), b = new THREE.Mesh(new THREE.BoxGeometry(.5, .12, .25), blue); a.position.x = -.3; b.position.x = .3; bar.add(a, b); bar.position.y = 1.3; g.add(bar); g.userData.siren = [red, blue]; }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.size = { L, W }; return g;
}

// Giocatore
const CARS = [{ name: 'Berlina GT', color: 0x1d4fa8, max: 72, acc: 13, steer: 11, hp: 120 }, { name: 'Coupé R', color: 0xd01818, max: 82, acc: 16, steer: 13, hp: 85 }];
let carIdx = 0;
const player = { mesh: null, speed: 0, lane: 1, x: road.laneX(1), z: 0, health: 100, maxHealth: 100, vx: 0, nitro: 1, stats: CARS[0], distance: 0 };
const headL = new THREE.SpotLight(0xfff2d8, 40, 80, .5, .5, 1.5);
function buildPlayer() { if (player.mesh) scene.remove(player.mesh); const c = CARS[carIdx]; player.stats = c; player.mesh = makeCar(c.color, { length: 4.5 }); scene.add(player.mesh); player.mesh.add(headL, headL.target); headL.position.set(0, .8, -2); headL.target.position.set(0, 0, -30); }

// Postprocessing
let composer, bloom, smaa;
function setupPost() {
  const pr = [1, 1.25, Math.min(devicePixelRatio, 2)][quality];
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = quality > 0; sun.castShadow = quality > 0;
  sun.shadow.mapSize.set(quality === 2 ? 2048 : 1024, quality === 2 ? 2048 : 1024); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  scenery.forEach((s, i) => s.im.visible = quality > 0 || i < 2 || i > 5);
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  if (quality > 0) { bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), quality === 2 ? .55 : .4, .6, .9); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  if (quality === 2) { smaa = new SMAAPass(innerWidth * pr, innerHeight * pr); composer.addPass(smaa); }
  composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// Input
const keys = {};
addEventListener('keydown', e => keys[e.code] = true); addEventListener('keyup', e => keys[e.code] = false);
for (const [id, k] of [['tL', 'ArrowLeft'], ['tR', 'ArrowRight'], ['tB', 'ArrowDown'], ['tG', 'ArrowUp']]) { const b = $(id); b.onpointerdown = () => keys[k] = true; b.onpointerup = b.onpointerleave = () => keys[k] = false; }

// UI + eventi
let msgT;
const ui = {
  setObjective: t => $('obj').innerHTML = t,
  setHeat: n => $('heat').textContent = n > 0 ? '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n)) : '',
  flash: (t, ms = 1800) => { const m = $('msg'); m.textContent = t; m.style.opacity = 1; clearTimeout(msgT); msgT = setTimeout(() => m.style.opacity = 0, ms); },
  show: id => $(id).classList.remove('hidden'), hide: id => $(id).classList.add('hidden'), el: $,
};
const listeners = {};
function on(n, f) { (listeners[n] ||= []).push(f); }
function emit(n, d) { (listeners[n] || []).forEach(f => { try { f(d, ctx); } catch (e) { console.error(e); } }); }

const ctx = { THREE, scene, camera, renderer, player, road: Object.assign(road, { lanes: [0,1,2,3].map(road.laneX), forward: -1, zOffset: 0 }), ui: $('ui'), hud: ui, makeCar, keys, state: { running: false, paused: false, time: 0 }, onEvent: emit, on, emit };
window.tratta = ctx;
let Story, Police, Diff;

on('damage', d => { const a = typeof d === 'number' ? d : d?.amount || 0; player.health = Math.max(0, player.health - a); shake = Math.min(1, shake + a / 25); });
on('collision', d => { shake = Math.min(1, shake + (d?.damage || 5) / 25); Story?.notify('crash', d); });
on('playerDestroyed', () => Story?.notify('playerDead'));
on('heatChange', d => { ui.setHeat(d.to); Story?.notify('policeHeat', { heat: d.to / 5 }); });
on('busted', () => { Story?.notify('busted'); });
on('escaped', () => { ui.flash('Seminati!'); Story?.notify('policeHeat', { heat: 0 }); });
on('pause', d => ctx.state.paused = !!d.paused);
on('missionStart', d => {
  if (!ctx.state.running) resetRun();
  Diff?.setDifficulty(d.difficulty >= 8 ? 3 : d.difficulty >= 5 ? 2 : 1);
  Diff?.setMissionLevel(1 + (d.difficulty - 1) * .15);
  ctx.state.speedScale = 1 + d.difficulty * .02;
  if (d.policeLevel > 0) Police?.setHeat(Math.max(d.policeLevel, Math.round((d.heat || 0) * 5)));
  else Police?.setHeat(0);
  ui.hide('menu');
});
on('missionFailed', () => { ctx.state.running = false; });
on('storyComplete', () => { ctx.state.running = false; });

let shake = 0;
function resetRun() {
  buildPlayer(); Object.assign(player, { speed: 18, x: road.laneX(1), z: 0, vx: 0, lane: 1, nitro: 1, distance: 0, maxHealth: 100, health: 100 });
  ctx.state.time = 0; ctx.state.running = true; shake = 0;
  Diff?.reset(ctx); Police?.reset(); ui.setHeat(0);
}

function updatePlayer(dt) {
  const s = player.stats, k = keys;
  const gas = k.ArrowUp || k.KeyW, brake = k.ArrowDown || k.KeyS, nitro = k.Space && player.nitro > 0;
  const max = s.max * (ctx.state.speedScale || 1) * (nitro ? 1.18 : 1);
  if (gas) player.speed += s.acc * (nitro ? 1.6 : 1) * dt; else player.speed -= 3 * dt;
  if (brake) player.speed -= 30 * dt;
  player.speed = THREE.MathUtils.clamp(player.speed, 0, max);
  player.nitro = THREE.MathUtils.clamp(player.nitro + (nitro ? -.35 : .05) * dt, 0, 1);
  const st = (k.ArrowLeft || k.KeyA ? -1 : 0) + (k.ArrowRight || k.KeyD ? 1 : 0);
  const grip = s.steer * (0.55 + 0.45 * Math.min(1, player.speed / 30));
  player.vx += (st * grip - player.vx) * Math.min(1, dt * 6);
  player.x += player.vx * dt;
  const lim = road.halfWidth - 1;
  if (Math.abs(player.x) > lim) { player.x = Math.sign(player.x) * lim; if (Math.abs(player.vx) > 3) (player.health = Math.max(0, player.health - 2 * (CARS[carIdx].hp < 100 ? 1.4 : 1))); player.vx *= -.3; player.speed *= .97; }
  player.z -= player.speed * dt; player.distance += player.speed * dt;
  player.lane = Math.round(player.x / LW + (LANES - 1) / 2);
  const m = player.mesh; m.position.set(player.x, 0, player.z); m.rotation.y = -player.vx * .02; m.rotation.z = player.vx * .006;
  m.children.forEach(c => { if (c.geometry === wheelG) c.rotation.x -= player.speed * dt / .36; });
}

function updateCamera(dt) {
  const sp = player.speed; const nit = keys.Space && player.nitro > 0;
  camera.fov += ((62 + sp * .28 + (nit ? 8 : 0)) - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
  const tgt = new THREE.Vector3(player.x * .85, 2.6 + sp * .004, player.z + 7.2 - sp * .02);
  camera.position.lerp(tgt, Math.min(1, dt * 8));
  if (shake > 0) { camera.position.x += (Math.random() - .5) * shake * .6; camera.position.y += (Math.random() - .5) * shake * .4; shake = Math.max(0, shake - dt * 2); }
  if (sp > 50) camera.position.y += (Math.random() - .5) * (sp - 50) * .0015;
  camera.lookAt(player.x, 1.1, player.z - 12);
  sun.position.set(player.x + sunDir.x * 120, sunDir.y * 120 + 20, player.z + sunDir.z * 120); sun.target.position.set(player.x, 0, player.z - 15);
}

function updateHUD() {
  $('speed').firstChild.nodeValue = Math.round(player.speed * 3.6);
  $('meta').textContent = `${(player.distance / 1000).toFixed(2)} km · nitro ${Math.round(player.nitro * 100)}%`;
  const h = player.health / player.maxHealth; $('hp').style.width = h * 100 + '%'; $('hp').style.background = h > .5 ? '#4cd964' : h > .25 ? '#ffcc00' : '#ff3b30';
}

// Fallback minimale se i moduli non ci sono
let clock = new THREE.Clock(), fpsAcc = 0, fpsN = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  try { Story?.update(dt, ctx); } catch (e) { console.error(e); }
  if (ctx.state.running && !ctx.state.paused) {
    ctx.state.time += dt; updatePlayer(dt);
    if (!ctx.state.paused) {
      for (const m of [Diff, Police]) { try { m?.update(dt, ctx); } catch (e) { console.error(e); } }
      const pr = scene.getObjectByName('police'); if (pr) pr.position.z = player.z;
    }
    updateHUD();
  } else if (player.mesh) { player.z -= 8 * dt; player.mesh.position.z = player.z; }
  if (player.mesh) { updateCamera(dt); updateScenery(player.z); }
  ctx.state.flash = (ctx.state.flash || 0) + dt;
  scene.traverse(o => { if (o.userData.siren) { const on = Math.sin(ctx.state.flash * 18) > 0; o.userData.siren[0].emissiveIntensity = on ? 6 : .2; o.userData.siren[1].emissiveIntensity = on ? .2 : 6; } });
  composer.render(dt);
  fpsAcc += dt; fpsN++; if (fpsAcc > 3) { const fps = fpsN / fpsAcc; ctx.state.fps = fps; fpsAcc = fpsN = 0; }
}

// Menu
document.querySelectorAll('[data-car]').forEach(b => b.onclick = () => { carIdx = +b.dataset.car; document.querySelectorAll('[data-car]').forEach(x => x.classList.toggle('active', x === b)); buildPlayer(); });
function markQ() { document.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('active', +x.dataset.q === quality)); }
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { quality = +b.dataset.q; localStorage.setItem('tratta-q', quality); markQ(); setupPost(); });
async function loadModules() {
  const imp = async n => { try { return await import(`./${n}.js`); } catch (e) { console.error('modulo', n, e); } };
  Diff = await imp('difficulty'); Police = await imp('police'); Story = await imp('story');
  Diff?.init(ctx); Police?.init(ctx); Story?.init(ctx);
}
const gear = document.createElement('button'); gear.textContent = '⚙'; gear.title = 'Auto e grafica';
gear.style.cssText = 'position:fixed;right:14px;bottom:90px;z-index:50;width:44px;height:44px;border-radius:50%;border:1px solid #fff3;background:#0009;color:#fff;font-size:20px;pointer-events:auto';
gear.onclick = () => $('menu').classList.toggle('hidden'); document.body.appendChild(gear);
$('menuClose').onclick = () => ui.hide('menu');

markQ(); setupPost(); buildPlayer(); player.speed = 8;
await loadModules();
loop();
