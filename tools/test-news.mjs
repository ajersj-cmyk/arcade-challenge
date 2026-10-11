#!/usr/bin/env node
// HEADLINES slide checks with mocked ESPN news feeds.  node tools/test-news.mjs [preview.html]
//  photo hero + up-next rail, favourite team first (gold chip), BREAKING (< 1 h), topic kickers from keywords, copy cleanup
//  ("Sources:", "- ESPN", long titles trimmed at a word boundary), fantasy/betting filtered, logo art when a story has no
//  photo, combiner-resized images + lazy thumbs, hero rotation every 7 s and slide time = stories x 7 s, Ken Burns only in
//  Full (none in the TV app), fits above the ticker at 720p + 1080p, sport mode fetches only its feed, rss2json fallback
//  when ESPN is down, remote nav still moves on, 0 console errors.
//  Story blurbs: ESPN article text (content.core.api.espn.com) -> 2-3 whole sentences, embeds/HTML/dateline stripped, entities
//  decoded, a verbatim key quote, ESPN description fallback (no story / premium), 7/10/12 s per story,
//  only the shown stories fetched (cached), copy never over the chips at 720p/1080p.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || 'preview.html';
const srv = http.createServer((q, s) => { const f = path.join(REPO, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(REPO)) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); s.end(d); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const ago = m => new Date(Date.now() - m * 60000).toISOString();
const img = (id, w = 576, h = 324) => [{ type: 'header', width: w, height: h, url: `https://a.espncdn.com/photo/2026/1009/${id}_${w}x${h}_${w * 9 === h * 16 ? "16-9" : "3-2"}.jpg` }];
const team = (id, d, sh) => ({ type: 'team', teamId: id, description: d, team: { id, description: d, shortDisplayName: sh } });
const api = id => ({ api: { self: { href: `http://content.core.api.espn.com/v1/sports/news/${id}` } } });
const S1 = "The Carolina Hurricanes acquired defenseman Jordan Example from the San Jose Sharks on Sunday for a 2027 second-round pick. The 26-year-old has 14 points in 20 games this season.";
const Q1 = "\u201cHe's a big, mobile guy who can move the puck, and that's exactly what we needed,\u201d Brind'Amour said.";
const S4 = "Bears quarterback Caleb Example said Sunday the offense is finally clicking. Chicago has scored on 9 of its last 12 drives. It was the team's best stretch since 2019.";
const STORIES = {
  1: '<p><video1></p>\n<p>RALEIGH, N.C. -- The <a href="https://www.espn.com/nhl/team/_/name/car">Carolina Hurricanes</a> acquired defenseman <a href="x">Jordan Example</a> from the San Jose Sharks on Sunday for a 2027 second-round pick. The 26-year-old has 14 points in 20 games this season.</p>\n<p><photo1></p>\n' +
     '<p>Example is expected to join the team in time for Tuesday&#39;s game against the Flyers, according to coach Rod Brind&#39;Amour. He will wear No. 44.</p>\n<p>&#8220;He&#39;s a big, mobile guy who can move the puck, and that&#39;s exactly what we needed,&#8221; Brind&#39;Amour said.</p>\n<p>More later.</p>',
  4: '<p>LAKE FOREST, Ill. -- Bears quarterback <a href="x">Caleb Example</a> said Sunday the offense is finally clicking. Chicago has scored on 9 of its last 12 drives. It was the team&#39;s best stretch since 2019. The Bears play the Packers next week at Lambeau Field in a game with big playoff stakes.</p>',
  6: '<p>This premium story text must never be shown.</p>',
};
let artReqs = [];
const FEEDS = {
  'hockey/nhl': [
    { id: 1, type: 'HeadlineNews', headline: 'Hurricanes acquire defenseman Jordan Example from Sharks - ESPN', description: 'Carolina adds depth.', published: ago(12), images: img('r1'), links: api(1), categories: [team(12, 'Carolina Hurricanes', 'Hurricanes'), { type: 'athlete', athleteId: 99 }] },
    { id: 2, type: 'Story', headline: "Sources: Senators' Eklund out for 'extended' period with ankle injury", description: '', published: ago(190), images: [], links: api(2), categories: [team(14, 'Ottawa Senators', 'Senators')] },
  ],
  'football/nfl': [
    { id: 3, type: 'Story', headline: 'Fantasy football Week 6 cheat sheet: start em, sit em', published: ago(5), images: img('r3'), categories: [] },
    { id: 4, type: 'HeadlineNews', headline: 'Bears quarterback says the offense is finally clicking after a long stretch of slow starts and stalled drives in the red zone this year', description: '', published: ago(40), images: img('r4'), links: api(4), categories: [team(3, 'Chicago Bears', 'Bears')] },
    { id: 5, type: 'Media', headline: 'Watch: Rams win in OT', description: 'Los Angeles wins it on a one-handed grab in overtime.', published: ago(300), images: img('r5'), categories: [] },
    { id: 6, type: 'Story', headline: 'Broncos sign veteran pass rusher to one-year deal', description: 'Denver adds a veteran edge rusher for the stretch run.', premium: true, links: api(6), published: ago(2880), images: img('r6', 600, 400).concat(img('r6b')), categories: [team(7, 'Denver Broncos', 'Broncos')] },
  ],
};
let down = false, rssHits = 0;
async function open({ w = 1280, h = 720, tv = false, mode = '' } = {}) {
  const page = await browser.newPage(); const errors = [], newsReqs = [];
  await page.setUserAgent(ua); await page.emulateTimezone('America/New_York'); await page.setViewport({ width: w, height: h });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|tailwind|net::/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGE ' + e));
  await page.setRequestInterception(true);
  page.on('request', req => { const u = req.url(), m = /\/sports\/([^/]+\/[^/]+)\/news\?/.exec(u);
    if (m) { newsReqs.push(m[1] + (/team=/.test(u) ? ' team' : ''));
      if (down) return req.respond({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'down' });
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ articles: /team=/.test(u) ? [] : (FEEDS[m[1]] || []) }) }); }
    const am = /(?:content|now)\.core\.api\.espn\.com\/v1\/sports\/news\/(\d+)/.exec(u);
    if (am) { artReqs.push(+am[1]); return STORIES[am[1]] && am[1] !== '6' ? req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ headlines: [{ id: +am[1], story: STORIES[am[1]] }] }) })
      : req.respond({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }); }
    if (/rss2json/.test(u)) { rssHits++; return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ status: 'ok', items: [{ title: 'Fallback headline from the RSS feed works fine', pubDate: '2026-10-09 20:00:00', link: 'x' }] }) }); }
    if (/a\.espncdn\.com\/(combiner|photo|i\/)/.test(u) && req.resourceType() === 'image') return req.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="#357"/></svg>' });
    req.continue(); });
  await page.evaluateOnNewDocument((tv, mode) => { if (tv) window.ArcadeTV = {}; localStorage.removeItem('ahlersSportMode1'); if (mode) localStorage.setItem('ahlersSportMode1', JSON.stringify({ mode, until: Date.now() + 3600000, snap: null })); }, tv, mode);
  await page.goto(base + FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof arcadeNav !== 'undefined' && arcadeNav.current, { timeout: 90000 });
  await page.evaluate(() => { arcadeNav.paused = true; nwCache.at = 0; });
  newsReqs.length = 0; artReqs = [];
  await page.evaluate(() => { arcadeNav.paused = false; navGoTo('news'); });
  await page.waitForFunction(() => document.getElementById('news-screen').style.display === 'flex' && (document.getElementById('nw-hero') || document.querySelector('.nw-empty')), { timeout: 20000 });
  await sleep(800);
  return { page, errors, newsReqs };
}
const state = page => page.evaluate(() => {
  const q = s => document.querySelector(s), r = e => e && e.getBoundingClientRect();
  return { items: nwState.items.map(i => ({ title: i.title, fav: i.fav, breaking: i.breaking, topic: i.topic && i.topic[0], img: i.img })), i: nwState.i,
    chips: [...document.querySelectorAll('#nw-chips .nw-chip')].map(c => c.textContent), kick: (q('.nw-kick') || {}).textContent, title: (q('.nw-title') || {}).textContent,
    heroImg: (q('.nw-ph.on img') || {}).src || '', art: !!q('.nw-ph.on .nw-art'), kb: !!q('.nw-ph.on.kb'), kbAnim: q('.nw-ph.on img') ? getComputedStyle(q('.nw-ph.on img')).animationName : '',
    rows: document.querySelectorAll('#nw-rail .nw-row').length, lazy: [...document.querySelectorAll('#nw-rail .nw-th img')].every(i => i.loading === 'lazy' || i.classList.contains('logo')),
    thumbs: [...document.querySelectorAll('#nw-rail .nw-th img')].map(i => i.src), imgCount: document.querySelectorAll('#news-screen img').length,
    blurb: (q('#nw-copy .nw-blurb') || {}).textContent || '', quote: (q('#nw-copy .nw-quote') || {}).textContent || '', ms: getComputedStyle(q('#nw-hero') || document.body).getPropertyValue('--nw-ms').trim(),
    copyTop: r(q('#nw-copy')) ? r(q('#nw-copy')).top : 0, copyBottom: r(q('#nw-copy')) ? r(q('#nw-copy')).bottom : 0, chipsBottom: r(q('#nw-chips')) ? r(q('#nw-chips')).bottom : 0,
    blurbPx: q('#nw-copy .nw-blurb') ? parseFloat(getComputedStyle(q('#nw-copy .nw-blurb')).fontSize) : 0,
    rd: [...document.querySelectorAll('#nw-rail .nw-rd')].map(e => ({ t: e.textContent, one: e.scrollHeight <= e.clientHeight + 2 })),
    ago: (q('.nw-ago') || {}).textContent, head: q('#news-screen .screen-header').textContent,
    stageBottom: r(q('#news-stage')).bottom, tickerTop: r(q('#sports-ticker')).top, heroBottom: r(q('#nw-hero')).bottom, railBottom: r(q('#nw-rail')).bottom, current: arcadeNav.current };
});

// ---- Full, 1280x720, normal rotation
{
  const { page, errors, newsReqs } = await open();
  let s = await state(page);
  check('fetches ESPN news for the enabled leagues', ['football/nfl', 'hockey/nhl'].every(l => newsReqs.includes(l)), newsReqs.join(','));
  check('fantasy cheat sheet filtered out', !s.items.some(i => /cheat sheet/i.test(i.title)), s.items.map(i => i.title).join(' | '));
  check('favourite team (Carolina Hurricanes) story is the hero first', s.i === 0 && /HURRICANES ACQUIRE|Hurricanes acquire/i.test(s.title), s.title);
  check('gold favourite chip + BREAKING chip on a 12-min-old story', s.chips.includes('BREAKING') && s.chips.some(c => /HURRICANES/.test(c)), s.chips.join(','));
  check('TRADE ALERT kicker with the team name', /^TRADE ALERT · Carolina Hurricanes$/i.test(s.kick), s.kick);
  check('relative time "12 MIN AGO"', s.ago === '12 MIN AGO', s.ago);
  check('"- ESPN" suffix removed', !/ESPN/.test(s.title), s.title);
  const sen = s.items.find(i => /Eklund/.test(i.title)), bears = s.items.find(i => /Bears/.test(i.title));
  check('"Sources:" prefix removed + INJURY UPDATE', sen && !/^Sources/i.test(sen.title) && sen.topic === 'INJURY UPDATE', JSON.stringify(sen));
  check('long headline trimmed at a word boundary with an ellipsis', bears && bears.title.length <= 92 && /\w…$/.test(bears.title), bears && bears.title);
  check('SIGNING kicker + 16:9 image preferred over 3:2', s.items.some(i => i.topic === 'SIGNING' && /r6b_/.test(i.img)));
  check('Media item gets WATCH', s.items.some(i => i.topic === 'WATCH'));
  check('hero photo via ESPN combiner at 960x540', /combiner\/i\?img=\/photo\/2026\/1009\/r1_.*w=960&h=540/.test(s.heroImg), s.heroImg);
  check('4 up-next photo cards, lazy-loaded, 320x180', s.rows === 4 && s.lazy && s.thumbs.some(t => /w=320&h=180/.test(t)), s.rows + ' ' + s.thumbs[0]);
  check('image count capped (<= 8 in the slide)', s.imgCount <= 8, s.imgCount);
  check('Ken Burns zoom in Full', s.kb && s.kbAnim === 'nw-kb', s.kbAnim);
  check('fits above the ticker at 720p', s.stageBottom <= s.tickerTop && s.heroBottom <= s.tickerTop, `${s.stageBottom} / ${s.tickerTop}`);
  check('blurb = the first whole sentences of the ESPN story (verbatim; dateline, links, <video1>/<photo1> stripped)', s.blurb === S1, s.blurb);
  check('key quote = the first quote paragraph, verbatim with attribution, entities decoded', s.quote === Q1, s.quote);
  check('blurb + quote: hero gets 12 s; blurb text >= 20 px at 720p', s.ms === '12000ms' && s.blurbPx >= 20, s.ms + ' ' + s.blurbPx + 'px');
  check('720p: copy (title + blurb + quote) stays below the chips and inside the hero', s.copyTop >= s.chipsBottom && s.copyBottom <= s.heroBottom, `${s.copyTop} >= ${s.chipsBottom}, ${s.copyBottom} <= ${s.heroBottom}`);
  const tx = await page.evaluate(() => nwState.items.map(i => ({ t: i.title, b: (nwTxt[i.id] || {}).blurb || '', q: (nwTxt[i.id] || {}).quote || '', src: (nwTxt[i.id] || {}).src })));
  const b4 = tx.find(x => /Bears/.test(x.t)), b6 = tx.find(x => /Broncos/.test(x.t)), b2 = tx.find(x => /Eklund/.test(x.t));
  check('3 short sentences, abbreviation "Ill." dateline stripped, cut before the 4th sentence', b4 && b4.b === S4, b4 && b4.b);
  check('premium story: ESPN description instead of the article text', b6 && b6.src === 'desc' && /^Denver adds/.test(b6.b) && !/premium/.test(b6.b), JSON.stringify(b6));
  check('no story text and no description: no blurb (7 s)', b2 && !b2.b, JSON.stringify(b2));
  check('article text fetched only for the shown stories (<= 5, once each)', artReqs.length <= 5 && new Set(artReqs).size === artReqs.length && artReqs.every(id => s.items.length >= 1), artReqs.join(','));
  check('Up Next cards unchanged (no blurb there: the rail is too narrow to show one whole)', s.rd.length === 0 && s.rows === 4, s.rows + ' rows');
  await sleep(7000); s = await state(page);
  check('hero 1 (blurb + quote) still up after 7 s', s.i === 0, 'i=' + s.i);
  await sleep(5200); s = await state(page);
  check('hero rotates to story 2 after 12 s', s.i === 1, 'i=' + s.i);
  // story without a photo → team logo art
  const ni = await page.evaluate(() => nwState.items.findIndex(i => !i.img));
  await page.evaluate(i => nwHero(nwState.gen, i), ni); s = await state(page);
  check('no photo: team logo art fallback', s.art && /INJURY UPDATE/.test(s.kick), s.kick);
  // the chain restarted at story ni: the slide ends when the last story has had its own time
  const rest = await page.evaluate(i => nwState.items.slice(i).reduce((t, it) => t + nwMs(it), 0), ni);
  const per = await page.evaluate(() => nwState.items.map(nwMs));
  check('per-story time: 12 s with blurb + quote, 10 s blurb, 7 s none; 5 stories <= 60 s', per.length === 5 && per.every(x => [7000, 10000, 12000].includes(x)) && per.reduce((a, b) => a + b, 0) <= 60000, per.join(','));
  await sleep(rest - 1500); s = await state(page);
  check('still on the slide until the last story has had its time', s.current === 'news', 'current=' + s.current);
  await sleep(4000); s = await state(page);
  check('slide hands off after the last story', s.current !== 'news', 'current=' + s.current + ' rest=' + rest);
  const n0 = artReqs.length; await page.evaluate(() => { arcadeNav.paused = true; navGoTo('news'); }); await sleep(3000);
  check('back on the slide: article text from the cache (no new requests)', artReqs.length === n0, `${n0} -> ${artReqs.length}`);
  await page.evaluate(() => { arcadeNav.paused = false; });
  check('0 console errors (Full)', errors.length === 0, errors.join(' | '));
  await page.close();
}
// ---- TV app, 1920x1080: no Ken Burns, still fits
{
  const { page, errors } = await open({ w: 1920, h: 1080, tv: true });
  const s = await state(page);
  check('TV app: still photo (no Ken Burns)', !s.kb && s.kbAnim === 'none', s.kbAnim);
  check('fits above the ticker at 1080p', s.stageBottom <= s.tickerTop, `${s.stageBottom} / ${s.tickerTop}`);
  check('1080p TV: blurb + quote shown, copy below the chips and inside the hero', s.blurb === S1 && s.quote === Q1 && s.copyTop >= s.chipsBottom && s.copyBottom <= s.heroBottom, `${s.copyTop} >= ${s.chipsBottom}`);
  check('0 console errors (TV)', errors.length === 0, errors.join(' | '));
  await page.close();
}
// ---- NFL sport mode: only the NFL feed
{
  const { page, errors, newsReqs } = await open({ mode: 'nfl' });
  const s = await state(page);
  check('NFL mode: header + only football/nfl fetched', s.head === 'NFL HEADLINES' && newsReqs.length > 0 && newsReqs.every(r => r.startsWith('football/nfl')), newsReqs.join(','));
  check('NFL mode: NFL stories only', s.items.length >= 2 && s.items.every(i => !/Hurricanes|Eklund/.test(i.title)), s.items.map(i => i.title).join(' | '));
  check('0 console errors (NFL mode)', errors.length === 0, errors.join(' | '));
  await page.close();
}
// ---- ESPN down: rss2json fallback, still a hero (logo art)
{
  down = true; const { page, errors } = await open(); down = false;
  const s = await state(page);
  check('ESPN down: rss2json fallback headline shown', rssHits > 0 && /FALLBACK HEADLINE|Fallback headline/i.test(s.title || ''), s.title);
  check('0 console errors (fallback)', errors.length === 0, errors.join(' | '));
  await page.close();
}
await browser.close(); srv.close();
console.log(fails ? `${fails} check(s) FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
