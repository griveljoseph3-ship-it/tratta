import { chromium, devices } from 'playwright-core';
const URL = process.argv[2] || 'http://localhost:8765/', Q = process.argv[3] || '1';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-precise-memory-info'] });
const c = await b.newContext(process.argv[4] === 'small' ? { viewport: { width: 200, height: 150 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, userAgent: devices['iPad Pro 11 landscape'].userAgent } : { ...devices['iPad Pro 11 landscape'] }); const p = await c.newPage();
await p.addInitScript(q => { localStorage.setItem('tratta-q', q); localStorage.setItem('tratta-intro','1');
  const raf = window.requestAnimationFrame.bind(window); window.__ft = [];
  window.requestAnimationFrame = cb => raf(t => { const a = performance.now(); cb(t); window.__ft.push(performance.now() - a); }); }, Q);
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.tratta?.debug?.Story, null, { timeout: 30000 });
await p.evaluate(async () => { tratta.debug.skipCinema = true; await tratta.debug.closeCinema?.(); tratta.debug.Story.startChapter(0); });
for (let k=0;k<20;k++){ await p.waitForTimeout(300); const r = await p.evaluate(()=>{ const bs=[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&/Guida|Parti|Continua|Avanti/.test(b.textContent)); bs[0]?.click(); return tratta.state.running && !tratta.state.paused; }); if (r) break; }
await p.evaluate(()=>{ tratta.keys.ArrowUp=true; tratta.debug.god=true; tratta.debug.autopilot=true; tratta.debug.noAdapt=true; });
await p.waitForTimeout(3000);
const cdp = await c.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await p.evaluate(()=>{ window.__ft.length = 0; tratta.debug.prof = []; window.__heap = []; window.__hi = setInterval(()=>__heap.push(performance.memory.usedJSHeapSize), 100); });
await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await p.waitForTimeout(15000);
const prof = (await cdp.send('HeapProfiler.stopSampling')).profile; const agg = {}; const walk = (n) => { const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; agg[k] = (agg[k] || 0) + n.selfSize; n.children.forEach(walk); }; walk(prof.head);
console.log(Object.entries(agg).sort((a,b)=>b[1]-a[1]).slice(0,14).map(([k,v])=>(v/1e3).toFixed(0)+'KB '+k).join('\n'));
const r = await p.evaluate(() => { clearInterval(__hi); const f = __ft.slice().sort((a,b)=>a-b); const q = x => f[Math.floor(f.length*x)]; let drops = 0, alloc = 0; for (let i=1;i<__heap.length;i++){ const d=__heap[i]-__heap[i-1]; if (d < -500000) drops++; else if (d>0) alloc+=d; }
  const P = tratta.debug.prof || []; const per = P.filter(x=>x[2]>0).map(x=>x[0]/x[2]).sort((a,b)=>a-b); const rr = P.map(x=>x[1]).sort((a,b)=>a-b); const pq=(a,x)=>a[Math.floor(a.length*x)]||0;
  return { simPerStep_p50: pq(per,.5), simPerStep_p95: pq(per,.95), render_p50: pq(rr,.5), render_p95: pq(rr,.95), est60Hz_p50: 2*pq(per,.5)+pq(rr,.5), est60Hz_p95: 2*pq(per,.95)+pq(rr,.95), frames: f.length, mean: f.reduce((a,b)=>a+b,0)/f.length, p50: q(.5), p95: q(.95), max: f[f.length-1], gcDrops: drops, allocMBperS: alloc/1e6/15, calls: tratta.renderer.info.render.calls, tris: tratta.renderer.info.render.triangles }; });
console.log(JSON.stringify(r, (k,v)=>typeof v==='number'?+v.toFixed(2):v));
await b.close();
