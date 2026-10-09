#!/usr/bin/env node
// Gamecast fast score loop checks (run from repo root):
//   node tools/test-fastloop.mjs [preview.html]                       mocked live game: cadence, no overlap, change -> summary,
//                                                                     error backoff, pause when hidden, stop when final / closed
//   node tools/test-fastloop.mjs [preview.html] --live sport/league/id [--secs 180]
//                                                                     real ESPN game: requests, bytes, heap, detected changes
// Both emulate the TV app (window.ArcadeTV, 1280x720, 4x CPU throttle).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const FILE = args.find(a => !a.startsWith('--') && /\.html$/.test(a)) || 'preview.html';
const LIVE = args.includes('--live') ? args[args.indexOf('--live') + 1] : null;
const SECS = args.includes('--secs') ? +args[args.indexOf('--secs') + 1] : 180;
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', protocolTimeout: 600000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--enable-precise-memory-info'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const page = await browser.newPage();
await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: 1280, height: 720 });
await page.evaluateOnNewDocument(() => { window.ArcadeTV = {}; try { localStorage.removeItem('ahlersArcadeTvDelay'); } catch (e) {} });
const isNoise = t => /Failed to load resource/.test(t) || /favicon/.test(t);
const errors = []; page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
const cdp = await page.target().createCDPSession(); await cdp.send('Network.enable'); await cdp.send('HeapProfiler.enable');
const kind = u => /\/summary\?event=/.test(u) ? 'summary' : /\/scoreboard\/\w+(\?|$)/.test(u) ? 'fast' : null;
const reqs = []; const byId = {}; let inFlight = 0, maxInFlight = 0;
cdp.on('Network.requestWillBeSent', e => { const k = kind(e.request.url); if (!k) return; const r = { k, t: Date.now(), bytes: 0, done: 0 }; byId[e.requestId] = r; reqs.push(r); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); });
const fin = (e, ok) => { const r = byId[e.requestId]; if (!r || r.done) return; r.done = Date.now(); if (ok) r.bytes = e.encodedDataLength || 0; inFlight = Math.max(0, inFlight - 1); };
cdp.on('Network.loadingFinished', e => fin(e, true)); cdp.on('Network.loadingFailed', e => fin(e, false));
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await sleep(300); const h = await cdp.send('Runtime.getHeapUsage'); return h.usedSize; };
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const gaps = rs => rs.slice(1).map((r, i) => r.t - rs[i].t);

let G = { a: 1, h: 1, state: 'in', per: 2, sec: 12 * 60 + 34, t0: Date.now(), fastErr: false };
if (!LIVE) {
  await page.setRequestInterception(true);
  const clk = () => { const s = Math.max(0, Math.floor(G.sec - (Date.now() - G.t0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const comp = (lag) => ({ status: { period: G.per, displayClock: clk(), type: { state: G.state, name: G.state === 'post' ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS', detail: '2nd', shortDetail: '2nd', completed: G.state === 'post' } },
    competitors: [{ homeAway: 'home', score: String(lag && G.hLag != null ? G.hLag : G.h), team: { id: '12', abbreviation: 'CAR', displayName: 'Carolina Hurricanes', shortDisplayName: 'Hurricanes' } }, { homeAway: 'away', score: String(G.a), team: { id: '13', abbreviation: 'NYR', displayName: 'New York Rangers', shortDisplayName: 'Rangers' } }] });
  page.on('request', req => {
    const u = req.url(), k = /99000\d/.test(u) ? kind(u) : null; if (!k) return req.continue();
    const reply = body => setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) }).catch(() => {}), 120);
    if (k === 'fast') { if (G.flap) { G.flap = false; const h = G.h; G.h = G.flapTo; const c = comp(); G.h = h; return reply({ id: '990009', competitions: [c] }); } if (G.fastErr) return req.respond({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }); return reply({ id: '990009', competitions: [comp()] }); }
    reply({ header: { competitions: [comp(true)] }, plays: [{ id: 'p' + G.a + G.h, text: 'play', type: { text: '' } }] });
  });
}
await page.goto(base + FILE, { waitUntil: 'load' });
await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current && typeof gcOpenEvent === 'function', { timeout: 90000 });
await page.evaluate(() => { arcadeNav.paused = true; });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const meta = LIVE ? (([sport, league, id]) => ({ sport, league, id, cid: league, key: 'live:' + id, label: league.toUpperCase(), state: 'in' }))(LIVE.split('/'))
                  : { sport: 'hockey', league: 'nhl', cid: 'nhl', id: '990009', key: 'test:990009', label: 'NHL', away: 'Rangers', home: 'Hurricanes', state: 'in' };

if (!LIVE) {
  const h0 = await heap();
  const t0 = Date.now(); await page.evaluate(m => gcOpenEvent(m), meta); await sleep(21000);
  let w = reqs.filter(r => r.t >= t0);
  const fg = gaps(w.filter(r => r.k === 'fast')), sg = gaps(w.filter(r => r.k === 'summary'));
  check('fast loop ~every 2 s while a live Gamecast is open (TV, 4x CPU)', fg.length >= 8 && med(fg) >= 1800 && med(fg) <= 2400, `n ${fg.length + 1}, median gap ${med(fg)} ms`);
  check('no change -> the full summary stays on its ~10 s cadence', sg.length >= 1 && sg.every(g => g >= 9500 && g <= 11500), `gaps ${sg.join(', ')}`);
  // a goal: summary within ~2.5 s of ESPN (mock) serving it
  const lo = await page.evaluate(() => gc.lastOk); const tg = Date.now(); G.h = 2;
  await page.waitForFunction(p => gc.lastOk !== p, { timeout: 6000 }, lo).catch(() => {});
  const sAt = reqs.filter(r => r.k === 'summary' && r.t >= tg)[0], dOk = (await page.evaluate(() => gc.lastOk)) - tg;
  const ev = await page.evaluate(() => (gc.events || []).slice(-1)[0]);
  check('a score change in the 2 s check pulls the full summary at once (summary within ~2.5 s of the change)', sAt && sAt.t - tg <= 2600 && dOk <= 3000 && ev && /CAR SCORES/.test(ev.txt), `summary +${sAt ? sAt.t - tg : '-'} ms, rendered +${dOk} ms, event ${ev && ev.txt}`);
  // the summary lags the scoreboard (seen live: ~3-7 s): follow-up summaries every 2 s until it shows the change
  await sleep(4000); G.hLag = 2; const fired0 = await page.evaluate(() => { cel.picks['nhl:12'] = 'Carolina Hurricanes'; settings.celebrate = true; settings.celebrateDelay = 0; if (cel.watch[gc.key]) cel.watch[gc.key].at = 0; return cel.fired; });
  const tl = Date.now(); G.h = 3; setTimeout(() => { G.hLag = null; }, 7000);
  await page.waitForFunction(f => cel.fired > f, { timeout: 9000 }, fired0).catch(() => {});
  const tCel = Date.now() - tl, celTxt = await page.evaluate(() => ({ text: cel.last && cel.last.text, sum: gc.sumSig }));
  check('a goal seen twice in a row by the 2 s check celebrates before the (lagging) summary has it', tCel <= 5500 && celTxt.text === 'GOAL!!' && /^1-2\|/.test(celTxt.sum), `celebrated +${tCel} ms, ${JSON.stringify(celTxt)}`);
  await page.evaluate(() => { try { celHide(true); } catch (e) {} cel.queue = []; delete cel.picks['nhl:12']; });
  await page.waitForFunction(() => gc.sumSig && /^1-3\|/.test(gc.sumSig), { timeout: 15000 }).catch(() => {});
  const fired1 = await page.evaluate(() => cel.fired); await sleep(1500);
  check('the summary catching up later does not celebrate again', (await page.evaluate(() => cel.fired)) === fired1 && fired1 === fired0 + 1, `fired ${fired0} -> ${fired1}`);
  const tSeen = Date.now() - tl, chaseReqs = reqs.filter(r => r.k === 'summary' && r.t >= tl).map(r => r.t - tl);
  await sleep(12500); const after = gaps(reqs.filter(r => r.k === 'summary' && r.t >= tl));
  check('summary behind the scoreboard -> re-checked every ~2 s until it shows the change, then back to ~10 s', tSeen <= 11000 && chaseReqs.length >= 3 && after.slice(-1)[0] >= 9000,
    `summary showed it +${tSeen} ms, summary requests at +${chaseReqs.slice(0, 5).join(', ')} ms, then gap ${after.slice(-1)[0]}`);
  // ESPN CDN edges flip back for a reply (seen live: 1-0 -> 0-0 -> 1-0): ignored, exactly one celebration
  const f2 = await page.evaluate(() => { cel.picks['nhl:12'] = 'Carolina Hurricanes'; if (cel.watch[gc.key]) cel.watch[gc.key].at = 0; return { fired: cel.fired, stale: gc.f.stale || 0 }; });
  G.h = 4; await page.waitForFunction(() => /^1-4/.test(gc.f.last.sc), { timeout: 5000 }).catch(() => {});
  G.flapTo = 3; G.flap = true; await sleep(9000);
  const f3 = await page.evaluate(() => ({ fired: cel.fired, stale: gc.f.stale || 0, events: gc.events.filter(e => /SCORES/.test(e.txt)).length, pending: cel.pending.length }));
  check('a stale reply (score back down for one poll) is ignored: one GOAL!!, no cancel, no second SCORES event', f3.fired === f2.fired + 1 && f3.stale > f2.stale, JSON.stringify({ f2, f3 }));
  await page.evaluate(() => { try { celHide(true); } catch (e) {} cel.queue = []; delete cel.picks['nhl:12']; });
  // errors -> backoff
  G.fastErr = true; const te = Date.now(); await sleep(16000);
  const eg = gaps(reqs.filter(r => r.k === 'fast' && r.t >= te));
  const fails1 = await page.evaluate(() => gc.f.fails);
  G.fastErr = false; await sleep(19000);
  const rec = await page.evaluate(() => ({ fails: gc.f.fails, upd: document.getElementById('gc-updated').textContent, gcf: gc.fails }));
  check('fast-loop errors back off (2 -> 4 -> 8 s ...) and recover; the summary keeps going', eg.length >= 2 && eg[1] > eg[0] * 1.6 && fails1 >= 2 && rec.fails === 0 && rec.gcf === 0, `gaps ${eg.join(', ')}, then ${JSON.stringify(rec)}`);
  // hidden -> paused
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const th = Date.now(); await sleep(12000); const hid = reqs.filter(r => r.t > th + 200).length;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  const tv = Date.now(); await sleep(3500); const back = reqs.filter(r => r.t >= tv);
  check('page hidden -> no requests at all; visible again -> both loops resume', hid === 0 && back.some(r => r.k === 'fast') && back.some(r => r.k === 'summary'), `hidden ${hid}, after ${back.map(r => r.k).join(',')}`);
  check('never more than one Gamecast request in flight (fast + summary)', maxInFlight <= 1, `max ${maxInFlight}`);
  // 2 more minutes for memory
  await sleep(60000);
  const h1 = await heap(); const w2 = reqs.filter(r => r.t >= t0);
  check('heap stable over ~2 min of fast polling (after GC)', h1 - h0 < 3e6, `${(h0 / 1e6).toFixed(1)} MB -> ${(h1 / 1e6).toFixed(1)} MB, ${w2.length} requests`);
  // final -> fast loop stops; close -> nothing
  G.state = 'post'; await sleep(7000); const tp = Date.now(); await sleep(6000);
  const postFast = reqs.filter(r => r.k === 'fast' && r.t > tp).length;
  check('final -> the fast loop stops (summary only)', postFast === 0, `fast after final ${postFast}`);
  await page.evaluate(() => gcClose()); const tc = Date.now(); await sleep(11000);
  check('close -> no requests', reqs.filter(r => r.t > tc + 100).length === 0);
} else {
  const h0 = await heap(); const t0 = Date.now();
  await page.evaluate(m => gcOpenEvent(m), meta);
  const log = []; let last = '';
  while (Date.now() - t0 < SECS * 1000) {
    await sleep(500);
    const s = await page.evaluate(() => ({ ev: (gc.events || []).map(e => e.at + ' ' + e.txt).slice(-1)[0] || '', clk: gc.f && gc.f.clk ? gc.f.clk.sec + (gc.f.clk.run ? ' run' : ' stop') : '-', hits: gc.f && gc.f.hits, st: gc.state, upd: document.getElementById('gc-updated').textContent }));
    if (s.ev !== last) { last = s.ev; if (s.ev) { const [at, ...t] = s.ev.split(' '); log.push(`${new Date(+at).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}  ${t.join(' ')}`); } }
  }
  const h1 = await heap(); const mins = (Date.now() - t0) / 60000;
  const sum = k => { const rs = reqs.filter(r => r.k === k && r.done); return { n: rs.length, perMin: (rs.length / mins).toFixed(1), avgKB: rs.length ? (rs.reduce((a, r) => a + r.bytes, 0) / rs.length / 1024).toFixed(1) : '-', totKB: (rs.reduce((a, r) => a + r.bytes, 0) / 1024).toFixed(0), avgMs: rs.length ? Math.round(rs.reduce((a, r) => a + r.done - r.t, 0) / rs.length) : '-' }; };
  const st = await page.evaluate(() => ({ hits: gc.f && gc.f.hits, n: gc.f && gc.f.n, state: gc.state, clk: gc.f && gc.f.clk, upd: document.getElementById('gc-updated').textContent, polls: gc.polls }));
  console.log('LIVE', LIVE, `${mins.toFixed(1)} min, TV emulation, 4x CPU`);
  console.log('fast   ', JSON.stringify(sum('fast')));
  console.log('summary', JSON.stringify(sum('summary')));
  console.log('state', JSON.stringify(st));
  console.log('heap', (h0 / 1e6).toFixed(1), 'MB ->', (h1 / 1e6).toFixed(1), 'MB (after GC)');
  console.log('events ESPN reported (as the fast loop / summary saw them):'); log.forEach(l => console.log('  ' + l));
  check('never more than one Gamecast request in flight (fast + summary)', maxInFlight <= 1, `max ${maxInFlight}`);
  check('heap stable (after GC)', h1 - h0 < 3e6, `${((h1 - h0) / 1e6).toFixed(2)} MB`);
}
check('0 console errors / page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); srv.close();
console.log(fails ? `${fails} check(s) FAILED` : 'PASS'); process.exit(fails ? 1 : 0);
