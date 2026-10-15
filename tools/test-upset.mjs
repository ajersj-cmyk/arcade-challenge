#!/usr/bin/env node
// UPSET WATCH banner: trigger rules, exactly-5 s auto-dismiss + DOM removal, logos, queueing vs celebrations, TV delay, leak/long tasks.
//   node tools/test-upset.mjs [preview.html] [--out=DIR]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), FILE = args.find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = path.resolve((args.find(a => a.startsWith('--out=')) || '').slice(6) || path.join(REPO, 'tools', 'out', 'upset'));
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await browser.newPage(); await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome')); await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::|status of [45]\d\d/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGE ' + e));
await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('ahlersSportMode1'); } catch (e) {}
  window.__lt = 0; try { new PerformanceObserver(l => { l.getEntries().forEach(e => { if (window.__ltOn && e.duration > 50) window.__lt++; }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {} });
await page.goto(`http://127.0.0.1:${srv.address().port}/${FILE}`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 90000 });
await page.evaluate(async () => { if (ob.busy) await ob.busy; });
await page.evaluate(() => {
  arcadeNav.paused = true; settings.celebrateDelay = 0; settings.upsetWatch = true; celHide(true); alHide(true); cel.aq = []; cel.pending = [];
  ob.at = Date.now(); window.obLoad = () => Promise.resolve(); // freeze the slate: synthetic pregame lines
  const L = (sd, team, v, odds) => ({ side: sd, team_id: team, value: v, odds });
  ob.all = [{ away: { abbr: 'CAR', full: 'Carolina Panthers' }, home: { abbr: 'KC', full: 'Kansas City Chiefs' },
              pre: { mla: L('away', 1, 0, 380), mlh: L('home', 2, 0, -500), sa: L('away', 1, 9.5, -110), sh: L('home', 2, -9.5, -110) } },
            { away: { abbr: 'SEA', full: 'Seattle Seahawks' }, home: { abbr: 'SF', full: 'San Francisco 49ers' },
              pre: { mla: L('away', 1, 0, 140), mlh: L('home', 2, 0, -165), sa: L('away', 1, 3, -110), sh: L('home', 2, -3, -110) } }];
  window.__T = (a, h, aa = 'CAR', hh = 'KC', af = 'Carolina Panthers', hf = 'Kansas City Chiefs') => [
    { side: 'away', score: String(a), abbr: aa, full: af, short: aa, logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/' + aa.toLowerCase() + '.png' },
    { side: 'home', score: String(h), abbr: hh, full: hf, short: hh, logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/' + hh.toLowerCase() + '.png' }];
  window.__obs = (key, a, h, per, extra) => celObserve(key, 'football', 'in', __T(a, h, ...(extra || [])), false, '', false, '', null, per, 'nfl');
});
// rules
const r1 = await page.evaluate(async () => {
  const f0 = up.fired; __obs('t:1', 17, 20, 3); __obs('t:1', 24, 20, 3); const q3 = cel.pending.length + (up.el ? 1 : 0);
  __obs('t:1', 24, 20, 4); await new Promise(r => setTimeout(r, 400));
  return { q3, shown: !!document.getElementById('up-banner'), fired: up.fired - f0, last: up.last };
});
ok(r1.q3 === 0, 'dog leading in Q3: no banner (not late yet)');
ok(r1.shown && r1.fired === 1 && r1.last.dog === '+380' && r1.last.sc === '24-20' && r1.last.per === 'Q4', 'Q4 +380 dog leads: banner ' + JSON.stringify(r1.last));
const txt = await page.evaluate(() => document.getElementById('up-banner').innerText.replace(/\s+/g, ' '));
ok(/UPSET WATCH \+380 DOG CAR leads KC 24-20 Q4/.test(txt), 'banner text: ' + txt);
await page.waitForFunction(() => [...document.querySelectorAll('#up-banner img')].every(i => i.complete), { timeout: 10000 }).catch(() => {});
ok(await page.evaluate(() => [...document.querySelectorAll('#up-banner img')].filter(i => i.naturalWidth > 0).length === 2), 'both ESPN team logos load');
await sleep(600); await page.screenshot({ path: path.join(OUT, 'upset-watch.png') });
const css = await page.evaluate(() => { const c = getComputedStyle(document.getElementById('up-banner')); return { f: c.filter, bf: c.backdropFilter, an: c.animationName }; });
ok(css.f === 'none' && (css.bf === 'none' || !css.bf) && /up-in/.test(css.an), 'GPU-light: no filter/backdrop-filter, transform/opacity keyframes ' + JSON.stringify(css));
// exact 5 s
const t = await page.evaluate(async () => { celHide(true); alHide(true); cel.aq = []; cel.pending = []; delete cel.watch['t:2'];
  __obs('t:2', 3, 0, 1); __obs('t:2', 10, 7, 4);
  const t0 = performance.now(); while (!document.getElementById('up-banner') && performance.now() - t0 < 3000) await new Promise(r => setTimeout(r, 5)); const t1 = performance.now(); if (!document.getElementById('up-banner')) return 'none ' + JSON.stringify({ ul: !!upLine(__T(10, 7)), n: ob.all.length,  p: cel.pending.length, aq: cel.aq.length, sh: cel.showing, al: cel.alShowing, w: cel.watch['t:2'] && cel.watch['t:2'].up });
  while (document.getElementById('up-banner')) await new Promise(r => setTimeout(r, 5)); return performance.now() - t1; });
console.log('t', t); ok(Math.abs(t - 5000) < 120, 'auto-dismiss after 5 s and removed from the DOM (' + Math.round(t) + ' ms)');
// once per game, re-fire only on a re-taken lead after the cooldown
const r2 = await page.evaluate(async () => { const f0 = up.fired;
  __obs('t:2', 13, 7, 4); const same = up.fired - f0;              // still leading: no repeat
  __obs('t:2', 13, 14, 4); __obs('t:2', 20, 14, 4); const cool = up.fired + cel.pending.length - f0; // re-took lead inside the cooldown: no
  const c0 = UP_COOL_MS; UP_COOL_MS = 0; __obs('t:2', 20, 21, 4); __obs('t:2', 27, 21, 4); UP_COOL_MS = c0;
  await new Promise(r => setTimeout(r, 400)); const again = up.fired - f0;
  __obs('t:3', 0, 0, 1, ['SEA', 'SF', 'Seattle Seahawks', 'San Francisco 49ers']); __obs('t:3', 21, 10, 4, ['SEA', 'SF', 'Seattle Seahawks', 'San Francisco 49ers']);
  const small = cel.pending.filter(e => e.key === 't:3').length;
  return { same, cool, again, small }; });
ok(r2.same === 0, 'fires at most once while the lead holds');
ok(r2.cool === 0, 'lead lost + retaken inside the cooldown: no repeat');
ok(r2.again === 1, 'lead retaken after the cooldown: fires again');
ok(r2.small === 0, '+140 dog (not big) never triggers');
await page.waitForFunction(() => !document.getElementById('up-banner'), { timeout: 8000 });
// never overlaps a celebration or another banner
const ov = await page.evaluate(async () => { celHide(true); alHide(true); cel.aq = []; cel.pending = []; delete cel.watch['t:4']; delete cel.watch['t:5'];
  arcadeCelebrate('goal'); __obs('t:4', 3, 0, 1); __obs('t:4', 10, 7, 4); __obs('t:5', 3, 0, 1); __obs('t:5', 10, 7, 4);
  let bad = 0, both = 0, seen = 0; const end = performance.now() + 24000;
  while (performance.now() < end) { const n = document.querySelectorAll('#up-banner').length; if (n > 1) both++; if (n && (cel.showing || document.getElementById('cel-alert').classList.contains('show'))) bad++; if (n) seen = 1; await new Promise(r => setTimeout(r, 100)); }
  return { bad, both, seen, fired: up.last && up.last.at }; });
ok(ov.seen && ov.bad === 0 && ov.both === 0, 'queued behind the celebration, one banner at a time (' + JSON.stringify(ov) + ')');
// TV delay in Gamecast: the queued banner waits gcDelay()
const dl = await page.evaluate(() => { celHide(true); alHide(true); cel.aq = []; cel.pending = [];
  const o = { open: gc.open, key: gc.key, rp: gc.replay, ta: gc.trigAt }, g0 = window.gcDelay; gc.open = true; gc.key = 't:6'; gc.replay = null; gc.trigAt = 0; window.gcDelay = () => 12;
  delete cel.watch['t:6']; celObserve('t:6', 'football', 'in', __T(3, 0), false, '', true, '', null, 1, 'nfl'); celObserve('t:6', 'football', 'in', __T(10, 7), false, '', true, '', null, 4, 'nfl');
  const ev = cel.pending.filter(e => e.key === 't:6')[0], d = ev ? ev.at - Date.now() : null;
  cel.pending = []; window.gcDelay = g0; Object.assign(gc, { open: o.open, key: o.key, replay: o.rp, trigAt: o.ta }); return d; });
ok(dl != null && dl > 11000 && dl <= 12100, 'in Gamecast the banner waits the TV delay (' + dl + ' ms)');
// toggle off
ok(await page.evaluate(() => { settings.upsetWatch = false; delete cel.watch['t:7']; __obs('t:7', 3, 0, 1); __obs('t:7', 10, 7, 4); const n = cel.pending.length; settings.upsetWatch = true; return n === 0; }), 'Settings toggle off: no banner');
ok(await page.evaluate(() => !!document.getElementById('set-upsetWatch') && defaultSettings.upsetWatch === true), 'Settings toggle exists, on by default');
// repeated fires: no leak, no long tasks
const lk = await page.evaluate(async () => {
  celHide(true); alHide(true); cel.aq = []; cel.pending = []; const ms0 = UP_MS, c0 = UP_COOL_MS; UP_MS = 250; UP_COOL_MS = 0;
  if (window.gc && window.gc.constructor) {} if (window.gc && typeof window.gc === 'function') window.gc();
  const h0 = performance.memory ? performance.memory.usedJSHeapSize : 0, n0 = document.getElementsByTagName('*').length; window.__ltOn = true; window.__lt = 0;
  for (let i = 0; i < 40; i++) { delete cel.watch['L' + i]; __obs('L' + i, 3, 0, 1); __obs('L' + i, 10, 7, 4); await new Promise(r => setTimeout(r, 650)); }
  await new Promise(r => setTimeout(r, 1500)); window.__ltOn = false;
  const n1 = document.getElementsByTagName('*').length, h1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
  UP_MS = ms0; UP_COOL_MS = c0; return { fired: 40, nodes: n1 - n0, heapKB: Math.round((h1 - h0) / 1024), lt: window.__lt, left: document.querySelectorAll('#up-banner').length };
});
console.log('repeat', JSON.stringify(lk));
ok(lk.left === 0 && Math.abs(lk.nodes) < 20, '40 fires: no banners or nodes left behind (' + lk.nodes + ' nodes)');
ok(lk.heapKB < 3000, 'heap growth over 40 fires < 3 MB (' + lk.heapKB + ' KB)');
ok(lk.lt === 0, 'no long tasks (>50 ms) during repeated fires (' + lk.lt + ')');
ok(!errors.length, 'no console errors ' + errors.join(' | '));
await browser.close(); srv.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
