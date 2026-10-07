#!/usr/bin/env node
// Checks the football futures slides' data fallbacks in headless Chrome:
//   1) futures.json missing  -> Action Network live (+ ESPN fill for markets AN lacks)
//   2) futures.json missing and Action Network blocked -> ESPN core API
//   3) futures.json stale (> 2 days) and both live sources blocked -> last saved file
// Usage: node tools/test-futures-fallback.mjs [file=preview.html]   (writes screenshots to tools/out/<ts>-fallback/)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] || 'preview.html';
const OUT = path.join(REPO, 'tools', 'out', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-fallback');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = http.createServer((req, res) => {
  const p = path.join(REPO, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(REPO) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : p.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const staleFile = (() => { const j = JSON.parse(fs.readFileSync(path.join(REPO, 'futures.json'), 'utf8')); j.generatedAt = new Date(Date.now() - 5 * 86400000).toISOString(); return JSON.stringify(j); })();

const scenarios = [
  { name: 'no-file -> actionnetwork', futures: '404', blockAN: false, expectSource: 'LIVE FEED', expectHost: 'api.actionnetwork.com' },
  { name: 'no-file + AN blocked -> espn', futures: '404', blockAN: true, expectSource: 'ESPN BACKUP', expectHost: 'sports.core.api.espn.com' },
  { name: 'stale file + live blocked -> last saved', futures: 'stale', blockAN: true, blockESPN: true, expectSource: 'LAST SAVED FEED' },
];
let fails = 0;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
for (const sc of scenarios) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent(ua);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setRequestInterception(true);
  const hosts = new Set(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', req => {
    const u = req.url();
    if (/\/futures\.json/.test(u)) { if (sc.futures === '404') return req.respond({ status: 404, body: '' }); return req.respond({ status: 200, contentType: 'application/json', body: staleFile }); }
    if (sc.blockAN && /api\.actionnetwork\.com/.test(u)) return req.abort('blockedbyclient');
    if (sc.blockESPN && /sports\.core\.api\.espn\.com\/v2\/sports\/football/.test(u)) return req.abort('blockedbyclient');
    try { hosts.add(new URL(u).host); } catch (e) {}
    req.continue();
  });
  await page.goto(base + FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 60000 }); // initial ticker load + first slide done
  await page.evaluate(() => { clearTimeout(slideTimer); navForceSlide(ARCADE_SCREENS.indexOf('cfbFutures')); arcadeNav.paused = true; }); // hold the slide while we inspect it
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 45000 }).catch(() => {});
  await sleep(1500);
  const r = await page.evaluate(() => ({ meta: document.getElementById('cfbfut-meta').innerText, cards: document.querySelectorAll('#cfbfut-track .fut-card').length, src: footballFuturesMem && footballFuturesMem.data && footballFuturesMem.data.source }));
  const shot = path.join(OUT, sc.name.replace(/[^a-z0-9]+/gi, '_') + '.png');
  await page.screenshot({ path: shot });
  const ok = r.cards >= 3 && r.src === sc.expectSource && (!sc.expectHost || hosts.has(sc.expectHost));
  const realErrors = errors.filter(t => !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(t));
  if (!ok || realErrors.length) fails++;
  console.log(`${ok && !realErrors.length ? 'PASS' : 'FAIL'}  ${sc.name}: source=${r.src} cards=${r.cards} meta="${r.meta}" ${realErrors.length ? 'errors=' + realErrors.join(' | ') : ''}\n      ${path.relative(REPO, shot)}`);
  await ctx.close();
}
await browser.close(); srv.close();
process.exit(fails ? 1 : 0);
