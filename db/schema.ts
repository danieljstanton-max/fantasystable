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

    odds: jsonb("odds"), // bookmaker price array as returned

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
