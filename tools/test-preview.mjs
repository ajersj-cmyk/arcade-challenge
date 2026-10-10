#!/usr/bin/env node
// Flynn test harness for the Ahlers Arcade scoreboard.
//
// Loads an HTML file from the repo root (default: preview.html) through a local
// static server in headless Google Chrome, records console errors/warnings,
// page errors and failed network requests, validates every known API call,
// optionally fast-forwards through every slide, and saves screenshots.
//
// Usage (from repo root):
//   node tools/test-preview.mjs [--file preview.html] [--wait 20000] [--no-cycle]
//                               [--sizes 1920x1080,1280x720] [--out tools/out/NAME]
//                               [--strict] [--keep-open]
//   node tools/test-preview.mjs --compare index.html preview.html
//
// Exit codes: 0 = pass, 1 = test failures, 2 = harness error.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const a = { file: 'preview.html', wait: 20000, cycle: true, sizes: ['1920x1080', '1280x720'],
              out: null, strict: false, compare: null, dwell: 2500, slideTimeout: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--file') a.file = next();
    else if (k === '--wait') a.wait = Number(next());
    else if (k === '--no-cycle') a.cycle = false;
    else if (k === '--cycle') a.cycle = true;
    else if (k === '--sizes') a.sizes = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--out') a.out = next();
    else if (k === '--strict') a.strict = true;
    else if (k === '--dwell') a.dwell = Number(next());
    else if (k === '--compare') a.compare = [next() || 'index.html', next() || 'preview.html'];
    else if (k === '-h' || k === '--help') { a.help = true; }
    else if (!k.startsWith('--')) a.file = k;
    else throw new Error('Unknown option ' + k);
  }
  return a;
}

// ---------------------------------------------------------------- known APIs
// Each entry: id, name, match(url) -> label|null, kind ('api'|'infra'|'asset'),
// when ('load' = expected during initial load with default settings, 'slide' = only when its slide shows),
// validate(json) -> null|string (error message).
const SCOREBOARDS_ON_LOAD = [
  'hockey/nhl', 'football/nfl', 'basketball/nba', 'baseball/mlb', 'football/college-football',
  'basketball/mens-college-basketball', 'baseball/college-baseball', 'soccer/fifa.world',
  'soccer/eng.1', 'soccer/uefa.champions', 'tennis/atp', 'tennis/wta'
];
const API_RULES = [
  { id: 'espn-gc-fast', kind: 'api', re: /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/([^/]+)\/([^/?]+)\/scoreboard\/(\d+)/, // Gamecast 2 s check: one event
    label: m => `ESPN event scoreboard ${m[1]}/${m[2]}`, validate: j => Array.isArray(j && j.competitions) ? null : 'no competitions[] in body' },
  { id: 'espn-scoreboard', kind: 'api', re: /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/([^/]+)\/([^/?]+)\/scoreboard/,
    label: m => `ESPN scoreboard ${m[1]}/${m[2]}`, validate: j => Array.isArray(j && j.events) ? null : 'no events[] in body' },
  { id: 'espn-teams', kind: 'api', re: /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/([^/]+)\/([^/?]+)\/teams/,
    label: m => `ESPN teams ${m[1]}/${m[2]}`, validate: j => (j && j.sports) ? null : 'no sports[] in body' },
  { id: 'espn-rankings', kind: 'api', re: /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/college-football\/rankings/,
    label: () => 'ESPN CFB rankings', validate: j => (j && j.rankings && j.rankings[0] && j.rankings[0].ranks) ? null : 'no rankings[0].ranks' },
  { id: 'espn-summary', kind: 'api', re: /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/([^/]+)\/([^/?]+)\/summary\?event=/,
    label: m => `ESPN summary (Gamecast) ${m[1]}/${m[2]}`, validate: j => (j && j.header && j.header.competitions) ? null : 'no header.competitions' },
  { id: 'espn-standings', kind: 'api', re: /^https:\/\/site\.api\.espn\.com\/apis\/v2\/sports\/([^/]+)\/([^/?]+)\/standings/,
    label: m => `ESPN standings ${m[1]}/${m[2]}`, validate: j => (j && (j.children || j.standings)) ? null : 'no children/standings' },
  { id: 'espn-futures', kind: 'api', re: /^https:\/\/sports\.core\.api\.espn\.com\/v2\/sports\/([^/]+)\/leagues\/([^/]+)\/seasons\/(\d+)\/futures/,
    label: m => `ESPN core futures ${m[2]} ${m[3]}`, validate: j => Array.isArray(j && j.items) ? null : 'no items[]' },
  { id: 'espn-core-ref', kind: 'api', re: /^https:\/\/sports\.core\.api\.espn\.com\/v2\/sports\/[^/]+\/leagues\/[^/]+\/(seasons\/\d+\/)?(teams|athletes)\/\d+/,
    label: () => 'ESPN core team/athlete $ref', validate: j => (j && (j.displayName || j.shortDisplayName)) ? null : 'no displayName' },
  { id: 'futures-json', kind: 'api', re: /^http:\/\/127\.0\.0\.1:\d+\/futures\.json/,
    label: () => 'futures.json (daily file)', validate: j => (j && j.generatedAt && j.nfl && j.ncaaf) ? null : 'missing generatedAt/nfl/ncaaf' },
  { id: 'actionnetwork', kind: 'api', re: /^https:\/\/api\.actionnetwork\.com\/web\/v1\/leagues\/(\d+)\/futures\/([^?]+)/,
    label: m => `Action Network futures league ${m[1]} ${m[2] === 'available' ? 'index' : 'market'}`, validate: j => (j && (j.futures || j.books)) ? null : 'no futures/books' },
  { id: 'open-meteo', kind: 'api', re: /^https:\/\/api\.open-meteo\.com\/v1\/forecast/,
    label: () => 'Open-Meteo weather (Greenville NC)', validate: j => (j && j.current && j.current.temperature_2m != null) ? null : 'no current.temperature_2m' },
  { id: 'opentdb', kind: 'api', re: /^https:\/\/opentdb\.com\/api\.php/,
    label: () => 'Open Trivia DB (sports)', validate: j => (j && j.response_code === 0) ? null : `response_code=${j && j.response_code}` },
  { id: 'espn-core-odds', kind: 'api', re: /^https:\/\/sports\.core\.api\.espn\.com\/v2\/sports\/([^/]+)\/leagues\/([^/]+)\/events\/\d+\/competitions\/\d+\/odds/, // LIVE ACTION live lines
    label: m => `ESPN core odds (live lines) ${m[2]}`, validate: j => Array.isArray(j && j.items) ? null : 'no items[]' },
  { id: 'ntfy', kind: 'api', re: /^https:\/\/ntfy\.sh\/[\w-]+\/json\?poll=1/, label: () => "ntfy.sh pick'em cache", validate: () => null, text: true },
  { id: 'ntfy-sse', kind: 'infra', re: /^https:\/\/ntfy\.sh\/[\w-]+\/sse/, label: () => 'ntfy.sh phone-remote stream' },
  { id: 'pickem-data', kind: 'api', re: /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/pickem-data\/(rooms\/[\w-]+|picks)\.json/, label: () => "rooms/<room>.json (pickem-data branch)", validate: j => (j && j.picks && j.events) ? null : 'no picks/events' },
  { id: 'espn-news', kind: 'api', re: /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/([^/]+)\/([^/?]+)\/news/, // Headlines slide (photos)
    label: m => `ESPN news ${m[1]}/${m[2]}`, validate: j => Array.isArray(j && j.articles) ? null : 'no articles[] in body' },
  { id: 'rss2json', kind: 'api', re: /^https:\/\/api\.rss2json\.com\/v1\/api\.json\?rss_url=([^&]+)/,
    label: m => `rss2json ${decodeURIComponent(m[1]).replace(/^https?:\/\//, '')}`, validate: j => (j && j.status === 'ok') ? null : `status=${j && j.status} ${j && j.message ? j.message : ''}` },
  { id: 'qrserver', kind: 'infra', re: /^https:\/\/api\.qrserver\.com\/v1\/create-qr-code/, label: () => 'QR Server (remote QR image)' },
  { id: 'tailwind', kind: 'infra', re: /^https:\/\/cdn\.tailwindcss\.com/, label: () => 'Tailwind Play CDN' },
  { id: 'gfonts', kind: 'infra', re: /^https:\/\/fonts\.(googleapis|gstatic)\.com/, label: () => 'Google Fonts' },
  { id: 'favicons', kind: 'asset', re: /^https:\/\/www\.google\.com\/s2\/favicons/, label: () => 'Google favicon (TV network logo)' },
  { id: 'espncdn', kind: 'asset', re: /^https:\/\/a\.espncdn\.com\//, label: () => 'ESPN CDN image' },
];
// Pre-existing issues in index.html (documented in FLYNN.md). They are reported as KNOWN and do not fail the
// run unless --strict, so the test gates on NEW problems. Remove an entry once the issue is fixed.
const KNOWN_ISSUES = [
  { id: 'espn-teams-cors', reason: 'ESPN /teams endpoint sends no Access-Control-Allow-Origin header; loadTeamMap() silently falls back to the built-in team map (CFB has none, so the CFB TITLE futures section never renders)',
    api: a => a.id === 'espn-teams' && /ERR_FAILED/.test(a.error || ''),
    console: c => /blocked by CORS policy/.test(c.text) && /site\.api\.espn\.com\/apis\/site\/v2\/sports\/[^/]+\/[^/]+\/teams/.test(c.text) },
];
function knownFor(kind, item) { return KNOWN_ISSUES.find(k => k[kind] && k[kind](item)) || null; }

function classify(url) {
  for (const r of API_RULES) {
    const m = url.match(r.re);
    if (m) return { rule: r, label: r.label(m) };
  }
  return null;
}

// ---------------------------------------------------------------- static server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.PNG': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function startServer(root) {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, 'http://x');
        let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
        const abs = path.join(root, p);
        if (!abs.startsWith(root)) { res.writeHead(403); return res.end(); }
        const st = await fsp.stat(abs).catch(() => null);
        if (!st || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(abs).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// ---------------------------------------------------------------- one run
async function runOne(opts, file, outDir, label) {
  await fsp.mkdir(outDir, { recursive: true });
  const abs = path.join(REPO, file);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);

  const srv = await startServer(REPO);
  const port = srv.address().port;
  const url = `http://127.0.0.1:${port}/${file.split(path.sep).map(encodeURIComponent).join('/')}`;
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'flynn-chrome-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profile,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--mute-audio'],
  });

  const result = { file, label, url, startedAt: new Date().toISOString(), console: [], pageErrors: [], failedRequests: [],
                   api: [], assets: { ok: 0, failed: [] }, checks: [], screenshots: [], slides: [] };
  const reqImgUrls = new Set();
  try {
    // ESPN's CDN returns 403 (surfacing as a CORS error) to the default "HeadlessChrome" user agent.
    // Use the normal desktop Chrome UA, which is what the TV's browser sends anyway.
    const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
    const page = await browser.newPage();
    await page.setUserAgent(ua);
    await page.emulateTimezone('America/New_York');
    await page.setViewport({ width: 1920, height: 1080 });

    page.on('console', msg => {
      const type = msg.type();
      if (type !== 'error' && type !== 'warn' && type !== 'warning') return;
      const loc = msg.location() || {};
      result.console.push({ type: type === 'warn' ? 'warning' : type, text: msg.text(), url: loc.url || '' });
    });
    page.on('pageerror', err => result.pageErrors.push(String(err && err.stack || err)));
    const summaryReqs = []; // Gamecast poll log: [ms timestamp, url]
    page.on('request', req => { if (req.resourceType() === 'image') reqImgUrls.add(req.url()); if (/\/apis\/site\/v2\/sports\/[^/]+\/[^/]+\/summary\?event=/.test(req.url())) summaryReqs.push([Date.now(), req.url()]); });
    page.on('requestfailed', req => {
      const f = req.failure();
      const c = classify(req.url());
      const entry = { url: req.url(), type: req.resourceType(), error: f ? f.errorText : 'failed', label: c ? c.label : null, kind: c ? c.rule.kind : 'other' };
      // Requests aborted because the page navigated/closed are not real failures
      if (entry.error === 'net::ERR_ABORTED' && entry.type === 'media') return;
      // Gamecast aborts its in-flight summary request on close / before the next poll by design
      if (entry.error === 'net::ERR_ABORTED' && /\/summary\?event=/.test(entry.url)) return;
      result.failedRequests.push(entry);
      if (c && c.rule.kind !== 'asset') result.api.push({ id: c.rule.id, label: c.label, kind: c.rule.kind, url: req.url(), status: 0, ok: false, error: entry.error });
      if (c && c.rule.kind === 'asset') result.assets.failed.push({ url: req.url(), status: 0, error: entry.error });
    });
    page.on('response', async res => {
      const u = res.url();
      if (u.startsWith('data:')) return;
      const c = classify(u);
      const status = res.status();
      if (!c) {
        if (status >= 400) result.failedRequests.push({ url: u, type: res.request().resourceType(), error: `HTTP ${status}`, label: null, kind: /\/favicon\.ico$/.test(u) ? 'favicon' : 'other' });
        return;
      }
      if (c.rule.kind === 'asset') {
        if (status >= 400) result.assets.failed.push({ url: u, status });
        else result.assets.ok++;
        return;
      }
      const entry = { id: c.rule.id, label: c.label, kind: c.rule.kind, url: u, status, ok: status >= 200 && status < 400, error: null };
      if (!entry.ok) entry.error = `HTTP ${status}`;
      // 429 = upstream quota exhausted for THIS machine's IP (e.g. shared box egress). Reported, but only fails with --strict.
      if (status === 429) { entry.rateLimited = true; try { entry.error = 'HTTP 429 rate-limited: ' + (await res.text()).slice(0, 120); } catch (e) {} }
      if (entry.ok && c.rule.validate && ['fetch', 'xhr'].includes(res.request().resourceType())) {
        try { const j = JSON.parse(await res.text()); const v = c.rule.validate(j); if (v) { entry.ok = false; entry.error = v; } }
        catch (e) {
          // Chrome drops a response body once the page is done with it (e.g. a Gamecast closed right after the reply
          // arrived); the request itself succeeded, so only flag real parse failures.
          if (/No data found for resource|No resource with given identifier/.test(String(e.message))) entry.note = 'body released before inspection';
          else { entry.ok = false; entry.error = 'body not JSON: ' + String(e.message).slice(0, 80); }
        }
      }
      result.api.push(entry);
    });

    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    result.loadMs = Date.now() - t0;
    // let initial fetches (ticker = 12 sequential ESPN calls, weather, trivia) finish
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: opts.wait }).catch(() => {});
    const remaining = opts.wait - (Date.now() - t0);
    if (remaining > 0) await sleep(Math.min(remaining, 4000));

    // ---- screenshots of the initial state
    for (const s of opts.sizes) {
      const [w, h] = s.split('x').map(Number);
      await page.setViewport({ width: w, height: h });
      await sleep(600);
      const p = path.join(outDir, `${label}-${w}x${h}.png`);
      await page.screenshot({ path: p });
      result.screenshots.push(p);
    }
    await page.setViewport({ width: 1920, height: 1080 });

    // ---- smoke checks on core behaviour
    const state = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('.slide-screen')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id);
      const track = document.getElementById('ticker-track');
      return {
        clock: (document.getElementById('master-clock') || {}).innerText || '',
        visibleSlides: vis,
        tickerHtmlLen: track ? track.innerHTML.length : 0,
        tickerAnim: track ? (track.style.animation || getComputedStyle(track).animationName) : '',
        tickerHasHead: !!document.querySelector('#ticker-track .ticker-section-head'),
        cursor: getComputedStyle(document.body).cursor,
        theme: document.body.className,
        settingsKeys: (() => { try { return Object.keys(JSON.parse(localStorage.getItem('ahlersArcadeSettings') || '{}')).length; } catch (e) { return -1; } })(),
        qrSrc: (document.getElementById('settings-qr') || {}).src || '',
        weather: (document.getElementById('local-temp') || {}).innerText || '',
        hasTriviaLoaded: typeof currentTrivia !== 'undefined' && !!currentTrivia,
        rawGames: typeof globalRawGames !== 'undefined' ? globalRawGames.length : -1,
        liveGames: typeof globalLiveGamesData !== 'undefined' ? globalLiveGamesData.length : -1,
        leaders: typeof globalLeadersData !== 'undefined' ? globalLeadersData.length : -1,
      };
    });
    result.state = state;
    const check = (name, ok, detail) => result.checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
    check('master clock shows h:mm AM/PM', /^\d{1,2}:\d{2} (AM|PM)$/.test(state.clock), state.clock);
    check('exactly one slide visible', state.visibleSlides.length === 1, state.visibleSlides.join(','));
    check('ticker has section head + content', state.tickerHasHead && state.tickerHtmlLen > 200, `len=${state.tickerHtmlLen}`);
    check('ticker is scrolling (scrollTicker animation)', /scrollTicker/.test(state.tickerAnim), state.tickerAnim);
    check('cursor hidden (cursor: none)', state.cursor === 'none', state.cursor);
    check('neon theme class on body', /theme-(cyan|pink|green)/.test(state.theme), state.theme);
    check('remote QR image URL set', /api\.qrserver\.com/.test(state.qrSrc), '');
    const meteo429 = result.api.some(a => a.id === 'open-meteo' && a.rateLimited);
    if (meteo429 && !opts.strict) result.notes = (result.notes || []).concat('Open-Meteo returned 429 (daily quota for this IP); weather check skipped');
    else check('weather filled (Command Center)', /°F$/.test(state.weather), state.weather);

    // settings hotkey: 's' opens and closes the control center
    await page.keyboard.press('s'); await sleep(300);
    const open1 = await page.$eval('#settings-modal', e => getComputedStyle(e).display);
    if (opts.sizes.length) { const p = path.join(outDir, `${label}-settings-1920x1080.png`); await page.screenshot({ path: p }); result.screenshots.push(p); }
    await page.keyboard.press('s'); await sleep(300);
    const open2 = await page.$eval('#settings-modal', e => getComputedStyle(e).display);
    check("'s' hotkey toggles settings modal", open1 === 'flex' && open2 === 'none', `${open1} -> ${open2}`);

    // ---- fast-forward through every slide so slide-only APIs are exercised
    if (opts.cycle) {
      const slidesDir = path.join(outDir, `${label}-slides`);
      await fsp.mkdir(slidesDir, { recursive: true });
      const seen = new Set();
      const allSlides = await page.evaluate(() => [...document.querySelectorAll('.slide-screen')].map(e => e.id));
      // index.html's rotation can skip a slide right after trivia (pre-existing quirk), so keep going until every
      // slide has been seen once (max 36 steps) instead of stopping after a single pass.
      for (let i = 0; i < 36; i++) {
        await page.evaluate(() => { clearTimeout(slideTimer); clearTimeout(triviaRevealTimer); nextSlide(); });
        await sleep(400);
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: opts.slideTimeout }).catch(() => {});
        await sleep(opts.dwell);
        const vis = await page.evaluate(() => [...document.querySelectorAll('.slide-screen')].filter(e => getComputedStyle(e).display !== 'none').map(e => ({ id: e.id, text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 400), cards: e.querySelectorAll('.fut-card').length, rows: e.querySelectorAll('.fut-row').length })));
        const id = vis.map(v => v.id).join('+') || '(none)';
        const n = String(i + 1).padStart(2, '0');
        const p = path.join(slidesDir, `${n}-${id}.png`);
        await page.screenshot({ path: p });
        result.slides.push({ n: i + 1, id, text: vis.map(v => v.text).join(' | '), cards: vis.reduce((a, v) => a + v.cards, 0), rows: vis.reduce((a, v) => a + v.rows, 0), screenshot: p });
        seen.add(id);
        if (allSlides.every(x => seen.has(x))) break;
      }
      result.slidesNotSeen = allSlides.filter(x => !seen.has(x));
      result.futuresSections = await page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('ahlersFutures4') || localStorage.getItem('ahlersFutures3') || '{}').sections || []).map(x => x.title + ' (' + x.rows.length + ')'); } catch (e) { return []; } });
      // football futures/awards slides (only when the page has them)
      for (const [sid, min] of [['nflfut-screen', 8], ['nflawards-screen', 5], ['cfbfut-screen', 8], ['nhlfut-screen', 1]]) {
        if (!allSlides.includes(sid)) continue;
        const best = result.slides.filter(x => x.id === sid).sort((a, b) => b.cards - a.cards)[0];
        check(`${sid} populated with real odds (>= ${min} markets)`, best && best.cards >= min, best ? `${best.cards} markets, ${best.rows} rows` : 'never shown');
        if (best) result.futuresSlideText = Object.assign(result.futuresSlideText || {}, { [sid]: best.text });
      }
      if (allSlides.includes('nflfut-screen')) {
        const gen = JSON.parse(fs.readFileSync(path.join(REPO, 'futures.json'), 'utf8')).generatedAt;
        const expect = await page.evaluate(g => { const d = new Date(g); return 'UPDATED ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }, gen);
        const metas = Object.values(result.futuresSlideText || {});
        check("futures slides show 'Updated' time from futures.json generatedAt", metas.length > 0 && metas.every(t => t.toUpperCase().includes(expect.toUpperCase())), `${expect} (generatedAt ${gen})`);
      }
      if (await page.evaluate(() => !!localStorage.getItem('ahlersFutures4'))) {
        check('FUTURES slide has CFB TITLE + NBA TITLE sections', ['CFB TITLE', 'NBA TITLE'].every(t => result.futuresSections.some(x => x.startsWith(t))), result.futuresSections.join(', '));
      }
      check('slide rotation reached 10+ distinct slides', seen.size >= 10, [...seen].join(','));
    }

    // ---- D-pad / remote navigation (only when the page implements window.arcadeNav)
    if (await page.evaluate(() => typeof arcadeNav !== 'undefined')) {
      await page.evaluate(() => { clearTimeout(slideTimer); clearTimeout(triviaRevealTimer); slideTimer = null; });
      const visible = () => page.evaluate(() => [...document.querySelectorAll('.slide-screen')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id).join('+'));
      const ui = () => page.evaluate(() => ({ menu: getComputedStyle(document.getElementById('nav-menu')).display, hud: getComputedStyle(document.getElementById('nav-hud')).opacity,
        paused: getComputedStyle(document.getElementById('nav-paused')).display, navActive: document.body.classList.contains('nav-active'),
        modal: getComputedStyle(document.getElementById('settings-modal')).display, focus: (document.activeElement && (document.activeElement.id || document.activeElement.getAttribute('data-slide') || document.activeElement.tagName)) || '' }));
      const shot = async name => { const p = path.join(outDir, `${label}-${name}.png`); await page.screenshot({ path: p }); result.screenshots.push(p); return p; };
      await page.evaluate(() => { arcadeNav.idleMs = 2500; navIdle(); }); // earlier hotkey checks count as remote input; fast-forward their idle timeout
      let u = await ui();
      check('remote: idle kiosk shows no nav UI', u.menu === 'none' && Number(u.hud) === 0 && u.paused === 'none' && !u.navActive, JSON.stringify(u));
      const s0 = await visible();
      await page.keyboard.press('ArrowRight'); await sleep(900);
      const s1 = await visible();
      await shot('remote-hud');
      check('remote: RIGHT advances to next slide + HUD', s1 !== s0 && Number((await ui()).hud) > 0, `${s0} -> ${s1}`);
      await page.keyboard.press('ArrowLeft'); await sleep(900);
      const s2 = await visible();
      check('remote: LEFT goes back to previous slide', s2 === s0, `${s1} -> ${s2}`);
      await page.keyboard.press('Enter'); await sleep(500);
      u = await ui();
      await shot('remote-menu');
      check('remote: OK opens navigator menu with focus', u.menu === 'flex' && !!u.focus, JSON.stringify(u));
      const f0 = u.focus;
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await sleep(300);
      const f1 = (await ui()).focus;
      await shot('remote-menu-focus');
      check('remote: arrows move focus in menu', f1 && f1 !== f0, `${f0} -> ${f1}`);
      // walk to NFL FUTURES with real key presses, then OK
      let target = 'nflFutures', guard = 0;
      while ((await ui()).focus !== target && guard++ < 30) {
        const pos = await page.evaluate(t => { const a = document.activeElement.getBoundingClientRect(), b = document.querySelector(`#nav-menu [data-slide="${t}"]`).getBoundingClientRect(); return { dy: b.top - a.top, dx: b.left - a.left }; }, target);
        await page.keyboard.press(Math.abs(pos.dy) > 5 ? (pos.dy > 0 ? 'ArrowDown' : 'ArrowUp') : (pos.dx > 0 ? 'ArrowRight' : 'ArrowLeft'));
        await sleep(80);
      }
      await page.keyboard.press('Enter'); await sleep(500);
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 10000 }).catch(() => {});
      await sleep(1200);
      check('remote: OK on menu item jumps to that slide', (await visible()) === 'nflfut-screen' && (await ui()).menu === 'none', await visible());
      await shot('remote-jump-nfl-futures');
      // pause / resume
      await page.keyboard.press(' '); await sleep(300);
      const sp = await visible();
      await page.evaluate(() => nextSlide()); await sleep(600); // simulate the slide timer firing
      u = await ui();
      await shot('remote-paused');
      check('remote: PLAY/PAUSE pauses rotation (timer ignored, badge shown)', (await visible()) === sp && u.paused === 'block', JSON.stringify(u));
      await page.keyboard.press(' '); await sleep(900);
      check('remote: resume continues rotation', (await visible()) !== sp && (await ui()).paused === 'none', await visible());
      // back closes menu
      await page.keyboard.press('Enter'); await sleep(300);
      await page.keyboard.press('Escape'); await sleep(300);
      check('remote: BACK closes menu', (await ui()).menu === 'none', '');
      // settings through the remote
      await page.keyboard.press('ArrowUp'); await sleep(300);
      await shot('remote-gear-focus');
      check('remote: UP focuses settings gear', (await ui()).focus === 'settings-gear', (await ui()).focus);
      await page.keyboard.press('Enter'); await sleep(400);
      u = await ui();
      const fs0 = u.focus;
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await sleep(300);
      const fs1 = (await ui()).focus;
      await shot('remote-settings-focus');
      check('remote: OK on gear opens settings with focus inside, arrows move', u.modal === 'flex' && !!fs0 && fs0 !== 'BODY' && fs1 !== fs0, `${fs0} -> ${fs1}`);
      await page.keyboard.press('Escape'); await sleep(300);
      check('remote: BACK closes settings', (await ui()).modal === 'none', '');
      // auto-hide after inactivity
      await page.keyboard.press('Enter'); await sleep(300);
      await sleep(3200);
      u = await ui();
      check('remote: menu/focus auto-hide after inactivity', u.menu === 'none' && !u.navActive && Number(u.hud) === 0, JSON.stringify(u));
      // mouse + keyboard still work
      await page.click('#settings-gear'); await sleep(300);
      const mc = (await ui()).modal;
      await page.focus('#set-marqueeMessage'); await page.keyboard.press('End'); await page.keyboard.type('s'); await sleep(200);
      const stillOpen = (await ui()).modal;
      await page.keyboard.press('Backspace'); await sleep(100);
      await page.evaluate(() => { const el = document.getElementById('set-marqueeMessage'); el.dispatchEvent(new Event('change')); el.blur(); });
      check('mouse click on gear opens settings; typing "s" in a field keeps it open', mc === 'flex' && stillOpen === 'flex', `${mc}/${stillOpen}`);
      await page.click('#settings-modal .settings-card > div:last-child button'); await sleep(300);
      check('SAVE & CLOSE button closes settings', (await ui()).modal === 'none', '');

      // ---- Gamecast (live game overlay): open by mouse click, poll ~10 s, close cleanly; then open/switch/close by D-pad
      if (await page.evaluate(() => typeof gcOpen === 'function')) {
        const gcState = () => page.evaluate(() => ({ open: gc.open, key: gc.key, shown: getComputedStyle(document.getElementById('gamecast')).display, lastOk: gc.lastOk, fails: gc.fails, polls: gc.polls,
          timer: !!gc.timer, ctrl: !!gc.ctrl, scroll: !!gc.scrollTimer, renderErr: gc.renderErr, menu: getComputedStyle(document.getElementById('nav-menu')).display,
          away: (document.querySelector('#gc-away .gc-tname') || {}).textContent || '', home: (document.querySelector('#gc-home .gc-tname') || {}).textContent || '',
          plays: document.querySelectorAll('#gc-plays-body .gc-play').length, stats: document.querySelectorAll('#gc-stats-body .gc-st').length,
          players: document.querySelectorAll('#gc-players-body .gc-ldr, #gc-players-body .gc-bx tr').length, games: gcOrder.length, updated: document.getElementById('gc-updated').innerText }));
        const populated = g => g.open && g.lastOk > 0 && !g.renderErr && g.away && g.home && (g.plays + g.stats + g.players) > 0 && /UPDATED \d/.test(g.updated);
        await page.evaluate(() => { navIdle(); clearTimeout(slideTimer); navForceSlide(ARCADE_SCREENS.indexOf('live')); clearTimeout(slideTimer); slideTimer = null; });
        await sleep(1200);
        let target = await page.evaluate(() => {
          const card = document.querySelector('#live-grid-track .gc-card[data-gc], #live-grid-track [data-gc]');
          if (card) { card.scrollIntoView({ block: 'center', inline: 'center' }); return { sel: 'card', key: card.getAttribute('data-gc') }; }
          const tk = document.querySelector('#ticker-track [data-gc]');
          if (tk) { tk.scrollIntoView({ block: 'center', inline: 'center' }); return { sel: 'ticker', key: tk.getAttribute('data-gc') }; }
          // No live cards: open any registered game via the API so the rest of the Gamecast checks still run.
          if (gcOrder && gcOrder.length) return { sel: 'registry', key: gcOrder[0] };
          return null;
        });
        if (target && target.sel === 'registry') {
          await page.evaluate(k => gcOpen(k), target.key);
          await page.waitForFunction(() => gc.open, { timeout: 8000 }).catch(() => {});
        }
        if (!target) { check('gamecast: a clickable game exists (Live Action card or ticker)', false, 'no [data-gc] element on screen'); }
        else {
          const slideBefore = await visible();
          const n0 = summaryReqs.length;
          if (target.sel !== 'registry') {
            const box = await page.evaluate(k => { const el = [...document.querySelectorAll('[data-gc="' + k + '"]')].find(e => e.getBoundingClientRect().width > 0) || document.querySelector('[data-gc="' + k + '"]'); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, target.key);
            if (!box) check('gamecast: a clickable game exists (Live Action card or ticker)', false, 'element not found for ' + target.key);
            else { check('gamecast: a clickable game exists (Live Action card or ticker)', true, target.sel + ' ' + target.key); await page.mouse.click(box.x, box.y); }
          } else {
            check('gamecast: a clickable game exists (Live Action card or ticker)', true, 'opened via registry ' + target.key + ' (no live card on screen)');
          }
          await page.waitForFunction(() => gc.lastOk > 0 || gc.fails > 0, { timeout: 15000 }).catch(() => {});
          await sleep(1500);
          let g = await gcState();
          check(`gamecast: ${target.sel === 'registry' ? 'registry open' : 'mouse click on ' + target.sel} game opens the overlay`, g.open && g.shown === 'flex', `${target.key} -> ${JSON.stringify({ open: g.open, key: g.key, shown: g.shown })}`);
          check('gamecast: populates from ESPN summary (scoreboard, plays/stats/players)', populated(g), `${g.away} @ ${g.home}: plays ${g.plays}, team stats ${g.stats}, player rows ${g.players}, header "${g.updated}"${g.renderErr ? ', renderErr ' + g.renderErr : ''}`);
          await page.evaluate(() => nextSlide()); await sleep(500); // the slide timer firing while the Gamecast is open
          const pendingOk = await page.evaluate(() => arcadeNav.pending === true);
          check('gamecast: rotation paused while open', (await visible()) === slideBefore && pendingOk, `${slideBefore} / pending=${pendingOk}`);
          await shot('gamecast-click');
          // poll cadence: wait for 3 more requests and measure start-to-start gaps
          const t0 = Date.now(), h0 = await page.evaluate(() => (gc.f && gc.f.hits) || 0);
          while (summaryReqs.length < n0 + 4 && Date.now() - t0 < 36000) await sleep(250);
          const ts = summaryReqs.slice(n0).map(r => r[0]);
          const gaps = ts.slice(1).map((t, i) => t - ts[i]);
          const hits = (await page.evaluate(() => (gc.f && gc.f.hits) || 0)) - h0; // live game: the 2 s check pulls the summary early on a change
          const okGaps = gaps.length >= 3 && gaps.every(x => x <= 12000) && gaps.filter(x => x < 8500).length <= hits * 4;
          check('gamecast: polls every ~10 s (start-to-start gaps; early only after a 2 s-check change)', okGaps, (gaps.map(x => (x / 1000).toFixed(1) + 's').join(', ') || 'no repeat polls') + ` | changes ${hits}`);
          result.gamecastPollGaps = gaps;
          g = await gcState();
          check('gamecast: one request at a time, still healthy after polling', !g.renderErr && g.fails === 0 && g.polls >= 4, JSON.stringify({ polls: g.polls, fails: g.fails }));
          await page.click('#gc-close'); await sleep(900);
          g = await gcState();
          const slideAfter = await visible();
          check('gamecast: CLOSE click hides overlay, stops timers/fetch', !g.open && g.shown === 'none' && !g.timer && !g.ctrl && !g.scroll, JSON.stringify({ open: g.open, shown: g.shown, timer: g.timer, ctrl: g.ctrl, scroll: g.scroll }));
          check('gamecast: rotation resumes after close', slideAfter !== slideBefore && !(await page.evaluate(() => arcadeNav.pending)), `${slideBefore} -> ${slideAfter}`);
          const nClose = summaryReqs.length;
          await sleep(11500);
          check('gamecast: no polling after close', summaryReqs.length === nClose, `${summaryReqs.length - nClose} request(s) in 11.5 s after close`);
          // D-pad: OK opens the navigator, walk to the GAMES row, OK opens, RIGHT switches game, BACK closes
          await page.evaluate(() => { navIdle(); clearTimeout(slideTimer); navForceSlide(ARCADE_SCREENS.indexOf('live')); clearTimeout(slideTimer); slideTimer = null; });
          await sleep(800);
          await page.keyboard.press('Enter'); await sleep(400);
          let guard = 0;
          while (!(await page.evaluate(() => !!(document.activeElement && document.activeElement.classList.contains('gc-item')))) && guard++ < 10) { await page.keyboard.press('ArrowUp'); await sleep(120); }
          const chip = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-gc'));
          await shot('gamecast-menu-games');
          check('gamecast: navigator shows a GAMES row reachable by D-pad', !!chip, chip || 'no game chip focused');
          if (chip) {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => gc.lastOk > 0 || gc.fails > 0, { timeout: 15000 }).catch(() => {});
            await sleep(1500);
            g = await gcState();
            check('gamecast: D-pad OK on a game opens and populates it', populated(g) && g.key === chip && g.menu === 'none', `${chip}: ${g.away} @ ${g.home}, plays ${g.plays}, stats ${g.stats}, players ${g.players}`);
            if (g.games > 1) {
              await page.keyboard.press('ArrowRight');
              await page.waitForFunction(k => gc.key !== k && gc.lastOk > 0, { timeout: 15000 }, chip).catch(() => {});
              await sleep(1200);
              const g2 = await gcState();
              check('gamecast: D-pad RIGHT switches to the next game', g2.open && g2.key !== chip && populated(g2), `${chip} -> ${g2.key} (${g2.away} @ ${g2.home})`);
              await shot('gamecast-dpad');
            }
            await page.keyboard.press('Escape'); await sleep(700);
            g = await gcState();
            check('gamecast: BACK closes overlay and stops polling', !g.open && g.shown === 'none' && !g.timer && !g.ctrl && g.menu === 'none', JSON.stringify({ open: g.open, timer: g.timer, ctrl: g.ctrl, menu: g.menu }));
          }
        }
      }
    }

    // ---- remote mode (#remote) shows the phone controller
    const rp = await browser.newPage();
    await rp.setUserAgent(ua);
    await rp.setViewport({ width: 412, height: 900 });
    await rp.goto(url + '#remote', { waitUntil: 'load', timeout: 30000 });
    await sleep(800);
    const remote = await rp.evaluate(() => ({ body: document.body.className, ctrl: getComputedStyle(document.getElementById('remote-controller')).display, tv: getComputedStyle(document.getElementById('main-wrapper')).display }));
    check('#remote shows phone controller and hides TV', remote.ctrl === 'flex' && remote.tv === 'none', JSON.stringify(remote));
    await rp.close();
  } finally {
    await browser.close().catch(() => {});
    srv.close();
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  // ---------------------------------------------------------------- evaluate
  const seenLabels = new Set(result.api.map(a => a.label));
  const missing = [];
  for (const sb of SCOREBOARDS_ON_LOAD) {
    const [s, l] = sb.split('/');
    if (!seenLabels.has(`ESPN scoreboard ${s}/${l}`)) missing.push(`ESPN scoreboard ${s}/${l}`);
  }
  for (const req of ['Open-Meteo weather (Greenville NC)', 'Open Trivia DB (sports)', 'Tailwind Play CDN', 'QR Server (remote QR image)']) {
    if (!seenLabels.has(req)) missing.push(req);
  }
  if (opts.cycle) {
    for (const req of ['ESPN scoreboard golf/pga', 'ESPN scoreboard mma/ufc', 'ESPN CFB rankings', 'ESPN standings football/nfl',
                       'ESPN standings basketball/nba', 'ESPN standings hockey/nhl', 'ESPN standings baseball/mlb']) {
      if (!seenLabels.has(req)) missing.push(req);
    }
    if (![...seenLabels].some(l => l.startsWith('ESPN news '))) missing.push('ESPN news (headlines)');
  }
  result.missingApis = missing;

  // consolidate API results per label (an endpoint may be hit several times)
  const byLabel = {};
  for (const a of result.api) {
    const b = byLabel[a.label] || (byLabel[a.label] = { label: a.label, kind: a.kind, calls: 0, ok: 0, failed: 0, errors: [] , sampleUrl: a.url });
    b.calls++;
    if (a.ok) b.ok++;
    else if (!opts.strict && knownFor('api', a)) { b.known = (b.known || 0) + 1; const k = knownFor('api', a).id; if (!b.errors.includes('KNOWN: ' + k)) b.errors.push('KNOWN: ' + k); }
    else if (a.rateLimited && !opts.strict) { b.rateLimited = (b.rateLimited || 0) + 1; if (!b.errors.includes(a.error)) b.errors.push(a.error); }
    else { b.failed++; if (a.error && !b.errors.includes(a.error)) b.errors.push(a.error); }
  }
  result.apiSummary = Object.values(byLabel).sort((x, y) => x.label.localeCompare(y.label));

  // console errors: "Failed to load resource" for images with an onerror fallback are asset noise unless --strict
  // /favicon.ico: Chrome requests it automatically and index.html declares none -> harmless 404 (also on GitHub Pages)
  const isAssetNoise = c => /Failed to load resource/.test(c.text) && (reqImgUrls.has(c.url) || /espncdn|google\.com\/s2\/favicons|\/favicon\.ico$/.test(c.url));
  const isApiLoadNoise = c => /Failed to load resource/.test(c.text) && classify(c.url) && classify(c.url).rule.kind !== 'asset'; // counted under API failures instead
  result.knownConsoleErrors = opts.strict ? [] : result.console.filter(c => c.type === 'error' && knownFor('console', c));
  result.consoleErrors = result.console.filter(c => c.type === 'error' && (opts.strict || (!isAssetNoise(c) && !isApiLoadNoise(c) && !knownFor('console', c))));
  result.knownIssues = KNOWN_ISSUES.filter(k => result.api.some(a => k.api && k.api(a)) || result.console.some(c => k.console && k.console(c))).map(k => ({ id: k.id, reason: k.reason }));
  result.consoleWarnings = result.console.filter(c => c.type === 'warning');
  result.assetNoise = result.console.filter(c => c.type === 'error' && isAssetNoise(c)).length;

  const failures = [];
  if (result.pageErrors.length) failures.push(`${result.pageErrors.length} uncaught page error(s)`);
  if (result.consoleErrors.length) failures.push(`${result.consoleErrors.length} console error(s)`);
  const apiFails = result.apiSummary.filter(a => a.failed > 0);
  if (apiFails.length) failures.push(`API failures: ${apiFails.map(a => a.label + ' [' + a.errors.join('; ') + ']').join(', ')}`);
  if (missing.length) failures.push(`expected API calls not seen: ${missing.join(', ')}`);
  const badChecks = result.checks.filter(c => !c.ok);
  if (badChecks.length) failures.push(`smoke checks failed: ${badChecks.map(c => c.name).join(', ')}`);
  if (opts.strict && result.assets.failed.length) failures.push(`${result.assets.failed.length} image asset failure(s) (--strict)`);
  result.failures = failures;
  result.pass = failures.length === 0;
  result.finishedAt = new Date().toISOString();

  await fsp.writeFile(path.join(outDir, `${label}-report.json`), JSON.stringify(result, null, 2));
  await fsp.writeFile(path.join(outDir, `${label}-report.md`), toMarkdown(result));
  return result;
}

function toMarkdown(r) {
  const L = [];
  L.push(`# Flynn test report: ${r.file}`, '', `- Result: **${r.pass ? 'PASS' : 'FAIL'}**`, `- URL: ${r.url}`, `- Started: ${r.startedAt}`, `- Load: ${r.loadMs} ms`, '');
  if (r.failures.length) { L.push('## Failures'); r.failures.forEach(f => L.push(`- ${f}`)); L.push(''); }
  if ((r.knownIssues || []).length) { L.push('## Known pre-existing issues (not failing)'); r.knownIssues.forEach(k => L.push(`- **${k.id}**: ${k.reason}`)); L.push(''); }
  if ((r.notes || []).length) { L.push('## Notes'); r.notes.forEach(n => L.push(`- ${n}`)); L.push(''); }
  L.push('## API calls', '', '| API | kind | calls | ok | failed | rate-limited | errors |', '|---|---|---|---|---|---|---|');
  r.apiSummary.forEach(a => L.push(`| ${a.label} | ${a.kind} | ${a.calls} | ${a.ok} | ${a.failed} | ${a.rateLimited || 0} | ${a.errors.join('; ')} |`));
  if (r.missingApis.length) L.push('', `Missing expected calls: ${r.missingApis.join(', ')}`);
  L.push('', `Image assets: ${r.assets.ok} ok, ${r.assets.failed.length} failed (fallback images handle these)`, '');
  L.push('## Smoke checks'); r.checks.forEach(c => L.push(`- [${c.ok ? 'x' : ' '}] ${c.name}${c.detail ? ' — ' + c.detail : ''}`));
  L.push('', '## Console errors'); if (!r.consoleErrors.length) L.push('- none'); r.consoleErrors.forEach(c => L.push(`- ${c.text} (${c.url})`));
  L.push('', '## Console warnings'); if (!r.consoleWarnings.length) L.push('- none'); r.consoleWarnings.forEach(c => L.push(`- ${c.text.slice(0, 300)}`));
  L.push('', '## Page errors'); if (!r.pageErrors.length) L.push('- none'); r.pageErrors.forEach(e => L.push('- ' + e.split('\n')[0]));
  const other = r.failedRequests.filter(f => f.kind === 'other');
  L.push('', '## Other failed requests'); if (!other.length) L.push('- none'); other.forEach(f => L.push(`- ${f.error} ${f.url}`));
  if (r.slidesNotSeen && r.slidesNotSeen.length) L.push('', `Slides never shown during cycle: ${r.slidesNotSeen.join(', ')}`);
  if (r.futuresSections) L.push('', `Futures sections rendered: ${r.futuresSections.join(', ') || 'none'}`);
  if (r.slides.length) { L.push('', '## Slides visited'); r.slides.forEach(s => L.push(`- ${s.n}. ${s.id}: ${s.text.slice(0, 120)}`)); }
  L.push('', '## Screenshots'); r.screenshots.forEach(s => L.push(`- ${path.relative(REPO, s)}`));
  return L.join('\n') + '\n';
}

function printSummary(r) {
  const tag = r.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`\n=== ${r.file}: ${tag} ===`);
  for (const a of r.apiSummary) console.log(`  ${a.failed ? '✗' : (a.rateLimited || a.known ? '!' : '✓')} ${a.label.padEnd(52)} ${a.ok}/${a.calls} ok${a.errors.length ? '  ' + a.errors.join('; ') : ''}`);
  (r.notes || []).forEach(n => console.log(`  note: ${n}`));
  if (r.missingApis.length) console.log(`  ✗ missing: ${r.missingApis.join(', ')}`);
  console.log(`  images: ${r.assets.ok} ok, ${r.assets.failed.length} failed (have onerror fallbacks)`);
  for (const c of r.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  (r.knownIssues || []).forEach(k => console.log(`  known issue (pre-existing, not failing): ${k.id}`));
  console.log(`  console errors: ${r.consoleErrors.length} (+${(r.knownConsoleErrors || []).length} known), warnings: ${r.consoleWarnings.length}, page errors: ${r.pageErrors.length}`);
  r.consoleErrors.forEach(c => console.log(`    error: ${c.text.slice(0, 200)}`));
  r.consoleWarnings.forEach(c => console.log(`    warn:  ${c.text.slice(0, 200)}`));
  r.pageErrors.forEach(e => console.log(`    pageerror: ${e.split('\n')[0]}`));
  r.failures.forEach(f => console.log(`  FAIL: ${f}`));
}

// ---------------------------------------------------------------- compare (before/after)
async function makeCompare(outDir, a, b, sizes) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const outputs = [];
  try {
    const page = await browser.newPage();
    const pairs = sizes.map(s => [s, a.screenshots.find(p => p.endsWith(`-${s}.png`)), b.screenshots.find(p => p.endsWith(`-${s}.png`))]);
    // slide-by-slide pairs (matched by slide id)
    const slidePairs = [];
    for (const sa of a.slides) { const sb = b.slides.find(x => x.id === sa.id); if (sb && !slidePairs.find(p => p[0] === sa.id)) slidePairs.push([sa.id, sa.screenshot, sb.screenshot]); }
    const img = p => p ? `data:image/png;base64,${fs.readFileSync(p).toString('base64')}` : '';
    const row = (title, pa, pb) => `<h2>${title}</h2><div class="row"><figure><figcaption>BEFORE: ${a.file} (${a.pass ? 'PASS' : 'FAIL'})</figcaption><img src="${img(pa)}"></figure><figure><figcaption>AFTER: ${b.file} (${b.pass ? 'PASS' : 'FAIL'})</figcaption><img src="${img(pb)}"></figure></div>`;
    const css = `<style>body{background:#111;color:#eee;font:16px sans-serif;margin:10px}.row{display:flex;gap:10px}figure{margin:0;flex:1}img{width:100%;border:1px solid #444}h2{margin:14px 0 6px}figcaption{padding:4px 0}</style>`;
    for (const [s, pa, pb] of pairs) {
      const html = `<html><head>${css}</head><body>${row('Initial load ' + s, pa, pb)}</body></html>`;
      await page.setViewport({ width: 2400, height: 800 });
      await page.setContent(html, { waitUntil: 'load' });
      const p = path.join(outDir, `compare-${s}.png`);
      await page.screenshot({ path: p, fullPage: true });
      outputs.push(p);
    }
    const all = `<html><head><title>Flynn before/after</title>${css}</head><body><h1>Before/after: ${a.file} vs ${b.file}</h1>` +
      pairs.map(([s, pa, pb]) => row('Initial load ' + s, pa, pb)).join('') + slidePairs.map(([id, pa, pb]) => row('Slide: ' + id, pa, pb)).join('') + '</body></html>';
    const hp = path.join(outDir, 'compare.html');
    await fsp.writeFile(hp, all);
    outputs.push(hp);
  } finally { await browser.close().catch(() => {}); }
  return outputs;
}

// ---------------------------------------------------------------- main
async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (opts.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n')); return 0; }
  const baseOut = path.resolve(REPO, opts.out || path.join('tools', 'out', `${stamp()}${opts.compare ? '-compare' : '-' + path.basename(opts.file, '.html')}`));
  console.log(`Output: ${path.relative(REPO, baseOut)}`);
  if (opts.compare) {
    const [fa, fb] = opts.compare;
    const ra = await runOne(opts, fa, baseOut, 'before'); printSummary(ra);
    await sleep(8000); // Open Trivia DB allows 1 request / 5 s per IP; don't let run 2 trip it
    const rb = await runOne(opts, fb, baseOut, 'after'); printSummary(rb);
    const outs = await makeCompare(baseOut, ra, rb, opts.sizes);
    console.log('\nSide-by-side:'); outs.forEach(o => console.log('  ' + path.relative(REPO, o)));
    const newApiFails = rb.apiSummary.filter(x => x.failed && !(ra.apiSummary.find(y => y.label === x.label && y.failed)));
    if (newApiFails.length) console.log(`\nNEW API failures in ${fb}: ${newApiFails.map(x => x.label).join(', ')}`);
    console.log(`\n${fb} vs ${fa}: console errors ${rb.consoleErrors.length} vs ${ra.consoleErrors.length}, page errors ${rb.pageErrors.length} vs ${ra.pageErrors.length}`);
    return rb.pass ? 0 : 1;
  }
  const r = await runOne(opts, opts.file, baseOut, path.basename(opts.file, '.html'));
  printSummary(r);
  console.log('\nScreenshots:'); r.screenshots.forEach(s => console.log('  ' + path.relative(REPO, s)));
  if (r.slides.length) console.log(`  + ${r.slides.length} slide screenshots in ${path.relative(REPO, path.dirname(r.slides[0].screenshot))}/`);
  console.log(`Report: ${path.relative(REPO, path.join(baseOut, r.label + '-report.md'))}`);
  return r.pass ? 0 : 1;
}

main().then(code => process.exit(code || 0)).catch(e => { console.error('HARNESS ERROR:', e && e.stack || e); process.exit(2); });
