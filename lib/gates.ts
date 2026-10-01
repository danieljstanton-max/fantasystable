/**
 * Dan's rules, enforced in one place.
 *
 * They were enforced in four: the main selection path, the no-signal fallback,
 * the maiden/novice path, and the best-bets list. Each one implemented them
 * slightly differently, and over one week in late September each was found to
 * be missing one:
 *
 *   2026-09-18  the no-signal fallback took the market favourite from the whole
 *               field and consulted no gate at all — DONTLOOKANYFURTHER, a
 *               two-time winner up 13lb, went out as the tip.
 *   2026-09-20  hand vetoes applied to the best-bets list and not to the race
 *               page, so the card set IMPRESSOR aside and the race page went on
 *               tipping him.
 *   2026-09-24  the unexposed-race path filtered on the ground rule only, so a
 *               streak horse and a vetoed horse could both be selected there.
 *   2026-09-25  the same path's stand-down was applied per shortlist, putting a
 *               gated horse back when a clean one was available in the race.
 *
 * None of those were disagreements about the rules. They were the same rules
 * written out four times, and three copies drifting. A path that does not call
 * this cannot select, because there is nothing else to call.
 *
 * Dan, 2026-10-02: "these are silly mistakes that can't happen, I can't check
 * every race every day."
 */
import { groundGate, streakGate, type PastRun } from "./selection";
import type { GoingBand } from "./going";
import { isVetoed, type Veto } from "./vetoes";

/** Why a horse cannot be the selection. Every field null means it can. */
export interface GateReasons {
  /** Dan's ground rule: on soft or heavy it must have won or placed on it. */
  ground: string | null;
  /** Dan's streak rule: no 3-timers, and a recent winner only off a similar mark. */
  streak: string | null;
  /** A dated hand veto from VETOES.txt. */
  veto: string | null;
}

export interface GatedField<T> {
  /** Reasons by horse id, for every runner — including the ones that pass. */
  reasons: Map<string, GateReasons>;
  /** Does this runner clear every gate? */
  passes: (x: T) => boolean;
  /** The runners that clear every gate, in the order given. */
  cleared: T[];
  /**
   * Is ANY runner in this race clean?
   *
   * The stand-down is a property of the race, not of a shortlist. Asking it per
   * list put CASTLEMONT back in the 15:35 Newmarket on 2026-09-25 because the
   * hot-yard list happened to hold only gated horses, while ARCHERS BAY passed
   * every gate in the same race.
   */
  anyClean: boolean;
  /** The first reason this runner fails, for printing. Null when it passes. */
  reasonFor: (x: T) => string | null;
}

/**
 * Run every gate over a field.
 *
 * `read` adapts whatever shape the caller holds a runner in; both scripts carry
 * the runner and its history differently and neither should have to change to
 * use this.
 */
export function gateField<T>(
  field: T[],
  read: (x: T) => {
    horseId: string;
    horseName: string;
    ofr: number | null;
    history: PastRun[];
  },
  race: { goingBand: GoingBand; raceType: string | null },
  vetoes: Map<string, Veto>
): GatedField<T> {
  const reasons = new Map<string, GateReasons>();

  for (const x of field) {
    const r = read(x);
    const veto = isVetoed(vetoes, r.horseName);
    reasons.set(r.horseId, {
      ground: groundGate(r.history, race.goingBand),
      streak: streakGate(r.history, r.ofr, race.raceType),
      veto: veto ? veto.reason : null,
    });
  }

  const reasonFor = (x: T): string | null => {
    const g = reasons.get(read(x).horseId);
    if (!g) return null;
    // Veto first: it is Dan's own instruction and outranks a computed gate.
    return g.veto ?? g.streak ?? g.ground ?? null;
  };
  const passes = (x: T) => reasonFor(x) === null;

  const cleared = field.filter(passes);
  return { reasons, passes, cleared, anyClean: cleared.length > 0, reasonFor };
}
