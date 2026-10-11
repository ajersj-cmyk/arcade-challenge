#!/usr/bin/env node
// "Delay everything to match my TV" checks (run from repo root):  node tools/test-tvdelay.mjs [preview.html] [--mem-secs 180]
// TV emulation (window.ArcadeTV, 1280x720, 4x CPU). A mocked live game is served from a REAL ESPN summary (any recent NHL /
// MLB game, fetched once; header score/status rewritten per request), plus a mocked 2 s scoreboard/{id} check.
//   1. open with a 12 s TV delay: no score/clock until the TV gets there (SYNCING badge), then the oldest snapshot + TV DELAY badge
//   2. a goal: the summary arrives at once but the score, plays, box score stay behind until arrival + 12 s
//   3. the celebration fires at TV time once (not delay twice), and the DOM changes at about the same moment
//   4. DELAY ALL off (sync overlay button + Settings checkbox) -> live again, celebrations back on the old delayed path
//   5. memory: 30 s delay, MLB summary (~700 KB) changing every 10 s, a few minutes; heap after GC vs. DELAY ALL off; buffer caps
// Screenshots in tools/out/<ts>-tvdelay/.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const FILE = args.find(a => /\.html$/.test(a)) || 'preview.html';
const MEM_SECS = args.includes('--mem-secs') ? +args[args.indexOf('--mem-secs') + 1] : 180;
const OUT = path.join(REPO, 'tools', 'out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-tvdelay'); fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

// ---- real ESPN summaries to serve (any game; status/score are rewritten)
async function realSummary(sport, league) {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`)).json();
  const ev = (sb.events || []).sort((a, b) => ({ in: 0, post: 1, pre: 2 }[a.status.type.state] - { in: 0, post: 1, pre: 2 }[b.status.type.state]))[0];
  const raw = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${ev.id}`)).text();
  return { raw, id: ev.id, name: ev.shortName };
}
const SRC = { nhl: await realSummary('hockey', 'nhl'), mlb: await realSummary('baseball', 'mlb') };
console.log(`serving real summaries: NHL ${SRC.nhl.name} (${(SRC.nhl.raw.length / 1024).toFixed(0)} KB), MLB ${SRC.mlb.name} (${(SRC.mlb.raw.length / 1024).toFixed(0)} KB)`);
const G = { lg: 'nhl', a: 1, h: 1, per: 2, sec: 15 * 60, t0: Date.now(), state: 'in' };
const clk = () => { const s = Math.max(60, Math.floor(G.sec - (Date.now() - G.t0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function summaryBody() {
  const d = JSON.parse(SRC[G.lg].raw), c = d.header.competitions[0];
  c.status = { period: G.per, displayClock: clk(), type: { state: G.state, name: G.state === 'post' ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS', completed: G.state === 'post', detail: G.state === 'post' ? 'Final' : clk() + ' - 2nd', shortDetail: G.state === 'post' ? 'Final' : clk() + ' - 2nd' } };
  c.competitors.forEach(x => { x.score = String(x.homeAway === 'home' ? G.h : G.a); });
  return JSON.stringify(d);
}
const fastBody = () => JSON.stringify({ id: '990009', competitions: [{ status: { period: G.per, displayClock: clk(), type: { state: G.state, name: 'STATUS_IN_PROGRESS', detail: '2nd' } },
  competitors: [{ homeAway: 'home', score: String(G.h), team: { id: '1', abbreviation: 'HOM' } }, { homeAway: 'away', score: String(G.a), team: { id: '2', abbreviation: 'AWY' } }] }] });

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--enable-precise-memory-info'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const page = await browser.newPage();
await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: 1280, height: 720 });
await page.evaluateOnNewDocument(() => { window.ArcadeTV = {}; try { localStorage.removeItem('ahlersArcadeTvDelay'); } catch (e) {} });
const isNoise = t => /Failed to load resource/.test(t) || /favicon/.test(t);
const errors = []; page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
const sumAt = [];
await page.setRequestInterception(true);
page.on('request', req => {
  const u = req.url(); if (!/990009/.test(u)) return req.continue();
  const fast = /\/scoreboard\/990009/.test(u), body = fast ? fastBody() : summaryBody();
  if (!fast) sumAt.push({ t: Date.now(), h: G.h, a: G.a });
  setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body }).catch(() => {}), 150);
});
const cdp = await page.target().createCDPSession(); await cdp.send('HeapProfiler.enable');
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await sleep(300); await cdp.send('HeapProfiler.collectGarbage'); await sleep(300); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
const shot = async name => { const p = path.join(OUT, name + '.png'); await page.screenshot({ path: p }); console.log('      shot ' + p); return p; };

await page.goto(base + FILE, { waitUntil: 'load' });
await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current && typeof gcDeOn === 'function', { timeout: 90000 });
await page.evaluate(() => { arcadeNav.paused = true; settings.celebrate = true; settings.celebrateDelay = 12; settings.tvDelayAll = true; });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const meta = lg => lg === 'nhl' ? { sport: 'hockey', league: 'nhl', cid: 'nhl', id: '990009', key: 'test:990009', label: 'NHL', away: 'Away', home: 'Home', state: 'in', aScore: '9', hScore: '9', status: '19:59 - 2nd' }
                                : { sport: 'baseball', league: 'mlb', cid: 'mlb', id: '990009', key: 'test:990009', label: 'MLB', away: 'Away', home: 'Home', state: 'in', aScore: '9', hScore: '9', status: 'Top 9th' };
const view = () => page.evaluate(() => {
  const sc = s => { const e = document.querySelector('#gc-' + s + ' .gc-score'); return e ? e.textContent.replace(/[^\d-]/g, '') : null; };
  const b = document.getElementById('gc-tvd');
  return { a: sc('away'), h: sc('home'), mid: document.getElementById('gc-mid').textContent.replace(/\s+/g, ' ').trim().slice(0, 80), badge: b && !b.hidden ? b.textContent : '',
    dq: gc.dq.length, sz: gc.dq.reduce((n, s) => n + (s.html ? s.sz || 0 : 0), 0), fired: cel.fired, last: cel.last && cel.last.text, shown: gc.deShown, plays: (document.getElementById('gc-plays-body').textContent || '').slice(0, 40) };
});

// ===== 1. open: syncing state, then the oldest snapshot at arrival + 12 s
await page.evaluate(m => { gcOpenEvent(m); }, meta('nhl'));
const tOpen = Date.now();
await sleep(1500);
let v = await view();
check('open (live, 12 s TV delay): no score or clock before the TV gets there', v.h === '-' && v.a === '-' && /SYNCING TO YOUR TV/.test(v.mid) && !/9/.test(v.h + v.a), JSON.stringify(v));
check('badge says SYNCING TO YOUR TV', /SYNCING TO YOUR TV/.test(v.badge), v.badge);
await shot('01-open-syncing');
const first = sumAt[0];
await page.waitForFunction(() => !!gc.deShown, { timeout: 20000 }).catch(() => {});
const tShown = Date.now(); v = await view();
check('first snapshot shows at arrival + 12 s (not before)', first && tShown - first.t >= 11500 && tShown - first.t <= 13800 && v.h === '1' && v.a === '1', `${first ? tShown - first.t : '-'} ms after it arrived, ${v.a}-${v.h}`);
check('badge then says TV DELAY 12s', /TV DELAY 12s/.test(v.badge), v.badge);
await page.evaluate(() => { cel.picks['nhl:' + gc.celT[1].ck.split(':')[1]] = 'Home'; }); // ★ the home team

// ===== 2. a goal: arrives at once, shown 12 s later; one celebration at TV time
await sleep(3000);
const f0 = (await view()).fired;
G.h = 2; const tg = Date.now();
await page.waitForFunction(() => gc.f && gc.f.last && /-2$/.test(gc.f.last.sc), { timeout: 6000 }).catch(() => {});
const tSeen = Date.now();
await sleep(3500);
const sumGot = sumAt.find(x => x.t >= tg && x.h === 2);
v = await view();
check('the goal reaches the page right away (2 s check + summary pulled at once)', tSeen - tg <= 2600 && sumGot && sumGot.t - tg <= 3500, `seen +${tSeen - tg} ms, summary +${sumGot ? sumGot.t - tg : '-'} ms`);
check('...but the Gamecast still shows the old score (no spoiler)', v.h === '1' && /TV DELAY/.test(v.badge), `${v.a}-${v.h}, ${v.dq} waiting`);
await shot('02-delayed-goal-not-shown-yet');
await page.waitForFunction(f => cel.fired > f, { timeout: 20000 }, f0).catch(() => {});
const tCel = Date.now(); v = await view();
const dCel = tCel - tSeen;
check('celebration fires once at TV time (~12 s after ESPN, not 24 s)', v.fired === f0 + 1 && dCel >= 9500 && dCel <= 14500, `+${dCel} ms after the 2 s check saw it (${v.last})`);
await page.waitForFunction(() => { const e = document.querySelector('#gc-home .gc-score'); return e && /2/.test(e.textContent); }, { timeout: 8000 }).catch(() => {});
const tDom = Date.now();
check('the Gamecast score changes at about the same moment as the celebration', Math.abs(tDom - tCel) <= 3500 && tDom - tSeen >= 9500, `score +${tDom - tSeen} ms, celebration +${dCel} ms`);
await page.evaluate(() => { try { celHide(true); } catch (e) {} });
await sleep(14000);
v = await view();
check('no second celebration later (summary + 2 s check replayed, delay not applied twice)', v.fired === f0 + 1, `fired ${v.fired - f0}`);
await shot('03-delayed-gamecast-badge');
// ESPN takes a goal back before the TV gets there: no celebration (the old 'correction cancels the queued effect')
const fc = (await view()).fired; G.h = 3; await sleep(5000); G.h = 2;
await sleep(17000);
v = await view();
check('a goal corrected before the TV gets there never celebrates; the score ends back at 2', v.fired === fc && v.h === '2', `fired ${v.fired - fc}, shown ${v.a}-${v.h}`);

// ===== 3. per-channel memory + DELAY ALL toggle in the sync overlay
await page.evaluate(() => gsOpen()); await sleep(600);
const gsAll = await page.evaluate(() => document.getElementById('gs-all').textContent);
check('sync overlay has the DELAY ALL toggle (ON by default)', /DELAY ALL: ON/.test(gsAll), gsAll);
await shot('04-sync-overlay-toggle');
await page.evaluate(() => gsNudge(1)); await sleep(400);
v = await view();
check('fine-tune in the overlay changes the badge (per-channel delay)', /TV DELAY 13s/.test(v.badge) && (await page.evaluate(() => Object.values(tvd.nets).indexOf(13) >= 0)), v.badge);
await page.evaluate(() => gsNudge(-1));
await page.click('#gs-all'); await sleep(500);
v = await view();
const offState = await page.evaluate(() => ({ s: settings.tvDelayAll, cb: document.getElementById('set-tvDelayAll').checked, btn: document.getElementById('gs-all').textContent, saved: JSON.parse(localStorage.getItem('ahlersArcadeSettings') || '{}').tvDelayAll }));
check('DELAY ALL off: setting + Settings checkbox + saved, badge gone, nothing waiting', offState.s === false && !offState.cb && offState.saved === false && /OFF/.test(offState.btn) && !v.badge && v.dq === 0, JSON.stringify({ ...offState, badge: v.badge, dq: v.dq }));
await page.evaluate(() => gsClose());
await sleep(9000); // past the 20 s per-game debounce of the first goal
const f1 = (await view()).fired; G.h = 3; const tg2 = Date.now();
await page.waitForFunction(() => { const e = document.querySelector('#gc-home .gc-score'); return e && /3/.test(e.textContent); }, { timeout: 8000 }).catch(() => {});
const tDom2 = Date.now();
await page.waitForFunction(f => cel.fired > f, { timeout: 20000 }, f1).catch(() => {});
const tCel2 = Date.now();
check('DELAY ALL off: Gamecast live again, celebration still waits the delay (old behaviour)', tDom2 - tg2 <= 4500 && tCel2 - tg2 >= 10500 && tCel2 - tg2 <= 15500, `score +${tDom2 - tg2} ms, celebration +${tCel2 - tg2} ms`);
await page.evaluate(() => { try { celHide(true); } catch (e) {} });
// Settings checkbox turns it back on
await page.evaluate(() => { const c = document.getElementById('set-tvDelayAll'); c.checked = true; c.dispatchEvent(new Event('change')); });
check('Settings checkbox turns it back on', await page.evaluate(() => settings.tvDelayAll === true && gcDeOn()));
// final: the WIN celebration comes at TV time
await sleep(21000); // past the debounce / previous celebration
const fw = (await view()).fired; G.state = 'post'; const tw = Date.now(); // home already ahead
await page.waitForFunction(f => cel.fired > f && /WIN/.test(cel.last && cel.last.text || ''), { timeout: 40000 }, fw).catch(() => {});
const tWin = Date.now(), winSum = sumAt.find(x => x.t >= tw);
v = await view();
check('final -> WIN celebration at TV time (arrival + 12 s), not before', /WIN/.test(v.last || '') && winSum && tWin - winSum.t >= 11000 && tWin - winSum.t <= 14500, `${v.last}, +${winSum ? tWin - winSum.t : '-'} ms after the final arrived`);
await page.evaluate(() => { try { celHide(true); } catch (e) {} });
await page.evaluate(() => gcClose()); await sleep(500);
check('close: buffer emptied, badge hidden', await page.evaluate(() => gc.dq.length === 0 && document.getElementById('gc-tvd').hidden));
// a pre-game Gamecast is never held back
G.state = 'pre';
await page.evaluate(m => gcOpenEvent(Object.assign({}, m, { state: 'pre' })), meta('nhl'));
await page.waitForFunction(() => gc.lastOk > 0, { timeout: 8000 }).catch(() => {}); await sleep(600);
check('pre-game: rendered at once, no badge', await page.evaluate(() => !!gc.deShown && gc.dq.length === 0 && document.getElementById('gc-tvd').hidden));
await page.evaluate(() => gcClose()); G.state = 'in';

// ===== 4. memory: 30 s delay, MLB (~700 KB summary), changes every ~10 s
async function memRun(all) {
  G.lg = 'mlb'; G.a = 0; G.h = 0;
  await page.evaluate(a => { settings.tvDelayAll = a; settings.celebrateDelay = 30; tvd.nets = {}; }, all);
  const h0 = await heap();
  await page.evaluate(m => gcOpenEvent(m), meta('mlb'));
  const t0 = Date.now(); let maxDq = 0, maxSz = 0, n = 0;
  const bump = setInterval(() => { n++; if (n % 2) G.a++; else G.h++; }, 10000);
  while (Date.now() - t0 < MEM_SECS * 1000) { await sleep(5000); const s = await page.evaluate(() => ({ dq: gc.dq.length, sz: gc.dq.reduce((x, s) => x + (s.html ? s.sz || 0 : 0), 0) })); maxDq = Math.max(maxDq, s.dq); maxSz = Math.max(maxSz, s.sz); }
  clearInterval(bump);
  const h1 = await heap(); const st = await view();
  await page.evaluate(() => gcClose()); const h2 = await heap();
  return { h0, h1, h2, maxDq, maxSz, polls: await page.evaluate(() => gc.polls), shown: `${st.a}-${st.h}`, real: `${G.a}-${G.h}` };
}
const mb = x => (x / 1048576).toFixed(1) + ' MB';
const on = await memRun(true);
const off = await memRun(false);
console.log(`      memory (${MEM_SECS}s, MLB, 30 s delay): DELAY ALL on  heap ${mb(on.h0)} -> ${mb(on.h1)} open -> ${mb(on.h2)} closed; max ${on.maxDq} waiting, ${(on.maxSz / 1024).toFixed(0)} KB new HTML; shown ${on.shown} vs real ${on.real}`);
console.log(`                                             DELAY ALL off heap ${mb(off.h0)} -> ${mb(off.h1)} open -> ${mb(off.h2)} closed`);
check('memory: buffer stays small (<= 40 snapshots, < 1.5 M chars of new HTML)', on.maxDq <= 40 && on.maxSz < 1500000, `max ${on.maxDq} waiting, ${(on.maxSz / 1024).toFixed(0)} KB`);
check('memory: heap with DELAY ALL on within 3 MB of off, and released on close', on.h1 - off.h1 < 3 * 1048576 && on.h2 - on.h0 < 1.5 * 1048576, `on ${mb(on.h1)} vs off ${mb(off.h1)}; after close ${mb(on.h2)} vs before ${mb(on.h0)}`);
check('memory run: display behind the real score (30 s delay working)', on.shown !== on.real, `shown ${on.shown}, real ${on.real}`);
check('0 console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${fails} failure(s). Screenshots in ${OUT}`);
await browser.close(); srv.close(); process.exit(fails ? 1 : 0);
