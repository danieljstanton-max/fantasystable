/**
 * Publish the day to horseracingtips.io.
 *
 *   npm run publish -- 2026-08-29            # draft, for review
 *   npm run publish -- 2026-08-29 --live     # straight to publish
 *
 * The model already writes the day at 19:00. This is the last step: one POST
 * carrying the NAP, the five, the Lucky 15, every write-up and the going watch.
 * The site updates itself and nothing is typed twice.
 *
 * Credentials come from .env.local, never the command line. Copy them from
 * WordPress under Daily Tips > Publishing:
 *
 *   HRT_URL=https://horseracingtips.io
 *   HRT_TOKEN=...
 *
 * The token grants one capability — publishing a day of tips. It cannot log in
 * or read anything private, and it can be regenerated from that screen if it is
 * ever exposed. A WordPress application password still works as a fallback.
 */
import "dotenv/config";
import postgres from "postgres";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const OUT_DIR = join(homedir(), "Desktop", "Racing Tips");

type Selection = {
  horse: string; time?: string; course?: string; price?: string;
  stake?: string; verdict?: string; body?: string[];
};

type Race = {
  time: string; course: string; name: string;
  conditions?: string; body: string[]; verdict?: string;
};

/** Parse the published write-ups file — the record of what actually went out. */
function parseWriteups(date: string): { races: Race[]; going: string[]; intro: string } {
  const label = dayLabel(date);
  const path = [
    join(OUT_DIR, `${label} - RACE WRITE-UPS.txt`),
    join(OUT_DIR, `${date} race write-ups.txt`),
  ].find(existsSync);

  if (!path) return { races: [], going: [], intro: "" };

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const races: Race[] = [];
  const going: string[] = [];
  let intro = "";

  let course = "";
  let cur: Race | null = null;
  let inGoing = false;

  for (const raw of lines) {
    const l = raw.trim();

    if (/^GOING WATCH$/.test(l)) { inGoing = true; continue; }
    if (inGoing) {
      if (!l || /^Every race is previewed/.test(l) || /^No prices yet/.test(l)) { inGoing = false; }
      else if (!/^Selections on those cards/.test(l) && !/^declared going/.test(l)) going.push(l);
      continue;
    }

    if (/^\d+ races across \d+ meetings/.test(l)) { intro = l; continue; }

    const c = l.match(/^([A-Z][A-Z '\-]+) RACING TIPS$/);
    if (c) { course = titleCase(c[1]); continue; }

    const r = l.match(/^(\d{2}:\d{2})\s{2,}(.+)$/);
    if (r) {
      if (cur) races.push(cur);
      cur = { time: r[1], course, name: r[2].trim(), body: [] };
      continue;
    }

    if (!cur) continue;
    if (/^-{10,}$/.test(l)) continue;

    // The conditions line sits directly under the race name.
    if (!cur.conditions && /·/.test(l) && /runners/.test(l)) { cur.conditions = l; continue; }

    if (l.startsWith("VERDICT:")) {
      cur.verdict = l.replace(/^VERDICT:\s*/, "");
      races.push(cur);
      cur = null;
      continue;
    }

    if (l) cur.body.push(l);
  }
  if (cur) races.push(cur);

  return { races, going, intro };
}

/** Parse the best-bets file for the five and their cases. */
function parseBestBets(date: string): Selection[] {
  const label = dayLabel(date);
  const path = [
    join(OUT_DIR, `${label} - BEST BETS.txt`),
    join(OUT_DIR, `${date} BEST BETS.txt`),
  ].find(existsSync);
  if (!path) return [];

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const out: Selection[] = [];

  for (let i = 0; i < lines.length; i++) {
    // The price and the stake are both optional.
    //
    // This required a single-token price AND a stake, so "1. PHOENIX PAIRC
    // no price" matched nothing — "no price" is two tokens and there is no
    // stake to state until there is a price. Every selection was silently
    // dropped and Monday published with no best bets at all. An evening where
    // the market has not opened is normal, and the page should carry the five
    // with "no price yet" rather than carry nothing.
    const m = lines[i].match(/^(\d+)\.\s+([A-Z][A-Z0-9' \-().]+?)\s{2,}(.*)$/);
    if (!m) continue;

    const rest = m[3].split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);

    const ctx = (lines[i + 1] ?? "").match(/^\s+(\d{2}:\d{2})\s+([A-Za-z ]+?)\s+·/);
    const reasons: string[] = [];
    for (let j = i + 2; j < Math.min(i + 12, lines.length); j++) {
      const t = lines[j].trim();
      if (/^-{10,}$/.test(t)) break;
      if (/^[*+!]\s/.test(t)) reasons.push(t.replace(/^[*+!]\s*/, ""));
    }

    out.push({
      horse: m[2].trim(),
      price: rest[0] ?? "",
      stake: rest[1] ?? "",
      time: ctx?.[1],
      course: ctx?.[2]?.trim(),
      verdict: reasons.slice(0, 2).join(". "),
    });
  }
  return out;
}

/** The VIP/NAP note for a horse, if one was written. */
function parseNap(date: string, horse?: string): Selection | null {
  if (!horse) return null;
  const files = ["VIP", "NAP"].flatMap((k) =>
    [join(OUT_DIR, `${date} ${k} `)].map((p) => p)
  );
  void files;

  // The note is saved as "<date> VIP HHMM Horse Name.txt".
  const fs = require("node:fs") as typeof import("node:fs");
  const found = fs.readdirSync(OUT_DIR).find(
    (f) => f.startsWith(`${date} `) && f.toLowerCase().includes(horse.toLowerCase()) && f.endsWith(".txt")
  );
  if (!found) return null;

  const lines = readFileSync(join(OUT_DIR, found), "utf8").split(/\r?\n/);
  const head = lines.find((l) => /—/.test(l) && /\d{2}:\d{2}/.test(l)) ?? "";
  const parts = head.split("—").map((s) => s.trim());

  const where = (parts[1] ?? "").match(/^(\d{2}:\d{2})\s+(.+)$/);
  const body = lines
    .slice(1)
    .filter((l) => l.trim() && !/^(NAP|VIP PLAY|NOT A|18\+)/.test(l.trim()))
    .map((l) => l.trim());

  return {
    horse: parts[2] ?? horse,
    price: parts[3] ?? "",
    stake: parts[4] ?? "",
    time: where?.[1],
    course: where?.[2],
    body,
  };
}

const DAYS = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function dayLabel(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

(async () => {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run publish -- YYYY-MM-DD [--live] [--nap \"Horse Name\"]");
    process.exit(1);
  }

  const site = process.env.HRT_URL || process.env.WP_URL;
  const token = process.env.HRT_TOKEN;
  const user = process.env.WP_USER;
  const appPw = process.env.WP_APP_PASSWORD;

  if (!site || (!token && !(user && appPw))) {
    console.error(
      "\nMissing publishing credentials. In WordPress go to Daily Tips > Publishing,\n" +
      "copy the two lines shown, and paste them into .env.local:\n\n" +
      "  HRT_URL=https://horseracingtips.io\n" +
      "  HRT_TOKEN=...\n"
    );
    process.exit(1);
  }

  const { races, going, intro } = parseWriteups(date);
  const bestBets = parseBestBets(date);

  const napIdx = process.argv.indexOf("--nap");
  const napHorse = napIdx > -1 ? process.argv[napIdx + 1] : bestBets[0]?.horse;
  const nap = parseNap(date, napHorse) ?? bestBets[0] ?? null;

  // The NAP carries the full write-up for its race, not the two bullet
  // fragments the best-bets line has.
  //
  // It was being built straight from that line, so the biggest bet of the day
  // went out as a horse, a price and a course — the same data every racing site
  // publishes, and none of the part that is ours. The prose already exists a
  // few lines above in the write-ups; it just was not being attached.
  if (nap) {
    const race = races.find(
      (r) => r.time === nap.time && r.course?.toUpperCase() === nap.course?.toUpperCase()
    );
    if (race) {
      (nap as any).body = (nap as any).body?.length ? (nap as any).body : race.body;
      (nap as any).raceName = race.name;
      (nap as any).conditions = race.conditions;
      if (!nap.verdict && race.verdict) nap.verdict = race.verdict;
    }
  }

  if (!races.length) {
    console.error(`No write-ups found for ${date}. Run the daily job first.`);
    process.exit(1);
  }

  // The Lucky 15: the four shortest-priced of the five, which is the shape the
  // widget has always carried.
  const lucky15 = bestBets.slice(0, 4).map((b) => ({
    horse: b.horse, time: b.time, course: b.course, price: b.price,
  }));

  const meetings = [...new Set(races.map((r) => r.course))];

  // Attach the field to each race. The write-ups carry the reasoning; the race
  // pages also need the runners, which only the database has.
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 3 });

  const rows = (await sql`
    select ra.off_time "off", ra.course_name "course", ra.id "raceId",
           ra.distance_round "distance", ra.race_class "cls", ra.age_band "age",
           ra.going, ra.prize, ra.field_size "field", ra.race_type "raceType",
           r.number, r.draw, r.horse_name "horse", r.horse_id "horseId",
           r.jockey_name "jockey", r.jockey_claim_lbs "claim",
           r.trainer_name "trainer", r.trainer_14_percent "trainerPct",
           r.age "horseAge", r.weight, r.headgear, r.headgear_first_time "hgFirst",
           r.form, r.last_run "lastRun", r.silk_url "silk",
           r.ofr, r.rpr, r.ts, r.wind_surgery "wind",
           r.best_odds_frac "price", r.best_odds_bookmaker "book",
           r.opening_odds_frac "opening", r.ew_places "ewPlaces", r.ew_denom "ewDenom",
           r.is_non_runner "nr"
    from races ra join runners r on r.race_id = ra.id
    where ra.race_date = ${date}
    order by ra.off_time, r.number nulls last`) as any[];

  const byRace = new Map<string, any[]>();
  const raceMeta = new Map<string, any>();
  for (const row of rows) {
    const key = `${row.course}|${row.off}`;
    if (!byRace.has(key)) {
      byRace.set(key, []);
      raceMeta.set(key, row);
    }
    byRace.get(key)!.push({
      number: row.number, draw: row.draw, horse: row.horse, horseId: row.horseId,
      silk: row.silk, form: row.form, age: row.horseAge, weight: row.weight,
      headgear: row.headgear, hgFirst: !!row.hgFirst, wind: !!row.wind,
      jockey: row.jockey, claim: row.claim,
      trainer: row.trainer, trainerPct: row.trainerPct,
      or: row.ofr, rpr: row.rpr, ts: row.ts,
      lastRun: row.lastRun,
      price: row.price, book: row.book, opening: row.opening,
      nr: !!row.nr,
    });
  }

  for (const r of races) {
    const key = `${r.course}|${r.time}`;
    const meta = raceMeta.get(key);
    (r as any).runners = byRace.get(key) ?? [];
    if (meta) {
      (r as any).id = meta.raceId;
      (r as any).distance = meta.distance;
      (r as any).class = meta.cls;
      (r as any).age = meta.age;
      (r as any).going = meta.going;
      (r as any).prize = meta.prize;
      (r as any).field = meta.field;
      (r as any).raceType = meta.raceType;
      (r as any).ewPlaces = meta.ewPlaces;
      (r as any).ewDenom = meta.ewDenom;
    }
  }

  await sql.end();

  const withRunners = races.filter((r) => ((r as any).runners ?? []).length).length;

  const payload = {
    date,
    status: process.argv.includes("--live") ? "publish" : "draft",
    intro,
    meetings,
    nap,
    best_bets: bestBets,
    lucky15,
    writeups: races,
    going,
  };

  // Send nothing that needs escaping in JSON.
  //
  // WordPress runs wp_unslash() on every meta value, so a JSON string holding
  // an escaped quote — [{"name":"a \"b\" c"}] — is unslashed into invalid
  // JSON, the sanitiser decodes null, and the whole day's write-ups store as
  // an empty string. The push still returns 200. One race name, the Brighton
  // #Matchbooklovesracing "confined" Handicap, emptied a whole card.
  //
  // The plugin fixes this properly with wp_slash(). This is the other half:
  // there is no reason to put a straight double quote into a race name in the
  // first place, and curly quotes read better on the page anyway. Belt and
  // braces, because the failure is silent and costs a whole day.
  const deQuote = (v: any): any => {
    if (typeof v === "string") {
      return v
        .replace(/\\/g, "")
        .replace(/"([^"]*)"/g, "\u201c$1\u201d")
        .replace(/"/g, "\u201d");
    }
    if (Array.isArray(v)) return v.map(deQuote);
    if (v && typeof v === "object") {
      const out: any = {};
      for (const [k, x] of Object.entries(v)) out[k] = deQuote(x);
      return out;
    }
    return v;
  };

  const safe = deQuote(payload);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["X-HRT-Token"] = token;
  else headers.Authorization =
    `Basic ${Buffer.from(`${user}:${appPw}`).toString("base64")}`;

  const url = `${site.replace(/\/$/, "")}/wp-json/hrt/v1/day?date=${date}&status=${payload.status}`;

  console.log(`\nPublishing ${date} to ${site}`);
  console.log(`  ${races.length} races across ${meetings.length} meetings`);
  console.log(`  ${withRunners} with the field attached`);
  console.log(`  ${bestBets.length} best bets, NAP ${nap?.horse ?? "none"}`);
  console.log(`  status: ${payload.status}\n`);

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(safe),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Failed (${res.status}):`);
    console.error(text.slice(0, 600));
    process.exit(1);
  }

  const json = JSON.parse(text);
  console.log(`  ${json.created ? "created" : "updated"} — ${json.status}`);
  if (json.racePages !== undefined) console.log(`  ${json.racePages} race pages written`);
  console.log(`  ${json.url}`);

  // Read back what actually landed. Dan, 2026-09-04, on today's card 404ing
  // while the log said everything published: the response reported success
  // because WordPress accepted the write, but it saved the post as scheduled.
  // Nothing looked wrong until a reader hit the URL. Now the script asks the
  // site directly whether the URL resolves; a non-200 during a --live push is
  // a hard failure, not a note in a log nobody reads.
  if (payload.status === "publish" && json.url) {
    const check = await fetch(json.url, {
      method: "HEAD",
      redirect: "manual",
      headers: { "cache-control": "no-cache" },
    });
    if (check.status !== 200) {
      console.error(`  VERIFY FAILED — ${check.status} at ${json.url}`);
      console.error(`  the post is not reachable. Post status returned was "${json.status}".`);
      if (json.status === "future") {
        console.error(`  WordPress scheduled it. Confirm the plugin has the post_date fix (>= 1.44.0).`);
      }
      process.exit(2);
    }
    console.log(`  verified live (${check.status})`);
  }
  console.log("");
})();
