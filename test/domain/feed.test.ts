import { describe, expect, it } from 'vitest';
import {
  HN_ALERT_POINTS,
  LEAK_SOURCE_NAMES,
  classifyLeak,
  isListed,
  isReleaseHeadline,
  labForModelId,
  looksLikeRelease,
  mentionsModel,
  modelIds,
  newestFirst,
  precisionOf,
  unlistedLeaks,
  type FeedItem,
  type LeakItem,
} from '../../src/domain/feed';
import { DEEPMIND_RSS_LABELLED } from '../fixtures/deepmind-rss-labelled';
import { HN_TITLES_LABELLED } from '../fixtures/hn-titles-labelled';
import { LEAK_OUTCOMES, LEAK_TITLES_LABELLED } from '../fixtures/leak-titles-labelled';
import { OPENAI_RSS_LABELLED } from '../fixtures/openai-rss-labelled';

/** Precision and recall of `flag` against hand labels, rounded to three places. */
function score<T>(rows: readonly T[], label: (row: T) => boolean, flag: (row: T) => boolean) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const row of rows) {
    const [l, f] = [label(row), flag(row)];
    if (l && f) tp++;
    else if (f) fp++;
    else if (l) fn++;
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { flagged: tp + fp, tp, fp, fn, precision: round(tp / (tp + fp)), recall: round(tp / (tp + fn)) };
}

describe('feed classification', () => {
  it('mentionsModel catches lab and model names but not generic tech', () => {
    expect(mentionsModel('Claude Fable 5.1 is here')).toBe(true);
    expect(mentionsModel('Show HN: a new LLM eval harness')).toBe(true);
    expect(mentionsModel('Rust 2.0 released')).toBe(false);
  });

  it('mentionsModel qualifies family names that are also words, and drops Meta AI glasses', () => {
    expect(mentionsModel('Opus 5.5 is good at explainer videos')).toBe(true);
    expect(mentionsModel('Muse Spark 1.3')).toBe(true);
    expect(mentionsModel('Fable 5.1 World Modeling')).toBe(true);
    expect(mentionsModel('My magnum opus, a sonnet sequence')).toBe(false);
    expect(
      mentionsModel('Meta takes down a critical video about meta AI Glasses after filming at Meta'),
    ).toBe(false);
  });

  it('looksLikeRelease needs launch words or a version, not just a lab name', () => {
    expect(looksLikeRelease('Introducing Gemini 4')).toBe(true);
    expect(looksLikeRelease('Anthropic SDK v0.80.1')).toBe(true);
    expect(looksLikeRelease('Claude is now available in Europe')).toBe(true);
    expect(looksLikeRelease('Anthropic partners with a university')).toBe(false);
  });

  it('precisionOf tells a timestamp from a bare date or a date pinned to midnight', () => {
    expect(precisionOf('Thu, 17 Sep 2026 12:00:00 GMT')).toBe('instant');
    expect(precisionOf('2026-09-16T00:00:01Z')).toBe('instant');
    expect(precisionOf('2026-09-23T16:06:00.000Z')).toBe('instant');
    expect(precisionOf('Sep 17, 2026')).toBe('day');
    // OpenAI's RSS date for "Introducing GPT-Live"; the HN story is 2026-07-08T17:03:19Z.
    expect(precisionOf('Wed, 08 Jul 2026 00:00:00 GMT')).toBe('day');
    expect(precisionOf('2026-09-16T00:00:00.000Z')).toBe('day');
    expect(precisionOf('2026-09-16T00:00Z')).toBe('day');
  });
});

describe('modelIds', () => {
  it('canonicalises versioned ids across every hyphen headlines use', () => {
    expect(modelIds('GPT‑6 Sol and Luna')).toEqual(['gpt-6-sol']);
    expect(modelIds('OpenAI GPT–6 Astra breaks Enigma')).toEqual(['gpt-6-astra']);
    expect(modelIds('api: add support for claude-opus-5-5, inline tool definitions')).toEqual([
      'claude-opus-5.5',
    ]);
    expect(modelIds('pin claude-opus-4-5-20251101')).toEqual(['claude-opus-4.5']);
    expect(modelIds('Anthropic tests Fable 5.2 and Opus 5.5 ahead of the release')).toEqual([
      'fable-5.2',
      'opus-5.5',
    ]);
    expect(modelIds('Qwen3.8-27B and Qwen 3.8 Max Preview')).toEqual(['qwen3.8-27b', 'qwen-3.8-max-preview']);
    expect(modelIds('DeepSeek-V4-Pro-0813 Publish')).toEqual(['deepseek-v4-pro-0813']);
    expect(modelIds('Tell HN: GPT5.6 Is Imminent?')).toEqual(['gpt5.6']);
    expect(modelIds('Introducing ChatGPT Images and GPT‑Image‑1.5')).toEqual(['gpt-image-1.5']);
    expect(modelIds('Hello GPT-4o')).toEqual(['gpt-4o']);
    expect(modelIds('Kimi K3-256k, MiniMax H3, MiMo-V2.6 Pro, Muse Spark 1.4, Gemma 4 26B')).toEqual([
      'kimi-k3',
      'minimax-h3',
      'mimo-v2.6-pro',
      'muse-spark-1.4',
      'gemma-4-26b',
    ]);
    expect(modelIds('Mistral Large 3, Devstral Small 2, Grok Code Fast 1, Llama 3.3-70b')).toEqual([
      'mistral-large-3',
      'devstral-small-2',
      'grok-code-fast-1',
      'llama-3.3-70b',
    ]);
  });

  it('reads the lower-case o-series only and never a bare family name', () => {
    expect(modelIds('Introducing OpenAI o3 and o4-mini')).toEqual(['o3', 'o4-mini']);
    expect(modelIds('O2 network outage')).toEqual([]);
    expect(modelIds('Sora is here')).toEqual([]);
    expect(modelIds('Gemini is 2x faster')).toEqual([]);
    expect(modelIds('llama.cpp gets a new backend')).toEqual([]);
    expect(modelIds('GPT-6 Solves a WWI cipher')).toEqual(['gpt-6']);
  });

  it('maps ids to the labs we track', () => {
    expect(labForModelId('gpt-6-sol')).toBe('openai');
    expect(labForModelId('o4-mini')).toBe('openai');
    expect(labForModelId('opus-5.5')).toBe('anthropic');
    expect(labForModelId('gemini-4-pro')).toBe('google');
    expect(labForModelId('grok-4.7')).toBe('xai');
    expect(labForModelId('deepseek-v4.1-flash')).toBe('deepseek');
    expect(labForModelId('qwen3.8-27b')).toBe('qwen');
    expect(labForModelId('muse-spark-1.4')).toBe('meta');
    expect(labForModelId('devstral-small-2')).toBe('mistral');
    expect(labForModelId('kimi-k3')).toBe('moonshot');
    expect(labForModelId('glm-5.3')).toBe('zai');
    expect(labForModelId('mimo-v2.6')).toBeUndefined();
  });
});

describe('isReleaseHeadline', () => {
  it('flags launch cues, bare names and "Model: subtitle" titles', () => {
    for (const title of [
      'Introducing GPT-6 Sol and Luna',
      'Introducing Claude Opus 5.5',
      'Grok 4.7',
      'OpenAI o3-mini',
      'Claude Fable 5.1 and Claude Mythos 5.1',
      'Gemini 3.6 Flash, 3.5 Flash-Lite, and 3.5 Flash Cyber',
      'Gemini 3.8 Live and 3.8 Live Extended Thinking',
      'Kimi K3: Open Frontier Intelligence',
      'GPT-5.5 Instant: smarter, clearer, and more personalized',
      'DeepSeek-V4-Flash Update',
      'GPT-6 Astra on OpenRouter',
      'Alibaba Releases Qwen3.8-Omni-Flash',
      'Sora 2 is here',
      'GLM-5.3 is now open-weight',
    ])
      expect(isReleaseHeadline(title), title).toBe(true);
  });

  it('skips system cards, customer stories, partner availability, comparisons and the future tense', () => {
    for (const title of [
      'Safety overview: GPT-6 Astra',
      'GPT-5.5 System Card',
      'Harvey turns legal context into stronger drafts with GPT-6 Astra',
      'Introducing Verdi, an AI dev platform powered by GPT-4o',
      'Grok 4.5 available in the EU',
      'Kimi K2.7 Code is generally available in GitHub Copilot',
      'Kimi K3: second only to Fable 5 on AA-Briefcase',
      'Opus 5.5 is good at explainer videos',
      'Claude Opus 5.5 Intelligence, Performance and Price Analysis (Max)',
      "Kimi K3, Qwen 3.8, and Anthropic's (Potential) Unravelling",
      'GPT-5.6 Sol, along with Terra and Luna, will launch publicly this Thursday',
      'Opus 5 expected to launch on July 20-21',
      'OpenAI to unveil GPT-5.6 on Thursday after delaying launch',
      'DeepSeek V4 official release coming in mid-July with 2x peak-hour API pricing',
      'Claude Sonnet 5 Could Be Released Later Today, May Not Be Better Than Opus 4.8',
      'Anthropic tests Fable 5.2 and Opus 5.5 ahead of the release',
      'DeepSeek v4.1 Flash is now available for internal beta testing',
      'GPT 5.6 Sol is the best "vision" model OpenAI ever released',
      'Show HN: Open-source engine running Gemma 4 26B in 2 GB RAM',
      'Introducing the Life Sciences Verification Program',
      'Redeploying Fable 5',
    ])
      expect(isReleaseHeadline(title), title).toBe(false);
  });

  it('rejects text too long to be a headline before any regex can backtrack on it', () => {
    const started = performance.now();
    expect(isReleaseHeadline(`GPT-6${' '.repeat(50_000)}x`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });

  // The labelled fixtures pin the classifier. The OpenAI and HN numbers are in-sample (the rule
  // was written against them); DeepMind is held out. Recall misses are mostly unversioned
  // names: Sora, Whisper, gpt-oss, Nano Banana, WeatherNext.
  it('OpenAI RSS: precision 0.906 where the v2 keyword test managed 0.195', () => {
    expect(
      score(
        OPENAI_RSS_LABELLED,
        (r) => r[1],
        (r) => isReleaseHeadline(r[0]),
      ),
    ).toEqual({
      flagged: 32,
      tp: 29,
      fp: 3,
      fn: 27,
      precision: 0.906,
      recall: 0.518,
    });
    expect(
      score(
        OPENAI_RSS_LABELLED,
        (r) => r[1],
        (r) => looksLikeRelease(r[0]),
      ),
    ).toMatchObject({
      flagged: 195,
      precision: 0.195,
      recall: 0.679,
    });
  });

  it('Hacker News: alerts at 150 points hit 42 of 43, against 31 of 81 before', () => {
    const titles = score(
      HN_TITLES_LABELLED,
      (r) => r[2],
      (r) => isReleaseHeadline(r[0]),
    );
    expect(titles).toEqual({ flagged: 53, tp: 50, fp: 3, fn: 12, precision: 0.943, recall: 0.806 });
    const hot = (r: (typeof HN_TITLES_LABELLED)[number]) => r[1] >= HN_ALERT_POINTS;
    expect(
      score(
        HN_TITLES_LABELLED,
        (r) => r[2],
        (r) => isReleaseHeadline(r[0]) && hot(r),
      ),
    ).toEqual({
      flagged: 43,
      tp: 42,
      fp: 1,
      fn: 20,
      precision: 0.977,
      recall: 0.677,
    });
    expect(
      score(
        HN_TITLES_LABELLED,
        (r) => r[2],
        (r) => looksLikeRelease(r[0]) && hot(r),
      ),
    ).toMatchObject({
      flagged: 81,
      tp: 31,
    });
  });

  // Both misses introduce a feature "with"/"in" a model; left untuned so the set stays held out.
  it('DeepMind RSS (held out): 12 of 14 flags are launches', () => {
    expect(
      score(
        DEEPMIND_RSS_LABELLED,
        (r) => r[1],
        (r) => isReleaseHeadline(r[0]),
      ),
    ).toEqual({
      flagged: 14,
      tp: 12,
      fp: 2,
      fn: 23,
      precision: 0.857,
      recall: 0.343,
    });
    expect(isReleaseHeadline('Introducing computer use in Gemini 3.5 Flash')).toBe(true);
  });
});

describe('classifyLeak', () => {
  it('finds the two ground-truth leaks at any point count', () => {
    expect(classifyLeak('GPT-6-sol appeared on OpenAI API')).toEqual({
      modelIds: ['gpt-6-sol'],
      cue: 'appeared',
      labId: 'openai',
    });
    expect(classifyLeak('Grok 4.7 Launching Soon')).toEqual({
      modelIds: ['grok-4.7'],
      cue: 'launching soon',
      labId: 'xai',
    });
    expect(classifyLeak('Anthropic tests Fable 5.2 and Opus 5.5 ahead of the release')).toEqual({
      modelIds: ['fable-5.2', 'opus-5.5'],
      cue: 'tests',
      labId: 'anthropic',
    });
    expect(classifyLeak('MiMo-V2.7 spotted in a config file')).toEqual({
      modelIds: ['mimo-v2.7'],
      cue: 'spotted',
    });
  });

  it('rejects launches, reviews, harnesses, leaked keys, comparisons and cue-less titles', () => {
    for (const title of [
      "Testing Claude Sonnet 5's agentic claims",
      "Moonshot's AI model Kimi k3 breaks out of testing environment, researchers say",
      'Harness your expectations: a 27B model matched GLM-5.3-Flash after leak fixes',
      'An open-source model on par with DeepSeek v4 has appeared in South Korea',
      'Alibaba released Qwen3.8-Max with open weights coming soon',
      'Gemini 3.8 Flash appears to be rolling out now',
      'The dislike for Opus 5 is usually because it tests the prompter',
      'Claude Opus 5 system prompt leaked',
      'Qwen3.8-Max Checkpoint 0902',
      'New Apple TV 4K Leaked',
      'Grok 4.7',
    ])
      expect(classifyLeak(title), title).toBeUndefined();
  });

  it('labelled leak titles: 17 of 17 flags are leaks, 3 unversioned leaks missed', () => {
    expect(
      score(
        LEAK_TITLES_LABELLED,
        (r) => r[1],
        (r) => !!classifyLeak(r[0]),
      ),
    ).toEqual({
      flagged: 17,
      tp: 17,
      fp: 0,
      fn: 3,
      precision: 1,
      recall: 0.85,
    });
  });

  // Precision that matters is predictive: did the leaked model ship within 14 days?
  it('11 of 14 resolved, unlisted leaks were followed by an OpenRouter listing within 14 days', () => {
    const flagged = LEAK_OUTCOMES.filter((o) => classifyLeak(o.title));
    expect(flagged).toHaveLength(LEAK_OUTCOMES.length);
    const surfaced = flagged.filter((o) => !o.listed);
    const resolved = surfaced.filter((o) => !o.pending);
    const launched = resolved.filter((o) => o.launchedAfterDays !== undefined);
    expect([flagged.length, surfaced.length, resolved.length, launched.length]).toEqual([18, 15, 14, 11]);
    const bySource = (source: string) => [
      resolved.filter((o) => o.source === source).length,
      launched.filter((o) => o.source === source).length,
    ];
    expect(bySource('hn')).toEqual([10, 8]);
    expect(bySource('testingcatalog')).toEqual([4, 3]);
    const leads = launched.map((o) => o.launchedAfterDays!).sort((a, b) => a - b);
    expect(leads[0]).toBe(0.23);
    expect(leads.at(-1)).toBe(10.9);
    expect(leads[5]).toBe(1.93);
    // The listing that resolved each leak is one `isListed` recognises, so the Leak Wire drops it.
    for (const o of launched) {
      const listing = { id: o.launchedAs!, name: '', aliases: o.launchedAlias ? [o.launchedAlias] : [] };
      expect(
        classifyLeak(o.title)!.modelIds.some((id) => isListed(id, [listing])),
        o.title,
      ).toBe(true);
    }
  });
});

describe('leak listings', () => {
  const listings = [
    { id: 'openai/gpt-6-astra', name: 'OpenAI: GPT-6 Astra' },
    { id: 'anthropic/claude-opus-5.5', name: 'Anthropic: Claude Opus 5.5' },
    { id: 'qwen/qwen3.8-27b', name: 'Qwen: Qwen3.8 27B' },
    { id: 'moonshotai/kimi-k3', name: 'MoonshotAI: Kimi K3' },
  ];

  it('isListed matches a model or its line across spellings, never a different version', () => {
    expect(isListed('gpt-6', listings)).toBe(true);
    expect(isListed('gpt-6-astra', listings)).toBe(true);
    expect(isListed('gpt-6-sol', listings)).toBe(false);
    expect(isListed('opus-5.5', listings)).toBe(true);
    expect(isListed('claude-opus-5.5', listings)).toBe(true);
    expect(isListed('opus-5', listings)).toBe(false);
    expect(isListed('qwen-3.8-27b', listings)).toBe(true);
    expect(isListed('Qwen 3.8', listings)).toBe(true);
    expect(isListed('kimi-k3', listings)).toBe(true);
    expect(isListed('grok-4.7', listings)).toBe(false);
    expect(isListed('grok-4.7', [])).toBe(false);
    expect(isListed('', listings)).toBe(false);
  });

  it('isListed reads aliases, because Qwen3.8-Flash-Next listed under another name', () => {
    const qwenFlash = { id: 'qwen/qwen3.8-flash', name: 'Qwen: Qwen3.8 Flash' };
    const [id] = classifyLeak('Qwen 3.8-Flash-Next releasing tomorrow (125B a6B)')!.modelIds;
    expect(isListed(id, [qwenFlash])).toBe(false);
    expect(isListed(id, [{ ...qwenFlash, aliases: ['Qwen/Qwen3.8-Flash-Next'] }])).toBe(true);
  });

  it('unlistedLeaks keeps a leak while any of its models is still unlisted', () => {
    const leak = (modelIds: string[]): LeakItem => ({
      source: 'testingcatalog',
      title: modelIds.join(' and '),
      url: 'https://www.testingcatalog.com/x/',
      publishedAt: '2026-09-21T08:45:00.000Z',
      modelIds,
      cue: 'tests',
    });
    const both = leak(['fable-5.2', 'opus-5.5']);
    const shipped = leak(['opus-5.5']);
    const sol = leak(['gpt-6-sol']);
    expect(unlistedLeaks([both, shipped, sol], listings)).toEqual([both, sol]);
    expect(LEAK_SOURCE_NAMES).toEqual({ hn: 'Hacker News', testingcatalog: 'TestingCatalog' });
  });
});

describe('newestFirst', () => {
  it('sorts descending by publishedAt without mutating the input', () => {
    const a: FeedItem = {
      source: 'hn',
      title: 'a',
      url: 'u',
      publishedAt: '2026-09-01T00:00:00Z',
      alert: false,
    };
    const b: FeedItem = { ...a, title: 'b', publishedAt: '2026-09-02T00:00:00Z' };
    const input = [a, b];
    expect(newestFirst(input).map((f) => f.title)).toEqual(['b', 'a']);
    expect(input[0].title).toBe('a');
  });
});
