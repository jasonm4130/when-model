import type { Market } from './market';

/**
 * The labs we watch: the "pizza shops" of whenmodel. Pure registry, no I/O.
 */
export interface Lab {
  id: LabId;
  name: string;
  short: string;
  /** OpenRouter model id prefixes (the part before the slash). */
  openRouterPrefixes: string[];
  /** Matches this lab's models in Polymarket event titles. */
  titlePattern: RegExp;
  /** The `groupItemTitle` Polymarket uses for this lab in "best AI model" markets. */
  polymarketCompany: string;
  /** X accounts that leak first, most official first. */
  xHandles: string[];
  color: string;
  glyph: string;
  /** Hugging Face organisations whose model listings the availability ledger polls. */
  huggingFaceOrgs: string[];
  /** Hosts of the lab's own posts: a Hacker News story linking one is the lab's announcement. */
  firstPartyHosts: string[];
  /** Which of the lab's releases are flagships (see `tierOf`). */
  tiers: LabTiers;
}

export type LabId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'qwen'
  | 'meta'
  | 'mistral'
  | 'moonshot'
  | 'zai';

// ─── Release tiers ───────────────────────────────────────────────────────────

export type Tier = 'flagship' | 'minor';

/**
 * One way a lab's release is a flagship. Read against a model's tier slug: its canonical base
 * (`src/domain/model-id.ts`), plus the tier word the id carried past the grammar, if any
 * (`muse-spark-1.2-contributor`).
 */
export interface TierRule {
  /** What the labelled table prints for a model this rule made a flagship. */
  name: string;
  pattern: RegExp;
  /** Never a dated snapshot: a re-snapshot of a shipped model is minor. */
  undated?: true;
  /** A model matching this is not a flagship under the rule (small tiers, open sizes under 100B). */
  unless?: RegExp;
  /**
   * Only the first of its line counts: this key, filled from the pattern's named groups (`{group}`,
   * or `{group|default}` when the group may be absent), must not be marked by an earlier release.
   */
  once?: string;
}

export interface LabTiers {
  flagship: readonly TierRule[];
  /** Keys a model marks whatever its tier, so a later model of the same line is not its debut. */
  marks?: readonly { pattern: RegExp; key: string }[];
  /** What the labelled table prints for this lab's minor releases. */
  minor: string;
}

/** The labelled review's small and special tiers: a Qwen debut in one of these is not a flagship. */
const SMALL_TIERS =
  'mini|nano|lite|flash-lite|haiku|luna|contributor|omni|vl|coder?|codex|image|audio|tts|embed|guard|safeguard|oss|cyber|vision|build|chat|latest';

/** Labs whose drops move DROPCON. Smaller labs still get a card, but not a vote. */
export const FRONTIER_LABS: ReadonlySet<LabId> = new Set<LabId>([
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'qwen',
  'meta',
]);

export const LABS: readonly Lab[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    short: 'OAI',
    openRouterPrefixes: ['openai'],
    titlePattern: /\b(openai|gpt|chatgpt|sora|o\d)\b/i,
    polymarketCompany: 'OpenAI',
    xHandles: ['OpenAI', 'sama', 'markchen90'],
    color: '#00ff9c',
    glyph: '◉',
    huggingFaceOrgs: ['openai'],
    firstPartyHosts: ['openai.com'],
    tiers: {
      flagship: [
        {
          name: 'openai: new gpt-N[.M] of a main line (base/sol/terra/astra), -pro twin only with it',
          pattern: /^gpt-(?<version>\d+(?:\.\d+)?)(?:-(?<line>sol|terra|astra))?(?:-pro)?$/,
          undated: true,
          once: 'gpt-line:{line|gpt}:{version}',
        },
        { name: 'openai: o-series top model', pattern: /^o\d+$/ },
      ],
      marks: [
        {
          pattern: /^gpt-(?<version>\d+(?:\.\d+)?)(?:-(?<line>sol|terra|astra))?(?:-pro)?$/,
          key: 'gpt-line:{line|gpt}:{version}',
        },
      ],
      minor: 'openai: mini/nano/luna/codex/chat/image/audio/oss or dated',
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    short: 'ANT',
    openRouterPrefixes: ['anthropic'],
    titlePattern: /\b(anthropic|claude|opus|sonnet|haiku|fable|mythos)\b/i,
    polymarketCompany: 'Anthropic',
    xHandles: ['AnthropicAI', 'claudeai', 'alexalbert__'],
    color: '#ff7a1a',
    glyph: '✱',
    huggingFaceOrgs: [],
    firstPartyHosts: ['anthropic.com'],
    tiers: {
      flagship: [
        {
          name: 'anthropic: opus/sonnet/fable/mythos new version',
          pattern: /^claude-(?:opus|sonnet|fable|mythos)-\d+(?:\.\d+)?$/,
          undated: true,
        },
      ],
      minor: 'anthropic: haiku or dated',
    },
  },
  {
    id: 'google',
    name: 'Google DeepMind',
    short: 'GDM',
    openRouterPrefixes: ['google'],
    titlePattern: /\b(google|gemini|deepmind|gemma|nano banana|veo)\b/i,
    polymarketCompany: 'Google',
    xHandles: ['GoogleDeepMind', 'OfficialLoganK', 'demishassabis'],
    color: '#4b9bff',
    glyph: '◆',
    huggingFaceOrgs: ['google'],
    firstPartyHosts: ['blog.google', 'deepmind.google'],
    tiers: {
      flagship: [
        {
          name: 'google: gemini pro/ultra new version',
          pattern: /^gemini-(?<version>\d+(?:\.\d+)?)-(?<tier>pro|ultra|deep-think)(?:-preview)?$/,
          once: 'gemini-tier:{tier}:{version}',
        },
        {
          name: 'google: first gemini of an N.0/N.5 generation (non-lite)',
          pattern: /^gemini-(?<major>\d+)(?:\.(?<minor>[05]))?-flash(?:-preview)?$/,
          once: 'gemini-gen:{major}.{minor|0}',
        },
      ],
      marks: [
        { pattern: /^gemini-(?<major>\d+)(?:\.(?<minor>\d+))?/, key: 'gemini-gen:{major}.{minor|0}' },
        {
          pattern: /^gemini-(?<version>\d+(?:\.\d+)?)-(?<tier>pro|ultra|deep-think)(?:-preview)?$/,
          key: 'gemini-tier:{tier}:{version}',
        },
      ],
      minor: 'google: flash bump / flash-lite / gemma / image',
    },
  },
  {
    id: 'xai',
    name: 'xAI',
    short: 'XAI',
    openRouterPrefixes: ['x-ai'],
    titlePattern: /\b(xai|grok|spacexai)\b/i,
    polymarketCompany: 'SpaceXAI',
    xHandles: ['SpaceXAI', 'grok', 'elonmusk'],
    color: '#e6e6e6',
    glyph: '✕',
    huggingFaceOrgs: ['xai-org'],
    firstPartyHosts: ['x.ai'],
    tiers: {
      flagship: [{ name: 'xai: grok-N[.M]', pattern: /^grok-\d+(?:\.\d+)?(?:-heavy)?$/, undated: true }],
      minor: 'xai: build/code/fast/mini/multi-agent',
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    short: 'DSK',
    openRouterPrefixes: ['deepseek'],
    titlePattern: /\bdeepseek\b/i,
    polymarketCompany: 'DeepSeek',
    xHandles: ['deepseek_ai'],
    color: '#7480ff',
    glyph: '◈',
    huggingFaceOrgs: ['deepseek-ai'],
    firstPartyHosts: ['deepseek.com'],
    tiers: {
      flagship: [
        {
          name: 'deepseek: new V/R version, pro or untiered',
          pattern: /^deepseek-(?:chat-)?[vr]\d+(?:\.\d+)?(?:-pro)?$/,
          undated: true,
        },
      ],
      minor: 'deepseek: flash-only / dated refresh / exp / vision',
    },
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen',
    short: 'QWN',
    openRouterPrefixes: ['qwen'],
    titlePattern: /\b(qwen|alibaba)\b/i,
    polymarketCompany: 'Alibaba',
    xHandles: ['Alibaba_Qwen', 'JustinLin610'],
    color: '#d24bff',
    glyph: '❖',
    huggingFaceOrgs: ['Qwen'],
    firstPartyHosts: ['qwen.ai', 'qwenlm.github.io'],
    tiers: {
      flagship: [
        {
          name: 'qwen: first max of a version',
          pattern: /^qwen\d+(?:\.\d+)?-max(?:-preview)?$/,
          undated: true,
        },
        {
          name: 'qwen: debut of a new version (non-small tier)',
          pattern: /^qwen(?<version>\d+(?:\.\d+)?)-./,
          // A small or special tier, a Flash, or an open size under 100B total is not a flagship debut.
          unless: new RegExp(
            `^qwen[\\d.]+-(?:.*-)?(?:${SMALL_TIERS})(?:-|$)|^qwen[\\d.]+-flash|-\\d{1,2}(?:\\.\\d+)?b(?:-a\\d+(?:\\.\\d+)?b)?(?:-it|-instruct)?$`,
          ),
          once: 'qwen:{version}',
        },
      ],
      marks: [{ pattern: /^qwen(?<version>\d+(?:\.\d+)?)/, key: 'qwen:{version}' }],
      minor: 'qwen: plus/flash/omni/size variant/dated after debut',
    },
  },
  {
    id: 'meta',
    name: 'Meta',
    short: 'MTA',
    openRouterPrefixes: ['meta-llama', 'meta'],
    titlePattern: /\b(meta|llama|muse)\b/i,
    polymarketCompany: 'Meta',
    xHandles: ['AIatMeta'],
    color: '#00a3ff',
    glyph: '∞',
    huggingFaceOrgs: ['meta-llama'],
    firstPartyHosts: ['ai.meta.com', 'about.fb.com'],
    tiers: {
      flagship: [
        {
          name: 'meta: muse spark N.M / llama largest',
          pattern: /^(?:muse-spark-\d+(?:\.\d+)?|llama-\d+(?:\.\d+)?-(?:maverick|behemoth|405b))$/,
        },
      ],
      minor: 'meta: contributor/glimmer/size/guard',
    },
  },
  {
    id: 'mistral',
    name: 'Mistral',
    short: 'MIS',
    openRouterPrefixes: ['mistralai'],
    titlePattern: /\bmistral\b/i,
    polymarketCompany: 'Mistral',
    xHandles: ['MistralAI'],
    color: '#ffd600',
    glyph: '▲',
    huggingFaceOrgs: [],
    firstPartyHosts: [],
    tiers: { flagship: [], minor: 'no flagship rule: not a frontier lab' },
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    short: 'KMI',
    openRouterPrefixes: ['moonshotai'],
    titlePattern: /\b(moonshot|kimi)\b/i,
    polymarketCompany: 'Moonshot',
    xHandles: ['Kimi_Moonshot'],
    color: '#ff2bd6',
    glyph: '☾',
    huggingFaceOrgs: [],
    firstPartyHosts: [],
    tiers: { flagship: [], minor: 'no flagship rule: not a frontier lab' },
  },
  {
    id: 'zai',
    name: 'Z.ai GLM',
    short: 'GLM',
    openRouterPrefixes: ['z-ai'],
    titlePattern: /\b(z\.ai|zhipu|glm)\b/i,
    polymarketCompany: 'Z.ai',
    xHandles: ['Zai_org'],
    color: '#00e5ff',
    glyph: '◭',
    huggingFaceOrgs: [],
    firstPartyHosts: [],
    tiers: { flagship: [], minor: 'no flagship rule: not a frontier lab' },
  },
];

export function labForOpenRouterId(modelId: string): Lab | undefined {
  const prefix = modelId.replace(/^~/, '').split('/')[0];
  return LABS.find((lab) => lab.openRouterPrefixes.includes(prefix));
}

export function labForTitle(title: string): Lab | undefined {
  return LABS.find((lab) => lab.titlePattern.test(title));
}

export function labById(id: string | undefined): Lab | undefined {
  return id ? LABS.find((lab) => lab.id === id) : undefined;
}

/** The lab behind a Hugging Face organisation (case-insensitive: the Hub treats `qwen` as `Qwen`). */
export function labForHuggingFaceOrg(org: string): Lab | undefined {
  const o = org.toLowerCase();
  return LABS.find((lab) => lab.huggingFaceOrgs.some((h) => h.toLowerCase() === o));
}

/** The lab whose own site `url` is on (a subdomain counts: api-docs.deepseek.com is DeepSeek's). */
export function labForHost(url: string): Lab | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
  return LABS.find((lab) => lab.firstPartyHosts.some((h) => host === h || host.endsWith(`.${h}`)));
}

/** A model as the tier rules read it: its sku, canonical base, snapshot and dropped tier word. */
export interface TierModel {
  sku: string;
  base: string;
  snapshot?: string;
  variant?: string;
}

export interface TierOverride {
  labId: LabId;
  /** The canonical sku, snapshot included (`qwen3.8-max@0902`). */
  sku: string;
  tier: Tier;
  reason: string;
}

/**
 * Releases the rules get wrong or could read either way, decided by hand. Applied before the rules;
 * every entry carries its reason. Reviewed against the 45 labelled releases of April to September
 * 2026 (data/backtest/labelled-releases.json).
 */
export const TIER_OVERRIDES: readonly TierOverride[] = [
  {
    labId: 'qwen',
    sku: 'qwen3.8-max@0902',
    tier: 'minor',
    reason:
      'OpenRouter calls it an updated snapshot of Qwen3.8 Max; Max shipped on 3 Aug (qwen.ai) and its open weights listed on 12 Aug as qwen3.8-2.4t-a95b.',
  },
  {
    labId: 'qwen',
    sku: 'qwen3.8-max-prime',
    tier: 'minor',
    reason:
      "A higher-throughput SKU of the shipped Qwen3.8 Max at twice its price ($4 in / $12 out against $2 / $6), pinned so a later rule never reads 'Prime' as a new top tier.",
  },
];

export interface TierVerdict {
  tier: Tier;
  /** The rule that decided, `alias`, or `override`. */
  rule: string;
  /** Set when a `TIER_OVERRIDES` entry decided. */
  override?: TierOverride;
}

function fill(template: string, groups: Record<string, string | undefined>): string {
  return template.replace(
    /\{(\w+)(?:\|([^}]*))?\}/g,
    (_, name: string, fallback = '') => groups[name] ?? fallback,
  );
}

function tierSlug(model: TierModel): string {
  return model.variant ? `${model.base}-${model.variant}` : model.base;
}

/**
 * One model's tier, given the keys earlier releases marked (`tierMarks`). An override decides first,
 * then an alias (`-latest`) is minor, then any of the lab's flagship rules; everything else is minor.
 */
export function modelTier(labId: LabId, model: TierModel, seen: ReadonlySet<string>): TierVerdict {
  const override = TIER_OVERRIDES.find((o) => o.labId === labId && o.sku === model.sku);
  if (override) return { tier: override.tier, rule: 'override', override };
  const slug = tierSlug(model);
  if (slug.endsWith('-latest')) return { tier: 'minor', rule: 'alias' };
  const lab = labById(labId);
  for (const rule of lab?.tiers.flagship ?? []) {
    const m = rule.pattern.exec(slug);
    if (!m || (rule.undated && model.snapshot) || rule.unless?.test(slug)) continue;
    if (rule.once && seen.has(fill(rule.once, m.groups ?? {}))) continue;
    return { tier: 'flagship', rule: rule.name };
  }
  return { tier: 'minor', rule: lab?.tiers.minor ?? 'unknown lab' };
}

/** The keys a model marks once it has shipped, whatever its tier. */
export function tierMarks(labId: LabId, model: TierModel): string[] {
  const slug = tierSlug(model);
  return (labById(labId)?.tiers.marks ?? []).flatMap(({ pattern, key }) => {
    const m = pattern.exec(slug);
    return m ? [fill(key, m.groups ?? {})] : [];
  });
}

/**
 * A release's tier: flagship when any of its models is. `rules` names what decided, over the models
 * of the release's own tier. `seen` holds the marks of every earlier release of the lab.
 */
export function tierOf(
  labId: LabId,
  models: readonly TierModel[],
  seen: ReadonlySet<string>,
): { tier: Tier; rules: string[]; overrides: TierOverride[] } {
  const verdicts = models.map((m) => modelTier(labId, m, seen));
  const tier: Tier = verdicts.some((v) => v.tier === 'flagship') ? 'flagship' : 'minor';
  const deciding = verdicts.filter((v) => v.tier === tier);
  return {
    tier,
    rules: [...new Set(deciding.map((v) => v.rule))].sort(),
    overrides: deciding.flatMap((v) => (v.override ? [v.override] : [])),
  };
}

/** Labs with release markets we deliberately leave off the board: SSI and Microsoft's MAI. */
const UNTRACKED_RELEASES = /\b(ssi|mai)\b/i;

/**
 * Open release markets that no lab's titlePattern claims. A registry gap hides a lab's best odds
 * (Muse Spark sat here at 85% while the Meta card read 4%), so this is a diagnostic worth logging.
 */
export function unmappedReleaseMarkets<M extends Pick<Market, 'kind' | 'labId' | 'title' | 'outcomes'>>(
  markets: readonly M[],
): M[] {
  return markets.filter(
    (m) =>
      m.kind === 'release' &&
      !m.labId &&
      !UNTRACKED_RELEASES.test(m.title) &&
      m.outcomes.some((o) => !o.closed),
  );
}

/** Rumour-mill accounts worth a click. X has no free read API, so these are links, not a feed. */
export const X_WATCHLIST: readonly { handle: string; why: string }[] = [
  { handle: 'sama', why: 'Vague-posts before OpenAI drops' },
  { handle: 'OpenAI', why: 'Official launches' },
  { handle: 'AnthropicAI', why: 'Official launches' },
  { handle: 'OfficialLoganK', why: 'Gemini hype thermometer' },
  { handle: 'GoogleDeepMind', why: 'Official launches' },
  { handle: 'elonmusk', why: 'Grok dates, occasionally accurate' },
  { handle: 'deepseek_ai', why: 'Drops with zero warning' },
  { handle: 'Alibaba_Qwen', why: 'Ships weekly' },
  { handle: 'testingcatalog', why: 'Leaks from app builds' },
  { handle: 'btibor91', why: 'Config-string archaeology' },
  { handle: 'apples_jimmy', why: 'Rumours, mixed record' },
  { handle: 'kimmonismus', why: 'Hype aggregator' },
  { handle: 'arena', why: 'Anonymous models appear here first' },
  { handle: 'openrouter', why: 'Stealth models land here' },
];
