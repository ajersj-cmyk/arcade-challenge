#!/usr/bin/env node
// Disc golf world rankings -> discgolf-rankings.json (served same-origin for the DISC GOLF slide).
//   node scripts/fetch-discgolf-rankings.mjs [discgolf-rankings.json]
// Rankings: the PDGA "Official Disc Golf World Rankings" pages (no CORS, so this runs in a GitHub Action).
// Player details (rating, country, photo) come from PDGA live-scoring results of recent elite events and are
// remembered in the file across runs. If the rankings fetch fails, the last good file is kept.
import fs from 'node:fs';
const OUT = process.argv[2] || 'discgolf-rankings.json';
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Accept-Language': 'en-US' };
const B = 'https://www.pdga.com';
const get = async (u, json) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(r.status + ' ' + u); return json ? r.json() : r.text(); };
let prev = {}; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
const players = Object.assign({}, prev.players || {});
const strip = s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// 1) player details from recent elite events' live results
try {
  const list = await get(B + '/api/v1/feat/current-events/tournaments', true), now = Date.now();
  const evs = list.filter(e => /^(ES|M|XM|XA|NT)$/.test(e.tier) && !/amateur|junior/i.test(e.officialName) && Date.parse(e.startDate) < now);
  for (const e of evs.slice(0, 8)) {
    try {
      const ed = (await get(B + '/apps/tournament/live-api/live_results_fetch_event?TournID=' + e.tournId, true)).data;
      for (const d of (ed.Divisions || []).filter(d => d.Division === 'MPO' || d.Division === 'FPO')) {
        if (!d.LatestRound) continue;
        let rd = (await get(B + `/apps/tournament/live-api/live_results_fetch_round?TournID=${e.tournId}&Division=${d.Division}&Round=${d.LatestRound}`, true)).data;
        rd = Array.isArray(rd) ? rd[0] : rd;
        for (const p of (rd && rd.scores) || []) {
          if (!p.PDGANum) continue;
          const o = players[p.PDGANum] || {};
          players[p.PDGANum] = { name: p.Name, rating: p.Rating || o.rating || null, country: p.Country || o.country || '',
            photo: p.AvatarURL && !/default/i.test(p.AvatarURL) ? p.AvatarURL : (o.photo || ''), seen: e.tournId };
        }
      }
    } catch (e2) { console.warn('event', e.tournId, e2.message); }
  }
} catch (e) { console.warn('events:', e.message); }

// 2) rankings pages (latest MPO/FPO links on /world-rankings)
const out = { updated: new Date().toISOString(), source: 'PDGA Official Disc Golf World Rankings', divisions: {}, players: {} };
try {
  const home = await get(B + '/world-rankings');
  for (const div of ['MPO', 'FPO']) {
    const m = home.match(new RegExp('href="(/' + div.toLowerCase() + '-world-rankings-[a-z]+-\\d+-\\d{4})"[^>]*>\\s*All ' + div, 'i')) || home.match(new RegExp('href="(/' + div.toLowerCase() + '-world-rankings-[a-z]+-\\d+-\\d{4})"', 'i'));
    if (!m) continue;
    const page = await get(B + m[1]);
    const date = strip((page.match(/class="rankdate"[^>]*>([^<]+)</) || [])[1] || '');
    const body = (page.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '';
    const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(0, 10).map(r => {
      const tds = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1]);
      const num = ((tds[1] || '').match(/\/player\/(\d+)/) || [])[1] || '';
      const t0 = tds[0] || '', chg = /rankdown|arrow_drop_down/.test(t0) ? 'down' : /rankup|arrow_drop_up/.test(t0) && !/nochange/.test(t0) ? 'up' : '', cv = strip(((tds[0] || '').match(/rankchgvalue">([^<]*)</) || [])[1] || '0');
      const p = players[num] || {};
      return { rank: +strip((tds[0] || '').match(/class="rank">([^<]*)</)?.[1] || '0'), name: strip(tds[1] || ''), pdga: num, pts: strip(tds[2] || ''),
               move: chg === 'up' ? +cv : chg === 'down' ? -cv : 0, rating: p.rating || null, country: p.country || '', photo: p.photo || '' };
    }).filter(r => r.rank && r.name);
    if (rows.length) out.divisions[div] = { date, rows };
  }
} catch (e) { console.warn('rankings:', e.message); }
if (!out.divisions.MPO) { console.warn('No MPO rankings; keeping last good file'); if (prev.divisions) process.exit(0); }
// keep player memory small: everyone ranked + up to 400 recent
Object.keys(players).slice(-400).forEach(k => out.players[k] = players[k]);
Object.values(out.divisions).forEach(d => d.rows.forEach(r => { if (r.pdga && players[r.pdga]) out.players[r.pdga] = players[r.pdga]; }));
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, Object.entries(out.divisions).map(([k, v]) => k + ' ' + v.rows.length + ' (' + v.rows.filter(r => r.photo).length + ' photos)').join(', '));
