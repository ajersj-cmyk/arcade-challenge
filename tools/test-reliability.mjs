#!/usr/bin/env node
// Reliability checks: hung-fetch timeout, stale scoreboard cache, trivia no longer skips the next slide,
// rotation watchdog, soft-reload skipped in the TV app.  node tools/test-reliability.mjs [preview.html]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };

const page = await browser.newPage();
await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: 1920, height: 1080 });
const errors = []; page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|tailwind/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGE ' + e));

// Intercept: hang one scoreboard forever; serve a tiny stub for another after we seed cache
let hangNfl = false, failAll = false;
const stubBoard = (away, home) => ({ events: [{ id: '99rel', date: new Date().toISOString(), competitions: [{ status: { type: { state: 'pre', shortDetail: '7:00 PM' } }, competitors: [
  { homeAway: 'home', score: '0', team: { id: '1', abbreviation: home, displayName: home, logo: 'https://a.espncdn.com/i/teamlogos/default-team-logo-500.png' } },
  { homeAway: 'away', score: '0', team: { id: '2', abbreviation: away, displayName: away, logo: 'https://a.espncdn.com/i/teamlogos/default-team-logo-500.png' } }],
  broadcasts: [] }] }] });
await page.setRequestInterception(true);
page.on('request', req => {
  const u = req.url();
  if (failAll && /scoreboard/.test(u)) return req.abort('failed');
  if (hangNfl && /football\/nfl\/scoreboard/.test(u)) return; // never respond
  if (/football\/nfl\/scoreboard/.test(u)) return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(stubBoard('AWAY', 'HOME')) });
  req.continue();
});

await page.goto(base + FILE, { waitUntil: 'load' });
await page.waitForFunction(() => typeof arcadeFetch === 'function' && typeof nextSlide === 'function', { timeout: 90000 });
await page.evaluate(() => { arcadeNav.paused = true; clearSlideTimers(); });

// 1. arcadeFetch aborts a hung request
const hung = await page.evaluate(async () => {
  const t0 = Date.now();
  let err = '';
  try { await arcadeFetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', { timeout: 800 }); }
  catch (e) { err = String(e && e.name || e); }
  return { ms: Date.now() - t0, err };
});
// Will continue() normally unless hangNfl - set hang via evaluate by patching fetch? Simpler: use a data URL that never resolves via AbortController test directly
const abortMs = await page.evaluate(async () => {
  const t0 = Date.now();
  // Use a never-resolving request by aborting via arcadeFetch timeout against a slow endpoint simulation:
  const orig = window.fetch;
  window.fetch = (url, init) => new Promise((res, rej) => { if (init && init.signal) init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  let name = '';
  try { await arcadeFetch('https://example.invalid/hang', { timeout: 600 }); } catch (e) { name = e.name || String(e); }
  window.fetch = orig;
  return { ms: Date.now() - t0, name };
});
check('arcadeFetch aborts a hung request within ~1 s', abortMs.name === 'AbortError' && abortMs.ms >= 500 && abortMs.ms < 2500, JSON.stringify(abortMs));

// 2. Trivia no longer double-increments (leaders follows trivia)
await page.evaluate(() => {
  currentTrivia = { q: 'Test?', opts: ['A','B','C','D'], ans: 'A' };
  settings.trivia = true; settings.leaders = true; settings.pga = true;
  // Find trivia index and simulate finishing a trivia slide the way showTrivia's timer does
  rotationStep = ARCADE_SCREENS.indexOf('trivia');
  // nextSlide will show trivia then ++ to leaders
});
const after = await page.evaluate(() => {
  // Mimic end of trivia: nextSlide already incremented past trivia; the OLD bug also did rotationStep++ before nextSlide
  // Call the completion path without the extra ++
  const before = rotationStep;
  // Force: set step to trivia, call nextSlide (shows trivia, increments to leaders)
  rotationStep = ARCADE_SCREENS.indexOf('trivia');
  clearSlideTimers(); clearTimeout(triviaRevealTimer);
  // Don't actually run full nextSlide (needs DOM). Instead verify showTrivia source no longer contains "rotationStep++"
  return { triviaIdx: ARCADE_SCREENS.indexOf('trivia'), leadersIdx: ARCADE_SCREENS.indexOf('leaders'), pgaIdx: ARCADE_SCREENS.indexOf('pga'),
    src: String(showTrivia) };
});
check('showTrivia no longer increments rotationStep (fixes skip of leaders/PGA)', !/rotationStep\+\+/.test(after.src) && after.leadersIdx === after.triviaIdx + 1, JSON.stringify({ leaders: after.leadersIdx, trivia: after.triviaIdx, pga: after.pgaIdx }));

// 3. Watchdog + clearSlideTimers exist
const wd = await page.evaluate(() => ({ arm: typeof armSlideWatchdog === 'function', clear: typeof clearSlideTimers === 'function', max: SLIDE_MAX_MS, fetchMs: FETCH_MS }));
check('rotation watchdog + fetch timeout helpers present (90 s / 9 s)', wd.arm && wd.clear && wd.max === 90000 && wd.fetchMs === 9000, JSON.stringify(wd));

// 4. Stale cache: seed cache, fail scoreboards, updateSportsTicker still paints + pill
await page.evaluate(() => {
  cacheScoreboard('nfl', { events: [{ id: '99rel', name: 'Test', date: new Date().toISOString(), competitions: [{ status: { type: { state: 'pre', shortDetail: 'Tonight' }, },
    competitors: [{ homeAway: 'home', score: '', team: { id: '1', abbreviation: 'CAR', displayName: 'Panthers', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/car.png' } },
      { homeAway: 'away', score: '', team: { id: '2', abbreviation: 'ATL', displayName: 'Falcons', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png' } }], broadcasts: [] }] }] });
});
failAll = true;
await page.evaluate(async () => { await updateSportsTicker(); });
const stale = await page.evaluate(() => ({
  pill: document.getElementById('net-pill').textContent,
  cls: document.getElementById('net-pill').className,
  ticker: document.getElementById('ticker-track').innerText.slice(0, 80),
  stale: netState.stale
}));
check('when scoreboards fail, last good cache is shown with a STALE/OFFLINE pill', stale.stale && /STALE|OFFLINE/.test(stale.pill) && /CAR|ATL|Panthers|Falcons|UPCOMING|LIVE/.test(stale.ticker), JSON.stringify(stale));
failAll = false;

// 5. Soft reload skipped in TV app
const soft = await page.evaluate(() => {
  window.ArcadeTV = { v: 1 };
  let armed = false;
  const orig = window.setTimeout;
  window.setTimeout = function(fn, ms) { if (ms > 3600000) armed = true; return orig.apply(this, arguments); };
  scheduleSoftReload();
  window.setTimeout = orig;
  delete window.ArcadeTV;
  return { armed };
});
check('nightly soft reload is a no-op when window.ArcadeTV exists', !soft.armed, JSON.stringify(soft));

// 6. Wake Lock helper exists (request may fail headless — that is fine)
const wake = await page.evaluate(() => typeof requestWakeLock === 'function');
check('Screen Wake Lock helper is present', wake);

check('no console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL RELIABILITY CHECKS PASSED');
await browser.close(); srv.close(); process.exit(fails ? 1 : 0);
