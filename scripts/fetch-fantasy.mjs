#!/usr/bin/env node
// Builds fantasy.json (NFL fantasy: this week's PPR projections by position + trending free-agent pickups) for the
// scoreboard's FANTASY slide. Run daily by .github/workflows/futures.yml; GitHub Pages serves it same-origin.
//
// Sources (free, no key):
//   1. ESPN Fantasy "leaguedefaults/3" (PPR scoring) kona_player_info: weekly projections, ownership, ESPN ids (headshots),
//      pro-team schedules (opponent + ESPN event id). CORS-enabled, but ~12 KB per player, so the TV only calls it live.
//   2. Sleeper trending adds (24 h) + Sleeper players map (big, ~once a day is their ask) to resolve names / ESPN ids.
//      If Sleeper fails, pickups fall back to ESPN's ownership-change sort.
// Safety: if fewer than 4 positions come back, the existing fantasy.json is kept untouched.
//
// Usage: node scripts/fetch-fantasy.mjs [outFile=fantasy.json]   (Node 18+)
import { writeFile } from 'node:fs/promises';

const OUT = process.argv[2] || 'fantasy.json';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FF = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';
const POS = { QB: [0, 1, 8], RB: [2, 2, 8], WR: [4, 3, 8], TE: [6, 4, 6], K: [17, 5, 5], DST: [16, 16, 5] }; // slotId, defaultPositionId, keep
const POS_BY_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };

async function getJSON(url, headers = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await new Promise(res => setTimeout(res, 1500 * (i + 1))); }
  }
}
const r1 = n => (n == null || isNaN(n) ? null : Math.round(n * 10) / 10);
const statFor = (pl, src, period) => (pl.stats || []).find(s => s.statSourceId === src && s.statSplitTypeId === 1 && s.scoringPeriodId === period);

async function main() {
  const errors = [];
  const now = new Date();
  let season = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
  const meta = await getJSON(`${FF}/${season}`);
  const week = (meta.currentScoringPeriod && meta.currentScoringPeriod.id) || 1;
  const sched = await getJSON(`${FF}/${season}?view=proTeamSchedules_wl`);
  const teams = {}, games = {};
  for (const t of sched.settings.proTeams) {
    if (!t.id) continue;
    teams[t.id] = t.abbrev;
    const g = ((t.proGamesByScoringPeriod || {})[String(week)] || [])[0];
    if (g) games[t.id] = { opp: g.homeProTeamId === t.id ? g.awayProTeamId : g.homeProTeamId, home: g.homeProTeamId === t.id, date: g.date, eventId: String(g.id) };
  }
  const ab = id => (teams[id] || '').toUpperCase();
  const url = `${FF}/${season}/segments/0/leaguedefaults/3?scoringPeriodId=${week}&view=kona_player_info`;
  const statIds = [`11${season}${week}`, `01${season}${week}`];
  const slim = (p, extra = {}) => {
    const pl = p.player || p, pos = POS_BY_ID[pl.defaultPositionId] || '';
    const proj = statFor(pl, 1, week), g = games[pl.proTeamId];
    return {
      id: pl.id, name: pos === 'DST' ? `${ab(pl.proTeamId)} D/ST` : pl.fullName, first: pl.firstName || '', last: pl.lastName || '',
      pos, team: ab(pl.proTeamId), opp: g ? (g.home ? 'vs ' : '@') + ab(g.opp) : 'BYE', kick: g ? g.date : null, eventId: g ? g.eventId : null,
      proj: r1(proj && proj.appliedTotal), own: r1(pl.ownership && pl.ownership.percentOwned), chg: r1(pl.ownership && pl.ownership.percentChange),
      inj: pl.injured || (pl.injuryStatus && pl.injuryStatus !== 'ACTIVE') ? (pl.injuryStatus || 'INJ') : null, ...extra,
    };
  };
  const positions = {};
  for (const [pos, [slot, , keep]] of Object.entries(POS)) {
    try {
      const filter = { players: { filterSlotIds: { value: [slot] }, filterActive: { value: true }, limit: 60,
        sortPercOwned: { sortAsc: false, sortPriority: 1 }, filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: statIds } } };
      const d = await getJSON(url, { 'X-Fantasy-Filter': JSON.stringify(filter) });
      const rows = (d.players || []).map(p => slim(p)).filter(r => r.pos === pos && r.proj != null && r.proj > 0 && r.opp !== 'BYE' && r.inj !== 'OUT' && r.inj !== 'INJURY_RESERVE');
      rows.sort((a, b) => b.proj - a.proj);
      if (rows.length) positions[pos] = rows.slice(0, keep); else errors.push(`${pos}: no projections`);
    } catch (e) { errors.push(`${pos}: ${e.message}`); }
  }
  // Pickups: Sleeper trending adds -> ESPN ids via the Sleeper players map -> ESPN ownership/projection
  let pickups = [], pickupSource = '';
  try {
    const trend = await getJSON('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=60');
    const map = await getJSON('https://api.sleeper.app/v1/players/nfl');
    const want = [];
    for (const t of trend) {
      const sp = map[t.player_id]; if (!sp) continue;
      const pos = sp.position === 'DEF' ? 'DST' : sp.position;
      if (!POS[pos]) continue;
      let espnId = sp.espn_id ? Number(sp.espn_id) : null;
      if (pos === 'DST') { const tid = Object.keys(teams).find(k => teams[k].toUpperCase() === String(sp.team || t.player_id).toUpperCase()); if (tid) espnId = -16000 - Number(tid); }
      if (espnId) want.push({ espnId, adds: t.count });
    }
    if (want.length) {
      const filter = { players: { filterIds: { value: want.map(w => w.espnId) }, limit: want.length, sortPercOwned: { sortAsc: false, sortPriority: 1 }, filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: statIds } } };
      const d = await getJSON(url, { 'X-Fantasy-Filter': JSON.stringify(filter) });
      const byId = new Map((d.players || []).map(p => [p.player ? p.player.id : p.id, p]));
      for (const w of want) { const p = byId.get(w.espnId); if (p) pickups.push(slim(p, { adds: w.adds })); }
      const cap = { DST: 2, K: 1 }, seen = {};
      pickups = pickups.filter(r => (r.own == null || r.own < 75) && (cap[r.pos] == null || (seen[r.pos] = (seen[r.pos] || 0) + 1) <= cap[r.pos])).slice(0, 10);
      pickupSource = 'Sleeper trending adds (24 h)';
    }
  } catch (e) { errors.push(`sleeper: ${e.message}`); }
  if (pickups.length < 4) {
    try {
      const filter = { players: { filterActive: { value: true }, filterSlotIds: { value: [0, 2, 4, 6, 17, 16] }, limit: 60,
        sortPercChanged: { sortAsc: false, sortPriority: 1 }, filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: statIds } } };
      const d = await getJSON(url, { 'X-Fantasy-Filter': JSON.stringify(filter) });
      pickups = (d.players || []).map(p => slim(p)).filter(r => r.pos && r.own != null && r.own < 60 && r.chg > 0).slice(0, 10);
      pickupSource = 'ESPN ownership change';
    } catch (e) { errors.push(`espn pickups: ${e.message}`); }
  }
  const out = { generatedAt: now.toISOString(), season, week, scoring: 'PPR', source: 'ESPN Fantasy projections', pickupSource, teams, games, positions, pickups, errors };
  if (Object.keys(positions).length < 4) {
    console.error('Too few positions; keeping the existing file.', errors);
    process.exit(0);
  }
  await writeFile(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT}: week ${week}, ${Object.entries(positions).map(([k, v]) => k + ' ' + v.length).join(', ')}, pickups ${pickups.length} (${pickupSource})`, errors.length ? errors : '');
}
main().catch(e => { console.error(e); process.exit(0); });
