/**
 * Reading in-running comments.
 *
 * The Racing API returns narrative comments per runner, e.g.
 *
 *   "Settled at the back early - made progress from 4f out to be third with
 *    over 2f left - hit the front a furlong out - stayed on well"
 *
 * Four things are extracted, and each one answers a question Dan actually asks
 * when reading a race:
 *
 *   runStyle        does this horse lead, race handy, or get held up?
 *                   -> pace shape. A lone front-runner is systematically
 *                      underbet; a race full of them collapses.
 *   stayedOn        was it finishing strongly when beaten?
 *                   -> a horse staying on over 6f is a POSITIVE at 7f, not an
 *                      unknown. This overrides "unproven at the trip".
 *   trouble         was the run compromised?
 *                   -> "run blocked". Overrides a bad finishing position.
 *   failedToStay    did it empty out?
 *                   -> the opposite signal. A horse that laboured over 7f is
 *                      not a step-up-in-trip candidate.
 *
 * VALIDATION STATUS: the phrase lists below were checked against live results
 * comments (probe 2026-08-26) but that sample was only 36 comments over 5
 * races. Several phrases known to occur in British form comments ("no room",
 * "hampered", "denied a clear run") did not appear in a sample that small.
 * Re-run `npm run test:form` against a proper backfill before trusting the
 * trouble detection to gate selections.
 */

export type RunStyle = "led" | "prominent" | "midfield" | "held-up";

export interface FormRead {
  runStyle: RunStyle | null;
  stayedOn: boolean;
  trouble: boolean;
  failedToStay: boolean;
  nonCompletion: boolean;
  /** The phrases that fired, so a write-up can quote its own evidence. */
  evidence: string[];
}

/**
 * Ordered most specific first — "went straight to the front" must win over the
 * bare "front", and "held up" over "handy".
 */
const RUN_STYLE: Array<[RunStyle, string[]]> = [
  ["led", [
    "went straight to the front", "went straight to front", "straight to the lead",
    "set the pace", "made the running", "made all", "led early", "set off in front",
    "disputed the lead", "dictated",
  ]],
  ["held-up", [
    "held up towards the back", "held up in the pack", "held up", "settled at the back",
    "settled towards the back", "settled at back", "towards the rear", "in rear",
    "dropped in", "settled in last",
  ]],
  ["prominent", [
    "handy", "prominent", "chased the leader", "settled in second",
    "close up", "tracked the leader", "raced keenly in second",
  ]],
  ["midfield", [
    "settled in the pack", "settled in mid-division", "mid-division", "midfield",
    "in the pack early", "settled midway", "middle of the pack",
  ]],
];

/** Finishing strongly. The signal that excuses an unproven trip. */
const STAYED_ON = [
  "stayed on well", "stayed on strongly", "stayed on", "staying on",
  "kept on well", "kept on", "finished strongly", "finished well",
  "ran on well", "ran on", "rallied", "fought back", "fought on",
  "responded to keep", "closed on the front", "closed on",
  "plugged on", "never stopped trying", "eye-catching late",
];

/**
 * A compromised run. "Run blocked" in Dan's words.
 *
 * `lost momentum` is deliberately included but is weaker evidence than the
 * others — it can describe a horse simply weakening. It is reported so it can
 * be weighted separately rather than treated as proof of interference.
 */
const TROUBLE = [
  "no room", "short of room", "short of racing room", "no racing room",
  "denied a clear run", "denied a run", "nowhere to go", "hampered",
  "badly hampered", "checked", "squeezed out", "squeezed up", "snatched up",
  "blocked", "impeded", "carried wide", "forced wide", "short of a clear run",
  "had to switch", "switched to find room", "lost momentum",
];

/** Emptied out. Argues against a step up in trip. */
const FAILED_TO_STAY = [
  "unable to stay", "failed to stay", "began to labour", "laboured",
  "dropped away", "lost touch", "weakened", "tired", "no extra",
  "one paced", "beaten off the pace", "slipped to the back",
  "lost place in a hurry", "emptied",
];

const NON_COMPLETION = [
  "lost rider", "unseated", "fell", "brought down", "refused",
  "pulled up", "ran out",
];

function hits(text: string, phrases: string[]): string[] {
  const out: string[] = [];
  for (const p of phrases) if (text.includes(p)) out.push(p);
  return out;
}

/**
 * Parse one in-running comment.
 *
 * Returns nulls and falses for an empty comment rather than throwing — a
 * missing comment is common and simply means no signal, not an error.
 */
export function readComment(comment: string | null | undefined): FormRead {
  const empty: FormRead = {
    runStyle: null, stayedOn: false, trouble: false,
    failedToStay: false, nonCompletion: false, evidence: [],
  };
  if (!comment) return empty;

  const t = comment.toLowerCase();
  const evidence: string[] = [];

  let runStyle: RunStyle | null = null;
  for (const [style, phrases] of RUN_STYLE) {
    const found = hits(t, phrases);
    if (found.length > 0) {
      runStyle = style;
      evidence.push(found[0]);
      break;
    }
  }

  const stayed = hits(t, STAYED_ON);
  const trouble = hits(t, TROUBLE);
  const failed = hits(t, FAILED_TO_STAY);
  const nonComp = hits(t, NON_COMPLETION);

  evidence.push(...stayed.slice(0, 2), ...trouble.slice(0, 2), ...failed.slice(0, 2));

  return {
    runStyle,
    // "stayed on" and "dropped away" can both appear in a long comment. The
    // finishing verdict is whichever comes LAST in the narrative, because the
    // comment runs in race order.
    stayedOn: stayed.length > 0 && lastIndex(t, stayed) > lastIndex(t, failed),
    trouble: trouble.length > 0,
    failedToStay: failed.length > 0 && lastIndex(t, failed) > lastIndex(t, stayed),
    nonCompletion: nonComp.length > 0,
    evidence: [...new Set(evidence)],
  };
}

function lastIndex(text: string, phrases: string[]): number {
  let best = -1;
  for (const p of phrases) {
    const i = text.lastIndexOf(p);
    if (i > best) best = i;
  }
  return best;
}

/**
 * Dan's rule, stated 2026-08-26:
 *
 *   "unproven on ground and trip [rules a horse out], but include if staying
 *    on well in previous races and say 'run blocked' or something along those
 *    lines."
 *
 * So an unproven horse is not dismissed outright. It survives if its recent
 * runs show it was finishing strongly or was denied a clear run — evidence the
 * bare finishing position understates it.
 */
export interface ExcuseCheck {
  /** True when the horse should stay in contention despite being unproven. */
  excused: boolean;
  reason: "stayed-on" | "trouble-in-running" | null;
  evidence: string[];
}

export function excuseUnproven(recentComments: Array<string | null | undefined>): ExcuseCheck {
  const evidence: string[] = [];
  let sawStayedOn = false;
  let sawTrouble = false;

  for (const c of recentComments) {
    const r = readComment(c);
    if (r.nonCompletion) continue; // a faller tells us nothing about stamina
    if (r.stayedOn) { sawStayedOn = true; evidence.push(...r.evidence); }
    if (r.trouble) { sawTrouble = true; evidence.push(...r.evidence); }
  }

  // Staying on is the stronger of the two: it speaks directly to the trip,
  // whereas trouble only says the finishing position was unrepresentative.
  const reason = sawStayedOn ? "stayed-on" : sawTrouble ? "trouble-in-running" : null;

  return {
    excused: reason !== null,
    reason,
    evidence: [...new Set(evidence)].slice(0, 4),
  };
}

/**
 * Pace shape for a whole race.
 *
 * A lone confirmed front-runner in a field of hold-up horses is one of the
 * most reliably underpriced situations in racing. Four of them guarantees a
 * collapse and hands the race to a closer.
 */
export interface PaceShape {
  leaders: number;
  prominent: number;
  heldUp: number;
  /** "lone-leader" | "contested" | "collapse-likely" | "unknown" */
  verdict: "lone-leader" | "contested" | "collapse-likely" | "unknown";
}

export function racePaceShape(styles: Array<RunStyle | null>): PaceShape {
  const leaders = styles.filter((s) => s === "led").length;
  const prominent = styles.filter((s) => s === "prominent").length;
  const heldUp = styles.filter((s) => s === "held-up").length;
  const known = styles.filter(Boolean).length;

  let verdict: PaceShape["verdict"] = "unknown";
  if (known >= 4) {
    if (leaders === 1) verdict = "lone-leader";
    else if (leaders >= 3) verdict = "collapse-likely";
    else verdict = "contested";
  }

  return { leaders, prominent, heldUp, verdict };
}
