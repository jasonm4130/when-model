/**
 * The labelled release history the forecast is judged on: the 45 in-window v3-replay markers (the
 * frontier OpenRouter release events of 2026-04-01 to 2026-09-26), canonicalised by
 * `src/domain/model-id.ts`, tiered by the lab registry's rules plus `TIER_OVERRIDES`, and joined
 * to the tier review (`tier-review.ts`). It also runs the availability ledger's detector,
 * `releaseEventsFromLedger`, over the same listings with OpenRouter's `created` standing in for our
 * first sighting, and names every marker it does not reproduce. Pure; `pnpm backtest:replay`
 * writes the result to data/backtest/labelled-releases.json.
 */
import {
  releaseEventsFromLedger,
  RELEASE_DETECTOR_VERSION,
  type AvailabilityRow,
} from '../../src/domain/availability';
import { tierMarks, tierOf, TIER_OVERRIDES, type LabId, type Tier } from '../../src/domain/lab';
import { canonicalModel, type CanonicalModel } from '../../src/domain/model-id';
import { SCORE_FROM } from './build';
import type { OpenRouterModel } from './events';
import { HOUR, iso } from './markets';
import { frontierReleases, replayDrops } from './replay';
import { TIER_REVIEW } from './tier-review';

export const LABELS_VERSION = 1;

/** One labelled release. */
export interface LabelledRelease {
  at: string;
  labId: LabId;
  /** The OpenRouter ids the replay grouped into the release. */
  models: string[];
  /** Their canonical skus, in the same order. */
  skus: string[];
  tier: Tier;
  /** The registry rules that decided, or `override`. */
  rules: string[];
  /** The overrides that decided, with their reasons. */
  overrides: { sku: string; reason: string }[];
  /** The review's own call: ambiguous when a reasonable reader could tier it the other way. */
  ambiguous: boolean;
  note?: string;
  /** Whether the ledger's detector forms an event for this lab at this time. */
  detector: boolean;
}

/** A marker the detector does not reproduce, or an event it forms that no marker has. */
export interface DetectorException {
  at: string;
  labId: LabId;
  models: string[];
  kind: 'missing' | 'extra';
}

/** Every OpenRouter text listing that names a model, keyed by the name OpenRouter shows. */
function canonicalListings(models: readonly OpenRouterModel[]): Map<string, CanonicalModel> {
  const out = new Map<string, CanonicalModel>();
  for (const drop of replayDrops(models)) {
    if (drop.stealth || drop.textOutput === false) continue;
    const model = canonicalModel(drop.id, { source: 'openrouter', name: drop.name });
    if (model) out.set(drop.id, model);
  }
  return out;
}

/**
 * The ledger rows the listings would have written, had the ledger been running: one per (lab,
 * sku), timed by its earliest `created`, none of them baseline.
 */
export function ledgerRowsFromListings(
  models: readonly OpenRouterModel[],
): Pick<AvailabilityRow, 'labId' | 'sku' | 'firstAvailableAt' | 'source' | 'baseline'>[] {
  const canonical = canonicalListings(models);
  const rows = new Map<string, { labId: LabId; sku: string; t: number }>();
  for (const m of models) {
    const model = canonical.get(m.id);
    if (!model) continue;
    const key = `${model.labId} ${model.sku}`;
    const prior = rows.get(key);
    if (!prior || m.created < prior.t) rows.set(key, { labId: model.labId, sku: model.sku, t: m.created });
  }
  return [...rows.values()].map((r) => ({
    labId: r.labId,
    sku: r.sku,
    firstAvailableAt: new Date(r.t * 1000).toISOString(),
    source: 'openrouter',
    baseline: false,
  }));
}

/**
 * The frontier release events the ledger's detector forms from the listings, and the replay markers
 * of the same window (`from` < t ≤ `until`, unix seconds), keyed `<lab> <t>` so each side can name
 * what the other lacks.
 */
function detectorEvents(models: readonly OpenRouterModel[], from: number, until: number) {
  const markers = frontierReleases(models, until).filter((r) => r.t > from && r.t <= until);
  const events = releaseEventsFromLedger(ledgerRowsFromListings(models), until * 1000).filter((e) => {
    const t = Date.parse(e.firstAvailableAt) / 1000;
    return e.frontier && t > from && t <= until;
  });
  const eventKeys = new Set(events.map((e) => `${e.labId} ${Date.parse(e.firstAvailableAt) / 1000}`));
  const markerKeys = new Set(markers.map((m) => `${m.labId} ${m.t}`));
  return { markers, events, eventKeys, markerKeys };
}

/**
 * Every replay marker in the window the detector does not reproduce, and every event it forms that
 * no marker has. `buildLabelledReleases` reads the scored window; the test also runs it over the
 * whole OpenRouter history, where the canonicaliser meets years of naming conventions.
 */
export function detectorExceptions(
  models: readonly OpenRouterModel[],
  from: number,
  until: number,
): DetectorException[] {
  const { markers, events, eventKeys, markerKeys } = detectorEvents(models, from, until);
  return [
    ...markers
      .filter((m) => !eventKeys.has(`${m.labId} ${m.t}`))
      .map((m) => ({ at: iso(m.t), labId: m.labId, models: m.models, kind: 'missing' as const })),
    ...events
      .filter((e) => !markerKeys.has(`${e.labId} ${Date.parse(e.firstAvailableAt) / 1000}`))
      .map((e) => ({
        at: iso(Date.parse(e.firstAvailableAt) / 1000),
        labId: e.labId,
        models: e.skus,
        kind: 'extra' as const,
      })),
  ];
}

export function buildLabelledReleases(models: readonly OpenRouterModel[], pulledAt: string) {
  const until = Math.floor(Date.parse(pulledAt) / 1000 / HOUR) * HOUR;
  const from = SCORE_FROM;
  const { markers, eventKeys } = detectorEvents(models, from, until);
  const canonical = canonicalListings(models);

  // What each lab had shipped before the window: the tier rules' "first of its line" state.
  const seen = new Map<LabId, Set<string>>();
  const seenFor = (labId: LabId) => seen.get(labId) ?? seen.set(labId, new Set()).get(labId)!;
  for (const m of models) {
    const model = canonical.get(m.id);
    if (model && m.created < from)
      for (const key of tierMarks(model.labId, model)) seenFor(model.labId).add(key);
  }

  const releases: LabelledRelease[] = markers.map((marker, i) => {
    const review = TIER_REVIEW[i];
    if (review?.at !== iso(marker.t) || review.labId !== marker.labId)
      throw new Error(
        `tier review row ${i + 1} is ${review?.at} ${review?.labId}, marker is ${iso(marker.t)} ${marker.labId}`,
      );
    const placed = marker.models.flatMap((id) => {
      const model = canonical.get(id);
      return model?.labId === marker.labId ? [model] : [];
    });
    if (placed.length !== marker.models.length)
      throw new Error(`unplaced model in ${marker.models.join(', ')}`);
    const { tier, rules, overrides } = tierOf(marker.labId, placed, seenFor(marker.labId));
    for (const model of placed)
      for (const key of tierMarks(marker.labId, model)) seenFor(marker.labId).add(key);
    return {
      at: iso(marker.t),
      labId: marker.labId,
      models: marker.models,
      skus: placed.map((m) => m.sku),
      tier,
      rules,
      overrides: overrides.map((o) => ({ sku: o.sku, reason: o.reason })),
      ambiguous: review.ambiguous,
      ...(review.note ? { note: review.note } : {}),
      detector: eventKeys.has(`${marker.labId} ${marker.t}`),
    };
  });

  const exceptions = detectorExceptions(models, from, until);
  const count = (tier: Tier) => releases.filter((r) => r.tier === tier).length;

  return {
    meta: {
      version: LABELS_VERSION,
      detectorVersion: RELEASE_DETECTOR_VERSION,
      generatedBy: 'pnpm backtest:replay (scripts/backtest/labels.ts)',
      window: { from: iso(from), until: iso(until) },
      definition:
        'A release is a frontier lab text model first listed on OpenRouter, grouped per lab within 2 h of the first listing (the v3 replay). Its tier comes from the lab registry rules and TIER_OVERRIDES, checked against the tier review.',
      limitations: [
        'OpenRouter first listings stand in for first public availability. The forward ledger also reads chat.qwen.ai and Hugging Face, so its release times will run earlier than these.',
        'Muse Spark 1.0 (meta.ai, 2026-04-08) never listed on OpenRouter and is missing.',
      ],
    },
    counts: {
      releases: releases.length,
      flagship: count('flagship'),
      minor: count('minor'),
      ambiguous: releases.filter((r) => r.ambiguous).length,
      overridden: releases.filter((r) => r.overrides.length > 0).length,
      detectorReproduced: releases.filter((r) => r.detector).length,
    },
    detectorExceptions: exceptions,
    overrides: TIER_OVERRIDES.map((o) => ({ labId: o.labId, sku: o.sku, tier: o.tier, reason: o.reason })),
    releases,
  };
}

export type LabelledReleases = ReturnType<typeof buildLabelledReleases>;
