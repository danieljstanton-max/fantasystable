# The tipping method

Dan Stanton's selection method, as stated on 2026-08-26 and as reverse-engineered
from the published write-ups at `/racing-tips-today/`.

This is the specification the model is built against. **If it is wrong, correct
this file first** — the code follows it, not the other way round.

## What the system produces

Every UK and Irish race, every day, gets two things:

1. **A selection** — chosen by the factor engine, scored 1–5 stars.
2. **A write-up** — narrating the factors that actually fired, in Dan's voice.

All tips are published to the public record. Dan flags which go to the paid VIP
group manually, after the fact. (Decided 2026-08-26: automatically withholding
5-star bets would leave the public record containing only the weakest
selections, degrading the site's main marketing asset.)

## The rule that matters most

> "The model selects. The language model only writes."

If a language model picks the horse, it will pick plausible-sounding ones and
write just as confidently about them — and nobody could tell the difference from
the prose. So the factor engine chooses and scores, and the write-up narrates the
features that fired. Every claim in a write-up must trace to a computed feature.

This also gets the voice right for free: Dan's write-ups already *are* factor
narration. "Off a mark of 55, which is now 10lb below his last winning mark" is a
computed number rendered in his register.

## The signature angle — the well-handicapped plot

Stated as:

> "I love handicap horses that are running on the wrong ground and their trainer
> is getting their handicap mark down. These need to be flagged when the ground
> and track selection is right."

Five conditions. All five firing is the five-star case.

| # | Condition | Computed from |
|---|---|---|
| 1 | Official rating trending **down** over the last 3–6 runs | `runners.ofr` across history |
| 2 | Those defeats came on **unsuitable** going / trip / track | going band, `distance_f`, course vs the horse's winning profile |
| 3 | Current mark is **below a winning mark set in the last 18 months** — the gap in pounds is the size of the edge | `ofr` today vs `ofr` when it last won |
| 4 | **Today the conditions match** — going, trip and course all inside its proven window | today's race vs winning profile |
| 5 | **The yard agrees** — jockey upgrade, first-time headgear, wind surgery, market support | `jockey_id`, `headgear_run`, `wind_surgery_run`, odds history |

Steps 1–3: the horse is well treated. Step 4: today is the day. Step 5:
confirmation.

## The 18-month mark window

Decided 2026-08-27. A winning mark only counts if the win was inside the last
**18 months**.

Without it, `wonOffHigherMark()` returned the highest mark a horse had *ever*
won off. On the first real run, Cordouan came out as the strongest selection on
the card at "42lb below its last winning mark of 90" — a win from September
2022. Its rating had fallen 90 → 82 → 68 → 53 across four years of poor form.
That is not a plot; it is the handicapper being right, repeatedly.

With the window applied, Cordouan drops from 5 stars to 3, and Gloriously Glam
takes over on a mark 13lb below a winning mark set in May 2026 — three months
old, and actually informative.

The window applies to the **mark only**, never to proven conditions. A horse
that has won at a course seven times still likes the course however long ago;
what it won off back then says nothing about whether it is well treated today.

**Long-term decline** (15lb+ lost over 24+ months with no recent win) is
detected and reported by `markDecline()`, but does not currently change a
score. Open question: should it be an active penalty?

## Positive factors

Stated directly by Dan: trainer form, ground, handicap mark, weights, jockey,
tracks, winning form at those tracks, and horses that won the same race in
previous years.

Extracted from the published write-ups (used consistently, but not listed when
asked — these are habits rather than stated rules):

| Factor | Evidence from the write-ups |
|---|---|
| Mark vs last winning mark | "off a mark of 55, which is now 10lb below his last winning mark" |
| Old form off a much higher mark | "went close over C&D 13 months ago off a mark of 54 and returns off just 47" |
| Apprentice claim reducing the effective mark | "with the apprentice taking off 7lb, he effectively races from 55" |
| Course affinity | "absolutely loves Ffos Las, having won here seven times previously" |
| Trip changes | "the step up in trip", "the drop back to 5f looks a positive move" |
| Trouble in running last time | "repeatedly short of room at crucial stages" |
| Pace shape | "plenty of early pace… could set things up perfectly for a strong-travelling finisher" |
| Jockey booking | "the booking of Billy Loughnane catches the eye" |
| Weak race quality | "a horrible race on paper", "another poor Class 6 handicap" |
| Price judgement | "7/2 looks a fair price", "at 16/1 he looks a cracking each-way price" |

Proposed additions (agreed as worth including, ordered by expected value):

1. **Pace shape** — count confirmed front-runners in the field. A lone leader is
   systematically underbet; three or more guarantees a collapse and hands it to a
   closer. Implemented in `lib/form-reading.ts`.
2. **Wind surgery, first run after** — `wind_surgery_run` is already in the feed.
3. **First-time headgear** — `headgear_run === "1"`.
4. **Draw bias** — course, distance and going specific; `stalls` and
   `rail_movements` shift it race to race.
5. **Trainer × jockey combination** strike rate, not the two separately.
6. **Market movement** — we ingest every ten minutes, so we compute our own
   steamers and drifters rather than buying them.
7. **Days since last run** against each trainer's own pattern.
8. **Class drop relative to last win.**
9. **Trainer going and seasonal bias.**

## Negative filters

Stated 2026-08-26:

> "Unproven on ground and trip — but include if staying on well in previous
> races, or the run was blocked."

So being unproven is **not** an outright disqualifier. It is overridden by
evidence that the bare finishing position understates the horse:

- **Staying on well.** A horse finishing strongly over 6f is a *positive* at 7f,
  not an unknown. This is the stronger of the two overrides — it speaks directly
  to the trip.
- **Run blocked.** Trouble in running means the position was unrepresentative.

Implemented as `excuseUnproven()` in `lib/form-reading.ts`, reading the API's
narrative in-running comments. A faller or unseat is ignored — it says nothing
either way.

## Star rating

1–5. Five stars requires all five conditions of the signature angle, or an
equivalently strong combination.

**The rating must be calibrated against outcomes.** If five-star selections do
not measurably outperform three-star ones over a real sample, the rating is
decoration. Track strike rate and ROI by star band from the first day, and treat
the bands as a hypothesis until the record says otherwise.

## Write-up format

From the published examples:

```
[Course] Racing Tips
Race N – HH:MM

[One paragraph. Horse name in CAPS. 3–5 sentences. First person, hedged —
"I think", "I get the feeling", "catches the eye". Names the trainer. Cites
specific numbers: marks, pounds, claims. Ends on a price judgement.]
```

Preceded by a day intro: which meetings, the general themes, then "Good luck if
you're having a bet."

Voice notes: conversational rather than clipped; blunt about poor races; always
explains *why* rather than asserting. Never claims certainty — the strongest
register used is "I would be very surprised if he gets beaten."

## Data dependencies

Almost every factor above needs **history**, which the database does not yet
have. Required backfill:

- `/v1/results` over date ranges — past races, finishing positions, SPs,
  in-running comments
- `/v1/horses/{id}/results` — per-horse form lines, for mark trends and winning
  profiles

Until that exists, the engine can score nothing. This is the critical path.

## Open questions

- How far back should the backfill go? Mark trends need 6+ runs per horse;
  same-race-previous-winners needs several seasons.
- Ireland: same treatment as GB, or different weighting? Irish form and going
  descriptions differ ("yielding").
- How is the effective mark computed when an apprentice claims? Confirmed as a
  factor Dan uses, but the API's handling of claims needs checking against
  `jockey_claim_lbs` in results.
