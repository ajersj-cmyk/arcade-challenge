#!/usr/bin/env node
// Season stat leaders -> statleaders.json (served same-origin for the STAT LEADERS slides).
//   node scripts/fetch-statleaders.mjs [statleaders.json]
// Source: ESPN's free site API, /apis/site/v3/sports/<sport>/<league>/leaders (CORS-open but ~1.2-2.4 MB per league,
// too heavy for the onn boxes, so this Action trims it to a few KB). In-season = regular season or postseason with
// games in the next/last few days (ESPN scoreboard). A league that fails keeps its last good entry.
import fs from 'node:fs';
const OUT = process.argv[2] || 'statleaders.json';
const E = 'https://site.api.espn.com/apis';
const LEAGUES = {
  nfl:  { p: 'football/nfl', label: 'NFL', cats: ['passingYards', 'rushingYards', 'receivingYards', 'sacks'] },
  cfb:  { p: 'football/college-football', label: 'COLLEGE FOOTBALL', cats: ['passingYards', 'rushingYards', 'receivingYards', 'sacks'] },
  nba:  { p: 'basketball/nba', label: 'NBA', cats: ['pointsPerGame', 'reboundsPerGame', 'assistsPerGame', '3PointsMadePerGame'] },
  cbb:  { p: 'basketball/mens-college-basketball', label: 'COLLEGE HOOPS', cats: ['pointsPerGame', 'reboundsPerGame', 'assistsPerGame', '3PointsMadePerGame'] },
  nhl:  { p: 'hockey/nhl', label: 'NHL', cats: ['goals', 'assists', 'points', 'savePct|avgGoalsAgainst'] },
  mlb:  { p: 'baseball/mlb', label: 'MLB', cats: ['avg', 'homeRuns', 'RBIs', 'ERA|strikeouts'], seasontype: 2 }
};
const LABEL = { passingYards: 'PASS YDS', rushingYards: 'RUSH YDS', receivingYards: 'REC YDS', sacks: 'SACKS', pointsPerGame: 'POINTS / G', reboundsPerGame: 'REBOUNDS / G',
  assistsPerGame: 'ASSISTS / G', '3PointsMadePerGame': '3PM / G', goals: 'GOALS', assists: 'ASSISTS', points: 'POINTS', savePct: 'SAVE %', avgGoalsAgainst: 'GAA',
  avg: 'BATTING AVG', homeRuns: 'HOME RUNS', RBIs: 'RBI', ERA: 'ERA', strikeouts: 'STRIKEOUTS' };
function fmt(cat, v) {
  if (v == null || isNaN(v)) return '';
  if (/^(avg|savePct)$/.test(cat)) return v.toFixed(3).replace(/^0/, '');
  if (/^(ERA|avgGoalsAgainst)$/.test(cat)) return v.toFixed(2);
  if (/PerGame$/.test(cat)) return v.toFixed(1);
  return String(Math.round(v));
}
const ymd = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
const get = async u => { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
let prev = {}; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
const out = { updated: new Date().toISOString(), source: 'ESPN site API leaders', leagues: {} }, now = Date.now();
for (const [k, L] of Object.entries(LEAGUES)) {
  try {
    const d = await get(`${E}/site/v3/sports/${L.p}/leaders?limit=5${L.seasontype ? '&seasontype=' + L.seasontype : ''}`);
    const t = (d.currentSeason && d.currentSeason.type) || {}, type = Number(t.type) || 0;
    let games = null;
    if (type === 2 || type === 3) {
      games = 0; // any game from 2 days ago to 4 days ahead (ESPN's date ranges 400 for some leagues, so day by day)
      for (let dd = -2; dd <= 4 && !games; dd++) {
        try { const sb = await get(`${E}/site/v2/sports/${L.p}/scoreboard?dates=${ymd(now + dd * 864e5)}${k === 'cfb' || k === 'cbb' ? '&groups=50' : ''}`); games = (sb.events || []).length; } catch (e) { if (dd === -2) games = null; break; }
      }
    }
    const inSeason = (type === 2 && games !== 0) || (type === 3 && games > 0);
    const cats = ((d.leaders && d.leaders.categories) || []), byName = {}; cats.forEach(c => byName[c.name] = c);
    const picked = L.cats.map(spec => spec.split('|').map(n => byName[n]).find(c => c && c.leaders && c.leaders.length)).filter(Boolean);
    const lc = picked.map(c => ({ key: c.name, label: LABEL[c.name] || String(c.displayName || c.name).toUpperCase(), rows: c.leaders.slice(0, 5).map(l => {
      const a = l.athlete || {}, tm = l.team || a.team || {}, logo = ((tm.logos || []).find(x => (x.rel || []).join(' ') === 'full default') || (tm.logos || [])[0] || {}).href || '';
      return { id: a.id, name: a.displayName || a.fullName || '', short: a.shortName || '', head: (a.headshot && a.headshot.href) || '', abbr: tm.abbreviation || '', team: tm.displayName || '',
               logo, color: tm.color || '', alt: tm.alternateColor || '', val: fmt(c.name, Number(l.value)) };
    }).filter(r => r.name && r.val) })).filter(c => c.rows.length);
    if (!lc.length && prev.leagues && prev.leagues[k]) { out.leagues[k] = prev.leagues[k]; continue; }
    out.leagues[k] = { label: L.label, inSeason, season: { year: d.currentSeason && d.currentSeason.year, type, name: t.name || '', start: t.startDate || '', end: t.endDate || '' },
                       statsSeason: d.requestedSeason && d.requestedSeason.year, games, cats: lc };
  } catch (e) { console.warn(k, e.message); if (prev.leagues && prev.leagues[k]) out.leagues[k] = prev.leagues[k]; }
}
if (!Object.keys(out.leagues).length) { console.warn('nothing fetched; keeping last file'); process.exit(0); }
// keep the file stable when only the timestamp would change
if (prev.leagues && JSON.stringify(prev.leagues) === JSON.stringify(out.leagues)) out.updated = prev.updated;
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes', Object.entries(out.leagues).map(([k, v]) => k + (v.inSeason ? '+' : '-') + v.cats.length).join(' '));
