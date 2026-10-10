#!/usr/bin/env node
// Broadcast look: stinger wipe + lower third, stadium photos, Lite perf.  node tools/test-broadcast.mjs [preview.html]
// - frames of a transition (Full + TV/Lite) at 1280x720 -> mid-transition screenshots
// - the wipe only animates transform (no filter/clip/size animations), ends in < 1 s, exactly one slide left visible
// - remote-active (phone remote page) shows no wipe; Gamecast and celebrations stack above it
// - stadium photos: <= 6 per render, 640x360 combiner URLs, fall back cleanly (bad id -> card without photo)
// - perf: TV/Lite with CPU throttle 4x, rAF frame times during a transition (avg fps, worst frame, frames > 50 ms)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = path.join(REPO, 'tools', 'out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-broadcast'); fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : (f.endsWith('.json') ? 'application/json' : 'application/octet-stream') }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const errors = [], shots = [];
async function open(tv) {
  const page = await browser.newPage(); await page.setUserAgent(ua); await page.setViewport({ width: 1280, height: 720 });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::|status of [45]\d\d/.test(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
  await page.evaluateOnNewDocument(tv => { if (tv) window.ArcadeTV = {}; try { localStorage.removeItem('ahlersSportMode1'); } catch (e) {} }, tv);
  await page.goto(`http://127.0.0.1:${srv.address().port}/${FILE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current && typeof bxRun === 'function', { timeout: 90000 });
  await page.evaluate(() => { arcadeNav.paused = true; });
  await sleep(1500);
  const v0 = await page.evaluate(() => [...document.querySelectorAll('.slide-screen')].filter(s => s.style.display === 'flex').map(s => s.id).join(','));
  check(`${tv ? 'lite' : 'full'}: first slide after load is visible (skeleton LIVE -> LIVE reuses the screen)`, v0.split(',').filter(Boolean).length === 1, v0);
  return page;
}
const go = (page, k) => page.evaluate(k => { arcadeNav.paused = false; navGoTo(k); arcadeNav.paused = true; }, k);
const shot = async (page, name) => { const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f }); shots.push(path.relative(REPO, f)); };

for (const tv of [false, true]) {
  const tag = tv ? 'lite' : 'full';
  const page = await open(tv);
  await go(page, 'odds'); await sleep(5200);
  // frames: pause the CSS animations at fixed times so the screenshots are exact
  const natural = k => page.evaluate(k => { arcadeNav.forcing = true; try { rotationStep = arcadeScreens().indexOf(k); nextSlide(); } finally { arcadeNav.forcing = false; } }, k); // like the rotation (no remote HUD)
  for (const t of [110, 330, 590, 670]) {
    await natural('nhl');
    await page.evaluate(t => { document.getAnimations().forEach(a => { const tg = a.effect && a.effect.target; if (tg && tg.closest && (tg.closest('#bx-wipe') || tg.closest('#bx-l3'))) { a.pause(); a.currentTime = t; } }); if (t > 330) bxFinish(); /* the real ~330 ms hold has ended by then */ }, t);
    await sleep(120); await shot(page, `transition-${tag}-${t}ms`);
    await page.evaluate(() => document.getAnimations().forEach(a => a.play()));
    await sleep(1200);
    await natural('odds'); await sleep(1200);
  }
  await natural('nhl'); await sleep(1700); await shot(page, `lowerthird-${tag}`);
  const st = await page.evaluate(() => {
    const w = document.getElementById('bx-wipe'), anim = document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && (a.effect.target.closest('#bx-wipe') || a.effect.target.closest('#bx-l3')));
    const props = new Set(); anim.forEach(a => (a.effect.getKeyframes() || []).forEach(k => Object.keys(k).forEach(p => { if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p); })));
    return { lite: w.classList.contains('lite'), vis: [...document.querySelectorAll('.slide-screen')].filter(s => s.style.display === 'flex').length, cover: document.getElementById('main-wrapper').classList.contains('bx-cover'),
      run: w.classList.contains('run'), props: [...props].join(',') };
  });
  check(`${tag}: transition finished, exactly one slide visible, no cover`, st.vis === 1 && !st.cover && !st.run, JSON.stringify(st));
  check(`${tag}: wipe/lower third animate transform only`, !st.props || /^transform$/.test(st.props), st.props);
  check(`${tag}: Lite flag ${tv ? 'on in the TV app' : 'off in a browser'}`, st.lite === tv);
  // z-order: Gamecast / celebration / alert overlays sit above the wipe
  const z = await page.evaluate(() => { const zi = id => +getComputedStyle(document.getElementById(id)).zIndex || 0; return { wipe: zi('bx-wipe'), l3: zi('bx-l3'), gc: zi('gamecast'), cel: zi('celebrate'), al: zi('cel-alert'), wrap: zi('main-wrapper') }; });
  check(`${tag}: Gamecast/celebrations stack above the transition`, z.gc > z.wrap && z.cel > z.wrap && z.al > z.wrap && z.wipe < 1000 && z.l3 < 1000, JSON.stringify(z));
  // stadium photos on the odds slide
  await go(page, 'odds'); await sleep(3500);
  const v = await page.evaluate(() => { const ims = [...document.querySelectorAll('#odds-screen .card-venue img')]; return { n: ims.length, ok: ims.filter(i => i.classList.contains('ok')).length, cards: document.querySelectorAll('#odds-screen .glass-card').length, src: ims[0] ? ims[0].getAttribute('src') : '' }; });
  check(`${tag}: stadium photos behind game cards (<= 6, 640x360 combiner)`, v.n <= 6 && (v.n === 0 || /combiner\/i\?img=\/i\/venues\/.+&w=640&h=360/.test(v.src)), JSON.stringify(v));
  if (!tv) {
    // fallback: a bad venue id removes the photo layer, card stays
    const fb = await page.evaluate(async () => { const g = { venueImg: bxVenueUrl('nhl', '99999999', 'day/') }; const t = document.getElementById('odds-grid-track') || document.querySelector('#odds-screen .grid-track');
      const d = document.createElement('div'); d.innerHTML = bxVenueCard(g, '<div class="glass-card"><div class="card-meta">X</div></div>'); t.insertBefore(d.firstChild, t.firstChild);
      await new Promise(r => setTimeout(r, 3000)); const c = t.firstChild; const r = { photo: !!c.querySelector('.card-venue'), cls: c.className }; c.remove(); return r; });
    check('missing stadium photo -> plain card (no broken image)', !fb.photo && !/has-venue/.test(fb.cls), JSON.stringify(fb));
    // a slide that falls back to showSlideEmpty() reuses the LIVE screen: the hold must not hide it afterwards
    const se = await page.evaluate(async () => { arcadeNav.forcing = true; rotationStep = arcadeScreens().indexOf('live'); nextSlide(); arcadeNav.forcing = false;
      await new Promise(r => setTimeout(r, 1200)); const old = showCommand; showCommand = function() { showSlideEmpty('TEST EMPTY'); };
      arcadeNav.forcing = true; rotationStep = arcadeScreens().indexOf('command'); nextSlide(); arcadeNav.forcing = false; showCommand = old;
      await new Promise(r => setTimeout(r, 1200)); clearTimeout(slideTimer); return [...document.querySelectorAll('.slide-screen')].filter(s => s.style.display === 'flex').map(s => s.id).join(','); });
    check('slide -> empty fallback on the LIVE screen after LIVE: still exactly one slide visible', se === 'live-game-screen', se);
    // remote page: no wipe
    const rm = await page.evaluate(() => { document.body.classList.add('remote-active'); bxRun('nfl'); const r = document.getElementById('bx-wipe').classList.contains('run') && getComputedStyle(document.getElementById('bx-wipe')).display !== 'none'; document.body.classList.remove('remote-active'); return r; });
    check('remote-active: no transition', rm === false);
  }
  if (tv) {
    // perf: CPU throttle 4x, Lite, measure rAF frame intervals across the transition
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const res = [];
    for (const k of ['nhl', 'odds', 'nba']) { await go(page, k); await sleep(4000); } // warm: data, logos, stadium photos decoded once
    await page.evaluate(() => { window.__bx = [bxRun, bxHold]; });
    const runs = [['nhl', 1], ['nhl', 0], ['odds', 1], ['odds', 0], ['nba', 1], ['nba', 0]]; // 0 = same slide change with the transition switched off (baseline)
    for (const [k, on] of runs) {
      await page.evaluate(on => { if (on) { bxRun = __bx[0]; bxHold = __bx[1]; } else { bxRun = function() {}; bxHold = function() {}; } }, on);
      await go(page, 'mlb'); await sleep(5000); // same starting slide every time
      const r = await page.evaluate(k => new Promise(done => { const ts = []; let t0 = performance.now(); function f(t) { ts.push(t); if (t - t0 < 900) requestAnimationFrame(f); else done(ts); }
        requestAnimationFrame(t => { t0 = t; ts.push(t); arcadeNav.paused = false; navGoTo(k); arcadeNav.paused = true; requestAnimationFrame(f); }); }), k);
      const d = r.slice(1).map((t, i) => t - r[i]); const firstDrop = d[0];
      const span = r[r.length - 1] - r[0];
      res.push({ k, wipe: !!on, fps: +(d.length / (span / 1000)).toFixed(1), worst: +Math.max(...d.slice(1)).toFixed(1), slow: d.slice(1).filter(x => x > 50).length, swapFrame: +firstDrop.toFixed(1) });
    }
    await page.evaluate(() => { bxRun = __bx[0]; bxHold = __bx[1]; });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('PERF (TV/Lite, CPU 4x, 900 ms from the slide change):'); res.forEach(r => console.log(`  -> ${r.k} ${r.wipe ? 'WITH wipe   ' : 'no wipe (baseline)'}: ${r.fps} fps, slide-swap frame ${r.swapFrame} ms, worst later frame ${r.worst} ms, frames > 50 ms: ${r.slow}`));
    fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(res, null, 1));
    const avg = w => { const x = res.filter(r => r.wipe === w); return x.reduce((a, r) => a + r.fps, 0) / x.length; };
    console.log(`  avg fps with wipe ${avg(true).toFixed(1)} vs baseline ${avg(false).toFixed(1)}`);
    check('Lite transition under 4x CPU throttle costs < 20% fps vs. no transition (software-rendered headless)', avg(true) >= avg(false) * 0.8, `${avg(true).toFixed(1)} vs ${avg(false).toFixed(1)}`);
  }
  await page.close();
}
check('0 console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close(); srv.close();
console.log('screenshots:\n  ' + shots.join('\n  '));
console.log(fails ? `${fails} FAILED` : 'ALL BROADCAST CHECKS PASSED');
process.exit(fails ? 1 : 0);
