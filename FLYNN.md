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

`node tools/test-celebrate.mjs [preview.html]` tests score celebrations against mocked ESPN summaries (an NHL game
NYR @ CAR and a CFB game TEM @ ECU): the per-team ★ toggles (mouse + D-pad) and their localStorage, no fire on first look,
GOAL!! / TOUCHDOWN!! / FIELD GOAL!!! / CANES WIN!! / HALFTIME!, no repeat after a score correction, the delay (Gamecast
+/− and settings ◀/▶, 0–30 s), queued events cancelled by a correction or by closing, any key dismisses without leaking
to the Gamecast, the `arcadeCelebrate('test')` / `?celebrate=td` hooks, and 0 console errors. It also checks the scorer
card (name + headshot + assists, logo-only fallback), the FG hold-back, every alert banner (red zone once per drive, big
play, interception, lead change, puck drop, power play once per penalty, per-type off switch) and SYNC NOW. It saves
1920x1080 screenshots of the toggles, a Hurricanes goal with Aho's card, a Canes win, an ECU touchdown, the red-zone and
power-play banners, the Gamecast sync helper and the settings rows.

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
   builds every live-game list: ticker, live cards, leaders/"props", TV guide, odds, My Squad, and marquee matchups.
3. Starts the **slide rotation**. Each slide shows full-screen above a **bottom ticker** (22vh) that scrolls forever.
   Long slides auto-scroll vertically, then advance.
4. Refreshes the ESPN scoreboards **every 5 minutes** and the weather **every 15 minutes**. Some slides (PGA, UFC,
   soccer, news, futures, rankings, standings) fetch their own data each time they come up.
5. Saves settings in `localStorage` (`ahlersArcadeSettings`). The ticker accent colour cycles cyan → pink → green on every slide change.

### Slide rotation order (`nextSlide()`)

`live → props → mySquad → trivia → leaders → pga → ufc → command → soccerSlide → tvGuide → news → odds → futures →
nflFutures → nflAwards → cfbFutures → nhlFutures → rankings → nfl → nba → nhl → mlb` → (loop). The order lives in the global
`ARCADE_SCREENS` array. `live` and `props` always show. The rest can be switched off in settings.

| Slide (DOM id) | Title | Data | Timing |
|---|---|---|---|
| `live-game-screen` | LIVE ACTION | in-progress games from the ticker fetch; MLB count/bases/outs, football down & spot, win-prob bar | scroll rule* (base 15 s), "NO LIVE GAMES" ≥16 s |
| `props-screen` | LIVE LEADERS | top stat leaders (up to 10) from live/final games | scroll rule |
| `mysquad-screen` | MY SQUAD DASHBOARD | games matching `mySquadTeams` (default "Carolina Hurricanes, Duke, ECU, East Carolina") | scroll rule |
| `trivia-screen` | TRIVIA BREAK! | OpenTDB sports question; 15 s countdown bar, then 5 s answer reveal; clock hidden | 20 s |
| `leaders-screen` | DAILY TOP PERFORMERS | first 8 leaders | scroll rule / 6 s if none |
| `pga-screen` | (event name) | ESPN golf scoreboard leaderboard | scroll rule / 6 s |
| `ufc-screen` | UFC: (event) | ESPN MMA scoreboard, winner/loser styling, live round badge | scroll rule / 6 s |
| `command-screen` | AHLERS COMMAND CENTER | Greenville NC weather (Open-Meteo) + top-2 "marquee" games by weight | 15 s |
| `soccer-screen` | GLOBAL SOCCER MATCHES | World Cup/EPL/UCL scoreboards, fetched again | scroll rule / 6 s |
| `tvguide-screen` | LIVE ON TV | live games with a broadcast; network favicons via Google s2 | scroll rule / 6 s |
| `news-screen` | TODAY'S HEADLINES | Yahoo + CBS RSS via rss2json, newest 10 | scroll rule / 6 s |
| `odds-screen` | TODAY'S LINES | upcoming games with ESPN spread/O-U/ML | scroll rule / 6 s |
| `futures-screen` | FUTURES | ESPN core futures: Super Bowl, CFB title, NBA title, World Series, Stanley Cup (top 8 each), cached 24 h (`ahlersFutures4`) | scroll rule (18 s) / 8 s |
| `nflfut-screen` | NFL FUTURES | Super Bowl (8), AFC/NFC champion (6), 8 divisions (4), from `futures.json` (§4a) | scroll rule / 6 s "NO ODDS POSTED" |
| `nflawards-screen` | NFL AWARDS ODDS | MVP, OPOY, DPOY, OROY, DROY, Comeback, Coach of the Year (6 each), with headshots | scroll rule / 6 s |
| `nhlfut-screen` | NHL FUTURES | one wide Stanley Cup Winner panel, top 16 in two columns | scroll rule / 6 s |
| `cfbfut-screen` | COLLEGE FOOTBALL FUTURES | National title, make CFP title game, Heisman (8); SEC/Big Ten/Big 12/ACC (5); AAC, MWC, Sun Belt, MAC, C-USA, Pac-12 (4) | scroll rule / 6 s |
| `rankings-screen` | COLLEGE RANKINGS | ESPN CFB rankings top 25 + records (CFB standings, cached 24 h) | scroll rule / 5 s on error |
| `nfl/nba/nhl/mlb-screen` | XXX STANDINGS | ESPN standings grouped by division (NBA by conference) | scroll rule / 6 s |

\*Scroll rule (`applyScroll`): if content is taller than the viewport, hold 4 s, scroll at 22 px/s (min 8 s), hold 5 s,
then advance. Otherwise show for `max(base, 16 s)`.

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
device**, so the QR code's phone remote can't actually control the TV.

---

## 4. External APIs and assets

None of them need an API key, and **no keys or tokens are embedded**. The code actively deletes a legacy
`settings.oddsApiKey` and the `ahlersPropsCache` entry from localStorage.

| API | Endpoint(s) | When / refresh | Feeds |
|---|---|---|---|
| ESPN site scoreboard | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard` for hockey/nhl, football/nfl, basketball/nba, baseball/mlb, football/college-football `?groups=80`, basketball/mens-college-basketball `?groups=50` (if `cbb50`), baseball/college-baseball, soccer/fifa.world, soccer/eng.1, soccer/uefa.champions, tennis/atp, tennis/wta. Base comes from `settings.apiBase` | on load, then every **5 min** (sequential, each league toggleable) | ticker, live, props, leaders, my squad, TV guide, odds, marquee |
| ESPN site scoreboard (slide) | `.../golf/pga/scoreboard`, `.../mma/ufc/scoreboard`, `.../soccer/{fifa.world,eng.1,uefa.champions}/scoreboard` | each time the PGA / UFC / soccer slide shows | those slides |
| ESPN summary (Gamecast) | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/summary?event={id}` (CORS `*`, no key). 0.1–1 MB per response (MLB is the largest) | only while a Gamecast is open: every **10 s**, 8 s timeout, previous request aborted first | Gamecast overlay |
| ESPN standings | `https://site.api.espn.com/apis/v2/sports/{football/nfl, basketball/nba, hockey/nhl, baseball/mlb}/standings` | each time the slide shows | standings slides |
| ESPN CFB standings | `https://site.api.espn.com/apis/v2/sports/football/college-football/standings` | rankings slide, cached 24 h (`ahlersCfbRecords`) | ranking records |
| ESPN CFB rankings | `https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings` | each time the rankings slide shows | rankings |
| ~~ESPN teams~~ | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams?limit=400`. **No longer called**: it always failed CORS (§7 #1) | n/a | n/a |
| ESPN core futures | `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/seasons/{year}/futures?limit=50`. Tries the likely season years per sport and keeps the fullest market. Matches on `displayName` + `name`. | futures slide, cached 24 h (`ahlersFutures4`) | futures |
| ESPN core $ref | `https://sports.core.api.espn.com/v2/sports/.../teams/{id}` (and `/athletes/{id}` for the ESPN fallback) | resolves team names missing from the built-in maps (e.g. CFB) | futures slides |
| futures.json (same origin) | `futures.json?t=<30-min bucket>`, written daily by `.github/workflows/futures.yml` | each football futures slide, re-checked every 30 min | NFL/CFB futures + awards (§4a) |
| Action Network | `https://api.actionnetwork.com/web/v1/leagues/{1=NFL,2=NCAAF,3=NHL}/futures/available` and `.../futures/{type}?bookIds=15,68,69,75,123`. CORS echoes the page origin, no key. | **browser fallback only** (file missing or > ~2 days old), cached 3 h (`ahlersFootballFutures2`) | NFL/CFB/NHL futures |
| Open-Meteo | `https://api.open-meteo.com/v1/forecast?latitude=35.6127&longitude=-77.3663&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America/New_York` | on load, then every **15 min** (only if Command Center is on) | Command Center weather |
| Open Trivia DB | `https://opentdb.com/api.php?amount=1&category=21&type=multiple` | on load and after each trivia slide | trivia (rate limit 1 req / 5 s / IP) |
| rss2json | `https://api.rss2json.com/v1/api.json?rss_url=` + Yahoo Sports RSS / CBS Sports headlines RSS | each time the news slide shows | headlines (free tier, rate-limited) |
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

Local assets: `index.html` references **no** local files apart from `futures.json`. `background.mp4` (1.3 MB) and `header.PNG` (710 KB) exist
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
| ▲ / ▼ | scroll the team-stats and player-stats panels (auto-scroll resumes after 8 s) |
| OK | focus ✕ CLOSE (a second OK closes) |

- **Content:** a scoreboard with logos, records, score, period/clock and status. It also shows the in-game situation:
  - football: possession, down and distance, red zone
  - MLB: count, bases, outs, batter vs pitcher
  - NHL: shots on goal
  - NBA: FG%
  - soccer: possession

  Below that: a linescore (MLB adds R/H/E), win probability with a sparkline (or the matchup predictor and line before
  kickoff), the last 6 plays, every team stat as comparison bars, top performers, and box-score tables (NBA/NFL/NHL/MLB
  from `boxscore.players`, soccer from `rosters`). Upcoming games show season stats/leaders, venue, weather, probables and
  the line. Missing blocks are simply left out.
- **Polling:** one summary request every **10 s** (start to start) while open. The previous request is aborted first, so
  requests never overlap, and each one times out after 8 s. After 3 failures in a row the gap backs off to 20 s, then 30 s,
  and the header shows **⚠ RECONNECTING… LAST UPDATE h:mm:ss** while the last good data stays on screen. Otherwise the
  header shows **UPDATED h:mm:ss**.
- **Memory:** only the latest response is parsed. It isn't stored and is released once rendered. The DOM is only rewritten
  when a block's markup changes, and the overlay's DOM is emptied on close. One 60 ms scroll timer runs, and only while open.
- **Auto-close:** a finished game closes itself after 10 min with no input. An upcoming game closes after 30 min idle.
  Live games stay open until closed.
- Moving the mouse shows the cursor for 3 s (it's still `cursor: none` when idle), so clicks are possible on a desktop.

### Score celebrations (full-screen team moment)

- **Turn it on:** open any NHL / NFL / college football / MLB game in the Gamecast and press OK on **★ CELEBRATE <TEAM>**
  under either team (or both). It turns yellow (ON). The choice is saved per team in `localStorage.ahlersCelebrateTeams1`
  (`"<league>:<ESPN team id>"`). The master switch **Score Celebrations** (settings, default ON) turns everything off.
- **Delay:** 0–30 s in 1 s steps, default 0 (`settings.celebrateDelay`). Change it with − / + in the Gamecast or ◀ / ▶ on
  the delay row in settings. A score is detected right away, and the effect is queued until the delay is up. Queued events
  are dropped if the score is corrected down or the Gamecast is closed (events found by the 5-min scoreboard refresh are
  dropped on a correction).
- **What fires:** only a score that goes *up* between two polls (never on first load, and never again after a correction
  back up). Debounced per game (20 s, except touchdowns/wins). Hockey/soccer **GOAL!!**. Football **TOUCHDOWN!!** (+6),
  **FIELD GOAL!!!** (+3), **SAFETY!** (+2, unless it's a two-point try just after a TD). PAT +1 doesn't fire. Baseball
  **HOME RUN!!** (from the latest play text) or **RUN SCORES!** / **N RUNS SCORE!**. Win: **<SHORT NAME> WIN!!** (e.g. CANES WIN!!).
  Smaller, shorter moments for **HALFTIME!**, **END OF PERIOD** / **END OF QUARTER** and **FINAL** (a toggled team that
  didn't win). Basketball doesn't fire on baskets.
- **Look:** team-colour wash and strobe, swinging light beams, a light sweep, three huge scrolling marquee rows of the
  banner text, shake + zoom-punch logo, pulse rings, CSS confetti. CSS transform/opacity only, 4–8 s, no sound. Any remote
  key or a click dismisses it (the key isn't passed on). Back closes it first.
- **Scorer:** scoring celebrations show the player when the summary has a *new* scoring play for that team: name in the
  marquee (`GOAL!! ★ SEBASTIAN AHO`) plus a headshot card with assists (NHL) or "PASS FROM …" (football). The name comes
  from `participants` (NHL/MLB plays) or the scoring-play text (football). The headshot comes from the feed, the boxscore
  athlete, or `a.espncdn.com/i/headshots/<league>/players/full/<id>.png`. With no player found, only the team logo shows.
- **Effects level:** **Lite** is the default (Settings → *Full Effects* off). It has one team-colour wash fade, one gentle
  logo scale-in, ONE scrolling strip (transform only), and the scorer card. There's no strobe, confetti, shake, beams,
  rings, sweep, blur shadows or filters, and alert banners lose their glow and shine. **Full** is the original flashy
  version. The TV app (`window.ArcadeTV`) and `prefers-reduced-motion` always use Lite. Headless Chrome (software
  compositing): Lite holds 60 fps at 1x/4x/6x CPU throttle, Full runs at about 10–15 fps.
- **Field goals** are held back 5 s on top of the delay, so a FG never shows before a TD would be known.
- **Alerts (smaller banners)** for ★ teams use the same delay and the master switch, and each type has its own switch
  in settings (`alertRedzone`, `alertPP`, `alertStart`, `alertLead`, `alertBig`, default ON):
  **RED ZONE!** (football, once per drive, from the drive's yards-to-endzone), **POWER PLAY!** (NHL, for the team
  whose opponent took a minor/major penalty, once per penalty play), **PUCK DROP! / KICKOFF! / FIRST PITCH! / TIP-OFF!**
  (pre → in), **<TEAM> TAKE THE LEAD!** (from the high-water scores, so corrections can't re-fire it), **BIG PLAY! N YDS**
  (25+ yd pass/run), **INTERCEPTION! / FUMBLE RECOVERED!** (for the defence), **DOUBLE! / TRIPLE!** (MLB). The
  play-by-play alerts only come from an open Gamecast. Start and lead change also come from the 5-min scoreboard refresh.
  A banner waits while a full celebration is showing, then follows it.
- **Delay sync (SYNC NOW):** the Gamecast shows the feed's clock (`DATA P2 12:22`, ticking between polls while it runs)
  next to the delay. Press **SYNC NOW**: it locks the clock shown and reads `PRESS AT TV P2 12:22`. Press again when the
  TV shows that clock. The gap becomes the delay (0–30 s, 1 s steps, saved). The lock expires after 60 s. There's no
  live clock for MLB, so it shows "NO LIVE CLOCK".
- **Preview:** console `arcadeCelebrate('goal' | 'td' | 'fg' | 'run' | 'hr' | 'win' | 'half' | 'period' | 'test')`,
  `arcadeCelebrate('redzone' | 'pp' | 'start' | 'lead' | 'big' | 'alerts')` for the banners, the
  **★ PREVIEW** button in settings, or open the page with `?celebrate=td` (etc.). `test` plays GOAL → TD → WIN.
- Performance note: marquee strips are only just over a screen wide. Long strips with glow text dropped software rendering
  to about 4 fps.

- *App shell?* Stay in the browser for now. A **TWA** needs Chrome on the TV (rare on Android TV). A **thin WebView
  wrapper** is only worth it if the TV browser swallows Back/Menu, sleeps the screen, or can't auto-launch on boot. The
  JS already accepts raw Android key codes for that case.

---

## 6. Must not break (checklist for every change)

- [ ] Page loads with **zero console errors** (apart from the known issues in §7) and no uncaught exceptions
- [ ] The 12 ESPN scoreboard fetches run on load and every 5 min, and each league toggle still works
- [ ] Ticker: LIVE NOW / UPCOMING head, logos, scores, status, marquee message, seamless infinite scroll, speed 1-10
- [ ] Clock top-left (`h:mm AM/PM`, local time), hidden only during trivia
- [ ] Settings gear top-right with focus outline. `s` / ContextMenu / Menu / Settings keys toggle the modal. Enter on the focused gear works.
- [ ] Every settings control persists to `localStorage.ahlersArcadeSettings` and takes effect (toggles, favourite teams, marquee, speed)
- [ ] Slide rotation order and the skip-if-disabled logic. `live` and `props` always show.
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
- [ ] Score celebrations: ★ toggles in the Gamecast, master switch + 0–30 s delay in settings, fire only on increases,
      any key dismisses. Alerts: once per situation, per-type switches. SYNC NOW sets the delay (`tools/test-celebrate.mjs`)
- [ ] No API keys or secrets added; every new API is free, no-key and CORS-enabled
- [ ] NFL FUTURES / NFL AWARDS / CFB FUTURES / NHL FUTURES slides populate, showing the 'UPDATED' time from futures.json, (from futures.json, or the live fallbacks) and can be toggled in settings
- [ ] Idle kiosk shows **no** nav UI; ◀/▶, OK menu, Back, Play/Pause and auto-hide all work (harness remote checks)
- [ ] Mouse click on the gear opens settings; SAVE & CLOSE closes it
- [ ] Gamecast opens from a Live Action card / ticker click and from the navigator GAMES row (D-pad). It pauses rotation,
      polls every ~10 s with no overlapping requests, shows RECONNECTING on failure, and closes with Back/Esc/✕. Closing
      stops every timer and request and resumes rotation (`tools/test-gamecast.mjs` + harness checks).

---

## 7. Known pre-existing issues (documented, not yet fixed)

| # | Issue | Effect |
|---|---|---|
| 1 | ✅ *Fixed in PR #2 (no longer called; names come from ESPN core $refs).* **ESPN `/teams?limit=400` sends no `Access-Control-Allow-Origin`** (200 to curl, but browsers block it) | 5 console CORS errors per futures build (once / 24 h on the TV). `loadTeamMap()` falls back to the hard-coded NFL/NBA/MLB/NHL maps. **CFB has no fallback, so "CFB TITLE" never renders.** |
| 2 | ✅ *Fixed in PR #2.* Futures market matching used `name` and `new Date().getFullYear()` | NBA title also missing (on 2026-10-07 only SUPER BOWL, WORLD SERIES, STANLEY CUP rendered). ESPN files upcoming NBA/NHL seasons under next year. |
| 3 | **Rotation skips a slide around trivia.** `showTrivia()` increments `rotationStep` itself, then `nextSlide()` increments again | After a normal trivia slide, **leaders** is skipped. When trivia isn't loaded yet, leaders shows but **PGA** is skipped. (The harness saw PGA skipped when OpenTDB returned 429.) |
| 4 | **The 800 ms fallback timer in `nextSlide()` never fires.** It checks `if (!slideTimer)`, but `slideTimer` still holds a stale id | If an async slide's `fetch` hangs (no timeouts anywhere), rotation freezes on that slide. The initial `await updateSportsTicker()` has the same risk at startup. |
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
3. **Resilience.** `fetch` timeouts (AbortController ~8 s), a working rotation watchdog (issue 4), `res.ok` checks,
   last-good-data cache with a small "stale" badge when an API is down.
4. **Kiosk hardening.** Screen Wake Lock, a nightly soft reload (~4 AM) to clear memory on 24/7 runs, offline indicator +
   auto-recover, favicon.
5. **Smarter live data.** Refresh every 60 s while games are live (5 min otherwise), fetch the 12 scoreboards in parallel,
   and update the ticker without restarting its scroll (issue 10).
6. **Performance.** Drop the unused Tailwind Play CDN and inline only the Preflight rules the page depends on.
   Confirm pixel parity with `--compare`.
7. **Visual polish.** Cross-fade slide transitions, a score-change flash, a thin slide-progress bar, and a live-game count badge
   in the ticker head.
8. **Better free data.** Swap rss2json (a rate-limited third-party proxy) for ESPN's no-key news JSON. Improve the weather
   mapping (issue 8) and add a 3-day forecast from the Open-Meteo call the page already makes.
9. **Fix the rotation skip** (issue 3) so leaders and PGA show every cycle. This changes visible behaviour, so it needs Jordan's OK.
10. **Phone remote that actually works** (issue 7). It needs a relay (e.g. a tiny free worker), so it comes later and is optional.
