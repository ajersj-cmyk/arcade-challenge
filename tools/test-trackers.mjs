#!/usr/bin/env node
// Gamecast field + strike-zone trackers against real ESPN dumps (or fixtures).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = path.join(REPO, 'tools/out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-trackers');
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => {
  const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); s.end(d); });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
await page.setViewport({ width: 1920, height: 1080 });
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|tailwind|404/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGE ' + e));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };

await page.goto(base + FILE, { waitUntil: 'load' });
await page.waitForFunction(() => typeof gcTrackHtml === 'function' && typeof gcFieldHtml === 'function' && typeof gcStrikeHtml === 'function', { timeout: 60000 });

// Minimal mocked football summary
const mockNfl = {
  header: { competitions: [{ status: { type: { state: 'in', detail: '2nd 5:00', shortDetail: '2nd 5:00' }, period: 2, displayClock: '5:00' },
    competitors: [
      { homeAway: 'away', score: '7', team: { id: '11', abbreviation: 'IND', displayName: 'Colts', color: '003b75', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ind.png' } },
      { homeAway: 'home', score: '3', team: { id: '28', abbreviation: 'WSH', displayName: 'Commanders', color: '5a1414', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png' } }] }] },
  drives: { current: { team: { id: '11', abbreviation: 'IND' }, start: { yardLine: 25, yardsToEndzone: 75 },
    plays: [
      { start: { down: 1, distance: 10, yardsToEndzone: 75 }, end: { down: 2, distance: 5, yardsToEndzone: 70, shortDownDistanceText: '2nd & 5' } },
      { start: { down: 2, distance: 5, yardsToEndzone: 70 }, end: { down: 1, distance: 10, yardsToEndzone: 55, shortDownDistanceText: '1st & 10', distance: 10 } }
    ] } },
  plays: []
};
const mockMlb = {
  header: { competitions: [{ status: { type: { state: 'in', detail: 'Top 5th', shortDetail: 'Top 5th' }, period: 5 },
    competitors: [
      { homeAway: 'away', score: '2', team: { id: '19', abbreviation: 'LAD', displayName: 'Dodgers', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/lad.png' } },
      { homeAway: 'home', score: '1', team: { id: '15', abbreviation: 'ATL', displayName: 'Braves', logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/atl.png' } }] }] },
  situation: { balls: 2, strikes: 1, outs: 1, onFirst: true, onSecond: false, onThird: false },
  plays: [
    { atBatId: 'ab1', pitchCoordinate: { x: 120, y: 140 }, pitchType: { abbreviation: 'FF', text: 'Four-seam FB' }, pitchVelocity: 95, type: { text: 'Strike Looking', type: 'strike-looking' } },
    { atBatId: 'ab1', pitchCoordinate: { x: 90, y: 160 }, pitchType: { abbreviation: 'CH', text: 'Changeup' }, pitchVelocity: 86, type: { text: 'Ball', type: 'ball' } },
    { atBatId: 'ab1', pitchCoordinate: { x: 130, y: 150 }, pitchType: { abbreviation: 'SL', text: 'Slider' }, pitchVelocity: 88, type: { text: 'Foul Ball', type: 'foul-ball' } },
    { atBatId: 'ab1', pitchCoordinate: { x: 125, y: 145 }, pitchType: { abbreviation: 'FF', text: 'Four-seam FB' }, pitchVelocity: 96, type: { text: 'In Play', type: 'in-play' } }
  ]
};

async function openWith(d, meta) {
  await page.evaluate((d, meta) => {
    gcStop(); clearTimeout(gc.timer);
    gc.open = true; gc.meta = meta; gc.key = meta.key; gc.state = meta.state || 'in';
    gc.fails = 0; gc.polls = 0; gc.lastOk = Date.now(); gc.html = {}; gc.teams = {}; gc.renderErr = null; gc.celFresh = true;
    const el = document.getElementById('gamecast');
    el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('gc-open');
    gcRenderShell(meta);
    gcRender(meta, d);
  }, d, meta);
  await new Promise(r => setTimeout(r, 300));
}

const nflMeta = { key: 't:nfl', sport: 'football', league: 'nfl', cid: 'nfl', id: '1', label: 'NFL', away: 'Colts', home: 'Commanders', awayAbbr: 'IND', homeAbbr: 'WSH', aId: '11', hId: '28', state: 'in', aLogo: mockNfl.header.competitions[0].competitors[0].team.logo, hLogo: mockNfl.header.competitions[0].competitors[1].team.logo };
await openWith(mockNfl, nflMeta);
const field = await page.evaluate(() => ({
  field: !!document.querySelector('#gc-track .gc-field'),
  ball: !!document.querySelector('#gc-track circle[fill="#f5d76e"]'),
  head: (document.querySelector('#gc-track .gc-trk-head b') || {}).textContent || '',
  first: !!document.querySelector('#gc-track line[stroke="#ffe600"]'),
  los: !!document.querySelector('#gc-track line[stroke="#3b9eff"]')
}));
check('football field SVG renders', field.field);
check('football ball + possession head', field.ball && /BALL|FINAL DRIVE/.test(field.head), field.head);
check('football LOS + line-to-gain', field.los && field.first, JSON.stringify(field));
await page.screenshot({ path: path.join(OUT, 'mock-field.png') });

// Degrade: no drives
const empty = JSON.parse(JSON.stringify(mockNfl)); delete empty.drives;
await openWith(empty, nflMeta);
const deg = await page.evaluate(() => document.querySelector('#gc-track')?.innerHTML || '');
check('football degrades without drives (empty or field without ball ok)', true, deg.slice(0, 40));

const mlbMeta = { key: 't:mlb', sport: 'baseball', league: 'mlb', cid: 'mlb', id: '2', label: 'MLB', away: 'Dodgers', home: 'Braves', awayAbbr: 'LAD', homeAbbr: 'ATL', aId: '19', hId: '15', state: 'in', aLogo: mockMlb.header.competitions[0].competitors[0].team.logo, hLogo: mockMlb.header.competitions[0].competitors[1].team.logo };
await openWith(mockMlb, mlbMeta);
const sz = await page.evaluate(() => ({
  sz: !!document.querySelector('#gc-track .gc-sz'),
  dots: document.querySelectorAll('#gc-track .gc-sz circle').length,
  list: [...document.querySelectorAll('#gc-track .gc-sz-list div')].map(x => x.textContent),
  bases: !!document.querySelector('#gc-track .gc-bases'),
  outs: document.querySelectorAll('.gc-outs i').length,
  head: (document.querySelector('#gc-track .gc-trk-head b') || {}).textContent || ''
}));
check('MLB strike zone SVG renders', sz.sz);
check('MLB pitch dots plotted', sz.dots >= 3, JSON.stringify(sz));
check('MLB pitch list clean + bases + outs dots + count', sz.list.length >= 3 && !sz.list.some(x => /Play Result|End Batter/i.test(x)) && sz.bases && sz.outs === 3 && /COUNT/.test(sz.head), JSON.stringify(sz));
await page.screenshot({ path: path.join(OUT, 'mock-strikezone.png') });

// Real ESPN dumps if present
for (const [label, file, sport, league] of [['nfl-real', '/tmp/nfl2.json', 'football', 'nfl'], ['cfb-real', '/tmp/cfb2.json', 'football', 'college-football'], ['mlb-real', '/tmp/mlb2.json', 'baseball', 'mlb']]) {
  if (!fs.existsSync(file)) { console.log('SKIP  real ' + label + ' (no dump)'); continue; }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cs = d.header.competitions[0].competitors;
  const aw = cs.find(c => c.homeAway === 'away'), hm = cs.find(c => c.homeAway === 'home');
  const meta = { key: 'real:' + label, sport, league, cid: league, id: String(d.header.id || d.header.competitions[0].id || 'x'), label: league === 'nfl' ? 'NFL' : (league === 'mlb' ? 'MLB' : 'CFB'), away: aw.team.displayName, home: hm.team.displayName, awayAbbr: aw.team.abbreviation, homeAbbr: hm.team.abbreviation, aId: String(aw.team.id), hId: String(hm.team.id), state: 'in', aLogo: aw.team.logo, hLogo: hm.team.logo };
  if (sport === 'football' && d.drives && Array.isArray(d.drives.previous) && d.drives.previous.length) {
    let best = null, score = -1;
    for (const dr of d.drives.previous) {
      const n = (dr.plays || []).filter(p => ((p.end || {}).yardsToEndzone != null) && ((p.end || {}).down || 0) > 0).length;
      if (n > score) { score = n; best = dr; }
    }
    if (best) d.drives.current = best;
  }
  // Keep real feed status (FINAL/LIVE) — do not force LIVE
  await openWith(d, meta);
  const ok = await page.evaluate((sport) => {
    if (sport === 'football') return { ok: !!document.querySelector('#gc-track .gc-field'), head: (document.querySelector('#gc-track .gc-trk-head b') || {}).textContent };
    return { ok: !!document.querySelector('#gc-track .gc-sz'), dots: document.querySelectorAll('#gc-track .gc-sz circle').length, head: (document.querySelector('#gc-track .gc-trk-head b') || {}).textContent };
  }, sport);
  check('real ' + label + ' tracker renders', ok.ok, JSON.stringify(ok));
  await page.screenshot({ path: path.join(OUT, 'gamecast-' + (sport === 'football' ? ('field-' + (league === 'nfl' ? 'nfl' : 'cfb')) : 'strikezone-mlb') + '.png') });
}

check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('\nResult: ' + (fails ? fails + ' FAIL' : 'PASS') + '  out ' + OUT);
await browser.close(); srv.close();
process.exit(fails ? 1 : 0);
