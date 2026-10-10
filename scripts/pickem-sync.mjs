#!/usr/bin/env node
// FAMILY PICK'EM sync (GitHub Action, every ~10 min). For every room (registry topic + rooms already on file):
// ntfy.sh "<room>-p" (picks + the frozen daily TOP 5, cached there 12 h) -> rooms/<room>.json on the "pickem-data" branch,
// then grades finished games from ESPN. Public APIs only; the workflow's GITHUB_TOKEN pushes.
//   node scripts/pickem-sync.mjs <data dir>      (env PICKEM_PIN = optional PIN for the default room, an Actions secret)
// Lock rule: a pick counts only if ntfy's server timestamp is before the game's real ESPN start time, and only for that
// room's frozen TOP 5.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../pickem-core.js');
const DIR = process.argv[2] || 'data', MAX_ROOMS = 60;
fs.mkdirSync(path.join(DIR, 'rooms'), { recursive: true });
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const idxFile = path.join(DIR, 'rooms.json'), index = readJson(idxFile) || { v: 1, rooms: {} }, idxBefore = JSON.stringify(index);
let reg = []; try { reg = await P.readNtfy(P.REG_TOPIC, 'all'); } catch (e) { console.log('registry read failed', String(e)); }
const now = Date.now();
reg.forEach(m => { if (m.t === 'room' && P.validRoom(m.room)) { const r = index.rooms[m.room] || (index.rooms[m.room] = { first: m._t }); r.seen = Math.max(r.seen || 0, m._t); } });
if (!index.rooms[P.DEFAULT_ROOM]) index.rooms[P.DEFAULT_ROOM] = { first: now, seen: now };
const rooms = Object.keys(index.rooms).sort((a, b) => (index.rooms[b].seen || 0) - (index.rooms[a].seen || 0)).slice(0, MAX_ROOMS);
const real = {}; // event id -> ESPN meta (shared by all rooms in this run)
async function espnEvent(e, k) {
  if (real[e] !== undefined) return real[e];
  real[e] = null;
  try {
    const s = await P.fetchJSON(P.ESPN + k + '/summary?event=' + e, 12000);
    const c = s.header && s.header.competitions && s.header.competitions[0]; const L = P.LEAGUES.find(x => x.k === k);
    const g = c && L && P.parseEvent({ id: e, date: c.date, status: c.status, competitions: [c] }, L);
    if (g) real[e] = Object.assign(P.eventMeta(g), { real: 1 });
  } catch (err) { console.log('  summary failed', e, String(err)); }
  return real[e];
}
let wrote = 0;
for (const room of rooms) {
  P.setRoom(room);
  const file = path.join(DIR, 'rooms', room + '.json');
  const data = readJson(file) || P.emptyData(), before = JSON.stringify(data);
  let msgs = []; try { msgs = await P.readNtfy(room + '-p', 'all'); } catch (e) { console.log(room, 'ntfy read failed', String(e)); continue; }
  if (!fs.existsSync(file) && !msgs.some(m => m.t === 'pick')) continue;
  const onSlate = {}; Object.values(P.frozen(data, msgs)).forEach(ids => ids.forEach(i => { onSlate[i] = 1; }));
  const starts = {};
  const ids = [...new Set(msgs.filter(m => m && m.t === 'pick' && onSlate[String(m.e)] && P.LEAGUES.some(L => L.k === m.k)).map(m => String(m.e)))];
  for (const e of ids.slice(0, 40)) {
    const known = data.events[e]; if (known && known.real) { starts[e] = known.d; continue; }
    const meta = await espnEvent(e, msgs.find(x => String(x.e) === e).k);
    if (meta) { starts[e] = meta.d; data.events[e] = Object.assign({}, meta); }
  }
  for (const m of msgs) if (m && m.t === 'pick' && !starts[String(m.e)]) m.t = 'skip'; // never trust a client-sent start time here
  P.applyPicks(data, msgs, starts, room === P.DEFAULT_ROOM ? (process.env.PICKEM_PIN || '') : '');
  await P.gradeMissing(data, now, 40);
  const pk = msgs.filter(m => m.t === 'pick' || m.t === 'skip'); if (pk.length) data.lastMsg = pk[pk.length - 1]._id;
  const st = P.standings(data);
  if (JSON.stringify(data) !== before) { data.updated = now; fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n'); wrote++; index.rooms[room].updated = now; }
  index.rooms[room].players = st.length;
  console.log(`${room}: ${msgs.length} messages, ${Object.keys(data.events).length} events, ${st.length} players`);
  st.forEach(s => console.log(`  ${s.name.padEnd(14)} ${s.w}-${s.l}  ${P.fmtPct(s.pct, s)}  ${s.streak}`));
}
if (JSON.stringify(index) !== idxBefore) fs.writeFileSync(idxFile, JSON.stringify(index, null, 1) + '\n');
console.log(wrote ? `UPDATED ${wrote} room file(s)` : 'no change');
