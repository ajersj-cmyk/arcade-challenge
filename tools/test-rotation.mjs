#!/usr/bin/env node
// Rotation timing regression (run from repo root):  node tools/test-rotation.mjs [preview.html] [--loops=3] [--speed=8]
// Emulates the TV app (window.ArcadeTV, 1280x720), turns every slide on (incl. Trivia), sport mode OFF, real network data,
// and REAL page timers sped up N x (every setTimeout/setInterval delay divided by --speed, so a 20 s slide takes 2.5 s).
// Walks the whole rotation several times and records how long each slide was actually on screen (scaled back to real
// seconds). Fails if any slide that was shown was cut short (< 5 s), e.g. the slide after Trivia flashing for 1.5 s,
// if Trivia itself isn't ~20 s, or if a loop never completes. Also runs one pass in NFL sport mode.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const FILE = args.find(a => /\.html$/.test(a)) || 'preview.html';
const LOOPS = +((args.find(a => a.startsWith('--loops=')) || '').split('=')[1] || 3);
const SPEED = +((args.find(a => a.startsWith('--speed=')) || '').split('=')[1] || 8);
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : (f.endsWith('.json') ? 'application/json' : 'application/octet-stream') }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const isNoise = t => /Failed to load resource|favicon|ERR_|net::|status of 4\d\d|status of 5\d\d/.test(t);
const errors = [];

async function walk(mode) {
  const page = await browser.newPage();
  await page.setUserAgent(ua); await page.setViewport({ width: 1280, height: 720 });
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text() + ' ' + ((m.location() || {}).url || ''))) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
  await page.evaluateOnNewDocument((speed, mode) => {
    window.ArcadeTV = {}; // the TV app bridge
    const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
    window.__realTimeout = st; window.__realInterval = si; window.__speed = speed;
    window.setTimeout = (fn, ms, ...a) => st(fn, Math.max(0, (+ms || 0) / speed), ...a);
    window.setInterval = (fn, ms, ...a) => si(fn, Math.max(4, (+ms || 0) / speed), ...a);
    try {
      const s = JSON.parse(localStorage.getItem('ahlersArcadeSettings') || '{}');
      ['mySquad', 'trivia', 'leaders', 'pga', 'ufc', 'command', 'soccerSlide', 'tvGuide', 'news', 'odds', 'futures', 'nflFutures', 'nflAwards', 'fantasy', 'cfbFutures', 'nhlFutures', 'rankings', 'nfl', 'nba', 'nhl', 'mlb', 'hotProps'].forEach(k => { s[k] = true; });
      localStorage.setItem('ahlersArcadeSettings', JSON.stringify(s));
      if (mode) localStorage.setItem('ahlersSportMode1', JSON.stringify({ mode, start: Date.now(), until: Date.now() + 3600e3, snap: {}, step: 0 }));
      else localStorage.removeItem('ahlersSportMode1');
    } catch (e) {}
  }, SPEED, mode);
  await page.goto(base + FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && typeof nextSlide === 'function', { timeout: 90000 });
  await page.evaluate(() => {
    FETCH_MS = 60000; // fetch timeouts are wall-clock network waits: keep them ~real despite the sped-up timers
    if (!currentTrivia) currentTrivia = { q: 'Which team plays at PNC Arena?', opts: ['Hurricanes', 'Panthers', 'Rangers', 'Bruins'], ans: 'Hurricanes' };
    const oldFetch = window.fetchNextTrivia; window.fetchNextTrivia = function() { try { oldFetch(); } catch (e) {} if (!currentTrivia) currentTrivia = { q: 'Q?', opts: ['A', 'B', 'C', 'D'], ans: 'A' }; };
    window.__log = []; let last = null;
    window.__realInterval(() => { const k = arcadeNav.current + '#' + slideGen; if (k !== last) { last = k; window.__log.push({ k: arcadeNav.current, g: slideGen, t: performance.now() }); } }, 15);
  });
  const screens = await page.evaluate(() => arcadeScreens().filter(k => slideOn(k)));
  const target = screens.length * LOOPS;
  const t0 = Date.now();
  const limit = Date.now() + Math.max(240000, target * 9000);
  while (Date.now() < limit && (await page.evaluate(() => window.__log.length)) <= target) await new Promise(r => setTimeout(r, 1000));
  const log = await page.evaluate(() => window.__log), speed = SPEED;
  await page.close();
  const shown = [];
  for (let i = 1; i < log.length - 1; i++) shown.push({ k: log[i].k, s: (log[i + 1].t - log[i].t) * speed / 1000 });
  return { screens, shown, wall: (Date.now() - t0) / 1000, done: log.length > target };
}

for (const mode of ['', 'nfl']) {
  const r = await walk(mode);
  const label = mode ? `NFL mode` : 'all slides, sport mode off';
  console.log(`\n[${label}] ${r.shown.length} slide showings in ${r.wall.toFixed(0)} s wall (${SPEED}x):`);
  console.log('  ' + r.shown.map(x => `${x.k} ${x.s.toFixed(1)}s`).join(' | '));
  check(`${label}: rotation keeps going (${mode ? 1 : LOOPS} loop(s) or more)`, r.done || (mode && r.shown.length >= 4), `${r.shown.length} showings`);
  const short = r.shown.filter(x => x.s < 5);
  check(`${label}: no slide is cut short (< 5 s on screen)`, !short.length, short.map(x => `${x.k} ${x.s.toFixed(1)}s`).join(', '));
  const tv = r.shown.filter(x => x.k === 'trivia');
  if (!mode) {
    check('Trivia shows ~20 s (15 s question + 5 s answer) each time', tv.length >= LOOPS - 1 && tv.every(x => x.s > 18 && x.s < 23), tv.map(x => x.s.toFixed(1)).join(', '));
    const after = []; r.shown.forEach((x, i) => { if (x.k === 'trivia' && r.shown[i + 1]) after.push(r.shown[i + 1]); });
    check('the slide right after Trivia gets its full time', after.length && after.every(x => x.s >= 5), after.map(x => `${x.k} ${x.s.toFixed(1)}s`).join(', '));
  }
}
check('no console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close(); srv.close();
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL ROTATION CHECKS PASSED');
process.exit(fails ? 1 : 0);
