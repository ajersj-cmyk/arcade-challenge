#!/usr/bin/env node
// Remote card picker on LIVE ACTION / MY SQUAD / TODAY'S LINES (run from repo root):
//   node tools/test-livenav.mjs [preview.html]
// Emulates the TV app (window.ArcadeTV, 1280x720) with real ESPN scoreboards. To get a long, scrolling list every time,
// LIVE ACTION is filled with 10 of today's real games (any state) from the page's own data.
// Checks: DOWN starts the picker (ring on a card, HUD), arrows walk the 2-column grid, the list scrolls to keep the card in
// view (above the ticker), rotation + auto-scroll hold while picking, OK opens that card's Gamecast, BACK closes it and keeps
// the ring, BACK ends the picker (rotation resumes), idle timeout ends it (fresh scroll pass, or next slide if its time ran
// out), the TV app's navBack() bridge, a forced slide change (phone remote), OK on the kiosk still opens the navigator,
// DOWN on a slide without cards still opens the navigator, My Squad + Today's Lines cards, 0 console errors.
// Screenshots: tools/out/<ts>-livenav/.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const OUT = path.join(REPO, 'tools', 'out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-livenav'); fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const page = await browser.newPage();
await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: 1280, height: 720 });
await page.evaluateOnNewDocument(() => { window.ArcadeTV = {}; });
const isNoise = t => /Failed to load resource/.test(t) || /favicon/.test(t);
const errors = []; page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
const shot = async name => { const p = path.join(OUT, name + '.png'); await page.screenshot({ path: p }); console.log('      shot ' + p); return p; };
const key = async (k, wait = 260) => { await page.keyboard.press(k); await sleep(wait); };

await page.goto(base + FILE, { waitUntil: 'load' });
await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current && typeof lvNavStart === 'function' && globalRawGames.length > 0, { timeout: 120000 });
await sleep(1500);
const st = () => page.evaluate(() => {
  const f = document.querySelector('.lvn-focus'), tr = lvNav.cfg && document.getElementById(lvNav.cfg.track);
  const vis = [...document.querySelectorAll('.slide-screen')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id).join('+');
  let inView = null;
  if (f && tr) { const c = tr.parentElement.getBoundingClientRect(), r = f.getBoundingClientRect(), tick = document.getElementById('sports-ticker');
    const tTop = tick ? tick.getBoundingClientRect().top : innerHeight; inView = r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.bottom <= tTop + 1; }
  return { on: lvNav.on, focus: f ? f.getAttribute('data-gc') : null, nFocus: document.querySelectorAll('.lvn-focus').length, idx: f ? [...document.querySelectorAll('#' + (lvNav.cfg || { track: 'live-grid-track' }).track + ' [data-gc]')].indexOf(f) : -1,
    rect: f ? (({ left, top, bottom }) => ({ left: Math.round(left), top: Math.round(top), bottom: Math.round(bottom) }))(f.getBoundingClientRect()) : null, inView,
    ty: lvNav.ty, anim: tr ? tr.style.animation : '', slide: vis, current: arcadeNav.current, pending: arcadeNav.pending, gcOpen: gc.open, gcKey: gc.key,
    menu: arcadeNav.menuOpen, hud: document.getElementById('nav-hud').classList.contains('show') ? document.getElementById('nav-hud').textContent : '' };
});
// 10 real games on LIVE ACTION (any state), so the 2-column grid has 5 rows and must scroll at 720p
const setupLive = async () => { await page.evaluate(() => {
  lvNavOff(true); if (gc.open) gcClose(); if (arcadeNav.menuOpen) navCloseMenu(true); arcadeNav.pending = false;
  globalLiveGamesData = globalRawGames.filter(g => g.gcKey && gcRegistry[g.gcKey]).slice(0, 10);
  navForceSlide(arcadeScreens().indexOf('live'));
}); await sleep(1600); };
await page.evaluate(() => { LVN_IDLE_MS = 25000; });
await setupLive();
const nCards = await page.evaluate(() => document.querySelectorAll('#live-grid-track [data-gc]').length);
check('LIVE ACTION shows the test games as Gamecast cards', nCards >= 6, `${nCards} cards`);

// --- DOWN starts the picker
let s = await st();
check('kiosk: no card ring before any key', !s.on && s.nFocus === 0);
await key('ArrowDown', 400);
s = await st();
check('DOWN on LIVE ACTION starts the picker: one card ringed, HUD hint, auto-scroll frozen', s.on && s.nFocus === 1 && s.idx === 0 && /PICK A GAME/.test(s.hud) && !/scrollVerticalOnePass/.test(s.anim) && !s.menu, JSON.stringify({ idx: s.idx, hud: s.hud, anim: s.anim }));
await shot('01-picker-first-card');
const ring = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.lvn-focus')); return { outline: c.outlineStyle + ' ' + c.outlineWidth, shadow: c.boxShadow.slice(0, 60), after: getComputedStyle(document.querySelector('.lvn-focus'), '::after').content }; });
check('focused card has a visible neon ring + "OK ▶ GAMECAST" tag', /solid/.test(ring.outline) && /rgb/.test(ring.shadow) && /GAMECAST/.test(ring.after), JSON.stringify(ring));

// --- arrows walk the 2-column grid
const s0 = s;
await key('ArrowRight'); s = await st();
check('RIGHT moves to the card beside it (same row)', s.idx === 1 && Math.abs(s.rect.top - s0.rect.top) < 4 && s.rect.left > s0.rect.left, `idx ${s0.idx} -> ${s.idx}`);
await key('ArrowRight'); const sR = await st();
check('RIGHT at the right edge stays put (no slide change)', sR.idx === 1 && sR.current === 'live' && sR.on, `idx ${sR.idx}, slide ${sR.current}`);
await key('ArrowLeft'); s = await st();
check('LEFT moves back', s.idx === 0, `idx ${s.idx}`);
await key('ArrowLeft'); s = await st();
check('LEFT at the left edge stays put (no slide change)', s.idx === 0 && s.current === 'live' && s.on);
await key('ArrowUp'); s = await st();
check('UP on the top row stays in the picker', s.idx === 0 && s.on && s.ty === 0);
// rotation holds while picking: the slide timer firing only marks it pending
await page.evaluate(() => nextSlide()); await sleep(300);
s = await st();
check('rotation paused while picking (slide timer firing = pending, slide stays)', s.current === 'live' && s.slide === 'live-game-screen' && s.pending && s.on, JSON.stringify({ slide: s.slide, pending: s.pending }));
await page.evaluate(() => { arcadeNav.pending = false; });
const tys = [];
for (let i = 0; i < 4; i++) { await key('ArrowDown', 380); s = await st(); tys.push({ idx: s.idx, ty: s.ty, inView: s.inView }); }
check('DOWN walks down the column (0 -> 2 -> 4 -> 6 -> 8)', tys.map(t => t.idx).join() === '2,4,6,8', JSON.stringify(tys.map(t => t.idx)));
check('the list scrolls to keep the focused card fully in view (above the ticker)', tys.every(t => t.inView) && tys[3].ty < 0, JSON.stringify(tys));
await key('ArrowRight', 380); s = await st();
check('RIGHT on a lower row moves across (8 -> 9) and stays in view', s.idx === 9 && s.inView, `idx ${s.idx}, inView ${s.inView}`);
const lowKey = s.focus;
await sleep(200);
await shot('02-picker-lower-card');
await key('ArrowDown'); s = await st();
check('DOWN on the last row stays put', s.idx === 9 && s.on);
await key('ArrowUp', 380); s = await st();
check('UP scrolls back up when needed', s.idx === 7 && s.inView, `idx ${s.idx}, ty ${s.ty}`);
await key('ArrowDown', 380); s = await st();

// --- OK opens that game's Gamecast
await key('Enter', 400);
await page.waitForFunction(() => gc.lastOk > 0 || gc.fails > 0, { timeout: 20000 }).catch(() => {});
await sleep(2200);
s = await st();
const gcInfo = await page.evaluate(() => ({ ok: gc.lastOk > 0, shown: getComputedStyle(document.getElementById('gamecast')).display }));
check('OK opens the Gamecast of the focused card', s.gcOpen && s.gcKey === lowKey && gcInfo.ok, `focused ${lowKey}, opened ${s.gcKey}, loaded ${gcInfo.ok}`);
await shot('03-gamecast-from-card');
await page.evaluate(() => nextSlide()); await sleep(200);
await key('Escape', 600); s = await st();
check('BACK closes the Gamecast, picker + ring stay on that card, slide stays', !s.gcOpen && s.on && s.focus === lowKey && s.current === 'live', JSON.stringify({ gc: s.gcOpen, on: s.on, focus: s.focus, slide: s.current }));
check('rotation still held after closing the Gamecast (timer fired while it was open -> pending)', s.pending === true);
await key('Escape', 1500); s = await st();
check('BACK ends the picker: ring gone, rotation resumes (its time ran out -> next slide)', !s.on && s.nFocus === 0 && s.current !== 'live' && !s.pending, `slide now ${s.current}`);

// --- BACK with time left: fresh scroll pass on the same slide
await setupLive();
await key('ArrowDown'); await key('ArrowDown'); await key('Escape', 700);
s = await st();
const sp = await page.evaluate(() => ({ anim: document.getElementById('live-grid-track').style.animation, timer: !!slideTimer }));
check('BACK with slide time left: stays on LIVE ACTION, auto-scroll + slide timer restart', !s.on && s.current === 'live' && /scrollVerticalOnePass/.test(sp.anim) && sp.timer, JSON.stringify(sp));

// --- idle timeout ends the picker and resumes rotation
await page.evaluate(() => { LVN_IDLE_MS = 3000; });
await setupLive();
await key('ArrowDown'); await key('ArrowRight');
await sleep(1500); s = await st();
check('picker still on before the idle timeout', s.on);
await sleep(2200); s = await st();
const sp2 = await page.evaluate(() => ({ anim: document.getElementById('live-grid-track').style.animation, timer: !!slideTimer }));
check('no input for LVN_IDLE_MS -> picker ends by itself, scroll pass + timer restart', !s.on && s.nFocus === 0 && s.current === 'live' && /scrollVerticalOnePass/.test(sp2.anim) && sp2.timer, JSON.stringify({ on: s.on, ...sp2 }));
await setupLive();
await key('ArrowDown'); await page.evaluate(() => nextSlide()); await sleep(3600); s = await st();
check('idle timeout after the slide timer fired -> rotation moves on', !s.on && s.current !== 'live', `slide now ${s.current}`);
// idle never ends it under an open Gamecast
await setupLive();
await key('ArrowDown'); await key('Enter', 4500); s = await st();
check('idle timeout waits while the Gamecast is open', s.on && s.gcOpen);
await key('Escape', 500); s = await st();
check('closing the Gamecast restarts the idle clock (picker still on)', s.on && !s.gcOpen);
await sleep(3500); s = await st();
check('...and it ends after the idle time', !s.on);
await page.evaluate(() => { LVN_IDLE_MS = 25000; });

// --- the TV app's BACK bridge + forced slide changes
await setupLive();
await key('ArrowDown');
const nb = await page.evaluate(() => navBack()); await sleep(400); s = await st();
check('TV app BACK (navBack()) ends the picker and reports it handled BACK', nb === true && !s.on && s.nFocus === 0);
const nb2 = await page.evaluate(() => navBack());
check('next navBack() with nothing open returns false (app shows its exit dialog)', nb2 === false);
await setupLive();
await key('ArrowDown');
await page.evaluate(() => navStep(1)); await sleep(900); s = await st();
check('phone remote NEXT (forced slide change) ends the picker cleanly', !s.on && s.nFocus === 0 && s.current !== 'live', `slide ${s.current}`);
await setupLive();
await key('ArrowDown'); await key(' '); s = await st();
check('Play/Pause in the picker still toggles pause', s.on && (await page.evaluate(() => arcadeNav.paused)));
await key(' '); await key('Escape', 600);

// --- existing remote behaviour unchanged
await setupLive();
await key('Enter', 400); s = await st();
check('kiosk OK on LIVE ACTION still opens the navigator (GAMES row first)', s.menu && !s.on && (await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('gc-item'))));
await key('Escape', 300);
await key('ArrowRight', 1200); s = await st();
check('kiosk RIGHT still changes slide', s.current !== 'live', s.current);
const noCard = await page.evaluate(() => { const k = arcadeScreens().filter(x => ['news', 'trivia', 'leaders', 'command', 'pickem'].indexOf(x) >= 0 && slideOn(x))[0]; navForceSlide(arcadeScreens().indexOf(k)); return k; });
await sleep(1200); await key('ArrowDown', 400); s = await st();
check(`DOWN on a slide without game cards (${noCard}) still opens the navigator`, s.menu && !s.on);
await key('Escape', 300);
await key('ArrowUp', 300);
check('kiosk UP still focuses the settings gear', await page.evaluate(() => document.activeElement && document.activeElement.id === 'settings-gear'));
await key('ArrowDown', 300);

// --- My Squad + Today's Lines
const squad = await page.evaluate(() => {
  const g = globalRawGames.filter(x => x.gcKey && gcRegistry[x.gcKey]).slice(0, 4); settings.mySquadTeams = g.map(x => x.away).join(',');
  navForceSlide(arcadeScreens().indexOf('mySquad')); return g.length; });
await sleep(1500);
const sqCards = await page.evaluate(() => document.querySelectorAll('#squad-games-track [data-gc]').length);
if (sqCards) {
  await key('ArrowDown'); s = await st();
  check('MY SQUAD: DOWN starts the picker', s.on && s.nFocus === 1 && s.idx === 0);
  await key('ArrowDown', 380); s = await st();
  check('MY SQUAD: DOWN moves to the next card, in view', s.idx === 1 && s.inView, JSON.stringify({ idx: s.idx, inView: s.inView }));
  const k2 = s.focus;
  await shot('04-mysquad-picker');
  await key('Enter', 1500); s = await st();
  check('MY SQUAD: OK opens that game', s.gcOpen && s.gcKey === k2, `${k2} -> ${s.gcKey}`);
  await key('Escape', 500); await key('Escape', 800);
} else check('MY SQUAD: cards rendered for the test teams', false, `${squad} games picked, 0 cards`);
const oddsN = await page.evaluate(() => { if (!slideOn('odds')) return -1; navForceSlide(arcadeScreens().indexOf('odds')); return 1; });
await sleep(1500);
const oc = await page.evaluate(() => ({ cards: document.querySelectorAll('#odds-grid-track [data-gc]').length, all: document.querySelectorAll('#odds-grid-track .glass-card').length }));
if (oddsN > 0 && oc.all) {
  check("TODAY'S LINES: every card carries its Gamecast key", oc.cards === oc.all, JSON.stringify(oc));
  await key('ArrowDown'); await key('ArrowRight'); s = await st();
  check("TODAY'S LINES: picker works (DOWN, RIGHT)", s.on && (oc.all < 2 || s.idx === 1), JSON.stringify({ idx: s.idx }));
  await shot('05-lines-picker');
  const k3 = s.focus; await key('Enter', 1500); s = await st();
  check("TODAY'S LINES: OK opens that game", s.gcOpen && s.gcKey === k3);
  await key('Escape', 500); await key('Escape', 800);
} else console.log("SKIP  TODAY'S LINES has no upcoming lines right now", JSON.stringify(oc));

check('0 console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${fails} failure(s). Screenshots in ${OUT}`);
await browser.close(); srv.close();
process.exit(fails ? 1 : 0);
