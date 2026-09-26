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
