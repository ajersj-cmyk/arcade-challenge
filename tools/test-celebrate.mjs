#!/usr/bin/env node
// Score-celebration checks (run from repo root):  node tools/test-celebrate.mjs [preview.html]
// Opens Gamecasts for mocked games (ESPN summary responses are faked, so scores can be changed between polls), turns a
// team on with the in-Gamecast ★ toggle, then checks: no fire on first load, GOAL!! / TOUCHDOWN!! / CANES WIN!! /
// HALFTIME! on the right changes, no repeat on a score correction, the 0-30 s delay (fires late; cancelled by a
// correction or by closing the Gamecast), any key dismisses, settings D-pad delay control, preview hook. Screenshots
// go to tools/out/<stamp>-celebrate/. Also: scorer name + headshot on the celebration, FG hold-back, the smaller alert
// banners (red zone, big play/turnover, lead change, game start, power play, per-type off switch) and the SYNC NOW helper.
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
const summary = id => { const g = games[id]; return { header: { competitions: [{ status: { period: 2, displayClock: g.clock || '12:34', type: { state: g.state, name: g.name, completed: g.state === 'post', detail: g.detail, shortDetail: g.detail, description: g.detail } },
  competitors: [{ homeAway: 'home', score: String(g.h), team: g.home }, { homeAway: 'away', score: String(g.a), team: g.away }] }] },
  plays: [{ text: g.play, type: { text: '' } }].concat(g.plays || []), scoringPlays: g.scoring ? [{ id: 'sp-' + g.h + '-' + g.a, text: g.scoring, type: { text: g.scoringType || '' }, team: { id: g.scoringTeam || g.home.id } }] : [],
  situation: g.sit, drives: g.drives }; };
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
const al = () => page.evaluate(() => ({ showing: cel.alShowing, fired: cel.alFired, last: cel.alLast, aq: cel.aq.length, pending: cel.pending.length, shown: getComputedStyle(document.getElementById('cel-alert')).display,
  title: document.getElementById('al-title').textContent, sub: document.getElementById('al-sub').textContent }));
const waitAl = async (ms = 3000) => page.waitForFunction(() => cel.alShowing, { timeout: ms }).then(() => true).catch(() => false);
const alClear = () => page.evaluate(() => { alHide(true); cel.aq = []; });
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
for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await sleep(100); }
const f2 = await page.evaluate(() => document.activeElement && document.activeElement.id);
await page.keyboard.press('Enter'); await sleep(150); const offNow = await page.evaluate(() => !document.getElementById('gc-cel-home').classList.contains('on'));
await page.keyboard.press('Enter'); await sleep(150); const onAgain = await page.evaluate(() => document.getElementById('gc-cel-home').classList.contains('on'));
check('D-pad: OK focuses the away toggle, RIGHT x4 (−, +, SYNC) reaches the home toggle, OK toggles it', f1 === 'gc-cel-away' && f2 === 'gc-cel-home' && offNow && onAgain, `${f1} -> ${f2}, off ${offNow}, on ${onAgain}`);
await sleep(1500); await shot('gamecast-celebrate-toggles');
await page.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
s = await st(); check('no celebration on the first look at a game', s.fired === 0 && !s.showing && !s.err, JSON.stringify({ fired: s.fired, err: s.err }));
games['990001'].h = 2;
games['990001'].plays = [{ id: 'g1', type: { text: 'Goal' }, scoringPlay: true, team: { id: '12' }, text: 'Sebastian Aho Goal (2) Wrist Shot, assists: Seth Jarvis (3), Andrei Svechnikov (4)',
  participants: [{ athlete: { id: '3904173', displayName: 'Sebastian Aho', shortName: 'S. Aho' }, type: 'scorer' }, { athlete: { id: '4024854', displayName: 'Seth Jarvis', shortName: 'S. Jarvis' }, type: 'assister' }, { athlete: { id: '3900169', displayName: 'Andrei Svechnikov', shortName: 'A. Svechnikov' }, type: 'assister' }] }];
await poll();
let shown = await waitShow(); s = await st();
check('Hurricanes goal between polls -> GOAL!! overlay with scrolling marquee', shown && s.last && s.last.text === 'GOAL!!' && /GOAL!!/.test(s.mq) && s.shown === 'block', JSON.stringify(s.last) + ' | ' + s.mq);
const pc = await page.evaluate(() => ({ player: cel.last.player, more: document.getElementById('cel-pmore').textContent, name: document.getElementById('cel-pname').textContent, head: document.getElementById('cel-head').getAttribute('src'), has: document.getElementById('celebrate').classList.contains('has-player') }));
check('goal shows the scorer: name in the marquee + headshot card with assists', pc.has && pc.player === 'Sebastian Aho' && /SEBASTIAN AHO/.test(s.mq) && /ASSISTS: S\. JARVIS, A\. SVECHNIKOV/.test(pc.more) && /headshots\/nhl\/players\/full\/3904173\.png$/.test(pc.head || ''), JSON.stringify(pc));
const lite = await page.evaluate(() => ({ lite: document.getElementById('celebrate').classList.contains('lite'), conf: getComputedStyle(document.querySelector('#celebrate .cel-conf')).display, strobe: getComputedStyle(document.querySelector('#celebrate .cel-wash.w2')).animationName, rows: [...document.querySelectorAll('#celebrate .cel-mq')].filter(e => getComputedStyle(e).display !== 'none').length, shake: getComputedStyle(document.querySelector('#celebrate .cel-shake')).animationName, def: defaultSettings.celFull }));
check('effects default to LITE: no confetti/shake/continuous strobe (one 3-flash intro), one marquee strip', lite.lite && lite.conf === 'none' && lite.strobe === 'cel-lite-flash' && lite.rows === 1 && lite.shake === 'none' && lite.def === false, JSON.stringify(lite));
await celShot('celebrate-goal-hurricanes-lite');
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
const np = await page.evaluate(() => ({ p: cel.last.player, has: document.getElementById('celebrate').classList.contains('has-player') }));
check('a goal with no new scoring play falls back to the team logo only (no stale player)', np.p === '' && !np.has, JSON.stringify(np));
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
Object.assign(games['990002'], { h: 30, scoring: 'Rahjai Harris 12 Yd Run (Andrew Conrad Kick)', scoringType: 'Rushing Touchdown', scoringTeam: '151' }); await poll();
shown = await waitShow(); s = await st();
check('ECU +6 with a touchdown scoring play -> TOUCHDOWN!! + scorer from the play text (name card, no headshot id)', shown && s.last && s.last.text === 'TOUCHDOWN!!' && s.last.player === 'Rahjai Harris' && /RAHJAI HARRIS/.test(s.mq), JSON.stringify(s.last));
await celShot('celebrate-touchdown-ecu-lite'); await dismiss();
const f3 = (await st()).fired; Object.assign(games['990002'], { h: 31, scoring: 'Extra point good', scoringType: 'Extra Point' }); await poll(); await sleep(500);
check('extra point after the TD does not fire', (await st()).fired === f3);
Object.assign(games['990002'], { h: 34, scoring: 'Andrew Conrad 41 Yd Field Goal', scoringType: 'Field Goal Good' }); await page.evaluate(() => { cel.watch['test:990002'].at = 0; }); const tFg = Date.now(); await poll();
const early = await waitShow(3000);
shown = early ? false : await waitShow(5000); const fgLag = Date.now() - tFg; s = await st();
check('ECU +3 -> FIELD GOAL!!!, held back ~5 s (delay 0) so it never beats a TD', !early && shown && s.last && s.last.text === 'FIELD GOAL!!!' && fgLag >= 4500 && fgLag <= 8000, JSON.stringify(s.last) + ` after ${(fgLag / 1000).toFixed(1)} s`); await dismiss();
Object.assign(games['990002'], { name: 'STATUS_HALFTIME', detail: 'Halftime' }); await poll();
shown = await waitShow(); s = await st();
const mini = await page.evaluate(() => document.getElementById('celebrate').classList.contains('mini'));
check('halftime in a toggled team\'s game -> smaller HALFTIME! moment', shown && s.last && s.last.text === 'HALFTIME!' && mini, JSON.stringify(s.last));
await dismiss(); await page.evaluate(() => gcClose());
// 5b. football alerts: red zone (once per drive), big play, turnover, lead change after a TD
Object.assign(games['990002'], { name: 'STATUS_IN_PROGRESS', detail: '3rd 14:00', scoring: '', sit: { possession: '151', downDistanceText: '1st & 10 at TEM 45', isRedZone: false },
  drives: { previous: [], current: { id: 'd7', team: { id: '151' }, plays: [{ id: 'p40', type: { text: 'Rush' }, statYardage: 4, text: 'Harris rush for 4 yards' }] } } });
await open('990002');
games['990002'].sit = { possession: '151', downDistanceText: '1st & 10 at TEM 18', isRedZone: true }; await poll();
let ok = await waitAl(); let a = await al();
check('ECU drive reaches the red zone -> RED ZONE! banner (team colours/logo)', ok && a.last && a.last.type === 'redzone' && a.title === 'RED ZONE!' && /1ST & 10 AT TEM 18/.test(a.sub) && a.shown === 'block', JSON.stringify(a.last) + ' | ' + a.sub);
await sleep(900); await shot('alert-redzone-ecu');
let af = a.fired; await poll(); await sleep(300); a = await al();
check('the same red-zone trip does not re-fire on the next poll', a.fired === af, `fired ${af} -> ${a.fired}`);
await alClear();
games['990002'].drives.current.plays.push({ id: 'p41', type: { text: 'Pass Reception' }, statYardage: 34, text: 'Houser pass complete to Smith for 34 yds' }); await poll();
ok = await waitAl(); a = await al();
check('34-yard completion -> BIG PLAY! 34 YDS', ok && a.last && a.last.text === 'BIG PLAY! 34 YDS', JSON.stringify(a.last));
await alClear();
games['990002'].drives.previous = [{ id: 'd6', team: { id: '218' }, plays: [{ id: 'p30', type: { text: 'Pass Interception Return' }, statYardage: 0, text: 'Temple pass intercepted by ECU' }] }]; await poll();
ok = await waitAl(); a = await al();
check('opponent interception -> INTERCEPTION! for the toggled defence', ok && a.last && a.last.text === 'INTERCEPTION!' && /East Carolina/.test(a.last.team), JSON.stringify(a.last));
await alClear(); af = (await al()).fired;
games['990002'].a = 35; await poll(); await sleep(400);
check('lead change to the team that is not toggled: no alert', (await al()).fired === af);
Object.assign(games['990002'], { h: 41, scoring: 'Rahjai Harris 3 Yd Run (Andrew Conrad Kick)', scoringType: 'Rushing Touchdown', scoringTeam: '151' }); await poll();
shown = await waitShow(); const q0 = (await al()).aq; await dismiss();
ok = await waitAl(); a = await al();
check('TD that retakes the lead -> TOUCHDOWN!! first, then PIRATES TAKE THE LEAD! banner', shown && q0 === 1 && ok && a.last && a.last.text === 'PIRATES TAKE THE LEAD!', JSON.stringify({ q0, last: a.last }));
await alClear(); await page.evaluate(() => gcClose());
// 5c. hockey: game start, power play, per-type switch, SYNC NOW helper
Object.assign(games['990001'], { a: 0, h: 0, state: 'pre', name: 'STATUS_SCHEDULED', detail: '7:00 PM', plays: [], clock: '20:00' });
await open('990001');
Object.assign(games['990001'], { state: 'in', name: 'STATUS_IN_PROGRESS', detail: '1st 20:00' }); await poll();
ok = await waitAl(); a = await al();
check('pre -> in for a toggled team -> PUCK DROP! banner', ok && a.last && a.last.type === 'start' && a.last.text === 'PUCK DROP!', JSON.stringify(a.last));
await alClear();
games['990001'].plays = [{ id: 'pen1', type: { text: 'Hooking', penaltyMinutes: '2', penaltyType: 'Minor' }, team: { id: '13' }, text: 'Mika Zibanejad Hooking against Sebastian Aho' }]; await poll();
ok = await waitAl(); a = await al();
check('Rangers penalty -> POWER PLAY! banner for the Hurricanes', ok && a.last && a.last.type === 'pp' && /Hurricanes/.test(a.last.team) && /2 MIN/.test(a.last.sub), JSON.stringify(a.last));
await sleep(900); await shot('alert-powerplay-canes');
af = a.fired; await poll(); await sleep(300);
check('the same penalty does not re-fire', (await al()).fired === af);
await alClear(); await page.evaluate(() => { settings.alertPP = false; });
games['990001'].plays.push({ id: 'pen2', type: { text: 'Tripping', penaltyMinutes: '2', penaltyType: 'Minor' }, team: { id: '13' }, text: 'Adam Fox Tripping against Seth Jarvis' }); await poll(); await sleep(400);
check('Power Play alerts switched off in settings -> no banner', (await al()).fired === af);
await page.evaluate(() => { settings.alertPP = true; });
const alertRows = await page.evaluate(() => ['alertRedzone', 'alertPP', 'alertStart', 'alertLead', 'alertBig'].map(k => !!document.getElementById('set-' + k) && defaultSettings[k] === true));
check('settings has a per-alert-type on/off list (5 types, default ON)', alertRows.every(Boolean), JSON.stringify(alertRows));
// sync helper: data clock ticks between polls; SYNC NOW twice -> delay
Object.assign(games['990001'], { clock: '12:34', detail: '2nd 12:34' }); await poll(); Object.assign(games['990001'], { clock: '12:24', detail: '2nd 12:24' }); await poll(); await sleep(500);
const c1 = await page.evaluate(() => document.getElementById('gc-dclock').textContent); await sleep(1600); const c2 = await page.evaluate(() => document.getElementById('gc-dclock').textContent);
const secs = t => { const m = /(\d+):(\d\d)/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
check('Gamecast shows the feed clock next to the delay (P2 12:2x) and it ticks while running', /^DATA P2 12:2\d$/.test(c1) && secs(c2) < secs(c1), `${c1} -> ${c2}`);
await page.click('#gc-cel-sync'); await sleep(300);
const arm = await page.evaluate(() => ({ txt: document.getElementById('gc-cel-sync').textContent, arm: document.getElementById('gc-cel-sync').classList.contains('arm') }));
await shot('gamecast-sync-helper');
await sleep(2000); await page.click('#gc-cel-sync'); await sleep(200);
const syn = await page.evaluate(() => ({ v: settings.celebrateDelay, txt: document.getElementById('gc-cel-sync').textContent, dv: document.getElementById('gc-cel-dval').textContent, ls: JSON.parse(localStorage.getItem('ahlersArcadeSettings') || '{}').celebrateDelay }));
check('SYNC NOW locks the clock, second press when the TV matches sets the delay (~2 s, saved)', arm.arm && /^PRESS AT TV P2 12:\d\d$/.test(arm.txt) && syn.v >= 2 && syn.v <= 3 && /^SYNCED [23]s$/.test(syn.txt) && syn.dv === 'DELAY ' + syn.v + 's' && syn.ls === syn.v, JSON.stringify({ arm, syn }));
await page.focus('#gc-cel-dplus'); await page.keyboard.press('ArrowRight'); const fsync = await page.evaluate(() => document.activeElement.id);
check('SYNC NOW is reachable with the D-pad', fsync === 'gc-cel-sync', fsync);
await page.evaluate(() => { nudgeCelDelay(-30); gcClose(); });
// 6. settings delay with D-pad LEFT/RIGHT
await page.evaluate(() => { document.body.classList.add('nav-active'); toggleSettings(); }); await sleep(200); // settings auto-focuses its first item
await page.evaluate(() => { const d = document.getElementById('cel-delay-display'); d.scrollIntoView({ block: 'center' }); d.focus(); }); await sleep(100);
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft'); await sleep(150);
const sd = await page.evaluate(() => ({ open: navIsSettingsOpen(), cel: cel.showing, v: settings.celebrateDelay, txt: document.getElementById('cel-delay-display').textContent, focus: document.activeElement.id, master: document.getElementById('set-celebrate').checked }));
await page.evaluate(() => document.getElementById('set-alertRedzone').scrollIntoView({ block: 'center' })); await sleep(100);
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
const fx = await p2.evaluate(() => { const c = () => document.getElementById('celebrate').classList.contains('lite');
  settings.celFull = true; arcadeCelebrate('goal'); const full = !c(); window.ArcadeTV = {}; arcadeCelebrate('goal'); const tv = c(); delete window.ArcadeTV; settings.celFull = false; celHide(true);
  return { full, tv, row: !!document.getElementById('set-celFull') }; });
check('Full effects setting (D-pad checkbox) turns Lite off; the TV app (window.ArcadeTV) always gets Lite', fx.full && fx.tv && fx.row, JSON.stringify(fx));
await p2.evaluate(() => arcadeCelebrate('alerts'));
const demo = await p2.evaluate(() => ({ show: cel.alShowing, t: cel.alLast && cel.alLast.text, q: cel.aq.length }));
check('arcadeCelebrate("alerts") previews the banners (red zone first, others queued)', demo.show && demo.t === 'RED ZONE!' && demo.q === 3, JSON.stringify(demo));
await p2.close();

check('no console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log('\nScreenshots:\n  ' + shots.join('\n  '));
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL CELEBRATION CHECKS PASSED');
await browser.close(); srv.close(); process.exit(fails ? 1 : 0);
