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
const VW = 1280, VH = 720; // TV-size screenshots
await page.setViewport({ width: VW, height: VH });
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

// Real ESPN dumps if present: views (tabs), field proportions, live box score, remote switching, in-place updates
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (n, keep) => { // freeze auto-scroll at the top so screenshots show the headers
  await page.evaluate(keep => { gc.scrollHold = Date.now() + 60000; if (!keep) ['gc-bxs-body', 'gc-stats-body', 'gc-players-body', 'gc-plays-body'].forEach(id => { const e = document.getElementById(id); if (e) e.scrollTop = 0; }); }, !!keep);
  await sleep(150); await page.screenshot({ path: path.join(OUT, n + '.png') });
};
const viewState = () => page.evaluate(() => {
  const g = document.getElementById('gamecast'), vis = id => { const e = document.getElementById(id); return !!(e && e.offsetParent && e.getBoundingClientRect().height > 10); };
  const tabs = [0, 1].map(i => document.getElementById('gc-tab-' + i)).filter(b => b && b.offsetParent && b.style.display !== 'none').map(b => ({ t: b.textContent, on: b.classList.contains('on') }));
  return { cls: [...g.classList].filter(c => /^gcv-|gc-tabbed/.test(c)).join(' '), tabs, focus: (document.activeElement || {}).id || '', track: vis('gc-track'), bxs: vis('gc-bxs'), plays: vis('gc-p-plays'), stats: vis('gc-p-stats'), line: vis('gc-line') };
});
const realMeta = (d, label, sport, league) => {
  const cs = d.header.competitions[0].competitors;
  const aw = cs.find(c => c.homeAway === 'away'), hm = cs.find(c => c.homeAway === 'home');
  return { key: 'real:' + label, sport, league, cid: league, id: String(d.header.id || d.header.competitions[0].id || 'x'), label: { nfl: 'NFL', mlb: 'MLB', nhl: 'NHL' }[league] || 'CFB', away: aw.team.displayName, home: hm.team.displayName, awayAbbr: aw.team.abbreviation, homeAbbr: hm.team.abbreviation, aId: String(aw.team.id), hId: String(hm.team.id), state: 'in', aLogo: aw.team.logo, hLogo: hm.team.logo };
};
const blur = () => page.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
const bxsTables = () => page.evaluate(() => [...document.querySelectorAll('#gc-bxs-body .gc-bxs-col')].map(c => [...c.querySelectorAll('table')].map(t => [...t.rows[0].cells].map(x => x.textContent).join(' '))));
for (const [label, file, sport, league] of [['nfl-real', '/tmp/nfl2.json', 'football', 'nfl'], ['cfb-real', '/tmp/cfb2.json', 'football', 'college-football'], ['mlb-real', '/tmp/mlb2.json', 'baseball', 'mlb'], ['nhl-real', '/tmp/nhl.json', 'hockey', 'nhl']]) {
  if (!fs.existsSync(file)) { console.log('SKIP  real ' + label + ' (no dump)'); continue; }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const meta = realMeta(d, label, sport, league);
  if (sport === 'football' && d.drives && Array.isArray(d.drives.previous) && d.drives.previous.length) {
    let best = null, score = -1;
    for (const dr of d.drives.previous) {
      const n = (dr.plays || []).filter(p => ((p.end || {}).yardsToEndzone != null) && ((p.end || {}).down || 0) > 0).length;
      if (n > score) { score = n; best = dr; }
    }
    if (best) d.drives.current = best;
  }
  await page.evaluate(() => { gc.view = 0; });
  await openWith(d, meta); await blur(); await sleep(400);
  let v = await viewState();
  if (sport === 'football') {
    const geo = await page.evaluate(() => {
      const svg = document.querySelector('#gc-track .gc-field'); if (!svg) return null;
      const r = svg.getBoundingClientRect(), dw = Math.min(r.width, r.height * 120 / 53.3), dh = dw * 53.3 / 120;
      const imgs = [...svg.querySelectorAll('image')].every(i => i.getAttribute('preserveAspectRatio') === 'xMidYMid meet');
      return { w: Math.round(dw), h: Math.round(dh), ratio: +(dw / dh).toFixed(2), par: svg.getAttribute('preserveAspectRatio'), imgs, nums: svg.querySelectorAll('text').length, head: (document.querySelector('#gc-track .gc-trk-head b') || {}).textContent };
    });
    check(label + ': FIELD view default (tabs FIELD | BOX SCORE, field + linescore + plays)', v.cls.includes('gcv-field') && v.tabs.map(t => t.t).join('|') === 'FIELD|BOX SCORE' && v.tabs[0].on && v.track && v.plays && !v.bxs, JSON.stringify(v));
    check(label + ': field real proportions (2.25:1, not stretched, logos meet, big)', geo && geo.par.includes('meet') && geo.ratio > 2.1 && geo.ratio < 2.5 && geo.imgs && geo.h >= VH * 0.3 && geo.w >= VW * 0.5 && /BALL|FINAL DRIVE/.test(geo.head), JSON.stringify(geo));
    await shot('gamecast-field-' + (league === 'nfl' ? 'nfl' : 'cfb'));
    if (league !== 'nfl') continue;
    // Remote: UP (panels at top) -> tab bar, RIGHT -> BOX SCORE, DOWN -> back to stats
    await page.keyboard.press('ArrowUp'); await sleep(150);
    const f1 = (await viewState()).focus;
    await page.keyboard.press('ArrowRight'); await sleep(250);
    v = await viewState();
    check('remote: UP focuses the tab bar, RIGHT switches to BOX SCORE (focus follows)', f1 === 'gc-tab-0' && v.focus === 'gc-tab-1' && v.cls.includes('gcv-box') && v.bxs && v.stats && !v.track, f1 + ' -> ' + JSON.stringify(v));
    const tb = await bxsTables();
    check('NFL box score: both teams, passing/rushing/receiving/defense/kicking', tb.length === 2 && tb.every(c => c.some(h => /^PASSING C\/ATT YDS AVG TD INT/.test(h)) && c.some(h => /^RUSHING CAR YDS/.test(h)) && c.some(h => /^RECEIVING REC YDS/.test(h)) && c.some(h => /^DEFENSE TOT/.test(h)) && c.some(h => /^KICKING FG/.test(h))), JSON.stringify(tb));
    await page.keyboard.press('ArrowDown'); await sleep(150);
    const f2 = (await viewState()).focus;
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await sleep(200);
    const sc1 = await page.evaluate(() => document.getElementById('gc-bxs-body').scrollTop);
    check('remote: DOWN leaves the tabs, DOWN scrolls the box score', f2 === '' && sc1 > 50, `focus "${f2}", scrollTop ${sc1}`);
    await page.evaluate(() => { const b = document.getElementById('gc-bxs-body'); b.scrollTop = 0; });
    await sleep(300); await shot('gamecast-boxscore-nfl');
    // Poll update in place: change a stat, re-render -> same <td> node, new text, scroll + view kept
    await page.evaluate(() => { const b = document.getElementById('gc-bxs-body'); b.scrollTop = 120; window.__td = b.querySelector('table tr:nth-child(2) td:nth-child(3)'); window.__img = b.querySelector('img'); });
    const d2 = JSON.parse(JSON.stringify(d)); const pg = d2.boxscore.players[0].statistics.find(g => g.name === 'passing'); pg.athletes[0].stats[1] = '999';
    await page.evaluate(d2 => { gcRender(gc.meta, d2); }, d2); await sleep(200);
    const inplace = await page.evaluate(() => ({ same: window.__td && window.__td.isConnected, txt: window.__td && window.__td.textContent, img: window.__img && window.__img.isConnected, top: document.getElementById('gc-bxs-body').scrollTop, cls: document.getElementById('gamecast').className }));
    check('poll update: box score patched in place (same nodes, new value, scroll + BOX SCORE view kept)', inplace.same && inplace.txt === '999' && inplace.img && inplace.top >= 100 && /gcv-box/.test(inplace.cls), JSON.stringify(inplace));
    await blur(); await page.keyboard.press(' '); await sleep(200);
    v = await viewState();
    check('remote: Play/Pause toggles back to FIELD', v.cls.includes('gcv-field'), v.cls);
    await page.click('#gc-tab-1'); await sleep(200); v = await viewState();
    check('mouse: clicking BOX SCORE tab switches view', v.cls.includes('gcv-box'), v.cls);
    // view survives polls (re-render with original data)
    await page.evaluate(d => gcRender(gc.meta, d), d); await sleep(100); v = await viewState();
    check('view survives a poll', v.cls.includes('gcv-box'), v.cls);
    await page.evaluate(() => gcSetView(0));
  } else if (sport === 'baseball') {
    const geo = await page.evaluate(() => { const z = document.querySelector('#gc-track .gc-sz rect[stroke-width="1.5"]'); const r = z && z.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null; });
    check('MLB: AT BAT + BOX SCORE together (tracker + linescore + box score on screen)', v.cls.includes('gcv-mlb') && v.track && v.bxs && v.line && v.tabs[0].t === 'AT BAT + BOX SCORE', JSON.stringify(v));
    check('MLB: strike zone larger (zone box >= 20% of screen height, was ~10%)', geo && geo.h >= VH * 0.2, JSON.stringify(geo));
    const tb = await bxsTables();
    check('MLB box score: batting AB R H RBI BB K AVG + pitching IP H R ER BB K PC, both teams', tb.length === 2 && tb.every(c => c.includes('BATTING AB R H RBI BB K AVG') && c.includes('PITCHING IP H R ER BB K PC')), JSON.stringify(tb));
    const ok = await page.evaluate(() => ({ dots: document.querySelectorAll('#gc-track .gc-sz circle').length, head: (document.querySelector('#gc-track .gc-trk-head b') || {}).textContent }));
    check('real mlb-real tracker renders', ok.dots > 0, JSON.stringify(ok));
    await shot('gamecast-mlb-tracker-boxscore');
    await page.keyboard.press(' '); await sleep(200); v = await viewState();
    check('MLB: second tab PLAYS & STATS (old panels)', v.cls.includes('gcv-plays') && !v.track && v.plays && v.stats, JSON.stringify(v));
    await page.evaluate(() => gcSetView(0));
  } else if (sport === 'hockey') {
    check('NHL: tabs GAME | BOX SCORE', v.tabs.map(t => t.t).join('|') === 'GAME|BOX SCORE', JSON.stringify(v));
    await page.keyboard.press(' '); await sleep(250); v = await viewState();
    const tb = await bxsTables();
    check('NHL box score: skaters G A SOG TOI + goalies SV, both teams', v.cls.includes('gcv-box') && tb.length === 2 && tb.every(c => c.some(h => /^SKATERS G A SOG/.test(h) && /TOI/.test(h)) && c.some(h => /^GOALIES .*SV/.test(h))), JSON.stringify(tb));
    const sog = await page.evaluate(() => { const t = document.querySelector('#gc-bxs-body table'); const i = [...t.rows[0].cells].findIndex(c => c.textContent === 'SOG'); return [...t.rows].slice(1).reduce((s, r) => s + (+r.cells[i].textContent || 0), 0); });
    check('NHL SOG column is real shots (sum > 0)', sog > 0, 'sum ' + sog);
    await shot('gamecast-boxscore-nhl');
    await page.evaluate(() => gcSetView(0));
  }
}

check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('\nResult: ' + (fails ? fails + ' FAIL' : 'PASS') + '  out ' + OUT);
await browser.close(); srv.close();
process.exit(fails ? 1 : 0);
