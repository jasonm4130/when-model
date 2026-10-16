import { beforeAll, describe, expect, it } from 'vitest';
import type { RawPulls } from '../../scripts/backtest/build';
import { readJson, readRaw } from '../../scripts/backtest/io';
import {
  buildLabelledReleases,
  detectorExceptions,
  ledgerRowsFromListings,
  type LabelledReleases,
} from '../../scripts/backtest/labels';
import type { Replay } from '../../scripts/backtest/replay';
import { TIER_REVIEW } from '../../scripts/backtest/tier-review';
import { TIER_OVERRIDES } from '../../src/domain/lab';

let raw: RawPulls;
let labelled: LabelledReleases;
beforeAll(async () => {
  raw = await readRaw();
  labelled = buildLabelledReleases(raw.openrouter, raw.pulledAt);
});

describe('labelled releases', () => {
  it('is what pnpm backtest:replay wrote', async () => {
    expect(await readJson('data/backtest/labelled-releases.json')).toEqual(
      JSON.parse(JSON.stringify(labelled)),
    );
  });

  it('labels exactly the 45 v3-replay markers', async () => {
    const replay = await readJson<Replay>('data/backtest/v3-replay.json');
    expect(labelled.releases.map((r) => [r.at, r.labId, r.models])).toEqual(
      replay.releases.markers.map((m) => [m.at, m.labId, m.models]),
    );
    expect(labelled.counts.releases).toBe(45);
  });

  it('tiers every release as the review did: 24 flagship, 21 minor', () => {
    expect(labelled.releases.map((r) => `${r.at} ${r.labId} ${r.tier}`)).toEqual(
      TIER_REVIEW.map((r) => `${r.at} ${r.labId} ${r.tier}`),
    );
    expect(labelled.counts).toMatchObject({ flagship: 24, minor: 21, ambiguous: 15 });
    expect(labelled.releases.map((r) => r.ambiguous)).toEqual(TIER_REVIEW.map((r) => r.ambiguous));
  });

  it('decides by override only where the review asked, and carries the reason', () => {
    const overridden = labelled.releases.filter((r) => r.rules.includes('override'));
    expect(overridden.map((r) => r.skus)).toEqual([['qwen3.8-max@0902'], ['qwen3.8-max-prime']]);
    expect(overridden.flatMap((r) => r.overrides)).toEqual(
      TIER_OVERRIDES.map((o) => ({ sku: o.sku, reason: o.reason })),
    );
    expect(labelled.overrides.every((o) => o.reason.length > 0)).toBe(true);
  });

  it('reproduces every marker time with the ledger detector but one, which it names', () => {
    // Muse Spark 1.2 Contributor canonicalises to muse-spark-1.2, first available on 2026-08-05: to
    // the ledger it is the same model, not a release of its own. It stays minor either way.
    expect(labelled.detectorExceptions).toEqual([
      {
        at: '2026-08-21T18:21:16Z',
        labId: 'meta',
        models: ['meta/muse-spark-1.2-contributor'],
        kind: 'missing',
      },
    ]);
    expect(labelled.counts.detectorReproduced).toBe(44);
    expect(labelled.releases.find((r) => !r.detector)).toMatchObject({
      skus: ['muse-spark-1.2'],
      tier: 'minor',
    });
  });

  it('reproduces every frontier marker of the whole OpenRouter history but two, which it names', () => {
    // 128 markers from 2023 on, through Qwen's YYMM snapshots (qwen3-235b-a22b-2507), VL lines,
    // active-parameter ids with -thinking, and suffix revisions (V3.1-Terminus, -customtools). The
    // two left fold into an earlier sku by design: -instruct is packaging (Qwen's -Instruct is its
    // default release), and a Contributor is its Muse Spark's cheaper tier.
    const until = Math.floor(Date.parse(raw.pulledAt) / 1000);
    expect(detectorExceptions(raw.openrouter, 0, until)).toEqual([
      {
        at: '2023-09-28T00:00:00Z',
        labId: 'openai',
        models: ['openai/gpt-3.5-turbo-instruct'],
        kind: 'missing',
      },
      {
        at: '2026-08-21T18:21:16Z',
        labId: 'meta',
        models: ['meta/muse-spark-1.2-contributor'],
        kind: 'missing',
      },
    ]);
  });

  it('times each sku by its earliest listing, across :free twins and renamed ids', () => {
    const rows = ledgerRowsFromListings([
      { id: 'qwen/qwen3.8-27b', name: 'Qwen: Qwen3.8 27B', created: 2000, canonical: '' },
      { id: 'qwen/qwen3.8-27b:free', name: 'Qwen: Qwen3.8 27B (free)', created: 1000, canonical: '' },
      { id: 'stealth/ox-alpha', name: 'Ox Alpha', created: 500, canonical: '' },
      { id: 'nvidia/nemotron-5', name: 'NVIDIA: Nemotron 5', created: 500, canonical: '' },
    ]);
    expect(rows).toEqual([
      {
        labId: 'qwen',
        sku: 'qwen3.8-27b',
        firstAvailableAt: '1970-01-01T00:16:40.000Z',
        source: 'openrouter',
        baseline: false,
      },
    ]);
  });
});
