import { chromium, devices } from 'playwright-core';
const URL = process.argv[2] || 'http://localhost:8765/';
const R = []; const ok = (name, pass, info='') => { R.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS' : 'FAIL'), name, info); };
const errors = [];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
async function page(opts = { viewport: { width: 960, height: 540 } }) {
  const c = await b.newContext(opts); const p = await c.newPage();
  p.on('console', m => { if (m.type() === 'error' || (m.type()==='warning' && !/GPU stall|ReadPixels|swiftshader|WebGL/i.test(m.text()))) errors.push(m.type()+': '+m.text().slice(0,200)); });
  p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('requestfailed', r => errors.push('reqfail: ' + r.url()));
  p.on('dialog', d => d.accept());
  await p.addInitScript(() => localStorage.setItem('tratta-q', '0'));
  await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.tratta?.debug?.Story, null, { timeout: 30000 });
  await p.evaluate(() => { window.__ev = []; for (const n of ['missionStart','missionComplete','missionFailed','chapterComplete','storyComplete','freeRoamStart','busted','playerDestroyed','pause']) tratta.on(n, d => __ev.push({ n, d: { chapter: d?.chapter, mission: d?.mission, type: d?.type, target: d?.target, reason: d?.reason } })); });
  return p;
}
const sim = (p, sec) => p.evaluate(s => new Promise(r => { tratta.debug.substeps = 20; tratta.debug.autopilot = window.__ap !== false; if (window.__god !== false) tratta.debug.god = true; const t0 = tratta.state.time; const iv = setInterval(() => { if (tratta.state.time - t0 >= s || !tratta.state.running) { clearInterval(iv); tratta.debug.substeps = 1; r(); } }, 50); setTimeout(() => { clearInterval(iv); tratta.debug.substeps = 1; r(); }, 60000); }), sec);
const advanceOverlays = p => p.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter(b => b.offsetParent && !/^[◀▶]$|FRENO|GAS|NITRO|⚙|Indietro|Azzera|Garage|🔒|Menu/.test(b.textContent.trim())); const g = bs.find(b => /Guida|Continua|Prossimo|Avanti|Parti|Riprova|Titoli/.test(b.textContent)); (g || null)?.click(); return g?.textContent; });
const nanCheck = p => p.evaluate(() => { let bad = 0; tratta.scene.traverse(o => { const q = o.position; if (!isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z)) bad++; }); const pl = tratta.player; return bad + (isFinite(pl.x + pl.z + pl.speed + pl.health) ? 0 : 100); });
const ev = p => p.evaluate(() => __ev.splice(0));

let p = await page();
// 1 menu
const menuBtns = await p.$$eval('button', bs => bs.filter(b => b.offsetParent).map(b => b.textContent.trim()));
ok('Menu principale carica', menuBtns.some(t => /Storia/.test(t)) && menuBtns.some(t => /Guida libera/.test(t)), menuBtns.join('|').slice(0, 120));
await p.screenshot({ path: '/workspace/qa-menu.png' });
// 2 capitoli: tutte le missioni
const chN = await p.evaluate(() => tratta.debug.Story.CHAPTERS.length);
for (let i = 0; i < chN; i++) {
  await p.evaluate(i => tratta.debug.Story.startChapter(i), i); await p.waitForTimeout(200);
  const ms = await p.evaluate(i => tratta.debug.Story.CHAPTERS[i].missions, i);
  for (let m = 0; m < ms.length; m++) {
    for (let k = 0; k < 20 && !(await p.evaluate(m => { const s = tratta.debug.Story.getState(); return tratta.state.running && !tratta.state.paused && s.active && s.mission === m; }, m)); k++) { await advanceOverlays(p); await p.waitForTimeout(250); }
    const M = ms[m]; await p.evaluate(t => tratta.debug.noPolice = t !== 'escape', M.type);
    await p.evaluate(() => { tratta.player.health = 100; tratta.keys.ArrowUp = true; });
    if (M.target) await p.evaluate(t => tratta.debug.ff(t + 300), M.target);
    if (M.type === 'escape') await p.evaluate(() => { tratta.debug.Police.setHeat(0); tratta.debug.Story.notify('policeHeat', { heat: 0 }); });
    let done = false;
    for (let k = 0; k < 12 && !done; k++) {
      await p.evaluate(() => { tratta.player.health = 100; if (tratta.debug.Story.getState().mission >= 0 && tratta.debug.Story.getState().active) { const M = tratta.debug.Story.CHAPTERS[tratta.debug.Story.getState().chapter].missions[tratta.debug.Story.getState().mission]; if (M.type === 'escape') { tratta.debug.Police.setHeat(0); tratta.debug.Story.notify('policeHeat', { heat: 0 }); } } });
      await sim(p, M.type === 'survive' ? 12 : 4);
      const e = await p.evaluate(() => __ev.map(x => x.n)); done = e.includes('missionComplete') || e.includes('missionFailed');
    }
    const e = await ev(p); const comp = e.find(x => x.n === 'missionComplete'), fail = e.find(x => x.n === 'missionFailed');
    ok(`Cap ${i + 1} missione ${m + 1} (${M.type})`, comp && !fail, fail ? 'fallita: ' + fail.d.reason : comp ? '' : 'nessun esito');
    ok(`Cap ${i + 1} m${m + 1} niente NaN`, (await nanCheck(p)) === 0);
    await p.waitForTimeout(200);
  }
  await p.waitForFunction(() => __ev.some(x => x.n === 'chapterComplete') || tratta.debug.Story.getState().save.unlocked > 0 && false, null, { timeout: 5000 }).catch(() => {});
  const cc = (await ev(p)).some(x => x.n === 'chapterComplete'); ok(`Cap ${i + 1} completato e salvato`, cc);
}
const save = await p.evaluate(() => JSON.parse(localStorage.getItem('tratta_story_v2') || '{}'));
ok('Salvataggio localStorage dopo storia', save.unlocked >= chN, JSON.stringify(save).slice(0, 150));
await p.evaluate(() => { window.__god = false; tratta.debug.noPolice = false; });
// 3 fallimento + retry istantaneo (consegna a tempo senza avanzare)
await p.evaluate(() => { tratta.debug.Story.startChapter(0); }); await p.waitForTimeout(200);
for (let k = 0; k < 6 && !(await p.evaluate(() => tratta.state.running && !tratta.state.paused)); k++) { await advanceOverlays(p); await p.waitForTimeout(250); }
await ev(p);
await p.evaluate(() => tratta.emit('damage', { amount: 999 })); await sim(p, 1);
let e1 = await p.evaluate(() => __ev.map(x => x.n)); ok('Auto distrutta -> missione fallita', e1.includes('missionFailed'), e1.join(','));
await p.waitForTimeout(2500); await sim(p, .5);
let e2 = await ev(p); ok('Retry istantaneo dopo fallimento', e2.filter(x => x.n === 'missionStart').length >= 1 && await p.evaluate(() => tratta.state.running), e2.map(x => x.n).join(','));
ok('Salute ripristinata al retry', await p.evaluate(() => tratta.player.health) === 100);
await p.evaluate(() => tratta.debug.Story.notify('busted')); await sim(p, .5);
let e3 = await ev(p); ok('Arresto (busted) -> fallita', e3.some(x => x.n === 'missionFailed'), e3.map(x => x.n).join(','));
await p.waitForTimeout(2500);
await p.evaluate(() => window.__god = true);
// 4 polizia heat 1-5
await p.evaluate(() => tratta.debug.Story.startFreeRoam('berlina', 'city')); await p.waitForTimeout(300);
for (let h = 1; h <= 5; h++) {
  await p.evaluate(h => { tratta.player.health = 100; tratta.debug.Police.setHeat(h); }, h); await sim(p, 4);
  const st = await p.evaluate(() => tratta.debug.Police.getState());
  ok(`Polizia livello ${h}`, st.heat >= 1 && st.units >= 1 && (await nanCheck(p)) === 0, JSON.stringify(st));
}
await p.screenshot({ path: '/workspace/qa-police5.png' });
await p.evaluate(() => tratta.debug.Police.setHeat(0));
// 5 auto x ambienti (guida libera)
const cars = await p.evaluate(() => tratta.debug.Story.CARS.map(c => c.id));
for (const env of ['city', 'jungle', 'desert']) for (const c of cars) {
  await p.evaluate(([c, e]) => tratta.debug.Story.startFreeRoam(c, e), [c, env]); await p.waitForTimeout(100);
  await p.evaluate(() => { tratta.keys.ArrowUp = true; tratta.player.health = 100; }); await sim(p, 3);
  const st = await p.evaluate(() => ({ kmh: tratta.player.speed * 3.6, run: tratta.state.running, models: tratta.player.body.userData.wheels.length }));
  ok(`Guida libera ${env} / ${c}`, st.run && st.kmh > 20 && (await nanCheck(p)) === 0, `${st.kmh.toFixed(0)} km/h`);
}
for (const env of ['city', 'jungle', 'desert']) { await p.evaluate(e => tratta.debug.Story.startFreeRoam('rally', e), env); await p.evaluate(() => tratta.keys.ArrowUp = true); await sim(p, 6); await p.waitForTimeout(500); await p.screenshot({ path: `/workspace/qa-${env}.png` }); }
// velocità massima e curve: 60 s di gas, nessuna uscita
await p.evaluate(() => { tratta.debug.Story.startFreeRoam('berlina', 'city'); tratta.debug.noTraffic = true; tratta.debug.Police.setHeat(0); tratta.debug.Diff.reset(); tratta.player.speed = 0; tratta.keys.ArrowUp = true; }); await sim(p, 9.5); const t100 = await p.evaluate(() => tratta.player.speed * 3.6); ok('0-100 berlina ~8-12 s', t100 > 85 && t100 < 125, t100.toFixed(0) + ' km/h dopo 9.5 s'); await sim(p, 30);
const top = await p.evaluate(() => ({ kmh: tratta.player.speed * 3.6, gear: tratta.player.gear, d: tratta.player.distance }));
ok('Accelerazione realistica (berlina 30 s)', top.kmh > 140 && top.kmh < 215, JSON.stringify(top));
await p.evaluate(() => tratta.keys.ArrowUp = false); await p.evaluate(() => tratta.keys.ArrowDown = true); await sim(p, 6); 
ok('Frenata ferma l\'auto', await p.evaluate(() => tratta.player.speed) < 1); await p.evaluate(() => { tratta.keys.ArrowDown = false; tratta.debug.noTraffic = false; });
// 6 qualità
for (const q of ['2', '1', '0']) { await p.evaluate(() => document.getElementById('menu').classList.remove('hidden')); await p.evaluate(q => document.querySelector(`[data-q="${q}"]`).click(), q); await p.waitForTimeout(400); ok(`Qualità ${['Bassa','Media','Alta'][q]}`, await p.evaluate(q => localStorage.getItem('tratta-q') === q, q)); }
await p.evaluate(() => document.getElementById('menuClose').click());
// 7 garage
await p.evaluate(() => tratta.debug.Story.openGarage()); await p.waitForTimeout(300); await p.screenshot({ path: '/workspace/qa-garage.png' });
const gb = await p.$$eval('button', bs => bs.filter(b => b.offsetParent).map(b => b.textContent.trim()));
ok('Garage mostra auto', gb.filter(t => /🔒|Berlina|Furgone|Coupé|Rally|Supercar/.test(t)).length >= 8, gb.length + ' bottoni');
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.offsetParent && /Indietro/.test(b.textContent))?.click()); await p.waitForTimeout(200);
// 8 HUD sovrapposizioni
await p.evaluate(() => tratta.debug.Story.startFreeRoam('berlina', 'city')); await p.waitForTimeout(300); await p.evaluate(() => tratta.debug.Police.setHeat(3)); await sim(p, 2);
const overlaps = await p.evaluate(() => { const els = [...document.querySelectorAll('#ui *, body > div')].filter(e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 10 && s.visibility !== 'hidden' && s.display !== 'none' && (s.position === 'fixed' || s.position === 'absolute') && e.offsetParent !== null && +s.opacity > 0.05 && !e.classList.contains('panelWrap') && e.id !== 'ui' && e.id !== 'touch' && e.id !== 'msg'; });
  const top = els.filter(e => !els.some(o => o !== e && o.contains(e)));
  const out = []; for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) { const a = top[i].getBoundingClientRect(), b = top[j].getBoundingClientRect(); const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ix > 4 && iy > 4) out.push((top[i].id || top[i].textContent.slice(0, 20)) + ' X ' + (top[j].id || top[j].textContent.slice(0, 20))); } return out; });
ok('HUD senza sovrapposizioni (desktop)', overlaps.length === 0, overlaps.join(' ; '));
await p.screenshot({ path: '/workspace/qa-hud.png' });
// 9 reset progressi
await p.evaluate(() => tratta.debug.Story.openChapterSelect()); await p.waitForTimeout(200);
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.offsetParent && /Azzera/.test(b.textContent))?.click()); await p.waitForTimeout(300);
ok('Azzera progressi', (await p.evaluate(() => JSON.parse(localStorage.getItem('tratta_story_v2') || '{}').unlocked)) === 1);
await p.close();
// 10 iPad touch
const ip = await page({ ...devices['iPad (gen 7) landscape'] });
await ip.evaluate(() => tratta.debug.Story.startFreeRoam('berlina', 'city')); await ip.waitForTimeout(300);
const v0 = await ip.evaluate(() => tratta.player.speed);
await ip.dispatchEvent('#tG', 'pointerdown', { pointerId: 1, pointerType: 'touch' }); await sim(ip, 3);
const v1 = await ip.evaluate(() => tratta.player.speed);
ok('iPad: GAS touch accelera', v1 > v0 + 5, `${v0.toFixed(1)} -> ${v1.toFixed(1)}`);
await ip.evaluate(() => { tratta.debug.autopilot = false; window.__ap = false; }); await ip.dispatchEvent('#tR', 'pointerdown', { pointerId: 2, pointerType: 'touch' }); await sim(ip, 1);
const x1 = await ip.evaluate(() => tratta.player.x);
await ip.dispatchEvent('#tR', 'pointerup', { pointerId: 2, pointerType: 'touch' });
ok('iPad: sterzo touch (multi-touch con gas)', x1 > -1.5, 'x=' + x1.toFixed(2));
await ip.dispatchEvent('#tG', 'pointerup', { pointerId: 1, pointerType: 'touch' });
await ip.dispatchEvent('#tB', 'pointerdown', { pointerId: 3, pointerType: 'touch' }); await sim(ip, 4); await ip.dispatchEvent('#tB', 'pointerup', { pointerId: 3, pointerType: 'touch' });
ok('iPad: FRENO touch', (await ip.evaluate(() => tratta.player.speed)) < 2);
const ipOver = await ip.evaluate(() => { const ids = ['tL','tR','tN','tB','tG']; const r = ids.map(i => document.getElementById(i).getBoundingClientRect()); return r.every(x => x.width >= 60 && x.bottom <= innerHeight && x.right <= innerWidth && x.left >= 0); });
ok('iPad: pulsanti touch visibili e grandi', ipOver);
await ip.screenshot({ path: '/workspace/qa-ipad.png' });
await ip.close();
ok('Zero errori console/pagina', errors.length === 0, errors.slice(0, 8).join(' || '));
const fails = R.filter(r => !r.pass); console.log(`\nRISULTATO: ${R.length - fails.length}/${R.length} PASS`);
await b.close();
