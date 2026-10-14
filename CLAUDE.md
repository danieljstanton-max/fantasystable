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

## What may be selected

Dan's method is **well-handicapped horses**. The score can reach a horse on
draw, pace, booking and yard form without the handicap angle firing at all —
WYLE COP was NAP on 2026-10-05 on draw and pace while the model called a
*different* horse in the same race well handicapped. That is not the method.

Before showing him any card, run `npm run check:marks -- <date>`. It reports
every selection against the mark it last won off, in the same code, and flags
`!` for one that is up and has **never won off a mark this high**. Lead with
those. Up in mark AND up in class AND up in trip is the disqualifying shape.

**The criteria run on every runner; the score ranks the survivors.** Never the
other way round. Until 2026-10-14 `best-bets.ts` took the top-scoring horse in
each race and *then* asked whether it was well handicapped — so a 100-race card
was tested one horse deep and a race was binned whole whenever its top scorer
failed. GUNFIGHTER failing on 3lb took the whole 17:30 Kempton, hiding PORT
ROAD, the highest-rated horse on the card. Dan: "out of 100 races just 2 horses
fit the criteria." `chooseFromRace()` in `lib/funnel.ts`. Two guards: a survivor
still needs a positive score, and a race where nothing survives still reports
its top scorer. Any change to who tops a race must be made in `write-ups.ts`
too, or the two files name different horses in the same race.

**A NAP must be the standout in its own race.** Closeness is a deduction, not a
tiebreak — `standoutPenalty()` in `scripts/best-bets.ts`. Dan chose this knowing
it cost 5pts over the twelve cards it was measured on; do not relitigate it on
measurement grounds, the same way the ground rule is not relitigated.

**Anything that argues against a selection gets printed.** The ground record
rule exists because a signal with weight zero is never shown, which is how a
0-from-4-on-soft NAP reached the site. The same hole swallowed a 12lb rise.
The mark trajectory, a cold yard, a bad draw and a poor record on today's going
are stated whether or not they moved the score.

**Entries are not declarations.** The API returns a race at the entry stage
beside the declared one — same name, different race id, no racecard numbers, no
prices. A field with no number on any runner is not declared: it gets no
preview, no page, and nothing may be selected from it. Miss this and a horse
running on Wednesday appears on Monday's card.

## Nothing goes live unchecked

`HRT_AUTOPUBLISH="draft"`. The 18:00 job builds the card and holds it. Dan,
2026-10-07: "we can't ever go live unless you check and double check."

Publishing is a separate, deliberate step, and only after all of: preflight
20/20, the contradiction audit, the fact cross-check, `npm run check:marks`,
and Dan saying go. Never chain `publish` after the checks in one command — the
checks were right and were walked past exactly that way. After publishing,
fetch the page and confirm what is on it.

## The mark on a racecard goes stale

`ofr` is the rating held when the entry was taken. A horse that wins is
reassessed, and the new figure reaches **the weights** before the rating field.
NOSTRUM won off 80 on 3 October, went up 5lb, and entered the 8 October card
still published as 80 while carrying top weight of 143lb.

The error only ever flatters a recent winner, which is precisely what the
method hunts for: the stale mark matches the mark the horse last won off, and
reads as the handicapper not having caught up. It selected the first two
horses on that card, 5lb and 10lb out.

`lib/marks.ts` derives the mark from the field's own weight-to-mark line —
claim added back, clear majority required, nothing offered when the field has
no line. `npm run test:marks`. Use `readMark()` anywhere today's mark matters;
past marks are fine, because the rating recorded against a past race is the one
the horse actually ran off.

## Checks read facts, not sentences

Roughly 25 checks are regexes over the model's own prose and a handful query the
database. Every silent failure this project has had came from the first kind:
"has won here" read as exactly one win, a staking check with no price to read,
coverage counting race rows instead of declared races, a run-style parser with
no phrase for being in front.

When a check can ask the database, it must. Every fix of this kind gets a named
regression test in `scripts/test-gates.ts` — `npm run test:gates`.

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
