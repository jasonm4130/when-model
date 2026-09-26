import { describe, expect, it } from 'vitest';
import type { Drop } from '../../src/domain/drop';
import type { FeedItem } from '../../src/domain/feed';
import {
  FEED_DAY_MAX_LAG_MS,
  LAUNCH_STORY_POINTS,
  announcementKey,
  buildLanded,
  canonicalUrl,
} from '../../src/domain/landed';

const NOW = Date.parse('2026-09-26T03:00:00Z');
const HOUR = 3_600_000;

const listing = (id: string, name: string, hoursAgo: number, labId: Drop['labId']): Drop => ({
  id,
  name,
  lab: 'x',
  labId,
  createdAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
  url: `https://openrouter.ai/${id}`,
  free: false,
});
const story = (title: string, score: number, url: string, hoursAgo = 5): FeedItem => ({
  source: 'hn',
  title,
  url,
  publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
  score,
  alert: true,
});

describe('canonicalUrl', () => {
  it('drops www, query, hash and trailing slashes; leaves a non-URL alone', () => {
    expect(canonicalUrl('https://www.OpenAI.com/index/gpt-6/?utm=x#top')).toBe('openai.com/index/gpt-6');
    expect(canonicalUrl('not a url')).toBe('not a url');
  });
});

describe('buildLanded', () => {
  it('is empty and unscored with nothing listed', () => {
    const l = buildLanded({ drops: [], feed: [] }, NOW);
    expect(l).toMatchObject({
      scored: false,
      releases: [],
      stories: [],
      announcements: [],
      models: [],
      banner: false,
    });
    expect(l.bannerText).toBeUndefined();
    expect(l.summary).toBe('No frontier launches listed on OpenRouter this week');
  });

  it('lists frontier launches from the last 7 days and raises the banner under 48 hours', () => {
    const l = buildLanded(
      {
        drops: [
          listing('openai/gpt-6-sol', 'OpenAI: GPT-6 Sol', 10, 'openai'),
          listing('openai/gpt-6-luna', 'OpenAI: GPT-6 Luna', 10, 'openai'),
          listing('anthropic/claude-opus-5.5', 'Anthropic: Claude Opus 5.5', 100, 'anthropic'),
          listing('mistralai/mistral-large-4', 'Mistral: Mistral Large 4', 5, 'mistral'),
          listing('google/gemini-4', 'Google: Gemini 4', 24 * 8, 'google'),
        ],
        feed: [],
      },
      NOW,
    );
    expect(l.releases.map((r) => [r.labId, r.name, r.hoursAgo])).toEqual([
      ['openai', 'GPT-6 Sol / GPT-6 Luna', 10],
      ['anthropic', 'Claude Opus 5.5', 100],
    ]);
    expect(l.banner).toBe(true);
    expect(l.bannerText).toBe('MODELS JUST LANDED: GPT-6 Sol / GPT-6 Luna');
    expect(l.summary).toBe('2 frontier launches this week: GPT-6 Sol / GPT-6 Luna, Claude Opus 5.5');
  });

  it('names a many-model launch by its first model and a count', () => {
    const l = buildLanded(
      {
        drops: ['a', 'b', 'c'].map((s, i) => ({
          ...listing(`openai/gpt-6-${s}`, `OpenAI: GPT-6 ${s}`, 3, 'openai'),
          createdAt: new Date(NOW - 3 * HOUR + i * 1000).toISOString(),
        })),
        feed: [],
      },
      NOW,
    );
    expect(l.releases[0].name).toBe('GPT-6 a +2 more');
    expect(l.summary).toBe('1 frontier launch this week: GPT-6 a +2 more');
  });

  it('keeps one HN launch story per URL and per model, 150 points and up, release-shaped only', () => {
    const l = buildLanded(
      {
        drops: [],
        feed: [
          story('Introducing GPT-6 Sol', 900, 'https://openai.com/index/gpt-6-sol/'),
          story('GPT-6 Sol is now available', 400, 'https://www.openai.com/index/gpt-6-sol?ref=hn'),
          story('Introducing GPT-6 Sol and friends', 300, 'https://example.test/other'),
          story('Claude Opus 5.5 released', LAUNCH_STORY_POINTS - 1, 'https://anthropic.com/opus'),
          story('Why I stopped using ChatGPT', 2000, 'https://blog.test/essay'),
          story('Introducing Gemini 4', 500, 'https://blog.google/gemini-4', 24 * 8),
        ],
      },
      NOW,
    );
    expect(l.stories.map((s) => s.title)).toEqual(['Introducing GPT-6 Sol']);
    expect(l.models).toEqual(['gpt-6-sol']);
  });

  it('dates a day-precision announcement by its first sighting and dedups by URL', () => {
    const post: FeedItem = {
      source: 'anthropic',
      title: 'Introducing Claude Opus 5.5',
      url: 'https://www.anthropic.com/news/claude-opus-5-5',
      publishedAt: '2026-09-25T00:00:00.000Z',
      alert: true,
      precision: 'day',
    };
    const l = buildLanded(
      {
        drops: [],
        feed: [
          post,
          { ...post, url: 'https://anthropic.com/news/claude-opus-5-5/' },
          { ...post, source: 'hn', url: 'https://x.test' },
          { ...post, title: 'Our commitments', url: 'https://anthropic.com/c', alert: false },
          {
            source: 'openai',
            title: 'Introducing GPT-6 Sol',
            url: 'https://openai.com/sol',
            publishedAt: '2026-09-26T01:00:00.000Z',
            alert: true,
          },
        ],
        feedDaySeen: new Map([[post.url, '2026-09-25T17:45:00.000Z']]),
      },
      NOW,
    );
    expect(l.announcements.map((a) => [a.source, a.seenAt, a.precision])).toEqual([
      ['openai', '2026-09-26T01:00:00.000Z', 'instant'],
      ['anthropic', '2026-09-25T17:45:00.000Z', 'day'],
    ]);
    expect(l.models.sort()).toEqual(['claude-opus-5.5', 'gpt-6-sol']);
  });

  it('ignores a sighting more than 36 hours after a dated post: that is a missed baseline, not news', () => {
    // Live cold build: Grok 4.5's note (2026-07-08) was off the 60-item feed on the seeding
    // capture and was first recorded months later, so it resurfaced as a fresh announcement.
    const grok: FeedItem = {
      source: 'xai',
      title: 'Grok 4.5',
      url: 'https://docs.x.ai/developers/release-notes#grok-45',
      publishedAt: '2026-07-08T00:00:00.000Z',
      precision: 'day',
      alert: true,
    };
    const fresh: FeedItem = {
      ...grok,
      title: 'Grok 4.8',
      url: `${grok.url}-8`,
      publishedAt: '2026-09-24T00:00:00.000Z',
    };
    const within = new Date(Date.parse(fresh.publishedAt) + FEED_DAY_MAX_LAG_MS).toISOString();
    const l = buildLanded(
      {
        drops: [],
        feed: [grok, fresh],
        feedDaySeen: new Map([
          [grok.url, '2026-09-25T04:00:00.000Z'],
          [fresh.url, within],
        ]),
      },
      NOW,
    );
    expect(FEED_DAY_MAX_LAG_MS).toBe(36 * HOUR);
    expect(l.announcements.map((a) => [a.title, a.seenAt])).toEqual([['Grok 4.8', within]]);
    // One second later the sighting is too late to trust, and the printed date stands.
    const late = buildLanded(
      {
        drops: [],
        feed: [fresh],
        feedDaySeen: new Map([[fresh.url, new Date(Date.parse(within) + 1000).toISOString()]]),
      },
      NOW,
    );
    expect(late.announcements.map((a) => a.seenAt)).toEqual([fresh.publishedAt]);
  });

  it('keeps two xAI release notes on one page apart: the #anchor is the post', () => {
    const note = (title: string, anchor: string, date: string): FeedItem => ({
      source: 'xai',
      title,
      url: `https://docs.x.ai/developers/release-notes#${anchor}`,
      publishedAt: `${date}T00:00:00.000Z`,
      precision: 'day',
      alert: true,
    });
    const l = buildLanded(
      {
        drops: [],
        feed: [note('Grok 4.8', 'grok-48', '2026-09-25'), note('Grok 4.7', 'grok-47', '2026-09-21')],
      },
      NOW,
    );
    expect(l.announcements.map((a) => a.title)).toEqual(['Grok 4.8', 'Grok 4.7']);
    expect(announcementKey('https://www.anthropic.com/news/x/?utm=1')).toBe('anthropic.com/news/x');
    expect(announcementKey('https://docs.x.ai/developers/release-notes#grok-48')).toBe(
      'docs.x.ai/developers/release-notes#grok-48',
    );
    expect(announcementKey('not a url')).toBe('not a url');
  });
});
