/**
 * A conditional logit model over race fields.
 *
 * Plain logistic regression treats every runner as an independent coin flip,
 * which is wrong: exactly one horse wins each race, and a horse's chance
 * depends entirely on who else is in it. A 90-rated horse is a good thing in a
 * bad race and an outsider in a Group 1.
 *
 * Conditional logit models that directly. Each runner gets a score from the
 * same weights, and the probabilities within one race are a softmax over those
 * scores — so they sum to 1 by construction and every runner is judged against
 * its actual opposition. This is the standard formulation for racing, and it
 * needs no library: the gradient is (predicted - actual) times the features,
 * summed over runners.
 *
 * L2 regularisation is on by default. With forty features and tens of thousands
 * of races it is easy to fit noise, and the penalty is what stops a coefficient
 * running away on a rare feature that happened to hit.
 */

export interface Race {
  /** One feature vector per runner. */
  x: number[][];
  /** Index of the winner within `x`. */
  winner: number;
}

export interface FitOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
  /** Print progress every N epochs. 0 disables. */
  verbose?: number;
  seed?: number;
}

/** Softmax over one race's scores. Shifted by the max for numerical safety. */
export function softmax(scores: number[]): number[] {
  const m = Math.max(...scores);
  const e = scores.map((s) => Math.exp(s - m));
  const sum = e.reduce((a, b) => a + b, 0) || 1;
  return e.map((v) => v / sum);
}

export function scoreRunner(w: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * x[i];
  return s;
}

/** Predicted win probabilities for one race, in runner order. */
export function predictRace(w: number[], xs: number[][]): number[] {
  return softmax(xs.map((x) => scoreRunner(w, x)));
}

/**
 * Mean negative log likelihood per race.
 *
 * This is the number to watch. A model that knows nothing scores log(fieldSize)
 * — about 2.3 for a 10-runner race — so anything meaningfully below that is
 * learning something.
 */
export function logLoss(w: number[], races: Race[]): number {
  let total = 0;
  for (const r of races) {
    const p = predictRace(w, r.x);
    total += -Math.log(Math.max(1e-12, p[r.winner]));
  }
  return total / (races.length || 1);
}

/**
 * Fit by full-batch gradient descent with a simple adaptive step.
 *
 * Full batch rather than stochastic: the dataset fits in memory, the gradient
 * is cheap, and determinism makes the result reproducible — which matters when
 * the whole point is to be able to trust the coefficients.
 */
export function fit(races: Race[], opts: FitOptions = {}): { w: number[]; history: number[] } {
  const {
    epochs = 300,
    learningRate = 0.5,
    l2 = 0.01,
    verbose = 0,
  } = opts;

  const nFeatures = races[0]?.x[0]?.length ?? 0;
  if (!nFeatures) throw new Error("no features to fit");

  let w = new Array(nFeatures).fill(0);
  let lr = learningRate;
  let prevLoss = Infinity;
  const history: number[] = [];

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Array(nFeatures).fill(0);

    for (const r of races) {
      const p = predictRace(w, r.x);
      for (let i = 0; i < r.x.length; i++) {
        // d(-loglik)/d(score_i) = p_i - 1{i is winner}
        const d = p[i] - (i === r.winner ? 1 : 0);
        if (d === 0) continue;
        const xi = r.x[i];
        for (let f = 0; f < nFeatures; f++) grad[f] += d * xi[f];
      }
    }

    const n = races.length;
    for (let f = 0; f < nFeatures; f++) grad[f] = grad[f] / n + l2 * w[f];

    const next = w.map((v, f) => v - lr * grad[f]);
    const loss = logLoss(next, races);

    // Back off if a step made things worse, accelerate gently while it works.
    if (loss > prevLoss) {
      lr *= 0.5;
      if (lr < 1e-6) break;
      continue;
    }
    w = next;
    prevLoss = loss;
    lr *= 1.02;
    history.push(loss);

    if (verbose && epoch % verbose === 0) {
      console.log(`    epoch ${String(epoch).padStart(4)}  loss ${loss.toFixed(5)}  lr ${lr.toFixed(4)}`);
    }
    if (history.length > 3 && Math.abs(history.at(-2)! - loss) < 1e-7) break;
  }

  return { w, history };
}

/**
 * How well calibrated is it?
 *
 * Buckets predictions and compares predicted probability with the rate actually
 * observed. A model can rank correctly and still be badly calibrated, and
 * calibration is what matters when the probability is being compared with a
 * price — an overconfident model finds "value" that is not there.
 */
export function calibration(
  preds: Array<{ p: number; won: boolean }>,
  buckets = 10
): Array<{ lo: number; hi: number; n: number; predicted: number; actual: number }> {
  const out: Array<{ lo: number; hi: number; n: number; predicted: number; actual: number }> = [];
  const edges = [0, 0.02, 0.05, 0.08, 0.12, 0.18, 0.25, 0.35, 0.5, 0.7, 1.01];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const inBucket = preds.filter((x) => x.p >= lo && x.p < hi);
    if (!inBucket.length) continue;
    out.push({
      lo, hi,
      n: inBucket.length,
      predicted: inBucket.reduce((a, b) => a + b.p, 0) / inBucket.length,
      actual: inBucket.filter((x) => x.won).length / inBucket.length,
    });
  }
  return out;
}

/**
 * The market's implied probability, with the overround removed.
 *
 * Raw 1/odds across a field sums to more than 1 — that excess is the
 * bookmaker's margin. Comparing our probability against the raw figure would
 * make every runner look like value by roughly the size of the margin, so the
 * book is normalised to sum to 1 first.
 */
export function marketProbabilities(spDecs: Array<number | null>): Array<number | null> {
  const inv = spDecs.map((d) => (d && d > 1 ? 1 / d : null));
  const total = inv.reduce((a: number, b) => a + (b ?? 0), 0);
  if (total <= 0) return spDecs.map(() => null);
  return inv.map((v) => (v === null ? null : v / total));
}
