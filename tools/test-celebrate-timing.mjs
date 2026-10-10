#!/usr/bin/env node
// Celebration / alert TIMING checks (run from repo root):  node tools/test-celebrate-timing.mjs [preview.html]
// Emulates the TV app (window.ArcadeTV => Lite forced) at 1280x720 and checks: big celebrations stay ~6 s, smaller
// Every celebration and alert banner stays 9 s (visible at 8.5 s, gone at ~9.0 s); every pulse/flash/ring/beat loops 3x (3 s each, not a 1 s burst), the strips
// scroll at a calm length-independent speed, back-to-back events queue with the new length, and Full effects use the
// same slowed loop, and player photos (TD scorer, interceptor, big-play chip). Frames at t=0.5 / 4.5 / 8.5 s go to tools/out/<stamp>-celtiming/.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(REPO, 'tools', 'out', `${stamp}-celtiming`); fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : (f.endsWith('.json') ? 'application/json' : 'application/octet-stream') }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const shots = [];
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const isNoise = t => /Failed to load resource/.test(t) || /favicon/.test(t);
const errors = [];

async function openPage(tv) {
  const page = await browser.newPage();
  await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: 1280, height: 720 });
  page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text() + ' ' + ((m.location() || {}).url || ''))) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
  if (tv) await page.evaluateOnNewDocument(() => { window.ArcadeTV = {}; }); // the TV app's bridge object => Lite forced
  await page.goto(base + FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current && typeof arcadeCelebrate === 'function', { timeout: 90000 });
  await page.evaluate(() => { arcadeNav.paused = true; });
  return page;
}
// state of the overlay: visible?, opacity, and the loop position of each looping animation
const probe = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel); const cs = getComputedStyle(el);
  const anims = el.getAnimations({ subtree: true }).map(a => { const t = a.effect.getComputedTiming(); const tg = a.effect.target;
    return { name: a.animationName, on: (tg.id || tg.className || '').toString().slice(0, 24), dur: Math.round(t.duration), it: t.iterations, cur: t.currentIteration, prog: t.progress == null ? null : +t.progress.toFixed(2) }; });
  const mq = document.querySelector('#celebrate .cel-mq.m1');
  return { display: cs.display, opacity: +(+cs.opacity).toFixed(2), anims, mq1: mq ? getComputedStyle(mq).transform : '' };
}, sel);
// fire, then capture frames at the given offsets and poll until it is gone; returns frames + measured on-screen time
async function run(page, kind, sel, flag, offsets, label) {
  await page.evaluate(k => { arcadeCelebrate(k); }, kind);
  const t0 = Date.now(); const frames = [];
  for (const off of offsets) {
    await sleep(Math.max(0, off - (Date.now() - t0)));
    const at = Date.now() - t0; const p = await probe(page, sel);
    const f = path.join(OUT, `${label}-t${(off / 1000).toFixed(1)}s.png`); await page.screenshot({ path: f }); shots.push(f);
    frames.push({ at, ...p, showing: await page.evaluate(f => cel[f], flag) });
  }
  while (await page.evaluate(f => cel[f], flag)) { if (Date.now() - t0 > 15000) break; await sleep(50); }
  return { frames, total: Date.now() - t0 };
}
const loopAnim = (fr, name) => (fr.anims.find(a => a.name === name) || {});
const fmt = r => r.frames.map(f => `t=${(f.at / 1000).toFixed(2)}s op=${f.opacity} ${f.showing ? 'ON' : 'off'}`).join(', ') + ` | gone after ${(r.total / 1000).toFixed(2)} s`;

// ---------- TV (Lite forced) ----------
const tv = await openPage(true);
const lite = await tv.evaluate(() => celLite());
check('TV app bridge present -> Lite effects forced', lite === true);
const consts = await tv.evaluate(() => ({ CEL_MS, CEL_BIG_MS, CEL_MINI_MS, CEL_ALERT_MS, CEL_LOOPS }));
check('timings: every celebration and alert 9 s, 3 loops', consts.CEL_BIG_MS === 9000 && consts.CEL_MS === 9000 && consts.CEL_MINI_MS === 9000 && consts.CEL_ALERT_MS === 9000 && consts.CEL_LOOPS === 3, JSON.stringify(consts));

// big: TOUCHDOWN (Lite)
const F = [500, 4500, 8500];
const photo = page => page.evaluate(() => { const h = document.getElementById('cel-head'); return { has: document.getElementById('celebrate').classList.contains('has-player'), src: h.getAttribute('src') || '', ok: h.complete && h.naturalWidth > 0, name: document.getElementById('cel-pname').textContent }; });
let r = await run(tv, 'td', '#celebrate', 'showing', F, 'lite-td-photo');
check('TOUCHDOWN!! (Lite) on screen at 0.5 s, 4.5 s and 8.5 s', r.frames.every(f => f.showing && f.display === 'block' && f.opacity >= 0.9), fmt(r));
check('TOUCHDOWN!! (Lite) gone at ~9.0 s', r.total >= 8900 && r.total <= 9400, `${r.total} ms`);
let fl = r.frames.map(f => loopAnim(f, 'cel-lite-flash'));
check('Lite flash/glow loops 3x at 3 s (iteration 0 -> 1 -> 2 at 0.5/4.5/8.5 s), not one 1 s burst', fl[0].dur === 3000 && fl[0].it === 3 && fl[0].cur === 0 && fl[1].cur === 1 && fl[2].cur === 2, JSON.stringify(fl));
let rg = r.frames.map(f => loopAnim(f, 'cel-lite-ring'));
check('Lite ring pulse (transform/opacity) loops 3x at 3 s', rg[0].dur === 3000 && rg[0].it === 3 && rg[1].cur === 1 && rg[2].cur === 2, JSON.stringify(rg.map(a => a.cur)));
let bt = r.frames.map(f => f.anims.filter(a => a.name === 'cel-beat'));
check('Lite logo: scale-in then slow 3 s beat x3 (still beating at 4.5 s and 8.5 s)', bt[1].length && bt[1][0].dur === 3000 && bt[1][0].it === 3 && bt[2].length && bt[2][0].cur >= 1, JSON.stringify(bt.map(b => b.map(a => a.cur))));
check('strips still scrolling (transform changes between frames)', new Set(r.frames.map(f => f.mq1)).size === 3, r.frames.map(f => f.mq1.slice(0, 40)).join(' | '));
const lp = await tv.evaluate(() => { const props = new Set(); document.getAnimations().forEach(a => { (a.effect.getKeyframes() || []).forEach(k => Object.keys(k).forEach(p => { if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p); })); }); return [...props]; });
check('Lite stays GPU-light: only transform/opacity are animated', lp.length > 0 && lp.every(p => p === 'transform' || p === 'opacity'), lp.join(','));

// interception: the full-screen turnover moment with the interceptor's photo
r = await run(tv, 'int', '#celebrate', 'showing', F, 'lite-interception-photo');
await tv.evaluate(() => arcadeCelebrate('int')); await sleep(1500); const ipo = await photo(tv); await tv.evaluate(() => celHide(true));
check('INTERCEPTION!! (Lite) on screen 0.5/4.5/8.5 s, gone ~9 s, interceptor headshot loaded', r.frames.every(f => f.showing && f.opacity >= 0.9) && r.total >= 8900 && r.total <= 9400 && ipo.has && ipo.ok && ipo.name === 'ANGELO ROSS', fmt(r) + ' ' + JSON.stringify(ipo));
await tv.evaluate(() => arcadeCelebrate('td')); await sleep(1500); const tpo = await photo(tv); await tv.evaluate(() => celHide(true));
check('TOUCHDOWN!! shows the scorer headshot + name tag (Aho-card layout)', tpo.has && tpo.ok && tpo.name === 'TJ ENGLEMAN JR.', JSON.stringify(tpo));
// strip speed: px/s for a short and a long word (must be calm and similar)
await tv.evaluate(() => arcadeCelebrate('td')); await sleep(300);
const sp1 = await tv.evaluate(() => { const e = document.getElementById('cel-mq1'); return e.scrollWidth / 2 / (parseFloat(e.parentNode.style.animationDuration) / 1000); });
await tv.evaluate(() => arcadeCelebrate('goal')); await sleep(300);
const sp2 = await tv.evaluate(() => { const e = document.getElementById('cel-mq1'); return e.scrollWidth / 2 / (parseFloat(e.parentNode.style.animationDuration) / 1000); });
await tv.evaluate(() => celHide(true));
check('strip speed calm (<= 0.6 screen-widths/s at 720p) and length-independent', sp1 / 1280 <= 0.6 && sp2 / 1280 <= 0.6 && Math.abs(sp1 - sp2) / sp1 < 0.3, `TD ${Math.round(sp1)} px/s, GOAL+name ${Math.round(sp2)} px/s`);

// smaller moment: HALFTIME (Lite) also 9 s, team-logo layout
r = await run(tv, 'half', '#celebrate', 'showing', F, 'lite-halftime');
check('HALFTIME! on screen at 0.5/4.5/8.5 s, gone ~9 s', r.frames.every(f => f.showing && f.opacity >= 0.9) && r.total >= 8900 && r.total <= 9400, fmt(r));
fl = r.frames.map(f => loopAnim(f, 'cel-lite-flash'));
check('HALFTIME! loops 3x at 3 s', fl[0].dur === 3000 && fl[0].it === 3 && fl[2].cur === 2, JSON.stringify(fl.map(a => a.cur)));

// alert banner: BIG PLAY with the player chip (Lite) 9 s
r = await run(tv, 'big', '#cel-alert', 'alShowing', F, 'lite-alert-bigplay-chip');
check('BIG PLAY! banner on screen at 0.5/4.5/8.5 s, gone ~9 s', r.frames.every(f => f.showing && f.display === 'block' && f.opacity >= 0.9) && r.total >= 8900 && r.total <= 9400, fmt(r));
await tv.evaluate(() => arcadeCelebrate('big')); await sleep(1500);
const chip = await tv.evaluate(() => { const h = document.getElementById('al-head'), n = document.getElementById('al-pname'), bar = document.querySelector('#cel-alert .al-bar').getBoundingClientRect(), nb = n.getBoundingClientRect(), tb = document.getElementById('al-tag').getBoundingClientRect();
  return { ok: h.complete && h.naturalWidth > 0, vis: getComputedStyle(h).display, name: n.textContent, inBar: nb.right <= tb.left + 1 && nb.bottom <= bar.bottom }; });
await tv.evaluate(() => { alHide(true); cel.aq = []; });
check('banner shows the player headshot + name chip inside the bar', chip.ok && chip.vis === 'block' && chip.name === 'DILLON LORICK' && chip.inBar, JSON.stringify(chip));
const sh = r.frames.map(f => loopAnim(f, 'cel-sweep')), lb = r.frames.map(f => loopAnim(f, 'cel-beat'));
check('banner shine + logo beat loop 3x at 3 s (Lite)', sh[0].dur === 3000 && sh[0].it === 3 && sh[1].cur === 1 && sh[2].cur === 2 && lb[0].it === 3 && lb[2].cur === 2, JSON.stringify({ shine: sh.map(a => a.cur), logo: lb.map(a => a.cur) }));

// queueing: GOAL -> TD -> WIN back to back, each with the full new length
await tv.evaluate(() => arcadeCelebrate('test')); const q0 = Date.now(); const seen = [];
let lastAt = 0;
while (Date.now() - q0 < 32000) { const s = await tv.evaluate(() => ({ at: cel.last && cel.last.at, t: cel.last && cel.last.text, showing: cel.showing, q: cel.queue.length })); if (s.at !== lastAt && s.showing) { seen.push({ t: s.t, ms: Date.now() - q0 }); lastAt = s.at; } if (!s.showing && !s.q && seen.length >= 3) break; await sleep(50); }
const qEnd = Date.now() - q0;
const gaps = seen.slice(1).map((s, i) => s.ms - seen[i].ms);
check('back-to-back GOAL -> TD -> WIN queue, each 9 s + 0.35 s gap (no pile-up)', seen.map(s => s.t).join(',') === 'GOAL!!,TOUCHDOWN!!,CANES WIN!!' && gaps.every(g => g >= 9100 && g <= 9900) && qEnd >= 27000 && qEnd <= 29500, `${seen.map(s => s.t + '@' + (s.ms / 1000).toFixed(1)).join(' ')}; done ${(qEnd / 1000).toFixed(1)} s`);
// a big moment while a banner is up takes over; banners wait behind a celebration
await tv.evaluate(() => { celHide(true); alHide(true); cel.aq = []; arcadeCelebrate('goal'); alShow({ alert: 'pp', text: 'POWER PLAY!' }, CEL_DEMO.goal.T, 'TEST'); });
const wq = await tv.evaluate(() => ({ cel: cel.showing, al: cel.alShowing, aq: cel.aq.length }));
const t1 = Date.now(); await tv.waitForFunction(() => cel.alShowing, { timeout: 12000 }).catch(() => {}); const alAfter = Date.now() - t1;
check('a banner during a celebration waits, then shows after it (~9 s)', wq.cel && !wq.al && wq.aq === 1 && alAfter >= 8300 && alAfter <= 10000, JSON.stringify(wq) + ` banner after ${(alAfter / 1000).toFixed(1)} s`);
await tv.evaluate(() => { celHide(true); alHide(true); cel.aq = []; });
// a banner cut off early by a big moment plays again after it
await tv.evaluate(() => { alShow({ alert: 'redzone', text: 'RED ZONE!' }, CEL_DEMO.td.T, '1st & 10'); });
await sleep(1000); await tv.evaluate(() => celShow({ text: 'TOUCHDOWN!!', big: true }, CEL_DEMO.td.T, 'ECU 27 - 24 TEM')); // the live path (celPump -> celShow), not the demo hook that clears everything
const pre = await tv.evaluate(() => ({ cel: cel.showing, al: cel.alShowing, aq: cel.aq.length && cel.aq[0][0].text }));
await tv.waitForFunction(() => cel.alShowing, { timeout: 12000 }).catch(() => {});
const back = await tv.evaluate(() => cel.alShowing && cel.alLast.text);
check('a banner interrupted in its first half by a celebration is replayed afterwards', pre.cel && !pre.al && pre.aq === 'RED ZONE!' && back === 'RED ZONE!', JSON.stringify({ pre, back }));
await tv.evaluate(() => { celHide(true); alHide(true); cel.aq = []; });
await tv.close();

// ---------- Full effects (desktop browser, Full chosen) ----------
const full = await openPage(false);
await full.evaluate(() => { settings.celFull = true; });
r = await run(full, 'win', '#celebrate', 'showing', F, 'full-win');
check('CANES WIN!! (Full) on screen at 0.5/4.5/8.5 s, gone ~9 s', r.frames.every(f => f.showing && f.opacity >= 0.9) && r.total >= 8900 && r.total <= 9400, fmt(r));
const pu = r.frames.map(f => loopAnim(f, 'cel-pulse')), sw = loopAnim(r.frames[1], 'cel-swing'), ri = loopAnim(r.frames[1], 'cel-ring'), bf = r.frames[1].anims.find(a => a.name === 'cel-beat');
check('Full strobe slowed: 3 calm flash+glow cycles of 3 s (was 0.36 s x8), beams 1.5 s swings, rings 3 s, beat 1.5 s', pu[0].dur === 3000 && pu[0].it === 3 && pu[1].cur === 1 && pu[2].cur === 2 && sw.dur === 1500 && ri.dur === 3000 && bf && bf.dur === 1500, JSON.stringify({ pulse: pu.map(a => a.cur), swing: sw.dur, ring: ri.dur, beat: bf && bf.dur }));
r = await run(full, 'big', '#cel-alert', 'alShowing', F, 'full-alert-bigplay');
check('BIG PLAY! banner (Full) on screen at 0.5/4.5/8.5 s, gone ~9 s', r.frames.every(f => f.showing && f.opacity >= 0.9) && r.total >= 8900 && r.total <= 9400, fmt(r));
await full.close();

check('no console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log('\nScreenshots:\n' + shots.map(s => '  ' + path.relative(REPO, s)).join('\n'));
await browser.close(); srv.close();
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL TIMING CHECKS PASSED');
process.exit(fails ? 1 : 0);
