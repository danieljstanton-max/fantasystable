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
  /** Went through the race on the bridle. */
  travelledWell: boolean;
  /** Won with something left, or was beaten without being knocked about. */
  easyRide: boolean;
  /** How it failed to complete, if it did. */
  nonCompletionType:
    | "fell" | "brought-down" | "unseated" | "pulled-up" | "refused" | "ran-out" | null;
  /** Fell, was brought down or unseated while still going well. */
  fellGoingWell: boolean;
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
 * Phrases that cancel a staying-on read.
 *
 * Two separate faults were firing here, both found by reading the comments the
 * signal had matched:
 *
 *   1. Substring collisions. "finished well held" contains "finished well", so
 *      a horse beaten out of sight was being read as staying on. So did
 *      "stayed on same gear" and "kept on at one gear", which are the standard
 *      way of saying a horse did not quicken.
 *
 *   2. Trailing qualifiers. "stayed on late but never a threat" says the
 *      opposite of what the match claims.
 *
 * Checked before STAYED_ON, and anywhere in the comment: a horse that dropped
 * back at any point did not finish strongly.
 */
const NOT_STAYING = [
  "well held", "finished well held", "never a threat", "never threatened",
  "never a factor", "never dangerous", "same gear", "one gear", "no impression",
  "made no impression", "dropped back", "dropped away", "weakened", "faded",
  "no extra", "found little", "without threatening", "eased", "no real progress",
  "beaten a long way", "tailed off", "soon beaten", "always behind",
  // Trailing qualifiers: the horse stayed on, and it still made no difference.
  "unable to find more", "could not find more", "couldn't find more",
  "could not match", "couldn't match", "unable to match", "unable to challenge",
  "never able to challenge", "did not quicken", "found nothing", "no response",
  "one pace", "one-paced", "kept on at the same pace", "no impression on the leaders",
  "unable to close", "well beaten", "finished well beaten", "beaten off",
  "not trouble the leaders", "no danger", "outpaced",
  // Dan, 2026-08-30, on Rock of England: "said it was staying on but was it?"
  //
  // No. The comment read "stayed on same speed to finish 4th", and the only
  // one-paced idioms cancelled here were "one pace" and "same gear". The
  // comment writers' actual house style is speed/level/effort, not pace/gear:
  // 1,137 comments say "at one speed", 342 "same speed", 89 "same pace".
  // All of them describe a horse making no impression, and all of them were
  // being read as the opposite.
  "no threat", "never got competitive", "never landed a blow", "no more",
  "nothing left", "laboured", "toiled",
];

/**
 * One-paced running, as a pattern rather than a phrase list.
 *
 * The comment writers cycle a synonym set for "at the same speed" and the list
 * only ever held two of them. Counted across 120,000 comments the tail is:
 * gear 1124, speed 693, rate 558, gait 454+463, effort 305+85, tempo 136+269,
 * pace 236, level 227, gallop, gauge, rhythm, stride, tone. Every one means
 * the horse made no impression. "same position" and "at one fence" are
 * deliberately absent — those are placings and obstacles, not efforts.
 *
 * The qualifier list grew the same way, by counting rather than guessing:
 * "at an unchanged effort" (135), "at an even effort" (238), "steady effort"
 * (91), "unchanged tempo" (37), "even gallop" (27), "steady gallop" (48) all
 * read as staying on and all mean the opposite.
 *
 * "steady progress" is deliberately NOT here. It is the one phrase in that
 * family that is genuinely positive — "made steady progress approaching the
 * final furlong, closed on the winner" — and cancelling it would throw away a
 * real signal to fix a fake one.
 */
const ONE_PACED =
  /\b(?:at\s+)?(?:an?\s+)?(?:one|same|unchanged|even|steady)\s+(?:pace|speed|gear|level|effort|gait|tempo|gallop|gauge|rate|rhythm|tone|stride)\b/;

/**
 * A compromised run. "Run blocked" in Dan's words.
 */
const TROUBLE = [
  "no room", "short of room", "short of racing room", "no racing room",
  "denied a clear run", "denied a run", "nowhere to go", "hampered",
  "badly hampered", "checked", "squeezed out", "squeezed up", "snatched up",
  "blocked", "impeded", "carried wide", "forced wide", "short of a clear run",
  "had to switch", "switched to find room",
  // Dan, 2026-09-04, reading Look Back Smiling's Chepstow run himself:
  // "squeezed for space and lost ground inside the last" was scoring as a
  // plain beaten run. "squeezed out" and "squeezed up" were listed; the far
  // commoner "squeezed for space" was not, so the horse took no credit for an
  // excuse a human could see at a glance.
  "squeezed for space", "squeezed for room", "short of space",
  "unable to obtain a clear run", "never able to challenge for room",
];

/**
 * Ambiguous phrases that only mean interference when nothing else explains it.
 *
 * "Lost momentum" was in TROUBLE outright, and it produced a false positive on
 * Royal Duke: "lost momentum inside final 110yds AND DROPPED AWAY LATE" was
 * read as a compromised run when the same sentence says the horse stopped. It
 * scored +2 for an excuse it did not have, when it should have taken -1 for
 * weakening — a three point swing that moved it up the card.
 *
 * These now only count as trouble when no weakening phrase fires in the same
 * comment. A horse that loses momentum and then finishes is unlucky; one that
 * loses momentum and drops away is beaten.
 */
const WEAK_TROUBLE = ["lost momentum", "lost position", "lost place"];

/** Emptied out. Argues against a step up in trip. */
const FAILED_TO_STAY = [
  "unable to stay", "failed to stay", "began to labour", "laboured",
  "dropped away", "lost touch", "weakened", "tired", "no extra",
  "one paced", "beaten off the pace", "slipped to the back",
  "lost place in a hurry", "emptied",
];

/**
 * Went easily through the race.
 *
 * Dan, 2026-08-27: "if a horse has positive comments like stayed on well, or
 * travelled nicely or wasnt given a hard ride we need to take this into
 * account."
 *
 * Travelling well is not the same as finishing well. A horse cruising into
 * contention and then flattening out is telling you it has the speed but not
 * the stamina, or was short of peak fitness — either way there is usually more
 * to come. Counts verified against the live corpus: "travelling strongly" 61,
 * "travelling well" 59, "moving smoothly" 33, "going well" 23, "cruising" 14.
 *
 * "smoothly" on its own is deliberately excluded — it is most often "jumped
 * smoothly", which is a different observation.
 */
const TRAVELLED_WELL = [
  "travelling well", "travelled well", "travelling strongly", "travelled strongly",
  "moving well", "moving smoothly", "travelled smoothly", "travelling smoothly",
  "going well", "going strongly", "cruising", "travelling kindly", "on the bridle",
];

/**
 * Not given a hard ride — either won with plenty in hand, or was beaten
 * without being persevered with.
 *
 * Both readings matter. A horse that wins hard held has more in hand than the
 * margin shows, which is the same argument as lengths-by-weight. A horse that
 * is beaten and NOT knocked about is one the yard is looking after, which is
 * exactly the pattern behind a mark coming down.
 *
 * "shaken up" (535 occurrences) is deliberately absent: that is the jockey
 * asking, which is the opposite.
 */
const EASY_RIDE = [
  "not persevered", "not knocked about", "not given a hard", "never asked",
  "not asked", "allowed to coast", "eased down", "eased close home",
  "hands and heels", "in hand", "comfortably", "readily", "easily",
  "pushed out", "in command", "won easing",
];

const NON_COMPLETION = [
  "lost rider", "unseated", "fell", "brought down", "refused",
  "pulled up", "ran out", "came down", "came to grief",
];

/**
 * How the horse failed to complete. Ordered so the least ambiguous wins:
 * "brought down" must be tested before "down", "lost rider" before "fell".
 */
const NON_COMPLETION_TYPES: Array<[FormRead["nonCompletionType"], string[]]> = [
  ["brought-down", ["brought down", "came down when hampered"]],
  ["pulled-up", ["pulled up", "eased and pulled up"]],
  ["unseated", ["lost rider", "unseated"]],
  ["fell", ["fell", "came down", "came to grief", "hit obstacle"]],
  ["refused", ["refused"]],
  ["ran-out", ["ran out"]],
];

/**
 * Was it going well when it came down?
 *
 * Dan, 2026-08-27: "if a horse fell when going well or a horse was brought
 * down when going well."
 *
 * A faller is usually treated as no evidence, which is right for a horse that
 * was already beaten — but wrong for one travelling in contention when it hit
 * the deck. That run tells you as much as a placing would, and the market
 * generally forgets it next time.
 *
 * Phrases confirmed in the corpus of non-completion comments: "close up" 153,
 * "in contention" 28, "travelling well" 23, "disputing" 10, "upsides" 9.
 *
 * Pulled up is excluded from this entirely — a horse being pulled up was in
 * trouble, not going well.
 */
const GOING_WELL_AT_THE_TIME = [
  "travelling well", "travelling strongly", "going well", "in contention",
  "upsides", "close up", "still in touch", "still very much involved",
  "disputing", "cruising", "every chance", "led when", "in front when",
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
    failedToStay: false, nonCompletion: false,
    travelledWell: false, easyRide: false,
    nonCompletionType: null, fellGoingWell: false, evidence: [],
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

  // A staying-on phrase only counts when nothing in the comment contradicts it.
  const notStaying = hits(t, NOT_STAYING);
  if (ONE_PACED.test(t)) notStaying.push("one-paced");
  const stayed = notStaying.length ? [] : hits(t, STAYED_ON);
  const failed = hits(t, FAILED_TO_STAY);
  const trouble = hits(t, TROUBLE);
  // Ambiguous phrases only count when the comment does not also say it stopped.
  if (!trouble.length && !failed.length) trouble.push(...hits(t, WEAK_TROUBLE));
  const nonComp = hits(t, NON_COMPLETION);
  const travelled = hits(t, TRAVELLED_WELL);
  const easy = hits(t, EASY_RIDE);

  let ncType: FormRead["nonCompletionType"] = null;
  for (const [type, phrases] of NON_COMPLETION_TYPES) {
    if (hits(t, phrases).length > 0) { ncType = type; break; }
  }

  const goingWell = hits(t, GOING_WELL_AT_THE_TIME);
  const styleWasHandy = ["led", "prominent"].includes(
    (RUN_STYLE.find(([, ps]) => hits(t, ps).length > 0) ?? [null])[0] as string
  );

  // Brought down is never the horse's fault, whatever it was doing at the time.
  const fellGoingWell =
    ncType === "brought-down" ||
    ((ncType === "fell" || ncType === "unseated") &&
      (goingWell.length > 0 || travelled.length > 0 || styleWasHandy));

  evidence.push(
    ...stayed.slice(0, 2), ...trouble.slice(0, 2), ...failed.slice(0, 2),
    ...travelled.slice(0, 1), ...easy.slice(0, 1)
  );

  return {
    runStyle,
    // "stayed on" and "dropped away" can both appear in a long comment. The
    // finishing verdict is whichever comes LAST in the narrative, because the
    // comment runs in race order.
    stayedOn: stayed.length > 0 && lastIndex(t, stayed) > lastIndex(t, failed),
    trouble: trouble.length > 0,
    failedToStay: failed.length > 0 && lastIndex(t, failed) > lastIndex(t, stayed),
    nonCompletion: nonComp.length > 0,
    travelledWell: travelled.length > 0,
    easyRide: easy.length > 0,
    nonCompletionType: ncType,
    fellGoingWell,
    evidence: [...new Set([...evidence, ...goingWell.slice(0, 1)])],
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

/**
 * How a horse habitually runs, across its recent form.
 *
 * Dan, 2026-09-02: "the front-runner comments are not looking at the data.
 * ROGUE REBELLION — how is he the only confirmed front-runner? He has front-run
 * once in 13 races. And HONOUR YOUR DREAMS front-ran last time out."
 *
 * The race shape was built from ONE comment — the most recent run — so a horse
 * that made the running once was "confirmed", and a horse that has led all its
 * life but was held up last time was not. Rogue Rebellion had led 0 times in
 * 13 and was still described as the lone front-runner in a note arguing that
 * an uncontested lead could be decisive.
 *
 * A habit needs repetition: the most common readable style across the last six
 * runs, and only when it appears at least twice AND in at least a third of the
 * runs we can read. One run is an incident, not a habit — and "confirmed" is
 * the wrong word for an incident.
 */
export function runStyleHabit(
  comments: Array<string | null | undefined>,
  look = 6
): { style: RunStyle | null; seen: number; readable: number } {
  const styles = comments
    .slice(0, look)
    .map((c) => readComment(c).runStyle)
    .filter((s): s is RunStyle => s !== null);

  if (!styles.length) return { style: null, seen: 0, readable: 0 };

  const count = new Map<RunStyle, number>();
  for (const s of styles) count.set(s, (count.get(s) ?? 0) + 1);

  let best: RunStyle | null = null;
  let seen = 0;
  for (const [k, n] of count) if (n > seen) { best = k; seen = n; }

  const enough = seen >= 2 && seen / styles.length >= 1 / 3;
  return { style: enough ? best : null, seen, readable: styles.length };
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
