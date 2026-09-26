/**
 * Hand-curated inputs to the backtest. Release rows are pointers into the raw pulls (queries,
 * ids, first-party hosts): `pnpm backtest` derives their timestamps from data/backtest/raw. The
 * other tables are findings from the 2026-09-26 research pass; every row carries the source a
 * reader can re-check, and the times in them were re-probed on 2026-09-26 unless marked otherwise.
 */
import type { LabId } from '../../src/domain/lab';

export interface Source {
  label: string;
  url: string;
}

export type Precursor = 'announced' | 'leak' | 'none';

export interface CuratedRelease {
  id: string;
  labId: LabId;
  model: string;
  /** HN Algolia `search_by_date` query and window; `title` must match the announcement's title. */
  hn: { query: string; from: string; to: string; title: RegExp };
  /** Hosts (or host/path prefixes) that count as first-party for this lab. */
  hosts: readonly string[];
  /** OpenRouter ids; availability is the earliest `created` among them. */
  openrouter: readonly string[];
  /** Gamma event ids whose rungs priced this launch. */
  markets: readonly string[];
  /**
   * What was public before launch: `announced` when the lab (or its staff) named the model or its
   * date, `leak` when only leaks, press or rumours did, `none` when nothing surfaced on HN.
   */
  precursor: Precursor;
  /** What telegraphed it, in one line. */
  context: string;
  sources: readonly Source[];
  /**
   * First-party HN stories (by id) that name the model but are not its launch, and why. The
   * teaser regex reads titles; these are the ones a title cannot give away: a post with no text,
   * a docs page that did not list the model yet, a pre-launch safety post.
   */
  notLaunch?: readonly { story: string; why: string }[];
}

/** A lab's official X account, as `host/handle/` prefixes for both domains. Staff accounts do not count. */
const x = (...handles: string[]) => handles.flatMap((h) => [`twitter.com/${h}/`, `x.com/${h}/`]);

const HOSTS = {
  openai: ['openai.com', ...x('openai', 'openaidevs')],
  anthropic: ['anthropic.com', 'claude.com', ...x('anthropicai', 'claudeai')],
  google: [
    'blog.google',
    'deepmind.google',
    'googleblog.com',
    'ai.google.dev',
    ...x('googledeepmind', 'google', 'googleai'),
  ],
  xai: ['x.ai', ...x('xai', 'grok')],
  deepseek: ['deepseek.com', 'huggingface.co/deepseek-ai', 'github.com/deepseek-ai', ...x('deepseek_ai')],
  qwen: [
    'qwen.ai',
    'qwenlm.github.io',
    'huggingface.co/qwen',
    'github.com/qwenlm',
    'alibabacloud.com',
    ...x('alibaba_qwen'),
  ],
  moonshot: [
    'moonshot.ai',
    'kimi.com',
    'huggingface.co/moonshotai',
    'github.com/moonshotai',
    ...x('kimi_moonshot'),
  ],
};

const hn = (id: number, label: string): Source => ({
  label,
  url: `https://news.ycombinator.com/item?id=${id}`,
});

export const RELEASES: readonly CuratedRelease[] = [
  {
    id: 'qwen3.5',
    labId: 'qwen',
    model: 'Qwen3.5',
    hn: { query: 'Qwen3.5', from: '2026-02-13T00:00:00Z', to: '2026-02-18T00:00:00Z', title: /qwen3\.5/i },
    hosts: HOSTS.qwen,
    openrouter: ['qwen/qwen3.5-397b-a17b', 'qwen/qwen3.5-plus-02-15'],
    markets: [],
    precursor: 'none',
    context: 'No pre-launch story on HN. The transformers architecture merged 6.9 days earlier (see below).',
    sources: [
      { label: 'transformers #43830', url: 'https://github.com/huggingface/transformers/pull/43830' },
    ],
  },
  {
    id: 'gemma-4',
    labId: 'google',
    model: 'Gemma 4',
    hn: { query: 'Gemma 4', from: '2026-03-30T00:00:00Z', to: '2026-04-04T00:00:00Z', title: /gemma 4/i },
    hosts: HOSTS.google,
    openrouter: ['google/gemma-4-31b-it', 'google/gemma-4-26b-a4b-it'],
    markets: [],
    precursor: 'none',
    context: 'No pre-launch story on HN; the transformers merge landed 36 minutes before the blog.',
    sources: [
      { label: 'transformers #45192', url: 'https://github.com/huggingface/transformers/pull/45192' },
    ],
  },
  {
    id: 'claude-opus-4.7',
    labId: 'anthropic',
    model: 'Claude Opus 4.7',
    hn: { query: 'Opus 4.7', from: '2026-04-13T00:00:00Z', to: '2026-04-18T00:00:00Z', title: /opus 4\.7/i },
    hosts: HOSTS.anthropic,
    openrouter: ['anthropic/claude-opus-4.7'],
    markets: ['256428', '382053'],
    precursor: 'none',
    context: 'No pre-launch story on HN.',
    sources: [],
  },
  {
    id: 'gpt-5.5',
    labId: 'openai',
    model: 'GPT-5.5',
    hn: { query: 'GPT-5.5', from: '2026-04-20T00:00:00Z', to: '2026-04-26T00:00:00Z', title: /gpt-5\.5/i },
    hosts: HOSTS.openai,
    openrouter: ['openai/gpt-5.5', 'openai/gpt-5.5-pro'],
    markets: ['250413', '361527'],
    precursor: 'leak',
    context:
      'A Codex build exposed it 38 hours early; the API (and OpenRouter) followed a day after the post.',
    sources: [hn(47858903, 'HN: "GPT 5.5 Released in Codex", 2026-04-22 04:12Z')],
  },
  {
    id: 'deepseek-v4',
    labId: 'deepseek',
    model: 'DeepSeek V4',
    hn: {
      query: 'DeepSeek V4',
      from: '2026-04-21T00:00:00Z',
      to: '2026-04-26T00:00:00Z',
      title: /deepseek.?v4/i,
    },
    hosts: HOSTS.deepseek,
    openrouter: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'],
    markets: ['160425', '409919'],
    precursor: 'none',
    context: 'No pre-launch story on HN; weights and API went live together.',
    sources: [],
  },
  {
    id: 'claude-opus-4.8',
    labId: 'anthropic',
    model: 'Claude Opus 4.8',
    hn: { query: 'Opus 4.8', from: '2026-05-25T00:00:00Z', to: '2026-05-30T00:00:00Z', title: /opus 4\.8/i },
    hosts: HOSTS.anthropic,
    openrouter: ['anthropic/claude-opus-4.8'],
    markets: ['527290'],
    precursor: 'leak',
    context: 'A same-morning rumour. OpenRouter lists it 22.7 hours before the post.',
    sources: [hn(48306771, 'HN: "Claude Opus 4.8 coming today?", 2026-05-28 09:52Z')],
  },
  {
    id: 'claude-fable-5',
    labId: 'anthropic',
    model: 'Claude Fable 5 / Mythos 5',
    hn: { query: 'Fable 5', from: '2026-06-06T00:00:00Z', to: '2026-06-11T00:00:00Z', title: /fable 5/i },
    hosts: HOSTS.anthropic,
    openrouter: ['anthropic/claude-fable-5'],
    markets: ['314315', '573859', '36308'],
    precursor: 'leak',
    context: 'An unsourced "releasing tomorrow" post the evening before.',
    sources: [hn(48450521, 'HN: "Claude Fable 5 by Anthropic, releasing tomorrow", 2026-06-08 19:36Z')],
  },
  {
    id: 'gemini-3.5-flash',
    labId: 'google',
    model: 'Gemini 3.5 Flash',
    hn: {
      query: 'Gemini 3.5',
      from: '2026-05-16T00:00:00Z',
      to: '2026-05-21T00:00:00Z',
      title: /gemini 3\.5/i,
    },
    hosts: HOSTS.google,
    openrouter: ['google/gemini-3.5-flash'],
    markets: ['198615', '425315', '452304'],
    precursor: 'none',
    context:
      'Launched on stage at the Google I/O keynote, with no model-specific story on HN beforehand. It settled the "Gemini 3.2" and "Gemini 3.5" ladders.',
    sources: [],
  },
  {
    id: 'claude-sonnet-5',
    labId: 'anthropic',
    model: 'Claude Sonnet 5',
    hn: { query: 'Sonnet 5', from: '2026-06-27T00:00:00Z', to: '2026-07-02T00:00:00Z', title: /sonnet 5/i },
    hosts: HOSTS.anthropic,
    openrouter: ['anthropic/claude-sonnet-5'],
    markets: ['630670'],
    precursor: 'none',
    context: 'No pre-launch story on HN.',
    sources: [],
  },
  {
    id: 'grok-4.5',
    labId: 'xai',
    model: 'Grok 4.5',
    hn: { query: 'Grok 4.5', from: '2026-07-05T00:00:00Z', to: '2026-07-10T00:00:00Z', title: /grok 4\.5/i },
    hosts: HOSTS.xai,
    openrouter: ['x-ai/grok-4.5'],
    markets: ['511079'],
    precursor: 'none',
    context: 'Settled the "Grok 4.4 released by" ladder.',
    sources: [],
  },
  {
    id: 'gpt-5.6',
    labId: 'openai',
    model: 'GPT-5.6 Sol/Terra/Luna',
    hn: { query: 'GPT-5.6', from: '2026-07-06T00:00:00Z', to: '2026-07-11T00:00:00Z', title: /gpt.?5\.6/i },
    hosts: HOSTS.openai,
    openrouter: ['openai/gpt-5.6-sol', 'openai/gpt-5.6-terra', 'openai/gpt-5.6-luna'],
    markets: ['425249', '624679'],
    precursor: 'announced',
    context: 'OpenAI named the day 37 hours ahead; a YouTube placeholder went up the evening before.',
    sources: [
      hn(48827402, 'HN: OpenAI "will launch publicly this Thursday", 2026-07-08 04:12Z'),
      hn(48799614, 'HN: "GPT-5.6 Sol Ultra will be in Codex", 2026-07-06 01:04Z'),
    ],
  },
  {
    id: 'kimi-k3',
    labId: 'moonshot',
    model: 'Kimi K3',
    hn: { query: 'Kimi K3', from: '2026-07-13T00:00:00Z', to: '2026-07-18T00:00:00Z', title: /kimi k3/i },
    hosts: HOSTS.moonshot,
    openrouter: ['moonshotai/kimi-k3'],
    markets: ['336642'],
    precursor: 'none',
    context: 'Went live in the Kimi app about an hour before the blog. Not a frontier lab in lab.ts.',
    sources: [hn(48934539, 'HN: "Kimi K3 released on web and app", 2026-07-16 13:48Z')],
  },
  {
    id: 'claude-opus-5',
    labId: 'anthropic',
    model: 'Claude Opus 5',
    hn: {
      query: 'Opus 5',
      from: '2026-07-21T00:00:00Z',
      to: '2026-07-26T00:00:00Z',
      title: /opus 5\b(?!\.)/i,
    },
    hosts: HOSTS.anthropic,
    openrouter: ['anthropic/claude-opus-5'],
    markets: ['656719', '704769'],
    precursor: 'leak',
    context: 'An Artificial Analysis model page for it was on HN 23 hours before launch.',
    sources: [hn(49025676, 'HN: artificialanalysis.ai/models/claude-opus-5, 2026-07-23 18:01Z')],
  },
  {
    id: 'grok-4.6',
    labId: 'xai',
    model: 'Grok 4.6',
    hn: { query: 'Grok 4.6', from: '2026-08-09T00:00:00Z', to: '2026-08-14T00:00:00Z', title: /grok 4\.6/i },
    hosts: HOSTS.xai,
    openrouter: ['x-ai/grok-4.6'],
    markets: ['802141', '830141'],
    precursor: 'none',
    context: 'No pre-launch story on HN.',
    sources: [],
  },
  {
    id: 'gemini-3.7-flash',
    labId: 'google',
    model: 'Gemini 3.7 Flash',
    hn: {
      query: 'Gemini 3.7',
      from: '2026-08-10T00:00:00Z',
      to: '2026-08-15T00:00:00Z',
      title: /gemini 3\.7/i,
    },
    hosts: HOSTS.google,
    openrouter: ['google/gemini-3.7-flash'],
    markets: ['843929'],
    precursor: 'none',
    context: 'No pre-launch story on HN.',
    sources: [],
  },
  {
    id: 'qwen3.8-flash',
    labId: 'qwen',
    model: 'Qwen3.8-Flash',
    hn: {
      query: 'Qwen3.8',
      from: '2026-08-23T00:00:00Z',
      to: '2026-08-28T00:00:00Z',
      title: /qwen.?3\.8.?flash/i,
    },
    hosts: HOSTS.qwen,
    openrouter: ['qwen/qwen3.8-flash'],
    markets: ['850784'],
    precursor: 'announced',
    context: 'Qwen’s ModelScope page said "releasing tomorrow" 25 hours ahead.',
    sources: [
      hn(49432317, 'HN: "Qwen 3.8-Flash-Next releasing tomorrow" (modelscope.cn), 2026-08-25 11:49Z'),
    ],
  },
  {
    id: 'claude-fable-5.1',
    labId: 'anthropic',
    model: 'Claude Fable 5.1 / Mythos 5.1',
    hn: {
      query: 'Fable 5.1',
      from: '2026-08-29T00:00:00Z',
      to: '2026-09-03T00:00:00Z',
      title: /fable 5\.1/i,
    },
    hosts: HOSTS.anthropic,
    openrouter: ['anthropic/claude-fable-5.1'],
    markets: ['578305', '907022'],
    precursor: 'none',
    context: 'No pre-launch story on HN.',
    sources: [],
  },
  {
    id: 'gemini-3.8-flash',
    labId: 'google',
    model: 'Gemini 3.8 Flash',
    hn: {
      query: 'Gemini 3.8',
      from: '2026-08-30T00:00:00Z',
      to: '2026-09-04T00:00:00Z',
      title: /gemini 3\.8/i,
    },
    hosts: HOSTS.google,
    openrouter: ['google/gemini-3.8-flash'],
    markets: ['850741', '944029'],
    precursor: 'leak',
    context: 'A WSJ scoop 16 hours before launch.',
    sources: [hn(49529686, 'HN: WSJ "New Google AI Model Said to Narrow Gap", 2026-09-01 23:23Z')],
  },
  {
    id: 'gpt-6-astra',
    labId: 'openai',
    model: 'GPT-6 Astra',
    hn: { query: 'Astra', from: '2026-08-31T00:00:00Z', to: '2026-09-06T00:00:00Z', title: /astra/i },
    hosts: HOSTS.openai,
    openrouter: ['openai/gpt-6-astra', 'openai/gpt-6-astra-pro'],
    markets: ['783555', '948075', '36307'],
    precursor: 'announced',
    context:
      'OpenAI published "Path to Astra" two days ahead and a wordless teaser video three hours before the launch. Announced Sep 3, generally available Sep 4; the markets resolved on Sep 4.',
    sources: [
      {
        label: 'OpenAI RSS: "Path to Astra", 2026-09-01 13:00Z',
        url: 'https://openai.com/index/path-to-astra',
      },
      hn(49545491, 'HN: help.openai.com "OpenAI Astra Launching Soon", 2026-09-03 03:02Z'),
    ],
    notLaunch: [
      { story: '49527595', why: 'the pre-launch safety post, two days early' },
      {
        story: '49551018',
        why: 'an @OpenAI post with no words, only a 12-second video (tweet 2095527557924082061)',
      },
      { story: '49551175', why: 'the generic models page; commenters found no Astra on it yet' },
    ],
  },
  {
    id: 'deepseek-v4.1-flash',
    labId: 'deepseek',
    model: 'DeepSeek V4.1 Flash',
    hn: { query: 'DeepSeek', from: '2026-09-07T00:00:00Z', to: '2026-09-12T00:00:00Z', title: /v4\.1/i },
    hosts: HOSTS.deepseek,
    openrouter: ['deepseek/deepseek-v4.1-flash'],
    markets: ['850754'],
    precursor: 'leak',
    context: 'Beta leaks two days out, then a Vercel AI Gateway beta listing 14.5 hours ahead.',
    sources: [
      hn(49607094, 'HN: "v4.1 Flash is now available for internal beta testing", 2026-09-08 08:04Z'),
      hn(49628163, 'HN: "DeepSeek v4.1 Flash Beta on Vercel", 2026-09-09 15:28Z'),
    ],
  },
  {
    id: 'grok-4.7',
    labId: 'xai',
    model: 'Grok 4.7',
    hn: { query: 'Grok 4.7', from: '2026-09-18T00:00:00Z', to: '2026-09-23T00:00:00Z', title: /grok 4\.7/i },
    hosts: HOSTS.xai,
    openrouter: ['x-ai/grok-4.7'],
    markets: ['961779', '961780'],
    precursor: 'leak',
    context: 'A 1-point "launching soon" tweet 3.4 days out. xAI has no leading coverage on this site.',
    sources: [hn(49750862, 'HN: "Grok 4.7 Launching Soon", 2026-09-18 06:42Z')],
  },
  {
    id: 'claude-opus-5.5',
    labId: 'anthropic',
    model: 'Claude Opus 5.5',
    hn: { query: 'Opus 5.5', from: '2026-09-19T00:00:00Z', to: '2026-09-24T00:00:00Z', title: /opus 5\.5/i },
    hosts: HOSTS.anthropic,
    openrouter: ['anthropic/claude-opus-5.5'],
    markets: ['765707', '1035401'],
    precursor: 'leak',
    context:
      'Nothing on HN, but TestingCatalog reported testing 31.7 hours ahead; the day market moved 35 minutes after it.',
    sources: [
      {
        label: 'TestingCatalog: "Anthropic tests Fable 5.2 and Opus 5.5", 2026-09-21 08:45Z',
        url: 'https://www.testingcatalog.com/anthropic-tests-fable-5-2-and-opus-5-5-ahead-of-the-release/',
      },
    ],
  },
  {
    id: 'gpt-6-sol-luna',
    labId: 'openai',
    model: 'GPT-6 Sol/Luna',
    hn: { query: 'GPT-6', from: '2026-09-19T00:00:00Z', to: '2026-09-24T00:00:00Z', title: /sol/i },
    hosts: HOSTS.openai,
    openrouter: ['openai/gpt-6-sol', 'openai/gpt-6-luna'],
    markets: ['850711', '850737', '1060994', '1061038'],
    precursor: 'leak',
    context: 'A Reddit post saw the id on the API 11 days early; TestingCatalog called the day that morning.',
    sources: [
      hn(49665088, 'HN: "GPT-6-sol appeared on OpenAI API", 2026-09-11 20:43Z'),
      {
        label: 'TestingCatalog: "prepares to launch GPT-6 Sol and Luna today", 2026-09-22 12:07Z',
        url: 'https://www.testingcatalog.com/openai-gpt-6-sol-luna-tuesday-release/',
      },
    ],
  },
];

// ─────────────────────────────── scheduled broadcasts ───────────────────────────────

export interface Broadcast {
  model: string;
  title: string;
  video: string;
  /** When the upcoming-stream placeholder was published (the watch page's own publishDate). */
  publishedAt: string;
  /** Scheduled start from the archived page, else the actual start. */
  startsAt: string;
  /** A Wayback capture showing the page while it was still `isUpcoming`, when one exists. */
  capture: string | null;
  note: string;
}

export const BROADCASTS: readonly Broadcast[] = [
  {
    model: 'GPT-4.5',
    title: 'Introduction to GPT-4.5',
    video: 'cfRYp0nItZ8',
    publishedAt: '2025-02-27T17:00:15Z',
    startsAt: '2025-02-27T20:00:00Z',
    capture: '20250227192137',
    note: 'Placeholder named the model.',
  },
  {
    model: 'GPT-4.1',
    title: 'New models in the API',
    video: 'kA-P9ood-cE',
    publishedAt: '2025-04-14T14:49:13Z',
    startsAt: '2025-04-14T17:00:00Z',
    capture: '20250414163537',
    note: 'Placeholder title did not name the model.',
  },
  {
    model: 'o3 / o4-mini',
    title: 'Introduction to new o-series models',
    video: 'sq8GBPUb3rk',
    publishedAt: '2025-04-14T20:48:31Z',
    startsAt: '2025-04-16T17:00:00Z',
    capture: '20250416161005',
    note: 'The longest lead: scheduled two days out.',
  },
  {
    model: 'GPT-5',
    title: 'Introducing GPT-5',
    video: '0Uu_VJeVVfo',
    publishedAt: '2025-08-07T12:07:57Z',
    startsAt: '2025-08-07T17:00:00Z',
    capture: '20250807160625',
    note: 'Placeholder named the model.',
  },
  {
    model: 'GPT-5.6',
    title: 'Introducing the next chapter for ChatGPT',
    video: 'Wq45rvPGNHs',
    publishedAt: '2026-07-08T20:25:53Z',
    startsAt: '2026-07-09T16:53:22Z',
    capture: null,
    note: 'Start is the actual air time; OpenRouter listed the models 13.5 hours after the placeholder.',
  },
];

/** Launches with no scheduled stream to catch. */
export const BROADCAST_MISSES: readonly { model: string; note: string }[] = [
  { model: 'GPT-5.4', note: 'No scheduled stream.' },
  { model: 'GPT-5.5', note: 'No scheduled stream.' },
  { model: 'GPT-6 Astra', note: 'No scheduled stream.' },
  { model: 'GPT-6 Sol/Luna', note: 'No scheduled stream.' },
  { model: 'Every Anthropic launch', note: 'Uploads coincide with or trail the post.' },
  { model: 'Google DeepMind', note: 'Uploads trail the launch.' },
  { model: 'xAI', note: 'The @xai handle resolves to an unrelated channel.' },
];

// ─────────────────────────────── architecture merges ───────────────────────────────

export interface ArchitectureMerge {
  family: string;
  lab: string;
  /** The module directory the PR added under src/transformers/models/. */
  module: string;
  pr: number;
  mergedAt: string;
  /**
   * First first-party HN story about the release. A `release` id takes it from that release row
   * instead, so the two tables cannot disagree; null (with no `release`) while still unshipped.
   */
  announcedAt: string | null;
  story: number | null;
  release?: string;
}

/**
 * Merge times from the GitHub pulls API and story times from HN Algolia, both re-read on
 * 2026-09-26. The module is the directory each PR added, checked against its file list.
 */
export const ARCHITECTURE: readonly ArchitectureMerge[] = [
  {
    family: 'Qwen3',
    lab: 'Qwen',
    module: 'qwen3',
    pr: 36878,
    mergedAt: '2025-03-31T07:50:49Z',
    announcedAt: '2025-04-28T20:44:25Z',
    story: 43825900,
  },
  {
    family: 'Qwen3-VL',
    lab: 'Qwen',
    module: 'qwen3_vl',
    pr: 40795,
    mergedAt: '2025-09-15T10:46:18Z',
    announcedAt: '2025-09-23T20:59:17Z',
    story: 45352672,
  },
  {
    family: 'GLM-4.5',
    lab: 'Z.ai',
    module: 'glm4_moe',
    pr: 39393,
    mergedAt: '2025-07-21T11:24:34Z',
    announcedAt: '2025-07-28T14:15:52Z',
    story: 44711106,
  },
  {
    family: 'Qwen3.5',
    lab: 'Qwen',
    module: 'qwen3_5',
    pr: 43830,
    mergedAt: '2026-02-09T11:21:25Z',
    announcedAt: null,
    story: null,
    release: 'qwen3.5',
  },
  {
    family: 'GLM-5',
    lab: 'Z.ai',
    module: 'glm_moe_dsa',
    pr: 43858,
    mergedAt: '2026-02-09T12:06:23Z',
    announcedAt: '2026-02-11T13:42:16Z',
    story: 46974853,
  },
  {
    family: 'Qwen3-Next',
    lab: 'Qwen',
    module: 'qwen3_next',
    pr: 40771,
    mergedAt: '2025-09-09T21:46:57Z',
    announcedAt: '2025-09-11T17:38:40Z',
    story: 45214130,
  },
  {
    family: 'Qwen3-Omni',
    lab: 'Qwen',
    module: 'qwen3_omni_moe',
    pr: 41025,
    mergedAt: '2025-09-21T21:46:27Z',
    announcedAt: '2025-09-22T17:50:21Z',
    story: 45336989,
  },
  {
    family: 'Mistral Small 4',
    lab: 'Mistral',
    module: 'mistral4',
    pr: 44760,
    mergedAt: '2026-03-16T19:39:38Z',
    announcedAt: '2026-03-16T20:40:53Z',
    story: 47404575,
  },
  {
    family: 'gpt-oss',
    lab: 'OpenAI',
    module: 'gpt_oss',
    pr: 39923,
    mergedAt: '2025-08-05T16:02:18Z',
    announcedAt: '2025-08-05T17:00:49Z',
    story: 44800730,
  },
  {
    family: 'Gemma 4',
    lab: 'Google',
    module: 'gemma4',
    pr: 45192,
    mergedAt: '2026-04-02T15:24:40Z',
    announcedAt: null,
    story: null,
    release: 'gemma-4',
  },
  {
    family: 'GLM-5.3-Flash',
    lab: 'Z.ai',
    module: 'glm5_next',
    pr: 48342,
    mergedAt: '2026-08-26T14:26:41Z',
    announcedAt: '2026-08-26T14:08:50Z',
    story: 49449507,
  },
  {
    family: 'Llama 4',
    lab: 'Meta',
    module: 'llama4',
    pr: 37307,
    mergedAt: '2025-04-05T20:02:23Z',
    announcedAt: '2025-04-05T18:33:56Z',
    story: 43595585,
  },
  {
    family: 'DeepSeek V4',
    lab: 'DeepSeek',
    module: 'deepseek_v4',
    pr: 45643,
    mergedAt: '2026-05-02T11:41:20Z',
    announcedAt: null,
    story: null,
    release: 'deepseek-v4',
  },
  {
    family: 'MiniMax-M2',
    lab: 'MiniMax',
    module: 'minimax_m2',
    pr: 42028,
    mergedAt: '2026-01-09T15:25:03Z',
    announcedAt: '2025-10-27T05:12:15Z',
    story: 45717619,
  },
  {
    family: 'MiniMax-Text-01',
    lab: 'MiniMax',
    module: 'minimax',
    pr: 35831,
    mergedAt: '2025-06-04T07:38:41Z',
    announcedAt: '2025-01-14T19:32:05Z',
    story: 42702538,
  },
  {
    family: 'Kimi Linear',
    lab: 'Moonshot',
    module: 'kimi_linear',
    pr: 48250,
    mergedAt: '2026-09-05T17:04:26Z',
    announcedAt: '2025-10-30T15:44:34Z',
    story: 45761305,
  },
  {
    family: 'Qwen4-Exp',
    lab: 'Qwen',
    module: 'qwen4_exp',
    pr: 48337,
    mergedAt: '2026-08-26T12:03:40Z',
    announcedAt: null,
    story: null,
  },
];

/** Generations that shipped with no new module to catch. */
export const ARCHITECTURE_MISSES: readonly { family: string; note: string }[] = [
  {
    family: 'Qwen3.8',
    note: 'Reused the qwen3_5 classes; no qwen3_8 module exists (registry read 2026-09-26).',
  },
  { family: 'OpenAI, Anthropic, xAI frontier models', note: 'Closed weights never touch transformers.' },
];

// ─────────────────────────────── negative results ───────────────────────────────

export interface NegativeResult {
  signal: string;
  verdict: 'lags' | 'coincident' | 'no better than chance' | 'not independent' | 'fakes a lead';
  finding: string;
  source: Source;
}

export const NEGATIVE_RESULTS: readonly NegativeResult[] = [
  {
    signal: 'Release cadence ("overdue" labs)',
    verdict: 'no better than chance',
    finding:
      'Walk-forward: labs at z ≥ 0.5 past their mean gap shipped within 7 days 11.3% of the time, against a 20% base rate. Releases are bursty (CV 0.9–1.6).',
    source: { label: 'OpenRouter models API', url: 'https://openrouter.ai/api/v1/models' },
  },
  {
    signal: 'Cross-lab clustering',
    verdict: 'no better than chance',
    finding:
      'Another frontier lab shipped within 3d/7d 37.3%/66.7% of the time, against 37.3%/66.1% for a weekday-preserving shuffle (p = 0.51/0.44).',
    source: { label: 'OpenRouter models API', url: 'https://openrouter.ai/api/v1/models' },
  },
  {
    signal: 'SDK and OpenAPI commit feeds',
    verdict: 'lags',
    finding:
      'Coincident at best; 5 of 7 cases lag. The Opus 5.5 SDK release went out 2 minutes before the post.',
    source: {
      label: 'anthropic-sdk-python v1.8.0',
      url: 'https://github.com/anthropics/anthropic-sdk-python/releases/tag/v1.8.0',
    },
  },
  {
    signal: 'sglang commits',
    verdict: 'lags',
    finding: 'Led 1 of 7 launches, and only echoed a transformers merge that came first.',
    source: { label: 'sglang commits', url: 'https://github.com/sgl-project/sglang/commits/main' },
  },
  {
    signal: 'litellm and vercel/ai model lists',
    verdict: 'lags',
    finding: 'Trail OpenRouter by 20 minutes to 1h51m; litellm mirrors OpenRouter through a bot.',
    source: { label: 'litellm commits', url: 'https://github.com/BerriAI/litellm/commits/main' },
  },
  {
    signal: 'Lab docs catalog pages',
    verdict: 'coincident',
    finding:
      'Across 5 launches, no Wayback snapshot shows a docs page carrying a model before its announcement. GPT-6 Astra was still absent 6.4h after launch.',
    source: { label: 'Wayback Machine', url: 'https://web.archive.org/' },
  },
  {
    signal: 'AWS What’s New',
    verdict: 'fakes a lead',
    finding:
      'pubDate is a backdated editorial time; read at face value it fakes a lead on 13 of 15 Claude launches.',
    source: { label: 'AWS What’s New feed', url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/' },
  },
  {
    signal: 'Status pages (Claude, OpenAI)',
    verdict: 'lags',
    finding: 'A model is first mentioned 6 hours to about 20 days after its listing. xAI’s returns 403.',
    source: { label: 'status.claude.com', url: 'https://status.claude.com/' },
  },
  {
    signal: 'Wikipedia infoboxes',
    verdict: 'lags',
    finding: 'Updated after launch in 6 of 6 cases.',
    source: { label: 'MediaWiki API', url: 'https://en.wikipedia.org/w/api.php' },
  },
  {
    signal: 'Hugging Face collections',
    verdict: 'lags',
    finding: 'Lagged or coincided in 9 of 9 releases.',
    source: { label: 'Hugging Face API', url: 'https://huggingface.co/api/collections' },
  },
  {
    signal: 'Vertex AI release notes',
    verdict: 'lags',
    finding: 'The legacy feed has been stale since March; its successor has day-level dates and lags.',
    source: {
      label: 'Vertex AI release notes',
      url: 'https://cloud.google.com/vertex-ai/generative-ai/docs/release-notes',
    },
  },
  {
    signal: 'Design Arena codenames',
    verdict: 'lags',
    finding:
      'The public registry purged its anonymous codenames in June 2026, and every entry since appeared after launch. One anecdote survives: "Radon" was Muse Spark, 6d14h early.',
    source: { label: 'Design Arena', url: 'https://www.designarena.ai/' },
  },
  {
    signal: 'Manifold',
    verdict: 'not independent',
    finding: 'Pegged to Polymarket, 30 minutes to 3 hours behind it, on thin books.',
    source: { label: 'Manifold API', url: 'https://api.manifold.markets/v0/search-markets' },
  },
  {
    signal: 'Kalshi',
    verdict: 'not independent',
    finding:
      'GPT-6 moved 0.19 → 0.83 in the same hour as Polymarket (Sep 2, 15–17Z). No markets existed for Opus 5.5 or Sol/Luna.',
    source: {
      label: 'Kalshi API',
      url: 'https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXGPT',
    },
  },
];

// ─────────────────────────────── timestamp traps ───────────────────────────────

export interface TimestampTrap {
  trap: string;
  example: string;
  /** Hours the trap would fake (positive = a fake lead). */
  fakeLeadH: number | null;
  fix: string;
  source: Source;
}

export const TIMESTAMP_TRAPS: readonly TimestampTrap[] = [
  {
    trap: 'Git commit dates',
    example:
      'The anthropic-sdk-python commit adding claude-opus-5-5 is dated 2026-09-20 22:54:59Z; it shipped in v1.8.0 at 2026-09-22 16:25:23Z, two minutes before the launch post.',
    fakeLeadH: 41.5,
    fix: 'Use the release or push time, never the author or committer date.',
    source: {
      label: 'commit b5cc700',
      url: 'https://github.com/anthropics/anthropic-sdk-python/commit/b5cc70071a60def1d2e93f3634d1a595919007c8',
    },
  },
  {
    trap: 'AWS What’s New pubDate',
    example:
      'The GovCloud Opus 5.5 item was created 2h30m after its own pubDate (research pass; not re-probed here).',
    fakeLeadH: 2.5,
    fix: 'Record when the item was first seen.',
    source: { label: 'AWS What’s New feed', url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/' },
  },
  {
    trap: 'Hugging Face createdAt',
    example:
      'createdAt is when the repo was made, while still private: google/gemma-4-E4B-it says 2026-03-02 19:57Z, 30.8 days before the launch post.',
    fakeLeadH: 740.1,
    fix: 'Only a first-seen time from polling counts.',
    source: {
      label: 'google/gemma-4-E4B-it',
      url: 'https://huggingface.co/api/models/google/gemma-4-E4B-it',
    },
  },
  {
    trap: 'Date-only fields pinned to midnight',
    example:
      'xAI’s release notes date Grok 4.7 "September 21, 2026" with no time. Read as 00:00Z, that is 15h50m before its HN story.',
    fakeLeadH: 15.8,
    fix: 'Mark day-precision items and keep them out of lead analysis.',
    source: { label: 'xAI release notes', url: 'https://docs.x.ai/developers/release-notes' },
  },
  {
    trap: 'Rounded RSS pubDates',
    example:
      'openai.com’s RSS dates "GPT-6 Astra: A new generation of intelligence" to 2026-09-03 11:00:00Z; its HN story is 18:41Z.',
    fakeLeadH: 7.7,
    fix: 'Treat whole-hour and midnight pubDates as day precision.',
    source: { label: 'openai.com RSS', url: 'https://openai.com/news/rss.xml' },
  },
];

/**
 * The site's own trap: the History timeline said Altman's "her" tweet came the night before
 * GPT-4o. A tweet id is a Snowflake; its top bits are milliseconds since 2010-11-04T01:42:54.657Z.
 */
export const HER = {
  tweet: '1790075827666796666',
  tweetUrl: 'https://x.com/sama/status/1790075827666796666',
  story: 40345775,
  storyAt: '2024-05-13T17:28:00Z',
  storyTitle: 'GPT-4o',
} as const;
