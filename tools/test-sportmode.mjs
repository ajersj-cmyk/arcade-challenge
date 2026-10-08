#!/usr/bin/env node
// SPORT MODE checks.  node tools/test-sportmode.mjs [preview.html]
//  settings row (mouse + D-pad), localStorage state with a 12 h expiry + snapshot, rotation limited to the sport's slides,
//  ticker/live/navigator filtered to the league, indicator pill, survives a reload, switching modes keeps the original
//  snapshot, CFB + CBB content (rankings, futures, news), empty-sport fallback (never an empty rotation), turn off early,
//  12 h expiry with a simulated clock restores the user's settings + slide selection, expiry found on reload,
//  Gamecast + celebrations still work, 0 console errors. Screenshots at 1280x720 in tools/out/*-sportmode/.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = path.join(REPO, 'tools/out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-sportmode');
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : (f.endsWith('.json') ? 'application/json' : 'application/octet-stream') }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const errors = [];
const H12 = 12 * 3600000;

async function setupPage(page, { emptyCbb = false } = {}) {
  await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: 1280, height: 720 });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|tailwind/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGE ' + e));
  if (emptyCbb) {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (/mens-college-basketball\/scoreboard/.test(req.url())) return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ events: [] }) });
      req.continue();
    });
  }
}
async function load(page) {
  await page.goto(base + FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.smApply && smApply.ready, { timeout: 120000 });
  await page.evaluate(() => { arcadeNav.paused = true; clearSlideTimers(); });
}
const freeze = page => page.evaluate(() => { document.querySelectorAll('.slide-screen [style*="animation"], .list-track, .grid-track, .fut-grid, .ff-grid').forEach(t => { t.style.animation = 'none'; t.style.transform = 'translate3d(0,0,0)'; }); document.getElementById('nav-hud').classList.remove('show'); });
async function goSlide(page, key, waitMs = 20000) {
  await page.evaluate(k => { arcadeNav.paused = false; navGoTo(k); arcadeNav.paused = true; }, key);
  await page.waitForFunction(() => [...document.querySelectorAll('.slide-screen')].some(s => s.style.display === 'flex'), { timeout: waitMs }).catch(() => {});
  await sleep(3500); await freeze(page); await sleep(400);
  const ov = await page.evaluate(() => { // the mode pill must never sit on top of a slide title
    const p = document.getElementById('sm-pill'); if (!p || getComputedStyle(p).display === 'none') return null;
    const h = [...document.querySelectorAll('.slide-screen')].find(s => s.style.display === 'flex'); const hd = h && h.querySelector('.screen-header'); if (!hd) return null;
    const rg = document.createRange(); rg.selectNodeContents(hd); const a = rg.getBoundingClientRect(), b = p.getBoundingClientRect();
    return (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) ? hd.textContent.trim() : null; });
  if (ov) overlaps.push(key + ':' + ov);
}
const overlaps = [];
async function cycle(page, n) { // natural rotation (nextSlide, incl. skip-if-empty), forced past the pause
  const seen = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => { arcadeNav.forcing = true; try { clearTimeout(slideTimer); nextSlide(); } finally { arcadeNav.forcing = false; } });
    await sleep(1800);
    seen.push(await page.evaluate(() => ({ k: arcadeNav.current, vis: [...document.querySelectorAll('.slide-screen')].filter(s => s.style.display === 'flex').length })));
  }
  return seen;
}
const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);

// ===== 1. settings row + NFL mode via D-pad
const page = await browser.newPage(); await setupPage(page); await load(page);
const settingsBefore = await ls(page, 'ahlersArcadeSettings');
const userSnap = await page.evaluate(() => JSON.stringify(settings));
await page.keyboard.press('ArrowLeft'); await sleep(300); // wake nav (also moves a slide; fine)
await page.evaluate(() => { arcadeNav.paused = true; clearSlideTimers(); });
await page.keyboard.press('s'); await sleep(500);
const firstFocus = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
check('settings: SPORT MODE row is the first D-pad stop (OFF)', firstFocus === 'OFF', firstFocus);
await page.screenshot({ path: path.join(OUT, 'settings-sportmode-off.png') });
for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await sleep(150); }
const onNfl = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-sm'));
check('settings: ▶ ▶ ▶ reaches NFL', onNfl === 'nfl', onNfl);
await page.keyboard.press('Enter'); await sleep(1200);
let st = JSON.parse(await ls(page, 'ahlersSportMode1') || 'null');
check('NFL mode saved with 12 h expiry', st && st.mode === 'nfl' && Math.abs(st.until - st.start - H12) < 5 && Math.abs(st.until - Date.now() - H12) < 60000, st && (st.until - Date.now()) + ' ms left');
check('snapshot of slide + league toggles saved', st && st.snap && 'trivia' in st.snap && 'showNHL' in st.snap && 'fantasy' in st.snap && !('celebrate' in st.snap));
check('user settings not modified by the mode', (await ls(page, 'ahlersArcadeSettings')) === settingsBefore);
const ui = await page.evaluate(() => ({ on: [...document.querySelectorAll('.sm-btn.on')].map(b => b.textContent.trim()), status: document.getElementById('sm-status').textContent }));
check('settings shows NFL active + time left', ui.on.join() === 'NFL' && /NFL MODE ON/.test(ui.status) && /left/.test(ui.status), JSON.stringify(ui));
await page.screenshot({ path: path.join(OUT, 'settings-sportmode-nfl.png') });
await page.keyboard.press('Escape'); await sleep(4000); // close; the mode refetches scoreboards + restarts rotation

const pill = await page.evaluate(() => { const p = document.getElementById('sm-pill'); return { t: p.textContent, vis: getComputedStyle(p).display !== 'none' }; });
check('indicator pill "NFL MODE · h:mm LEFT"', pill.vis && /^NFL MODE · 1[01]:\d\d LEFT$/.test(pill.t), pill.t);
const filt = await page.evaluate(() => ({
  raw: [...new Set(globalRawGames.map(g => g.league))], live: [...new Set(globalLiveGamesData.map(g => g.league))],
  ticker: [...document.querySelectorAll('#ticker-track [data-gc]')].map(e => e.getAttribute('data-gc').split(':')[0]),
  head: (document.querySelector('#ticker-track .ticker-section-head') || {}).textContent || '',
  reg: Object.keys(gcRegistry).map(k => k.split(':')[0])
}));
check('games limited to NFL (live/upcoming/finals lists)', filt.raw.every(l => l === 'NFL'), filt.raw.join(','));
check('ticker only NFL games + mode label', filt.ticker.every(l => l === 'nfl') && /^NFL MODE · /.test(filt.head), filt.head + ' / ' + [...new Set(filt.ticker)].join(','));
check('other leagues stay in the Gamecast registry (celebrations keep working)', new Set(filt.reg).size > 1, [...new Set(filt.reg)].join(','));
let seen = await cycle(page, 12);
const nflList = await page.evaluate(() => SPORT_MODES.nfl.screens);
check('NFL rotation: only NFL slides', seen.every(s => nflList.includes(s.k)), seen.map(s => s.k).join(' > '));
check('NFL rotation: fantasy + NFL futures + awards + standings appear', ['fantasy', 'nflFutures', 'nflAwards', 'nfl', 'news'].every(k => seen.some(s => s.k === k)));
check('NFL rotation: a slide is always visible', seen.every(s => s.vis === 1));
await goSlide(page, 'live');
await page.screenshot({ path: path.join(OUT, 'nfl-mode-live.png') });
await goSlide(page, 'news');
const nfln = await page.evaluate(() => ({ h: document.querySelector('#news-screen .screen-header').textContent, n: document.querySelectorAll('#news-list-track .news-row').length }));
check('NFL news from ESPN NFL feed', nfln.h === 'NFL HEADLINES' && nfln.n >= 5, JSON.stringify(nfln));
await page.screenshot({ path: path.join(OUT, 'nfl-mode-news.png') });
await goSlide(page, 'nflFutures');
await page.screenshot({ path: path.join(OUT, 'nfl-mode-futures.png') });
// navigator menu
await page.keyboard.press('ArrowDown'); await sleep(600);
const menu = await page.evaluate(() => ({ slides: [...document.querySelectorAll('#nav-grid .nav-item')].map(b => b.getAttribute('data-slide')), games: [...document.querySelectorAll('#nav-games [data-gc]')].map(e => e.getAttribute('data-gc').split(':')[0]) }));
check('navigator lists only NFL slides + NFL games', menu.slides.join() === nflList.join() && menu.games.every(g => g === 'nfl'), menu.slides.join(',') + ' / ' + [...new Set(menu.games)].join(','));
await page.screenshot({ path: path.join(OUT, 'nfl-mode-menu.png') });
await page.keyboard.press('Escape'); await sleep(300);
// Gamecast + celebration still work
const anyNfl = await page.evaluate(() => Object.keys(gcRegistry).find(k => k.indexOf('nfl:') === 0) || Object.keys(gcRegistry)[0]);
await page.evaluate(k => gcOpen(k), anyNfl); await sleep(4000);
const gco = await page.evaluate(() => ({ open: gc.open, txt: (document.getElementById('gamecast') || {}).textContent.length }));
await page.evaluate(() => gcClose()); await sleep(300);
check('Gamecast opens + closes in NFL mode', gco.open && gco.txt > 50 && await page.evaluate(() => !gc.open), anyNfl);
await page.evaluate(() => arcadeCelebrate('td')); await sleep(800);
check('celebration still fires in a mode', await page.evaluate(() => cel.showing));
await page.evaluate(() => celHide(true)); await sleep(300);

// ===== 2. reload keeps the mode
await load(page);
const afterReload = await page.evaluate(() => ({ m: smActive(), pill: document.getElementById('sm-pill').textContent, scr: arcadeScreens().join() }));
check('mode survives a reload', afterReload.m === 'nfl' && /NFL MODE/.test(afterReload.pill), JSON.stringify(afterReload));

// ===== 3. switch to CFB (snapshot kept from before NFL mode)
const snap0 = JSON.parse(await ls(page, 'ahlersSportMode1')).snap;
await page.evaluate(() => { toggleSettings(); }); await sleep(300);
await page.click('.sm-btn[data-sm="cfb"]'); await sleep(300);
await page.evaluate(() => toggleSettings()); await sleep(4500);
st = JSON.parse(await ls(page, 'ahlersSportMode1'));
check('switch NFL -> CFB keeps the original snapshot', st.mode === 'cfb' && JSON.stringify(st.snap) === JSON.stringify(snap0));
const cfbG = await page.evaluate(() => [...new Set(globalRawGames.map(g => g.league))]);
check('CFB mode: games limited to CFB', cfbG.every(l => l === 'CFB'), cfbG.join(','));
seen = await cycle(page, 10);
const cfbList = await page.evaluate(() => SPORT_MODES.cfb.screens);
check('CFB rotation: only CFB slides incl. rankings + CFB futures', seen.every(s => cfbList.includes(s.k)) && ['rankings', 'cfbFutures'].every(k => seen.some(s => s.k === k)), seen.map(s => s.k).join(' > '));
await goSlide(page, 'live');
await page.screenshot({ path: path.join(OUT, 'cfb-mode-live.png') });
await goSlide(page, 'rankings');
const cfbr = await page.evaluate(() => ({ h: document.querySelector('#rankings-screen .screen-header').textContent, n: document.querySelectorAll('#rankings-list-track .rank-row').length }));
check('CFB rankings slide', cfbr.h === 'COLLEGE RANKINGS' && cfbr.n === 25, JSON.stringify(cfbr));
await page.screenshot({ path: path.join(OUT, 'cfb-mode-rankings.png') });
await goSlide(page, 'cfbFutures');
await page.screenshot({ path: path.join(OUT, 'cfb-mode-futures.png') });

// ===== 4. CBB mode with real data
await page.evaluate(() => smSet('cbb')); await sleep(4500);
const cbbG = await page.evaluate(() => ({ leagues: [...new Set(globalRawGames.map(g => g.league))], n: globalRawGames.length }));
check('CBB mode: games limited to CBB', cbbG.leagues.every(l => l === 'CBB'), JSON.stringify(cbbG));
await goSlide(page, 'live');
const cbbLive = await page.evaluate(() => document.getElementById('live-grid-track').textContent.slice(0, 80));
check('CBB live slide shows games or a CBB empty state', /LIVE|COLLEGE BASKETBALL|UP NEXT|FINAL/i.test(cbbLive), cbbLive);
await page.screenshot({ path: path.join(OUT, 'cbb-mode-live.png') });
await goSlide(page, 'rankings');
const cbbr = await page.evaluate(() => ({ h: document.querySelector('#rankings-screen .screen-header').textContent, n: document.querySelectorAll('#rankings-list-track .rank-row').length, first: (document.querySelector('#rankings-list-track .rank-row') || {}).textContent }));
check('CBB rankings (AP top 25)', /HOOPS TOP 25/.test(cbbr.h) && cbbr.n >= 20, JSON.stringify(cbbr));
await page.screenshot({ path: path.join(OUT, 'cbb-mode-rankings.png') });
await goSlide(page, 'futures', 60000);
await page.waitForFunction(() => document.querySelectorAll('#futures-track .division-block').length > 0 || /NO FUTURES|FEED DOWN/.test(document.getElementById('futures-track').textContent), { timeout: 60000 }).catch(() => {});
await freeze(page);
const cbbf = await page.evaluate(() => ({ h: document.querySelector('#futures-screen .screen-header').textContent, secs: [...document.querySelectorAll('#futures-track .division-header')].map(e => e.textContent) }));
check('CBB futures (national title etc.)', cbbf.h === 'COLLEGE HOOPS FUTURES' && cbbf.secs.includes('NATIONAL TITLE'), JSON.stringify(cbbf));
await page.screenshot({ path: path.join(OUT, 'cbb-mode-futures.png') });
await goSlide(page, 'news');
const cbbn = await page.evaluate(() => ({ h: document.querySelector('#news-screen .screen-header').textContent, n: document.querySelectorAll('#news-list-track .news-row').length }));
check('CBB news (ESPN men\'s college hoops)', cbbn.h === 'HOOPS HEADLINES' && cbbn.n >= 5, JSON.stringify(cbbn));
await page.screenshot({ path: path.join(OUT, 'cbb-mode-news.png') });
seen = await cycle(page, 10);
check('CBB rotation never empty, a slide always visible', seen.length === 10 && seen.every(s => s.vis === 1) && new Set(seen.map(s => s.k)).size >= 3, seen.map(s => s.k).join(' > '));

// ===== 5. turn off early -> exactly the user's settings, full rotation
await page.evaluate(() => { toggleSettings(); }); await sleep(300);
await page.click('.sm-btn[data-sm=""]'); await sleep(300);
await page.evaluate(() => toggleSettings()); await sleep(4000);
const off = await page.evaluate(() => ({ m: smActive(), ls: localStorage.getItem('ahlersSportMode1'), pill: getComputedStyle(document.getElementById('sm-pill')).display, scr: arcadeScreens() === ARCADE_SCREENS, s: JSON.stringify(settings), leagues: [...new Set(globalRawGames.map(g => g.league))].length }));
check('OFF early: mode cleared, pill hidden, full rotation + all leagues back', !off.m && off.ls === null && off.pill === 'none' && off.scr && off.leagues > 2, JSON.stringify({ ...off, s: undefined }));
check('OFF early: settings exactly as before', off.s === userSnap);

// ===== 6. 12 h expiry with a simulated clock; settings changed during the mode are restored to the snapshot
await page.evaluate(() => smSet('nfl')); await sleep(3500);
await page.evaluate(() => { settings.trivia = false; settings.showNHL = false; localStorage.setItem('ahlersArcadeSettings', JSON.stringify(settings)); });
await page.evaluate(() => { const real = Date.now.bind(Date); window.__smOff = 11 * 3600000 + 59 * 60000; Date.now = () => real() + window.__smOff; });
await sleep(1500);
const at1159 = await page.evaluate(() => ({ m: smActive(), pill: document.getElementById('sm-pill').textContent }));
check('11 h 59 m later: still on, pill shows 0:00/0:01 left', at1159.m === 'nfl' && /0:0[01] LEFT/.test(at1159.pill), at1159.pill);
await page.evaluate(() => { window.__smOff = 12 * 3600000 + 2000; });
await sleep(2500);
const exp = await page.evaluate(() => ({ m: smActive(), ls: localStorage.getItem('ahlersSportMode1'), pill: getComputedStyle(document.getElementById('sm-pill')).display, scr: arcadeScreens() === ARCADE_SCREENS,
  trivia: settings.trivia, nhl: settings.showNHL, saved: JSON.parse(localStorage.getItem('ahlersArcadeSettings')), hud: document.getElementById('nav-hud').textContent }));
check('12 h later: mode expires on its own', !exp.m && exp.ls === null && exp.pill === 'none' && exp.scr, JSON.stringify({ m: exp.m, ls: exp.ls, pill: exp.pill }));
check('12 h later: slide/league toggles restored from the snapshot (memory + localStorage)', exp.trivia === true && exp.nhl === true && exp.saved.trivia === true && exp.saved.showNHL === true);
check('12 h later: HUD says the mode ended', /SPORT MODE ENDED/.test(exp.hud), exp.hud);
await sleep(4000);
const leaguesBack = await page.evaluate(() => [...new Set(globalRawGames.map(g => g.league))]);
check('12 h later: every league back in the lists', leaguesBack.length > 2, leaguesBack.join(','));
await page.evaluate(() => { window.__smOff = 0; });

// ===== 7. expiry found on reload (TV was off when the 12 h ran out)
await page.evaluate(() => { const now = Date.now(); localStorage.setItem('ahlersSportMode1', JSON.stringify({ mode: 'cfb', start: now - 13 * 3600000, until: now - 3600000, snap: Object.assign({}, JSON.parse(JSON.stringify(settings)), { trivia: true, ufc: false }), step: 3 })); settings.ufc = true; localStorage.setItem('ahlersArcadeSettings', JSON.stringify(settings)); });
await load(page);
const rel = await page.evaluate(() => ({ m: smActive(), ls: localStorage.getItem('ahlersSportMode1'), ufc: settings.ufc, scr: arcadeScreens() === ARCADE_SCREENS }));
check('expired while off: cleared on load and snapshot restored', !rel.m && rel.ls === null && rel.ufc === false && rel.scr, JSON.stringify(rel));
await page.evaluate(() => { settings.ufc = true; localStorage.setItem('ahlersArcadeSettings', JSON.stringify(settings)); });
await page.close();

// ===== 8. empty sport (no CBB games at all): still a rotation, empty data slides skipped
const p2 = await browser.newPage(); await setupPage(p2, { emptyCbb: true }); await load(p2);
await p2.evaluate(() => smSet('cbb')); await sleep(4500);
const emp = await p2.evaluate(() => ({ n: globalRawGames.length, props: smSlideEmpty('props'), odds: smSlideEmpty('odds'), tv: smSlideEmpty('tvGuide') }));
check('empty CBB: no games, data slides flagged empty', emp.n === 0 && emp.props && emp.odds && emp.tv, JSON.stringify(emp));
const es = await cycle(p2, 8);
check('empty CBB: rotation keeps going (live + rankings + futures + news)', es.every(s => s.vis === 1) && ['live', 'rankings', 'news'].every(k => es.some(s => s.k === k)) && !es.some(s => ['props', 'odds', 'tvGuide'].includes(s.k)), es.map(s => s.k).join(' > '));
await goSlide(p2, 'live');
const et = await p2.evaluate(() => document.getElementById('live-grid-track').textContent.trim());
check('empty CBB: live slide says NO COLLEGE BASKETBALL GAMES ON THE BOARD', /NO COLLEGE BASKETBALL GAMES ON THE BOARD/.test(et), et);
await p2.screenshot({ path: path.join(OUT, 'cbb-mode-empty-live.png') });
await p2.evaluate(() => smSet('')); await sleep(500);
await p2.close();

check('mode pill never overlaps a slide title', overlaps.length === 0, overlaps.join(' | '));
check('0 console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log('screenshots:', OUT);
await browser.close(); srv.close();
console.log(fails ? `FAIL (${fails})` : 'ALL PASS');
process.exit(fails ? 1 : 0);
