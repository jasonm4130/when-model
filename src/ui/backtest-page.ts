/**
 * The /backtest page's own sentences and figures, read from the committed backtest JSON and the
 * forecast constants: the verdict, the per-lab spread, the reliability panels and the limits. Pure;
 * a number the page prints comes from here or from the data it was given, never from markup.
 */
import { primaryLead, type Backtest } from '../../scripts/backtest/build';
import { RELEASES } from '../../scripts/backtest/curated';
import type { Replay } from '../../scripts/backtest/replay';
import { pct } from '../../scripts/backtest/view';
import { LEAD_INPUT_SKILL_7D } from '../domain/forecast';
import { labName } from './backtest-replay';

/** "+0.12", "−0.05", "0": a skill with a real minus sign. */
export const signed = (n: number, d = 2): string =>
  n > 0 ? `+${n.toFixed(d)}` : n < 0 ? `−${Math.abs(n).toFixed(d)}` : '0';

/** "1 Apr 2026" in UTC. */
export const longDate = (iso: string): string => {
  const [, dd, mon, yyyy] = new Date(iso).toUTCString().split(' ');
  return `${Number(dd)} ${mon} ${yyyy}`;
};

/** "24 hours", "72 hours", "7 days". */
export const spell = (h: number): string => (h % 24 === 0 && h >= 168 ? `${h / 24} days` : `${h} hours`);

/** The level's main input against the base rate, in a word: an interval that spans zero is "no better". */
export function inputWord(ci95: readonly [number, number] = LEAD_INPUT_SKILL_7D.skillCi95): string {
  return ci95[1] < 0 ? 'Worse' : ci95[0] > 0 ? 'Better' : 'No better';
}

export interface BacktestPageInput {
  events: Backtest['release-events'];
  markets: Backtest['markets'];
  broadcasts: Backtest['broadcasts'];
  replay: Replay;
}

/** Everything the page derives from its data. */
export function backtestPage({ events, markets, broadcasts, replay }: BacktestPageInput) {
  const dated = markets.crossings.filter((c) => c.primary);
  const early90 = dated.filter((c) => (primaryLead(c, 0.9) ?? 0) > 0);
  const example = (() => {
    const row = markets.crossings.find((c) => c.id === 'claude-opus-5.5');
    const curated = RELEASES.find((r) => r.id === 'claude-opus-5.5');
    const series = row?.day ?? row?.by;
    return row && curated && series
      ? { model: row.model, series, hn: curated.hn, openrouter: curated.openrouter[0] }
      : null;
  })();

  // v3 replay: every number below comes from data/backtest/v3-replay.json or FORECAST_CONSTANTS.
  const { meta, decision } = replay;
  const headH = meta.headlineH;
  const head = replay.horizons.find((h) => h.horizonH === headH)!;
  const bestFormula = head.formulas.find((f) => f.id === decision.bestFormula)!;
  const labsBySkill = [...replay.byLab].sort((a, b) => b.skill - a.skill);
  const [lab1, lab2, ...otherLabs] = labsBySkill;
  const bins = bestFormula.reliability;

  return {
    pulledAt: events.meta.pulledAt,
    archived: broadcasts.broadcasts.filter((b) => b.capture),
    unarchived: broadcasts.broadcasts.filter((b) => !b.capture),
    openAiMisses: broadcasts.misses.filter((m) => m.model.startsWith('GPT')),
    dated,
    early90,
    example,
    meta,
    decision,
    headH,
    head,
    bestFormula,
    maxAt72: head.formulas.find((f) => f.id === 'max')!,
    lab1,
    lab2,
    otherLabs,
    otherRange: otherLabs.length
      ? `${signed(Math.min(...otherLabs.map((l) => l.skill)))} to ${signed(Math.max(...otherLabs.map((l) => l.skill)))}`
      : '',
    frontierNames: [...new Set(replay.byLab.map((l) => labName(l.labId)))],
    fewestLaunches: Math.min(...replay.byLab.map((l) => l.testEvents)),
    mostLaunches: Math.max(...replay.byLab.map((l) => l.testEvents)),
    survivorship: replay.survivorship,
    uncensored: head.sensitivity.find((s) => s.variant === 'uncensored'),
    pricedMin: pct(meta.protocol.pricedMin),
    unpriced: replay.pricedEvents.test - replay.pricedEvents.testPriced,
    bins,
    topBin: bins[bins.length - 1],
    observedRange: [Math.min(...bins.map((b) => b.observed)), Math.max(...bins.map((b) => b.observed))],
    rung72: markets.rungCalibration.find((r) => r.horizonH === headH),
    reliabilityPanels: [
      {
        title: `v3 · ${bestFormula.name.slice(0, 3)} next ${headH}h · held-out hours`,
        bins: bestFormula.reliability,
        unit: 'hours',
        reference: { value: head.test.rate, label: `held-out rate ${pct(head.test.rate)}` },
        description: `Reliability of formula ${bestFormula.name.slice(0, 3)}, the ${headH}-hour noisy-OR forecast, on the held-out window: forecast against how often a frontier launch followed.`,
      },
      ...markets.rungCalibration
        .filter((r) => r.horizonH === headH)
        .map((r) => ({
          title: `Wave 1 · Polymarket rungs ${r.horizonH}h before deadline`,
          bins: r.reliability,
          unit: 'rungs',
          reference: { value: r.yesRate, label: `resolved Yes ${pct(r.yesRate)}` },
          description: `Reliability of Polymarket's own frontier release rungs, priced ${r.horizonH} hours before each deadline, against how each rung resolved.`,
        })),
    ],
    inputWord: inputWord(),
  };
}
