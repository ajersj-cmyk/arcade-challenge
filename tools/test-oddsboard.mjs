#!/usr/bin/env node
// ODDS BOARD slide: live Action Network data + synthetic STEAM / SHARP / live-odds checks.
//   node tools/test-oddsboard.mjs [preview.html] [--out=DIR]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), FILE = args.find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = path.resolve((args.find(a => a.startsWith('--out=')) || '').slice(6) || path.join(REPO, 'tools', 'out', 'oddsboard'));
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await browser.newPage(); await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome')); await page.setViewport({ width: 1280, height: 720 });
const errors = [], an = [];
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::|status of [45]\d\d/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGE ' + e));
page.on('response', r => { if (/actionnetwork\.com\/web\/v2\/scoreboard/.test(r.url())) an.push(r.status()); });
await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('ahlersSportMode1'); } catch (e) {} });
await page.goto(`http://127.0.0.1:${srv.address().port}/${FILE}`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 90000 });
await page.evaluate(() => { arcadeNav.paused = true; });
await page.evaluate(() => obLoad()); await page.waitForFunction(() => ob.at > 0 && !ob.busy, { timeout: 40000 });
const info = await page.evaluate(() => ({ n: ob.games.length, lgs: [...new Set(ob.games.map(g => g.lg))], open: ob.games.filter(g => g.open).length, split: ob.games.filter(g => g.split).length, steam: ob.games.filter(g => g.mv.steam).length }));
console.log('live data', JSON.stringify(info)); console.log(JSON.stringify(await page.evaluate(() => ob.games.map(g => [g.away.abbr, g.home.abbr, g.mv]))));
ok(info.n > 0 && info.n <= 12, 'odds board has 1-12 games');
ok(an.length && an.every(s => s === 200), 'Action Network calls OK ' + an.join(','));
await page.evaluate(() => { arcadeNav.paused = false; navGoTo('oddsBoard'); arcadeNav.paused = true; }); await sleep(4500);
await page.evaluate(() => { const t = document.getElementById('ob-track'); t.style.animation = 'none'; t.style.transform = 'none'; });
const dom = await page.evaluate(() => ({ vis: getComputedStyle(document.getElementById('oddsboard-screen')).display, cards: document.querySelectorAll('#ob-track .ob-card').length,
  txt: document.getElementById('oddsboard-screen').innerText, labels: [...document.querySelectorAll('#ob-track .ob-grid > .ob-cell:nth-child(7) b')].map(b => b.textContent) }));
ok(dom.vis === 'flex' && dom.cards === info.n, 'slide visible, one card per game (' + dom.cards + ')');
ok(dom.labels.length && dom.labels.every(l => /^[A-Z0-9&]{2,5} ([+-]\d+(\.\d)?|PK)$|^–$/.test(l)), 'spread labeled by team: ' + dom.labels.slice(0, 4).join(', '));
ok(!/\bOPEN\b/.test(dom.txt), "no 'OPEN' wording (uses PREGAME)");
await page.screenshot({ path: path.join(OUT, 'oddsboard-live.png') });
// synthetic: steam + sharp + fav flip + PREGAME text
const syn = await page.evaluate(() => {
  const mk = (side, team, v, odds, live, b, m) => ({ side, team_id: team, value: v, odds, is_live: live, bet_info: { tickets: { percent: b }, money: { percent: m } } });
  const g = { id: 1, status: 'scheduled', start_time: new Date(Date.now() + 3600e3).toISOString(), away_team_id: 1, home_team_id: 2, num_bets: 999, status_display: '',
    teams: [{ id: 1, abbr: 'DAL', logo: '' }, { id: 2, abbr: 'CAR', logo: '' }],
    markets: { '15': { event: { spread: [mk('away', 1, 2.5, -110, false, 70, 45), mk('home', 2, -2.5, -110, false, 30, 55)], total: [mk('over', 0, 6, -110, false, 50, 50), mk('under', 0, 6, -110, false, 50, 50)],
                                 moneyline: [mk('away', 1, 0, 120, false, 60, 40), mk('home', 2, 0, -140, false, 40, 60)] } },
               '30': { event: { spread: [mk('away', 1, -0.5, -110), mk('home', 2, 0.5, -110)], total: [mk('over', 0, 6.5, -110), mk('under', 0, 6.5, -110)],
                                 moneyline: [mk('away', 1, 0, -125), mk('home', 2, 0, 105)] } } } };
  const x = obParse(g, 'NHL'); const d = document.createElement('div'); d.innerHTML = obCard(x);
  const flat = obParse(Object.assign({}, g, { markets: { '15': g.markets['15'], '30': g.markets['15'] } }), 'NHL');
  return { steam: x.mv.steam, spread: x.mv.spread, flip: x.mv.flip, sharp: d.querySelectorAll('.ob-sharp').length, txt: d.innerText, flatSteam: flat.mv.steam };
});
ok(syn.steam && syn.spread === -3 && syn.flip, 'STEAM on a 3-pt move + favorite flip');
ok(!syn.flatSteam, 'no STEAM when the line has not moved');
ok(syn.sharp === 1 && /SHARP/.test(syn.txt), 'SHARP on the 55% money / 30% bets side only');
ok(/SPREAD PREGAME CAR \+0.5 → CAR -2.5/.test(syn.txt), 'movement row: PREGAME -> now with arrow');
await page.evaluate(() => { ob.games = []; ob.at = Date.now(); });
ok(await page.evaluate(() => obReady() === false), 'no games -> slide skipped');
ok(!errors.length, 'no console errors ' + errors.join(' | '));
await browser.close(); srv.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
