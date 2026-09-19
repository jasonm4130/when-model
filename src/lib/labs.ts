/** The labs we watch — the "pizza shops" of whenmodel. */
export interface Lab {
  id: string;
  name: string;
  short: string;
  /** OpenRouter model id prefixes (before the slash). */
  orPrefixes: string[];
  /** Regexes matched against Polymarket event titles. */
  pmMatch: RegExp;
  /** Polymarket groupItemTitle used in "best AI model" markets. */
  pmCompany: string;
  x: string[];
  color: string;
  glyph: string;
}

export const LABS: Lab[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    short: 'OAI',
    orPrefixes: ['openai'],
    pmMatch: /\b(openai|gpt|chatgpt|sora|o\d)\b/i,
    pmCompany: 'OpenAI',
    x: ['OpenAI', 'sama', 'markchen90'],
    color: '#00ff9c',
    glyph: '◉',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    short: 'ANT',
    orPrefixes: ['anthropic'],
    pmMatch: /\b(anthropic|claude|opus|sonnet|haiku|fable|mythos)\b/i,
    pmCompany: 'Anthropic',
    x: ['AnthropicAI', 'claudeai', 'alexalbert__'],
    color: '#ff7a1a',
    glyph: '✱',
  },
  {
    id: 'google',
    name: 'Google DeepMind',
    short: 'GDM',
    orPrefixes: ['google'],
    pmMatch: /\b(google|gemini|deepmind|gemma|nano banana|veo)\b/i,
    pmCompany: 'Google',
    x: ['GoogleDeepMind', 'OfficialLoganK', 'demishassabis'],
    color: '#4b9bff',
    glyph: '◆',
  },
  {
    id: 'xai',
    name: 'xAI',
    short: 'XAI',
    orPrefixes: ['x-ai'],
    pmMatch: /\b(xai|grok|spacexai)\b/i,
    pmCompany: 'SpaceXAI',
    x: ['SpaceXAI', 'grok', 'elonmusk'],
    color: '#e6e6e6',
    glyph: '✕',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    short: 'DSK',
    orPrefixes: ['deepseek'],
    pmMatch: /\bdeepseek\b/i,
    pmCompany: 'DeepSeek',
    x: ['deepseek_ai'],
    color: '#4b59ff',
    glyph: '◈',
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen',
    short: 'QWN',
    orPrefixes: ['qwen'],
    pmMatch: /\b(qwen|alibaba)\b/i,
    pmCompany: 'Alibaba',
    x: ['Alibaba_Qwen', 'JustinLin610'],
    color: '#c400ff',
    glyph: '❖',
  },
  {
    id: 'meta',
    name: 'Meta',
    short: 'MTA',
    orPrefixes: ['meta-llama', 'meta'],
    pmMatch: /\b(meta|llama)\b/i,
    pmCompany: 'Meta',
    x: ['AIatMeta'],
    color: '#00a3ff',
    glyph: '∞',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    short: 'MIS',
    orPrefixes: ['mistralai'],
    pmMatch: /\bmistral\b/i,
    pmCompany: 'Mistral',
    x: ['MistralAI'],
    color: '#ffd600',
    glyph: '▲',
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    short: 'KMI',
    orPrefixes: ['moonshotai'],
    pmMatch: /\b(moonshot|kimi)\b/i,
    pmCompany: 'Moonshot',
    x: ['Kimi_Moonshot'],
    color: '#ff2bd6',
    glyph: '☾',
  },
  {
    id: 'zai',
    name: 'Z.ai GLM',
    short: 'GLM',
    orPrefixes: ['z-ai'],
    pmMatch: /\b(z\.ai|zhipu|glm)\b/i,
    pmCompany: 'Z.ai',
    x: ['Zai_org'],
    color: '#00e5ff',
    glyph: '◭',
  },
];

export function labForOpenRouterId(id: string): Lab | undefined {
  const prefix = id.replace(/^~/, '').split('/')[0];
  return LABS.find((l) => l.orPrefixes.includes(prefix));
}

export function labForTitle(title: string): Lab | undefined {
  return LABS.find((l) => l.pmMatch.test(title));
}

/** Rumour-mill accounts worth a click. No free X API exists, so these are links, not a feed. */
export const X_WATCHLIST = [
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
