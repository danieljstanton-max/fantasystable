/**
 * Worked examples for the settlement maths.
 *
 *   npm run test:tips
 *
 * No database, no API. If these pass, the public record adds up; if the record
 * is ever disputed, this is the file that answers it.
 */

import { parsePrice, formatPrice, settleTip, computeRecord } from "../lib/tips";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`);
  }
}

console.log("\nparsePrice");
check("7/2", parsePrice("7/2"), 4.5);
check("evens", parsePrice("evens"), 2);
check("1/1", parsePrice("1/1"), 2);
check("11/8", parsePrice("11/8"), 2.375);
check("100/1", parsePrice("100/1"), 101);
check("decimal 4.5", parsePrice("4.5"), 4.5);
check("SP is unsettleable", parsePrice("SP"), null);
check("empty", parsePrice(""), null);
check("nonsense", parsePrice("banana"), null);
check("divide by zero", parsePrice("5/0"), null);

console.log("\nformatPrice");
check("4.5 -> 7/2", formatPrice(4.5), "7/2");
check("2 -> evens", formatPrice(2), "evens");
check("6 -> 5/1", formatPrice(6), "5/1");

console.log("\nsettleTip — win singles");
check(
  "1pt win at 7/2, wins: 3.5pt profit",
  settleTip(
    { betType: "win", stakePoints: 1, advisedPriceDec: 4.5 },
    { isNonRunner: false, positionNum: 1, position: "1" }
  ),
  { status: "won", outlayPoints: 1, returnsPoints: 4.5, profitPoints: 3.5 }
);
check(
  "1pt win, finishes 2nd: full loss",
  settleTip(
    { betType: "win", stakePoints: 1, advisedPriceDec: 4.5 },
    { isNonRunner: false, positionNum: 2, position: "2" }
  ),
  { status: "lost", outlayPoints: 1, returnsPoints: 0, profitPoints: -1 }
);
check(
  "pulled up loses",
  settleTip(
    { betType: "win", stakePoints: 1, advisedPriceDec: 6 },
    { isNonRunner: false, positionNum: null, position: "PU" }
  ),
  { status: "lost", outlayPoints: 1, returnsPoints: 0, profitPoints: -1 }
);

console.log("\nsettleTip — each-way");
// 1pt e/w at 11/1, 5 places, 1/5 odds. Wins.
// Win part:   1 * 12          = 12
// Place part: 1 * (1 + 11*0.2) = 3.2
// Outlay 2, returns 15.2, profit 13.2
check(
  "1pt e/w 11/1 (5 places, 1/5), wins",
  settleTip(
    { betType: "each-way", stakePoints: 1, advisedPriceDec: 12, ewPlaces: 5, ewFraction: 0.2 },
    { isNonRunner: false, positionNum: 1, position: "1" }
  ),
  { status: "won", outlayPoints: 2, returnsPoints: 15.2, profitPoints: 13.2 }
);
// Placed 3rd: place part only. Returns 3.2 against 2pt outlay = +1.2
check(
  "1pt e/w 11/1, finishes 3rd of 5 places",
  settleTip(
    { betType: "each-way", stakePoints: 1, advisedPriceDec: 12, ewPlaces: 5, ewFraction: 0.2 },
    { isNonRunner: false, positionNum: 3, position: "3" }
  ),
  { status: "placed", outlayPoints: 2, returnsPoints: 3.2, profitPoints: 1.2 }
);
// Placed 6th, only 5 paid: loses both parts.
check(
  "1pt e/w, finishes 6th of 5 places",
  settleTip(
    { betType: "each-way", stakePoints: 1, advisedPriceDec: 12, ewPlaces: 5, ewFraction: 0.2 },
    { isNonRunner: false, positionNum: 6, position: "6" }
  ),
  { status: "lost", outlayPoints: 2, returnsPoints: 0, profitPoints: -2 }
);
// A short-priced e/w place can still lose money overall. 2/1 is decimal 3, so
// the place part returns 1 * (1 + (3-1)*0.2) = 1.4 against a 2pt outlay = -0.6.
// This is the case punters get wrong most often: "it placed" is not "it won".
check(
  "e/w place at a short price still loses overall",
  settleTip(
    { betType: "each-way", stakePoints: 1, advisedPriceDec: 3, ewPlaces: 3, ewFraction: 0.2 },
    { isNonRunner: false, positionNum: 2, position: "2" }
  ),
  { status: "placed", outlayPoints: 2, returnsPoints: 1.4, profitPoints: -0.6 }
);

console.log("\nsettleTip — voids and pending");
check(
  "non-runner voids, stake returned",
  settleTip(
    { betType: "win", stakePoints: 1, advisedPriceDec: 4.5 },
    { isNonRunner: true, positionNum: null, position: null }
  ),
  { status: "void", outlayPoints: 1, returnsPoints: 1, profitPoints: 0 }
);
check(
  "e/w non-runner returns both parts",
  settleTip(
    { betType: "each-way", stakePoints: 1, advisedPriceDec: 12, ewPlaces: 5, ewFraction: 0.2 },
    { isNonRunner: true, positionNum: null, position: null }
  ),
  { status: "void", outlayPoints: 2, returnsPoints: 2, profitPoints: 0 }
);
check(
  "no result yet is pending, never a loss",
  settleTip(
    { betType: "win", stakePoints: 1, advisedPriceDec: 4.5 },
    { isNonRunner: false, positionNum: null, position: null }
  ),
  { status: "pending", outlayPoints: 1, returnsPoints: 0, profitPoints: 0 }
);
check(
  "unpriced tip stays pending rather than scoring zero",
  settleTip(
    { betType: "win", stakePoints: 1, advisedPriceDec: null },
    { isNonRunner: false, positionNum: 1, position: "1" }
  ),
  { status: "pending", outlayPoints: 1, returnsPoints: 0, profitPoints: 0 }
);

console.log("\ncomputeRecord");
// 4 bets: one 7/2 winner, three 1pt losers. Staked 4, returned 4.5.
check(
  "1 winner at 7/2 from 4 bets = +12.5% ROI",
  computeRecord([
    { status: "won", outlayPoints: 1, returnsPoints: 4.5, profitPoints: 3.5 },
    { status: "lost", outlayPoints: 1, returnsPoints: 0, profitPoints: -1 },
    { status: "lost", outlayPoints: 1, returnsPoints: 0, profitPoints: -1 },
    { status: "lost", outlayPoints: 1, returnsPoints: 0, profitPoints: -1 },
  ]),
  {
    settled: 4, pending: 0, wins: 1, places: 0, losses: 3, voids: 0,
    stakedPoints: 4, returnedPoints: 4.5, profitPoints: 0.5,
    roiPercent: 12.5, strikeRatePercent: 25,
  }
);
check(
  "voids are excluded from stake and strike rate",
  computeRecord([
    { status: "won", outlayPoints: 1, returnsPoints: 4.5, profitPoints: 3.5 },
    { status: "lost", outlayPoints: 1, returnsPoints: 0, profitPoints: -1 },
    { status: "void", outlayPoints: 1, returnsPoints: 1, profitPoints: 0 },
    { status: "pending", outlayPoints: 1, returnsPoints: 0, profitPoints: 0 },
  ]),
  {
    settled: 2, pending: 1, wins: 1, places: 0, losses: 1, voids: 1,
    stakedPoints: 2, returnedPoints: 4.5, profitPoints: 2.5,
    roiPercent: 125, strikeRatePercent: 50,
  }
);
check(
  "nothing settled yet reports null, not zero",
  computeRecord([{ status: "pending", outlayPoints: 1, returnsPoints: 0, profitPoints: 0 }]),
  {
    settled: 0, pending: 1, wins: 0, places: 0, losses: 0, voids: 0,
    stakedPoints: 0, returnedPoints: 0, profitPoints: 0,
    roiPercent: null, strikeRatePercent: null,
  }
);

console.log(
  failures === 0
    ? "\nAll settlement checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
