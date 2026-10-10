#!/usr/bin/env node
// FAMILY PICK'EM sync (GitHub Action, every ~10 min): ntfy.sh pick messages (cached there for 12 h) -> picks.json on the
// "pickem-data" branch, then grades finished games from ESPN. Uses only public APIs; the workflow's GITHUB_TOKEN pushes.
//   node scripts/pickem-sync.mjs path/to/picks.json        (env PICKEM_PIN = optional household PIN, an Actions secret)
// Lock rule: a pick counts only if ntfy's server timestamp is before the game's real ESPN start time.
import fs from 'node:fs'; import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../pickem-core.js');
const OUT = process.argv[2] || 'picks.json';
let data; try { data = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { data = P.emptyData(); }
const before = JSON.stringify(data);
const msgs = await P.readNtfy(P.ROOM + '-p', 'all');
// authoritative start time + teams for every event someone picked (fake / unknown event ids are dropped)
const starts = {};
const ids = [...new Set(msgs.filter(m => m && m.t === 'pick' && /^\d{4,14}$/.test(String(m.e)) && P.LEAGUES.some(L => L.k === m.k)).map(m => String(m.e)))];
for (const e of ids.slice(0, 60)) {
  const known = data.events[e]; if (known && known.real) { starts[e] = known.d; continue; }
  const m = msgs.find(x => String(x.e) === e);
  try {
    const s = await P.fetchJSON(P.ESPN + m.k + '/summary?event=' + e, 12000);
    const c = s.header && s.header.competitions && s.header.competitions[0]; if (!c) continue;
    const L = P.LEAGUES.find(x => x.k === m.k);
    const g = P.parseEvent({ id: e, date: c.date, status: c.status, competitions: [c] }, L); if (!g) continue;
    starts[e] = g.start; data.events[e] = Object.assign(P.eventMeta(g), { real: 1 });
  } catch (err) { console.log('summary failed', e, String(err)); }
}
for (const m of msgs) if (m && m.e && !starts[String(m.e)]) m.t = 'skip'; // never trust a client-sent start time here
P.applyPicks(data, msgs, starts, process.env.PICKEM_PIN || '');
await P.gradeMissing(data, Date.now(), 60);
if (msgs.length) data.lastMsg = msgs[msgs.length - 1]._id;
const changed = JSON.stringify(data) !== before;
if (changed) { data.updated = Date.now(); fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n'); }
const st = P.standings(data);
console.log(`messages ${msgs.length}, events ${Object.keys(data.events).length}, players ${st.length}, ${changed ? 'UPDATED' : 'no change'}`);
st.forEach(s => console.log(`  ${s.name.padEnd(14)} ${s.w}-${s.l}  ${P.fmtPct(s.pct, s)}  ${s.streak}`));
