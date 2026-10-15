#!/usr/bin/env node
// CRT scanline setting + Disc Golf slide (schedule and live leaderboard paths).
//   node tools/test-crt-discgolf.mjs [preview.html] [--out=DIR]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), FILE = args.find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = path.resolve((args.find(a => a.startsWith('--out=')) || '').slice(6) || path.join(REPO, 'tools', 'out', 'crt-discgolf'));
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(fakeNow, tv) {
  const page = await browser.newPage(); await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome')); await page.setViewport({ width: 1280, height: 720 });
  const errors = [], pdga = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::|status of [45]\d\d/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGE ' + e));
  page.on('response', r => { if (/pdga\.com/.test(r.url())) pdga.push(r.status()); });
  await page.evaluateOnNewDocument((t, tv) => { if (tv) window.ArcadeTV = {}; if (t) { const off = t - Date.now(), D = Date, n = D.now; D.now = () => n() + off; }
    try { localStorage.removeItem('ahlersSportMode1'); } catch (e) {} }, fakeNow, tv);
  await page.goto(`http://127.0.0.1:${srv.address().port}/${FILE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 90000 });
  await page.evaluate(() => { arcadeNav.paused = true; });
  return { page, errors, pdga };
}
// 1) CRT default off, toggle on via settings checkbox, persists across reload, no animation, pointer-events none
{
  const { page, errors } = await open(0, false);
  ok(await page.evaluate(() => settings.crt === false && !document.body.classList.contains('crt-on')), 'CRT off by default');
  await page.screenshot({ path: path.join(OUT, 'crt-off.png') });
  await page.evaluate(() => { toggleSettings(); const c = document.getElementById('set-crt'); c.focus(); });
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'set-crt'), 'CRT checkbox focusable in settings (remote reachable)');
  await page.keyboard.press('Space'); await sleep(300);
  ok(await page.evaluate(() => settings.crt === true && document.body.classList.contains('crt-on') && JSON.parse(localStorage.getItem('ahlersArcadeSettings')).crt === true), 'CRT toggles on + saved in localStorage');
  await page.evaluate(() => toggleSettings()); await sleep(400);
  const st = await page.evaluate(() => { const o = getComputedStyle(document.getElementById('crt-overlay')); return { pe: o.pointerEvents, an: o.animationName, d: o.display, f: o.filter }; });
  ok(st.pe === 'none' && st.an === 'none' && st.d === 'block' && st.f === 'none', 'overlay static: ' + JSON.stringify(st));
  await page.screenshot({ path: path.join(OUT, 'crt-on.png') });
  await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 90000 });
  ok(await page.evaluate(() => document.body.classList.contains('crt-on')), 'CRT survives reload');
  await page.evaluate(() => { settings.crt = false; localStorage.setItem('ahlersArcadeSettings', JSON.stringify(settings)); });
  ok(!errors.length, 'no console errors (CRT) ' + errors.join(' | '));
  await page.close();
}
{ // TV app: lite -> no vignette
  const { page } = await open(0, true);
  await page.evaluate(() => { settings.crt = true; crtApply(); });
  ok(await page.evaluate(() => document.body.classList.contains('crt-lite') && getComputedStyle(document.getElementById('crt-overlay'), '::after').display === 'none'), 'TV app Lite: scanlines only, no vignette');
  await page.screenshot({ path: path.join(OUT, 'crt-on-tvlite.png') });
  await page.evaluate(() => { settings.crt = false; localStorage.setItem('ahlersArcadeSettings', JSON.stringify(settings)); });
  await page.close();
}
// 2) Disc golf: now (schedule or live) and pinned to USDGC final round day (live leaderboard)
for (const [label, t] of [['offweek', Date.parse('2026-10-13T16:00:00Z')], ['live-usdgc', Date.parse('2026-10-11T22:00:00Z')]]) {
  const { page, errors, pdga } = await open(t, false);
  await page.evaluate(() => dgLoad()); await page.waitForFunction(() => dg.at > 0 && !dg.busy, { timeout: 40000 });
  const info = await page.evaluate(() => ({ live: !!(dg.data && dg.data.live), rows: dg.data && dg.data.live ? dg.data.live.rows.length : 0, up: dg.data ? dg.data.upcoming.length : 0, ready: dgReady() }));
  console.log(label, JSON.stringify(info));
  ok(info.ready, label + ': disc golf has data');
  if (label === 'live-usdgc') ok(info.live && info.rows === 10, 'live leaderboard top 10');
  await page.evaluate(() => { arcadeNav.paused = false; navGoTo('discGolf'); arcadeNav.paused = true; }); await sleep(4000);
  await page.evaluate(() => document.querySelectorAll('.list-track').forEach(t => { t.style.animation = 'none'; t.style.transform = 'none'; }));
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('discgolf-screen')).display === 'flex' && document.getElementById('dg-track').children.length > 0), label + ': slide visible with rows');
  await page.waitForFunction(() => [...document.querySelectorAll('#dg-track img.dg-ph')].every(i => i.complete), { timeout: 20000 }).catch(() => {});
  const ph = await page.evaluate(() => ({ img: [...document.querySelectorAll('#dg-track img.dg-ph')].filter(i => i.naturalWidth > 0).length, ini: document.querySelectorAll('#dg-track span.dg-ini').length,
    lazy: [...document.querySelectorAll('#dg-track img.dg-ph')].every(i => i.loading === 'lazy'), title: document.getElementById('dg-title').textContent, n: document.querySelectorAll('#dg-track .dg-row, #dg-track .dg-ev').length }));
  console.log(label, 'page1', JSON.stringify(ph));
  if (label === 'live-usdgc') ok(!/RANKINGS/.test(ph.title) && ph.n === 10 && ph.img + ph.ini === 10 && ph.img >= 7 && ph.lazy, 'live leaderboard first: 10 rows with photos (or initials), lazy');
  else ok(/MPO WORLD RANKINGS/.test(ph.title) && ph.n === 10 && ph.img >= 7, 'no live event: MPO rankings first with photos');
  await page.screenshot({ path: path.join(OUT, 'discgolf-' + label + '.png') });
  const pages = await page.evaluate(() => dgPages(dg.data).map(p => p.title));
  console.log(label, 'pages', JSON.stringify(pages));
  ok(label === 'live-usdgc' ? pages.length === 2 && /MPO WORLD RANKINGS/.test(pages[1]) : pages.some(t => /FPO/.test(t)), label + ': page order ' + pages.join(' > '));
  await page.evaluate(() => { arcadeNav.paused = false; DG_PAGE_MS = 2500; navGoTo('discGolf'); arcadeNav.paused = true; }); await sleep(3500);
  ok(await page.evaluate(() => dgShown === 1 && /RANKINGS/.test(document.getElementById('dg-title').textContent)), label + ': page 2 is rankings');
  await page.evaluate(() => { clearTimeout(slideTimer); });
  await page.waitForFunction(() => [...document.querySelectorAll('#dg-track img.dg-ph')].every(i => i.complete), { timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, 'discgolf-' + label + '-page2.png') });
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'dgt'; d.innerHTML = dgPhoto('/files/styles/large/public/pictures/nope-404.jpg', 'Paul McBeth'); document.body.appendChild(d); });
  await sleep(4000);
  ok(await page.evaluate(() => { const t = document.querySelector('#dgt .dg-ini'); return !!t && t.textContent === 'PM'; }), label + ': broken photo -> initials badge');
  await page.evaluate(() => document.getElementById('dgt').remove());
  ok(pdga.length && pdga.every(s => s === 200 || s === 304), label + ': PDGA calls OK ' + pdga.join(','));
  ok(!errors.length, label + ': no console errors ' + errors.join(' | '));
  await page.close();
}
{ // no data -> skipped
  const { page } = await open(0, false);
  const r = await page.evaluate(() => { dg.data = { live: null, upcoming: [], rank: null }; dg.at = Date.now(); return dgReady(); });
  ok(r === false, 'empty data -> slide skipped');
  await page.close();
}
await browser.close(); srv.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
