/**
 * The month's best-bets record, pushed to the site as a running total.
 *
 * Dan, 2026-09-02: "Can we have a section for TOP 5 Bets September ... and a
 * +points or - points for the month. the top 5 bets we should list 1 point win
 * or 0.5 points eachway on those selections."
 *
 * Settled here rather than in PHP on purpose. The staking plan — 1pt win at 6.0
 * and shorter, 0.5pt each-way above it, place terms by field size and race type
 * — lives in lib/staking.ts and is what scripts/settle.ts audits with. A second
 * implementation in the plugin would drift from it, and the first anyone would
 * know is the site quoting a different profit from the audit. So the numbers are
 * computed once, here, and the plugin only renders them.
 *
 * Reads the published files, not the database. What is being reported is what
 * was published, at the price it was published at — re-deriving the selections
 * would launder any day where the file and the model disagreed.
 *
 *   npm run publish:month              # the current month
 *   npm run publish:month -- 2026-09
 */
import "dotenv/config";
import { fetchResults } from "../lib/racing-api";
import { parseBestBets, bestBetsPath } from "../lib/published";
import { stripHorseCountry, stripCourseSuffix } from "../lib/mappers";
import { betFor, settleBet } from "../lib/staking";
import { isHandicap } from "../lib/selection";
import { withRetry } from "../lib/retry";

const fracToDec = (f?: string | null): number | null => {
  if (!f) return null;
  if (/^evens?$/i.test(f)) return 2;
  const m = /^(\d+)\/(\d+)$/.exec(f.trim());
  return m ? Number(m[1]) / Number(m[2]) + 1 : null;
};

// The same normaliser scripts/settle.ts matches on, so a horse that settles in
// the audit settles here too.
const norm = (s: string) =>
  stripHorseCountry(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

type Row = {
  date: string;
  time: string;
  course: string;
  horse: string;
  price: string;
  bet: "1pt win" | "0.5pt e/w";
  result: "won" | "placed" | "lost" | "void" | "pending";
  pos: string;
  profit: number;
};

async function main() {
  const arg = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a));
  const now = new Date();
  const month = arg ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();

  const rows: Row[] = [];
  let outlay = 0, returned = 0, wins = 0, places = 0, settled = 0, pending = 0;
  let priceSum = 0, priced = 0, voids = 0;

  // The NAP, tracked on its own.
  //
  // Dan, 2026-09-25, asked for it on the month card. It is the selection the
  // site leads with every day, so a reader is entitled to see how the headline
  // bet has gone rather than only the five together. It is picks[0] — the same
  // horse publish.ts puts in the NAP slot.
  let napOut = 0, napRet = 0, napWins = 0, napPlaces = 0, napSettled = 0;
  // Each-way places, all of which make money under this staking plan.
  //
  // Dan, 2026-09-25: "we need the place info only if we tipped it each-way and
  // profited." So this counts places that finished in front — and Dan's reply
  // when I claimed a place could lose was right: "we only go each-way at 11/2
  // so it can't."
  //
  // Break-even on the place part of a 0.5pt each-way bet at 1/5 is exactly
  // 5/1: the return is 0.5 x (1 + odds/5), which equals the 1pt stake only at
  // odds of 5. The plan goes each-way at 11/2 and up, so a place always pays —
  // 1.05pts at 11/2 on 1/5 terms, 1.19pts at 1/4. September bore that out: 15
  // each-way places, none losing, the slimmest +0.05pts.
  //
  // Kept as its own count anyway, because it is what the widget reads and
  // because the guarantee is a property of the staking plan, not of the maths.
  // Change the plan to go each-way at 9/2 and these numbers part company.
  let napEwPaid = 0;

  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    if (!bestBetsPath(date)) continue;

    const picks = parseBestBets(date);
    if (!picks.length) continue;

    // A day still to be run has no results to fetch. Its selections are listed
    // as pending rather than skipped — a reader looking at the widget before
    // racing should see today's five, not an empty space.
    //
    // Paged the same way settle.ts pages it. Asking for one default-sized page
    // silently loses the back half of a big card, which reads as "pending" and
    // quietly understates the month.
    const byHorse = new Map<string, any>();
    let dayHasResults = false;
    try {
      for (let skip = 0; ; skip += 100) {
        const page: any = await fetchResults(date, date, 100, skip);
        const races: any[] = page?.results ?? [];
        if (!races.length) break;
        dayHasResults = true;
        for (const race of races)
          for (const r of (race.runners ?? []) as any[])
            byHorse.set(norm(String(r.horse ?? "")), { r, race });
      }
    } catch {
      // Leave the day pending rather than half-settled.
    }

    for (const p of picks) {
      const isNap = p === picks[0];
      const hit = byHorse.get(norm(p.horse));
      const ourDec = fracToDec(p.priceFrac);
      const bet = betFor(ourDec);
      const label = bet.type === "win" ? "1pt win" as const : "0.5pt e/w" as const;

      if (!hit) {
        // A selection missing from a day that HAS returned results was
        // withdrawn — it is a non-runner, not a bet still waiting to be run.
        //
        // Reported as pending, three August non-runners had the widget saying
        // "3 still to run" about a month that finished days ago. They cost
        // nothing and return nothing either way, so the money was right; the
        // sentence underneath it was not.
        const voided = dayHasResults;
        rows.push({
          date, time: p.offTime ?? "", course: stripCourseSuffix(p.course ?? ""),
          horse: p.horse, price: p.priceFrac ?? "", bet: label,
          result: voided ? "void" : "pending", pos: "", profit: 0,
        });
        if (voided) voids++; else pending++;
        continue;
      }

      const { r, race } = hit;
      const field = ((race.runners ?? []) as any[])
        .filter((x) => x.position && x.position !== "NR").length;
      const pos = /^\d+$/.test(String(r.position)) ? parseInt(String(r.position), 10) : null;
      const s = settleBet(bet, ourDec, pos, field, isHandicap(String(race.race_name ?? "")));

      // The average price is of the price advised — what a reader could have
      // taken — not the SP. Averaged over settled bets only, so five unrun
      // selections cannot move it.
      if (ourDec) { priceSum += ourDec; priced++; }

      const won = pos === 1;
      const placed = !won && s.returned > 0;
      if (won) wins++;
      if (placed) places++;
      settled++;
      outlay += s.outlay;
      returned += s.returned;

      if (isNap) {
        napSettled++;
        if (won) napWins++;
        if (placed) napPlaces++;
        if (placed && bet.type === "ew" && s.profit > 0) napEwPaid++;
        napOut += s.outlay;
        napRet += s.returned;
      }

      // A horse in the results with a non-numeric position — pulled up, fell,
      // unseated — RAN. The bet lost; it is not void.
      //
      // Dan, 2026-09-04: "seems we have same info twice." The two panels also
      // disagreed, 41 bets against 42, because this said "void" and the
      // dashboard then excluded it while the month totals still counted its
      // stake. Only a horse absent from the results is a non-runner, and that
      // case is handled above where there is no result row at all.
      rows.push({
        date, time: p.offTime ?? "", course: stripCourseSuffix(p.course ?? ""),
        horse: p.horse, price: p.priceFrac ?? "", bet: label,
        result: won ? "won" : placed ? "placed" : "lost",
        pos: pos === null ? String(r.position ?? "").toUpperCase() : `${pos}/${field}`,
        profit: Number(s.profit.toFixed(2)),
      });
    }
  }

  const profit = Number((returned - outlay).toFixed(2));
  const payload = {
    month,
    staked: Number(outlay.toFixed(2)),
    returned: Number(returned.toFixed(2)),
    profit,
    roi: outlay > 0 ? Number(((profit / outlay) * 100).toFixed(1)) : 0,
    settled, pending, voids, wins, places,
    nap: {
      settled: napSettled,
      wins: napWins,
      places: napPlaces,
      ewPaid: napEwPaid,
      staked: Number(napOut.toFixed(2)),
      returned: Number(napRet.toFixed(2)),
      profit: Number((napRet - napOut).toFixed(2)),
      roi: napOut > 0 ? Number((((napRet - napOut) / napOut) * 100).toFixed(1)) : 0,
      strike: napSettled > 0 ? Number(((napWins / napSettled) * 100).toFixed(1)) : 0,
    },
    avgPrice: priced > 0 ? Number((priceSum / priced).toFixed(2)) : 0,
    strike: settled > 0 ? Number(((wins / settled) * 100).toFixed(1)) : 0,
    // Newest day first, but the day's own order kept inside it.
    //
    // A plain reverse() put the five back-to-front within each day, so the
    // fifth-best bet led and the NAP came last. The published ranking is
    // information — best bet first — and only the days want flipping.
    rows: [...new Set(rows.map((r) => r.date))]
      .sort((a, b) => b.localeCompare(a))
      .flatMap((d) => rows.filter((r) => r.date === d)),
  };

  console.log(
    `${month}: ${settled} settled, ${wins} won, ${places} placed, ` +
    `[NAP ${napWins}/${napSettled}] ` +
    `${profit >= 0 ? "+" : ""}${profit.toFixed(2)}pts (ROI ${payload.roi}%)` +
    (pending ? `, ${pending} still to run` : "") +
    (voids ? `, ${voids} non-runner${voids === 1 ? "" : "s"}` : "")
  );

  // --json writes the exact payload the site will render, for previewing the
  // widget without a plugin upload.
  const out = process.argv.find((a) => a.startsWith("--json="))?.split("=")[1];
  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, JSON.stringify(payload, null, 2));
    console.log(`  payload written to ${out}`);
  }

  const url = process.env.HRT_URL, token = process.env.HRT_TOKEN;
  if (!url || !token) {
    console.log("  HRT_URL/HRT_TOKEN not set — not pushed");
    return;
  }

  await withRetry("push month", async () => {
    const res = await fetch(`${url}/wp-json/hrt/v1/month/${month}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hrt-token": token },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    console.log(`  pushed — ${(await res.json() as any).stored ?? "ok"}`);
  });
}

main();
