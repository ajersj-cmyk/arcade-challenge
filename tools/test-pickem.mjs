#!/usr/bin/env node
// FAMILY PICK'EM + PHONE REMOTE checks with local mocks (ESPN, ntfy.sh, picks.json).  node tools/test-pickem.mjs [preview.html]
//  two simulated phones (390x844): name sheet + limits, today's TOP 5 (deterministic rank, 6th game left out), picks + changes,
//  others' picks visible, lock at start (button disabled + a late pick published anyway is rejected), TV leaderboard (season
//  standings W-L/PCT/streak, picks per game, live/final colouring, QR) fits above the ticker at 720p + 1080p, settings QR,
//  remote round trip (next / board / Gamecast / close / celebration + ack back to the phone), household PIN, GitHub-Action
//  grading (scripts/pickem-sync.mjs) from fixture finals, "tomorrow" slate when today's 5 have all started, 0 console errors.
//  Screenshots in tools/out/<time>-pickem/.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url'; import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = process.env.PK_OUT || path.join(REPO, 'tools/out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-pickem');
fs.mkdirSync(OUT, { recursive: true });
const P = createRequire(import.meta.url)('../pickem-core.js');
const ROOM = 'test-room-' + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const NOW = Date.now(), iso = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z'), D0 = P.etDate(NOW), D1 = P.etDate(NOW, 1);
// ---------- fixtures
const T = (id, ab, name, rank, rec, lg = 'nfl', file) => ({ id: String(id), abbreviation: ab, shortDisplayName: name, displayName: name, logo: `https://a.espncdn.com/i/teamlogos/${lg}/500/${file || ab.toLowerCase()}.png`, color: '333333', rank, rec });
function ev(id, k, start, state, A, H, o = {}) {
  const st = { type: { state, completed: state === 'post', name: state === 'post' ? 'STATUS_FINAL' : state === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED', description: state, detail: o.detail || (state === 'post' ? 'Final' : state === 'in' ? '3rd 4:12' : 'Scheduled'), shortDetail: o.detail || (state === 'post' ? 'Final' : state === 'in' ? '3rd 4:12' : 'Scheduled') }, displayClock: '4:12', period: 3 };
  const C = (t, ha, sc, win) => ({ id: t.id, homeAway: ha, team: { id: t.id, abbreviation: t.abbreviation, shortDisplayName: t.shortDisplayName, displayName: t.displayName, name: t.shortDisplayName, logo: t.logo, color: t.color }, score: sc == null ? '0' : String(sc), winner: win, curatedRank: { current: t.rank || 99 }, records: [{ summary: t.rec || '3-2' }] });
  return { id: String(id), uid: 's:1~e:' + id, date: iso(start), name: A.displayName + ' at ' + H.displayName, shortName: A.abbreviation + ' @ ' + H.abbreviation, season: { year: 2026, type: o.post ? 3 : 2 }, status: st,
    competitions: [{ id: String(id), date: iso(start), status: st, competitors: [C(H, 'home', o.hs, o.hw), C(A, 'away', o.as, o.aw)], geoBroadcasts: o.net ? [{ type: { shortName: 'TV' }, market: { type: 'National' }, media: { shortName: o.net } }] : [], broadcasts: [], odds: o.spread != null ? [{ spread: o.spread, details: o.line || '' }] : [], notes: [], venue: { id: '1', fullName: 'Arena' } }] };
}
const BUF = T(2, 'BUF', 'Bills', 0, '4-1'), KC = T(12, 'KC', 'Chiefs', 0, '5-0'), UGA = T(61, 'UGA', 'Georgia', 2, '5-0', 'ncaa', '61'), ALA = T(333, 'ALA', 'Alabama', 6, '4-1', 'ncaa', '333');
const LAL = T(13, 'LAL', 'Lakers', 0, '1-0', 'nba'), BOS = T(2001, 'BOS', 'Celtics', 0, '1-0', 'nba'), CAR = T(7, 'CAR', 'Hurricanes', 0, '2-0', 'nhl'), NYR = T(13001, 'NYR', 'Rangers', 0, '1-1', 'nhl'),
  NYY = T(10, 'NYY', 'Yankees', 0, '94-68', 'mlb'), BSX = T(2002, 'BOS', 'Red Sox', 0, '90-72', 'mlb'), SJ = T(18, 'SJ', 'Sharks', 0, '0-2', 'nhl'), ANA = T(25, 'ANA', 'Ducks', 0, '1-1', 'nhl');
const G2_START = NOW + 45000;
const TODAY = {
  'football/nfl': [ev(401001, 'nfl', NOW + 40 * 60000, 'pre', BUF, KC, { net: 'CBS', spread: 2.5, line: 'KC -2.5' })],
  'football/college-football': [ev(401002, 'cfb', G2_START, 'pre', UGA, ALA, { net: 'ABC', spread: 1.5, line: 'UGA -1.5' })],
  'basketball/nba': [ev(401003, 'nba', NOW - 60 * 60000, 'in', LAL, BOS, { net: 'TNT', as: 50, hs: 48 })],
  'hockey/nhl': [ev(401004, 'nhl', NOW - 150 * 60000, 'post', CAR, NYR, { net: 'ESPN', as: 4, hs: 2, aw: true, hw: false }), ev(401006, 'nhl', NOW + 45 * 60000, 'pre', SJ, ANA, {})],
  'baseball/mlb': [ev(401005, 'mlb', NOW + 50 * 60000, 'pre', NYY, BSX, { net: 'TBS', post: true, spread: 1.5 })],
};
const TOMORROW = { 'football/nfl': [ev(402001, 'nfl', Date.parse(D1.slice(0, 4) + '-' + D1.slice(4, 6) + '-' + D1.slice(6) + 'T17:00:00Z'), 'pre', KC, BUF, { net: 'FOX' })] };
let allDone = false;
const finished = () => Object.fromEntries(Object.entries(TODAY).map(([k, l]) => [k, l.map(e => ev(e.id, '', Date.parse(e.date), 'post', { ...e.competitions[0].competitors[1].team, rank: 0 }, { ...e.competitions[0].competitors[0].team, rank: 0 }, { as: 1, hs: 0, aw: true }))]));
// ---------- picks.json (earlier in the season) + ntfy store
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-')), dataFile = path.join(dataDir, 'picks.json');
const old = (n, r) => ({ k: 'football/nfl', lg: 'NFL', d: iso(NOW - n * 86400000), a: { id: '2', ab: 'BUF' }, h: { id: '12', ab: 'KC' }, r, sc: '20-17', real: 1 });
fs.writeFileSync(dataFile, JSON.stringify({ v: 1, room: ROOM, season: '2026', updated: NOW - 3600000, lastMsg: '', names: { jordan: 'Jordan', alex: 'Alex' },
  events: { 1001: old(3, '2'), 1002: old(2, '12'), 1003: old(1, '12') },
  picks: { 1001: { jordan: { tm: '2', at: 1 }, alex: { tm: '12', at: 1 } }, 1002: { jordan: { tm: '12', at: 1 }, alex: { tm: '12', at: 1 } }, 1003: { jordan: { tm: '2', at: 1 }, alex: { tm: '12', at: 1 } } } }));
const topics = {}, subs = {}; let mid = 0;
function pub(topic, body, time) {
  const m = { id: 'm' + (++mid), time: Math.floor((time || Date.now()) / 1000), expires: 0, event: 'message', topic, message: body };
  (topics[topic] = topics[topic] || []).push(m); (subs[topic] || []).forEach(r => r.write('data: ' + JSON.stringify(m) + '\n\n')); return m;
}
const pickMsg = (n, e, tm, g, extra = {}) => JSON.stringify({ v: 1, t: 'pick', n, e: String(e), k: g.k, lg: g.lg, tm: String(tm), d: g.d, a: g.a, h: g.h, g: '', ...extra });
const G4 = { k: 'hockey/nhl', lg: 'NHL', d: iso(NOW - 150 * 60000), a: { id: '7', ab: 'CAR' }, h: { id: '13001', ab: 'NYR' } };
pub(ROOM + '-p', pickMsg('Jordan', 401004, 7, G4), NOW - 4 * 3600000);
pub(ROOM + '-p', pickMsg('Alex', 401004, 13001, G4), NOW - 4 * 3600000);
pub(ROOM + '-p', pickMsg('Alex', 401004, 7, G4), NOW - 60 * 60000); // after the start: must not count
pub(ROOM + '-p', pickMsg('Hacker', 999999, 1, { ...G4, d: iso(NOW + 9e9) }), NOW - 60000); // not a real ESPN event
// ---------- server
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' };
const srv = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x'), p = decodeURIComponent(u.pathname);
  if (q.method === 'OPTIONS') { s.writeHead(204, cors); return s.end(); }
  const json = (o, code = 200) => { s.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); s.end(JSON.stringify(o)); };
  let m;
  if ((m = /^\/ntfy\/([\w-]+)$/.exec(p)) && q.method === 'POST') { let b = ''; q.on('data', c => b += c); q.on('end', () => json(pub(m[1], b))); return; }
  if ((m = /^\/ntfy\/([\w-]+)\/json$/.exec(p))) { s.writeHead(200, { ...cors, 'Content-Type': 'application/x-ndjson' }); return s.end((topics[m[1]] || []).map(x => JSON.stringify(x)).join('\n') + '\n'); }
  if ((m = /^\/ntfy\/([\w-]+)\/sse$/.exec(p))) { s.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); s.write('event: open\ndata: {"event":"open"}\n\n'); (subs[m[1]] = subs[m[1]] || []).push(s); q.on('close', () => { subs[m[1]] = subs[m[1]].filter(x => x !== s); }); return; }
  if (p === '/data/picks.json') { s.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return s.end(fs.readFileSync(dataFile)); }
  if ((m = /^\/espn\/apis\/site\/v2\/sports\/([\w.-]+\/[\w.-]+)\/(scoreboard|summary|news)/.exec(p))) {
    const k = m[1], dates = u.searchParams.get('dates');
    if (m[2] === 'news') return json({ articles: [] });
    const src = allDone ? finished() : TODAY;
    if (m[2] === 'summary') { const e = Object.values(src).flat().find(x => x.id === u.searchParams.get('event')); if (!e) return json({ code: 404 }, 404); const c = e.competitions[0];
      return json({ header: { id: e.id, competitions: [{ ...c, date: e.date }] }, boxscore: {}, plays: [], drives: {}, format: {}, gameInfo: {} }); }
    if (dates === D1) return json({ events: TOMORROW[k] || [] });
    if (dates && dates !== D0) return json({ events: [] });
    return json({ events: src[k] || [] });
  }
  if (p.startsWith('/espn/')) return json({});
  const f = path.join(REPO, p); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); s.end(d); });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const OV = { ntfy: base + 'ntfy', data: base + 'data/picks.json', espn: base + 'espn/apis/site/v2/sports/', room: ROOM };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const errors = [];
const watch = (page, tag) => { page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|net::ERR/.test(m.text())) errors.push(tag + ' ' + m.text()); }); page.on('pageerror', e => errors.push(tag + ' PAGE ' + e)); };
async function phone(name, pin) {
  const pg = await browser.newPage(); watch(pg, 'phone-' + (name || 'new'));
  await pg.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await pg.emulateTimezone('America/New_York');
  await pg.evaluateOnNewDocument((ov, name) => { localStorage.setItem('ahlersPickemOverride', JSON.stringify(ov)); if (name) localStorage.setItem('arcadePickName', name); }, OV, name);
  await pg.goto(base + 'remote-pick.html#room=' + ROOM + (pin ? '&pin=' + pin : ''), { waitUntil: 'load' });
  await pg.waitForFunction(() => document.querySelectorAll('#picks .game').length > 0, { timeout: 30000 }).catch(() => {});
  return pg;
}
const cards = pg => pg.evaluate(() => [...document.querySelectorAll('#picks .game')].map(g => ({ id: g.id.slice(2), lock: [...g.querySelectorAll('.tm')].every(b => b.disabled), mine: (g.querySelector('.tm.mine .nm') || {}).textContent || '',
  who: [...g.querySelectorAll('.who > div')].map(d => [...d.querySelectorAll('.chip')].map(c => c.textContent + (c.classList.contains('ok') ? '+' : c.classList.contains('no') ? '-' : ''))), why: [...g.querySelectorAll('.why i')].map(i => i.textContent) })));
const tapTeam = (pg, e, side) => pg.evaluate((e, side) => document.querySelectorAll('#g-' + e + ' .tm')[side].click(), e, side);
const picksIn = () => (topics[ROOM + '-p'] || []).map(m => JSON.parse(m.message)).filter(m => m.t === 'pick');

// ===== phones
const p1 = await phone('', ''); // new phone: asks for a name
check('new phone: name sheet shows', await p1.evaluate(() => document.getElementById('sheet').classList.contains('on')));
await p1.evaluate(() => { document.getElementById('nm').value = 'ThisNameIsWayTooLongForUs'; saveName(); }); // (the field also stops typing at 14)
check('name > 14 chars refused', await p1.evaluate(() => document.getElementById('sheet').classList.contains('on') && /1-14/.test(document.getElementById('nm-err').textContent)));
await p1.evaluate(() => { document.getElementById('nm').value = ''; }); await p1.type('#nm', 'Jordan'); await p1.evaluate(() => saveName());
check('name saved on the phone', await p1.evaluate(() => localStorage.getItem('arcadePickName') === 'Jordan' && document.getElementById('me').textContent === 'Jordan'));
let c1 = await cards(p1);
check('TOP 5 slate: 5 games, the 6th (no national TV) left out', c1.length === 5 && !c1.some(c => c.id === '401006'), c1.map(c => c.id).join(','));
const exp = P.sortGames(Object.entries(TODAY).flatMap(([k, l]) => l.map(e => P.parseEvent(e, P.LEAGUES.find(L => L.k === k))))).slice(0, 5).map(g => g.id);
check('order = deterministic rank (pickem-core rankGame)', c1.map(c => c.id).join() === exp.join(), exp.join());
check('"why" chips explain the rank', c1.find(c => c.id === '401002').why.includes('RANKED MATCHUP') && c1.find(c => c.id === '401001').why.some(w => /NATIONAL TV · CBS/.test(w)), JSON.stringify(c1.find(c => c.id === '401002').why));
check('started/final games are locked, upcoming are open', c1.find(c => c.id === '401003').lock && c1.find(c => c.id === '401004').lock && !c1.find(c => c.id === '401001').lock);
const p2 = await phone('Alex', '');
await tapTeam(p1, '401001', 0); await sleep(300); await tapTeam(p1, '401002', 0); await sleep(300); await tapTeam(p2, '401001', 1); await sleep(1800);
check('picks published to ntfy (Jordan BUF + UGA, Alex KC)', picksIn().filter(m => m.e === '401001' || m.e === '401002').length === 3, picksIn().length);
await p2.evaluate(() => refresh(false)); await sleep(800);
let c2 = await cards(p2);
check("Alex's phone shows Jordan's pick + his own", JSON.stringify(c2.find(c => c.id === '401001').who) === JSON.stringify([['Jordan'], ['Alex']]) && c2.find(c => c.id === '401001').mine === 'Chiefs', JSON.stringify(c2.find(c => c.id === '401001')));
check('final game shows who got it right', JSON.stringify(c2.find(c => c.id === '401004').who) === JSON.stringify([['Jordan+'], ['Alex-']]), JSON.stringify(c2.find(c => c.id === '401004').who));
await tapTeam(p1, '401001', 1); await sleep(1500); await p1.evaluate(() => refresh(false)); await sleep(800); c1 = await cards(p1);
check('changing a pick before the start: latest wins', c1.find(c => c.id === '401001').mine === 'Chiefs' && JSON.stringify(c1.find(c => c.id === '401001').who) === JSON.stringify([[], ['Jordan', 'Alex']]), JSON.stringify(c1.find(c => c.id === '401001').who));
await p1.screenshot({ path: path.join(OUT, 'phone-picks.png') });
// lock
const wait = G2_START - Date.now() + 1500; if (wait > 0) await sleep(wait);
await p2.evaluate(() => refresh(true)); await sleep(1500); c2 = await cards(p2);
check('game start passed: buttons locked on the phone', c2.find(c => c.id === '401002').lock);
await p2.evaluate(() => Pickem.publish(Pickem.ROOM + '-p', { v: 1, t: 'pick', n: 'Alex', e: '401002', k: 'football/college-football', lg: 'CFB', tm: '333', d: new Date(Date.now() + 3600000).toISOString(), a: { id: '61', ab: 'UGA' }, h: { id: '333', ab: 'ALA' }, g: '' }));
await sleep(500); await p2.evaluate(() => refresh(false)); await sleep(800); c2 = await cards(p2);
check('late pick published anyway (fake start time) is rejected', JSON.stringify(c2.find(c => c.id === '401002').who) === JSON.stringify([['Jordan'], []]), JSON.stringify(c2.find(c => c.id === '401002').who));
await p2.evaluate(() => tab('board')); await sleep(300);
const board = await p2.evaluate(() => [...document.querySelectorAll('#board tr')].slice(1).map(r => [...r.children].map(td => td.textContent).join(' ')));
check('phone standings: Jordan 3-1 (L→W streak) above Alex 2-2', board[0] === '1 Jordan 3-1 .750 W1' && board[1] === '2 Alex 2-2 .500 L1', JSON.stringify(board));
await p2.screenshot({ path: path.join(OUT, 'phone-standings.png') });

// ===== TV
async function tv(w, h, extra) {
  const pg = await browser.newPage(); watch(pg, 'tv' + w);
  await pg.setUserAgent(ua); await pg.setViewport({ width: w, height: h }); await pg.emulateTimezone('America/New_York');
  await pg.evaluateOnNewDocument((ov, apiBase, extra) => { localStorage.setItem('ahlersPickemOverride', JSON.stringify(ov)); localStorage.removeItem('ahlersSportMode1');
    const s = JSON.parse(localStorage.getItem('ahlersArcadeSettings') || '{}'); s.apiBase = apiBase; Object.assign(s, extra || {}); localStorage.setItem('ahlersArcadeSettings', JSON.stringify(s)); }, OV, base + 'espn/apis', extra);
  await pg.goto(base + FILE, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 90000 });
  await pg.evaluate(() => { arcadeNav.paused = false; navGoTo('pickem'); arcadeNav.paused = true; });
  await pg.waitForFunction(() => document.getElementById('pickem-screen').style.display === 'flex' && document.querySelector('#pk-stage .pk-games'), { timeout: 30000 }).catch(() => {});
  await sleep(1500); return pg;
}
const tvState = pg => pg.evaluate(() => { const r = s => document.querySelector(s) && document.querySelector(s).getBoundingClientRect();
  return { rows: [...document.querySelectorAll('.pk-row:not(.hd)')].map(x => [...x.children].map(c => c.textContent).join(' ')), games: [...document.querySelectorAll('.pk-g')].map(g => ({ cls: g.className, sides: [...g.querySelectorAll('.pk-side')].map(s => s.className + ':' + [...s.querySelectorAll('.pk-c')].map(c => c.textContent + (c.classList.contains('ok') ? '+' : c.classList.contains('no') ? '-' : c.classList.contains('up') ? '^' : '')).join('|')) })),
    qr: (document.querySelector('.pk-qr img') || {}).src || '', stage: r('#pk-stage').bottom, ticker: r('#sports-ticker').top, glBottom: Math.max(...[...document.querySelectorAll('.pk-g, .pk-row, .pk-qr')].map(e => e.getBoundingClientRect().bottom)),
    overflow: [...document.querySelectorAll('.pk-gl, .pk-st')].some(e => e.scrollHeight > e.clientHeight + 2), header: document.querySelector('#pickem-screen .screen-header').textContent, current: arcadeNav.current }; });
const t1 = await tv(1280, 720);
let ts = await tvState(t1);
check('TV: FAMILY PICK\'EM slide shows', ts.current === 'pickem' && /PICK'EM/.test(ts.header), ts.current);
check('TV standings: Jordan 3-1 .750 W1, Alex 2-2 .500 L1', ts.rows[0] === '1 Jordan 3-1 .750 W1' && ts.rows[1] === '2 Alex 2-2 .500 L1', JSON.stringify(ts.rows));
check('TV: 5 games with everyone\'s picks', ts.games.length === 5 && ts.games.some(g => g.sides[1] && /Jordan\|Alex/.test(g.sides[1])), JSON.stringify(ts.games.map(g => g.sides)));
const fin = ts.games.find(g => /fin/.test(g.cls)), live = ts.games.find(g => /live/.test(g.cls));
check('TV: final game colours right/wrong picks', fin && /win:Jordan\+/.test(fin.sides[0]) && /lose:Alex-/.test(fin.sides[1]), fin && fin.sides.join(' / '));
check('TV: live game row marked live', !!live, ts.games.map(g => g.cls).join(','));
check('TV: QR opens remote-pick.html with the room code', /remote-pick\.html%23room%3D/.test(ts.qr), ts.qr.slice(0, 160));
check('TV: fits above the ticker at 720p, nothing clipped', ts.glBottom <= ts.ticker && ts.stage <= ts.ticker && !ts.overflow, `${ts.glBottom}/${ts.stage} vs ${ts.ticker} overflow=${ts.overflow}`);
await sleep(3500); await t1.evaluate(() => { document.getElementById('nav-hud').classList.remove('show'); });
await t1.screenshot({ path: path.join(OUT, 'tv-pickem-720.png') });
await t1.evaluate(() => toggleSettings()); await sleep(400);
check('settings QR = phone remote + pick\'em page', await t1.evaluate(() => /remote-pick\.html/.test(decodeURIComponent(document.getElementById('settings-qr').src)) && !!document.getElementById('set-pickem') && !!document.getElementById('set-phoneRemote')));
await t1.evaluate(() => toggleSettings());
// ===== remote round trip
await t1.waitForFunction(() => pk.es && pk.es.readyState === 1, { timeout: 15000 }).catch(() => {});
await p1.evaluate(() => tab('remote')); await sleep(800);
const before = await t1.evaluate(() => arcadeNav.current);
await p1.evaluate(() => cmd('next')); await sleep(2500);
const after = await t1.evaluate(() => arcadeNav.current), ack = await p1.evaluate(() => document.getElementById('rstat').textContent);
check('remote NEXT: TV moves on + phone gets the ack', before === 'pickem' && after !== 'pickem' && /TV ✓/.test(ack), `${before} -> ${after}, "${ack}"`);
await p1.evaluate(() => cmd('prev')); await sleep(2000);
check('remote PREV: back to the pick\'em board', (await t1.evaluate(() => arcadeNav.current)) === 'pickem');
await p1.evaluate(() => cmd('next')); await sleep(1500); await p1.evaluate(() => cmd('board')); await sleep(2000);
check('remote PICK\'EM BOARD jumps to the slide', (await t1.evaluate(() => arcadeNav.current)) === 'pickem');
await p1.evaluate(() => openGc('401003')); await sleep(2500);
const g1 = await t1.evaluate(() => ({ open: gc.open, id: gc.meta && gc.meta.id })), ack2 = await p1.evaluate(() => document.getElementById('rstat').textContent);
check('remote Gamecast: TV opens LAL @ BOS', g1.open && g1.id === '401003' && /GAMECAST LAL @ BOS/.test(ack2), JSON.stringify(g1) + ' ' + ack2);
await t1.screenshot({ path: path.join(OUT, 'tv-gamecast-from-phone.png') });
await p1.evaluate(() => cmd('close')); await sleep(2000);
check('remote CLOSE: Gamecast closed', !(await t1.evaluate(() => gc.open)));
await p1.evaluate(() => cmd('cel')); await sleep(1500);
check('remote CELEBRATE: test celebration plays', await t1.evaluate(() => document.getElementById('celebrate').classList.contains('show')));
await p1.screenshot({ path: path.join(OUT, 'phone-remote.png') });
await sleep(6000);
// PIN
await t1.evaluate(() => { settings.pickemPin = '4321'; }); const cur0 = await t1.evaluate(() => arcadeNav.current);
await p1.evaluate(() => cmd('next')); await sleep(2000);
check('PIN set on the TV: command without the PIN ignored', (await t1.evaluate(() => arcadeNav.current)) === cur0);
await p1.evaluate(() => { S.pin = '4321'; cmd('next'); }); await sleep(2000);
check('…and accepted with the PIN', (await t1.evaluate(() => arcadeNav.current)) !== cur0);
await t1.evaluate(() => { settings.pickemPin = ''; });
// replay protection: an old command (e.g. after a reconnect) does nothing
const cur1 = await t1.evaluate(() => arcadeNav.current);
await t1.evaluate(() => pkCommand({ t: 'cmd', c: 'next', id: 'old1' }, Date.now() - 5 * 60000)); await sleep(500);
check('stale command (5 min old) ignored', (await t1.evaluate(() => arcadeNav.current)) === cur1);
await t1.close();
// 1080p + TV app
const t2 = await tv(1920, 1080, {}); await t2.evaluate(() => { window.ArcadeTV = window.ArcadeTV || {}; });
ts = await tvState(t2);
check('TV: fits above the ticker at 1080p', ts.glBottom <= ts.ticker && !ts.overflow, `${ts.glBottom} vs ${ts.ticker}`);
await sleep(3500); await t2.evaluate(() => { document.getElementById('nav-hud').classList.remove('show'); });
await t2.screenshot({ path: path.join(OUT, 'tv-pickem-1080.png') });
check('TV: pick\'em slide holds 20 s then rotates on', await t2.evaluate(async () => { arcadeNav.paused = false; navGoTo('pickem'); const t0 = Date.now(); while (arcadeNav.current === 'pickem' && Date.now() - t0 < 26000) await new Promise(r => setTimeout(r, 250)); const d = Date.now() - t0; return d > 18500 && d < 25000 ? true : d; }));
await t2.close();
// remote off in settings: no ntfy connection
const t3 = await tv(1280, 720, { phoneRemote: false }); await sleep(5000);
check('Phone Remote off: no command channel opened', await t3.evaluate(() => !pk.es));
await t3.close();
// ===== grading by the GitHub Action script
const env = { ...process.env, PICKEM_NTFY: OV.ntfy, PICKEM_ESPN: OV.espn, PICKEM_ROOM: ROOM };
const run = async () => (await promisify(execFile)('node', [path.join(REPO, 'scripts/pickem-sync.mjs'), dataFile], { env, encoding: 'utf8' })).stdout;
const log = await run();
const D = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
check('sync: CAR-NYR graded from the ESPN final (Jordan right, Alex wrong)', D.events['401004'] && D.events['401004'].r === '7' && D.picks['401004'].jordan.tm === '7' && D.picks['401004'].alex.tm === '13001', JSON.stringify(D.picks['401004']));
check('sync: Alex\'s late UGA/ALA pick and the fake event are dropped', !D.picks['401002'].alex && D.picks['401002'].jordan && !D.events['999999'] && !D.names.hacker, JSON.stringify(D.picks['401002']));
check('sync: season standings persist (Jordan 3-1 W1, Alex 2-2 L1)', /Jordan\s+3-1\s+\.750\s+W1/.test(log) && /Alex\s+2-2\s+\.500\s+L1/.test(log), log.trim().split('\n').join(' | '));
const log2 = await run();
check('sync: second run with nothing new = no change (no empty commits)', /no change/.test(log2), log2.split('\n')[0]);
// ===== tomorrow's slate once today's 5 have all started
allDone = true;
global.localStorage = undefined; const Pn = createRequire(import.meta.url)('../pickem-core.js'); Pn.ESPN = OV.espn;
const sl = await Pn.loadSlates(Date.now());
check("all of today's TOP 5 started/final: tomorrow's slate is used", sl.tomorrow && sl.tomorrow.games.length === 1 && sl.tomorrow.date === D1, JSON.stringify(sl.tomorrow && sl.tomorrow.games.map(g => g.id)));
const p3 = await phone('Jordan', ''); await sleep(500);
const hd = await p3.evaluate(() => [...document.querySelectorAll('#picks .sub')].map(s => s.textContent));
check('phone: TOMORROW\'S TOP first, today\'s results below', /TOMORROW'S TOP 1/.test(hd[0]) && /TODAY'S RESULTS/.test(hd[1] || ''), JSON.stringify(hd));
check('0 console errors (TV + phones)', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close(); srv.close(); fs.rmSync(dataDir, { recursive: true, force: true });
console.log('screenshots: ' + OUT);
console.log(fails ? `${fails} check(s) FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
