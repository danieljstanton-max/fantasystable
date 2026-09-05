# Racing site — Phase 1: data layer + racecards

Next.js 15 (App Router) + Postgres + Drizzle. Ingests UK/IRE racing data from
The Racing API into your own database and serves statically generated racecard
pages from it.

## Why this shape

The Racing API updates racecards, odds and results every ~3 minutes, and
recommends exporting data to your own database for high-throughput use. So:

```
The Racing API  ──ingest (cron)──>  Postgres  ──build/ISR──>  static pages
```

Your pages never call their API at request time. If their API has an outage,
your site still serves. You also own the historical data, which is what the
tipping model will train on in Phase 4.

## Setup

```bash
npm install
cp .env.example .env.local     # add your credentials to .env.local
npm run db:push                # create tables
npm run probe                  # FIRST — dump real API response shapes
```

### `npm run probe` — do this first

The field mappings in `lib/mappers.ts` are a best-guess reconstruction of The
Racing API's response shape. They are almost certainly wrong in places.

`npm run probe` calls each endpoint once, writes the raw JSON to
`./probe-output/`, and prints a field inventory. Correct `lib/mappers.ts`
against what actually comes back before running a full ingest.

### Then

```bash
npm run ingest:racecards       # today + tomorrow
npm run ingest:courses         # reference data, run once
npm run dev
```

## Environment variables

Never commit `.env.local`. Never paste credentials into a chat window.

| Variable | Notes |
|---|---|
| `RACING_API_USERNAME` | From your Racing API dashboard |
| `RACING_API_PASSWORD` | HTTP Basic auth pair |
| `DATABASE_URL` | Postgres connection string (Neon) |
| `REVALIDATE_SECRET` | Random string; guards the revalidation endpoint |
| `NEXT_PUBLIC_SITE_URL` | e.g. `https://horseracingtips.io` |

## Scheduling

On Vercel, `vercel.json` runs the ingest route on a cron. Recommended cadence:

| Job | Schedule | Why |
|---|---|---|
| Racecards (today) | every 10 min, 06:00–21:00 | non-runners, going changes, odds |
| Racecards (tomorrow) | hourly | declarations firm up through the day |
| Results | every 10 min, 13:00–22:00 | settle races as they finish |
| Courses/reference | weekly | rarely changes |

Non-runners and going changes are the two things punters will call you wrong
on. Ten minutes is the loosest you should go on race day.

## URL structure

```
/racecards                                    today (canonical hub)
/racecards/2026-08-26                          dated archive
/racecards/wolverhampton/2026-08-26/14-00-...  individual race
```

A racecard becomes a result in place — same URL, updated content. Do not create
a second URL for the result, or you will build tens of thousands of near
duplicates and split every race's signal in half.

## Project layout

```
db/schema.ts          Drizzle schema — courses, races, runners, horses, etc.
lib/racing-api.ts     Typed client for The Racing API
lib/mappers.ts        API response -> our schema  ← CORRECT THIS AFTER PROBE
lib/slug.ts           URL slug generation and parsing
lib/going.ts          Going scale, colours, ordering
lib/schema-org.ts     JSON-LD builders
scripts/probe.ts      Dump real API shapes
scripts/ingest-*.ts   Ingestion jobs
app/racecards/        Route handlers and pages
components/           RunnerRow, GoingChip, NextOffBoard, etc.
```

## Not yet built

Results pages, horse/trainer/jockey profiles, the tipping model, the affiliate
CMS. Phase 1 is deliberately just the spine: get real data in, get racecards
out, confirm the mappings are right.
