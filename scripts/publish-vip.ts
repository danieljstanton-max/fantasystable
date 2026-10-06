/**
 * Push the VIP group's record for a month to horseracingtips.io.
 *
 *   npm run publish:vip -- 2026-10
 *   npm run publish:vip -- 2026-10 --dry
 *
 * The VIP bets are advised in the group, not by the model, so they are kept by
 * hand in data/vip-bets.json. Everything else about them is looked up here: the
 * course, the off time, the finishing position and the each-way terms all come
 * from our own data, keyed on the date and the horse.
 *
 * That split is deliberate. The only thing a human types is the bet itself, so
 * a mistyped course cannot attach a bet to the wrong race, and the places and
 * the fraction printed on the page are the ones we actually hold rather than
 * ones assumed from the field size.
 *
 * Unlike the Lucky 15 and the placepot, this settles HERE rather than in
 * WordPress. Those two settle in the page because they read a race page's own
 * stored result, and a race page only exists for a card we covered. The VIP
 * group bets into races we never wrote up — Salisbury on 1 October had no page
 * — so a bet would have sat at "to run" for ever waiting for one.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { fracToDec } from "../lib/staking";

type Bet = {
  date: string;
  horse: string;
  stake: number;
  type: "win" | "ew";
  price: string | null;
  /**
   * A finishing position given by hand, for a race the feed has not published
   * yet. Dan watches the racing and the record should not sit on "to run" for
   * an hour after he has seen the horse finish second.
   *
   * It is only ever a stand-in. The official result wins the moment it lands,
   * so this cannot hold a wrong figure on the page, and if the two disagree —
   * a photo reversed, a disqualification — the official one is what shows and
   * the push says so.
   */
  position?: number;
};

// Omit, not extend: `position` goes in as the number Dan gave and comes out as
// the string the page prints ("2", or "PU"). Intersecting the two collapsed it
// to `never`, which typecheck caught and a looser setup would have shipped.
type SettledBet = Omit<Bet, "position"> & {
  course: string;
  off: string;
  race: string;
  field: number;
  position: string | null;
  sp: string | null;
  ewPlaces: number | null;
  ewDenom: number | null;
  result: "won" | "placed" | "lost" | "void" | "pending";
  staked: number;
  profit: number;
};

/**
 * What a settled bet returned, in points.
 *
 * An each-way bet is two bets of the same size. The win part pays at the
 * advised price; the place part pays that price over the denominator, and it
 * pays on a win as well as on a place — a winner collects both halves.
 */
function settle(bet: Bet, result: SettledBet["result"], ewDenom: number | null): {
  staked: number;
  profit: number;
} {
  const unit = bet.stake;
  const staked = bet.type === "ew" ? unit * 2 : unit;
  if (result === "void") return { staked: 0, profit: 0 };
  if (result === "pending") return { staked, profit: 0 };
  if (result === "lost") return { staked, profit: -staked };

  const dec = bet.price ? fracToDec(bet.price) : null;
  if (dec === null) return { staked, profit: 0 };
  const odds = dec - 1;

  // No denominator held means no each-way terms were published for the race.
  // 1/5 is the near-universal default and is what the site quotes elsewhere.
  const denom = ewDenom && ewDenom > 0 ? ewDenom : 5;

  let returned = 0;
  if (result === "won") {
    returned += unit * (1 + odds);
    if (bet.type === "ew") returned += unit * (1 + odds / denom);
  } else {
    // Placed: the win half is gone, the place half pays.
    if (bet.type === "ew") returned += unit * (1 + odds / denom);
  }
  return { staked, profit: returned - staked };
}

async function main() {
  const month = process.argv[2];
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error("usage: npm run publish:vip -- YYYY-MM [--dry]");
    process.exit(1);
  }
  const dry = process.argv.includes("--dry");

  const file = JSON.parse(
    readFileSync(join(process.cwd(), "data", "vip-bets.json"), "utf8")
  ) as { months?: Record<string, number>; bets?: Record<string, Bet[]> };
  const bets = file.bets?.[month];
  if (!Array.isArray(bets) || !bets.length) {
    console.error(`No VIP bets listed for ${month} in data/vip-bets.json.`);
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  const settled: SettledBet[] = [];
  const unmatched: Bet[] = [];

  for (const bet of bets) {
    const rows = await sql<any[]>`
      SELECT ra.off_time, ra.name race, ra.field_size, ra.status,
             c.name course, ru.horse_name, ru.position, ru.position_num,
             ru.sp, ru.ew_places, ru.ew_denom, ru.is_non_runner
      FROM runners ru
      JOIN races ra ON ra.id = ru.race_id
      LEFT JOIN courses c ON c.id = ra.course_id
      WHERE ra.race_date = ${bet.date}
        AND upper(ru.horse_name) LIKE ${"%" + bet.horse.toUpperCase() + "%"}
        -- Declared races only. The Racing API returns the entry list alongside
        -- the declared race, so a horse entered and then declared appears
        -- twice and the "ran twice that day" guard fired on a horse that ran
        -- once. A field with no racecard number has not been declared.
        AND EXISTS (SELECT 1 FROM runners n WHERE n.race_id = ra.id AND n.number IS NOT NULL)
      ORDER BY ra.off_time`;

    // A horse can run twice in a day at two meetings. Refusing to guess is the
    // only safe answer — the alternative is a bet silently attached to the
    // wrong race and settled off the wrong result.
    if (rows.length !== 1) {
      unmatched.push(bet);
      console.error(
        rows.length === 0
          ? `  no runner found: ${bet.date} ${bet.horse}`
          : `  ${rows.length} runs that day for ${bet.horse} — name the course in the data file`
      );
      continue;
    }

    const r = rows[0];
    const places = r.ew_places === null ? null : Number(r.ew_places);

    // The official position if we have one; the hand-given one only while we
    // do not. Never the other way round.
    const official = r.position_num === null ? null : Number(r.position_num);
    const byHand = typeof bet.position === "number" ? bet.position : null;
    if (official !== null && byHand !== null && official !== byHand) {
      console.warn(
        `  ! ${bet.horse}: given as ${byHand}, officially ${official} — using the official result`
      );
    }
    const finish = official ?? byHand;
    const pos = official !== null ? String(r.position ?? official) : byHand === null ? null : String(byHand);
    if (official === null && byHand !== null) {
      console.warn(`  ~ ${bet.horse}: settled on the given position (${byHand}); the feed has not published this race`);
    }

    let result: SettledBet["result"];
    if (r.is_non_runner) result = "void";
    else if (finish === null) result = "pending";
    else if (finish === 1) result = "won";
    else if (bet.type === "ew" && places !== null && finish <= places) result = "placed";
    else result = "lost";

    const { staked, profit } = settle(bet, result, r.ew_denom);

    settled.push({
      ...bet,
      course: String(r.course ?? "").replace(/\s*-\s*AW$/i, ""),
      off: String(r.off_time),
      race: String(r.race ?? ""),
      field: Number(r.field_size) || 0,
      position: pos,
      sp: r.sp ?? null,
      ewPlaces: places,
      ewDenom: r.ew_denom === null ? null : Number(r.ew_denom),
      result,
      staked,
      profit,
    });
  }
  await sql.end();

  if (unmatched.length) {
    console.error(`\n${unmatched.length} bet(s) could not be matched — nothing sent.`);
    process.exit(1);
  }

  settled.sort((a, b) => (a.date === b.date ? a.off.localeCompare(b.off) : a.date.localeCompare(b.date)));

  // A bet is published only once it has run.
  //
  // Dan, 2026-10-06, giving the day's bets: "only show after results." These
  // are the VIP group's selections and people pay for them — putting today's
  // two on a public page before the race hands them to everyone for nothing.
  //
  // Held back from the PUSH rather than hidden in the page. Anything sent to
  // WordPress is in the HTML whether or not it is displayed, and "hidden" in a
  // page source is not hidden at all. The sweep pushes this every ten minutes,
  // so a bet appears on its own within ten minutes of its race returning.
  const shown = settled.filter((b) => b.result !== "pending");
  const held = settled.length - shown.length;

  const staked = shown.reduce((s, b) => s + b.staked, 0);
  const profit = shown.reduce((s, b) => s + b.profit, 0);
  const done = shown.filter((b) => b.result !== "void").length;
  const wins = shown.filter((b) => b.result === "won").length;

  console.log(`\nVIP RECORD — ${month}\n`);
  for (const b of settled) {
    const terms = b.type === "ew" ? ` e/w (${b.ewPlaces ?? "?"} at 1/${b.ewDenom ?? 5})` : " win";
    console.log(
      `  ${b.date}  ${b.off}  ${b.course.padEnd(14)} ${b.horse.toUpperCase().padEnd(16)}` +
        ` ${(b.price ?? `SP ${b.sp ?? "-"}`).padStart(7)}  ${b.stake}pt${terms}`
    );
    console.log(
      `${"".padEnd(12)}${b.result === "pending" ? "to run" : `${b.result}${b.position ? ` (${b.position} of ${b.field})` : ""}`}` +
        `${b.result === "pending" ? "" : `   ${b.profit >= 0 ? "+" : ""}${b.profit.toFixed(2)}pts`}`
    );
  }
  console.log(
    `\n  ${done} settled, ${wins} winner${wins === 1 ? "" : "s"}, ${staked.toFixed(2)}pts staked, ` +
      `${profit >= 0 ? "+" : ""}${profit.toFixed(2)}pts (ROI ${staked > 0 ? ((profit / staked) * 100).toFixed(1) : "0.0"}%)`
  );
  if (held) {
    console.log(`  ${held} bet${held === 1 ? "" : "s"} held back until the race has run — not sent to the site.`);
  }

  // The graph plots the monthly totals Dan keeps by hand. Any month we also
  // hold bets for is recomputed from those bets and overwrites the hand figure,
  // so the bar and the list underneath it can never disagree — and October's
  // bar moves on its own as the month's bets settle.
  const months: Record<string, number> = { ...(file.months ?? {}) };
  for (const m of Object.keys(file.bets ?? {})) {
    if (m === month) {
      months[m] = Number(profit.toFixed(2));   // settled only, like the list
    }
  }
  const series = Object.keys(months)
    .sort()
    .map((m) => ({ month: m, points: Number(months[m]) }));
  const year = series.reduce((s, x) => s + x.points, 0);

  console.log(`\n  the graph: ${series.length} months, ${year >= 0 ? "+" : ""}${year.toFixed(2)}pts on the year`);
  for (const x of series) {
    const bar = "█".repeat(Math.max(1, Math.round(Math.abs(x.points) / 2)));
    console.log(`    ${x.month}  ${(x.points >= 0 ? "+" : "") + x.points.toFixed(2).padStart(7)}  ${bar}`);
  }

  // --dump writes the exact body that would be posted. The WordPress side is
  // rendered from this in a harness before it goes near the site.
  const dump = (process.argv.find((a) => a.startsWith("--dump=")) ?? "").split("=")[1];
  if (dump) {
    writeFileSync(dump, JSON.stringify({ month, bets: shown, months: series }, null, 2));
    console.log(`\n  payload written to ${dump}`);
  }

  if (dry) {
    console.log("\n  --dry: nothing sent.");
    return;
  }

  const site = process.env.HRT_URL, token = process.env.HRT_TOKEN;
  if (!site || !token) throw new Error("Missing HRT_URL / HRT_TOKEN");

  const url = `${site.replace(/\/$/, "")}/wp-json/hrt/v1/vip/${month}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HRT-Token": token },
    body: JSON.stringify({ month, bets: shown, months: series }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`);
  console.log(`\n  pushed ${shown.length} settled bet${shown.length === 1 ? "" : "s"} for ${month}`);
}

main().catch((e) => {
  console.error("\npublish:vip failed:", e?.message ?? e);
  process.exit(1);
});
