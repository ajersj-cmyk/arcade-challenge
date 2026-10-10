#!/usr/bin/env node
// Gamecast checks for the Ahlers Arcade scoreboard (run from repo root):
//   node tools/test-gamecast.mjs [preview.html] [--events sport/league/id/LABEL,...]
// 1. Opens a Gamecast for every live game in the page's own game registry (one per league) plus a set of
//    final / upcoming reference events, checks each one populates, and saves a 1920x1080 screenshot.
// 2. Poll cadence: ~10 s start-to-start, never more than one Gamecast request (summary or the 2 s scoreboard/{id} check) in flight.
// 3. Reconnecting state while ESPN is unreachable, then recovery.
// 4. Auto-close of a finished game after the idle window, and a clean stop (no timers, no requests) on close.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const FILE = args.find(a => !a.startsWith('--') && /\.html$/.test(a)) || 'preview.html';
const evArg = args.includes('--events') ? args[args.indexOf('--events') + 1] : null;
// Reference events (verified 2026-10-07): finals / upcoming that ESPN keeps serving
const REF = (evArg || 'football/nfl/401872979/NFL,football/college-football/401856705/CFB,soccer/fifa.world/760517/FIFA WORLD CUP,baseball/mlb/401907992/MLB,football/nfl/401872980/NFL,soccer/eng.1/401879268/EPL')
  .split(',').map(s => { const [sport, league, id, label] = s.split('/'); return { sport, league, id, label: label || league.toUpperCase(), key: 'ref:' + id }; });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(REPO, 'tools', 'out', `${stamp}-gamecast`); fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const isNoise = t => (/Failed to load resource/.test(t) && !/summary\?event=/.test(t)) || /favicon/.test(t) || /ERR_INTERNET_DISCONNECTED/.test(t); // the induced outage logs a network error by design

const page = await browser.newPage();
await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: 1920, height: 1080 });
const errors = []; page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text() + ' ' + ((m.location() || {}).url || ''))) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
let blockSummary = false; const reqLog = []; let inFlight = 0, maxInFlight = 0;
await page.setRequestInterception(true);
page.on('request', req => {
  const u = req.url();
  if (/\/scoreboard\/\d+(\?|$)/.test(u)) { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); }
  if (/\/summary\?event=/.test(u)) {
    reqLog.push(Date.now());
    if (blockSummary) return req.abort('internetdisconnected');
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  }
  req.continue();
});
const done = req => { if ((/\/summary\?event=/.test(req.url()) && !blockSummary) || /\/scoreboard\/\d+(\?|$)/.test(req.url())) inFlight = Math.max(0, inFlight - 1); };
page.on('requestfinished', done); page.on('requestfailed', done);
await page.goto(base + FILE, { waitUntil: 'load' });
await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current && typeof gcOpenEvent === 'function', { timeout: 90000 });
await page.evaluate(() => { arcadeNav.paused = true; }); // hold rotation so screenshots only show the overlay
const state = () => page.evaluate(() => ({ open: gc.open, key: gc.key, st: gc.state, lastOk: gc.lastOk, fails: gc.fails, polls: gc.polls, timer: !!gc.timer, ctrl: !!gc.ctrl, scroll: !!gc.scrollTimer, err: gc.renderErr,
  shown: getComputedStyle(document.getElementById('gamecast')).display, away: (document.querySelector('#gc-away .gc-tname') || {}).textContent || '', home: (document.querySelector('#gc-home .gc-tname') || {}).textContent || '',
  mid: document.getElementById('gc-mid').innerText.replace(/\s+/g, ' ').trim(), plays: document.querySelectorAll('#gc-plays-body .gc-play').length, stats: document.querySelectorAll('#gc-stats-body .gc-st').length,
  leaders: document.querySelectorAll('#gc-players-body .gc-ldr').length, box: document.querySelectorAll('#gc-players-body .gc-bx tr').length, line: !!document.querySelector('#gc-line table'), wp: !!document.querySelector('#gc-wp .gc-wp-bar'),
  updated: document.getElementById('gc-updated').innerText }));

// 1. live games from the page's registry (one per league) + reference events
const live = await page.evaluate(() => { const seen = {}; return gcOrder.map(k => gcRegistry[k]).filter(m => m.state === 'in' && !seen[m.cid] && (seen[m.cid] = 1)); });
const ONLY = args.includes('--quick');
const todo = ONLY ? [] : live.map(m => ({ meta: m, tag: `${m.cid}-live` })).concat(REF.map(m => ({ meta: m, tag: `${m.league.replace(/\W+/g, '')}-${m.id}` })));
const shots = [];
for (const t of todo) {
  await page.evaluate(m => gcOpenEvent(m), t.meta);
  await page.waitForFunction(() => gc.lastOk > 0 || gc.fails > 0, { timeout: 15000 }).catch(() => {});
  await sleep(2500); // logos/headshots
  const s = await state();
  const tag = `${t.tag}-${s.st || 'na'}`;
  const ok = s.open && s.lastOk > 0 && !s.err && s.away && s.home && (s.plays + s.stats + s.leaders + s.box) > 0 && /UPDATED \d/.test(s.updated);
  const file = path.join(OUT, `gamecast-${tag}.png`); await page.screenshot({ path: file }); shots.push(path.relative(REPO, file));
  check(`populates ${t.meta.label} ${t.meta.id} [${s.st}]`, ok, `${s.away} @ ${s.home} | ${s.mid.slice(0, 70)} | plays ${s.plays}, team stats ${s.stats}, leaders ${s.leaders}, box rows ${s.box}, linescore ${s.line}, winprob ${s.wp}${s.err ? ' | renderErr ' + s.err : ''}`);
}
// 2. cadence on the first live game (or the first reference event)
const cad = (live[0] || REF[0]);
await page.evaluate(m => gcOpenEvent(m), cad);
const n0 = reqLog.length; maxInFlight = 0; const h0 = await page.evaluate(() => (gc.f && gc.f.hits) || 0);
const t0 = Date.now(); while (reqLog.length < n0 + 4 && Date.now() - t0 < 40000) await sleep(200);
const ts = reqLog.slice(n0); const gaps = ts.slice(1).map((x, i) => x - ts[i]);
const hits = (await page.evaluate(() => (gc.f && gc.f.hits) || 0)) - h0; // live game: a change seen by the 2 s check pulls the summary early (by design)
check('poll interval ~10 s (start to start; early only when the 2 s check saw a change)', gaps.length >= 3 && gaps.every(g => g <= 12000) && gaps.filter(g => g < 8500).length <= hits * 4,
  gaps.map(g => (g / 1000).toFixed(1) + 's').join(', ') + ` | fast-loop changes ${hits}`);
check('never more than one Gamecast request in flight (summary + 2 s check)', maxInFlight <= 1, `max in flight ${maxInFlight}`);
// 3. reconnecting
blockSummary = true;
await page.waitForFunction(() => gc.fails > 0, { timeout: 15000 }).catch(() => {});
let s = await state();
await page.screenshot({ path: path.join(OUT, 'gamecast-reconnecting.png') }); shots.push(path.relative(REPO, path.join(OUT, 'gamecast-reconnecting.png')));
check('shows RECONNECTING + last update while the feed is down (keeps last data)', /RECONNECTING/.test(s.updated) && /LAST UPDATE/.test(s.updated) && !!s.away && s.open, s.updated);
blockSummary = false;
await page.waitForFunction(() => gc.fails === 0 && gc.lastOk > 0, { timeout: 25000 }).catch(() => {});
s = await state();
check('recovers automatically when the feed returns', s.fails === 0 && /UPDATED/.test(s.updated) && !/RECONNECTING/.test(s.updated), JSON.stringify({ updated: s.updated, fails: s.fails, open: s.open, polls: s.polls, timer: s.timer }));
// 4. auto-close a finished game after the idle window (shortened for the test), then clean stop
await page.evaluate(m => { GC_POST_IDLE_MS = 3000; gcOpenEvent(m); gc.lastInput = Date.now() - 5000; }, REF[0]);
await page.waitForFunction(() => !gc.open, { timeout: 25000 }).catch(() => {});
s = await state();
check('finished game auto-closes back to rotation after idle window', !s.open && s.shown === 'none', JSON.stringify({ open: s.open, shown: s.shown }));
await page.evaluate(() => { GC_POST_IDLE_MS = 600000; });
await page.evaluate(m => gcOpenEvent(m), cad);
await sleep(1500);
await page.evaluate(() => gcClose());
const nC = reqLog.length; await sleep(11000); s = await state();
check('close stops everything (no timers, no requests for 11 s)', !s.open && !s.timer && !s.ctrl && !s.scroll && reqLog.length === nC, `${reqLog.length - nC} requests after close`);
check('0 console errors / page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); srv.close();
fs.writeFileSync(path.join(OUT, 'gamecast-report.json'), JSON.stringify({ file: FILE, results, shots, gaps }, null, 2));
console.log('Screenshots:\n  ' + shots.join('\n  '));
console.log(fails ? `FAIL (${fails})` : 'PASS');
process.exit(fails ? 1 : 0);
