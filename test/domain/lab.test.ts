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
  labForHost,
  labForHuggingFaceOrg,
  modelTier,
  TIER_OVERRIDES,
  tierMarks,
  tierOf,
  unmappedReleaseMarkets,
  type TierModel,
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

describe('availability lookups', () => {
  it('places a Hugging Face organisation, ignoring case', () => {
    expect(labForHuggingFaceOrg('Qwen')?.id).toBe('qwen');
    expect(labForHuggingFaceOrg('DEEPSEEK-AI')?.id).toBe('deepseek');
    expect(labForHuggingFaceOrg('xai-org')?.id).toBe('xai');
    expect(labForHuggingFaceOrg('unsloth')).toBeUndefined();
  });

  it('places a lab site by host, subdomains included', () => {
    expect(labForHost('https://www.qwen.ai/blog?id=qwen3.9')?.id).toBe('qwen');
    expect(labForHost('https://api-docs.deepseek.com/news/news260910')?.id).toBe('deepseek');
    expect(labForHost('https://blog.google/technology/ai/gemini-4/')?.id).toBe('google');
    expect(labForHost('https://about.fb.com/news/2026/09/muse/')?.id).toBe('meta');
    expect(labForHost('https://notopenai.com/gpt-6')).toBeUndefined();
    expect(labForHost('not a url')).toBeUndefined();
  });

  it('lists each lab org and host once', () => {
    const orgs = LABS.flatMap((l) => l.huggingFaceOrgs.map((o) => o.toLowerCase()));
    const hosts = LABS.flatMap((l) => l.firstPartyHosts);
    expect(new Set(orgs).size).toBe(orgs.length);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});

describe('release tiers', () => {
  const model = (sku: string, variant?: string): TierModel => {
    const [base, snapshot] = sku.split('@');
    return { sku, base, ...(snapshot ? { snapshot } : {}), ...(variant ? { variant } : {}) };
  };
  const none = new Set<string>();

  it('gives every frontier lab a flagship rule, and every other lab none', () => {
    for (const lab of LABS) {
      expect(lab.tiers.flagship.length > 0, lab.id).toBe(FRONTIER_LABS.has(lab.id));
      expect(lab.tiers.minor, lab.id).not.toBe('');
    }
  });

  it('gives every override a reason and a known lab, once each', () => {
    for (const o of TIER_OVERRIDES) {
      expect(o.reason.length, o.sku).toBeGreaterThan(40);
      expect(labById(o.labId), o.sku).toBeDefined();
    }
    const keys = TIER_OVERRIDES.map((o) => `${o.labId}:${o.sku}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Muse Spark 1.0 is left to the rules: the labelled review keeps it flagship.
    expect(TIER_OVERRIDES.some((o) => o.sku.startsWith('muse-spark'))).toBe(false);
  });

  it('applies an override before any rule', () => {
    expect(modelTier('qwen', model('qwen3.8-max-prime'), none)).toMatchObject({
      tier: 'minor',
      rule: 'override',
      override: TIER_OVERRIDES[1],
    });
    expect(modelTier('qwen', model('qwen3.8-max@0902'), none)).toMatchObject({
      tier: 'minor',
      rule: 'override',
    });
  });

  it.each<[string, TierModel, string]>([
    ['openai', model('gpt-6-sol'), 'flagship'],
    ['openai', model('gpt-6-pro'), 'flagship'],
    ['openai', model('gpt-6-luna'), 'minor'],
    ['openai', model('gpt-6@2026-10-01'), 'minor'],
    ['openai', model('gpt-chat-latest'), 'minor'],
    ['openai', model('o5'), 'flagship'],
    ['anthropic', model('claude-opus-6'), 'flagship'],
    ['anthropic', model('claude-haiku-6'), 'minor'],
    ['anthropic', model('claude-opus-6@20261001'), 'minor'],
    ['google', model('gemini-4-pro-preview'), 'flagship'],
    ['google', model('gemini-4.5-flash'), 'flagship'],
    ['google', model('gemini-4.2-flash'), 'minor'],
    ['google', model('gemini-4-flash-lite'), 'minor'],
    ['xai', model('grok-6'), 'flagship'],
    ['xai', model('grok-6@0901'), 'minor'],
    ['xai', model('grok-build-0.1'), 'minor'],
    ['deepseek', model('deepseek-v5'), 'flagship'],
    ['deepseek', model('deepseek-v4-flash'), 'minor'],
    ['deepseek', model('deepseek-v4@0731'), 'minor'],
    ['qwen', model('qwen4-max'), 'flagship'],
    ['qwen', model('qwen4-235b'), 'flagship'],
    ['qwen', model('qwen4-32b'), 'minor'],
    ['qwen', model('qwen4-flash'), 'minor'],
    ['qwen', model('qwen4-omni'), 'minor'],
    ['meta', model('muse-spark-2'), 'flagship'],
    ['meta', model('muse-spark-1.2', 'contributor'), 'minor'],
    ['mistral', model('mistral-large-4'), 'minor'],
  ])('%s %o is %s with nothing shipped before', (labId, m, tier) => {
    expect(modelTier(labId as never, m, none).tier).toBe(tier);
  });

  it('counts only the first of a line once an earlier release marked it', () => {
    const seen = new Set([
      ...tierMarks('openai', model('gpt-6-sol')),
      ...tierMarks('qwen', model('qwen4-flash')),
      ...tierMarks('google', model('gemini-4-flash')),
    ]);
    expect([...seen].sort()).toEqual(['gemini-gen:4.0', 'gpt-line:sol:6', 'qwen:4']);
    expect(modelTier('openai', model('gpt-6-sol'), seen).tier).toBe('minor');
    expect(modelTier('openai', model('gpt-6'), seen).tier).toBe('flagship');
    expect(modelTier('qwen', model('qwen4-235b'), seen).tier).toBe('minor');
    expect(modelTier('google', model('gemini-4-flash'), seen).tier).toBe('minor');
    expect(tierMarks('mistral', model('mistral-large-4'))).toEqual([]);
  });

  it('tiers a release flagship when any model is, naming the deciding rules', () => {
    expect(tierOf('openai', [model('gpt-6-luna'), model('gpt-6-sol'), model('gpt-6-pro')], none)).toEqual({
      tier: 'flagship',
      rules: ['openai: new gpt-N[.M] of a main line (base/sol/terra/astra), -pro twin only with it'],
      overrides: [],
    });
    expect(tierOf('qwen', [model('qwen3.8-max-prime'), model('qwen3.8-flash')], none)).toEqual({
      tier: 'minor',
      rules: ['override', 'qwen: plus/flash/omni/size variant/dated after debut'],
      overrides: [TIER_OVERRIDES[1]],
    });
    expect(modelTier('nobody' as never, model('x-1'), none)).toEqual({ tier: 'minor', rule: 'unknown lab' });
  });
});
