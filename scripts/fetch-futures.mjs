#!/usr/bin/env node
// Builds futures.json (NFL + college football futures & awards odds, NHL Stanley Cup) for the scoreboard's futures slides.
// Run daily by .github/workflows/futures.yml; GitHub Pages then serves futures.json same-origin next to index.html.
//
// Sources (free, no key):
//   1. Action Network public web API (multi-book; consensus line used for display)
//   2. ESPN core API (DraftKings lines) fills any market Action Network lacks (e.g. NFL Coach of the Year)
// Safety: if fewer than MIN_MARKETS markets come back, the existing futures.json is kept untouched.
//
// Usage: node scripts/fetch-futures.mjs [outFile=futures.json]     (Node 18+)
//        FUTURES_SKIP_AN=1 node scripts/fetch-futures.mjs /tmp/x.json   (test the ESPN-only fallback)
import { writeFile, readFile } from 'node:fs/promises';

const OUT = process.argv[2] || 'futures.json';
const MIN_MARKETS = 5;
const TOP_N = 16;
// Action Network's CDN rejects non-browser user agents
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const AN_BOOKS = { 15: 'Consensus', 68: 'DraftKings', 69: 'FanDuel', 75: 'BetMGM', 123: 'Caesars' };

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
  }
}
const fmt = n => (n == null ? null : n > 0 ? `+${n}` : `${n}`);
const toNum = v => (v == null ? null : Number(String(v).replace('+', '')));
// Short team label: NCAAF display_name is the school ("VA Tech"); NFL display_name is the nickname ("Bills") -> strip it
const shortTeam = t => !t ? null : (!t.display_name ? t.full_name : (t.full_name && t.full_name.endsWith(' ' + t.display_name) ? t.full_name.slice(0, -t.display_name.length - 1) : t.display_name));
const implied = a => (a == null || isNaN(a) ? null : a > 0 ? 100 / (a + 100) : -a / (-a + 100));

// ---------- Action Network (league 1 = NFL, 2 = NCAAF); markets matched by regex on market name ----------
const AN_WANT = {
  nfl: { id: 1, want: [
    ['super_bowl', /superbowl - to win/i], ['afc_champ', /afc conference - to win/i], ['nfc_champ', /nfc conference - to win/i],
    ['afc_east', /afc east - to win/i], ['afc_north', /afc north - to win/i], ['afc_south', /afc south - to win/i], ['afc_west', /afc west - to win/i],
    ['nfc_east', /nfc east - to win/i], ['nfc_north', /nfc north - to win/i], ['nfc_south', /nfc south - to win/i], ['nfc_west', /nfc west - to win/i],
    ['mvp', /nfl mvp$/i], ['opoy', /offensive player of the year/i], ['dpoy', /defensive player of the year/i],
    ['oroy', /offensive rookie of the year/i], ['droy', /defensive rookie of the year/i], ['cpoy', /comeback player/i],
    ['coy', /coach of the year/i],
  ]},
  ncaaf: { id: 2, want: [
    ['cfb_title', /ncaaf championship - to win/i], ['heisman', /heisman/i], ['make_cfp_final', /to make cfp championship/i],
    ['sec', /\bsec conference - to win/i], ['big_ten', /big ten conference - to win/i], ['big_12', /big 12 conference - to win/i],
    ['acc', /\bacc conference - to win/i], ['american', /american conference - to win/i], ['mwc', /mountain west conference - to win/i],
    ['sun_belt', /sun belt conference - to win/i], ['mac', /mid-american conference - to win/i], ['cusa', /conference usa conference - to win/i],
    ['pac12', /pac-12 conference - to win/i],
  ]},
  nhl: { id: 3, want: [ ['stanley_cup', /stanley cup - to win/i] ] },   // AN league 3 = NHL (verified 2026-10-07)
};

async function actionNetwork(leagueKey) {
  if (process.env.FUTURES_SKIP_AN) throw new Error('skipped (FUTURES_SKIP_AN set, testing ESPN fallback)');
  const { id, want } = AN_WANT[leagueKey];
  const avail = await getJSON(`https://api.actionnetwork.com/web/v1/leagues/${id}/futures/available`);
  const out = {};
  for (const [key, re] of want) {
    const m = (avail.futures || []).find(f => re.test(f.name));
    if (!m) continue;
    try {
      const d = await getJSON(`https://api.actionnetwork.com/web/v1/leagues/${id}/futures/${encodeURIComponent(m.type)}?bookIds=${Object.keys(AN_BOOKS).join(',')}`);
      const teams = Object.fromEntries((d.teams || []).map(t => [t.id, t]));
      const players = Object.fromEntries((d.players || []).map(p => [p.id, p]));
      const byBook = Object.fromEntries((d.books || []).map(b => [b.book_id, b.odds || []]));
      const primaryId = byBook[15]?.length ? 15 : Number(Object.keys(byBook)[0]);
      const primary = byBook[primaryId] || [];
      const rows = primary.filter(o => o.money != null && (o.option_type_id == null || o.option_type_id === 430))
        .sort((a, b) => a.money - b.money).slice(0, TOP_N).map(o => {
          const p = o.player_id ? players[o.player_id] : null;
          const t = teams[o.team_id] || (p && teams[p.team_id]) || null;
          const books = {};
          for (const [bid, odds] of Object.entries(byBook)) {
            const hit = odds.find(x => x.outcome_id === o.outcome_id || (x.player_id === o.player_id && x.team_id === o.team_id));
            if (hit && hit.money != null) books[AN_BOOKS[bid]] = fmt(hit.money);
          }
          return { name: p ? p.full_name : t?.full_name || null, short: p ? null : shortTeam(t), team: t ? t.abbr : null, logo: p?.image || t?.logo || null,
                   teamLogo: t?.logo || null, player: !!p, odds: fmt(o.money), implied: +implied(o.money).toFixed(4), books };
        }).filter(r => r.name);
      if (rows.length) out[key] = { title: d.name || m.name, source: 'actionnetwork', primaryBook: AN_BOOKS[primaryId], rows };
    } catch (e) { console.error('AN fail', key, e.message); }
  }
  return out;
}

// ---------- ESPN core API (DraftKings) ----------
const ESPN_WANT = {
  nfl: [['super_bowl', /^super bowl winner/i], ['afc_champ', /^afc champion/i], ['nfc_champ', /^nfc champion/i],
        ['afc_east', /^afc east division/i], ['afc_north', /^afc north division/i], ['afc_south', /^afc south division/i], ['afc_west', /^afc west division/i],
        ['nfc_east', /^nfc east division/i], ['nfc_north', /^nfc north division/i], ['nfc_south', /^nfc south division/i], ['nfc_west', /^nfc west division/i],
        ['mvp', /regular season mvp/i], ['opoy', /^offensive player of the year/i], ['dpoy', /^defensive player of the year/i],
        ['oroy', /offensive rookie of the year/i], ['droy', /defensive rookie of the year/i], ['cpoy', /comeback player/i], ['coy', /coach of the year/i]],
  nhl: [['stanley_cup', /stanley cup winner/i]],
  'college-football': [['cfb_title', /^national championship winner/i], ['make_cfp_final', /to reach the championship game/i], ['heisman', /heisman/i],
        ['sec', /southeastern conference/i], ['big_ten', /big ten conference/i], ['big_12', /big 12 conference/i], ['acc', /atlantic coast conference/i],
        ['american', /american athletic/i], ['mwc', /mountain west/i], ['sun_belt', /sun belt/i], ['mac', /mid-american/i], ['cusa', /conference usa/i]],
};
const refCache = new Map();
async function ref(u) {
  u = String(u).replace(/^http:/, 'https:');
  if (!refCache.has(u)) refCache.set(u, getJSON(u).catch(() => null));
  return refCache.get(u);
}
// ESPN files seasons differently per sport (2026-27 NHL Stanley Cup is under 2026, NBA 2026-27 under 2027),
// so try each candidate season and use the fullest market.
async function espn(sport, league, seasons, onlyKeys) {
  const docs = [];
  for (const season of seasons) {
    try { docs.push(await getJSON(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/seasons/${season}/futures?limit=100`)); } catch (e) {}
  }
  if (!docs.length) throw new Error(`no ESPN futures for ${league} ${seasons.join('/')}`);
  const out = {};
  for (const [key, re] of ESPN_WANT[league]) {
    if (onlyKeys && !onlyKeys.has(key)) continue;
    let item = null;
    for (const d of docs) {
      const it = (d.items || []).find(i => re.test(i.displayName || '') || re.test(i.name || ''));
      if (it && (!item || (it.futures?.[0]?.books || []).length > (item.futures?.[0]?.books || []).length)) item = it;
    }
    if (!item) continue;
    const books = (item.futures?.[0]?.books || []).map(b => ({ ...b, n: toNum(b.value) }))
      .filter(b => b.n != null && !isNaN(b.n)).sort((a, b) => a.n - b.n).slice(0, TOP_N);
    const rows = await Promise.all(books.map(async b => {
      if (b.athlete) {
        const a = await ref(b.athlete.$ref);
        const t = a?.team?.$ref ? await ref(a.team.$ref) : null;
        return { name: a?.displayName || null, team: t?.abbreviation || null, logo: a?.headshot?.href || null,
                 teamLogo: t?.logos?.[0]?.href || null, player: true, odds: fmt(b.n), implied: +implied(b.n).toFixed(4) };
      }
      const t = b.team ? await ref(b.team.$ref) : null;
      return { name: t?.displayName || null, short: t?.location || null, team: t?.abbreviation || null, logo: t?.logos?.[0]?.href || null,
               teamLogo: t?.logos?.[0]?.href || null, player: false, odds: fmt(b.n), implied: +implied(b.n).toFixed(4) };
    }));
    const good = rows.filter(r => r.name);
    if (good.length) out[key] = { title: item.displayName || item.name, source: 'espn', primaryBook: item.futures?.[0]?.provider?.name || 'ESPN BET', rows: good };
  }
  return out;
}

async function main() {
  const now = new Date();
  const season = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1; // football season year (ESPN files Sep-Feb under the start year)
  const y = now.getFullYear();
  const nhlSeasons = now.getMonth() >= 6 ? [y, y + 1] : [y - 1, y];   // ESPN: 2026-27 NHL season = 2026
  const result = { generatedAt: now.toISOString(), season, nfl: {}, ncaaf: {}, nhl: {}, errors: [] };
  const got = {};
  const ESPN_MAP = { nfl: ['football', 'nfl', [season]], ncaaf: ['football', 'college-football', [season]], nhl: ['hockey', 'nhl', nhlSeasons] };
  for (const lg of ['nfl', 'ncaaf', 'nhl']) {
    try { got[lg] = await actionNetwork(lg); } catch (e) { result.errors.push(`actionnetwork ${lg}: ${e.message}`); got[lg] = {}; }
    const [sport, espnLeague, seasons] = ESPN_MAP[lg];
    const missing = new Set(ESPN_WANT[espnLeague].map(w => w[0]).filter(k => !got[lg][k]));
    let e = {};
    if (missing.size) {
      try { e = await espn(sport, espnLeague, seasons, missing); } catch (err) { result.errors.push(`espn ${lg}: ${err.message}`); }
    }
    for (const k of new Set([...Object.keys(got[lg]), ...Object.keys(e)])) result[lg][k] = got[lg][k] || e[k];
  }
  const nMarkets = Object.keys(result.nfl).length + Object.keys(result.ncaaf).length + Object.keys(result.nhl).length;
  if (nMarkets < MIN_MARKETS) {
    let haveOld = false;
    try { haveOld = !!JSON.parse(await readFile(OUT, 'utf8')).generatedAt; } catch (e) {}
    console.log(`::warning::Only ${nMarkets} futures markets fetched (${result.errors.join('; ') || 'no errors'}); ${haveOld ? 'keeping last good ' + OUT : 'no previous file'}`);
    process.exit(haveOld ? 0 : 1);
  }
  await writeFile(OUT, JSON.stringify(result) + '\n');
  console.log(`wrote ${OUT}: ${nMarkets} markets (nfl ${Object.keys(result.nfl).length}, ncaaf ${Object.keys(result.ncaaf).length}, nhl ${Object.keys(result.nhl).length}); errors: ${result.errors.length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
