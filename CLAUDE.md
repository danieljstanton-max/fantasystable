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

`lib/mappers.ts` is **unverified**. It was written without access to a live API
response, so every field is read through `pick()`, which tries several plausible
key names. This is a hypothesis, not a mapping.

Before trusting any ingested data, run `npm run probe` and correct the mappers
against `probe-output/FIELD-REPORT.txt`. Once a real key is confirmed, collapse
that `pick()` to the single correct key — silently reading the wrong field is
worse than failing loudly.

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
