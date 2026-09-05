import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Design notes
 *
 * - IDs are TEXT and hold The Racing API's own identifiers. Never invent our
 *   own primary keys for entities the API already identifies; re-ingesting
 *   would create duplicates.
 * - `offDt` is timestamptz. UK racing is scheduled in Europe/London, which
 *   shifts by an hour twice a year. Storing wall-clock time as a string
 *   silently breaks countdowns every March and October.
 * - `raw` jsonb on races and runners keeps the untouched API payload. Disk is
 *   cheap; re-ingesting a season because we dropped a field we later needed is
 *   not. It is also what lets the tipping model backfill features in Phase 4
 *   without another API sweep.
 */

export const courses = pgTable(
  "courses",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    region: text("region"), // GB, IRE
    country: text("country"),
    // Track shape data — hand-curated, not from the API. Feeds the model and
    // gives the course pages something competitors' templates don't have.
    handedness: text("handedness"), // left, right, straight
    surfaceType: text("surface_type"), // turf, tapeta, polytrack, fibresand
    notes: text("notes"),
  },
  (t) => ({
    slugIdx: uniqueIndex("courses_slug_idx").on(t.slug),
  })
);

export const horses = pgTable(
  "horses",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sex: text("sex"),
    sexCode: text("sex_code"),
    colour: text("colour"),
    dob: date("dob"),
    sire: text("sire"),
    sireId: text("sire_id"),
    dam: text("dam"),
    damId: text("dam_id"),
    damsire: text("damsire"),
    damsireId: text("damsire_id"),
    breeder: text("breeder"),

    // When this horse's career form was last pulled from
    // /v1/horses/{id}/results. Lets the deep backfill resume after an
    // interruption instead of re-fetching 30,000 careers from the start.
    formFetchedAt: timestamp("form_fetched_at", { withTimezone: true }),
    formRuns: integer("form_runs"),
  },
  (t) => ({
    slugIdx: index("horses_slug_idx").on(t.slug),
    nameIdx: index("horses_name_idx").on(t.name),
  })
);

export const jockeys = pgTable(
  "jockeys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
  },
  (t) => ({ slugIdx: index("jockeys_slug_idx").on(t.slug) })
);

export const trainers = pgTable(
  "trainers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    location: text("location"),
  },
  (t) => ({ slugIdx: index("trainers_slug_idx").on(t.slug) })
);

export const owners = pgTable("owners", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
});

export const races = pgTable(
  "races",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").references(() => courses.id),
    courseName: text("course_name").notNull(),
    courseSlug: text("course_slug").notNull(),

    raceDate: date("race_date").notNull(),
    offTime: text("off_time").notNull(), // "14:00" as published
    offDt: timestamp("off_dt", { withTimezone: true }).notNull(),

    name: text("name").notNull(),
    slug: text("slug").notNull(), // "14-00-betfair-handicap"

    // Conditions
    distance: text("distance"), // "1m 2f 42y" as published
    distanceF: real("distance_f"), // decimal furlongs, for the model
    going: text("going"),
    goingBand: text("going_band"), // normalised: heavy|soft|good-soft|good|good-firm|firm|standard
    surface: text("surface"), // turf | aw
    raceType: text("race_type"), // Flat | Hurdle | Chase | NH Flat
    raceClass: text("race_class"),
    pattern: text("pattern"), // Group 1, Grade 2, Listed
    ageBand: text("age_band"),
    ratingBand: text("rating_band"),
    sexRestriction: text("sex_restriction"),

    prize: text("prize"),
    prizeValue: integer("prize_value"), // pence, for sorting big races
    fieldSize: integer("field_size"),

    // Confirmed present on /racecards/pro (probe 2026-08-26). Conditions a
    // punter checks and the model will want: stalls position and rail
    // movements change effective draw bias; weather moves the going.
    region: text("region"), // GB, IRE
    goingDetailed: text("going_detailed"), // "GOOD, Good to firm in places (GoingStick: 7.2)"
    distanceRound: text("distance_round"), // "5f" — the display form
    stalls: text("stalls"),
    railMovements: text("rail_movements"),
    weather: text("weather"),
    jumps: text("jumps"),

    // Results-only extras
    nonRunnersText: text("non_runners"), // race-level NR list as published
    winningTimeDetail: text("winning_time_detail"),
    toteWin: text("tote_win"),
    toteCsf: text("tote_csf"),

    // Editorial / SEO
    isFeature: boolean("is_feature").default(false).notNull(),
    bigRaceSlug: text("big_race_slug"), // links to /big-races/grand-national

    // Lifecycle: a racecard becomes a result in place, on the same URL
    status: text("status").default("upcoming").notNull(), // upcoming | off | result | abandoned
    resultAt: timestamp("result_at", { withTimezone: true }),
    winningTime: text("winning_time"),
    comments: text("comments"), // post-race analysis from the API

    raw: jsonb("raw"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    urlIdx: uniqueIndex("races_url_idx").on(t.courseSlug, t.raceDate, t.slug),
    dateIdx: index("races_date_idx").on(t.raceDate),
    offIdx: index("races_off_dt_idx").on(t.offDt),
    statusIdx: index("races_status_idx").on(t.status, t.raceDate),
  })
);

export const runners = pgTable(
  "runners",
  {
    raceId: text("race_id")
      .notNull()
      .references(() => races.id, { onDelete: "cascade" }),
    horseId: text("horse_id").notNull(),
    horseName: text("horse_name").notNull(),

    jockeyId: text("jockey_id"),
    jockeyName: text("jockey_name"),
    trainerId: text("trainer_id"),
    trainerName: text("trainer_name"),
    ownerId: text("owner_id"),
    ownerName: text("owner_name"),

    number: integer("number"),
    draw: integer("draw"),
    age: integer("age"),
    weight: text("weight"), // "9-07" as published
    weightLbs: integer("weight_lbs"),
    headgear: text("headgear"),
    headgearFirstTime: boolean("headgear_first_time").default(false),

    // Ratings
    ofr: integer("ofr"), // official rating
    rpr: integer("rpr"),
    ts: integer("ts"), // topspeed

    form: text("form"), // "1-3241"
    lastRun: integer("last_run"), // days since previous run
    silkUrl: text("silk_url"),
    comment: text("comment"), // spotlight / analyst comment

    isNonRunner: boolean("is_non_runner").default(false).notNull(),

    // Trainer form at declaration time. The API gives this per runner and it
    // is not reconstructable later, so it is captured at ingest.
    trainer14Runs: integer("trainer_14_runs"),
    trainer14Wins: integer("trainer_14_wins"),
    trainer14Percent: real("trainer_14_percent"),
    trainerRtf: real("trainer_rtf"), // % of runners returning to form

    windSurgery: text("wind_surgery"),
    windSurgeryRun: text("wind_surgery_run"),
    performanceRating: integer("performance_rating"),
    speedRating: integer("speed_rating"),

    odds: jsonb("odds"), // full bookmaker array, as returned

    // Denormalised from `odds` at ingest so pages and settlement never have to
    // scan 30 bookmakers. ewPlaces/ewDenom drive each-way settlement.
    bestOddsDec: real("best_odds_dec"),
    bestOddsFrac: text("best_odds_frac"),
    bestOddsBookmaker: text("best_odds_bookmaker"),

    // The FIRST price we ever recorded for this runner, and when. Written once
    // and never overwritten -- see the COALESCE in the ingest upsert. The API
    // carries no price history (every `history` array comes back empty), so
    // this is the only way we can ever know what a horse opened at.
    openingOddsDec: real("opening_odds_dec"),
    openingOddsFrac: text("opening_odds_frac"),
    openingOddsAt: timestamp("opening_odds_at", { withTimezone: true }),

    // Shortest price seen across the day, for spotting a move that came back.
    shortestOddsDec: real("shortest_odds_dec"),
    ewPlaces: integer("ew_places"),
    ewDenom: integer("ew_denom"),
    oddsUpdatedAt: timestamp("odds_updated_at", { withTimezone: true }),

    // The mark once the apprentice/conditional claim is deducted. Stored
    // rather than derived so historical rows keep the claim that applied on
    // the day -- riders ride their claims out.
    effectiveMark: integer("effective_mark"),

    bsp: real("bsp"), // Betfair SP, results only
    prize: text("prize"),
    jockeyClaimLbs: integer("jockey_claim_lbs"),

    // Result fields — populated in place when the race settles
    position: text("position"), // "1", "2", "PU", "F", "UR"
    positionNum: integer("position_num"), // null for non-completions
    beatenBy: text("beaten_by"),
    ovrBtn: real("ovr_btn"), // cumulative lengths behind winner
    sp: text("sp"), // "11/2"
    spDec: real("sp_dec"), // 6.5

    raw: jsonb("raw"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.raceId, t.horseId] }),
    horseIdx: index("runners_horse_idx").on(t.horseId),
    jockeyIdx: index("runners_jockey_idx").on(t.jockeyId),
    trainerIdx: index("runners_trainer_idx").on(t.trainerId),
  })
);

/** Audit trail. When a page shows wrong data, this tells you which run did it. */
export const ingestRuns = pgTable("ingest_runs", {
  id: text("id").primaryKey(),
  job: text("job").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(), // running | ok | error
  racesSeen: integer("races_seen").default(0),
  runnersSeen: integer("runners_seen").default(0),
  error: text("error"),
});

/* ------------------------------------------------------------------------- *
 * Tips
 *
 * The tip is the product. Everything here is shaped by one requirement: the
 * public record has to be defensible. That means a tip is immutable once
 * published and settlement is derived, never typed in.
 *
 * - `advisedPrice` is captured at publish time and never updated. The record
 *   must show the price that was actually advised, not the price the horse
 *   went off at. Retro-fitting a better price is how tipping records become
 *   fiction.
 * - Settlement is computed from `runners.position` by settleTip() in
 *   lib/tips.ts. Nobody hand-enters a result.
 * - A non-runner voids the tip and returns the stake. It is not a loss, and
 *   counting it as one understates the record just as badly as deleting it
 *   would overstate it.
 * - `source` separates human tips from model tips so both can run over the
 *   same races and be scored against each other on identical maths. That
 *   comparison is the entire point of building the model.
 * ------------------------------------------------------------------------- */

export const tipsters = pgTable(
  "tipsters",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    role: text("role"),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    isModel: boolean("is_model").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
  },
  (t) => ({ slugIdx: uniqueIndex("tipsters_slug_idx").on(t.slug) })
);

export const tips = pgTable(
  "tips",
  {
    id: text("id").primaryKey(),

    tipsterId: text("tipster_id")
      .notNull()
      .references(() => tipsters.id),

    raceId: text("race_id")
      .notNull()
      .references(() => races.id, { onDelete: "cascade" }),
    horseId: text("horse_id").notNull(),
    horseName: text("horse_name").notNull(),

    raceDate: date("race_date").notNull(), // denormalised: every record query filters on it

    // nap | next-best | each-way | lucky15 | acca | model
    category: text("category").notNull(),

    betType: text("bet_type").default("win").notNull(), // win | each-way
    stakePoints: real("stake_points").default(1).notNull(), // per part, so 1pt e/w costs 2pt
    ewPlaces: integer("ew_places"), // places paid, as advised
    ewFraction: real("ew_fraction"), // 0.2 = 1/5, 0.25 = 1/4

    advisedPrice: text("advised_price"), // "7/2" exactly as published
    advisedPriceDec: real("advised_price_dec"), // 4.5

    reasoning: text("reasoning"), // the write-up, in Dan's voice
    factors: jsonb("factors"), // string[] — the features that actually fired

    // 1-5. Five requires the full well-handicapped case (see
    // docs/tipping-method.md). Treated as a hypothesis until strike rate and
    // ROI by band prove the bands mean anything.
    stars: integer("stars"),

    // Set by hand, after the fact. Every tip is published to the public record
    // regardless — auto-withholding the best bets would leave the public record
    // showing only the weakest selections.
    isVip: boolean("is_vip").default(false).notNull(),

    // human | model
    source: text("source").default("human").notNull(),
    modelVersion: text("model_version"),
    confidence: real("confidence"), // model's own probability, 0..1

    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),

    // ---- settlement, written by settleTip(), never by hand ----
    // pending | won | placed | lost | void
    status: text("status").default("pending").notNull(),
    returnsPoints: real("returns_points"), // total returned incl. stake
    profitPoints: real("profit_points"), // returns - outlay
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => ({
    // One tip per tipster per race. A tipster cannot quietly hold two opinions
    // on the same race and report whichever one won.
    oneTipPerRace: uniqueIndex("tips_tipster_race_idx").on(t.tipsterId, t.raceId),
    dateIdx: index("tips_date_idx").on(t.raceDate),
    statusIdx: index("tips_status_idx").on(t.status),
    raceIdx: index("tips_race_idx").on(t.raceId),
    tipsterDateIdx: index("tips_tipster_date_idx").on(t.tipsterId, t.raceDate),
  })
);

/**
 * Frozen price ticks for the Stable game.
 *
 * The game cannot price off `runners.opening_odds_dec`. That column is written
 * once at whatever moment ingest first saw the runner, and in practice that is
 * spread across 15:00, 18:00, 19:00, 22:00, 23:00 and 09:00 the next morning.
 * A horse first seen at 09:00 on raceday is priced off a far more mature market
 * than one seen at 18:00 the evening before, and a player who noticed that
 * could farm it. The game needs every runner on a card priced at the SAME
 * instant, so the snapshot is taken deliberately rather than inferred.
 *
 * Rows are append-only and never updated. Two reasons. Prices refresh every
 * fifteen minutes while the market is open, and a player who bought at £8.0m
 * will eventually dispute what the board said — the tick is the receipt. And
 * the whole calibration of this game rests on knowing what a horse cost at the
 * overnight show versus what it cost at the off, which is exactly the history
 * The Racing API does not carry and we cannot reconstruct after the fact.
 *
 * `subjectId` is a horse id or a jockey id depending on `kind`. Jockey rows
 * carry no `raceId`: a jockey is priced on their whole book across the card,
 * not on any one ride.
 */
export const gamePrices = pgTable(
  "game_prices",
  {
    raceDate: date("race_date").notNull(),
    /** The instant this whole card was priced. One value per tick, per card. */
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),

    kind: text("kind").notNull(), // horse | jockey
    subjectId: text("subject_id").notNull(),
    subjectName: text("subject_name").notNull(),

    /** Horses only. Null on jockey rows. */
    raceId: text("race_id").references(() => races.id, { onDelete: "cascade" }),

    /** Decimal odds the price was derived from. Horses only. */
    oddsDec: real("odds_dec"),
    /** De-overrounded win probability, or a jockey's book strength. */
    strength: real("strength").notNull(),
    /** What it cost, in £m. */
    priceM: real("price_m").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.raceDate, t.snapshotAt, t.kind, t.subjectId] }),
    cardIdx: index("game_prices_card_idx").on(t.raceDate, t.snapshotAt),
    subjectIdx: index("game_prices_subject_idx").on(t.kind, t.subjectId),
  })
);

/* ------------------------------------------------------------------ players */

/**
 * A player.
 *
 * Email only. There is no password to reset, no password to leak, and no
 * password for a punter to reuse from somewhere worse — sign-in is a one-time
 * link. Email is stored lowercased because it is the identity: "Dan@x.com" and
 * "dan@x.com" must not become two stables.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    stableName: text("stable_name"),
    avatarUrl: text("avatar_url"),
    /** Set when the user unsubscribes from announcement emails. */
    announcementsOptOutAt: timestamp("announcements_opt_out_at", { withTimezone: true }),
    /** Admins can broadcast announcements and access back-office pages. */
    isAdmin: boolean("is_admin").default(false).notNull(),
    /**
     * When the user confirmed they're 18 or over. Set on the first sign-in
     * that carried the confirmation; existing users grandfathered at
     * migration time. Never asked again once set.
     */
    ageConfirmedAt: timestamp("age_confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ emailIdx: uniqueIndex("users_email_idx").on(t.email) })
);

/**
 * Outstanding magic links.
 *
 * The token is stored as a SHA-256 hash, never in the clear. A dump of this
 * table is then worth nothing: an attacker holding the hash cannot construct
 * the link, the same reason passwords are not stored in the clear. Single use
 * and short-lived, because a sign-in link sits in an inbox forever otherwise.
 */
export const loginTokens = pgTable(
  "login_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ emailIdx: index("login_tokens_email_idx").on(t.email, t.createdAt) })
);

/** Live sessions. The cookie holds the raw id; only its hash is stored here. */
export const sessions = pgTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ userIdx: index("sessions_user_idx").on(t.userId) })
);

/* ------------------------------------------------------------------ stables */

/**
 * One stable per player per race day.
 *
 * `lockedAt` is set when the first race on the card goes off. Once set the
 * stable is frozen: settlement has to score what was actually picked before the
 * off, and a row that can still change afterwards is not a record of anything.
 *
 * Prices are copied onto the picks rather than looked up at settlement. The
 * board moves every fifteen minutes, so "what did this cost" is only answerable
 * by what was charged at the moment of the pick.
 */
export const stables = pgTable(
  "stables",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    raceDate: date("race_date").notNull(),
    napHorseId: text("nap_horse_id"),
    spendM: real("spend_m").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    points: real("points"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    onePerDay: uniqueIndex("stables_user_date_idx").on(t.userId, t.raceDate),
    dateIdx: index("stables_date_idx").on(t.raceDate),
  })
);

/** A horse or a jockey in a stable, at the price that was charged for it. */
export const stablePicks = pgTable(
  "stable_picks",
  {
    stableId: text("stable_id")
      .notNull()
      .references(() => stables.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // horse | jockey
    subjectId: text("subject_id").notNull(),
    subjectName: text("subject_name").notNull(),
    /** Horses only — enforces one pick per race. */
    raceId: text("race_id"),
    priceM: real("price_m").notNull(),
    points: real("points"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.stableId, t.kind, t.subjectId] }),
    stableIdx: index("stable_picks_stable_idx").on(t.stableId),
  })
);

/**
 * Every sale ever made — the receipt.
 *
 * `salesRemaining` on `stables` alone would work, but a table is cheaper than
 * silence when a player insists "I only sold two". Each row records the
 * horse, what it fetched, when, and which stable it belonged to. `saleIndex`
 * is 1..N_SALES so the UI can show "Sale #1 of 2".
 */
export const stableSales = pgTable(
  "stable_sales",
  {
    id: text("id").primaryKey(),
    stableId: text("stable_id")
      .notNull()
      .references(() => stables.id, { onDelete: "cascade" }),
    saleIndex: integer("sale_index").notNull(),
    horseId: text("horse_id").notNull(),
    horseName: text("horse_name").notNull(),
    /** What the player paid for the horse originally. */
    boughtM: real("bought_m").notNull(),
    /** What the horse fetched at sale — added straight back to the bank. */
    soldM: real("sold_m").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    stableIdx: index("stable_sales_stable_idx").on(t.stableId),
  })
);

/* ------------------------------------------------------------ leagues */

/**
 * Mini-leagues. Anyone can create one; anyone with the six-character code
 * (or the shareable URL that carries it) can join.
 *
 * The `code` is the shared secret AND the join key — case-insensitive, six
 * characters from an alphabet that avoids visually confusing pairs (no 0/O,
 * no 1/I/L). Stored uppercase so the unique index catches collisions
 * regardless of what was typed.
 *
 * `festivalSlug` is null for ordinary weekly leagues. Set to something like
 * "cheltenham-2027" for festival leaderboards that aggregate over several
 * days — same schema, the scoring path just widens the date range.
 */
export const leagues = pgTable(
  "leagues",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    festivalSlug: text("festival_slug"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    codeIdx: uniqueIndex("leagues_code_idx").on(t.code),
    ownerIdx: index("leagues_owner_idx").on(t.ownerUserId),
  })
);

/**
 * League membership. A user can be in many leagues; a league has many
 * members. The composite primary key stops the same user joining twice.
 */
export const leagueMembers = pgTable(
  "league_members",
  {
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.leagueId, t.userId] }),
    userIdx: index("league_members_user_idx").on(t.userId),
  })
);

/**
 * A pending email change — analogous to loginTokens but for changing the
 * address on an existing account. When someone clicks the link that goes
 * to the NEW address, we update `users.email` and delete the request.
 * Storing only the hash means a leaked table cannot be used to hijack the
 * account.
 */
export const emailChangeRequests = pgTable(
  "email_change_requests",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    newEmail: text("new_email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ userIdx: index("email_change_user_idx").on(t.userId) })
);

/**
 * A record of every broadcast — who sent it, when, and how many landed.
 * The body is stored so a rerun of the send never mangles a past send's
 * archive, and so we have proof of what went out if a recipient asks.
 */
export const announcements = pgTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    sentBy: text("sent_by").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    recipients: integer("recipients").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    optedOut: integer("opted_out").notNull().default(0),
  },
  (t) => ({ sentAtIdx: index("announcements_sent_at_idx").on(t.sentAt) })
);
