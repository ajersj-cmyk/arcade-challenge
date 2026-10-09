#!/usr/bin/env node
// Screenshot every rotation slide (+ Gamecast) at one size, for design reviews / before-after.
//   node tools/shoot-slides.mjs [preview.html] [--out=DIR] [--size=1280x720] [--tv] [--only=live,nhl] [--gc=sport/league/id]
// --tv emulates the TV app (window.ArcadeTV -> Lite). Writes DIR/NN-key.png and DIR/sheet.png (contact sheet).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = k => (args.find(a => a.startsWith('--' + k + '=')) || '').split('=').slice(1).join('=');
const FILE = args.find(a => /\.html$/.test(a)) || 'preview.html';
const [W, H] = (opt('size') || '1280x720').split('x').map(Number);
const OUT = path.resolve(opt('out') || path.join(REPO, 'tools', 'out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-slides'));
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : (f.endsWith('.json') ? 'application/json' : 'application/octet-stream') }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage(); await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome')); await page.setViewport({ width: W, height: H });
const errors = []; page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::|status of [45]\d\d/.test(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
await page.evaluateOnNewDocument(tv => { if (tv) window.ArcadeTV = {}; try { localStorage.removeItem('ahlersSportMode1'); const s = JSON.parse(localStorage.getItem('ahlersArcadeSettings') || '{}'); ['trivia','ufc','pga','soccerSlide','hotProps','fantasy','command'].forEach(k => s[k] = true); localStorage.setItem('ahlersArcadeSettings', JSON.stringify(s)); } catch (e) {} }, args.includes('--tv'));
await page.goto(`http://127.0.0.1:${srv.address().port}/${FILE}`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 90000 });
await page.evaluate(() => { arcadeNav.paused = true; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let keys = await page.evaluate(() => ARCADE_SCREENS.filter(k => slideOn(k)));
if (opt('only')) keys = opt('only').split(',');
const files = [];
for (const [i, k] of keys.entries()) {
  await page.evaluate(k => { arcadeNav.paused = false; navGoTo(k); arcadeNav.paused = true; }, k);
  await sleep(k === 'trivia' ? 2500 : 4500);
  await page.evaluate(() => document.querySelectorAll('.slide-screen [style*="scrollVerticalOnePass"], .grid-track, .list-track, .fut-grid, .ff-grid, .hp-grid').forEach(t => { t.style.animation = 'none'; t.style.transform = 'none'; }));
  await sleep(300);
  const f = path.join(OUT, String(i + 1).padStart(2, '0') + '-' + k + '.png'); await page.screenshot({ path: f }); files.push(f);
}
const gcArg = opt('gc');
if (gcArg) {
  const [sport, league, id] = gcArg.split('/');
  await page.evaluate(m => gcOpenEvent(m), { sport, league, id, label: league.toUpperCase(), key: 'ref:' + id });
  await page.waitForFunction(() => gc.lastOk > 0 || gc.fails > 0, { timeout: 15000 }).catch(() => {});
  await sleep(4000);
  const f = path.join(OUT, '99-gamecast.png'); await page.screenshot({ path: f }); files.push(f);
  await page.evaluate(() => gcClose());
}
await browser.close(); srv.close();
fs.writeFileSync(path.join(OUT, 'errors.txt'), errors.join('\n'));
console.log(OUT); console.log(files.length + ' shots, console errors: ' + errors.length); errors.slice(0, 5).forEach(e => console.log('  ' + e));
