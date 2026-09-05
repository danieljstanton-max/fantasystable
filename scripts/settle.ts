/**
 * Settle a published day against the results.
 *
 * Reads the two text files that actually went out — not the database — because
 * the point of this is auditing what was *published*, at the price it was
 * published at. Re-deriving the selections from the DB would quietly launder
 * any bug in the tipping run.
 *
 *   npm run settle -- 2026-08-27
 *
 * Reports strike rate and P/L to £1 level stakes at both our advertised price
 * and the returned SP, so the gap between the two is visible. That gap is the
 * thing that decides whether a tipping service is worth following: a model that
 * only profits at prices nobody could get is not a model.
 */
import "dotenv/config";
import { fetchResults } from "../lib/racing-api";
import { OUT_DIR, parseBestBets, parseWriteUps, type Pick } from "../lib/published";
import { stripHorseCountry, stripCourseSuffix } from "../lib/mappers";
import { betFor, settleBet } from "../lib/staking";
import { isHandicap } from "../lib/selection";

/** "13/8" or "2" -> 2.625 / 3.0. Returns null for "no price" and similar. */
function fracToDec(frac: string | null): number | null {
  if (!frac) return null;
  const s = frac.trim().toUpperCase().replace(/F$|J$|C$/g, "");
  if (/^EV(N|NS|S|ENS)?$/.test(s)) return 2; // evens, in all the spellings we print
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return 1 + parseInt(m[1], 10) / parseInt(m[2], 10);
  const n = Number(s);
  return Number.isFinite(n) && n > 1 ? n : null;
}

const norm = (s: string) =>
  stripHorseCountry(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

async function main() {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run settle -- YYYY-MM-DD");
    process.exit(1);
  }

  const best = parseBestBets(date);
  const all = parseWriteUps(date);

  if (!best.length && !all.length) {
    console.error(`No published files found for ${date} in ${OUT_DIR}`);
    process.exit(1);
  }

  // Results are paginated and the API caps `limit` at 100 — asking for more
  // returns a 422 rather than clamping.
  type Res = {
    pos: string; sp: string | null; spDec: number | null;
    course: string; off: string; won: boolean; placed: boolean;
    field: number; nonRunners: string | null; raceName: string;
  };
  const runners = new Map<string, Res>();

  // Races that have returned a result, keyed by course + off time. Without this
  // a selection that has not run yet is indistinguishable from one that was
  // withdrawn — and they are opposite outcomes: pending versus stake returned.
  const settledRaces = new Map<string, { nonRunners: string[] }>();

  let skip = 0;
  for (;;) {
    const page: any = await fetchResults(date, date, 100, skip);
    const races: any[] = page?.results ?? [];
    if (!races.length) break;

    for (const race of races) {
      const rs: any[] = race.runners ?? [];
      const field = rs.filter((r) => r.position && r.position !== "NR").length;

      // Withdrawals after the market forms trigger a Rule 4 deduction. The API
      // gives the names, not the deduction, so we surface the exposure rather
      // than inventing a figure.
      const nrRaw = race.non_runners;
      const nonRunners =
        nrRaw && String(nrRaw).trim() && String(nrRaw).trim() !== "-"
          ? String(nrRaw).trim()
          : null;

      for (const r of rs) {
        const pos = String(r.position ?? "");
        const n = /^\d+$/.test(pos) ? parseInt(pos, 10) : null;

        // `off` is 12-hour with no am/pm — the same trap the mappers document.
      // Matching on course plus that string alone would collide 4:00 with 16:00,
      // so both readings are indexed and the caller supplies whichever it holds.
      const courseKey = norm(stripCourseSuffix(String(race.course ?? "")));
      const offKey = String(race.off ?? "").replace(/[^0-9:]/g, "");
      settledRaces.set(`${courseKey}|${offKey}`, {
        nonRunners: nonRunners ? nonRunners.split(",").map((x) => norm(x)) : [],
      });

      runners.set(norm(String(r.horse ?? "")), {
          pos,
          sp: r.sp ?? null,
          spDec: r.sp_dec != null ? Number(r.sp_dec) : null,
          course: stripCourseSuffix(String(race.course ?? "")),
          off: String(race.off ?? race.off_dt ?? ""),
          won: n === 1,
          // Each-way terms vary; three places is the common case at these field
          // sizes and is stated rather than assumed.
          placed: n != null && n <= (field >= 8 ? 3 : field >= 5 ? 2 : 1),
          field,
          nonRunners,
          raceName: String(race.race_name ?? ""),
        });
      }
    }

    if (races.length < 100) break;
    skip += 100;
  }

  if (!runners.size) {
    console.error(`No results returned for ${date}. Too early, or the card has not settled.`);
    process.exit(1);
  }

  report(`BEST BETS — ${date}`, best, runners, settledRaces);
  if (all.length) report(`EVERY RACE — ${date}`, all, runners, settledRaces, true);
}

/** "20:30" -> "8:30", to match the API's 12-hour, am/pm-less `off`. */
function to12h(t: string | null): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  return `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${m[2]}`;
}

function report(
  title: string,
  picks: Pick[],
  runners: Map<string, any>,
  settledRaces: Map<string, { nonRunners: string[] }>,
  terse = false
) {
  console.log("");
  console.log("=".repeat(84));
  console.log(title);
  console.log("=".repeat(84));

  let matched = 0, wins = 0, places = 0;
  let stakeReturnOur = 0, stakeReturnSp = 0;
  let outlay = 0, retOur = 0, retSp = 0;
  let winBets = 0, ewBets = 0;
  let ourSum = 0, spSum = 0, priced = 0;

  type Row = { sort: string; line: string; profit: number; note: string };
  const table: Row[] = [];
  // Shortened materially and still lost. These are the ones worth marking up:
  // the market agreed with us and the horse was beaten anyway, so whatever went
  // wrong is not a flaw in the read of the form.
  const backedBeaten: string[] = [];
  const ruleFour: string[] = [];
  const voided: string[] = [];
  const pending: string[] = [];
  const unmatched: string[] = [];
  void unmatched;

  for (const p of picks) {
    const r = runners.get(norm(p.horse));
    if (!r) {
      // Three very different reasons a selection has no result. Collapsing them
      // into one line is how a withdrawn horse gets quietly counted as a loser.
      const key = `${norm(p.course ?? "")}|${to12h(p.offTime) ?? ""}`;
      const race = settledRaces.get(key);

      const status =
        race && race.nonRunners.includes(norm(p.horse)) ? "VOID  withdrawn"
        : !race ? "—     not run yet"
        : "?     no result";

      if (status.startsWith("VOID")) voided.push(p.horse);
      else if (status.startsWith("—")) pending.push(p.horse);
      else unmatched.push(p.horse);

      table.push({
        sort: p.offTime ?? "99:99",
        profit: 0,
        line:
          `  ${(p.offTime ?? "  :  ").padEnd(6)}` +
          `${(p.course ?? "").slice(0, 12).padEnd(13)}` +
          `${p.horse.slice(0, 19).padEnd(20)}` +
          `${(p.priceFrac ?? "—").padStart(7)}` +
          `${"—".padStart(8)}` +
          `${"—".padStart(7)}` +
          `${"—".padStart(7)}  ` +
          `${"—".padEnd(9)}` +
          `${"—".padStart(7)}` +
          `${"—".padStart(8)}`,
        note: status.replace(/^\S+\s+/, "").trim(),
      });
      continue;
    }

    matched++;
    if (r.won) wins++;
    if (r.placed) places++;

    const ourDec = fracToDec(p.priceFrac);
    const spDec = r.spDec;

    if (ourDec) stakeReturnOur += r.won ? ourDec : 0;
    if (spDec) stakeReturnSp += r.won ? spDec : 0;

    // The plan: 1pt win at 6.0 or shorter, 0.5pt each-way above it. The bet is
    // fixed by the advised price — the price actually taken — not by the SP.
    const bet = betFor(ourDec);
    if (bet.type === "win") winBets++; else ewBets++;

    const pos = /^\d+$/.test(r.pos) ? parseInt(r.pos, 10) : null;
    const hcap = isHandicap(r.raceName ?? "");

    const sOur = settleBet(bet, ourDec, pos, r.field, hcap);
    const sSp = settleBet(bet, spDec, pos, r.field, hcap);

    outlay += sOur.outlay;
    retOur += sOur.returned;
    retSp += sSp.returned;

    if (ourDec && spDec) { ourSum += ourDec; spSum += spDec; priced++; }

    // "Well backed" here means the price contracted by a tenth or more between
    // our writing it and the off. It is a proxy for money, not proof of it.
    const shortened = ourDec && spDec ? (spDec - ourDec) / ourDec : 0;
    if (ourDec && spDec && shortened <= -0.10 && !r.won) {
      backedBeaten.push(
        `  ${p.horse.padEnd(22)} ${String(p.priceFrac).padStart(7)} into ${String(r.sp).padStart(7)}` +
          `  (${(shortened * 100).toFixed(0)}%)   finished ${r.pos}/${r.field}` +
          `${r.placed ? ", placed" : ""}`
      );
    }

    if (r.nonRunners) {
      ruleFour.push(`  ${p.horse.padEnd(22)} ${r.course} ${r.off}  NR: ${r.nonRunners}`);
    }

    const drift =
      ourDec && spDec ? `${spDec > ourDec ? "+" : ""}${(((spDec - ourDec) / ourDec) * 100).toFixed(0)}%` : "—";

    const betLabel =
      bet.type === "win" ? "1pt win" : bet.type === "ew" ? "0.5 e/w" : "no bet";

    table.push({
      sort: p.offTime ?? "99:99",
      profit: sOur.profit,
      line:
        `  ${(p.offTime ?? "  :  ").padEnd(6)}` +
        `${(p.course ?? r.course).slice(0, 12).padEnd(13)}` +
        `${p.horse.slice(0, 19).padEnd(20)}` +
        `${(p.priceFrac ?? "—").padStart(7)}` +
        `${(r.sp ?? "—").padStart(8)}` +
        `${`${r.pos}/${r.field}`.padStart(7)}` +
        `${drift.padStart(7)}  ` +
        `${betLabel.padEnd(9)}` +
        `${sOur.returned.toFixed(2).padStart(7)}` +
        `${((sOur.profit >= 0 ? "+" : "") + sOur.profit.toFixed(2)).padStart(8)}`,
      note: sOur.note.replace(/ \(.*\)$/, ""),
    });
  }

  console.log("");
  console.log(
    "  TIME  COURSE       HORSE                ADVISED      SP    FIN  DRIFT  BET       RETURN     P/L    BANK  RESULT"
  );
  console.log("  " + "-".repeat(108));

  // Running bank alongside each line: a day that ends level having been six
  // points down reads very differently from one that drifted quietly.
  let bank = 0;
  table
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .forEach((r) => {
      bank += r.profit;
      console.log(`${r.line}${((bank >= 0 ? "+" : "") + bank.toFixed(2)).padStart(9)}  ${r.note}`);
    });

  const pct = (n: number) => (matched ? ((n / matched) * 100).toFixed(1) : "0.0");
  const roi = (ret: number) => (matched ? (((ret - matched) / matched) * 100).toFixed(1) : "0.0");

  console.log("");
  console.log(`  settled        ${matched} of ${picks.length} selections`
    + (pending.length ? `   (${pending.length} still to run — provisional)` : "")
    + (voided.length ? `   (${voided.length} void)` : ""));
  console.log(`  won            ${wins}  (${pct(wins)}%)`);
  console.log(`  placed         ${places}  (${pct(places)}%)`);
  console.log("");
  const sign = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);
  const roiPlan = (ret: number) => (outlay ? (((ret - outlay) / outlay) * 100).toFixed(1) : "0.0");

  console.log(`  TO THE PLAN    ${winBets} win bets, ${ewBets} each-way — ${outlay.toFixed(1)}pts staked`);
  console.log(`    at advised   ${sign(retOur - outlay)} pts   ROI ${roiPlan(retOur)}%`);
  console.log(`    at SP        ${sign(retSp - outlay)} pts   ROI ${roiPlan(retSp)}%`);
  console.log("");
  console.log(`  LEVEL 1pt WIN, for comparison`);
  console.log(`    at advised   ${sign(stakeReturnOur - matched)} pts   ROI ${roi(stakeReturnOur)}%`);
  console.log(`    at SP        ${sign(stakeReturnSp - matched)} pts   ROI ${roi(stakeReturnSp)}%`);

  if (backedBeaten.length) {
    console.log("");
    console.log(`  WELL BACKED BUT BEATEN — ${backedBeaten.length}`);
    console.log(`  The market moved with us and the horse still lost. Worth reviewing`);
    console.log(`  the run rather than the selection.`);
    console.log("");
    backedBeaten.forEach((r) => console.log(r));
  }

  if (ruleFour.length) {
    console.log("");
    console.log(`  RULE 4 EXPOSURE — ${ruleFour.length} selection${ruleFour.length === 1 ? "" : "s"}`);
    console.log(`  A non-runner in the race. If it was withdrawn after the market formed,`);
    console.log(`  a Rule 4 deduction applies and the returns above are overstated. The API`);
    console.log(`  does not publish the deduction, so check the settled price with your book.`);
    console.log("");
    ruleFour.forEach((r) => console.log(r));
  }

  if (priced) {
    const avgOur = ourSum / priced, avgSp = spSum / priced;
    const drift = ((avgSp - avgOur) / avgOur) * 100;
    console.log("");
    console.log(`  average advertised price  ${avgOur.toFixed(2)}`);
    console.log(`  average SP                ${avgSp.toFixed(2)}   ${drift >= 0 ? "+" : ""}${drift.toFixed(1)}%`);
    console.log(
      drift < -2
        ? `  Selections shortened into the off — the advertised price was the better one.`
        : drift > 2
        ? `  Selections drifted — SP was the better price, and the advertised one was beatable.`
        : `  Prices held.`
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
