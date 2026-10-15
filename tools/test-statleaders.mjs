#!/usr/bin/env node
// STAT LEADERS slides: per-sport toggles, out-of-season hiding, images (resized, lazy, initials fallback), 0 console errors.
//   node tools/test-statleaders.mjs [preview.html] [--out=DIR]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), FILE = args.find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = path.resolve((args.find(a => a.startsWith('--out=')) || '').slice(6) || path.join(REPO, 'tools', 'out', 'statleaders'));
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEYS = ['slNfl', 'slCfb', 'slNba', 'slCbb', 'slWnba', 'slNhl', 'slMlb'];
async function open() {
  const page = await browser.newPage(); await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome')); await page.setViewport({ width: 1280, height: 720 });
  const errors = [], big = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::|status of [45]\d\d/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGE ' + e));
  page.on('response', async r => { if (r.request().resourceType() === 'image' && /espncdn/.test(r.url())) { const l = +(r.headers()['content-length'] || 0); if (l > 120000) big.push(r.url()); } });
  await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('ahlersSportMode1'); } catch (e) {} });
  await page.goto(`http://127.0.0.1:${srv.address().port}/${FILE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 90000 });
  await page.evaluate(() => { arcadeNav.paused = true; });
  await page.evaluate(() => slLoad());
  return { page, errors, big };
}
const { page, errors, big } = await open();
const st = await page.evaluate(K => K.map(k => ({ k, on: defaultSettings[k] === true, el: !!document.getElementById('set-' + k), L: !!slLeague(k), ready: slReady(k), inS: slLeague(k) && slLeague(k).inSeason })), KEYS);
console.log(JSON.stringify(st));
ok(st.every(x => x.on && x.el), 'each sport has its own Settings toggle, all on by default');
ok(st.every(x => x.L), 'statleaders.json has every league');
ok(st.every(x => x.ready === !!x.inS), 'slides follow the in-season flag (' + st.filter(x => x.ready).map(x => x.k).join(',') + ' in season)');
const inS = st.filter(x => x.ready).map(x => x.k);
for (const k of inS) {
  await page.evaluate(k => { arcadeNav.paused = false; navGoTo(k); arcadeNav.paused = true; }, k); await sleep(2500);
  await page.waitForFunction(k => [...document.querySelectorAll('#sl-' + SL_KEYS[k] + '-grid img')].every(i => i.complete), { timeout: 20000 }, k).catch(() => {});
  await sleep(300);
  const r = await page.evaluate(k => { const g = document.getElementById('sl-' + SL_KEYS[k] + '-grid'), imgs = [...g.querySelectorAll('img')];
    return { vis: getComputedStyle(document.getElementById('sl-' + SL_KEYS[k] + '-screen')).display, cats: g.querySelectorAll('.sl-cat').length, rows: g.querySelectorAll('.sl-row').length,
      imgs: imgs.length, loaded: imgs.filter(i => i.naturalWidth > 0).length, ini: g.querySelectorAll('.sl-ini').length, lazy: imgs.every(i => i.loading === 'lazy'), resized: imgs.every(i => /combiner\/i\?img=.*&w=\d+/.test(i.src)),
      clip: [...g.querySelectorAll('.sl-cat')].some(c => c.getBoundingClientRect().bottom > window.innerHeight * 0.80) }; }, k);
  console.log(k, JSON.stringify(r));
  ok(r.vis === 'flex' && r.cats >= 3 && r.cats <= 4 && r.rows >= r.cats * 2, k + ': ' + r.cats + ' categories, #1 + ' + (r.rows / r.cats) + ' more each');
  ok(r.loaded + r.ini >= r.cats * 3 && r.lazy && r.resized, k + ': headshots/logos resized + lazy, loaded ' + r.loaded + '/' + r.imgs + (r.ini ? ', ' + r.ini + ' initials' : ''));
  ok(!r.clip, k + ': cards clear the ticker');
  await page.screenshot({ path: path.join(OUT, 'statleaders-' + k.slice(2).toLowerCase() + '.png') });
}
ok(!big.length, 'no full-size ESPN images (>120 KB) downloaded ' + big.slice(0, 2).join(' '));
// out of season: flag false -> skipped by the rotation; stale file -> season dates decide
const os = await page.evaluate(() => { const L = sl.data.leagues.nhl, keep = JSON.stringify(L);
  L.inSeason = false; const a = slReady('slNhl');
  const u = sl.data.updated; sl.data.updated = new Date(Date.now() - 5 * 86400000).toISOString(); L.season = { type: 4, end: '2026-01-01' }; const b = slReady('slNhl');
  L.season = { type: 2, end: new Date(Date.now() + 86400000 * 30).toISOString() }; const c = slReady('slNhl');
  sl.data.leagues.nhl = JSON.parse(keep); sl.data.updated = u; return { a, b, c }; });
ok(os.a === false, 'out of season (flag): hidden');
ok(os.b === false && os.c === true, 'stale file: falls back to ESPN season dates (off-season hidden, regular season shown)');
// rotation skips an out-of-season sport
const sk = await page.evaluate(async () => { sl.data.leagues.nba.inSeason = false; const k = ARCADE_SCREENS.indexOf('slNba'); rotationStep = k; arcadeNav.paused = false; arcadeNav.forcing = true; try { clearTimeout(slideTimer); nextSlide(); } finally { arcadeNav.forcing = false; }
  await new Promise(r => setTimeout(r, 800)); arcadeNav.paused = true; return arcadeNav.current; });
ok(sk !== 'slNba', 'rotation skips an out-of-season sport (went to ' + sk + ')');
// broken image -> initials
ok(await page.evaluate(async () => { const d = document.createElement('div'); d.innerHTML = slCat({ label: 'X', rows: [{ name: 'Connor McDavid', head: 'https://a.espncdn.com/i/headshots/nhl/players/full/0000000.png', val: '1', abbr: 'EDM' }, { name: 'Leon Draisaitl', head: '', val: '1', abbr: 'EDM' }] }); document.body.appendChild(d);
  await new Promise(r => setTimeout(r, 3500)); const n = [...d.querySelectorAll('.sl-ini')].map(x => x.textContent); d.remove(); return n.includes('CM') && n.includes('LD'); }), 'missing/broken headshot -> initials badge');
// toggle off persists per device
ok(await page.evaluate(() => { const c = document.getElementById('set-slMlb'); c.checked = false; updateSettings(); const saved = JSON.parse(localStorage.getItem('ahlersArcadeSettings')).slMlb; const on = slideOn('slMlb');
  c.checked = true; updateSettings(); return saved === false && on === false; }), 'MLB toggle off: saved in localStorage, slide off');
ok(!errors.length, 'no console errors ' + errors.join(' | '));
await browser.close(); srv.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
