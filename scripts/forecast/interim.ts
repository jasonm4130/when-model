/**
 * The interim (descriptive) run of docs/release-forecast-2026-11-14.md: builds the lab-day panel
 * from 1 Apr 2026, refits every candidate on an expanding window each forward day, and scores the
 * forward window 28 Sep–13 Nov 2026. Writes data/forward/interim-2026-11-14.json.
 *
 *   pnpm exec tsx scripts/forecast/interim.ts
 */
// @ts-ignore This app deliberately does not ship Node type declarations; this script runs in Node.
import { readFile, writeFile } from 'node:fs/promises';
// @ts-ignore
import { gunzipSync } from 'node:zlib';
// @ts-ignore
import { execFileSync } from 'node:child_process';
import { FRONTIER_LABS, tierMarks, tierOf, type LabId } from '../../src/domain/lab';
import { canonicalModel } from '../../src/domain/model-id';
import { SCORE_FROM } from '../backtest/build';
import { readJson, readRaw } from '../backtest/io';
import { frontierReleases, labReadsAt, replayDrops, replayRungs } from '../backtest/replay';
import {
  auc,
  b0,
  c1,
  c2,
  c3,
  calibration,
  DAY,
  dailyFromP72,
  logScore,
  m0,
  weekBootstrap,
  type Candidate,
  type LabDay,
} from './models';

const LABS = [...FRONTIER_LABS] as string[];
const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

const TRAIN_LAST = day('2026-09-25'); // last complete day before the 26 Sep 00:46Z pull
const MARKET_LAST = day('2026-09-12'); // replay reads censored after pull − 14 days
const FWD_FIRST = day('2026-09-28');
const FWD_LAST = day('2026-11-13');
const CAP_D = 365;
const RESAMPLES = 10_000;
const SEED = 20_261_114;

interface Rel {
  t: number;
  labId: string;
  tier: string;
  skus: string[];
}

/** Pre-April flagships from OpenRouter's whole history, tiered by the registry rules (seed only). */
function seedFlagships(models: Parameters<typeof frontierReleases>[0]): Rel[] {
  const seen = new Map<LabId, Set<string>>();
  const seenFor = (l: LabId) => seen.get(l) ?? seen.set(l, new Set()).get(l)!;
  const canonical = new Map(
    replayDrops(models)
      .filter((d) => !d.stealth && d.textOutput !== false)
      .flatMap((d) => {
        const m = canonicalModel(d.id, { source: 'openrouter', name: d.name });
        return m ? [[d.id, m] as const] : [];
      }),
  );
  const out: Rel[] = [];
  for (const marker of frontierReleases(models, SCORE_FROM)) {
    const placed = marker.models.flatMap((id) => {
      const m = canonical.get(id);
      return m?.labId === marker.labId ? [m] : [];
    });
    if (!placed.length) continue;
    const { tier } = tierOf(marker.labId, placed, seenFor(marker.labId));
    for (const m of placed) for (const k of tierMarks(marker.labId, m)) seenFor(marker.labId).add(k);
    if (tier === 'flagship')
      out.push({ t: marker.t, labId: marker.labId, tier, skus: placed.map((m) => m.sku) });
  }
  return out;
}

interface LiveRow {
  slot: string;
  state: string | null;
  score: number | null;
  labs: Record<string, { p72: [number, boolean] | null; p7: [number, boolean] | null } | undefined>;
}

async function main(
  variant: { name: string; moves?: Record<string, string>; drop?: string[] } = { name: 'primary' },
) {
  const raw = await readRaw();
  const labelled = await readJson<{
    releases: { at: string; labId: string; tier: string; skus: string[] }[];
  }>('data/backtest/labelled-releases.json');
  const forward = await readJson<{ releases: { at: string; labId: string; tier: string; skus: string[] }[] }>(
    'data/forward/forward-releases.json',
  );
  const live = (
    JSON.parse(gunzipSync(await readFile('data/forward/live-reads.json.gz')).toString('utf8')) as {
      rows: LiveRow[];
    }
  ).rows;
  const liveAt = new Map(live.map((r) => [Date.parse(r.slot) / 1000, r]));

  const toRel = (r: { at: string; labId: string; tier: string; skus: string[] }): Rel => ({
    t: Date.parse(variant.moves?.[r.skus[0]] ?? r.at) / 1000,
    labId: r.labId,
    tier: r.tier,
    skus: r.skus,
  });
  const flagships = [
    ...seedFlagships(raw.openrouter),
    ...labelled.releases.map(toRel),
    ...forward.releases.filter((r) => !variant.drop?.includes(r.skus[0])).map(toRel),
  ].filter((r) => (variant.name === 'any-tier' ? true : r.tier === 'flagship'));
  flagships.sort((a, b) => a.t - b.t);

  // Replay market reads at each training day's midnight.
  const settled = replayRungs(raw, { settle: true });
  const pulledAt = Date.parse(raw.pulledAt) / 1000;
  const replayP72 = new Map<number, number[]>();
  for (let t = SCORE_FROM; t <= MARKET_LAST; t += DAY)
    replayP72.set(t, labReadsAt(settled, t, pulledAt, [72]).trusted[0]);
  const REPLAY_LABS = [...FRONTIER_LABS] as string[];

  const panel: LabDay[] = [];
  for (let t = SCORE_FROM; t <= FWD_LAST; t += DAY) {
    const known = t <= TRAIN_LAST || t >= FWD_FIRST;
    for (const labId of LABS) {
      const prior = flagships.filter((r) => r.labId === labId && r.t < t).at(-1);
      const d = prior ? Math.min(CAP_D, (t - prior.t) / DAY) : CAP_D;
      const y = flagships.some((r) => r.labId === labId && r.t >= t && r.t < t + DAY) ? 1 : 0;
      let hMkt: number | undefined;
      let marketFit = true;
      if (t <= MARKET_LAST) {
        const p = replayP72.get(t)![REPLAY_LABS.indexOf(labId)];
        if (p >= 0.001) hMkt = dailyFromP72(p);
      } else if (t >= FWD_FIRST) {
        const row = liveAt.get(t);
        const read = row?.state === 'ok' ? row.labs[labId]?.p72 : undefined;
        if (read && read[1] && read[0] >= 0.001) hMkt = dailyFromP72(read[0]);
      } else marketFit = false;
      panel.push({
        t,
        labId,
        ...(known ? { y } : {}),
        d,
        ...(hMkt !== undefined ? { hMkt } : {}),
        marketFit,
      });
    }
  }

  const candidates: Candidate[] = [b0(), c1(LABS), m0(LABS), c2(LABS), c3(LABS)];
  const target = panel.filter((r) => r.t >= FWD_FIRST && r.t <= FWD_LAST);
  const forecasts: Record<string, number[]> = Object.fromEntries(candidates.map((c) => [c.id, []]));
  const forecasts7: Record<string, number[]> = Object.fromEntries(candidates.map((c) => [c.id, []]));
  for (let t = FWD_FIRST; t <= FWD_LAST; t += DAY) {
    const train = panel.filter((r) => r.t < t && r.y !== undefined);
    const today = target.filter((r) => r.t === t);
    // The 7-day projection: d advances a day at a time, the day-D market read is held.
    const ahead = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      today.map((r) => ({ ...r, t: r.t + i * DAY, d: Math.min(CAP_D, r.d + i) })),
    );
    for (const c of candidates) {
      forecasts[c.id].push(...c.forecast(train, today));
      const hs = ahead.map((rows) => c.forecast(train, rows));
      forecasts7[c.id].push(...today.map((_, j) => 1 - hs.reduce((s, h) => s * (1 - h[j]), 1)));
    }
  }

  // ── outcomes are joined from here on ──
  const y = target.map((r) => r.y!);
  const ls = (id: string) => target.map((r, i) => ({ t: r.t, v: logScore(forecasts[id][i], y[i]) }));
  const diff = (a: string, b: string) => ls(a).map((r, i) => ({ t: r.t, v: r.v - ls(b)[i].v }));
  const primary = weekBootstrap(diff('C3', 'B0'), RESAMPLES, SEED);
  const secondaryRaw = ['C1', 'C2', 'M0'].map((id) => {
    const rows = diff(id, 'B0');
    const boot = weekBootstrap(rows, RESAMPLES, SEED);
    const se = (boot.hi - boot.lo) / (2 * 1.96);
    const z = boot.mean / se;
    const p = 2 * (1 - normalCdf(Math.abs(z)));
    return { id, ...boot, pApprox: p };
  });
  const holm = holmAdjust(secondaryRaw.map((s) => s.pApprox));

  const y7 = target.map((r) =>
    flagships.some((f) => f.labId === r.labId && f.t >= r.t && f.t < r.t + 7 * DAY) ? 1 : 0,
  );
  const full7 = target.map((r) => r.t + 7 * DAY <= FWD_LAST + DAY);
  const brier7 = Object.fromEntries(
    candidates.map((c) => {
      const rows = target.flatMap((_, i) => (full7[i] ? [(forecasts7[c.id][i] - y7[i]) ** 2] : []));
      return [c.id, round(rows.reduce((s, v) => s + v, 0) / rows.length, 5)];
    }),
  );

  const summary = Object.fromEntries(
    candidates.map((c) => {
      const f = forecasts[c.id];
      const total = ls(c.id).reduce((s, r) => s + r.v, 0);
      return [
        c.id,
        {
          meanLogScore: round(total / target.length, 5),
          meanForecast: round(f.reduce((s, v) => s + v, 0) / f.length, 5),
          calibration: mapRound(calibration(f, y), 3),
          reliability: reliability(f, y),
        },
      ];
    }),
  );

  const perLab = Object.fromEntries(
    LABS.map((labId) => {
      const idx = target.flatMap((r, i) => (r.labId === labId ? [i] : []));
      const mean = (id: string) => idx.reduce((s, i) => s + logScore(forecasts[id][i], y[i]), 0) / idx.length;
      return [
        labId,
        {
          events: idx.filter((i) => y[i]).length,
          marketDays: idx.filter((i) => target[i].hMkt !== undefined).length,
          ...Object.fromEntries(
            candidates
              .filter((c) => c.id !== 'B0')
              .map((c) => [`${c.id}-B0`, round(mean(c.id) - mean('B0'), 4)]),
          ),
        },
      ];
    }),
  );

  const events = target.flatMap((r, i) =>
    y[i]
      ? [
          {
            day: iso(r.t),
            labId: r.labId,
            skus: flagships
              .filter((f) => f.labId === r.labId && f.t >= r.t && f.t < r.t + DAY)
              .flatMap((f) => f.skus),
            market: r.hMkt !== undefined,
            ...Object.fromEntries(
              candidates.map((c) => {
                const own = target.flatMap((x, j) => (x.labId === r.labId ? [forecasts[c.id][j]] : []));
                const h = forecasts[c.id][i];
                return [
                  c.id,
                  { h: round(h, 4), pct: round(own.filter((v) => v < h).length / own.length, 2) },
                ];
              }),
            ),
          },
        ]
      : [],
  );

  // DROPCON v3 as a ranker: the daily 00:00Z score against any frontier flagship within 7 days.
  const v3 = [];
  for (let t = FWD_FIRST; t + 7 * DAY <= FWD_LAST + DAY; t += DAY) {
    const row = liveAt.get(t);
    if (row?.score == null) continue;
    v3.push({ s: row.score, y: flagships.some((f) => f.t >= t && f.t < t + 7 * DAY) ? 1 : 0 });
  }

  return {
    meta: {
      spec: 'docs/release-forecast-2026-11-14.md',
      variant: variant.name,
      window: { from: iso(FWD_FIRST), to: iso(FWD_LAST) },
      labDays: target.length,
      flagshipDays: y.reduce<number>((s, v) => s + v, 0),
      weeks: primary.weeks,
      trainingLabDays: panel.filter((r) => r.t < FWD_FIRST && r.y !== undefined).length,
      trainingFlagshipDays: panel.filter((r) => r.t < FWD_FIRST && r.y).length,
      marketTrainingRows: panel.filter((r) => r.t < FWD_FIRST && r.hMkt !== undefined).length,
      forwardMarketRows: target.filter((r) => r.hMkt !== undefined).length,
      seedFlagships: seedFlagships(raw.openrouter).length,
    },
    primary: { comparison: 'C3 − B0, mean log score per lab-day', ...mapRound(primary, 5) },
    secondary: secondaryRaw.map((s, i) => ({
      comparison: `${s.id} − B0`,
      ...mapRound({ mean: s.mean, lo: s.lo, hi: s.hi }, 5),
      pHolm: round(holm[i], 3),
    })),
    summary,
    brier7,
    perLab,
    events,
    v3Auc7d:
      v3.length && v3.some((r) => r.y) && v3.some((r) => !r.y)
        ? round(
            auc(
              v3.map((r) => r.s),
              v3.map((r) => r.y),
            ),
            3,
          )
        : null,
    v3Days: v3.length,
  };
}

function normalCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26 via erf.
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const e =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + e) / 2 : (1 - e) / 2;
}

function holmAdjust(p: number[]): number[] {
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = Array.from({ length: p.length }, () => 0);
  let running = 0;
  order.forEach(([v, i], k) => {
    running = Math.max(running, Math.min(1, v * (p.length - k)));
    out[i] = running;
  });
  return out;
}

function reliability(f: readonly number[], y: readonly number[]) {
  const idx = f.map((_, i) => i).sort((a, b) => f[a] - f[b]);
  const bins = 5;
  return Array.from({ length: bins }, (_, b) => {
    const part = idx.slice(Math.floor((b * idx.length) / bins), Math.floor(((b + 1) * idx.length) / bins));
    return {
      n: part.length,
      events: part.filter((i) => y[i]).length,
      meanForecast: round(part.reduce((s, i) => s + f[i], 0) / part.length, 4),
      observed: round(part.filter((i) => y[i]).length / part.length, 4),
    };
  });
}

const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;
const mapRound = <T extends Record<string, number>>(o: T, n: number) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v, n)])) as T;

const out = {
  primary: await main(),
  sensitivity: {
    limitedAccessTimes: await main({
      name: 'Argon 30 Sep, Carbon 28 Oct',
      moves: { 'gemini-4-argon': '2026-09-30T12:00:00Z', 'gemini-4-carbon': '2026-10-28T12:00:00Z' },
    }),
    hydrogenExcluded: await main({ name: 'Hydrogen excluded', drop: ['gemini-4-hydrogen'] }),
    anyTier: await main({ name: 'any-tier' }),
  },
};
const path = 'data/forward/interim-2026-11-14.json';
await writeFile(path, `${JSON.stringify(out, null, 2)}\n`);
execFileSync('pnpm', ['exec', 'oxfmt', path], { stdio: 'inherit' });
console.log(
  JSON.stringify(
    {
      meta: out.primary.meta,
      primary: out.primary.primary,
      secondary: out.primary.secondary,
      brier7: out.primary.brier7,
    },
    null,
    1,
  ),
);
