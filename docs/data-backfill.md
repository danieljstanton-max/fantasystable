# What history the API gives us, and how to store it

Measured against the live advanced plan on 2026-08-26. Everything here is
observed, not from documentation.

## The two historical endpoints

### `/v1/results` — bulk, but only 12 months

```
start date must be 12 months or less in the past
```

Hard limit. You cannot pull multiple seasons this way at any page size.

- `limit` maximum is **100** (200 is rejected)
- **12,910 races** in the last 12 months across GB + IRE
- ~**123,000 runners** at 9.5 runners a race
- Roughly **130 calls** to page the whole year

### `/v1/horses/{id}/results` — deep, per horse

**Not date-limited.** This is how we get history older than a year.

| Horse | Age | Runs returned | Span |
|---|---|---|---|
| Balinaboola Steel | 14 | 50 | 2017-10-29 → 2024-08-18 |
| Avec Espoir | 13 | 49 | 2017-11-29 → 2026-08-08 |
| Dreal Deal | 11 | 50 | 2020-07-10 → 2026-07-17 |

**50 runs appears to be the cap.** Two horses returned exactly 50 and one 49,
which is consistent with a cap rather than three coincidences. For our purposes
50 runs is a full career for almost any horse.

## What a past run actually contains

Per-horse form lines carry everything the method needs:

| Field | Feeds |
|---|---|
| `or` | **mark trend** — the rating it ran off that day |
| `position`, `btn`, `ovr_btn` | finishing position and margins |
| `going`, `dist_f`, `course` | **proven conditions** |
| `comment` | in-running narrative → `lib/form-reading.ts` |
| `sp`, `sp_dec`, `bsp` | starting price, Betfair SP |
| `jockey_id`, `trainer_id` | booking changes, yard patterns |
| `rpr`, `tsr`, `performance_rating` | ratings |
| `weight_lbs`, `jockey_claim_lbs` | **effective mark** with an apprentice claim |
| `class`, `pattern`, `age_band` | class moves |

That covers every function in `lib/selection.ts`: `wonOffHigherMark()`,
`likesConditions()`, `campaignedImpossibly()` and `significantBooking()`.

## Strategy: don't backfill every horse

The naive approach — fetch form for every horse that has run in a year — is
about 25,000–30,000 calls. At the 300ms throttle that is over two hours and
mostly wasted, because the filters discard two thirds of races before a horse is
ever scored.

Do this instead:

1. **Bulk results, last 12 months.** ~130 calls, one pass. Gives race-level
   history, results-in-place, and settlement data.
2. **Per-horse form on demand.** Only for horses declared in races that *pass
   the filters*. Today that is 11 races, roughly 110 horses — about 35 seconds.
   Cache by `horse_id` and refresh only after the horse runs again.

Deep history therefore accumulates where it matters, and never gets fetched for
a horse in a 3yo-only handicap we would discard anyway.

## Storage, measured

Payload density from the real files:

| | Per race | 12 months (12,910 races) |
|---|---|---|
| Results | 10.9 KB | **~138 MB** |
| Racecards **with** odds | 111 KB | **~1,400 MB/year** |
| Racecards **without** odds | 63 KB | ~800 MB/year |

**The odds array is 43% of a racecard payload** — 30 bookmakers per runner, with
a price history each.

### The decision this forces

`CLAUDE.md` says keep `raw` jsonb on races and runners, and the reasoning is
sound: re-ingesting a season because we dropped a field is worse than paying for
disk. But at 1.4 GB a year, a Neon free tier (0.5 GB) is exhausted in about four
months.

Options, in the order I would consider them:

1. **Paid Neon tier.** Simplest. The rule stays intact and disk genuinely is
   cheap relative to re-ingesting.
2. **Strip `odds` from `raw` on racecards only.** The best price, each-way terms
   and bookmaker are already denormalised into columns, and the full array is
   still kept in the `odds` column — so this removes a *duplicate*, not data.
   Saves ~600 MB/year.
3. **Keep full `raw` for a rolling window** (say 90 days) and strip odds beyond
   it. Recent races are what the model retrains on most often.

Recommendation: **option 2 now, option 1 when the model needs it.** Storing the
odds array twice buys nothing.

## Practical limits

- `limit` on `/v1/results` maxes at 100
- Multi-value parameters must be **repeated**, never comma-joined
  (`region_codes=gb&region_codes=ire`). Comma form returns 422.
- Omitting the region filter returns French racing too — 50 races today rather
  than 34.
- Client throttles to 300ms between calls and backs off on 429.

## Open question

12 months of bulk results plus on-demand career form covers everything except
one stated factor: **"horses that won the same race in previous years."** That
needs several seasons of race-level history, which `/v1/results` will not give.

Two ways round it, both worth costing before committing:

- Match on `race_id` continuity year to year, if the API keeps stable ids for
  recurring races (untested).
- Or accumulate it going forward — the answer arrives in a year.
