/* Ahlers Arcade · FAMILY PICK'EM + PHONE REMOTE: shared logic (TV index.html, phone remote-pick.html, scripts/pickem-sync.mjs).
 * No build step, no keys. Backend (all free, no account):
 *   - ntfy.sh topics (public pub/sub, CORS *): "<room>-p" = picks (cached 12 h), "<room>-c" = remote commands + acks.
 *   - picks.json on the "pickem-data" branch, written by .github/workflows/pickem.yml (GITHUB_TOKEN, never in the browser):
 *     every pick ever made + graded finals, so the season survives ntfy's 12 h cache. Read via raw.githubusercontent.com.
 *   - ESPN site scoreboards / summary (CORS *) for the slate and for grading.
 * Ranking of "today's TOP 5" is deterministic: see rankGame() (documented in FLYNN.md §3d). */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Pickem = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var P = {};
    P.ROOM = 'ahlers-arcade-07r1ln1b6e';
    P.PAGES = 'https://ajersj-cmyk.github.io/arcade-challenge/';
    P.NTFY = 'https://ntfy.sh';
    P.DATA_URL = 'https://raw.githubusercontent.com/ajersj-cmyk/arcade-challenge/pickem-data/picks.json';
    P.ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
    P.MAX_PLAYERS = 16; P.SLATE = 5;
    try { // test hooks only (local mock servers); never set on the real TV / phones
        var ov = typeof localStorage !== 'undefined' && JSON.parse(localStorage.getItem('ahlersPickemOverride') || 'null');
        if (ov) { if (ov.ntfy) P.NTFY = ov.ntfy; if (ov.data) P.DATA_URL = ov.data; if (ov.espn) P.ESPN = ov.espn; if (ov.room) P.ROOM = ov.room; }
    } catch (e) {}
    if (typeof process !== 'undefined' && process.env) { // same hooks for scripts/pickem-sync.mjs under test
        if (process.env.PICKEM_NTFY) P.NTFY = process.env.PICKEM_NTFY; if (process.env.PICKEM_ESPN) P.ESPN = process.env.PICKEM_ESPN; if (process.env.PICKEM_ROOM) P.ROOM = process.env.PICKEM_ROOM;
    }
    // league, label, base weight, scoreboard query
    P.LEAGUES = [
        { k: 'football/nfl', lg: 'NFL', w: 30, logo: 'nfl' }, { k: 'football/college-football', lg: 'CFB', w: 18, q: 'groups=80', logo: 'ncaa' },
        { k: 'basketball/nba', lg: 'NBA', w: 18, logo: 'nba' }, { k: 'baseball/mlb', lg: 'MLB', w: 14, logo: 'mlb' },
        { k: 'hockey/nhl', lg: 'NHL', w: 12, logo: 'nhl' }, { k: 'basketball/mens-college-basketball', lg: 'CBB', w: 10, q: 'groups=50', logo: 'ncaa' },
        { k: 'basketball/wnba', lg: 'WNBA', w: 8, logo: 'wnba' }, { k: 'soccer/usa.1', lg: 'MLS', w: 6, logo: 'soccer' },
        { k: 'soccer/eng.1', lg: 'EPL', w: 8, logo: 'soccer' }, { k: 'soccer/uefa.champions', lg: 'UCL', w: 10, logo: 'soccer' }];
    // national TV weight: over-the-air networks > big cable/streaming > other national channels
    var NET_A = /^(abc|cbs|nbc|fox)$/i, NET_B = /^(espn|tnt|tbs|trutv|prime video|amazon prime video|netflix|peacock|apple tv\+?|max|youtube)$/i;
    var NET_C = /^(espn2|espnu|fs1|fs2|nfl net(work)?|nba tv|mlb net(work)?|nhl net(work)?|acc ?n(etwork)?|sec ?n(etwork)?|sec network|big ten network|btn|cbs sports network|cbssn|usa net(work)?|the cw|cw|espn\+|paramount\+)$/i;
    var RIVAL = /\b(rival\w*|trophy|derby|cl[aá]sico|backyard brawl|iron bowl|red river|the game|egg bowl|apple cup|holy war|battle of)\b/i;
    var POST = /\b(playoff|wild card|division series|championship series|world series|stanley cup|nba finals|conference final|semifinal|final four|bowl game|game [1-7]\b)/i;

    P.etDate = function (t, addDays) { // YYYYMMDD in Eastern time
        var d = new Date((t || Date.now()) + (addDays || 0) * 86400000);
        var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d), o = {};
        p.forEach(function (x) { o[x.type] = x.value; }); return o.year + o.month + o.day;
    };
    P.etHour = function (iso) { return +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)); };
    P.fmtTime = function (iso) { return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(':00', '') + ' ET'; };
    P.fmtDay = function (ymd) { var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12)); return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(); };
    P.logo = function (url, w) { var m = /^https?:\/\/a\.espncdn\.com(\/i\/[^?#]+)/.exec(url || ''); return m ? 'https://a.espncdn.com/combiner/i?img=' + m[1] + '&w=' + w + '&h=' + w : (url || ''); };
    P.fnv = function (s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); };
    P.pinTag = function (pin) { pin = String(pin || '').trim(); return pin ? P.fnv(P.ROOM + '|' + pin) : ''; };
    P.cleanName = function (n) { n = String(n || '').replace(/\s+/g, ' ').trim(); if (n.length < 1 || n.length > 14) return ''; return /^[\p{L}\p{N} .'\-]+$/u.test(n) ? n : ''; };
    P.nameKey = function (n) { return P.cleanName(n).toLowerCase(); };

    function team(c) {
        var t = c.team || {}, r = c.curatedRank && c.curatedRank.current, rec = (c.records && c.records[0] && c.records[0].summary) || '';
        return { id: String(t.id || ''), ab: t.abbreviation || t.shortDisplayName || '', name: t.shortDisplayName || t.displayName || '', full: t.displayName || '',
            logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || '', color: t.color || '', rank: r && r <= 25 ? r : 0, rec: rec, score: c.score != null ? String(c.score) : '', winner: !!c.winner };
    }
    function pct(rec) { var m = /^(\d+)-(\d+)/.exec(rec || ''); if (!m) return -1; var w = +m[1], l = +m[2]; return w + l >= 3 ? w / (w + l) : -1; }
    P.parseEvent = function (ev, L) {
        var c = ev.competitions && ev.competitions[0]; if (!c || !c.competitors || c.competitors.length !== 2) return null;
        var st = (ev.status || c.status || {}).type || {};
        if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED|FORFEIT/.test(st.name || '')) return null;
        var A = c.competitors.filter(function (x) { return x.homeAway === 'away'; })[0] || c.competitors[0], H = c.competitors.filter(function (x) { return x.homeAway === 'home'; })[0] || c.competitors[1];
        var nets = [];
        (c.geoBroadcasts || []).forEach(function (b) { if (b && b.market && /national/i.test(b.market.type || '') && b.media && b.media.shortName) nets.push(b.media.shortName); });
        (c.broadcasts || []).forEach(function (b) { if (b && /national/i.test(b.market || '')) (b.names || []).forEach(function (n) { nets.push(n); }); });
        nets = nets.filter(function (n, i) { return nets.indexOf(n) === i; });
        var o = c.odds && c.odds[0], spread = o && o.spread != null ? Math.abs(+o.spread) : null;
        var notes = (c.notes || []).map(function (n) { return n.headline || ''; }).join(' ');
        var g = { id: String(ev.id), k: L.k, lg: L.lg, start: ev.date, state: st.state || 'pre', done: !!st.completed, detail: st.shortDetail || '', a: team(A), h: team(H),
            nets: nets, spread: spread, line: o && o.details || '', notes: notes, post: (ev.season && ev.season.type === 3) || POST.test(notes) };
        P.rankGame(g, L); return g;
    };
    // Deterministic "biggest game" score. Every reason that adds points is kept in g.why (shown on the phone).
    P.rankGame = function (g, L) {
        var s = L.w, why = [], best = 0, bestNet = '';
        g.nets.forEach(function (n) { var v = NET_A.test(n) ? 20 : NET_B.test(n) ? 15 : NET_C.test(n) ? 8 : 4; if (v > best) { best = v; bestNet = n; } });
        if (best) { s += best; why.push('NATIONAL TV · ' + bestNet.toUpperCase()); }
        if (g.post) { s += 25; why.push('POSTSEASON'); }
        var ra = g.a.rank, rh = g.h.rank;
        if (ra || rh) { s += (ra ? 6 : 0) + (rh ? 6 : 0) + (ra && rh ? 6 : 0) + (ra && ra <= 10 ? 3 : 0) + (rh && rh <= 10 ? 3 : 0); why.push(ra && rh ? 'RANKED MATCHUP' : 'RANKED TEAM'); }
        if (RIVAL.test(g.notes)) { s += 8; why.push('RIVALRY'); }
        var hr = P.etHour(g.start); if (hr >= 19 && hr <= 22) { s += 6; why.push('PRIMETIME'); }
        if (g.spread != null && !isNaN(g.spread)) { if (g.spread <= 3) { s += 8; why.push('CLOSE SPREAD'); } else if (g.spread <= 6.5) { s += 4; why.push('CLOSE SPREAD'); } }
        if (pct(g.a.rec) >= 0.6 && pct(g.h.rec) >= 0.6) { s += 4; why.push('WINNING TEAMS'); }
        g.score = s; g.why = why; return s;
    };
    P.sortGames = function (list) { return list.slice().sort(function (x, y) { return (y.score - x.score) || (Date.parse(x.start) - Date.parse(y.start)) || (x.id < y.id ? -1 : 1); }); };

    P.fetchJSON = function (url, ms, fetchFn) {
        var f = fetchFn || fetch, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 9000) : null;
        return f(url, ctl ? { signal: ctl.signal, cache: 'no-store' } : {}).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) { clearTimeout(t); return j; }, function (e) { clearTimeout(t); throw e; });
    };
    // All games of one ET day across the leagues (failed leagues are skipped).
    P.loadDay = function (ymd, fetchFn) {
        return Promise.all(P.LEAGUES.map(function (L) {
            return P.fetchJSON(P.ESPN + L.k + '/scoreboard?dates=' + ymd + (L.q ? '&' + L.q : ''), 9000, fetchFn).then(function (d) {
                return (d.events || []).map(function (ev) { return P.parseEvent(ev, L); }).filter(function (g) { return g && P.etDate(Date.parse(g.start)) === ymd; });
            }, function () { return []; });
        })).then(function (lists) { return [].concat.apply([], lists); });
    };
    // Today's TOP 5 (stable all day). tomorrow = tomorrow's TOP 5, loaded only once none of today's 5 can still be picked.
    P.loadSlates = function (now, fetchFn) {
        now = now || Date.now();
        var d0 = P.etDate(now), d1 = P.etDate(now, 1);
        return P.loadDay(d0, fetchFn).then(function (all0) {
            var today = P.sortGames(all0).slice(0, P.SLATE), res = { now: now, today: { date: d0, games: today }, all: all0, tomorrow: null };
            var open = today.filter(function (g) { return g.state === 'pre' && Date.parse(g.start) > now; }).length;
            if (open) return res;
            return P.loadDay(d1, fetchFn).then(function (all1) { res.tomorrow = { date: d1, games: P.sortGames(all1).slice(0, P.SLATE) }; return res; });
        });
    };
    P.result = function (g) { // 'pre' | 'in' | final winner team id | 'tie'
        if (!g) return '';
        if (g.state !== 'post' && !g.done) return g.state || 'pre';
        if (g.a.winner) return g.a.id; if (g.h.winner) return g.h.id;
        var a = parseFloat(g.a.score), h = parseFloat(g.h.score);
        if (!isNaN(a) && !isNaN(h)) return a > h ? g.a.id : h > a ? g.h.id : 'tie';
        return 'post';
    };
    // ntfy cache (JSON lines) -> messages
    P.readNtfy = function (topic, since, fetchFn) {
        return (fetchFn || fetch)(P.NTFY + '/' + topic + '/json?poll=1&since=' + (since || 'all'), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(function (t) {
            return t.split('\n').filter(Boolean).map(function (l) { try { var m = JSON.parse(l); if (m.event !== 'message') return null; var b = JSON.parse(m.message); b._t = m.time * 1000; b._id = m.id; return b; } catch (e) { return null; } }).filter(Boolean);
        });
    };
    P.publish = function (topic, obj, fetchFn) {
        return (fetchFn || fetch)(P.NTFY + '/' + topic, { method: 'POST', body: JSON.stringify(obj) }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    };
    P.emptyData = function () { return { v: 1, room: P.ROOM, season: String(new Date().getFullYear()), updated: 0, lastMsg: '', names: {}, events: {}, picks: {} }; };
    P.eventMeta = function (g) { return { k: g.k, lg: g.lg, d: g.start, a: { id: g.a.id, ab: g.a.ab, logo: g.a.logo }, h: { id: g.h.id, ab: g.h.ab, logo: g.h.logo }, r: P.result(g), sc: g.a.score && g.h.score ? g.a.score + '-' + g.h.score : '' }; };
    // Apply pick messages to data (mutates). Lock rule: ntfy's server timestamp must be before the game's real start.
    // starts: { eventId: ISO } from ESPN (authoritative); a message's own "d" is only used when ESPN didn't give one.
    P.applyPicks = function (data, msgs, starts, pin) {
        var tag = P.pinTag(pin), changed = false;
        msgs.slice().sort(function (x, y) { return x._t - y._t; }).forEach(function (m) {
            if (!m || m.t !== 'pick' || !m.e || !m.tm) return;
            if (tag && m.g !== tag) return;
            var key = P.nameKey(m.n); if (!key) return;
            if (!data.names[key]) { if (Object.keys(data.names).length >= P.MAX_PLAYERS) return; data.names[key] = P.cleanName(m.n); changed = true; }
            var ev = data.events[m.e], start = (starts && starts[m.e]) || (ev && ev.d) || m.d; if (!start || !(m._t < Date.parse(start))) return; // locked
            if (!ev) { if (!m.a || !m.h) return; ev = data.events[m.e] = { k: String(m.k || ''), lg: String(m.lg || ''), d: start, a: m.a, h: m.h, r: 'pre', sc: '' }; changed = true; }
            if (String(m.tm) !== String(ev.a.id) && String(m.tm) !== String(ev.h.id)) return;
            var pe = data.picks[m.e] || (data.picks[m.e] = {}), cur = pe[key];
            if (!cur || cur.at < m._t) { pe[key] = { tm: String(m.tm), at: m._t }; changed = true; }
        });
        return changed;
    };
    P.standings = function (data) {
        var by = {};
        Object.keys(data.picks).forEach(function (e) {
            var ev = data.events[e]; if (!ev) return;
            Object.keys(data.picks[e]).forEach(function (k) {
                var p = data.picks[e][k], s = by[k] || (by[k] = { key: k, name: data.names[k] || k, w: 0, l: 0, t: 0, open: 0, seq: [] });
                if (ev.r === ev.a.id || ev.r === ev.h.id) { var win = ev.r === p.tm; if (win) s.w++; else s.l++; s.seq.push([Date.parse(ev.d), win ? 'W' : 'L']); }
                else if (ev.r === 'tie') s.t++; else s.open++;
            });
        });
        return Object.keys(by).map(function (k) {
            var s = by[k]; s.seq.sort(function (x, y) { return x[0] - y[0]; });
            var st = '', n = 0; for (var i = s.seq.length - 1; i >= 0; i--) { if (!st) st = s.seq[i][1]; if (s.seq[i][1] !== st) break; n++; }
            s.streak = st ? st + n : '-'; s.pct = s.w + s.l ? s.w / (s.w + s.l) : 0; delete s.seq; return s;
        }).sort(function (x, y) { return (y.w - x.w) || (y.pct - x.pct) || (x.l - y.l) || (x.name < y.name ? -1 : 1); });
    };
    P.fmtPct = function (p, s) { return s.w + s.l ? (p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, '')) : '---'; };
    // Results for events no slate covers (yesterday's picks before the GitHub job graded them): ESPN summary, at most n per call.
    P.gradeMissing = function (data, now, n, fetchFn) {
        var todo = Object.keys(data.events).filter(function (e) { var ev = data.events[e]; return ev.r !== 'tie' && ev.r !== ev.a.id && ev.r !== ev.h.id && Date.parse(ev.d) < (now || Date.now()) && ev.k; }).slice(0, n || 6);
        return Promise.all(todo.map(function (e) {
            var ev = data.events[e];
            return P.fetchJSON(P.ESPN + ev.k + '/summary?event=' + e, 9000, fetchFn).then(function (s) {
                var c = s.header && s.header.competitions && s.header.competitions[0]; if (!c) return false;
                var L = P.LEAGUES.filter(function (x) { return x.k === ev.k; })[0] || { k: ev.k, lg: ev.lg, w: 0 };
                var g = P.parseEvent({ id: e, date: c.date || ev.d, status: c.status, competitions: [c] }, L); if (!g) return false;
                var m = P.eventMeta(g); m.d = ev.d; if (m.r === ev.r && m.sc === ev.sc) return false; data.events[e] = Object.assign(ev, { r: m.r, sc: m.sc }); return true;
            }, function () { return false; });
        })).then(function (r) { return r.some(Boolean); });
    };
    // Live overlay: refresh event results from slate games we already have.
    P.overlayGames = function (data, games) {
        games.forEach(function (g) { var ev = data.events[g.id]; if (ev) { ev.r = P.result(g); ev.sc = g.a.score && g.h.score ? g.a.score + '-' + g.h.score : ''; ev.d = g.start; } });
    };
    P.pickUrl = function (pin) { return P.PAGES + 'remote-pick.html#room=' + encodeURIComponent(P.ROOM) + (pin ? '&pin=' + encodeURIComponent(pin) : ''); };
    P.qrImg = function (url, px) { return 'https://api.qrserver.com/v1/create-qr-code/?size=' + (px || 300) + 'x' + (px || 300) + '&margin=8&data=' + encodeURIComponent(url); };
    return P;
});
