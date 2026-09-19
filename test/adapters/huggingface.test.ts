import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from './mock-cache';

afterEach(() => vi.resetModules());

describe('huggingface mappers', () => {
  it('maps trending repos and drops rows without an id', async () => {
    const { toTrendingRepo } = await import('../../src/adapters/huggingface');
    expect(
      toTrendingRepo({
        id: 'org/model',
        likes: 3,
        downloads: 40,
        createdAt: '2026-09-01T00:00:00Z',
        trendingScore: 9,
      }),
    ).toEqual({
      id: 'org/model',
      url: 'https://huggingface.co/org/model',
      likes: 3,
      downloads: 40,
      createdAt: '2026-09-01T00:00:00.000Z',
      score: 9,
    });
    expect(toTrendingRepo({ id: 'bare' })).toMatchObject({
      likes: 0,
      downloads: 0,
      score: 0,
      createdAt: '1970-01-01T00:00:00.000Z',
    });
    expect(toTrendingRepo({})).toBeUndefined();
  });

  it('maps papers preferring the nested title and date', async () => {
    const { toPaper } = await import('../../src/adapters/huggingface');
    expect(
      toPaper({
        paper: { id: '2609.01234', title: 'Scaling Laws', upvotes: 12 },
        publishedAt: '2026-09-02T00:00:00Z',
      }),
    ).toEqual({
      id: '2609.01234',
      title: 'Scaling Laws',
      url: 'https://huggingface.co/papers/2609.01234',
      upvotes: 12,
      publishedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(
      toPaper({ paper: { id: 'x', publishedAt: '2026-09-03T00:00:00Z' }, title: 'outer' }),
    ).toMatchObject({
      title: 'outer',
      publishedAt: '2026-09-03T00:00:00.000Z',
    });
    expect(toPaper({ title: 'no id' })).toBeUndefined();
  });
});

describe('fetchers', () => {
  it('pass limit through and tolerate null bodies', async () => {
    const calls = mockUpstream({
      'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=3': [{ id: 'a/b' }, {}],
      'https://huggingface.co/api/daily_papers?limit=2': null,
    });
    const { fetchPapers, fetchTrending } = await import('../../src/adapters/huggingface');
    expect((await fetchTrending(3)).map((t) => t.id)).toEqual(['a/b']);
    expect(await fetchPapers(2)).toEqual([]);
    expect(calls).toHaveLength(2);
  });
});
