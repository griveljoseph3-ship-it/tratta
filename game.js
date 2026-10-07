const MOBILE = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
const LANES = [-6, -2, 2, 6];
const keys = new Set();
const touch = { gas: 0, brake: 0, left: 0, right: 0 };
let kind = "car";
let job = "express";
let running = false;
let paused = false;
let cash = Number(localStorage.getItem("tratta-cash") || 0);
let mods = JSON.parse(localStorage.getItem("tratta-mods") || "{}");
if (!mods.car) mods = { car: {}, bike: {} };

const MODS = [
  { id: "filter", name: "Filtro aria sportivo", desc: "Più aria, accelerazione migliore.", max: 1, cost: 40, accel: 1.08 },
  { id: "exhaust", name: "Scarico diretto", desc: "Meno contropressione.", max: 1, cost: 70, accel: 1.1, top: 1.04 },
  { id: "ecu", name: "Mappa centralina", desc: "Accensione e iniezione riviste.", max: 2, cost: 90, accel: 1.08, top: 1.06 },
  { id: "turbo", name: "Turbo", desc: "Tanta coppia, più fragile se sbatti.", max: 1, cost: 180, accel: 1.28, top: 1.08 },
  { id: "tires", name: "Gomme semislick", desc: "Più tenuta in slalom.", max: 2, cost: 60, grip: 1.12 },
  { id: "coils", name: "Assetto a ghiera", desc: "Risposta più secca in curva.", max: 1, cost: 110, steer: 1.18, grip: 1.06 },
  { id: "brakes", name: "Dischi forati", desc: "Frenata più corta.", max: 1, cost: 80, brake: 1.35 },
  { id: "weight", name: "Alleggerimento", desc: "Via sedili e isolante. Più veloce, più fragile.", max: 1, cost: 100, accel: 1.12, fragile: 1.3 }
];

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07101c);
scene.fog = new THREE.FogExp2(0x0c1830, 0.012);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 280);
scene.add(new THREE.HemisphereLight(0x6f8ec4, 0x1a120c, 0.55));
const sun = new THREE.DirectionalLight(0xffb36b, 1.6);
sun.position.set(-24, 18, -30);
scene.add(sun);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(180, 16, 12),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 top = vec3(0.03,0.06,0.14); vec3 hor = vec3(0.85,0.42,0.22); vec3 col = mix(hor, top, smoothstep(-0.05,0.45,h)); gl_FragColor = vec4(col,1.0); }"
  })
);
scene.add(sky);

function roadTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#1c2128";
  g.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 5000; i++) {
    const v = 20 + Math.random() * 30;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.25})`;
    g.fillRect(Math.random() * 512, Math.random() * 1024, 2, 2);
  }
  g.fillStyle = "#c9b48a";
  g.fillRect(18, 0, 10, 1024);
  g.fillRect(484, 0, 10, 1024);
  g.strokeStyle = "rgba(236,236,228,0.85)";
  g.setLineDash([46, 38]);
  g.lineWidth = 5;
  for (const x of [146, 256, 366]) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const roadMap = roadTexture();
const road = new THREE.Mesh(new THREE.PlaneGeometry(22, 260), new THREE.MeshStandardMaterial({ map: roadMap, roughness: 0.86, metalness: 0.04 }));
road.rotation.x = -Math.PI / 2;
scene.add(road);
const grassMap = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#1b3324"; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) { g.fillStyle = Math.random() > 0.5 ? "#244833" : "#163022"; g.fillRect(Math.random()*128, Math.random()*128, 3, 3); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(4, 10); tex.colorSpace = THREE.SRGBColorSpace; return tex;
})();
for (const side of [-1, 1]) {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(26, 260), new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1 }));
  s.rotation.x = -Math.PI / 2;
  s.position.x = side * 22;
  scene.add(s);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.45, 260), new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.7, roughness: 0.35 }));
  rail.position.set(side * 11.3, 0.4, 0);
  scene.add(rail);
}
const treeCount = 28;
const treeMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 7, 7), new THREE.MeshStandardMaterial({ color: 0x1d4630, roughness: 0.85 }), treeCount);
const treeDummy = new THREE.Object3D();
scene.add(treeMesh);
const marks = [];
const carGeo = new THREE.BoxGeometry(1.7, 0.7, 4.2);
const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 8);
const cars = [];
const police = [];
const coins = [];
let player = null;
let distance = 0;
let time = 0;
let passes = 0;
let hits = 0;
let heat = 0;
let storyStep = 0;
const stories = [
  "Il titolare ti lascia le chiavi: porta il pacco e non far salire il conto del carrozziere.",
  "Prima tratta. Tieni le corsie e non farti chiudere dal blocco.",
  "Il garage chiama: se porti i soldi, stasera montano il pezzo.",
  "La polizia ha visto la velocità. Il blocco è più avanti, non inchiodare in mezzo.",
  "Un'altra consegna e l'officina è tua per davvero."
];

function level(id) { return mods[kind][id] || 0; }
function stats() {
  let accel = kind === "bike" ? 16 : 11;
  let top = kind === "bike" ? 46 : 40;
  let grip = kind === "bike" ? 1.15 : 1;
  let brake = kind === "bike" ? 1.1 : 1;
  let steer = kind === "bike" ? 1.25 : 1;
  let fragile = kind === "bike" ? 1.4 : 1;
  for (const mod of MODS) {
    const lv = level(mod.id);
    if (!lv) continue;
    if (mod.accel) accel *= Math.pow(mod.accel, lv);
    if (mod.top) top *= Math.pow(mod.top, lv);
    if (mod.grip) grip *= Math.pow(mod.grip, lv);
    if (mod.brake) brake *= Math.pow(mod.brake, lv);
    if (mod.steer) steer *= Math.pow(mod.steer, lv);
    if (mod.fragile) fragile *= mod.fragile;
  }
  return { accel, top, grip, brake, steer, fragile };
}
function save() {
  localStorage.setItem("tratta-cash", String(cash));
  localStorage.setItem("tratta-mods", JSON.stringify(mods));
}
const bodyGeo = new THREE.BoxGeometry(1.78, 0.42, 4.15);
const hoodGeo = new THREE.BoxGeometry(1.7, 0.16, 1.4);
const cabGeo = new THREE.BoxGeometry(1.52, 0.42, 1.7);
const glassGeo = new THREE.BoxGeometry(1.4, 0.28, 1.45);
const lampGeo = new THREE.BoxGeometry(0.34, 0.1, 0.06);
const tailGeo = new THREE.BoxGeometry(0.32, 0.08, 0.05);
const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12);
wheelGeo.rotateZ(Math.PI / 2);
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd0ea, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.45 });
const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff4cc, emissive: 0xfff1c4, emissiveIntensity: 2 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 1.2 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.65 });
function makeCar(color, police) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.62, roughness: 0.28 });
  const body = new THREE.Mesh(bodyGeo, paint);
  body.position.y = 0.46;
  const hood = new THREE.Mesh(hoodGeo, paint);
  hood.position.set(0, 0.62, 1.15);
  const cab = new THREE.Mesh(cabGeo, paint);
  cab.position.set(0, 0.82, -0.25);
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(0, 0.86, -0.2);
  g.add(body, hood, cab, glass);
  for (const x of [-0.58, 0.58]) {
    const l = new THREE.Mesh(lampGeo, lampMat);
    l.position.set(x, 0.5, 2.08);
    const t = new THREE.Mesh(tailGeo, tailMat);
    t.position.set(x, 0.52, -2.08);
    g.add(l, t);
  }
  for (const p of [[-0.78, 0.33, 1.25], [0.78, 0.33, 1.25], [-0.78, 0.33, -1.25], [0.78, 0.33, -1.25]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(p[0], p[1], p[2]);
    g.add(w);
  }
  if (police) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.28), new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0xff2244, emissiveIntensity: 2 }));
    bar.position.set(0, 1.12, -0.1);
    g.add(bar);
  }
  scene.add(g);
  return g;
}
function spawnTraffic(z) {
  const mesh = makeCar(new THREE.Color().setHSL(Math.random(), 0.4, 0.45));
  const lane = (Math.random() * 4) | 0;
  cars.push({ mesh, lane, z, speed: 12 + Math.random() * 14, passed: false, sway: Math.random() * 6 });
}
function spawnCoin(z) {
  const mesh = new THREE.Mesh(coinGeo, new THREE.MeshBasicMaterial({ color: 0xffd15a }));
  mesh.position.y = 0.8;
  scene.add(mesh);
  coins.push({ mesh, lane: (Math.random() * 4) | 0, z });
}
function spawnPolice(z) {
  const mesh = makeCar(0x163e86, true);
  police.push({ mesh, lane: (Math.random() * 4) | 0, z, speed: 14 });
}
function resetWorld() {
  for (const c of cars) scene.remove(c.mesh);
  for (const c of coins) scene.remove(c.mesh);
  for (const c of police) scene.remove(c.mesh);
  cars.length = 0;
  coins.length = 0;
  police.length = 0;
  if (player) scene.remove(player.mesh);
  player = { mesh: makeCar(kind === "bike" ? 0xc4492a : 0xd7dde6, false), x: 0, z: 0, speed: 0, vx: 0 };
  if (kind === "bike") player.mesh.scale.set(0.45, 0.8, 0.55);
  distance = 0; time = 0; passes = 0; hits = 0; heat = 0; storyStep = 0;
  for (let i = 0; i < 26; i++) spawnTraffic(22 + i * 12);
  for (let i = 0; i < 6; i++) spawnCoin(40 + i * 46);
}
function say(text) { document.getElementById("story").textContent = text; }
function end(title, text) {
  running = false;
  document.getElementById("overTitle").textContent = title;
  document.getElementById("overText").textContent = text;
  document.getElementById("overlay").style.display = "flex";
}
function input() {
  return {
    throttle: keys.has("KeyW") || keys.has("ArrowUp") || touch.gas ? 1 : 0,
    brake: keys.has("KeyS") || keys.has("ArrowDown") || touch.brake ? 1 : 0,
    steer: (keys.has("KeyA") || keys.has("ArrowLeft") || touch.left ? 1 : 0) - (keys.has("KeyD") || keys.has("ArrowRight") || touch.right ? 1 : 0)
  };
}
function update(dt) {
  const s = stats();
  const inp = input();
  if (inp.throttle) player.speed += s.accel * dt;
  if (inp.brake) player.speed -= 18 * s.brake * dt;
  else player.speed -= player.speed * 0.15 * dt;
  player.speed = Math.max(-4, Math.min(s.top, player.speed));
  player.vx += inp.steer * 18 * s.steer * dt;
  player.vx *= Math.pow(0.04, dt * s.grip);
  player.x += player.vx * dt * 3.2;
  player.x = Math.max(-10, Math.min(10, player.x));
  distance += Math.max(0, player.speed) * dt;
  time += dt;
  heat = Math.max(0, heat - dt * 0.2);
  if (player.speed > 28) heat += dt * 1.6;
  player.mesh.position.set(player.x, 0.55, 8);
  player.mesh.rotation.y = -player.vx * 0.04;
  player.mesh.rotation.z = kind === "bike" ? -player.vx * 0.08 : 0;

  for (const c of cars) {
    c.z -= (player.speed - c.speed) * dt;
    if (c.z < -20) {
      c.z = 90 + Math.random() * 80;
      c.lane = (Math.random() * 4) | 0;
      c.speed = 14 + Math.random() * 14;
      if (Math.random() < 0.25) c.lane = (c.lane + 1) % 4;
      c.passed = false;
    }
    c.mesh.position.set(LANES[c.lane], 0.55, c.z + 8);
    if (!c.passed && c.z < 0) { c.passed = true; passes++; cash += 1; }
    const dx = player.x - LANES[c.lane];
    if (Math.abs(c.z) < 2.8 && Math.abs(dx) < (kind === "bike" ? 0.9 : 1.5)) {
      player.speed *= 0.55;
      hits++;
      cash = Math.max(0, cash - 2);
      c.z = 100;
      if (hits > 3) end("Carrozzeria finita", "Tre urti e la tratta è chiusa. Il garage non paga lo sfascio.");
    }
  }
  for (const c of coins) {
    c.z -= player.speed * dt;
    if (c.z < -16) c.z = 80 + Math.random() * 60;
    c.mesh.position.set(LANES[c.lane], 0.8, c.z + 8);
    c.mesh.rotation.y += dt * 2;
    if (Math.abs(c.z) < 1.6 && Math.abs(player.x - LANES[c.lane]) < 1.4) {
      cash += 8;
      c.z = 90;
    }
  }
  if (heat > 4 && police.length < 2) {
    say("Volante in arrivo. Non la prendi: ti stringe la corsia e non sbatti.");
    spawnPolice(70);
    heat = 2;
  }
  for (const p of police) {
    const target = Math.round((player.x + 6) / 4);
    const want = Math.max(0, Math.min(3, target));
    const blocked = cars.some(c => c.lane === want && Math.abs(c.z - p.z) < 8);
    if (!blocked && p.lane !== want) p.lane = want;
    p.speed = 12 + Math.min(10, player.speed * 0.4);
    p.z -= (player.speed - p.speed) * dt;
    if (p.z < -30) p.z = 80;
    if (p.z > 120) p.z = 90;
    p.mesh.position.set(LANES[p.lane], 0.55, p.z + 8);
    const dx = player.x - LANES[p.lane];
    if (Math.abs(p.z) < 3.4 && Math.abs(dx) < 1.8) player.x += dx >= 0 ? 0.55 : -0.55;
  }
  if (job === "express" && distance > 4000) {
    if (time <= 80) { cash += 120; say("Pacco consegnato. Il titolare segna il debito."); end("Consegna fatta", "120 € in cassa. Puoi montare un pezzo vero."); }
    else end("In ritardo", "Quattro chilometri in più di 80 secondi. Il cliente non paga.");
  }
  if (job === "clean" && passes >= 28) {
    if (hits === 0) { cash += 70; end("Slalom pulito", "Nessun contatto. 70 € e un caffè in officina."); }
    else end("Hai toccato", "Il lavoro pulito è saltato. Riprova con meno fretta.");
  }
  if (distance > storyStep * 800) {
    storyStep++;
    say(stories[Math.min(storyStep, stories.length - 1)]);
  }
  save();
  document.getElementById("speed").innerHTML = `${Math.round(Math.max(0, player.speed) * 3.6)}<span>km/h</span>`;
  document.getElementById("meta").textContent = `tratta ${(distance / 1000).toFixed(1)} km · urti ${hits} · ${Math.ceil(time)}s`;
  document.getElementById("cash").textContent = `${cash} €`;
  document.getElementById("job").textContent = job === "express" ? `Consegna: ${(distance / 1000).toFixed(1)} / 4.0 km` : `Slalom: ${passes} / 28`;
  roadMap.offset.y = distance * 0.01;
  grassMap.offset.y = distance * 0.008;
  for (let i = 0; i < treeCount; i++) {
    const side = i % 2 ? -1 : 1;
    const z = ((i * 18 - distance) % 220) - 40;
    treeDummy.position.set(side * 16.5, 3.2, z);
    treeDummy.scale.set(0.8 + (i % 3) * 0.15, 0.9 + (i % 4) * 0.1, 0.8);
    treeDummy.updateMatrix();
    treeMesh.setMatrixAt(i, treeDummy.matrix);
  }
  treeMesh.instanceMatrix.needsUpdate = true;
  camera.position.set(player.x * 0.35, 4.4, -7.2);
  camera.lookAt(player.x, 0.8, 14);
}
function shop() {
  document.getElementById("shopCash").textContent = `Soldi: ${cash} €`;
  const list = document.getElementById("upList");
  list.innerHTML = "";
  for (const mod of MODS) {
    const lv = level(mod.id);
    const row = document.createElement("div");
    row.className = "up";
    row.innerHTML = `<div><strong>${mod.name}</strong><br><span style="color:#9aabbf">${mod.desc} · ${lv}/${mod.max}</span></div>`;
    const b = document.createElement("button");
    b.className = "buy";
    b.textContent = lv >= mod.max ? "Montato" : `${mod.cost} €`;
    b.onclick = () => {
      if (lv >= mod.max || cash < mod.cost) return;
      cash -= mod.cost;
      mods[kind][mod.id] = lv + 1;
      save();
      shop();
    };
    row.appendChild(b);
    list.appendChild(row);
  }
}
function begin() {
  document.getElementById("menu").style.display = "none";
  document.getElementById("overlay").style.display = "none";
  document.getElementById("shop").style.display = "none";
  resetWorld();
  say(stories[0]);
  running = true;
  paused = false;
}
document.getElementById("pickCar").onclick = () => { kind = "car"; document.getElementById("pickCar").classList.add("active"); document.getElementById("pickBike").classList.remove("active"); };
document.getElementById("pickBike").onclick = () => { kind = "bike"; document.getElementById("pickBike").classList.add("active"); document.getElementById("pickCar").classList.remove("active"); };
document.getElementById("jobExpress").onclick = () => { job = "express"; document.getElementById("jobExpress").classList.add("active"); document.getElementById("jobClean").classList.remove("active"); };
document.getElementById("jobClean").onclick = () => { job = "clean"; document.getElementById("jobClean").classList.add("active"); document.getElementById("jobExpress").classList.remove("active"); };
document.getElementById("startBtn").onclick = begin;
document.getElementById("retryBtn").onclick = begin;
document.getElementById("shopBtn").onclick = () => { paused = true; shop(); document.getElementById("shop").style.display = "flex"; };
document.getElementById("shopClose").onclick = () => { document.getElementById("shop").style.display = "none"; paused = false; };
function bind(id, key) {
  const el = document.getElementById(id);
  const on = e => { e.preventDefault(); touch[key] = 1; };
  const off = e => { touch[key] = 0; };
  el.addEventListener("pointerdown", on);
  el.addEventListener("pointerup", off);
  el.addEventListener("pointerleave", off);
}
bind("tGas", "gas"); bind("tBrake", "brake"); bind("tLeft", "left"); bind("tRight", "right");
addEventListener("keydown", e => keys.add(e.code));
addEventListener("keyup", e => keys.delete(e.code));
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (running && player && !paused) update(dt);
  renderer.render(scene, camera);
}
document.getElementById("cash").textContent = `${cash} €`;
camera.position.set(0, 8, -10);
requestAnimationFrame(frame);
