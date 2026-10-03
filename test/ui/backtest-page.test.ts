import { describe, expect, it } from 'vitest';
import type { Backtest } from '../../scripts/backtest/build';
import type { Replay } from '../../scripts/backtest/replay';
import { LEAD_INPUT_SKILL_7D } from '../../src/domain/forecast';
import { backtestPage, inputWord, longDate, signed, spell } from '../../src/ui/backtest-page';
import releaseJson from '../../data/backtest/release-events.json';
import marketsJson from '../../data/backtest/markets.json';
import broadcastsJson from '../../data/backtest/broadcasts.json';
import replayJson from '../../data/backtest/v3-replay.json';

const events = releaseJson as unknown as Backtest['release-events'];
const markets = marketsJson as unknown as Backtest['markets'];
const broadcasts = broadcastsJson as unknown as Backtest['broadcasts'];
const replay = replayJson as unknown as Replay;

describe('backtest wording', () => {
  it('signs a number with a real minus, a plus on positives and a bare zero', () => {
    expect(signed(0.123)).toBe('+0.12');
    expect(signed(-0.0456, 3)).toBe('−0.046');
    expect(signed(0)).toBe('0');
  });

  it('writes a long UTC date without a leading zero', () => {
    expect(longDate('2026-04-01T23:30:00Z')).toBe('1 Apr 2026');
    expect(longDate('2026-12-25T00:00:00Z')).toBe('25 Dec 2026');
  });

  it('spells hours, and whole weeks or more as days', () => {
    expect(spell(24)).toBe('24 hours');
    expect(spell(72)).toBe('72 hours');
    expect(spell(168)).toBe('7 days');
    expect(spell(170)).toBe('170 hours');
  });

  it('says the level’s main input is worse, better or no better than the base rate', () => {
    expect(inputWord()).toBe(
      LEAD_INPUT_SKILL_7D.skillCi95[1] < 0
        ? 'Worse'
        : LEAD_INPUT_SKILL_7D.skillCi95[0] > 0
          ? 'Better'
          : 'No better',
    );
    expect(inputWord([-0.3, -0.1])).toBe('Worse');
    expect(inputWord([0.1, 0.3])).toBe('Better');
    expect(inputWord([-0.1, 0.3])).toBe('No better');
  });
});

describe('backtestPage', () => {
  const page = backtestPage({ events, markets, broadcasts, replay });

  it('reads the headline horizon and the decision from the replay', () => {
    expect(page.pulledAt).toBe(events.meta.pulledAt);
    expect(page.meta).toBe(replay.meta);
    expect(page.decision).toBe(replay.decision);
    expect(page.headH).toBe(replay.meta.headlineH);
    expect(page.head.horizonH).toBe(page.headH);
    expect(page.bestFormula.id).toBe(replay.decision.bestFormula);
    expect(page.maxAt72.id).toBe('max');
    expect(page.inputWord).toBe(inputWord());
  });

  it('ranks the labs by their own skill and gives the rest as a range', () => {
    expect(page.lab1.skill).toBeGreaterThanOrEqual(page.lab2.skill);
    expect(page.otherLabs).toHaveLength(replay.byLab.length - 2);
    expect(page.otherRange).toMatch(/^[−+]?\d\.\d\d to [−+]?\d\.\d\d$|^0 to|to 0$/);
    expect(page.fewestLaunches).toBeLessThanOrEqual(page.mostLaunches);
    expect(page.frontierNames.length).toBeGreaterThan(0);
    const two = backtestPage({
      events,
      markets,
      broadcasts,
      replay: { ...replay, byLab: replay.byLab.slice(0, 2) },
    });
    expect(two.otherLabs).toEqual([]);
    expect(two.otherRange).toBe('');
  });

  it('counts the unpriced held-out launches and the reliability bins', () => {
    expect(page.unpriced).toBe(replay.pricedEvents.test - replay.pricedEvents.testPriced);
    expect(page.pricedMin).toBe(`${(replay.meta.protocol.pricedMin * 100).toFixed(0)}%`);
    expect(page.bins).toBe(page.bestFormula.reliability);
    expect(page.topBin).toBe(page.bins.at(-1));
    expect(page.observedRange[0]).toBeLessThanOrEqual(page.observedRange[1]);
    expect(page.reliabilityPanels).toHaveLength(
      1 + markets.rungCalibration.filter((r) => r.horizonH === page.headH).length,
    );
    expect(page.reliabilityPanels[0].unit).toBe('hours');
    expect(page.rung72?.horizonH).toBe(page.headH);
  });

  it('splits broadcasts by archive and picks the reproduce example', () => {
    expect(page.archived.length + page.unarchived.length).toBe(broadcasts.broadcasts.length);
    for (const m of page.openAiMisses) expect(m.model.startsWith('GPT')).toBe(true);
    expect(page.dated.every((c) => c.primary)).toBe(true);
    expect(page.early90.length).toBeLessThanOrEqual(page.dated.length);
    expect(page.example?.model).toBeTruthy();
    const without = backtestPage({
      events,
      markets: { ...markets, crossings: markets.crossings.filter((c) => c.id !== 'claude-opus-5.5') },
      broadcasts,
      replay,
    });
    expect(without.example).toBeNull();
  });
});
