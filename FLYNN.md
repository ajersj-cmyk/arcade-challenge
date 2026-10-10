# FLYNN.md: Ahlers Arcade Command Center project guide

This is the working guide for the arcade's live scoreboard site. Read it before you change anything.

- **Live file:** `index.html`, and only that file. GitHub Pages serves it from `main` at
  <https://ajersj-cmyk.github.io/arcade-challenge/> (legacy Pages build, `main` branch, `/` root).
  **Anything merged to `main` is live on the TV right away.**
- **Repo:** <https://github.com/ajersj-cmyk/arcade-challenge>

---

## 1. Working rules

1. **Only `index.html` is live.** These other files are old and unused: `player.html`, `old.html`, `quest/`,
   `android-tv/` (plus `.github/workflows/android-tv.yml`), and the extensionless backups (`early march`,
   `march 11 working`, `oldworkingplayer`, `original main combo`, `Working GAME ONLY`,
   `WOrking Movie poster and challenge thing`). **Don't edit, delete, rename or refactor them.**
   `background.mp4` and `header.PNG` sit in the root but `index.html` doesn't reference them (see §4).
   The **new** Android TV app lives in `tvapp/` (+ `.github/workflows/tvapp.yml`), see §9. It is a separate, maintained
   project; the legacy `android-tv/` folder is not.
2. **Test in a preview copy first.** Copy `index.html` to `preview.html` (gitignored), make the change there, and run
   the test script until it passes. Only then copy the change into `index.html`.
3. **Branch + PR only.** Never push to `main`. Use branches named `flynn/<topic>`, open a PR, and **Jordan merges.**
4. **Never commit** `preview.html`, `tools/out/` (screenshots/reports) or `tools/node_modules/`. `.gitignore` covers all three.
5. **Keep every item on the "Must not break" list (§6) working.** Run before/after compare on every change.
6. **Keep the site key-free.** Only use free, public, no-key APIs from the browser. Never put secrets in `index.html`,
   because the repo and the site are both public.

---

## 2. How to test (tools/)

Requires node ≥18 and Google Chrome at `/usr/bin/google-chrome` (override with `CHROME_PATH`). Deps live in
`tools/package.json` (`puppeteer-core` only). The first run installs them.

```bash
tools/test-preview.sh                 # test preview.html (creates it from index.html if missing)
tools/test-preview.sh --init          # re-copy index.html -> preview.html (asks before overwriting), then test
tools/test-preview.sh index.html      # test the live file as-is (read-only)
tools/test-preview.sh --compare       # BEFORE/AFTER: index.html vs preview.html + side-by-side screenshots
# extra flags go to tools/test-preview.mjs:
#   --no-cycle  (skip the slide fast-forward)   --wait 30000 (initial-load wait, ms)
#   --sizes 1920x1080,1280x720                  --strict (known issues, 429s and image 404s fail too)
```

What it does:

1. Starts a local static server on the repo root (127.0.0.1, random port) and loads the file in headless Chrome
   with a fresh profile (empty localStorage = default settings), America/New_York timezone, and a normal Chrome
   user agent. **ESPN's CDN returns 403 to the default `HeadlessChrome` UA**, and that shows up as a fake CORS error.
2. Waits for the initial fetches, records console errors/warnings, uncaught page errors and failed requests, then
   validates every known API response (HTTP status **and** body shape, e.g. ESPN `events[]`, rss2json `status:"ok"`,
   OpenTDB `response_code:0`).
3. Screenshots the initial state at 1920x1080 and 1280x720, plus the settings modal.
4. Runs smoke checks: clock format, exactly one slide visible, ticker populated and animating, `cursor:none`, theme
   class, QR URL, weather, `s` hotkey toggles settings, `#remote` mode.
5. **Cycle mode (default):** calls the page's own `nextSlide()` until every slide has shown, so the slide-only APIs
   (PGA, UFC, soccer, news, futures, rankings, standings) run too. It saves one screenshot per slide.
6. Writes `*-report.md` / `*-report.json` and exits **0 = pass, 1 = fail, 2 = harness error**.

7. **Remote-nav checks** run when the page has `window.arcadeNav`. The harness presses real keys (→ ← Enter, arrows in the
   menu, Space, Escape, ↑ to the gear, Enter, arrows in settings), clicks the gear with the mouse, and types in a settings
   field. It screenshots the HUD, the menu, menu focus, the jump-to-slide result, the paused badge, gear focus and settings focus.
8. **Football futures checks** run when the page has the NFL/CFB futures slides. Each slide must render real markets, and
   the FUTURES slide must include CFB TITLE + NBA TITLE.

9. **Gamecast checks** run when the page has `gcOpen`. The harness mouse-clicks a Live Action card (or a ticker game),
   checks the overlay populates from the ESPN summary API, that rotation is paused, that polls arrive **every ~10 s**
   (start-to-start gaps 8.5–12 s), then clicks CLOSE and checks timers stop, no request follows for 11.5 s and rotation
   resumes. Then by D-pad: OK → GAMES row → OK opens a game, ▶ switches game, Back closes.

`node tools/test-gamecast.mjs [preview.html]` opens a Gamecast for every live league in the page's game registry plus
reference finals/upcoming events (NFL, CFB, World Cup, MLB, EPL), screenshots each at 1920x1080, and checks poll cadence,
"never more than one request in flight", the RECONNECTING state during an induced outage (and recovery), auto-close of a
finished game, and a clean stop on close.

`node tools/test-rotation.mjs [preview.html] [--loops=3] [--speed=8]` emulates the TV app (`window.ArcadeTV`, 1280x720), turns
every slide on, and walks the real rotation several times with the page's own timers sped up 8x (real network data). It logs
each slide's actual on-screen time and fails if any slide is cut short (< 5 s), if Trivia isn't ~20 s, or if the slide after
Trivia doesn't get its full time; then repeats in NFL sport mode. ~7 min. (Before the fix it showed `leaders 1.4s` after trivia.)

`node tools/test-broadcast.mjs [preview.html]` checks the broadcast look: transition frames (Full + TV/Lite) at 1280x720,
transform-only animation, one slide left visible after the wipe, Gamecast/celebrations above it, no wipe on the phone remote page,
stadium photos (<= 6 per render, fallback to a plain card), and Lite perf under 4x CPU throttle vs. the same slide change with no
transition. `node tools/shoot-slides.mjs [preview.html] --out=DIR [--tv] [--only=a,b] [--gc=sport/league/id]` screenshots every
slide (+ a Gamecast) at 1280x720 for design reviews; `python3 tools/sheet.py OUT.png imgs... [--pairs]` makes contact sheets / before-after.

`node tools/test-props.mjs [preview.html]` checks TODAY'S HOT PROPS with the real `props.json` at 1280x720 + 1920x1080
(cards, row layout, ends above the ticker), LIVE LEADERS gone, sport-mode filtering/skip, league-toggle filtering, the settings
toggle, the empty state, and the Gamecast WIN PROBABILITY panel (a real ESPN final served as in-progress; hidden with no data).

`node tools/test-reliability.mjs [preview.html]` checks hung-fetch abort, trivia no longer skips leaders, the
rotation watchdog helpers, stale scoreboard cache + offline pill, and soft-reload skipped when `window.ArcadeTV` exists.

`node tools/test-trackers.mjs [preview.html]` checks Gamecast football field + MLB strike-zone trackers against mocked
feeds and optional real ESPN dumps (`/tmp/nfl2.json`, `/tmp/mlb2.json`): SVG field (ball, line-to-gain, drive path),
pitch dots/list/bases/count, graceful degrade, and 0 console errors. With real dumps (`/tmp/nfl2.json`, `/tmp/cfb2.json`,
`/tmp/mlb2.json`, `/tmp/nhl.json`) it also checks the views at 1280x720: FIELD default + 2.25:1 field size, remote ▲ → tabs → ▶ BOX
SCORE → ▼ scroll, Play/Pause and mouse tab switching, the view surviving a poll, box-score tables per sport, and an in-place poll
update (same DOM nodes, new value, scroll kept). Screenshots land in `tools/out/*-trackers/`.

`node tools/test-celebrate.mjs [preview.html]` tests score celebrations against mocked ESPN summaries (an NHL game
NYR @ CAR and a CFB game TEM @ ECU): the per-team ★ toggles (mouse + D-pad) and their localStorage, no fire on first look,
GOAL!! / TOUCHDOWN!! / FIELD GOAL!!! / CANES WIN!! / HALFTIME!, no repeat after a score correction, the delay (sync
overlay ±1s per channel and settings ◀/▶, 0–60 s), queued events cancelled by a correction or by closing, any key dismisses without leaking
to the Gamecast, the `arcadeCelebrate('test')` / `?celebrate=td` hooks, and 0 console errors. It also checks the scorer
card (name + headshot + assists, logo-only fallback), the FG hold-back, every alert banner (red zone once per drive, big
play, interception, lead change, puck drop, power play once per penalty, per-type off switch) and SYNC TO TV (clock target
from a mocked running clock, OK presses for TV behind / TV ahead, stopped clock, play/score fallback, per-channel memory,
TEST, D-pad + BACK). The 2 s `scoreboard/{id}` check is mocked in that section. It saves
1920x1080 screenshots of the toggles, a Hurricanes goal with Aho's card, a Canes win, an ECU touchdown, the red-zone and
power-play banners, the sync overlay (clock, stopped, play) and the settings rows.

`node tools/test-fastloop.mjs [preview.html]` checks the Gamecast's 2 s score loop against a mocked live NHL game in TV
emulation (ArcadeTV, 1280x720, 4x CPU): ~2 s cadence, summary stays ~10 s without changes, a score change pulls the summary
at once, follow-up summaries every 2 s while the summary lags the scoreboard, error backoff + recovery, nothing while the
page is hidden, never two Gamecast requests in flight, heap stable over ~2 min, stops when final / closed.
`--live sport/league/id [--secs 180]` opens a real game instead and prints requests/min, KB per request, heap before/after
and every change the loop saw.

`node tools/test-sportmode.mjs [preview.html]` tests SPORT MODE: the settings row (D-pad ▶▶▶ + OK, mouse), the saved state
(`ahlersSportMode1`, 12 h expiry, snapshot), that user settings are untouched, the indicator pill, NFL/CFB/CBB rotations (only that
sport's slides, a slide always visible), ticker/live/navigator filtered to the league while other leagues stay in the Gamecast
registry, reload persistence, switching modes keeps the first snapshot, CBB rankings/futures/news, an empty CBB scoreboard (mocked)
still rotating, OFF early, the **12 h expiry with a simulated clock** (`Date.now` shifted) restoring toggles changed during the mode,
expiry found on reload, Gamecast + celebrations in a mode, the pill never covering a slide title, nothing left under the ticker
(each slide fits above it or auto-scrolls far enough to show the last row), 0 console errors. Screenshots
(1280x720) in `tools/out/*-sportmode/`.

`node tools/test-fantasy.mjs [preview.html]` tests the NFL FANTASY slide: `fantasy.json` projections (4 per card) with
headshots + hot pickups, every card above the ticker with no scroll at 1280x720 and 1920x1080 (pre and live), no ESPN calls before the week's first kickoff, no clipped names, the settings toggle, the fallback live ESPN
Fantasy pull when `fantasy.json` is missing (real API, cached), and a simulated live week (mocked ESPN Fantasy): LIVE PPR LEADERS,
live points on rows, live dots, 2 requests per refresh, numbers patched in place after ~60 s, timer stopped on slide change. Screenshots
in `tools/out/*-fantasy/`.

`node tools/test-futures-fallback.mjs [preview.html]` tests the futures data fallbacks with request interception:
no `futures.json` → Action Network live; no file + Action Network blocked → ESPN; stale file + both blocked → last saved file.

Output goes to `tools/out/<timestamp>-<name>/` (gitignored). Compare mode writes `before-*`, `after-*`,
`compare-1920x1080.png`, `compare-1280x720.png` and `compare.html` (every slide side by side).

Failure rules: any console error, page error, failed or invalid API response, missing expected API call, or failed
smoke check. Not failures unless `--strict`:
- **Known pre-existing issues**, listed in `KNOWN_ISSUES` in `tools/test-preview.mjs`. Delete the entry once the issue is fixed.
- **HTTP 429** from a free API. That's a per-IP quota on the test machine, not a code problem. Open-Meteo hit its daily
  limit from the box's shared IP during setup, and OpenTDB allows 1 request per 5 s.
- **Image 404s** on ESPN headshots/logos. Every `<img>` has an `onerror` fallback.

---

## 3. How the site works (plain words)

It's a single self-contained HTML page (inline CSS + JS, no build step) made for a TV at 16:9. On load it:

1. Draws the background (CSS gradients + a 3-D "cyber grid"), a big clock top-left, and a settings gear top-right.
2. Shows skeleton placeholders, fetches weather and one trivia question, then **pulls 12 ESPN scoreboards one after
   another** (NHL, NFL, NBA, MLB, CFB, men's CBB, college baseball, World Cup, EPL, UCL, ATP, WTA). From those it
   builds every live-game list: ticker, live cards, leaders, TV guide, odds, My Squad, and marquee matchups. `props.json`
   (hot props) is preloaded at start and re-read every 20 min.
3. Starts the **slide rotation**. Each slide shows full-screen above a **bottom ticker** (22vh) that scrolls forever.
   Long slides auto-scroll vertically, then advance.
4. Refreshes the ESPN scoreboards **every 5 minutes** and the weather **every 15 minutes**. Some slides (PGA, UFC,
   soccer, news, futures, rankings, standings) fetch their own data each time they come up.
5. Saves settings in `localStorage` (`ahlersArcadeSettings`). The ticker accent colour cycles cyan → pink → green on every slide change.

### Slide rotation order (`nextSlide()`)

`live → hotProps → mySquad → pickem → trivia → leaders → pga → ufc → command → soccerSlide → tvGuide → news → odds → futures →
nflFutures → nflAwards → fantasy → cfbFutures → nhlFutures → rankings → nfl → nba → nhl → mlb` → (loop). (`fantasy` is spliced in
right after `nflAwards` on the line below `ARCADE_SCREENS`.) A **sport mode** replaces this list for 12 h (§3a). The order lives in the global
`ARCADE_SCREENS` array. `live` always shows. The rest (including `hotProps`) can be switched off in settings.
The old `props` LIVE LEADERS slide (ESPN live stat leaders dressed up as props) was **removed** in PR flynn/props-fixes;
`leaders` (TOP PERFORMERS) and the fantasy slide's LIVE PPR card are unchanged.

| Slide (DOM id) | Title | Data | Timing |
|---|---|---|---|
| `live-game-screen` | LIVE ACTION | in-progress games from the ticker fetch; MLB count/bases/outs, football down & spot, win-prob bar | scroll rule* (base 15 s), "NO LIVE GAMES" ≥16 s |
| `hotprops-screen` | TODAY'S HOT PROPS | `props.json` (§4c): player props for today's games (ET date, started < 4 h ago), HOT (biggest moves since open) first, max 24 cards, 2 columns; headshot, league, matchup + time, line/odds, DK/FD/CZR, move. Ticker league toggles filter it; in a sport mode only that sport (skipped if none) | scroll rule (base 16 s); empty state 6 s |
| `mysquad-screen` | MY SQUAD DASHBOARD | games matching `mySquadTeams` (default "Carolina Hurricanes, Duke, ECU, East Carolina") | scroll rule |
| `pickem-screen` | FAMILY PICK'EM | season standings + today's TOP 5 with everyone's picks + QR (§3d) | 20 s |
| `trivia-screen` | TRIVIA BREAK! | OpenTDB sports question; 15 s countdown bar, then 5 s answer reveal; clock hidden | 20 s |
| `leaders-screen` | DAILY TOP PERFORMERS | first 8 leaders | scroll rule / 6 s if none |
| `pga-screen` | (event name) | ESPN golf scoreboard leaderboard | scroll rule / 6 s |
| `ufc-screen` | UFC: (event) | ESPN MMA scoreboard, winner/loser styling, live round badge | scroll rule / 6 s |
| `command-screen` | AHLERS COMMAND CENTER | Greenville NC weather (Open-Meteo) + top-2 "marquee" games by weight | 15 s |
| `soccer-screen` | GLOBAL SOCCER MATCHES | World Cup/EPL/UCL scoreboards, fetched again | scroll rule / 6 s |
| `tvguide-screen` | LIVE ON TV | live games with a broadcast; network favicons via Google s2 | scroll rule / 6 s |
| `news-screen` | TODAY'S HEADLINES | ESPN league news with photos (see §3c); rss2json Yahoo/CBS only if every ESPN feed fails | 5 hero stories × 7 s (= 35 s) / 6 s |
| `odds-screen` | TODAY'S LINES | upcoming games with ESPN spread/O-U/ML | scroll rule / 6 s |
| `futures-screen` | FUTURES | ESPN core futures: Super Bowl, CFB title, NBA title, World Series, Stanley Cup (top 8 each), cached 24 h (`ahlersFutures4`) | scroll rule (18 s) / 8 s |
| `nflfut-screen` | NFL FUTURES | Super Bowl (8), AFC/NFC champion (6), 8 divisions (4), from `futures.json` (§4a) | scroll rule / 6 s "NO ODDS POSTED" |
| `nflawards-screen` | NFL AWARDS ODDS | MVP, OPOY, DPOY, OROY, DROY, Comeback, Coach of the Year (6 each), with headshots | scroll rule / 6 s |
| `fantasy-screen` | NFL FANTASY | Week N PPR projections, top 4 each: row 1 QB/RB/WR/TE, row 2 K + D/ST + HOT PICKUPS (8). After the week's first kickoff, row 2 becomes LIVE PPR LEADERS (8) + HOT PICKUPS and rows show live points (§4b). Fixed-height rows; the whole slide fits above the ticker at 720p/1080p (`#fantasy-viewport` 59vh), no scroll | 18 s / 6 s "FANTASY FEED DOWN" |
| `nhlfut-screen` | NHL FUTURES | one wide Stanley Cup Winner panel, top 16 in two columns | scroll rule / 6 s |
| `cfbfut-screen` | COLLEGE FOOTBALL FUTURES | National title, make CFP title game, Heisman (8); SEC/Big Ten/Big 12/ACC (5); AAC, MWC, Sun Belt, MAC, C-USA, Pac-12 (4) | scroll rule / 6 s |
| `rankings-screen` | COLLEGE RANKINGS | ESPN CFB rankings top 25 + records (CFB standings, cached 24 h) | scroll rule / 5 s on error |
| `nfl/nba/nhl/mlb-screen` | XXX STANDINGS | ESPN standings grouped by division (NBA by conference) | scroll rule / 6 s |

\*Scroll rule (`applyScroll`): if content is taller than the viewport, hold 4 s, scroll at 22 px/s (min 8 s), hold 5 s,
then advance. Otherwise show for `max(base, 16 s)`.

### 3a. Sport mode (Settings → SPORT MODE · 12 HOURS)
Buttons **OFF · COLLEGE FOOTBALL · COLLEGE BASKETBALL · NFL** at the top of the settings modal (first D-pad stop).
- **State:** `localStorage.ahlersSportMode1 = { mode, start, until: start + 12 h, snap, step }`. It survives reloads, the 4 AM
  soft reload and the TV app. **The user's settings are never changed by a mode**; `snap` is a copy of the slide + league
  toggles (`ARCADE_SCREENS` keys + `show*`) taken when the first mode starts (switching modes keeps it).
- **Rotation:** `arcadeScreens()` returns the mode's list (`SPORT_MODES` in index.html), ignoring the slide toggles:
  NFL `live hotProps pickem fantasy odds nflFutures nflAwards news tvGuide nfl`; CFB `live hotProps pickem mySquad odds cfbFutures rankings news tvGuide`;
  CBB `live hotProps pickem mySquad odds rankings futures news tvGuide`. `slideOn(k)` / `navEnabled` / navigator / HUD / ◀▶ all use it.
  Data slides with nothing to show (hotProps for that sport, odds, TV guide, My Squad) are skipped in a mode (`smSlideEmpty`); `live` always shows,
  so the rotation is never empty.
- **Data:** all 12 scoreboards are still fetched (the mode's league even if its ticker toggle is off), so ★ celebrations and the
  Gamecast registry keep every league, but ticker, live cards, leaders, TV guide, odds, My Squad and the marquee only get the mode's
  league. The mode league looks ahead 45 days for upcoming games (CBB in October shows the Nov 1 exhibitions as UP NEXT). With
  nothing live, LIVE ACTION shows that sport's next games / latest finals. Ticker head reads `NFL MODE · LIVE NOW` etc.
  News = ESPN `/{sport}/news` (limit 20) for the sport only (`NFL / CFB / HOOPS HEADLINES`); rankings = CBB AP poll in hoops mode
  (`COLLEGE HOOPS TOP 25`, poll points when there's no record); futures = ESPN core CBB markets in hoops mode
  (national title, Final Four, ACC/SEC/Big Ten; cached 24 h as `ahlersFuturesCBB1`).
- **Indicator:** pill under the clock, `NFL MODE · 11:42 LEFT` (updated by the 1 s clock tick). Settings shows the end time.
- **End:** OFF (early) or `Date.now() >= until` (checked every second, and on load if it ran out while the TV was off): the state
  is removed, the snapshot is written back to `settings`/`ahlersArcadeSettings` (only if something differs), the rotation step
  is restored, scoreboards are refetched and the HUD says `SPORT MODE ENDED · ALL SLIDES BACK`.

### Ticker
`LIVE NOW` + live games (pulsing dot, logos, scores, status) or, if nothing is live, `UPCOMING` + games in the next
24 h (96 h for NFL/CFB) with start times. Then the custom marquee message (default "WELCOME TO AHLERS ARCADE").
The content is written twice and animated `translateX(0 → -50%)` for a seamless loop. Speed setting 1-10 maps to
30-420 px/s (default 5 = 120 px/s, minimum 10 s per loop). Every 5-min refresh rewrites the ticker, so the scroll restarts.

### Settings modal ("ARCADE CONTROL CENTER")
Ticker speed (−/+), favourite teams, marquee message, slide toggles, ticker league toggles, standings/expansion
toggles, and a QR code for `#remote` mode. Opens/closes with the gear or the hotkeys in §5.

### Remote mode (`#remote`)
`index.html#remote` shows one "NEXT SLIDE" button that posts `{action:'forceNext'}` on a `BroadcastChannel('cinema_channel')`.
Settings changes are broadcast the same way. **BroadcastChannel only reaches tabs in the same browser on the same
device**, so it can't control the TV from a phone. It is kept as-is. The settings QR now opens the real phone remote
(`remote-pick.html`, §3d).

---

### 3b. Broadcast look (PR flynn/broadcast-look)
- **Design tokens** (one `BROADCAST LOOK` block at the end of `<style>`, overriding the older rules so the diff stays reviewable):
  `--ds-display` (Barlow Condensed: titles, team names, scores, ticker, clock), `--ds-radius`, `--ds-card-bg`, `--ds-card-shadow`,
  `--ds-fs-title|section|label|team|score`, `--ds-ink-dim`. Body uses tabular numerals. Slide titles are white condensed italic with
  the accent "slash" motif + accent rule; every card family (`glass-card`, rows, blocks) shares one surface.
- **Transitions** (`bxBegin/bxHold/bxRun/bxFinish`, called from `nextSlide()`): a league-colored slab with angled accent/white bars
  (`#bx-wipe`, 760 ms, transform only) covers the outgoing slide (kept up ~330 ms with `.bx-old`; the new one waits hidden under
  `#main-wrapper.bx-cover`), then wipes off to reveal the new slide; then a lower third (`#bx-l3`: league bug, slide name,
  "UP NEXT · …") slides in for ~4 s just above the ticker. Never touches `slideTimer` (rotation timing unchanged, `test-rotation`).
  Lite (TV app / reduced motion): no stripes, glints or shadows. Off on the phone remote page. Colors/bugs per slide: `BX_INFO`.
- **Stadium photos**: game objects carry `venueImg` from the scoreboard's `competitions[0].venue.id` →
  `a.espncdn.com/combiner/i?img=/i/venues/{league}/day[/interior]/{id}.jpg&w=640&h=360&scale=crop&cquality=60` (~50 KB; NFL/CFB use
  the interior shot). `bxVenueCard()` adds a faded photo + dark gradient behind Live / My Squad / Today's Lines cards, max 6 per render,
  lazy, fades in on load; a missing photo falls back to the outside shot, then to the plain card. Coverage (Oct 2026): NHL, NFL, CFB,
  MLB, WNBA nearly all; NBA partial; soccer none. Gamecast: `gcVenueSet(d)` uses the summary's `gameInfo.venue.images` (interior
  preferred, 960x540) behind the header (`#gc-venue`, z-index -1 inside the Gamecast stacking context); cleared on close.

### 3c. Headlines slide (PR flynn/headlines)

A broadcast-style news segment instead of the old scrolling list. Code: `showNews` / `nwLoad` / `nwBuild` / `nwHero` in index.html.
- **Data:** ESPN site news per enabled league (NFL, CFB, NHL, NBA, MLB; CBB only in hoops mode) in parallel, plus team news
  (`&team=id`) for up to 2 favourite teams (Settings → favourite teams) that are in today's scoreboards. A sport mode fetches only
  its sport. Fields used: `headline` (or `shortLinkText` when it is shorter), `description` (keywords only), `published`, `type`,
  `images[]` (16:9 `header` image preferred), `categories[]` (team id/name/short name, athlete id). Cached 5 min.
- **Picking:** fantasy / betting / picks / schedule / "where to watch" / live-blog items are dropped; dedupe; score = recency +
  type (HeadlineNews +3, Media/Preview −2) + favourite +8 + photo +2 + breaking +2 + trending +1; max 2 per league in the 5.
- **Copy:** ESPN's own headline, never rewritten: entities cleaned, "Sources:" prefix and trailing "- ESPN" etc. removed, trimmed
  to ~90 chars at a word boundary; CSS uppercases it.
- **Tags (deterministic):** BREAKING (< 60 min old, not video/preview, or "breaking" in the headline), ★ TEAM (favourite),
  TRENDING (same team/athlete in 2+ stories), kicker from keywords in the headline first, then the description: TRADE ALERT,
  INJURY UPDATE, SIGNING, RETIREMENT, COACHING CHANGE, RETURN WATCH, SUSPENSION, BIG WIN; else FINAL (Recap), GAME PREVIEW,
  WATCH (Media), REPORT. Relative time "23 MIN AGO".
- **Layout:** hero 16:9 photo (left, `min(110vh, 63vw)` wide) with chips, kicker, 3-line condensed headline, team logo +
  athlete headshot, progress bar; right rail "UP NEXT" with 4 photo cards. Stage height `100vh - ticker - 15.5vh` (fits above
  the ticker at 720p/1080p). Hero changes every 7 s (`NW_STORY_MS`, own `nwState.timer` with a slide-gen guard), slide = stories × 7 s.
- **TV-light:** crossfade by opacity; Ken Burns zoom only when `!bxLite()` (none in the TV app / reduced motion); at most one
  960x540 hero kept decoded (+ the next one preloaded); thumbs `loading=lazy` at 320x180; no photo → team logo art.
- Test: `node tools/test-news.mjs [file]` (mocked feeds). Screenshots: `node tools/shoot-news.mjs [file] --modes=,nfl,cfb --frames=2 [--tv]`.

### 3d. Family pick'em + phone remote (PR flynn/pickem)

New files: `pickem-core.js` (shared by the TV, the phone page and the sync script), `remote-pick.html` (phone page),
`scripts/pickem-sync.mjs` + `.github/workflows/pickem.yml` (grading/persistence), `tools/test-pickem.mjs`.
- **QR:** on the `pickem` slide and in Settings → `https://ajersj-cmyk.github.io/arcade-challenge/remote-pick.html#room=<room>[&pin=<PIN>]`
  (QR image from api.qrserver.com like before). Room code = `Pickem.ROOM` in pickem-core.js (`ahlers-arcade-07r1ln1b6e`).
- **Backend (free, no account, nothing secret in the browser):**
  - **ntfy.sh** public topics. `<room>-p` = pick messages (cached 12 h by ntfy), `<room>-c` = remote commands and the TV's acks.
    Anonymous limits per IP: 250 messages/day, 12 h cache. CORS `*`.
  - **picks.json on the `pickem-data` branch**, read via `raw.githubusercontent.com` (CORS `*`, ~5 min CDN cache). It holds all
    picks and graded results of the season. It is written only by the `pickem.yml` Action (every ~10 min, `GITHUB_TOKEN`, commits only
    when something changed, never to main). The Action reads ntfy, checks every picked event on ESPN `summary` (real start time + teams,
    unknown ids dropped), applies the lock rule and grades finals. **The Action runs only once this workflow is on main** (cron).
  - Clients (TV + phones) merge picks.json + the ntfy cache + live ESPN scoreboards themselves, so today's picks and results show
    right away, even before the Action has run.
- **Lock rule:** a pick counts only if ntfy's *server* timestamp is before the game's ESPN start time. The latest pick per
  name + game wins. The phone disables the buttons at the start, and late messages are ignored everywhere.
- **TOP 5 (deterministic, `rankGame`)**, over all of the ET day's games in NFL, CFB (FBS), NBA, MLB, NHL, CBB, WNBA, MLS, EPL, UCL:
  - League base: NFL 30 · CFB 18 · NBA 18 · MLB 14 · NHL 12 · CBB 10 · UCL 10 · WNBA 8 · EPL 8 · MLS 6.
  - National TV (best network): ABC/CBS/NBC/FOX +20; ESPN/TNT/TBS/truTV/Prime Video/Netflix/Peacock/Apple TV/Max/YouTube +15;
    ESPN2/ESPNU/FS1/NFL Network/NBA TV/MLB Network/NHL Network/ACCN/SECN/BTN/CBSSN/USA/CW/ESPN+ +8; any other national +4.
  - Postseason +25. Ranked: +6 per ranked team, +6 more if both are ranked, +3 per top-10 team.
  - Rivalry note (trophy/derby/rivalry…) +8. Primetime (7-10:59 PM ET start) +6.
  - Spread ≤3 +8, ≤6.5 +4. Both teams ≥.600 (3+ games) +4.
  - Ties go to the earlier start, then event id. Postponed or canceled games are skipped.
  - The phone shows the reasons as chips. The slate is today's 5 (stable all day). Once none of them can still be picked, the
    phone shows **tomorrow's** 5 first (today's results below), and the TV switches to tomorrow when today's 5 are all final.
- **Phone page:** name (1-14 letters/numbers, saved in localStorage `arcadePickName`; same name = same player; max 16 players
  per room), PICKS / STANDINGS / REMOTE tabs, others' picks as chips, right/wrong after the final. It refreshes every 30 s while visible.
- **Remote:** PREV / NEXT / SHOW PICK'EM BOARD / CLOSE (Gamecast, settings, menu, celebration) / CELEBRATE (silent
  `arcadeCelebrate('test')`), plus OPEN GAMECAST for any of today's games (registry key by event id, else the phone's game info).
  - The TV keeps **one EventSource** to `<room>-c` (`pkRemoteStart`, no polling) with a 15 s → 5 min backoff on errors.
  - It ignores commands older than 60 s and repeated ids, and answers each command with an ack the phone shows ("TV ✓ …").
  - Settings → Phone Remote (QR) turns the listener off.
- **Household PIN (optional):** Settings → Pick'em / remote PIN. It goes into the QR. Messages carry `g = fnv(room|pin)`. The TV
  ignores commands and picks without it. For the Action to enforce it too, add a repo secret `PICKEM_PIN`. It is simple anti-abuse,
  not security: ntfy topics are public, and the room code is in the public repo.
- **Slide:** `pickem` (toggle `pickem`, default on, also in all sport modes).
  - Left: SEASON STANDINGS (W-L, PCT, streak, up to 7 rows) + a SCAN TO PLAY QR card.
  - Right: TODAY'S TOP 5 with times/network, live scores, and everyone's picks as chips (live leader cyan, right green, wrong red).
  - 20 s, fits above the ticker at 720p/1080p. Slate cache 3 min, picks.json 5 min.
- **Standings:** 1 point per correct pick; ties/draws don't count. Sorted by W, then PCT, L, name.
  The season = everything in picks.json. To start a new season, replace picks.json on `pickem-data` with an empty file.
- Test: `node tools/test-pickem.mjs [file]` (local mock of ESPN + ntfy + picks.json, two phones, TV, sync script).

## 4. External APIs and assets

None of them need an API key, and **no keys or tokens are embedded**. The code actively deletes a legacy
`settings.oddsApiKey` and the `ahlersPropsCache` entry from localStorage.

| API | Endpoint(s) | When / refresh | Feeds |
|---|---|---|---|
| ESPN site scoreboard | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard` for hockey/nhl, football/nfl, basketball/nba, baseball/mlb, football/college-football `?groups=80`, basketball/mens-college-basketball `?groups=50` (if `cbb50`), baseball/college-baseball, soccer/fifa.world, soccer/eng.1, soccer/uefa.champions, tennis/atp, tennis/wta. Base comes from `settings.apiBase` | on load, then every **5 min** (sequential, each league toggleable) | ticker, live, props, leaders, my squad, TV guide, odds, marquee |
| ESPN site scoreboard (slide) | `.../golf/pga/scoreboard`, `.../mma/ufc/scoreboard`, `.../soccer/{fifa.world,eng.1,uefa.champions}/scoreboard` | each time the PGA / UFC / soccer slide shows | those slides |
| ESPN summary (Gamecast) | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/summary?event={id}` (CORS `*`, no key). 0.1–1 MB per response (MLB is the largest) | only while a Gamecast is open: every **10 s**, right away when the 2 s check sees a change (then every 2 s for up to 20 s until the summary shows it), 8 s timeout | Gamecast overlay |
| ESPN single-event scoreboard (Gamecast fast loop) | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard/{id}` (CORS `*`, `max-age=1`). ~16–20 KB raw, ~3–4 KB gzipped | only while a **live** Gamecast is open and the page is visible: every **2 s**, 4 s timeout, never while the summary is in flight, backs off 4/8/16/30 s on errors | change detection + SYNC TO TV |
| ESPN standings | `https://site.api.espn.com/apis/v2/sports/{football/nfl, basketball/nba, hockey/nhl, baseball/mlb}/standings` | each time the slide shows | standings slides |
| ESPN CFB standings | `https://site.api.espn.com/apis/v2/sports/football/college-football/standings` | rankings slide, cached 24 h (`ahlersCfbRecords`) | ranking records |
| ESPN CFB rankings | `https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings` | each time the rankings slide shows | rankings |
| ~~ESPN teams~~ | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams?limit=400`. **No longer called**: it always failed CORS (§7 #1) | n/a | n/a |
| ESPN core futures | `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/seasons/{year}/futures?limit=50`. Tries the likely season years per sport and keeps the fullest market. Matches on `displayName` + `name`. | futures slide, cached 24 h (`ahlersFutures4`) | futures |
| ESPN core $ref | `https://sports.core.api.espn.com/v2/sports/.../teams/{id}` (and `/athletes/{id}` for the ESPN fallback) | resolves team names missing from the built-in maps (e.g. CFB) | futures slides |
| futures.json (same origin) | `futures.json?t=<30-min bucket>`, written daily by `.github/workflows/futures.yml` | each football futures slide, re-checked every 30 min | NFL/CFB futures + awards (§4a) |
| Action Network | `https://api.actionnetwork.com/web/v1/leagues/{1=NFL,2=NCAAF,3=NHL}/futures/available` and `.../futures/{type}?bookIds=15,68,69,75,123`. CORS echoes the page origin, no key. | **browser fallback only** (file missing or > ~2 days old), cached 3 h (`ahlersFootballFutures2`) | NFL/CFB/NHL futures |
| ESPN news | `https://site.api.espn.com/apis/site/v2/sports/{football/nfl, football/college-football, hockey/nhl, basketball/nba, baseball/mlb, basketball/mens-college-basketball}/news?limit=8` (+ `&team={id}` for up to 2 favourite teams playing today; limit 20 in a sport mode). CORS `*`, ~10 KB gz each | news slide; cached 5 min in memory | Headlines (§3c) |
| ESPN image combiner | `https://a.espncdn.com/combiner/i?img=/photo/...jpg&w=960&h=540&scale=crop&cquality=70` (hero), `w=320&h=180` (cards), team logos `img=/i/teamlogos/{nfl,nhl,nba,mlb,ncaa}/500/{id}.png&w=120&h=120`, headshots `img=/i/headshots/{league}/players/full/{id}.png&w=120&h=88` | Headlines slide | resized photos (16 KB instead of 30-200 KB) |
| ESPN CBB rankings | `.../basketball/mens-college-basketball/rankings` (CORS `*`, ~290 KB) | rankings slide in hoops mode | AP top 25 |
| fantasy.json (same origin) | `fantasy.json?t=<30-min bucket>`, written daily by the futures workflow (§4b) | fantasy slide | projections + pickups |
| ESPN Fantasy | `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{yr}/segments/0/leaguedefaults/3?scoringPeriodId={wk}&view=kona_playercard` + `X-Fantasy-Filter` header (CORS echoes the origin and allows that header; no key). ~5 KB/player with the rank filters | live PPR: 2 requests per refresh, only after the week's first kickoff and only while the slide shows (60 s while an NFL game is live, else 15 min cache). Projection fallback (~9 requests) only if `fantasy.json` is missing/> 2.5 days old, cached 12 h (`ahlersFantasy1`) | fantasy slide |
| Open-Meteo | `https://api.open-meteo.com/v1/forecast?latitude=35.6127&longitude=-77.3663&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America/New_York` | on load, then every **15 min** (only if Command Center is on) | Command Center weather |
| Open Trivia DB | `https://opentdb.com/api.php?amount=1&category=21&type=multiple` | on load and after each trivia slide | trivia (rate limit 1 req / 5 s / IP) |
| ntfy.sh | `https://ntfy.sh/<room>-p` (picks), `<room>-c` (remote; TV holds one `/sse` stream), `/json?poll=1&since=all` | pick'em slide, phone page, remote | pick'em + remote (§3d). Anonymous: 250 msgs/day/IP, 12 h cache |
| picks.json | `https://raw.githubusercontent.com/ajersj-cmyk/arcade-challenge/pickem-data/picks.json` | pick'em slide / phone | season picks + results (§3d) |
| rss2json | `https://api.rss2json.com/v1/api.json?rss_url=` + Yahoo Sports RSS / CBS Sports headlines RSS | **fallback only**: news slide when every ESPN news feed fails | headlines (free tier, rate-limited) |
| QR Server | `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=<page>#remote...` | when the settings UI loads | QR `<img>` |
| Google s2 favicons | `https://www.google.com/s2/favicons?domain=<network>&sz=128` | TV guide | network logos |
| ESPN CDN images | `https://a.espncdn.com/...` team logos, headshots, league logos, default fallbacks | throughout | images (`onerror` fallbacks) |
| Tailwind Play CDN | `https://cdn.tailwindcss.com` | on load | **No Tailwind utility classes are used.** Only its Preflight CSS reset affects the look. It logs a production warning and watches the DOM at runtime. |
| Google Fonts | Inter 300/400/700/900 + Share Tech Mono | on load | fonts |

### 4a. Football futures data pipeline
1. **Daily GitHub Action** (`.github/workflows/futures.yml`, 10:17 UTC ≈ 6:17 AM ET, also runnable by hand) runs
   `node scripts/fetch-futures.mjs futures.json`. It pulls Action Network (consensus line + DK/FD/MGM/Caesars) and fills
   missing markets from ESPN core (DraftKings; e.g. NFL Coach of the Year). NHL Stanley Cup: Action Network league 3,
   ESPN fallback `hockey/nhl`. ESPN files the 2026-27 NHL season under **2026** (checked 2026-10-07; 2027 only has a Hart
   market), so the script tries both candidate seasons and keeps the fullest market. `FUTURES_SKIP_AN=1` tests the
   ESPN-only path. It commits `futures.json` to `main` only if
   the file changed. **If fewer than 5 markets come back, the last good file is kept.** Scheduled runs only start after
   this workflow is on `main`.
2. **In the browser** (`loadFootballFutures()`): `futures.json` if it's < ~2.2 days old → else localStorage cache of a
   live pull (< 3 h) → else Action Network live (+ ESPN fill) → else ESPN core only → else the stale file ("LAST SAVED FEED").
   Each slide's subtitle shows the source and update time.
3. File shape: `{ generatedAt, season, nfl: { super_bowl, afc_champ, …, coy }, ncaaf: { cfb_title, heisman, … },
   nhl: { stanley_cup }, errors }`. Each market is `{ title, source, primaryBook, rows: [{ name, short, team, logo, teamLogo, player, odds, implied, books }] }`.

### 4b. NFL fantasy data pipeline
1. **Daily** (same workflow/run as futures, `continue-on-error`): `node scripts/fetch-fantasy.mjs fantasy.json`.
   ESPN Fantasy PPR (`leaguedefaults/3`): current week (`seasons/{yr}.currentScoringPeriod`), pro-team schedules (opponent + ESPN
   event id), top ~60 owned per slot → weekly projection (stat source 1, split 1), drop bye/OUT/IR, keep the top 8 (K/DST 5).
   Pickups: Sleeper `players/nfl/trending/add` (24 h) resolved through Sleeper's players map (`espn_id`; too big for the TV, fine
   in the Action) then ESPN ownership/projection; < 75% owned, max 2 D/ST + 1 K; fallback ESPN `sortPercChanged`. Keeps the old file if
   fewer than 4 positions come back. ~12 KB.
2. **Browser** (`ffLoad`): `fantasy.json` if < 2.5 days old → `ahlersFantasy1` (< 12 h) → live ESPN pull → stale file. Live points
   (`ffLoadLive`): one leaders request (sort by week points, 8) + one `filterIds` request for the ~34 players on screen; patched in place.
   Headshots `a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/{espnId}.png&w=96&h=70` (D/ST: team logo).
3. Shape: `{ generatedAt, season, week, scoring, source, pickupSource, teams{proTeamId:abbr}, games{proTeamId:{opp,home,date,eventId}},
   positions{QB,RB,WR,TE,K,DST:[{id,name,first,last,pos,team,opp,kick,eventId,proj,own,chg,inj}]}, pickups[…+adds], errors }`.

### 4c. Hot props data pipeline (TODAY'S HOT PROPS)
1. **Every ~3 h** (`.github/workflows/props.yml`, 9:07 AM / 12:07 / 3:07 / 6:07 / 9:07 PM EDT + manual): `node scripts/fetch-props.mjs props.json`,
   commits only if changed. Action Network's public web API (no key; the one actionnetwork.com's props pages use). Its CORS only
   reflects actionnetwork origins and payloads are 0.3–2 MB per market/day, so the TV never calls it directly.
   - `GET api.actionnetwork.com/web/v2/scoreboard/{nfl|ncaaf|nba|ncaab|nhl|mlb}?period=game&date=YYYYMMDD` (games, teams, colors, logos)
   - `GET …/web/v2/scoreboard/{lg}/markets?customPickTypes=core_bet_type_{N}_{name}&date=YYYYMMDD&bookIds=15,30,49,68,69`
     → `{ markets: {bookId: {eventId: {type: [rows]}}}, players: [{id, full_name, position, image, team_id}] }`.
     Books: 15 consensus, 30 open, 68 DraftKings, 69 FanDuel, 49 Caesars. Market ids: NFL/CFB 62 anytime TD, 9 pass yds, 12 rush yds,
     16 rec yds; NBA/CBB 27 pts, 23 reb, 26 ast, 21 threes; NHL 313 anytime goal, 31 shots, 280 points; MLB 33 HR, 36 hits, 37 Ks.
     `/web/v2/games/{id}/props/types` lists a game's markets. Endpoints were found in actionnetwork.com's Next.js bundles (undocumented).
   - Main line = most common DK/FD/CZR value (alt lines dropped); move = open (book 30) → now (implied-prob or line change);
     top 5 moves per league are `hot`. "Most bet" isn't available (bet_info is zeros publicly). Today ET + tomorrow, now−4 h … +36 h.
   - Keeps the last file (exit 1) if every league fails. ~40 KB.
2. **Browser** (`hpLoad`): `props.json?t=<20-min bucket>` → `ahlersProps1` localStorage fallback. `hpList()` filters/sorts; `showHotProps(gen)`.
3. Shape: `{ updated, source, leagues: { nfl|ncaaf|nba|ncaab|nhl|mlb: { label, espn, games: [{id, start, status, home/away: {id, abbr, name, logo, color}}],
   props: [{lg, mk, kind: 'ou'|'yes', game, side, player, short, pos, img, line, odds, books: {DK|FD|CZR: {o, v}}, move, moveTxt, hot?}] } } }`.

Local assets: `index.html` references **no** local files apart from `futures.json`, `fantasy.json` and `props.json`. `background.mp4` (1.3 MB) and `header.PNG` (710 KB) exist
but aren't used: there's no `<video>` element, and the background is pure CSS.

---

## 5. TV / kiosk behaviour and remote/keyboard handling (current)

- **Screen sizing:** everything is in `vh`/`vw`; `html, body { font-size: 3.5vh }`, so `rem` scales with height too. The
  page is fixed at `100vw × 100vh`, `overflow: hidden`. It looks right at any 16:9 size (tested 1920x1080 and 1280x720).
  There's no `<meta name="viewport">`.
- **Cursor hidden** (`cursor: none` on html/body).
- **Not present:** fullscreen API (`#fs-toggle` is a hidden, empty placeholder), Wake Lock, auto-reload/nightly
  refresh, offline detection, service worker, favicon. The page is meant to run forever without reloading.
- **Timers:** clock 1 s; scoreboards 5 min; weather 15 min; slide timers per §3; trivia 15 s + 5 s.

### Keyboard / remote input (all of it)
- One `keydown` listener toggles the settings modal (`preventDefault`) when `isSettingsHotkey(e)` is true:
  - `Enter` / keyCode 13 / 23 / 66, **only while the gear button has focus**
  - `s` / `S`, `ContextMenu` key, or keyCode 82 / 139 / 176 / 221. Watch out: in browsers 82 is the **R** key and 221 is
    **]**, so those also open settings. The numbers look like a mix of Android KeyEvent codes (82 MENU, 176 SETTINGS,
    23 DPAD_CENTER, 66 ENTER) and DOM keyCodes.
- A `keyup` listener calls `preventDefault` for the same keys.
- **Focusable elements:** `#settings-gear` (`tabindex=1`, with a pink `:focus` outline and a rotate effect). Inside the modal:
  −/+ buttons, the favourite-teams and marquee text inputs, ~35 checkboxes and SAVE & CLOSE. `#fs-toggle` and the hidden
  range input use `tabindex=-1`.
- **No arrow-key / D-pad navigation, no Back/Escape handling, no slide skip from the keyboard, no focus trap.** Opening the
  modal doesn't move focus into it. Escape doesn't close it. Android TV Back falls through to the browser
  (history back or exit).
- **Bug (verified in headless Chrome, fixed in PR #2):** a mouse click or tap on the gear did nothing, because both the inline
  `onclick="toggleSettings()"` and an `addEventListener('click')` call `toggleSettings()`, so it opens and closes at once.
  Keyboard Enter on the focused gear works, because the keydown handler toggles and `preventDefault` stops the click.

### D-pad / remote navigation (added in PR #2, `arcadeNav` in index.html)
Nothing changes on screen until a remote key is pressed. Everything auto-hides after **10 s** of no input. Settings
auto-close after **90 s**. Pause auto-resumes after **10 min**.

| Key (TV remote / keyboard) | Kiosk view | Navigator menu | Settings modal |
|---|---|---|---|
| ◀ / ▶ (37/39; raw Android 21/22) | previous / next slide + HUD pill | move focus | move focus |
| ▲ (38; raw 19) | focus the settings gear | move focus | move focus |
| ▼ (40; raw 20) | open navigator menu | move focus | move focus |
| OK / Enter (13; raw 23 DPAD_CENTER, 66) | open navigator menu (on the gear: open settings, as before) | activate item | toggle checkbox / press button |
| Back / Esc / Backspace (27, 8, BrowserBack; raw 4) | hide HUD / un-focus gear | close menu | close settings |
| Play-Pause / Space / P (179; raw 85) | pause / resume rotation (⏸ PAUSED badge) | pause / resume | native |
| M | open navigator menu | close menu | n/a |
| s, ContextMenu/Menu, Settings (existing hotkeys) | toggle settings (unchanged) | toggle settings | toggle settings |

- Raw Android KeyEvent codes only match when the browser gives no `e.key`, so a real keyboard's B/U/CapsLock never trigger anything.
- The menu lists every enabled slide (current one highlighted), plus PAUSE/RESUME, SETTINGS and CLOSE. Mouse clicks work too.
- Text fields keep their arrow/backspace keys. Typing "s" in a settings field no longer closes the modal.
- After the first remote key press, one history entry is pushed so the Android TV Back button closes overlays instead of leaving the page.
### Gamecast (live game overlay, PR #4)
Open it from a **Live Action card** or **My Squad card** (mouse click), a **ticker game** (click), or the navigator's
**GAMES row** (OK, then OK again; on the Live Action slide, OK lands straight on the first game). It covers the whole
screen and **pauses rotation**. When it closes, rotation picks up again: if the slide timer fired while it was open, the
next slide shows right away.

| Key | Gamecast |
|---|---|
| Back / Esc / Backspace, or click ✕ CLOSE | close, back to rotation |
| ◀ / ▶ | previous / next game (live first, then upcoming, then recent finals) |
| ▲ / ▼ | scroll the visible stats / box-score panels (auto-scroll resumes after 8 s) |
| ▲ when the panels are at the top (or ▼ from the ★ row) | focus the **view tabs**; then ◀ / ▶ (or OK) switch view, ▼ goes back to scrolling, ▲ goes to the ★ row |
| Play/Pause (Space / P) | switch view directly (FIELD ⇄ BOX SCORE etc.) |
| OK | focus the first ★ CELEBRATE toggle (◀/▶ walk the ★ / SYNC TO TV / ★ / CLOSE row) |

- **Views (tabs under the ★ row, live/final games only):** football **FIELD | BOX SCORE**; baseball **AT BAT + BOX SCORE |
  PLAYS & STATS**; hockey/basketball **GAME | BOX SCORE**. Pre-game and soccer have no tabs (classic layout). The tab sets a
  class on `#gamecast` (`gcv-field`, `gcv-box`, `gcv-mlb`, `gcv-plays`, none = classic) and a CSS grid rearranges the same blocks,
  so every block keeps updating on each poll while hidden. The chosen tab survives polls and ◀/▶ game switches; it resets on close.
  - FIELD: real-proportion field (SVG viewBox 120 × 53.3 yd, `meet`, never stretched) + linescore, win prob, last plays.
  - BOX SCORE: linescore + team-stat bars | **LIVE BOX SCORE** (`gcBoxScoreHtml`): away | home side by side. NFL/CFB passing,
    rushing, receiving (TEAM totals), defense, INTs, fumbles, kicking, punting, returns; MLB batting AB R H RBI BB K AVG (subs
    indented) + pitching IP H R ER BB K PC; NHL skaters G A SOG(+/-) HT BS TOI + goalies SA SV GA SV% TOI (ESPN's NHL `S` label is
    shots on goal; its `SOG` column is always 0); NBA MIN PTS REB AST FG 3PT STL BLK.
  - MLB AT BAT + BOX SCORE: big strike zone + pitcher/batter + bases/outs + pitch list (newest first) next to linescore + box score.
  - The box score and team stats are patched in place (`gcMorph`: only changed text/attributes are touched, logos kept), and
    `gcSet` keeps every panel's scroll position, so the 10 s poll never flickers or jumps.
- **Content:** a scoreboard with logos, records, score, period/clock and status. It also shows the in-game situation:
  - football: possession, down and distance, red zone
  - MLB: count, bases, outs, batter vs pitcher
  - NHL: shots on goal
  - NBA: FG%
  - soccer: possession

  Below that: a linescore (MLB adds R/H/E), a **WIN PROBABILITY** panel (redesigned in flynn/props-fixes: headline
  "CANES 72% CHANCE TO WIN" in the favorite's color, both team logos with big %s, a two-color bar in team colors, and
  "▲ TEAM +8% LAST 10 PLAYS" trend; pregame it uses ESPN's matchup predictor, labelled ESPN PREGAME; no ESPN win probability →
  the panel is hidden, pregame line only shows as GAME LINE; the old unlabeled sparkline was dropped), **sport trackers** (NFL/CFB horizontal field with end zones/logos, ball, line-to-gain, possession arrow, red-zone
  shading and drive path; MLB strike-zone box with numbered pitch dots colored ball/strike/in-play, pitch list with type+mph,
  count, outs and base diamond — both update on the 10 s poll, SVG/simple DOM, degrade if fields missing), the last 6 plays,
  every team stat as comparison bars, top performers, and box-score tables (NBA/NFL/NHL/MLB from `boxscore.players`, soccer
  from `rosters`). Upcoming games show season stats/leaders, venue, weather, probables and the line. Missing blocks are simply
  left out.
- **Polling:** one summary request every **10 s** (start to start) while open. The previous request is aborted first, so
  requests never overlap, and each one times out after 8 s. After 3 failures in a row the gap backs off to 20 s, then 30 s,
  and the header shows **⚠ RECONNECTING… LAST UPDATE h:mm:ss** while the last good data stays on screen. Otherwise the
  header shows **UPDATED h:mm:ss** (`· LIVE 2s` while the fast loop below is healthy on a live game).
- **Fast score loop (live games only):** `gcFastTick` fetches the single-event scoreboard every **2 s** (one request at a
  time across both loops, 4 s timeout, error backoff 4→8→16→30 s, stops when the page is hidden, the game is final or the
  Gamecast closes). A change in score, period, state, football situation/last play, or baseball count/outs/bases pulls the
  summary immediately (`gc.trigAt`), and `gc.chase` re-polls the summary every 2 s for up to 20 s until it shows the same
  score/period/state. Replies that are *behind* what was already seen (state, period, total score, countdown clock going
  back up) are ignored: ESPN's CDN edges disagree for a few seconds after a change (seen live: `in → pre → in`, clock
  17:32 → 17:51 → 17:32).
- **How fresh ESPN is (measured live, NHL, Oct 9 2026):** the scoreboard publishes on a **~10 s cycle** (the game clock in
  it jumps every 10 or 20 s; it does not tick), and `site.api` runs **~2–5 s behind** `sports.core.api …/status`. The
  summary header follows the scoreboard; the summary's **play list runs ~30–100 s behind live** (play `wallclock` vs when
  it appeared). So the 2 s loop gets a change within ~2 s of ESPN publishing it, but ESPN itself is the limit.
- **Memory:** only the latest response is parsed. It isn't stored and is released once rendered. The DOM is only rewritten
  when a block's markup changes, and the overlay's DOM is emptied on close. One 60 ms scroll timer runs, and only while open.
- **Auto-close:** a finished game closes itself after 10 min with no input. An upcoming game closes after 30 min idle.
  Live games stay open until closed.
- Moving the mouse shows the cursor for 3 s (it's still `cursor: none` when idle), so clicks are possible on a desktop.

### Score celebrations (full-screen team moment)

- **Turn it on:** open any NHL / NFL / college football / MLB game in the Gamecast and press OK on **★ CELEBRATE <TEAM>**
  under either team (or both). It turns yellow (ON). The choice is saved per team in `localStorage.ahlersCelebrateTeams1`
  (`"<league>:<ESPN team id>"`). The master switch **Score Celebrations** (settings, default ON) turns everything off.
- **Delay:** 0–60 s in 1 s steps. Remembered **per broadcast** in `localStorage.ahlersArcadeTvDelay`
  (`{ src: 'cable'|'stream', nets: { 'ESPN|cable': 18, ... } }`, key = first broadcast in the Gamecast header + the
  CABLE/STREAMING choice). `gcDelay()` uses that, else the Settings default (`settings.celebrateDelay`, ◀ / ▶ on the delay
  row, an advanced option). The Gamecast bar only shows **📺 SYNC TO TV 18s**; fine-tune (−1s / +1s), TEST and the
  CABLE/STREAMING switch live inside the sync overlay. A score is detected right away and the effect is queued until
  `gc.trigAt` (when the 2 s loop first saw it) + delay. Queued events
  are dropped if the score is corrected down or the Gamecast is closed (events found by the 5-min scoreboard refresh are
  dropped on a correction).
- **What fires:** only a score that goes *up* between two polls (never on first load, and never again after a correction
  back up). Debounced per game (20 s, except touchdowns/wins). Hockey/soccer **GOAL!!**. Football **TOUCHDOWN!!** (+6),
  **FIELD GOAL!!!** (+3), **SAFETY!** (+2, unless it's a two-point try just after a TD). PAT +1 doesn't fire. Baseball
  **HOME RUN!!** (from the latest play text) or **RUN SCORES!** / **N RUNS SCORE!**. Win: **<SHORT NAME> WIN!!** (e.g. CANES WIN!!).
  Smaller, shorter moments for **HALFTIME!**, **END OF PERIOD** / **END OF QUARTER** and **FINAL** (a toggled team that
  didn't win). Basketball doesn't fire on baskets.
- **Look:** team-colour wash and strobe, swinging light beams, a light sweep, three huge scrolling marquee rows of the
  banner text, shake + zoom-punch logo, pulse rings, CSS confetti. CSS transform/opacity only, no sound. Any remote
  key or a click dismisses it (the key isn't passed on). Back closes it first.
- **Scorer:** scoring celebrations show the player when the summary has a *new* scoring play for that team: name in the
  marquee (`GOAL!! ★ SEBASTIAN AHO`) plus a headshot card with assists (NHL) or "PASS FROM …" (football). The name comes
  from `participants` (NHL/MLB plays) or the scoring-play text (football). The headshot comes from the feed, the boxscore
  athlete, or `a.espncdn.com/i/headshots/<league>/players/full/<id>.png`. With no player found, only the team logo shows.
- **Effects level:** **Lite** is the default (Settings → *Full Effects* off), and the TV app (`window.ArcadeTV`) and
  `prefers-reduced-motion` always use it. It keeps Full's colours: the Full layout frozen as a static frame: top + bottom glowing 'GOAL!! ★ PLAYER' strips (transform scroll), huge outlined
  name behind the center, logo + headshot card + score bar, ring + star outline, red wash, small static shard/dot accents.
  Motion is cheap and loops 3x over the show: strip scroll, logo scale-in then a slow beat, a soft white flash + glow
  and a ring pulse each loop. No strobe, falling confetti, shake, beams, sweep, or animated filters. **Full** is the original 3-strip strobe/confetti/shake version. Headless Chrome
  (software compositing, frames from 0.5–3.5 s): Lite goal/TD 60/60 fps at 1x and 60/59 fps at 6x CPU throttle; Full about
  11–16 fps.
- **Timing (Oct 2026, Jordan's onn-box feedback):** every celebration AND every alert banner stays on screen **9 s**
  (`CEL_MS` = `CEL_BIG_MS` = `CEL_MINI_MS` = `CEL_ALERT_MS` = 9000). Every pulse loops `CEL_LOOPS` = 3 times in that
  span: celShow sets `--cel-ms`, `--cel-loop` (ms/3 = 3 s) and `--cel-half`, and alerts get `--al-ms` / `--al-loop`.
  - **Lite:** the flash/glow, ring pulse and logo beat each run 3 × 3 s.
  - **Full:** 3 × 3 s flash+glow cycles, with 1.5 s beam swings, 3 s rings/sweep and a 1.5 s beat.
  - **Banners:** the shine sweep and logo beat run 3 × 3 s.
  - **Fades:** each fades in over the first 2–3 % of its time and out over the last 4 %, so it is still fully visible at 8.5 s.
  - **Strips:** they scroll at a fixed calm speed whatever the text length (text length × 220 ms, outline row × 650 ms).
  - **Queueing:**
    - Up to `CEL_Q_MAX` = 3 celebrations and 4 banners wait their turn, with 0.35 s / 0.3 s gaps. GOAL → TD → WIN plays about 9.35 s apart.
    - A banner waits while a celebration shows.
    - A banner cut off in its first half by a celebration is replayed afterwards.
    - Anything still queued after `CEL_STALE_MS` (60 s) is dropped.
  - **Test:** `node tools/test-celebrate-timing.mjs [preview.html]` emulates the TV bridge at 720p and checks all of this, plus player photos. It saves frames at 0.5 / 4.5 / 8.5 s.
- **Turnovers (football, full-screen):**
  - **What fires:**
    - **INTERCEPTION!!** and **FUMBLE!!** come from drive plays with `isTurnover: true`. The team that gains the ball is the play's `end.team`; failing that, the defence.
    - **TURNOVER ON DOWNS!** comes from a drive with `result: "DOWNS"`, once per drive, for the defence.
    - **BLOCKED PUNT!! / BLOCKED FG!!** come from the play type or text "blocked". They count for the defence even when the kicking team recovers.
    - Pick-sixes and scoop-and-scores are scoring plays, so they show as the touchdown, retitled **PICK SIX!!** / **SCOOP & SCORE!!**.
    - Safeties were already a score celebration (**SAFETY!**).
  - **Who sees it:** only a ★ team that *gains* the ball, so losing a fumble shows nothing.
  - **Settings:** each type has a switch (`alertInt`, `alertFumble`, `alertDowns`, `alertBlock`, default ON). They use the same delay and master switch, and each play id fires once.
  - **Coverage:** like the other play-by-play alerts, turnovers only come from an open Gamecast.
  - **Removed:** the old small INTERCEPTION! / FUMBLE RECOVERED! banners under Big Plays are gone.
- **Player photos everywhere a player is involved:**
  - **Celebrations** use the approved Aho card (headshot + name tag + detail line):
    - goal scorer / TD scorer / FG kicker / HR hitter, from the scoring play (as before)
    - interceptor ("PICKS OFF <QB>")
    - fumble recoverer ("FORCED BY …")
    - punt/FG blocker
  - **Banners** get a round headshot + name chip:
    - big-play receiver/rusher
    - MLB double/triple batter
    - the player who drew the power play
    - the go-ahead scorer on a lead change
  - **Name matching:** names come from the play text (NFL `RECOVERED by SEA-D.Hall`, CFB `intercepted by #0 T.Cooley`, full names) via `celTxName`. They are matched to that team's `boxscore.players` athletes: full name, or initial + last name, unique matches only. The headshot is the athlete's `headshot.href`, or `a.espncdn.com/i/headshots/<league>/players/full/<id>.png`.
  - **Fallbacks:** with no match, the name shows without a photo next to the team logo. A missing image hides itself. WIN / HALFTIME / red zone / game start keep the team-logo layout.
- **Field goals** are held back 5 s on top of the delay, so a FG never shows before a TD would be known.
- **Alerts (smaller banners)** for ★ teams use the same delay and the master switch, and each type has its own switch
  in settings (`alertRedzone`, `alertPP`, `alertStart`, `alertLead`, `alertBig`, default ON):
  **RED ZONE!** (football, once per drive, from the drive's yards-to-endzone), **POWER PLAY!** (NHL, for the team
  whose opponent took a minor/major penalty, once per penalty play), **PUCK DROP! / KICKOFF! / FIRST PITCH! / TIP-OFF!**
  (pre → in), **<TEAM> TAKE THE LEAD!** (from the high-water scores, so corrections can't re-fire it), **BIG PLAY! N YDS**
  (25+ yd pass/run), **DOUBLE! / TRIPLE!** (MLB); turnovers are full-screen now (above). The
  play-by-play alerts only come from an open Gamecast. Start and lead change also come from the 5-min scoreboard refresh.
  A banner waits while a full celebration is showing, then follows it.
- **SYNC TO TV (`gsOpen`, overlay `#gc-syncov`):** one guided flow. Hockey / football / basketball with a running clock:
  it picks a whole second **8 s ahead** of ESPN's (interpolated) clock and shows **PRESS OK WHEN YOUR TV CLOCK SHOWS 8:42
  2ND PERIOD**. The fast loop finds when ESPN's data reached it (first reading at/below it, extrapolated back), the user's
  OK gives the TV time, delay = OK − ESPN time (0–60 s, rounded to 1 s, saved for this channel). Result: **SYNCED · TV is
  18s behind · celebrations wait 18s**. OK before ESPN gets there → it waits for ESPN, then **TV is Ns AHEAD … show right
  away** (0 s). Clock not running (timeout, intermission; no change for 45 s) → **CLOCK STOPPED**, waits for it to run, or
  **USE A PLAY INSTEAD**. Baseball / soccer (no running clock) and the fallback use events from the 2 s loop: the next
  score (hockey/basketball/soccer), football play, or baseball pitch/count appears big with "ESPN saw it at h:mm:ss"; OK
  when the TV shows it. Summary plays are not used as anchors (they lag ~30–100 s). End of period (< 20 s, < 60 s in
  basketball) asks to wait. A bare OK in the overlay presses the big OK; the overlay keeps its focus while you watch the TV
  (no 10 s nav idle); BACK closes only the overlay. The FG hold-back still adds its 5 s.
- **Preview:** console `arcadeCelebrate('goal' | 'td' | 'fg' | 'run' | 'hr' | 'win' | 'half' | 'period' | 'test')`,
  `arcadeCelebrate('redzone' | 'pp' | 'start' | 'lead' | 'big' | 'alerts')` for the banners, the
  **★ PREVIEW** button in settings, or open the page with `?celebrate=td` (etc.). `test` plays GOAL → TD → WIN.
- Performance note: marquee strips are only just over a screen wide. Long strips with glow text dropped software rendering
  to about 4 fps.

- *App shell?* Done: the thin WebView app in `tvapp/` (§9) loads this same live page, keeps the screen on and routes
  BACK / MENU / Play-Pause into `arcadeNav`. The page still works the same in a plain browser.

---

## 6. Must not break (checklist for every change)

- [ ] Page loads with **zero console errors** (apart from the known issues in §7) and no uncaught exceptions
- [ ] The 12 ESPN scoreboard fetches run on load and every 5 min, and each league toggle still works
- [ ] Ticker: LIVE NOW / UPCOMING head, logos, scores, status, marquee message, seamless infinite scroll, speed 1-10
- [ ] Clock top-left (`h:mm AM/PM`, local time), hidden only during trivia
- [ ] Settings gear top-right with focus outline. `s` / ContextMenu / Menu / Settings keys toggle the modal. Enter on the focused gear works.
- [ ] Every settings control persists to `localStorage.ahlersArcadeSettings` and takes effect (toggles, favourite teams, marquee, speed)
- [ ] Broadcast wipe + lower third on every slide change, never over Gamecast/celebrations, no wipe on the phone remote page
- [ ] Pick'em: slide fits above the ticker, picks lock at start, phone remote round trip (`tools/test-pickem.mjs`)
- [ ] Headlines: photo hero rotates, fits above the ticker, no Ken Burns in the TV app (`tools/test-news.mjs`)
- [ ] Slide rotation order and the skip-if-disabled logic. `live` always shows. No slide cut short (`tools/test-rotation.mjs`).
- [ ] Every "advance later" uses `slideTimer = slideTimeout(fn, ms)` (cancels the previous timer, gen-guarded), never a raw `setTimeout` into `slideTimer`
- [ ] Each slide renders its data or its empty-state message ("NO LIVE GAMES", "NO UFC CARD", "… FEED DOWN", etc.) and advances
- [ ] Auto vertical scroll of long slides (hold 4 s / 22 px/s / hold 5 s) and the min 16 s dwell
- [ ] Live cards: MLB count/bases/outs, football down & spot, win-probability bar, records for upcoming games, lines/TV
- [ ] Trivia: 15 s countdown bar, correct answer turns green, wrong ones dim, then the next question is fetched
- [ ] Command Center: Greenville NC weather + 2 marquee matchups
- [ ] TV guide network logos, news thumbnails, futures, rankings with records, standings grouped by division/conference
- [ ] Image `onerror` fallbacks (default team logo / default headshots)
- [ ] Neon theme cycles per slide (cyan → pink → green) via CSS variables
- [ ] `cursor: none`, no scrollbars, layout fills 16:9 at 1920x1080 and 1280x720
- [ ] `#remote` mode shows the NEXT SLIDE controller and hides the TV view
- [ ] localStorage migrations (old `mySquadTeams` values, removal of `oddsApiKey` / `ahlersPropsCache`)
- [ ] Score celebrations: ★ toggles in the Gamecast, master switch + 0–60 s default delay in settings, fire only on increases,
      any key dismisses. Alerts: once per situation, per-type switches. SYNC TO TV sets the per-channel delay
      (`tools/test-celebrate.mjs`)
- [ ] Gamecast fast loop: 2 s single-event scoreboard only while live + visible, one request at a time, change → summary
      at once, backoff, stops when hidden/final/closed (`tools/test-fastloop.mjs`)
- [ ] No API keys or secrets added; every new API is free, no-key and CORS-enabled
- [ ] NFL FUTURES / NFL AWARDS / CFB FUTURES / NHL FUTURES slides populate, showing the 'UPDATED' time from futures.json, (from futures.json, or the live fallbacks) and can be toggled in settings
- [ ] Idle kiosk shows **no** nav UI; ◀/▶, OK menu, Back, Play/Pause and auto-hide all work (harness remote checks)
- [ ] Mouse click on the gear opens settings; SAVE & CLOSE closes it
- [ ] Sport mode: OFF/CFB/CBB/NFL in settings, only that sport for 12 h, pill with time left, survives reload, auto-reverts
      to the snapshot, never an empty rotation (`tools/test-sportmode.mjs`)
- [ ] NFL FANTASY slide: projections + pickups from `fantasy.json` (or ESPN fallback), live PPR only while it shows (`tools/test-fantasy.mjs`)
- [ ] Gamecast opens from a Live Action card / ticker click and from the navigator GAMES row (D-pad). It pauses rotation,
      polls every ~10 s (plus the 2 s check on live games) with no overlapping requests, shows RECONNECTING on failure, and closes with Back/Esc/✕. Closing
      stops every timer and request and resumes rotation (`tools/test-gamecast.mjs` + harness checks).

---

## 7. Known pre-existing issues (documented, not yet fixed)

| # | Issue | Effect |
|---|---|---|
| 1 | ✅ *Fixed in PR #2 (no longer called; names come from ESPN core $refs).* **ESPN `/teams?limit=400` sends no `Access-Control-Allow-Origin`** (200 to curl, but browsers block it) | 5 console CORS errors per futures build (once / 24 h on the TV). `loadTeamMap()` falls back to the hard-coded NFL/NBA/MLB/NHL maps. **CFB has no fallback, so "CFB TITLE" never renders.** |
| 2 | ✅ *Fixed in PR #2.* Futures market matching used `name` and `new Date().getFullYear()` | NBA title also missing (on 2026-10-07 only SUPER BOWL, WORLD SERIES, STANLEY CUP rendered). ESPN files upcoming NBA/NHL seasons under next year. |
| 3 | ~~**Rotation skips a slide around trivia.**~~ **FIXED** (PR reliability): `showTrivia()` increments `rotationStep` itself, then `nextSlide()` increments again | After a normal trivia slide, **leaders** is skipped. When trivia isn't loaded yet, leaders shows but **PGA** is skipped. (The harness saw PGA skipped when OpenTDB returned 429.) |
| 3b | ~~**Slide after Trivia flashes for ~1.5 s (TV, Oct 2026).**~~ **FIXED** in flynn/props-fixes | Trivia sets no slide timer until its 15 s reveal, so `nextSlide()`'s 1.5 s safety net scheduled a 20 s advance; the reveal then *overwrote* `slideTimer` with its 5 s timer without cancelling it. Trivia ended at 20 s, the orphan fired at 21.5 s, cutting the next slide (leaders) to ~1.5 s. Fix: `slideTimeout()` (cancel-then-set + slide-generation guard) for all 27 slide timers, safety net gen-guarded and skipped while trivia's reveal is pending. Regression: `tools/test-rotation.mjs`. |
| 4 | ~~Hung-fetch freezes rotation~~ | **Fixed** in reliability: `arcadeFetch` 9 s AbortController + 90 s slide watchdog |
| 5 | ✅ *Fixed in PR #2.* Gear click/tap double-toggles (§5) | The gear only works from the keyboard/remote |
| 6 | ✅ *Fixed in PR #2 (D-pad navigation).* No Back/Escape/arrow handling (§5) | Hard to drive with a D-pad |
| 7 | `BroadcastChannel` phone remote is same-device only | The QR "remote" doesn't reach the TV |
| 8 | Weather code mapping is coarse | fog (45/48) shows CLEAR; showers 80-82 and thunder 95+ show "SNOW/STORM" |
| 9 | Settings toggles `cfb75` and `clb50` aren't read anywhere | no effect |
| 10 | Every 5-min refresh rewrites `#ticker-track` | the ticker jumps back to the start every 5 min |
| 11 | API strings and the marquee message are injected with `innerHTML` unescaped | low risk (trusted sources), but a stray `<` in data could break the layout |
| 12 | Tailwind Play CDN loaded but unused (§4) | console warning + runtime CPU on the TV |
| 13 | `settings = defaultSettings` aliases the defaults object when nothing is saved | harmless today |
| 14 | No favicon, so the browser's automatic `/favicon.ico` request 404s | cosmetic |
| 15 | ✅ *Fixed in PR #2.* Typing `s`, `r` or `]` in a settings text field toggled the modal closed | couldn't type team names containing those letters |

### Baseline test results (current `index.html`, 2026-10-07 ~6:55 PM ET)
- **PASS** with known issues: 0 new console errors, 0 page errors, 1 warning (Tailwind CDN production warning).
- **OK:** all 15 ESPN scoreboards (12 ticker + PGA + UFC + soccer re-fetch), 5 standings, CFB rankings, 7 ESPN core
  futures calls, Open Trivia DB, rss2json (Yahoo + CBS), QR Server, Google Fonts, Tailwind CDN. 371 images OK, 16
  headshot 404s handled by fallbacks.
- **Known failure:** ESPN `/teams` × 5 (CORS, issue 1).
- **Environment only:** Open-Meteo returned 429 "Daily API request limit exceeded" from the box's shared IP on the first
  runs, then succeeded (72°F). OpenTDB returned 429 when two runs went back to back.
- All smoke checks passed. The cycle reached all 18 slides.

---

## 8. Roadmap (proposed)

Small, incremental steps. Each one keeps every §6 item working and goes through preview → test → PR.

> **Next phase (Jordan, 2026-10-07): package the site as an Android TV APK, built up step by step as a thin WebView
> app.** Step 1: a WebView shell that loads the GitHub Pages URL full-screen. It keeps the screen on, starts on boot,
> passes the D-pad and Back keys through to the page (the JS already accepts raw Android key codes), and sets a normal
> Chrome user agent. Later steps: an offline/error screen, an optional bundled copy of index.html, and auto-update from
> Pages. Keep the page light for low-RAM TV boxes: Gamecast keeps no response history, polls one request at a time and
> frees its DOM on close. Dropping the Tailwind CDN (item 6) and the nightly reload (item 4) help here too. (The old
> `android-tv/` folder stays untouched; the new shell should be its own fresh folder/PR.)
>
> ✅ **Step 1 shipped (PR #5, `tvapp/`, pre-release `tvapp-v0.1.0`):** see §9 for what v0.1.0 does, how to install it,
> and the next increments.

1. ✅ **(PR #2) D-pad remote navigation (Android TV).** Visible focus ring. ←/→ = previous/next slide. OK/Enter (or Menu) opens an
   on-screen menu to jump to a section and pause/resume rotation. Back/Escape closes the menu or modal. The menu auto-hides
   after inactivity, so the idle kiosk looks the same as now. Also fixes issues 5 and 6.
   *App shell?* Start in the browser, because it works in any wrapper. A **TWA** needs Chrome installed on the TV, which
   most Android TV devices don't ship, so it isn't worth it. A **thin WebView wrapper** is worth it only if the TV browser
   steals Back/Menu keys, sleeps the screen, or can't auto-start on boot. The wrapper would give guaranteed key delivery,
   keep-screen-on, boot launch and true fullscreen. (There's an old `android-tv/` folder + workflow in the repo. It's
   deliberately untouched and wasn't analysed.)
2. ✅ **(PR #2) NFL + college football futures/awards odds slides.** Super Bowl, conferences, divisions, MVP/OPOY/DPOY/OROY/DROY/
   Comeback/Coach of the Year; NCAAF title, Heisman, CFP, conferences. Data source comes from the separate research
   thread. This step also fixes issues 1 and 2 for the existing futures slide.
2b. ✅ **(PR #4) Gamecast.** Full-screen live game overlay from the Live Action cards, the ticker or the navigator's GAMES
   row. It shows the scoreboard, situation, linescore, win probability, last plays, full team stats and box-score player
   stats, polls every 10 s, and has reconnecting and auto-close behaviour (§5).
3. ✅ **Resilience + kiosk** (PR reliability / Gamecast trackers). 9 s `arcadeFetch`, 90 s slide watchdog, trivia skip fix,
   last-good scoreboard cache + STALE/OFFLINE pill, Screen Wake Lock (re-acquire on visibilitychange; no-op if unsupported /
   ArcadeTV), ~4 AM soft reload only if no Gamecast and not ArcadeTV.
4. **Kiosk leftovers.** Favicon (issue 14).
5. **Smarter live data.** Refresh every 60 s while games are live (5 min otherwise), fetch the 12 scoreboards in parallel,
   and update the ticker without restarting its scroll (issue 10).
6. **Performance.** Drop the unused Tailwind Play CDN and inline only the Preflight rules the page depends on.
   Confirm pixel parity with `--compare`.
7. **Visual polish.** Cross-fade slide transitions, a score-change flash, a thin slide-progress bar, and a live-game count badge
   in the ticker head.
8. **Better free data.** (Done in flynn/headlines: news now comes from ESPN's no-key news JSON.) Improve the weather
   mapping (issue 8) and add a 3-day forecast from the Open-Meteo call the page already makes.
9. **Fix the rotation skip** (issue 3) so leaders and PGA show every cycle. This changes visible behaviour, so it needs Jordan's OK.
10. **Phone remote that actually works** (issue 7). It needs a relay (e.g. a tiny free worker), so it comes later and is optional.

---

## 9. Android TV app (`tvapp/`)

A thin, memory-light Android TV wrapper around the **live** site. It loads
<https://ajersj-cmyk.github.io/arcade-challenge/>, so every change merged to `main` shows up on the TV on the next
load. **You never need to reinstall for site changes.** Reinstall only when the app itself changes (new `tvapp-v*` release).

### Install / update on the TV (sideload)

Latest APK (v0.2.0 "Arcade Scoreboard", about 140 KB):
<https://github.com/ajersj-cmyk/arcade-challenge/releases/download/tvapp-v0.2.0/ahlers-arcade-tv-0.2.0.apk>
(release page: <https://github.com/ajersj-cmyk/arcade-challenge/releases/tag/tvapp-v0.2.0>; previous:
[v0.1.0](https://github.com/ajersj-cmyk/arcade-challenge/releases/tag/tvapp-v0.1.0)). Same package and signing key, so
v0.2.0 installs straight over v0.1.0.

**Option A: the Downloader app (no computer needed)**
1. On the TV, install **Downloader** (by AFTVnews) from the Play Store / Amazon Appstore.
2. Allow it to install apps: *Settings → Apps → Security & restrictions → Unknown sources → Downloader → On*
   (Google TV: *Settings → System → Developer options / Apps → Install unknown apps*; Fire TV: *My Fire TV → Developer
   options → Install unknown apps*).
3. Open Downloader, type the APK link above into the URL box, press **Go**, then **Install** → **Done**.
   (Tip: make a short link to that URL first, e.g. with any URL shortener or an AFTVnews short code, so there's less
   to type with the remote.)
4. Open **Arcade Scoreboard** from the apps row (neon ARCADE / LED SCOREBOARD banner; it was called *Ahlers Arcade* in
   v0.1.0). Long-press it to move it to favourites.

**Option B: ADB from a computer on the same Wi-Fi**
1. TV: *Settings → Device Preferences → About → Build*, press OK 7 times to enable Developer options. Then turn on
   *Developer options → USB debugging / Network debugging*. Note the TV's IP (*Settings → Network*).
2. Computer: `adb connect <tv-ip>:5555`, accept the prompt on the TV, then
   `adb install -r ahlers-arcade-tv-0.2.0.apk`.

**Updating:** install the newer APK the same way. Every build is signed with the same key, so it installs over the
old one and keeps the site's settings (localStorage). If the TV says "App not installed", an older build signed
with a different key is on it: uninstall it first. The legacy `android-tv` APK is a different app
(`com.ahlersarcade.tv`) and can stay or be uninstalled. The new one is `com.ahlersarcade.tvapp`.

### Using it

| Remote key | What it does |
|---|---|
| D-pad / OK | goes straight to the page (`arcadeNav`: ◀/▶ slides, OK menu, GAMES row, Gamecast…) |
| **BACK** | closes whatever is open on the site first (Gamecast → navigator menu → settings). If nothing is open, a small dialog appears: **press BACK again to exit**, or pick *Keep watching / Exit / Reload scoreboard / Launch on boot ON-OFF*. The dialog closes itself after 15 s. |
| Play/Pause (and Play, Pause) | pause / resume slide rotation (same as the site's Play key) |
| ⏩ / ⏭  and  ⏪ / ⏮ | next / previous slide (or next / previous game inside Gamecast) |
| MENU (if the remote has one) | opens the site's settings |

- **Offline:** if the page can't load, a neon **SIGNAL LOST** screen shows the reason and retries automatically
  (5 s, 10 s, 20 s, 30 s, then every 60 s). It also retries as soon as the network comes back. OK = retry now.
  Once the page has loaded, API outages are handled by the page itself (feed-down states, Gamecast RECONNECTING).
- **Launch on boot (optional, off by default):** BACK → *Launch on boot: ON*. On Android 10+ the system only lets an
  app start itself at boot if it may *display over other apps*. The toggle opens that settings screen when the TV has
  one. If it doesn't (common on Google TV), grant it once from a computer:
  `adb shell appops set com.ahlersarcade.tvapp SYSTEM_ALERT_WINDOW allow`.
  Android 7-9 boxes and most Fire TVs need nothing extra.

### What's new in v0.2.0 (Arcade Scoreboard look)

- App label is now **Arcade Scoreboard** (package `com.ahlersarcade.tvapp` and the signing key are unchanged, so it
  updates in place and keeps the site settings). versionName 0.2.0, versionCode 2. The WebView UA token stays
  `AhlersArcadeTV/<version>` so any site-side detection keeps working.
- New neon art, all generated from SVG by `tvapp/art/build.mjs` (sources in `tvapp/art/svg/`; design code in
  `tvapp/art/design.mjs`). It replaces the old `tvapp/tools/make_art.py`:
  - Leanback banner `drawable-xhdpi/tv_banner.png` (320×180): pink neon-tube **ARCADE** (Russo One outline with a
    white-hot core), amber 5×7 LED dot-matrix **SCOREBOARD** panel, cyan tube frame with marquee bulbs, synthwave floor.
  - Launcher icons `mipmap-{mdpi…xxxhdpi}/ic_launcher.png` (48–192 px): the banner in miniature (neon "A", bulbs, cyan frame).
  - Adaptive icon for API 26+ (`mipmap-anydpi-v26/ic_launcher.xml` + `ic_launcher_round.xml`): foreground
    `mipmap-xxxhdpi/ic_launcher_foreground.png` (cyan ring + "A" inside the 66 dp safe zone, so circle, squircle and
    square masks all look right; also used as the monochrome layer), background `ic_launcher_background.webp`.
    `android:roundIcon` points at it too.
  - Wordmark `drawable-xhdpi/logo_wordmark.webp` (600×250 px = 300×125 dp, opaque on the splash colour `#06041A`).
- Start-up: the starting window (`drawable/splash_window.xml`, Android 7–11) shows the wordmark instead of black;
  Android 12+ shows the system splash with the adaptive icon on `#06041A` (`values-v31/themes.xml`).
- A freshly created WebView (cold start, return from background after the low-RAM teardown, renderer-crash rebuild)
  shows a **LOADING SCOREBOARD…** screen with the logo until the page first paints (`onPageCommitVisible`, or
  `onPageFinished`, or the offline screen, or a 25 s safety timeout). It is never focusable, so remote keys still reach
  the page. Plain reloads (nightly 4 AM, *Reload scoreboard*) don't show it: the old page stays on screen until the new one paints.
- The SIGNAL LOST screen uses the logo as its header (was the text "AHLERS ARCADE"); exit dialog says *Exit Arcade Scoreboard*.
- Images are palette-compressed (pngquant) / WebP, so the APK only grew ~10 KB (≈ 140 KB).
- Re-generating the art: `node tvapp/art/build.mjs` from the repo root (needs headless Chrome, `puppeteer-core`
  (`PUPPETEER_FROM=<a package.json whose node_modules has it>`, defaults to the site's `tools/`), Pillow, the Russo One
  font, and optionally `pngquant`).

### What v0.1.0 does (technical)

- Plain Java, framework APIs only (no AndroidX, no Kotlin, no libraries). Release APK ≈ 130 KB after R8.
  `minSdk 24` (Android 7), `targetSdk/compileSdk 37`. AGP 9.4.1, Gradle 9.8.1 wrapper, JDK 17.
- Leanback launcher entry + 320×180 banner, plus a normal launcher entry so it also works on Fire TV and phones. (v0.1.0
  art came from `tvapp/tools/make_art.py`; since v0.2.0 it's `tvapp/art/build.mjs`, see above.)
- One `Activity`, one `WebView` (built in code, no layouts). Landscape, immersive fullscreen, `FLAG_KEEP_SCREEN_ON`,
  hardware acceleration. `singleTask`, and handles every config change itself, so HDMI/resolution changes don't reload the page.
- WebView: JavaScript, DOM storage (settings persist), media autoplay without a gesture, `LOAD_DEFAULT` HTTP caching,
  mixed content `COMPATIBILITY_MODE` (cleartext traffic off), text zoom pinned at 100 % (the layout is vh-based),
  file/content access off, no zoom, metrics opt-out, a blank default video poster (no grey play icon). The user agent is
  the stock WebView UA + ` AhlersArcadeTV/0.1.0`. WebView debugging (chrome://inspect) is on in **debug** builds only.
- Navigation is locked to `ajersj-cmyk.github.io`. Other links open in the app that owns them (e.g. YouTube), or are ignored.
- BACK: `OnBackInvokedCallback` on Android 13+ (apps targeting 16+ no longer get `KEYCODE_BACK`), and the key path on
  older versions. Both call the page's `navBack()` (which returns true when it closed something) via `evaluateJavascript`.
  If the page doesn't answer within 700 ms, the exit dialog shows anyway, so a hung page can't trap you.
  Media keys and MENU are sent as synthetic `keydown` events (`MediaPlayPause`/179, `ArrowLeft/Right`, `ContextMenu`).
- JS bridge `window.ArcadeTV`: `isTvApp()`, `version()`, `getLaunchOnBoot()`, `setLaunchOnBoot(bool)`, `exitApp()`.
  The site doesn't use it yet. It's there so a later site change can show the boot toggle in its own settings.
- Low RAM: `onStop` pauses the WebView and its JS timers (no polling while another app is in front). `onTrimMemory`
  drops the in-memory cache while visible (and fires a `arcade-lowmem` window event the page can listen for). Once the
  app is in the background it **destroys the WebView entirely** and rebuilds it on return. The renderer is marked
  "waived when not visible". A renderer crash or OOM kill (`onRenderProcessGone`) rebuilds the WebView instead of
  crashing the app, and after 3 crashes within a minute it shows the offline screen. A nightly reload around 4 AM
  (if the page has been up 6 h+) clears slow leaks on 24/7 runs.
- Boot: `BootReceiver` is **disabled in the manifest** and only enabled when the toggle is on, so it costs nothing when off.

### Build

- **CI:** `.github/workflows/tvapp.yml` runs on pushes to `main` / `flynn/tv-app` / `flynn/tvapp-*` that touch `tvapp/**`, and on
  *Run workflow*. It runs `assembleRelease` + `lintRelease`, checks the APK with `aapt2` (leanback entry) and `apksigner`,
  and uploads the **`ahlers-arcade-tv-apk`** artifact (kept 90 days).
- **Signing:** a self-signed release key (`CN=Ahlers Arcade TV`, RSA 3072, valid 50 years, SHA-256
  `7D:07:2C:A2:…:DF:3A:43`). It's stored as repo secrets `TVAPP_KEYSTORE_B64`, `TVAPP_KEYSTORE_PASSWORD` and
  `TVAPP_KEY_PASSWORD` (key alias `arcade`), plus a copy on Flynn's box (`~/android-dev/keys/`, never committed).
  **Losing the key means the next APK can't update the installed one** (uninstall/reinstall, and the site settings
  reset), so keep a backup. Without the secrets (forks), Gradle falls back to the debug key.
- **Local:** JDK 17 + Android SDK (`platforms;android-37.0`, `build-tools;37.0.0`), then
  `cd tvapp && ./gradlew assembleRelease` (export `TVAPP_KEYSTORE`, `TVAPP_KEYSTORE_PASSWORD`, … to sign with the
  release key). Output: `tvapp/app/build/outputs/apk/release/ahlers-arcade-tv-<version>-release.apk`.
- **Releasing a new version:** bump `appVersionName` / `appVersionCode` in `tvapp/app/build.gradle.kts`, merge, let the
  workflow build it, then attach the artifact APK to a new pre-release tagged `tvapp-v<version>`. (v0.2.0 was built on
  Flynn's box with the same release key, verified with `aapt2`/`apksigner`, and attached as
  `ahlers-arcade-tv-0.2.0.apk`; the tag points at the `flynn/tvapp-logo` commit it was built from.)

### The legacy `android-tv/` app (read-only notes; don't edit it)

It's a Kotlin WebView + ExoPlayer app (`com.ahlersarcade.tv`, appcompat + media3 + constraintlayout). It loads the
same URL, sends `.mp4`/`.m3u8` links to a native player screen and YouTube links to the YouTube app, and exposes
`ArcadeTV.playVideo()`. Its workflow did build successfully (one run, 2026-09-07, on `main`). Why it wasn't a good
kiosk app:
- **BACK:** it called `webView.goBack()` whenever history existed. Since PR #2 the site pushes a history entry, so BACK
  ran the page's popstate handler and the app could never be exited with BACK. Before PR #2, BACK just quit the app.
- **No keep-screen-on, no immersive mode, no offline/error screen, no renderer-crash handling**, and no Play/Pause or
  MENU forwarding.
- The banner/icon was a plain cyan-outlined rectangle (an empty box in the launcher).
- **Every CI build was signed with that runner's throwaway debug key**, so a new APK could never update an installed
  one ("App not installed"). It also depended on whatever `gradle` the runner had installed (`gradle wrapper` at build time).
- `MIXED_CONTENT_ALWAYS_ALLOW` + cleartext traffic on. A few MB of libraries for a page shell. Fixed `versionCode 1`.
  Missing `uiMode`/`screenLayout` in `configChanges`, so some HDMI/display events recreate the activity and reload the page.
- The artifact expired after 90 days, and there was no release link to sideload from.

### Next increments (proposed)

1. Site side: when `window.ArcadeTV` exists, show *Launch on boot* and *Exit app* in the settings modal, and hide the
   desktop-only bits (mouse cursor reveal).
2. Last-good snapshot: keep a small offline copy of the last loaded page (or bundle `index.html` in the APK), so a cold
   boot without internet shows the board with a stale badge instead of SIGNAL LOST.
3. In-app update check: compare `version()` with the latest `tvapp-v*` release and show "Update available" (still a
   manual install, no extra permissions).
4. Screensaver/Daydream entry so the TV's idle screensaver can be the scoreboard.
5. Watchdog: if the page stops rotating (no `nextSlide` heartbeat via the bridge for N minutes), reload it.
