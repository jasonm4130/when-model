/**
 * The candidates of docs/release-forecast-2026-11-14.md, as pure functions over a lab-day panel:
 * MAP logistic fits with fixed Gaussian priors (Newton's method), the rolling baseline B0, and the
 * scoring helpers. No I/O, no clock.
 */

export const DAY = 86_400;
export const SCORE_CLIP = 0.001;
/** h_mkt is clipped before its logit so a quoted 0 does not become −∞. */
export const LOGIT_CLIP = 1e-4;

export interface LabDay {
  /** UTC midnight of day D, epoch seconds. */
  t: number;
  labId: string;
  /** 1 when the lab's flagship was first seen on day D; undefined while unknown. */
  y?: 0 | 1;
  /** Days since the lab's last flagship, as of D 00:00Z, capped at 365. */
  d: number;
  /** Daily market hazard from the trusted p72, when a market exists on D. */
  hMkt?: number;
  /** Whether the row may enter market-parameter fits (false for the censored 13–25 Sep stretch). */
  marketFit: boolean;
}

export const clip = (p: number, eps: number) => Math.min(1 - eps, Math.max(eps, p));
export const logit = (p: number, eps = LOGIT_CLIP) => {
  const q = clip(p, eps);
  return Math.log(q / (1 - q));
};
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const dailyFromP72 = (p72: number) => 1 - (1 - p72) ** (1 / 3);

export interface Prior {
  mean: number;
  sd: number;
}

/** Solves A x = b by Gaussian elimination with partial pivoting (A is small and positive definite). */
export function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = Array.from({ length: n }, () => 0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

/** MAP logistic regression: maximises the log likelihood plus independent Gaussian log priors. */
export function fitMap(x: readonly number[][], y: readonly number[], priors: readonly Prior[]): number[] {
  const k = priors.length;
  let w = priors.map((p) => p.mean);
  for (let iter = 0; iter < 100; iter++) {
    const g = priors.map((p, j) => -(w[j] - p.mean) / p.sd ** 2);
    const h = priors.map((p, i) => priors.map((_, j) => (i === j ? 1 / p.sd ** 2 : 0)));
    for (let r = 0; r < x.length; r++) {
      const row = x[r];
      let z = 0;
      for (let j = 0; j < k; j++) z += row[j] * w[j];
      const p = sigmoid(z);
      const v = p * (1 - p);
      for (let i = 0; i < k; i++) {
        if (row[i] === 0) continue;
        g[i] += row[i] * (y[r] - p);
        for (let j = 0; j < k; j++) h[i][j] += row[i] * row[j] * v;
      }
    }
    const step = solve(h, g);
    w = w.map((wi, j) => wi + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return w;
}

export const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, ai, i) => s + ai * b[i], 0);

// ─────────────────────────────── candidates ───────────────────────────────

export interface Candidate {
  id: string;
  /** Forecasts for the target rows, fitted on `train` (every row has a known y). */
  forecast(train: readonly LabDay[], target: readonly LabDay[]): number[];
}

const PRIOR_ALPHA: Prior = { mean: -4, sd: 2 };
const PRIOR_U: Prior = { mean: 0, sd: 1 };
const PRIOR_BETA: Prior = { mean: 0, sd: 1 };

function hazardRow(r: LabDay, labs: readonly string[]): number[] {
  return [1, ...labs.map((l) => (l === r.labId ? 1 : 0)), Math.log1p(r.d)];
}

export function c1(labs: readonly string[]): Candidate {
  const priors = [PRIOR_ALPHA, ...labs.map(() => PRIOR_U), PRIOR_BETA];
  return {
    id: 'C1',
    forecast(train, target) {
      const w = fitMap(
        train.map((r) => hazardRow(r, labs)),
        train.map((r) => r.y!),
        priors,
      );
      return target.map((r) => sigmoid(dot(w, hazardRow(r, labs))));
    },
  };
}

export function m0(labs: readonly string[]): Candidate {
  const fallback = c1(labs);
  return {
    id: 'M0',
    forecast(train, target) {
      const f = fallback.forecast(train, target);
      return target.map((r, i) => (r.hMkt !== undefined ? r.hMkt : f[i]));
    },
  };
}

export function c2(labs: readonly string[]): Candidate {
  const fallback = c1(labs);
  const priors: Prior[] = [
    { mean: 0, sd: 1 },
    { mean: 1, sd: 0.5 },
  ];
  return {
    id: 'C2',
    forecast(train, target) {
      const f = fallback.forecast(train, target);
      const rows = train.filter((r) => r.hMkt !== undefined && r.marketFit);
      const w = fitMap(
        rows.map((r) => [1, logit(r.hMkt!)]),
        rows.map((r) => r.y!),
        priors,
      );
      return target.map((r, i) => (r.hMkt !== undefined ? sigmoid(w[0] + w[1] * logit(r.hMkt)) : f[i]));
    },
  };
}

function blendRow(r: LabDay, labs: readonly string[]): number[] {
  const m = r.hMkt !== undefined ? 1 : 0;
  return [...hazardRow(r, labs), m, m ? logit(r.hMkt!) : 0];
}

export function c3(labs: readonly string[]): Candidate {
  const priors = [
    PRIOR_ALPHA,
    ...labs.map(() => PRIOR_U),
    PRIOR_BETA,
    { mean: 0, sd: 1 },
    { mean: 0, sd: 1 },
  ];
  return {
    id: 'C3',
    forecast(train, target) {
      const rows = train.filter((r) => r.marketFit);
      const w = fitMap(
        rows.map((r) => blendRow(r, labs)),
        rows.map((r) => r.y!),
        priors,
      );
      return target.map((r) => sigmoid(dot(w, blendRow(r, labs))));
    },
  };
}

/** B0: the lab's trailing 90-day flagship-day rate, shrunk to the pooled rate with m = 90 lab-days. */
export function b0(): Candidate {
  const WINDOW = 90;
  const M = 90;
  return {
    id: 'B0',
    forecast(train, target) {
      return target.map((r) => {
        const recent = train.filter((x) => x.t < r.t && x.t >= r.t - WINDOW * DAY);
        const own = recent.filter((x) => x.labId === r.labId);
        const pool = recent.length ? recent.reduce((s, x) => s + x.y!, 0) / recent.length : 0;
        const k = own.reduce((s, x) => s + x.y!, 0);
        return (k + M * pool) / (own.length + M);
      });
    },
  };
}

// ─────────────────────────────── scoring ───────────────────────────────

export const logScore = (h: number, y: number) => {
  const p = clip(h, SCORE_CLIP);
  return y ? Math.log(p) : Math.log(1 - p);
};

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO week key (Monday start) of an epoch-seconds instant. */
export function isoWeek(t: number): string {
  const d = new Date(t * 1000);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/**
 * Mean of per-row values and its 95% interval from a bootstrap over week blocks: each resample draws
 * as many weeks as there are, with replacement, and averages every row in the drawn weeks.
 */
export function weekBootstrap(
  rows: readonly { t: number; v: number }[],
  resamples: number,
  seed: number,
): { mean: number; lo: number; hi: number; weeks: number } {
  const byWeek = new Map<string, number[]>();
  for (const r of rows) byWeek.set(isoWeek(r.t), [...(byWeek.get(isoWeek(r.t)) ?? []), r.v]);
  const weeks = [...byWeek.values()];
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[Math.floor(rand() * weeks.length)];
      for (const v of w) s += v;
      n += w.length;
    }
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const mean = rows.reduce((s, r) => s + r.v, 0) / rows.length;
  return {
    mean,
    lo: means[Math.floor(0.025 * resamples)],
    hi: means[Math.ceil(0.975 * resamples) - 1],
    weeks: weeks.length,
  };
}

/** Calibration intercept (logit offset) and slope, by MLE with flat-ish priors. */
export function calibration(
  h: readonly number[],
  y: readonly number[],
): { intercept: number; slope: number } {
  const z = h.map((p) => logit(p, SCORE_CLIP));
  const [, b] = fitMap(
    z.map((zi) => [1, zi]),
    y,
    [
      { mean: 0, sd: 100 },
      { mean: 1, sd: 100 },
    ],
  );
  // Intercept-only fit with logit h as an offset: shift the offset column by fixing its weight to 1.
  let c = 0;
  for (let iter = 0; iter < 100; iter++) {
    let g = 0;
    let hh = 1e-6;
    for (let i = 0; i < z.length; i++) {
      const p = sigmoid(c + z[i]);
      g += y[i] - p;
      hh += p * (1 - p);
    }
    c += g / hh;
    if (Math.abs(g / hh) < 1e-10) break;
  }
  return { intercept: c, slope: b };
}

/** Mann–Whitney AUC of scores against binary outcomes (ties count half). */
export function auc(scores: readonly number[], y: readonly number[]): number {
  let pos = 0;
  let neg = 0;
  let s = 0;
  for (let i = 0; i < scores.length; i++)
    for (let j = 0; j < scores.length; j++) {
      if (y[i] !== 1 || y[j] !== 0) continue;
      s += scores[i] > scores[j] ? 1 : scores[i] === scores[j] ? 0.5 : 0;
    }
  for (const v of y)
    if (v) pos++;
    else neg++;
  return s / (pos * neg);
}
