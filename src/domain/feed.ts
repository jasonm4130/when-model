export type FeedSource = 'hn' | 'openai' | 'deepmind' | 'anthropic' | 'github';

/** One headline in the OSINT feed, from any source. */
export interface FeedItem {
  source: FeedSource;
  title: string;
  url: string;
  publishedAt: string;
  score?: number;
  meta?: string;
  /** Shaped like a launch announcement; counts toward DROPCON. */
  alert: boolean;
}

const MODEL_WORDS =
  /\b(gpt|openai|claude|anthropic|gemini|deepmind|gemma|grok|xai|deepseek|llama|meta ai|qwen|alibaba|mistral|kimi|moonshot|glm|z\.ai|minimax|llm|ai model|agi|frontier model|o\d|sora|veo|arena|benchmark|weights|open.?source model)\b/i;

/** Lab names alone do not count: Anthropic says "Claude" in every post. */
const RELEASE_WORDS =
  /\b(introducing|announcing|releas\w+|launch\w+|now available|new model|drops?|ships?|unveil\w*|preview|general availability|v?\d+(\.\d+)+)\b/i;

export function mentionsModel(title: string): boolean {
  return MODEL_WORDS.test(title);
}

export function looksLikeRelease(title: string): boolean {
  return RELEASE_WORDS.test(title);
}

/** Hacker News stories need real traction before a launch-shaped title counts as an alert. */
export const HN_ALERT_POINTS = 150;

export function newestFirst(items: readonly FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
