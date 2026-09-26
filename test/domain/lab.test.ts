// @ts-ignore This app deliberately does not ship Node type declarations; these tests run in Node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectMarkets, type PolymarketEventDto } from '../../src/adapters/polymarket';
import {
  FRONTIER_LABS,
  LABS,
  X_WATCHLIST,
  labById,
  labForOpenRouterId,
  labForTitle,
  unmappedReleaseMarkets,
} from '../../src/domain/lab';
import type { Market } from '../../src/domain/market';
import releasesPage from '../fixtures/polymarket/ai-releases-keyset.json';

describe('lab registry', () => {
  it('has unique ids, prefixes and companies', () => {
    const ids = LABS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prefixes = LABS.flatMap((l) => l.openRouterPrefixes);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    const companies = LABS.map((l) => l.polymarketCompany);
    expect(new Set(companies).size).toBe(companies.length);
  });

  it('every frontier lab exists in the registry', () => {
    for (const id of FRONTIER_LABS) expect(labById(id)).toBeDefined();
  });

  it('maps OpenRouter ids by vendor prefix, ignoring alias tildes', () => {
    expect(labForOpenRouterId('anthropic/claude-fable-5.1')?.id).toBe('anthropic');
    expect(labForOpenRouterId('~openai/gpt-latest')?.id).toBe('openai');
    expect(labForOpenRouterId('meta-llama/llama-4')?.id).toBe('meta');
    expect(labForOpenRouterId('x-ai/grok-5')?.id).toBe('xai');
    expect(labForOpenRouterId('unknown/model')).toBeUndefined();
  });

  it('maps Polymarket titles to labs, most specific words first', () => {
    expect(labForTitle('Next Claude Opus released by...?')?.id).toBe('anthropic');
    expect(labForTitle('Claude Fable 5.2 released by...?')?.id).toBe('anthropic');
    expect(labForTitle('Gemini 3.5 released by...?')?.id).toBe('google');
    expect(labForTitle('Grok 5 released by...?')?.id).toBe('xai');
    expect(labForTitle('DeepSeek V4 released by...?')?.id).toBe('deepseek');
    expect(labForTitle('Qwen 4 released by...?')?.id).toBe('qwen');
    expect(labForTitle('Will it rain in London?')).toBeUndefined();
  });

  it('maps Muse Spark, Glimmer and Code to Meta', () => {
    expect(labForTitle('Next Muse Spark (1.4+) released by...?')?.id).toBe('meta');
    expect(labForTitle('Muse Glimmer released by...?')?.id).toBe('meta');
    expect(labForTitle('Muse Code 2 released by...?')?.id).toBe('meta');
    expect(labForTitle('Meta\'s "Watermelon" model released by...?')?.id).toBe('meta');
  });

  it('labById tolerates undefined', () => {
    expect(labById(undefined)).toBeUndefined();
    expect(labById('openai')?.short).toBe('OAI');
  });

  it('watchlist handles are unique and plausible X handles', () => {
    const handles = X_WATCHLIST.map((w) => w.handle);
    expect(new Set(handles).size).toBe(handles.length);
    for (const h of handles) expect(h).toMatch(/^[A-Za-z0-9_]{1,15}$/);
  });
});

describe('unmappedReleaseMarkets', () => {
  const release = (title: string, closed = false): Market => ({
    slug: title,
    title,
    url: 'u',
    vol24: 0,
    volume: 0,
    kind: 'release',
    labId: labForTitle(title)?.id,
    outcomes: [{ label: 'September 30', yes: 0.5, closed, vol24: 0 }],
  });

  it('finds no gap in the live release board once SSI and MAI are set aside', () => {
    const markets = selectMarkets(releasesPage.events as PolymarketEventDto[]);
    expect(markets.some((m) => /\bSSI\b/.test(m.title))).toBe(true);
    expect(markets.some((m) => /\bMAI\b/.test(m.title))).toBe(true);
    expect(unmappedReleaseMarkets(markets)).toEqual([]);
  });

  it('reports open release markets no lab claims', () => {
    const orphan = release('Next Nova Model released by...?');
    expect(
      unmappedReleaseMarkets([
        orphan,
        release('Next Hermes Model released by...?', true),
        { ...release('Next Nova benchmark score?'), kind: 'leaderboard' },
        release('Next Claude Opus released by...?'),
      ]),
    ).toEqual([orphan]);
  });
});

describe('lab colours', () => {
  /** WCAG relative luminance of a #rrggbb colour. */
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const background = /--bg:\s*(#[0-9a-f]{6})\b/i.exec(
    readFileSync('src/styles/global.css', 'utf8') as string,
  )?.[1];

  it('reach 4.5:1 against the page background', () => {
    expect(background).toBe('#07060f');
    for (const lab of LABS) expect(contrast(lab.color, background!), lab.id).toBeGreaterThanOrEqual(4.5);
    // DeepSeek and Qwen were 3.85:1 and 4.43:1 on panels before #7480ff and #d24bff.
    expect(contrast(labById('deepseek')!.color, background!)).toBeCloseTo(6.02, 2);
    expect(contrast(labById('qwen')!.color, background!)).toBeCloseTo(5.94, 2);
  });
});
