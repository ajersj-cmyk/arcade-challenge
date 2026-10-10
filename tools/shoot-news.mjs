#!/usr/bin/env node
// Headlines slide screenshots (run from repo root):
//   node tools/shoot-news.mjs [preview.html] [--out=DIR] [--size=1280x720] [--tv] [--modes=,nfl,cfb] [--frames=3]
// One shot per sport mode ('' = normal rotation), plus --frames hero frames ~7 s apart. Prints image/req stats.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = k => { const a = args.find(a => a.startsWith('--' + k + '=')); return a == null ? null : a.split('=').slice(1).join('='); };
const FILE = args.find(a => /\.html$/.test(a)) || 'preview.html';
const [W, H] = (opt('size') || '1280x720').split('x').map(Number);
const MODES = (opt('modes') ?? ',nfl').split(','), FRAMES = +(opt('frames') || 1), TV = args.includes('--tv');
const OUT = path.resolve(opt('out') || path.join(REPO, 'tools', 'out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-news'));
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let errs = 0;
for (const mode of MODES) {
  const page = await browser.newPage(); await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome')); await page.setViewport({ width: W, height: H }); await page.emulateTimezone('America/New_York');
  const errors = []; page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::|status of [45]\d\d/.test(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  const imgs = []; page.on('requestfinished', r => { if (r.resourceType() === 'image' && /espncdn|akamaized|espn/.test(r.url())) imgs.push(r.url()); });
  await page.evaluateOnNewDocument((tv, mode) => { if (tv) window.ArcadeTV = {}; try { localStorage.removeItem('ahlersSportMode1'); if (mode) localStorage.setItem('ahlersSportMode1', JSON.stringify({ mode, until: Date.now() + 3600000, snap: null })); } catch (e) {} }, TV, mode);
  await page.goto(`http://127.0.0.1:${srv.address().port}/${FILE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 90000 });
  await page.evaluate(() => { arcadeNav.paused = true; });
  const n0 = imgs.length;
  await page.evaluate(() => { arcadeNav.paused = false; navGoTo('news'); arcadeNav.paused = true; });
  for (let f = 0; f < FRAMES; f++) {
    await sleep(f === 0 ? 5000 : 7000);
    const file = path.join(OUT, `news-${mode || 'all'}${FRAMES > 1 ? '-' + (f + 1) : ''}${TV ? '-tv' : ''}.png`); await page.screenshot({ path: file }); console.log(file);
  }
  const info = await page.evaluate(() => { const s = document.getElementById('news-screen'); return { mode: smActive(), head: (s.querySelector('.screen-header') || {}).textContent, imgs: s.querySelectorAll('img').length, stories: (window.nwState && nwState.items || []).length }; });
  console.log(JSON.stringify({ ...info, imagesLoaded: imgs.length - n0, errors }));
  errs += errors.length; await page.close();
}
await browser.close(); srv.close(); process.exit(errs ? 1 : 0);
