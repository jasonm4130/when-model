import type { FeedSource, LeakSource } from './feed';

/**
 * Names of the upstream sources as the health list shows them. `load-dashboard.ts` names every
 * `collect()` with these, and the first-seen hooks read source health by them.
 */
export const SOURCE = {
  polymarket: 'Polymarket',
  openrouter: 'OpenRouter',
  hfTrending: 'HF trending',
  hfPapers: 'HF papers',
  hackerNews: 'Hacker News',
  hnLaunches: 'HN launch stories',
  openai: 'OpenAI news',
  deepmind: 'DeepMind blog',
  anthropic: 'Anthropic news',
  xai: 'xAI news',
  github: 'GitHub SDKs',
  hnLeaks: 'HN leaks',
  testingCatalog: 'TestingCatalog',
  youtube: 'YouTube broadcasts',
  transformers: 'transformers registry',
  ledger: 'First-seen ledger',
} as const;

/** Which health-list source produced a feed item. */
export const FEED_SOURCE_NAME: Readonly<Record<FeedSource, string>> = {
  hn: SOURCE.hackerNews,
  openai: SOURCE.openai,
  deepmind: SOURCE.deepmind,
  anthropic: SOURCE.anthropic,
  xai: SOURCE.xai,
  github: SOURCE.github,
};

/** Which health-list source produced a leak. */
export const LEAK_SOURCE_RESULT: Readonly<Record<LeakSource, string>> = {
  hn: SOURCE.hnLeaks,
  testingcatalog: SOURCE.testingCatalog,
};
