#!/usr/bin/env node
// Score-celebration checks (run from repo root):  node tools/test-celebrate.mjs [preview.html]
// Opens Gamecasts for mocked games (ESPN summary responses are faked, so scores can be changed between polls), turns a
// team on with the in-Gamecast ★ toggle, then checks: no fire on first load, GOAL!! / TOUCHDOWN!! / CANES WIN!! /
// HALFTIME! on the right changes, no repeat on a score correction, the 0-30 s delay (fires late; cancelled by a
// correction or by closing the Gamecast), any key dismisses, settings D-pad delay control, preview hook. Screenshots
// go to tools/out/<stamp>-celebrate/.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(REPO, 'tools', 'out', `${stamp}-celebrate`); fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : (f.endsWith('.json') ? 'application/json' : 'application/octet-stream') }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const shots = [];
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const isNoise = t => (/Failed to load resource/.test(t) && !/summary\?event=99/.test(t)) || /favicon/.test(t);

// ---- mocked games
const team = (id, full, short, abbr, color, alt, logo) => ({ id, displayName: full, shortDisplayName: short, name: short, abbreviation: abbr, location: full.replace(' ' + short, ''), color, alternateColor: alt, logos: [{ href: logo, rel: ['full', 'default'] }] });
const T = {
  car: team('12', 'Carolina Hurricanes', 'Hurricanes', 'CAR', 'ce1126', '000000', 'https://a.espncdn.com/i/teamlogos/nhl/500/car.png'),
  nyr: team('13', 'New York Rangers', 'Rangers', 'NYR', '0038a8', 'ce1126', 'https://a.espncdn.com/i/teamlogos/nhl/500/nyr.png'),
  ecu: team('151', 'East Carolina Pirates', 'Pirates', 'ECU', '4b1869', 'fdc82f', 'https://a.espncdn.com/i/teamlogos/ncaa/500/151.png'),
  tem: team('218', 'Temple Owls', 'Owls', 'TEM', '9e1b34', 'ffffff', 'https://a.espncdn.com/i/teamlogos/ncaa/500/218.png'),
};
const games = {
  '990001': { away: T.nyr, home: T.car, a: 1, h: 1, state: 'in', name: 'STATUS_IN_PROGRESS', detail: '2nd 12:34', play: 'Faceoff won by CAR' },
  '990002': { away: T.tem, home: T.ecu, a: 21, h: 24, state: 'in', name: 'STATUS_IN_PROGRESS', detail: '2nd 4:10', play: 'Pass complete', scoring: '' },
};
const summary = id => { const g = games[id]; return { header: { competitions: [{ status: { period: 2, displayClock: '12:34', type: { state: g.state, name: g.name, completed: g.state === 'post', detail: g.detail, shortDetail: g.detail, description: g.detail } },
  competitors: [{ homeAway: 'home', score: String(g.h), team: g.home }, { homeAway: 'away', score: String(g.a), team: g.away }] }] },
  plays: [{ text: g.play, type: { text: '' } }], scoringPlays: g.scoring ? [{ text: g.scoring, type: { text: g.scoringType || '' } }] : [] }; };
const META = {
  '990001': { key: 'test:990001', sport: 'hockey', league: 'nhl', cid: 'nhl', id: '990001', label: 'NHL', away: 'Rangers', home: 'Hurricanes', awayAbbr: 'NYR', homeAbbr: 'CAR', state: 'in' },
  '990002': { key: 'test:990002', sport: 'football', league: 'college-football', cid: 'cfb', id: '990002', label: 'CFB', away: 'Temple', home: 'East Carolina', awayAbbr: 'TEM', homeAbbr: 'ECU', state: 'in' },
};

const page = await browser.newPage();
await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: 1920, height: 1080 });
const errors = []; page.on('console', m => { if (m.type() === 'error' && !isNoise(m.text() + ' ' + ((m.location() || {}).url || ''))) errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGE ' + e));
await page.setRequestInterception(true);
page.on('request', req => { const m = /summary\?event=(99\d+)/.exec(req.url()); if (m && games[m[1]]) return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(summary(m[1])) }); req.continue(); });
await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('ahlersCelebrateTeams1'); } catch (e) {} });
await page.goto(base + FILE, { waitUntil: 'load' });
await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current && typeof celObserve === 'function', { timeout: 90000 });
await page.evaluate(() => { arcadeNav.paused = true; settings.celebrateDelay = 0; });
const st = () => page.evaluate(() => ({ showing: cel.showing, fired: cel.fired, last: cel.last, pending: cel.pending.length, gcOpen: gc.open, err: gc.renderErr, polls: gc.polls,
  shown: getComputedStyle(document.getElementById('celebrate')).display, mq: document.getElementById('cel-mq1').textContent.slice(0, 40), sub: document.getElementById('cel-sub').textContent }));
const poll = async () => { const p0 = await page.evaluate(() => gc.lastOk); await page.evaluate(() => { clearTimeout(gc.timer); gcPoll(); }); await page.waitForFunction(p => gc.lastOk !== p, { timeout: 8000 }, p0).catch(() => {}); await sleep(150); };
const open = async id => { await page.evaluate(m => { gcOpenEvent(m); gc.pollMs = 600000; }, META[id]); await page.waitForFunction(() => gc.lastOk > 0, { timeout: 8000 }); await sleep(200); };
const waitShow = async (ms = 2500) => page.waitForFunction(() => cel.showing, { timeout: ms }).then(() => true).catch(() => false);
// Catch the strobe on a team-colour frame (the alternate wash flashes on/off every 0.18 s).
const celShot = async name => { await sleep(1100); await page.evaluate(() => { const st = document.createElement('style'); st.id = 'shot-freeze'; st.textContent = '#celebrate .cel-wash.w2 { opacity: 0 !important; }'; document.head.appendChild(st); }); await sleep(120); await shot(name); await page.evaluate(() => document.getElementById('shot-freeze').remove()); };
const shot = async name => { const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f }); shots.push(path.relative(REPO, f)); };
const dismiss = async () => { await page.keyboard.press('Enter'); await sleep(200); };

// 1. hockey: toggle, first load, goal
await open('990001');
let s = await st();
const btn = await page.evaluate(() => { const b = document.getElementById('gc-cel-home'); return { dis: b.disabled, txt: b.innerText, ck: b.getAttribute('data-ck') }; });
check('gamecast shows a ★ CELEBRATE toggle per team (enabled, OFF)', !btn.dis && /OFF/.test(btn.txt) && btn.ck === 'nhl:12', JSON.stringify(btn));
await page.click('#gc-cel-home'); await sleep(200);
const saved = await page.evaluate(() => ({ ls: localStorage.getItem('ahlersCelebrateTeams1'), txt: document.getElementById('gc-cel-home').innerText, on: document.getElementById('gc-cel-home').classList.contains('on') }));
check('mouse click turns Hurricanes ON and saves it per team (localStorage)', saved.on && /ON/.test(saved.txt) && /"nhl:12"/.test(saved.ls || ''), JSON.stringify(saved));
// D-pad reachability: OK focuses the first toggle, RIGHT moves, OK toggles
await page.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
await page.keyboard.press('Enter'); await sleep(150);
const f1 = await page.evaluate(() => document.activeElement && document.activeElement.id);
for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await sleep(100); }
const f2 = await page.evaluate(() => document.activeElement && document.activeElement.id);
await page.keyboard.press('Enter'); await sleep(150); const offNow = await page.evaluate(() => !document.getElementById('gc-cel-home').classList.contains('on'));
await page.keyboard.press('Enter'); await sleep(150); const onAgain = await page.evaluate(() => document.getElementById('gc-cel-home').classList.contains('on'));
check('D-pad: OK focuses the away toggle, RIGHT x3 reaches the home toggle, OK toggles it', f1 === 'gc-cel-away' && f2 === 'gc-cel-home' && offNow && onAgain, `${f1} -> ${f2}, off ${offNow}, on ${onAgain}`);
await sleep(1500); await shot('gamecast-celebrate-toggles');
await page.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
s = await st(); check('no celebration on the first look at a game', s.fired === 0 && !s.showing && !s.err, JSON.stringify({ fired: s.fired, err: s.err }));
games['990001'].h = 2; await poll();
let shown = await waitShow(); s = await st();
check('Hurricanes goal between polls -> GOAL!! overlay with scrolling marquee', shown && s.last && s.last.text === 'GOAL!!' && /GOAL!!/.test(s.mq) && s.shown === 'block', JSON.stringify(s.last) + ' | ' + s.mq);
await celShot('celebrate-goal-hurricanes');
await dismiss(); s = await st();
const ae1 = await page.evaluate(() => document.activeElement && document.activeElement.id);
check('any key dismisses (and the key is not passed to the Gamecast)', !s.showing && s.shown === 'none' && s.gcOpen && !/gc-cel/.test(ae1 || ''), JSON.stringify({ showing: s.showing, gc: s.gcOpen, focus: ae1 }));
// 2. correction: 2 -> 1 -> 2 must not repeat
const fired0 = s.fired; games['990001'].h = 1; await poll(); games['990001'].h = 2; await poll(); await sleep(600); s = await st();
check('score correction (2 -> 1 -> 2) does not fire again', s.fired === fired0 && !s.showing, `fired ${fired0} -> ${s.fired}`);
// 3. delay 3 s via the Gamecast +/- control
for (let i = 0; i < 3; i++) await page.click('#gc-cel-dplus');
const dl = await page.evaluate(() => ({ v: settings.celebrateDelay, txt: document.getElementById('gc-cel-dval').textContent, ls: JSON.parse(localStorage.getItem('ahlersArcadeSettings') || '{}').celebrateDelay }));
check('Gamecast +/- sets the delay (3 s, saved)', dl.v === 3 && dl.txt === 'DELAY 3s' && dl.ls === 3, JSON.stringify(dl));
await page.evaluate(() => { cel.watch['test:990001'].at = 0; }); // the 20 s per-game debounce is not under test here
games['990001'].h = 3; const tDet = Date.now(); await poll(); s = await st();
const queuedNow = !s.showing && s.pending === 1;
shown = await waitShow(6000); const lag = Date.now() - tDet;
check('with a 3 s delay the goal is detected now and fires ~3 s later', queuedNow && shown && lag >= 2500 && lag <= 4800, `queued ${queuedNow}, fired after ${(lag / 1000).toFixed(1)} s`);
await dismiss();
await page.evaluate(() => { cel.watch['test:990001'].at = 0; });
games['990001'].h = 4; await poll(); const q1 = (await st()).pending; games['990001'].h = 3; await poll(); const q2 = (await st()).pending;
await sleep(3800); s = await st();
check('a correction before the delayed effect fires cancels it', q1 === 1 && q2 === 0 && !s.showing, `pending ${q1} -> ${q2}, showing ${s.showing}`);
await page.evaluate(() => { cel.watch['test:990001'].at = 0; });
games['990001'].h = 4; await poll(); const q3 = (await st()).pending; await page.evaluate(() => gcClose()); const q4 = (await st()).pending;
await sleep(3800); s = await st();
check('closing the Gamecast cancels its queued celebration', q3 === 1 && q4 === 0 && !s.showing, `pending ${q3} -> ${q4}, showing ${s.showing}`);
for (let i = 0; i < 3; i++) await page.evaluate(() => nudgeCelDelay(-1));
// 4. win
games['990001'].h = 4; games['990001'].a = 2; await open('990001'); // re-open: fresh baseline
games['990001'].state = 'post'; games['990001'].name = 'STATUS_FINAL'; games['990001'].detail = 'Final'; await poll();
shown = await waitShow(); s = await st();
check('final with a toggled team ahead -> CANES WIN!!', shown && s.last && s.last.text === 'CANES WIN!!', JSON.stringify(s.last));
await celShot('celebrate-win-canes'); await dismiss();
await page.evaluate(() => gcClose());
// 5. football TD, PAT, halftime
await open('990002'); await page.click('#gc-cel-home'); await sleep(100);
Object.assign(games['990002'], { h: 30, scoring: 'Pirates QB 12 Yd Run', scoringType: 'Rushing Touchdown' }); await poll();
shown = await waitShow(); s = await st();
check('ECU +6 with a touchdown scoring play -> TOUCHDOWN!!', shown && s.last && s.last.text === 'TOUCHDOWN!!', JSON.stringify(s.last));
await celShot('celebrate-touchdown-ecu'); await dismiss();
const f3 = (await st()).fired; Object.assign(games['990002'], { h: 31, scoring: 'Extra point good', scoringType: 'Extra Point' }); await poll(); await sleep(500);
check('extra point after the TD does not fire', (await st()).fired === f3);
Object.assign(games['990002'], { h: 34, scoring: 'Pirates 41 Yd FG', scoringType: 'Field Goal' }); await page.evaluate(() => { cel.watch['test:990002'].at = 0; }); await poll();
shown = await waitShow(); s = await st(); check('ECU +3 -> FIELD GOAL!!!', shown && s.last && s.last.text === 'FIELD GOAL!!!', JSON.stringify(s.last) + ' fired ' + s.fired + ' pending ' + s.pending + ' delay ' + (await page.evaluate(() => settings.celebrateDelay))); await dismiss();
Object.assign(games['990002'], { name: 'STATUS_HALFTIME', detail: 'Halftime' }); await poll();
shown = await waitShow(); s = await st();
const mini = await page.evaluate(() => document.getElementById('celebrate').classList.contains('mini'));
check('halftime in a toggled team\'s game -> smaller HALFTIME! moment', shown && s.last && s.last.text === 'HALFTIME!' && mini, JSON.stringify(s.last));
await dismiss(); await page.evaluate(() => gcClose());
// 6. settings delay with D-pad LEFT/RIGHT
await page.evaluate(() => { document.body.classList.add('nav-active'); toggleSettings(); }); await sleep(200); // settings auto-focuses its first item
await page.evaluate(() => { const d = document.getElementById('cel-delay-display'); d.scrollIntoView({ block: 'center' }); d.focus(); }); await sleep(100);
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft'); await sleep(150);
const sd = await page.evaluate(() => ({ open: navIsSettingsOpen(), cel: cel.showing, v: settings.celebrateDelay, txt: document.getElementById('cel-delay-display').textContent, focus: document.activeElement.id, master: document.getElementById('set-celebrate').checked }));
await shot('settings-celebration');
for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
const vmax = await page.evaluate(() => settings.celebrateDelay);
for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
const vmin = await page.evaluate(() => settings.celebrateDelay);
check('settings: D-pad ◀/▶ on the delay adjusts 1 s steps within 0-30 s; master toggle defaults ON', sd.v === 1 && sd.txt === '1s' && sd.focus === 'cel-delay-display' && vmax === 30 && vmin === 0 && sd.master, JSON.stringify({ ...sd, vmax, vmin }));
await page.evaluate(() => toggleSettings());
// 7. preview hooks
await page.evaluate(() => arcadeCelebrate('test')); s = await st(); const q = await page.evaluate(() => cel.queue.length);
check('arcadeCelebrate("test") previews GOAL!! then queues TD + WIN', s.showing && s.last.text === 'GOAL!!' && q === 2, `${s.last && s.last.text}, queued ${q}`);
await dismiss(); s = await st(); check('a key during the preview clears the whole sequence', !s.showing && (await page.evaluate(() => cel.queue.length)) === 0);
const p2 = await browser.newPage(); await p2.setUserAgent(ua); await p2.setViewport({ width: 1920, height: 1080 });
await p2.goto(base + FILE + '?celebrate=td', { waitUntil: 'domcontentloaded' });
const hook = await p2.waitForFunction(() => window.cel && cel.showing && cel.last && cel.last.text, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => null);
check('URL hook ?celebrate=td shows the touchdown preview', hook === 'TOUCHDOWN!!', String(hook));
await p2.close();

check('no console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log('\nScreenshots:\n  ' + shots.join('\n  '));
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL CELEBRATION CHECKS PASSED');
await browser.close(); srv.close(); process.exit(fails ? 1 : 0);
