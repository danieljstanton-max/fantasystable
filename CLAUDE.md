# Racing site — project context

SEO-led UK/Irish horse racing site (horseracingtips.io rebuild). Phase 1 is the
data spine only: ingest The Racing API into our own Postgres, serve racecards
from it.

## Stack

Next.js 15 (App Router, RSC) · Postgres on Neon · Drizzle ORM · Tailwind 3 ·
deployed on Vercel. TypeScript strict. Path alias `@/*` → repo root.

## Commands

```bash
npm run dev              # local dev server
npm run typecheck        # tsc --noEmit — run before claiming a change works
npm run db:push          # apply db/schema.ts to the database
npm run probe            # dump real API response shapes to ./probe-output/
npm run ingest:racecards # today + tomorrow; accepts -- YYYY-MM-DD
npm run ingest:courses   # reference data, run weekly
```

Scripts load `.env.local` via `--env-file`, not `.env`.

## The one thing to know first

`lib/mappers.ts` is **verified** against live responses (probe, 2026-08-26).
Every key is confirmed; there is no `pick()` guessing left. Keep it that way —
if the API shape changes, the mappers throw rather than silently reading the
wrong field.

Two endpoints, two different schemas. `/racecards/pro` and `/results` name the
same concepts differently (`off_time`/`off`, `distance_f`/`dist_f`,
`race_class`/`class`, `ofr`/`or`, `ts`/`tsr`, `lbs`/`weight_lbs`), so they have
separate mappers.

Three traps probe caught, all still live:

1. **`off_time` is 12-hour with no am/pm.** "2:15" means 14:15. Only ever parse
   `off_dt`, which is a full ISO instant with offset.
2. **Non-runners are flagged by `number === "NR"`.** There is no boolean. Miss
   this and withdrawn horses ingest as live runners.
3. **Exchanges quote unmatched prices.** Matchbook, Smarkets and Betfair
   Exchange were showing 55.0 where the best real bookmaker price was 25/1.
   They are excluded from the headline price; each-way terms are taken by
   consensus across the sportsbooks that publish them.

Run `npm run verify:mappers` after any mapper change — it replays the real
payloads in `probe-output/` and fails on regressions.

## Rules that are not negotiable

**URLs are permanent.** A race URL that changes after Google indexes it costs
the page. Slugs are generated once at ingest and stored; never recomputed at
render time. Sponsor names are stripped from race slugs because sponsors change
annually.

**A racecard becomes a result in place, on the same URL.** Never create a second
URL for the result. Doing so builds tens of thousands of near-duplicates and
splits every race's ranking signal in half.

**Non-runners are marked, never deleted.** A punter following a link to a
withdrawn horse should see "non-runner", not a 404. The model also needs to know
a horse was declared and pulled.

**Ingest never overwrites `races.status`.** A settled result must not be reverted
to "upcoming" by a later racecard sweep.

**`raw` jsonb is kept on races and runners.** Disk is cheap; re-ingesting a
season because we dropped a field we later needed is not. Phase 4's tipping
model backfills features from it.

**Times are Europe/London, stored as timestamptz.** UK racing publishes local
wall-clock time. Treating "14:00" as UTC puts every summer countdown an hour
out. Use `toOffInstant()`; never construct race times by hand.

**Ingest is idempotent.** Everything upserts on natural keys — safe to run every
ten minutes. IDs are The Racing API's own; never invent our own primary keys for
entities the API already identifies.

## Ground and course

Two hard gates sit outside the score, in `lib/selection.ts`:

**The ground rule.** On soft or heavy a horse must have won or placed on soft or
heavy. If every one of its wins came on soft or heavy it cannot be picked on
good, good-to-firm or firm. All-weather is off the turf scale and untouched.
This is Dan's editorial line, taken with the backtest in front of him — it does
not improve ROI and must not be sold as though it does. Do not relax it on
measurement grounds.

**Every selection prints its ground record**, flattering or not. A signal with
weight zero is never printed, which is how a 0-from-4-on-soft NAP once reached
the site with nothing said about it. `groundRecord` is always populated.

`data/course-guide.json` is Dan's course and going cheat sheet — 85 UK and Irish
courses, refreshed with `python3 scripts/import-course-guide.py <workbook>`.
It is prose and never enters the score. Its draw figures are a cross-check
against our own computed IV, not a replacement, and surface is matched by kind
(turf vs aw) so a turf draw bias can never be applied to Tapeta.

## Design system

Colours and fonts are CSS custom properties in `app/globals.css` ("Claret &
Brass"). `tailwind.config.ts` only exposes them as utilities — change a colour in
globals.css, not in the Tailwind config.

- Anything numeric (off times, odds, form, weights, ratings) gets `.num` so
  columns align. Misaligned form strings are harder to scan, and scanning is the
  whole job of the page.
- Going colour runs wet-to-dry across the turf scale so a page of meetings can be
  read for ground without reading labels. All-weather sits off the scale in
  neutral slate — Tapeta is not a point on the turf axis.
- Motion is used in exactly one place: the countdown on `NextOffBoard`. It earns
  it by carrying information that changes.
- Deliberately not Racing Post red, Sporting Life green, or At The Races blue.

## Structured data

`lib/schema-org.ts` only emits fields backed by data we actually hold. Do not
pad JSON-LD with values that can't be substantiated — that is how sites collect
structured-data manual actions.

## Secrets

`.env.local` is gitignored. Never commit it, never paste credentials into a chat
window, never log the Authorization header in `lib/racing-api.ts`.

## Not built yet

Results pages, horse/trainer/jockey profiles, big-race pages, racing news, the
bookmakers affiliate page, the tipping model, `vercel.json` cron wiring.
