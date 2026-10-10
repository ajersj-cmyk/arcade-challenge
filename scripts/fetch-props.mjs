#!/usr/bin/env node
// Builds props.json (TODAY'S HOT PROPS slide): player props for the next ~36 h of NFL / college football / NBA /
// college basketball / NHL / MLB games. Run every few hours by .github/workflows/props.yml; Pages serves it same-origin.
//
// Source (free, no key): Action Network's public web API, the same one actionnetwork.com's props pages use.
//   GET https://api.actionnetwork.com/web/v2/scoreboard/<league>?period=game&date=YYYYMMDD     (cheap: which games)
//   GET https://api.actionnetwork.com/web/v2/scoreboard/<league>/markets?customPickTypes=<market>&date=..&bookIds=..
// It is CORS-enabled, but one market for one league-day is 0.3-2 MB, far too heavy for an onn TV box, so the TV only
// reads the compact props.json written here (~20-60 KB).
// Books: 15 consensus, 30 opening line, 68 DraftKings, 69 FanDuel, 49 Caesars. "HOT" = the biggest moves from the opening
// line to the consensus (line in yards/shots, or implied probability for yes/no props like anytime TD).
// Safety: if every league fails (network / API change) the existing props.json is kept untouched.
//
// Usage: node scripts/fetch-props.mjs [outFile=props.json]   (Node 18+)
import { writeFile } from 'node:fs/promises';

const OUT = process.argv[2] || 'props.json';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const AN = 'https://api.actionnetwork.com/web/v2';
const BOOKS = { 68: 'DK', 69: 'FD', 49: 'CZR' }, CONS = 15, OPEN = 30;
const BOOK_IDS = [CONS, OPEN, 68, 69, 49].join(',');
// [market, label, kind ('yes' = to happen, 'ou' = over/under line), how many players to keep]
const LEAGUES = {
  nfl:   { an: 'nfl',   label: 'NFL', espn: 'nfl', markets: [['core_bet_type_62_anytime_touchdown_scorer', 'ANYTIME TD', 'yes', 6], ['core_bet_type_9_passing_yards', 'PASS YDS', 'ou', 4], ['core_bet_type_12_rushing_yards', 'RUSH YDS', 'ou', 4], ['core_bet_type_16_receiving_yards', 'REC YDS', 'ou', 5]] },
  ncaaf: { an: 'ncaaf', label: 'CFB', espn: 'college-football', markets: [['core_bet_type_62_anytime_touchdown_scorer', 'ANYTIME TD', 'yes', 6], ['core_bet_type_9_passing_yards', 'PASS YDS', 'ou', 4], ['core_bet_type_12_rushing_yards', 'RUSH YDS', 'ou', 4], ['core_bet_type_16_receiving_yards', 'REC YDS', 'ou', 4]] },
  nba:   { an: 'nba',   label: 'NBA', espn: 'nba', markets: [['core_bet_type_27_points', 'POINTS', 'ou', 6], ['core_bet_type_23_rebounds', 'REBOUNDS', 'ou', 3], ['core_bet_type_26_assists', 'ASSISTS', 'ou', 3], ['core_bet_type_21_3fgm', '3-POINTERS', 'ou', 3]] },
  ncaab: { an: 'ncaab', label: 'CBB', espn: 'mens-college-basketball', markets: [['core_bet_type_27_points', 'POINTS', 'ou', 8], ['core_bet_type_23_rebounds', 'REBOUNDS', 'ou', 3]] },
  nhl:   { an: 'nhl',   label: 'NHL', espn: 'nhl', markets: [['core_bet_type_313_anytime_goal_scorer', 'ANYTIME GOAL', 'yes', 6], ['core_bet_type_31_shots_on_goal', 'SHOTS', 'ou', 4], ['core_bet_type_280_points', 'POINTS', 'ou', 3]] },
  mlb:   { an: 'mlb',   label: 'MLB', espn: 'mlb', markets: [['core_bet_type_33_hr', 'HOME RUN', 'yes', 5], ['core_bet_type_36_hits', 'HITS', 'ou', 3], ['core_bet_type_37_strikeouts', 'STRIKEOUTS', 'ou', 4]] },
};
const MAX_PER_LEAGUE = 24, WINDOW_BACK_MS = 4 * 3600e3, WINDOW_AHEAD_MS = 36 * 3600e3;

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await new Promise(res => setTimeout(res, 1500 * (i + 1))); }
  }
}
const etDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
const implied = o => (o == null ? null : (o < 0 ? -o / (-o + 100) : 100 / (o + 100)));
const team = t => t ? { id: t.id, abbr: t.abbr || '', name: t.display_name || t.full_name || '', logo: t.logo || '', color: t.primary_color || '' } : null;

async function league(key, cfg, now) {
  const dates = [...new Set([etDate(now), etDate(new Date(+now + 24 * 3600e3))])];
  const games = new Map();
  for (const dt of dates) {
    const sb = await getJSON(`${AN}/scoreboard/${cfg.an}?period=game&date=${dt}`);
    for (const g of sb.games || []) {
      const t = Date.parse(g.start_time);
      if (g.status === 'complete' || g.status === 'closed' || t < +now - WINDOW_BACK_MS || t > +now + WINDOW_AHEAD_MS) continue;
      const home = (g.teams || []).find(x => x.id === g.home_team_id), away = (g.teams || []).find(x => x.id === g.away_team_id);
      games.set(g.id, { id: g.id, start: g.start_time, status: g.status, home: team(home), away: team(away) });
    }
  }
  if (!games.size) return { games: [], props: [] };
  const out = [];
  for (const [mk, label, kind, keep] of cfg.markets) {
    const seen = new Set(); let d = null;
    for (const dt of dates) {
      try { d = await getJSON(`${AN}/scoreboard/${cfg.an}/markets?customPickTypes=${mk}&date=${dt}&bookIds=${BOOK_IDS}`); } catch (e) { console.warn(key, mk, e.message); continue; }
      const players = new Map((d.players || []).map(p => [p.id, p]));
      const by = {}; // player:event -> { book -> row }
      for (const [bk, v] of Object.entries(d.markets || {})) {
        for (const r of ((v.event || {})[mk] || [])) {
          if (!games.has(r.event_id) || r.is_alt_market || r.is_live) continue;
          if (kind === 'ou' ? r.side !== 'over' : !(r.side === 'noside' || r.side === 'yes' || r.option_type_id === 1)) continue;
          const k = r.player_id + ':' + r.event_id; (by[k] = by[k] || {})[bk] = r;
        }
      }
      const rows = [];
      for (const [k, b] of Object.entries(by)) {
        if (seen.has(k)) continue; seen.add(k);
        // main line = the line most books agree on (the consensus row can sit on an alternate line)
        const bl = Object.keys(BOOKS).map(id => b[id]).filter(Boolean), cnt = {};
        bl.forEach(r => { cnt[r.value] = (cnt[r.value] || 0) + 1; });
        const mainV = kind === 'ou' && bl.length ? +Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x])[0] : null;
        const cc = b[CONS] && (kind !== 'ou' || b[CONS].value === mainV) ? b[CONS] : null;
        const c = cc || bl.find(r => kind !== 'ou' || r.value === mainV) || b[CONS]; if (!c) continue;
        const p = players.get(c.player_id); if (!p) continue;
        const g = games.get(c.event_id), side = g.home && p.team_id === g.home.id ? 'home' : (g.away && p.team_id === g.away.id ? 'away' : '');
        const books = {}; for (const [id, nm] of Object.entries(BOOKS)) if (b[id]) books[nm] = { o: b[id].odds, v: kind === 'ou' ? b[id].value : null };
        if (!Object.keys(books).length) continue;
        const o = b[OPEN] && (kind !== 'ou' || b[OPEN].value != null) ? b[OPEN] : null;
        let move = 0, moveTxt = '';
        if (o) {
          if (kind === 'ou' && o.value != null && c.value != null && o.value !== c.value) { move = (c.value - o.value) / Math.max(1, Math.abs(o.value)); moveTxt = (c.value > o.value ? '\u25B2 ' : '\u25BC ') + 'LINE ' + o.value + ' \u2192 ' + c.value; }
          else if (implied(o.odds) != null && implied(c.odds) != null) { const dp = implied(c.odds) - implied(o.odds); if (Math.abs(dp) >= 0.005) { move = dp; moveTxt = (dp > 0 ? '\u25B2 ' : '\u25BC ') + (o.odds > 0 ? '+' : '') + o.odds + ' \u2192 ' + (c.odds > 0 ? '+' : '') + c.odds; } }
        }
        rows.push({ lg: key, mk: label, kind, game: c.event_id, side, player: p.full_name, short: p.abbr || p.full_name, pos: p.position || p.primary_position || '', img: p.image || '',
          line: kind === 'ou' ? c.value : null, odds: c.odds, books, move: Math.round(move * 1000) / 1000, moveTxt, rank: kind === 'yes' ? implied(c.odds) || 0 : c.value || 0 });
      }
      rows.sort((a, b) => b.rank - a.rank);
      out.push(...rows.slice(0, keep));
    }
  }
  return { games: [...games.values()], props: out };
}

async function main() {
  const now = new Date(), res = { updated: now.toISOString(), source: 'Action Network public web API (consensus + opening line, DK / FD / CZR)', leagues: {} };
  let ok = 0;
  for (const [key, cfg] of Object.entries(LEAGUES)) {
    try {
      const L = await league(key, cfg, now);
      // HOT: the 5 biggest opening -> consensus moves in this league (at least 5 % of a line or 3 points of probability)
      L.props.filter(p => Math.abs(p.move) >= (p.kind === 'ou' ? 0.05 : 0.03)).sort((a, b) => Math.abs(b.move) - Math.abs(a.move)).slice(0, 5).forEach(p => { p.hot = 1; });
      L.props.sort((a, b) => (b.hot || 0) - (a.hot || 0));
      L.props = L.props.slice(0, MAX_PER_LEAGUE).map(({ rank, ...p }) => p);
      res.leagues[key] = { label: cfg.label, espn: cfg.espn, games: L.games, props: L.props };
      ok++;
      console.log(`${key}: ${L.games.length} games, ${L.props.length} props, ${L.props.filter(p => p.hot).length} hot`);
    } catch (e) { console.warn(`${key}: FAILED ${e.message}`); }
  }
  if (!ok) { console.error('No league succeeded; keeping the old props.json'); process.exit(1); }
  await writeFile(OUT, JSON.stringify(res));
  console.log(`wrote ${OUT}`);
}
main().catch(e => { console.error(e); process.exit(1); });
