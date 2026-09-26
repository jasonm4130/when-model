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

describe('languageTrending', () => {
  it('keeps chat, vision-language and any-to-any models in trending order', async () => {
    const { LANGUAGE_PIPELINES, languageTrending } = await import('../../src/adapters/huggingface');
    expect([...LANGUAGE_PIPELINES]).toEqual(['text-generation', 'image-text-to-text', 'any-to-any']);
    const models = [
      { id: 'deepseek-ai/DeepSeek-V4.1-Flash', pipeline_tag: 'image-text-to-text' },
      { id: 'black-forest-labs/FLUX.3', pipeline_tag: 'text-to-image' },
      { id: 'Qwen/Qwen3.8-27B', pipeline_tag: 'text-generation' },
      { id: 'untagged/model' },
      { pipeline_tag: 'text-generation' },
      { id: 'google/gemma-4-omni', pipeline_tag: 'any-to-any' },
    ];
    expect(languageTrending(models, 12).map((r) => r.id)).toEqual([
      'deepseek-ai/DeepSeek-V4.1-Flash',
      'Qwen/Qwen3.8-27B',
      'google/gemma-4-omni',
    ]);
    expect(languageTrending(models, 2)).toHaveLength(2);
  });
});

describe('fetchers', () => {
  it('fetch an unfiltered pool of 60, filter locally, and tolerate null bodies', async () => {
    const calls = mockUpstream({
      'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=60': [
        { id: 'a/b', pipeline_tag: 'text-generation' },
        { id: 'c/d', pipeline_tag: 'text-to-speech' },
        { id: 'e/f', pipeline_tag: 'image-text-to-text' },
        {},
      ],
      'https://huggingface.co/api/daily_papers?limit=2': null,
    });
    const { fetchPapers, fetchTrending } = await import('../../src/adapters/huggingface');
    expect((await fetchTrending(3)).map((t) => t.id)).toEqual(['a/b', 'e/f']);
    expect((await fetchTrending(1)).map((t) => t.id)).toEqual(['a/b']);
    expect(await fetchPapers(2)).toEqual([]);
    expect(calls).toHaveLength(3);
  });

  it('treat a null trending body as empty', async () => {
    mockUpstream({ 'https://huggingface.co/api/models': null });
    const { fetchTrending } = await import('../../src/adapters/huggingface');
    expect(await fetchTrending()).toEqual([]);
  });
});
