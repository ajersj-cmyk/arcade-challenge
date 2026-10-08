#!/usr/bin/env node
// NFL FANTASY slide checks.  node tools/test-fantasy.mjs [preview.html]
//  1. fantasy.json (real file) -> projections by position (QB/RB/WR/TE/K/DST) with headshots + hot pickups; no ESPN live
//     calls before the week's first kickoff.
//  2. fantasy.json missing -> live ESPN Fantasy pull (real API), cached in localStorage.
//  3. Simulated live week (kickoff in the past, an NFL game "in" the Gamecast registry, mocked ESPN Fantasy responses):
//     LIVE PPR LEADERS card, live points on rows, live dot, numbers patched in place on the 60 s refresh, timer stops
//     when the slide changes.
//  4. Settings toggle hides the slide.  5. 0 console errors.  Screenshots at 1280x720 (+1920x1080) in tools/out/*-fantasy/.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = path.join(REPO, 'tools/out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-fantasy');
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : (f.endsWith('.json') ? 'application/json' : 'application/octet-stream') }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const realFF = JSON.parse(fs.readFileSync(path.join(REPO, 'fantasy.json'), 'utf8'));
const errors = [];

async function newPage({ w = 1280, h = 720, fantasyJson, mockEspn } = {}) {
  const page = await browser.newPage();
  await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: w, height: h });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|tailwind/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGE ' + e));
  page.ffCalls = [];
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (/lm-api-reads\.fantasy\.espn\.com/.test(u) && req.method() !== 'OPTIONS') page.ffCalls.push({ u, f: req.headers()['x-fantasy-filter'] || '' });
    if (/\/fantasy\.json/.test(u) && fantasyJson !== undefined) {
      if (fantasyJson === null) return req.respond({ status: 404, body: 'nope' });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(fantasyJson) });
    }
    if (mockEspn && /lm-api-reads\.fantasy\.espn\.com/.test(u)) {
      if (req.method() === 'OPTIONS') return req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-fantasy-filter' }, body: '' });
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(mockEspn(req.headers()['x-fantasy-filter'] || '{}')) });
    }
    req.continue();
  });
  await page.goto(base + FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.smApply && smApply.ready, { timeout: 120000 });
  await page.evaluate(() => { arcadeNav.paused = true; clearSlideTimers(); });
  return page;
}
async function showFantasySlide(page, waitMs = 15000) {
  await page.evaluate(() => { arcadeNav.paused = false; navGoTo('fantasy'); arcadeNav.paused = true; });
  await page.waitForFunction(() => document.getElementById('fantasy-screen').style.display === 'flex' && document.getElementById('fantasy-track').children.length > 0, { timeout: waitMs });
  await sleep(1200);
  // freeze the auto-scroll at the top for the screenshot
  await page.evaluate(() => { const t = document.getElementById('fantasy-track'); t.style.animation = 'none'; t.style.transform = 'translate3d(0,0,0)'; document.getElementById('nav-hud').classList.remove('show'); });
  await sleep(1500);
}
const fit = page => page.evaluate(() => { // every card fully visible above the ticker, inside the viewport, no scroll needed
  const tk = document.getElementById('sports-ticker').getBoundingClientRect().top, vp = document.getElementById('fantasy-viewport'), vb = vp.getBoundingClientRect().bottom;
  const tr = document.getElementById('fantasy-track');
  const bad = [...tr.querySelectorAll('.ff-card')].filter(c => { const b = c.getBoundingClientRect(); return b.bottom > tk + 1 || b.bottom > vb + 1; }).map(c => c.querySelector('.division-header span').textContent.trim());
  return { bad, maxBottom: Math.max(...[...tr.querySelectorAll('.ff-card')].map(c => Math.round(c.getBoundingClientRect().bottom))), tickerTop: Math.round(tk), vpBottom: Math.round(vb), scrolls: tr.scrollHeight > vp.clientHeight + 20 };
});
const info = page => page.evaluate(() => {
  const tr = document.getElementById('fantasy-track');
  const cards = [...tr.querySelectorAll('.ff-card')].map(c => ({ title: c.querySelector('.division-header span').textContent.trim(), rows: c.querySelectorAll('.ff-row').length }));
  const imgs = [...tr.querySelectorAll('img.ff-head')].map(i => i.getAttribute('src'));
  const clipped = [...tr.querySelectorAll('.fut-name')].filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent.trim());
  return { cards, imgs, clipped, meta: document.getElementById('fantasy-meta').textContent, live: tr.querySelectorAll('.ff-pts.live').length, dots: tr.querySelectorAll('.ff-live-dot').length };
});

// ---------- 1. real fantasy.json, week not started (force kickoffs into the future so the run is deterministic)
const pre = JSON.parse(JSON.stringify(realFF)); pre.generatedAt = new Date().toISOString();
Object.values(pre.games).forEach(g => { g.date = Date.now() + 86400000; });
let page = await newPage({ fantasyJson: pre });
await showFantasySlide(page);
let r = await info(page);
const titles = r.cards.map(c => c.title);
check('projection cards QB/RB/WR/TE/K/D/ST', ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].every(t => titles.includes(t)), titles.join(','));
check('4 rows per position card', r.cards.filter(c => ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].includes(c.title)).every(c => c.rows === 4));
check('hot pickups card with >= 4 rows', (r.cards.find(c => c.title === 'HOT PICKUPS') || {}).rows >= 4, JSON.stringify(r.cards.find(c => c.title === 'HOT PICKUPS')));
check('ESPN headshots used', r.imgs.filter(s => /headshots\/nfl\/players\/full\/\d+\.png/.test(s)).length >= 20, r.imgs.length + ' imgs');
check('meta shows week + update time', /WEEK \d+ · PPR/.test(r.meta) && /UPDATED/.test(r.meta), r.meta);
check('no ESPN live call before kickoff (fantasy.json fresh)', page.ffCalls.length === 0, page.ffCalls.length + ' calls');
check('no player name clipped at 1280x720', r.clipped.length === 0, r.clipped.join(', '));
let fr = await fit(page);
check('1280x720: all cards (incl. K, D/ST, HOT PICKUPS) above the ticker, no scroll', !fr.bad.length && !fr.scrolls, JSON.stringify(fr));
await page.screenshot({ path: path.join(OUT, 'fantasy-projections-1280.png') });
const nImgOk = await page.evaluate(() => [...document.querySelectorAll('#fantasy-track img')].filter(i => i.complete && i.naturalWidth > 0).length);
check('headshots load', nImgOk >= 20, nImgOk + ' loaded');
// settings toggle hides the slide
const tog = await page.evaluate(() => { const was = navEnabled('fantasy'); settings.fantasy = false; const off = !navEnabled('fantasy'); settings.fantasy = true; return was && off && ARCADE_SCREENS.includes('fantasy'); });
check('fantasy slide in rotation + settings toggle hides it', tog);
await page.close();

// 1080p look
page = await newPage({ w: 1920, h: 1080, fantasyJson: pre });
await showFantasySlide(page);
fr = await fit(page);
check('1920x1080: all cards above the ticker, no scroll', !fr.bad.length && !fr.scrolls, JSON.stringify(fr));
await page.screenshot({ path: path.join(OUT, 'fantasy-projections-1920.png') });
await page.close();

// ---------- 2. fantasy.json missing -> live ESPN Fantasy pull (real network)
page = await newPage({ fantasyJson: null });
await page.evaluate(() => localStorage.removeItem('ahlersFantasy1'));
await showFantasySlide(page, 45000);
r = await info(page);
const cached = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('ahlersFantasy1') || 'null'); return c ? { src: c.source, pos: Object.keys(c.positions).length, picks: c.pickups.length } : null; });
check('fallback: live ESPN Fantasy pull renders positions', r.cards.length >= 5, r.cards.map(c => c.title + ':' + c.rows).join(','));
check('fallback: cached in localStorage', cached && cached.pos >= 4, JSON.stringify(cached));
check('fallback: ESPN Fantasy calls made', page.ffCalls.length >= 4, page.ffCalls.length + ' calls');
await page.close();

// ---------- 3. simulated live week
const live = JSON.parse(JSON.stringify(realFF)); live.generatedAt = new Date().toISOString();
const evIds = new Set();
Object.entries(live.games).forEach(([tid, g], i) => { g.date = Date.now() - 3600000; evIds.add(g.eventId); });
const firstEvent = Object.values(live.games)[0].eventId;
const allRows = Object.values(live.positions).flat().concat(live.pickups);
const posId = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DST: 16 };
const teamId = Object.fromEntries(Object.entries(live.teams).map(([k, v]) => [v.toUpperCase(), Number(k)]));
let tick = 0;
const ptsFor = (r, i) => Math.round(((r.proj || 5) * 0.6 + (i % 7) * 1.3 + tick * 2.1) * 10) / 10;
const espnPlayer = (r, i) => ({ id: r.id, player: { id: r.id, fullName: r.name, firstName: r.first || '', lastName: r.last || '', defaultPositionId: posId[r.pos], proTeamId: teamId[r.team] || 0,
  ownership: { percentOwned: r.own || 50, percentChange: r.chg || 0 }, stats: [{ statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: live.week, appliedTotal: ptsFor(r, i) }, { statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: live.week, appliedTotal: r.proj }] } });
const mock = fstr => {
  const f = JSON.parse(fstr || '{}').players || {};
  if (f.filterIds) return { players: allRows.filter(r => f.filterIds.value.includes(r.id)).map(espnPlayer) };
  return { players: allRows.slice().sort((a, b) => ptsFor(b, allRows.indexOf(b)) - ptsFor(a, allRows.indexOf(a))).slice(0, f.limit || 8).map(r => espnPlayer(r, allRows.indexOf(r))) };
};
page = await newPage({ fantasyJson: live, mockEspn: mock });
await page.evaluate(ev => { gcRegistry['nfl:' + ev] = { key: 'nfl:' + ev, cid: 'nfl', state: 'in', id: ev }; ff.live = null; ff.liveAt = 0; }, firstEvent);
await showFantasySlide(page);
r = await info(page);
const lc = r.cards.find(c => /LIVE PPR LEADERS/.test(c.title));
check('live: LIVE PPR LEADERS card (8) + HOT PICKUPS both shown', lc && lc.rows === 8 && (r.cards.find(c => c.title === 'HOT PICKUPS') || {}).rows >= 4, JSON.stringify(r.cards));
fr = await fit(page);
check('live 1280x720: every card above the ticker, no scroll', !fr.bad.length && !fr.scrolls, JSON.stringify(fr));
check('live: points shown on rows', r.live >= 20, r.live + ' live values');
check('live: live dot for players in a live game', r.dots >= 2, r.dots + ' dots');
check('live: meta shows LIVE PPR time', /LIVE PPR \d/.test(r.meta), r.meta);
check('live: no player name clipped', r.clipped.length === 0, r.clipped.join(', '));
check('live: 2 ESPN calls (leaders + shown players)', page.ffCalls.length === 2, page.ffCalls.length);
await page.screenshot({ path: path.join(OUT, 'fantasy-live-ppr-1280.png') });
const before = await page.evaluate(() => { const el = document.querySelector('#fantasy-track .ff-pts.live[data-ffpts] span'); el.setAttribute('data-mark', '1'); return { v: el.textContent, timer: !!ff.timer }; });
check('live: 60 s refresh timer running while the slide shows', before.timer);
tick = 1;
await page.evaluate(() => { ff.liveAt = 0; });
await sleep(62000);
const after = await page.evaluate(() => { const el = document.querySelector('#fantasy-track [data-mark="1"]'); return { same: !!el, v: el && el.textContent }; });
check('live: numbers patched in place after ~60 s (same node, new value)', after.same && after.v !== before.v, before.v + ' -> ' + after.v);
check('live: exactly one refresh pair in ~60 s', page.ffCalls.length === 4, page.ffCalls.length + ' calls');
await page.evaluate(() => { arcadeNav.paused = false; navStep(1); arcadeNav.paused = true; });
await sleep(500);
check('live: timer stops when the slide changes', await page.evaluate(() => ff.timer === null));
await page.close();
// live state at 1080p
tick = 0;
page = await newPage({ w: 1920, h: 1080, fantasyJson: live, mockEspn: mock });
await page.evaluate(ev => { gcRegistry['nfl:' + ev] = { key: 'nfl:' + ev, cid: 'nfl', state: 'in', id: ev }; ff.live = null; ff.liveAt = 0; }, firstEvent);
await showFantasySlide(page);
fr = await fit(page);
check('live 1920x1080: every card above the ticker, no scroll', !fr.bad.length && !fr.scrolls, JSON.stringify(fr));
await page.screenshot({ path: path.join(OUT, 'fantasy-live-ppr-1920.png') });
await page.close();

check('0 console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log('screenshots:', OUT);
await browser.close(); srv.close();
console.log(fails ? `FAIL (${fails})` : 'ALL PASS');
process.exit(fails ? 1 : 0);
