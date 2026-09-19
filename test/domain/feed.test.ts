import { describe, expect, it } from 'vitest';
import { looksLikeRelease, mentionsModel, newestFirst, type FeedItem } from '../../src/domain/feed';

describe('feed classification', () => {
  it('mentionsModel catches lab and model names but not generic tech', () => {
    expect(mentionsModel('Claude Fable 5.1 is here')).toBe(true);
    expect(mentionsModel('Show HN: a new LLM eval harness')).toBe(true);
    expect(mentionsModel('Rust 2.0 released')).toBe(false);
  });

  it('looksLikeRelease needs launch words or a version, not just a lab name', () => {
    expect(looksLikeRelease('Introducing Gemini 4')).toBe(true);
    expect(looksLikeRelease('Anthropic SDK v0.80.1')).toBe(true);
    expect(looksLikeRelease('Claude is now available in Europe')).toBe(true);
    expect(looksLikeRelease('Anthropic partners with a university')).toBe(false);
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
