#!/usr/bin/env node
// Hot Props slide + Win Probability panel + settings slide list.  node tools/test-props.mjs [preview.html]
// - Hot Props with the real props.json at 1280x720 and 1920x1080: cards render, nothing hidden under the ticker,
//   sport modes only show that sport (or skip the slide when that sport has no props), graceful empty state.
// - LIVE LEADERS slide is gone from the rotation, settings and sport modes.
// - Gamecast WIN PROBABILITY: real ESPN summary served as in-progress (big % CHANCE TO WIN, team-colored bar, trend),
//   and the panel is hidden when ESPN has no win probability.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(REPO, 'tools', 'out', `${stamp}-props`); fs.mkdirSync(OUT, { recursive: true });
let EMPTY = false;
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  if (EMPTY && /props\.json$/.test(f)) { s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify({ updated: new Date().toISOString(), leagues: {} })); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : (f.endsWith('.json') ? 'application/json' : 'application/octet-stream') }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const errors = []; const isNoise = t => /Failed to load resource|favicon|net::|status of [45]\d\d/.test(t);
const shots = [];
async function newPage(w, h, init) {
  const page = await browser.newPage(); await page.setUserAgent(ua); await page.setViewport({ width: w, height: h });
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
  await page.evaluateOnNewDocument(init || (() => { window.ArcadeTV = {}; try { localStorage.removeItem('ahlersSportMode1'); } catch (e) {} }));
  if (init && init.intercept) {}
  await page.goto(base + FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current && typeof hpLoad === 'function', { timeout: 90000 });
  await page.evaluate(() => { arcadeNav.paused = true; });
  return page;
}
async function go(page, key) {
  await page.evaluate(k => { arcadeNav.paused = false; navGoTo(k); arcadeNav.paused = true; }, key);
  await sleep(3000);
}
const shot = async (page, name) => { const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f }); shots.push(path.relative(REPO, f)); };
const fit = page => page.evaluate(() => { // the viewport ends at/above the ticker and nothing in a card overflows
  const vp = document.getElementById('hotprops-viewport').getBoundingClientRect(), tk = document.getElementById('sports-ticker');
  const tTop = tk ? tk.getBoundingClientRect().top : innerHeight * 0.78;
  const cards = [...document.querySelectorAll('.hp-card')];
  const clipped = cards.filter(c => c.scrollWidth > c.clientWidth + 2).length;
  const c0 = cards[0] && cards[0].getBoundingClientRect();
  return { vpBottom: Math.round(vp.bottom), tickerTop: Math.round(tTop), cards: cards.length, clipped, row: cards[0] ? getComputedStyle(cards[0]).flexDirection : '', cardH: c0 ? Math.round(c0.height) : 0, h: innerHeight };
});

// ---------- 1. Hot Props, real props.json ----------
for (const [w, h] of [[1280, 720], [1920, 1080]]) {
  const page = await newPage(w, h);
  const info = await page.evaluate(async () => { await hpLoad(); return { leagues: Object.keys(hp.data.leagues).map(k => k + ':' + hp.data.leagues[k].props.length).join(' '), list: hpList().length, screens: ARCADE_SCREENS.join(','), nav: NAV_TITLES.hotProps, old: !!document.getElementById('props-screen') || typeof showProps === 'function' || ARCADE_SCREENS.indexOf('props') >= 0 }; });
  if (w === 1280) {
    check('LIVE LEADERS slide removed (no props-screen, showProps or "props" in the rotation)', !info.old, info.screens);
    check('hotProps sits where LIVE LEADERS was (right after live)', /^live,hotProps,/.test(info.screens));
    check('props.json loads', !!info.leagues, info.leagues);
  }
  await go(page, 'hotProps');
  const f = await fit(page);
  const txt = await page.evaluate(() => document.getElementById('hotprops-screen').innerText.replace(/\s+/g, ' ').slice(0, 260));
  check(`${w}x${h}: hot props render (${f.cards} cards, row layout)`, info.list ? (f.cards === info.list && f.row === 'row') : /NO PLAYER PROPS/.test(txt), txt);
  check(`${w}x${h}: viewport ends above the ticker, no clipped cards`, f.vpBottom <= f.tickerTop + 2 && f.clipped === 0, JSON.stringify(f));
  await shot(page, `hotprops-${w}x${h}`);
  if (w === 1280) {
    await page.evaluate(() => { const v = document.getElementById('hotprops-track'); v.style.animation = 'none'; v.style.transform = 'translate3d(0,' + -(v.scrollHeight - document.getElementById('hotprops-viewport').clientHeight) + 'px,0)'; });
    await sleep(800); await shot(page, `hotprops-${w}x${h}-scrolled-bottom`);
    // sport modes: only that sport's props (or the slide is skipped when it has none)
    const modes = await page.evaluate(() => ['nfl', 'cfb', 'cbb'].map(m => { smSet(m); var l = hpList(), r = { m, n: l.length, lgs: [...new Set(l.map(x => x.p.lg))].join('/'), skip: smSlideEmpty('hotProps'), inRot: arcadeScreens().indexOf('hotProps') >= 0 }; smSet(null); return r; }));
    check('sport modes: hotProps in NFL/CFB/HOOPS rotations, only that sport, skipped when empty', modes.every(r => r.inRot && (r.n ? r.lgs === { nfl: 'nfl', cfb: 'ncaaf', cbb: 'ncaab' }[r.m] && !r.skip : r.skip)), JSON.stringify(modes));
    const tog = await page.evaluate(() => { settings.showNHL = false; var a = hpList().filter(x => x.p.lg === 'nhl').length; settings.showNHL = true; return a; });
    check('outside a mode, ticker league toggles filter props (NHL off -> no NHL props)', tog === 0);
    // settings slide list
    await page.evaluate(() => { toggleSettings(); });
    await sleep(800);
    const st = await page.evaluate(() => { const b = document.getElementById('set-hotProps'); b.scrollIntoView({ block: 'center' }); return { on: b.checked, txt: document.body.innerText.indexOf("Today's Hot Props") >= 0, leaders: /LIVE LEADERS/i.test([...document.querySelectorAll('.toggle-row')].map(r => r.innerText).join('|')) }; });
    check('settings: "Today\'s Hot Props" toggle (on), no LIVE LEADERS toggle', st.on && st.txt && !st.leaders, JSON.stringify(st));
    await sleep(500); await shot(page, 'settings-slide-list');
    const off = await page.evaluate(() => { document.getElementById('set-hotProps').checked = false; updateSettings(); var r = slideOn('hotProps'); document.getElementById('set-hotProps').checked = true; updateSettings(); toggleSettings(); return r; });
    check('turning the toggle off removes hotProps from the rotation', off === false);
  }
  await page.close();
}
// ---------- 2. empty state ----------
EMPTY = true;
{ const page = await newPage(1280, 720); await go(page, 'hotProps');
  const t = await page.evaluate(() => document.getElementById('hotprops-screen').innerText);
  check('empty props.json: friendly empty state, rotation moves on', /NO PLAYER PROPS POSTED/.test(t)); await shot(page, 'hotprops-empty');
  const sk = await page.evaluate(() => { smSet('nfl'); var r = smSlideEmpty('hotProps'); smSet(null); return r; });
  check('empty props in a sport mode: slide skipped', sk === true);
  await page.close(); }
EMPTY = false;

// ---------- 3. Gamecast WIN PROBABILITY ----------
const EV = { sport: 'football', league: 'nfl', id: process.env.WP_EVENT || '401872980', label: 'NFL', key: 'ref:wp' };
const real = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${EV.sport}/${EV.league}/summary?event=${EV.id}`)).json();
const n = (real.winprobability || []).length;
function simLive(j) { // real game served as if in the 3rd quarter: status in-progress, win probability up to that point
  const c = JSON.parse(JSON.stringify(j)), comp = c.header.competitions[0];
  comp.status = { type: { state: 'in', completed: false, detail: '3rd Quarter', shortDetail: '8:12 - 3rd', description: 'In Progress', name: 'STATUS_IN_PROGRESS' }, period: 3, displayClock: '8:12' };
  c.winprobability = (c.winprobability || []).slice(0, Math.max(5, Math.round(n * 0.62)));
  return c;
}
function noWp(j) { const c = simLive(j); delete c.winprobability; delete c.predictor; return c; }
for (const [tag, body] of [['live', simLive(real)], ['nodata', noWp(real)]]) {
  const page = await newPage(1280, 720);
  await page.setRequestInterception(true);
  page.on('request', r => { if (r.url().includes('/summary?event=' + EV.id)) r.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); else r.continue(); });
  await page.evaluate(m => gcOpenEvent(m), EV);
  await page.waitForFunction(() => gc.lastOk > 0 || gc.fails > 0, { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  const wp = await page.evaluate(() => { const e = document.getElementById('gc-wp'); return { html: e.innerHTML.length, vis: e.offsetParent !== null && getComputedStyle(e).display !== 'none', txt: e.innerText.replace(/\s+/g, ' ') }; });
  if (tag === 'live') {
    check('win prob panel: title, "XX% CHANCE TO WIN", both team %s, team-colored bar, trend', wp.vis && /WIN PROBABILITY/.test(wp.txt) && /\d+% CHANCE TO WIN/.test(wp.txt) && (wp.txt.match(/\d+%/g) || []).length >= 3 && /LAST \d+ PLAYS/.test(wp.txt), wp.txt);
    const sum = await page.evaluate(() => [...document.querySelectorAll('#gc-wp .gc-wp-pct')].map(e => parseInt(e.textContent)).reduce((a, b) => a + b, 0));
    check('the two percentages add up to 100', sum === 100, sum);
    await shot(page, 'gamecast-winprob-live');
    const el = await page.$('#gc-wp'); if (el) { const f = path.join(OUT, 'gamecast-winprob-panel.png'); await el.screenshot({ path: f }); shots.push(path.relative(REPO, f)); }
  } else {
    check('no ESPN win probability -> panel hidden', !wp.vis && wp.html === 0, JSON.stringify(wp));
    await shot(page, 'gamecast-winprob-hidden');
  }
  await page.evaluate(() => gcClose()); await page.close();
}
check('0 console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close(); srv.close();
console.log('screenshots:\n  ' + shots.join('\n  '));
console.log(fails ? `${fails} FAILED` : 'ALL PROPS/WINPROB CHECKS PASSED');
process.exit(fails ? 1 : 0);
