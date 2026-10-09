#!/usr/bin/env node
// Celebration / alert TIMING checks (run from repo root):  node tools/test-celebrate-timing.mjs [preview.html]
// Emulates the TV app (window.ArcadeTV => Lite forced) at 1280x720 and checks: big celebrations stay ~6 s, smaller
// moments and alert banners ~5 s, every pulse/flash/ring/beat loops 3x over that span (not a 1 s burst), the strips
// scroll at a calm length-independent speed, back-to-back events queue with the new length, and Full effects use the
// same slowed loop. Captures frames at t=0.5 s / 3 s / 5.5 s (alerts 0.5 / 2.5 / 4.6 s) to tools/out/<stamp>-celtiming/.
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
check('timings: big 6 s, regular 6 s, smaller moments 5 s, alerts 5 s, 3 loops', consts.CEL_BIG_MS === 6000 && consts.CEL_MS === 6000 && consts.CEL_MINI_MS === 5000 && consts.CEL_ALERT_MS === 5000 && consts.CEL_LOOPS === 3, JSON.stringify(consts));

// big: TOUCHDOWN (Lite)
let r = await run(tv, 'td', '#celebrate', 'showing', [500, 3000, 5500], 'lite-td');
check('TOUCHDOWN!! (Lite) on screen at 0.5 s, 3 s and 5.5 s', r.frames.every(f => f.showing && f.display === 'block' && f.opacity >= 0.9), fmt(r));
check('TOUCHDOWN!! (Lite) total on-screen time ~6 s', r.total >= 5800 && r.total <= 6600, `${r.total} ms`);
let fl = r.frames.map(f => loopAnim(f, 'cel-lite-flash'));
check('Lite flash/glow loops 3x at 2 s (iteration 0 -> 1 -> 2 at 0.5/3/5.5 s), not one 1 s burst', fl[0].dur === 2000 && fl[0].it === 3 && fl[0].cur === 0 && fl[1].cur === 1 && fl[2].cur === 2, JSON.stringify(fl));
let rg = r.frames.map(f => loopAnim(f, 'cel-lite-ring'));
check('Lite ring pulse (transform/opacity) loops 3x at 2 s', rg[0].dur === 2000 && rg[0].it === 3 && rg[1].cur === 1 && rg[2].cur === 2, JSON.stringify(rg.map(a => a.cur)));
let bt = r.frames.map(f => f.anims.filter(a => a.name === 'cel-beat'));
check('Lite logo: scale-in then slow 2 s beat x3 (still beating at 3 s and 5.5 s)', bt[1].length && bt[1][0].dur === 2000 && bt[1][0].it === 3 && bt[2].length && bt[2][0].cur >= 1, JSON.stringify(bt.map(b => b.map(a => a.cur))));
check('strips still scrolling (transform changes between frames)', new Set(r.frames.map(f => f.mq1)).size === 3, r.frames.map(f => f.mq1.slice(0, 40)).join(' | '));
const lp = await tv.evaluate(() => { const props = new Set(); document.getAnimations().forEach(a => { (a.effect.getKeyframes() || []).forEach(k => Object.keys(k).forEach(p => { if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p); })); }); return [...props]; });
check('Lite stays GPU-light: only transform/opacity are animated', lp.length > 0 && lp.every(p => p === 'transform' || p === 'opacity'), lp.join(','));

// strip speed: px/s for a short and a long word (must be calm and similar)
await tv.evaluate(() => arcadeCelebrate('td')); await sleep(300);
const sp1 = await tv.evaluate(() => { const e = document.getElementById('cel-mq1'); return e.scrollWidth / 2 / (parseFloat(e.parentNode.style.animationDuration) / 1000); });
await tv.evaluate(() => arcadeCelebrate('goal')); await sleep(300);
const sp2 = await tv.evaluate(() => { const e = document.getElementById('cel-mq1'); return e.scrollWidth / 2 / (parseFloat(e.parentNode.style.animationDuration) / 1000); });
await tv.evaluate(() => celHide(true));
check('strip speed calm (<= 0.6 screen-widths/s at 720p) and length-independent', sp1 / 1280 <= 0.6 && sp2 / 1280 <= 0.6 && Math.abs(sp1 - sp2) / sp1 < 0.3, `TD ${Math.round(sp1)} px/s, GOAL+name ${Math.round(sp2)} px/s`);

// smaller moment: HALFTIME (Lite) ~5 s
r = await run(tv, 'half', '#celebrate', 'showing', [500, 3000, 4500], 'lite-halftime');
check('HALFTIME! (smaller) on screen at 0.5/3/4.5 s, gone ~5 s', r.frames.every(f => f.showing && f.opacity >= 0.9) && r.total >= 4800 && r.total <= 5600, fmt(r));
fl = r.frames.map(f => loopAnim(f, 'cel-lite-flash'));
check('HALFTIME! loops 3x at ~1.67 s', fl[0].dur === 1667 && fl[0].it === 3 && fl[2].cur === 2, JSON.stringify(fl.map(a => a.cur)));

// alert banner: RED ZONE (Lite) ~5 s
r = await run(tv, 'redzone', '#cel-alert', 'alShowing', [500, 2500, 4600], 'lite-alert-redzone');
check('RED ZONE! banner on screen at 0.5/2.5/4.6 s, gone ~5 s', r.frames.every(f => f.showing && f.display === 'block' && f.opacity >= 0.6) && r.total >= 4800 && r.total <= 5600, fmt(r));
const sh = r.frames.map(f => loopAnim(f, 'cel-sweep')), lb = r.frames.map(f => loopAnim(f, 'cel-beat'));
check('banner shine + logo beat loop 3x at ~1.67 s (Lite: was static after 0.45 s)', sh[0].dur === 1667 && sh[0].it === 3 && sh[1].cur === 1 && sh[2].cur === 2 && lb[0].it === 3 && lb[2].cur === 2, JSON.stringify({ shine: sh.map(a => a.cur), logo: lb.map(a => a.cur) }));

// queueing: GOAL -> TD -> WIN back to back, each with the full new length
await tv.evaluate(() => arcadeCelebrate('test')); const q0 = Date.now(); const seen = [];
let lastAt = 0;
while (Date.now() - q0 < 22000) { const s = await tv.evaluate(() => ({ at: cel.last && cel.last.at, t: cel.last && cel.last.text, showing: cel.showing, q: cel.queue.length })); if (s.at !== lastAt && s.showing) { seen.push({ t: s.t, ms: Date.now() - q0 }); lastAt = s.at; } if (!s.showing && !s.q && seen.length >= 3) break; await sleep(50); }
const qEnd = Date.now() - q0;
const gaps = seen.slice(1).map((s, i) => s.ms - seen[i].ms);
check('back-to-back GOAL -> TD -> WIN queue, each ~6 s + 0.35 s gap (no pile-up)', seen.map(s => s.t).join(',') === 'GOAL!!,TOUCHDOWN!!,CANES WIN!!' && gaps.every(g => g >= 6100 && g <= 6900) && qEnd >= 18000 && qEnd <= 20500, `${seen.map(s => s.t + '@' + (s.ms / 1000).toFixed(1)).join(' ')}; done ${(qEnd / 1000).toFixed(1)} s`);
// a big moment while a banner is up takes over; banners wait behind a celebration
await tv.evaluate(() => { celHide(true); alHide(true); cel.aq = []; arcadeCelebrate('goal'); alShow({ alert: 'pp', text: 'POWER PLAY!' }, CEL_DEMO.goal.T, 'TEST'); });
const wq = await tv.evaluate(() => ({ cel: cel.showing, al: cel.alShowing, aq: cel.aq.length }));
const t1 = Date.now(); await tv.waitForFunction(() => cel.alShowing, { timeout: 9000 }).catch(() => {}); const alAfter = Date.now() - t1;
check('a banner during a celebration waits, then shows after it (~6 s)', wq.cel && !wq.al && wq.aq === 1 && alAfter >= 5300 && alAfter <= 7000, JSON.stringify(wq) + ` banner after ${(alAfter / 1000).toFixed(1)} s`);
await tv.evaluate(() => { celHide(true); alHide(true); cel.aq = []; });
await tv.close();

// ---------- Full effects (desktop browser, Full chosen) ----------
const full = await openPage(false);
await full.evaluate(() => { settings.celFull = true; });
r = await run(full, 'win', '#celebrate', 'showing', [500, 3000, 5500], 'full-win');
check('CANES WIN!! (Full) on screen at 0.5/3/5.5 s, gone ~6 s', r.frames.every(f => f.showing && f.opacity >= 0.9) && r.total >= 5800 && r.total <= 6600, fmt(r));
const pu = r.frames.map(f => loopAnim(f, 'cel-pulse')), sw = loopAnim(r.frames[1], 'cel-swing'), ri = loopAnim(r.frames[1], 'cel-ring'), bf = r.frames[1].anims.find(a => a.name === 'cel-beat');
check('Full strobe slowed: 3 calm flash+glow cycles of 2 s (was 0.36 s x8), beams 1 s swings, rings 2 s, beat 1 s', pu[0].dur === 2000 && pu[0].it === 3 && pu[1].cur === 1 && pu[2].cur === 2 && sw.dur === 1000 && ri.dur === 2000 && bf && bf.dur === 1000, JSON.stringify({ pulse: pu.map(a => a.cur), swing: sw.dur, ring: ri.dur, beat: bf && bf.dur }));
r = await run(full, 'big', '#cel-alert', 'alShowing', [500, 2500, 4600], 'full-alert-bigplay');
check('BIG PLAY! banner (Full) on screen at 0.5/2.5/4.6 s, gone ~5 s', r.frames.every(f => f.showing && f.opacity >= 0.6) && r.total >= 4800 && r.total <= 5600, fmt(r));
await full.close();

check('no console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log('\nScreenshots:\n' + shots.map(s => '  ' + path.relative(REPO, s)).join('\n'));
await browser.close(); srv.close();
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL TIMING CHECKS PASSED');
process.exit(fails ? 1 : 0);
