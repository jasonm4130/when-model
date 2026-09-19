import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from './mock-cache';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

const release = {
  tag_name: 'v0.80.0',
  html_url: 'https://github.com/anthropics/anthropic-sdk-python/releases/tag/v0.80.0',
  published_at: '2026-09-18T10:00:00Z',
  body: 'Adds support for claude-fable-5.1 and fixes streaming.',
};

describe('toFeedItem', () => {
  it('names the model the changelog mentions and alerts on it', async () => {
    const { toFeedItem } = await import('../../src/adapters/github-releases');
    const f = toFeedItem(release, 'anthropics/anthropic-sdk-python', 'Anthropic SDK')!;
    expect(f).toMatchObject({
      source: 'github',
      title: 'Anthropic SDK v0.80.0 · mentions claude-fable-5.1',
      meta: 'anthropics/anthropic-sdk-python',
      alert: true,
      publishedAt: '2026-09-18T10:00:00.000Z',
    });
    expect(toFeedItem({ ...release, body: 'bug fixes' }, 'r', 'L')).toMatchObject({
      title: 'L v0.80.0',
      alert: false,
    });
  });

  it('rejects releases missing a date, url or tag', async () => {
    const { toFeedItem } = await import('../../src/adapters/github-releases');
    expect(toFeedItem({ ...release, published_at: undefined }, 'r', 'L')).toBeUndefined();
    expect(toFeedItem({ ...release, html_url: 'ftp://x' }, 'r', 'L')).toBeUndefined();
    expect(toFeedItem({ ...release, tag_name: undefined }, 'r', 'L')).toBeUndefined();
  });
});

describe('fetchSdkReleases', () => {
  it('merges every repo and logs partial failures without throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpstream({
      'https://api.github.com/repos/anthropics/anthropic-sdk-python/releases': [release],
      'https://api.github.com/repos/openai/openai-python/releases': [{ ...release, tag_name: 'v2.0.0' }],
      'https://api.github.com/repos/googleapis/python-genai/releases': null,
    });
    const { fetchSdkReleases } = await import('../../src/adapters/github-releases');
    const out = await fetchSdkReleases();
    expect(out.map((f) => f.title)).toEqual([
      'Anthropic SDK v0.80.0 · mentions claude-fable-5.1',
      'OpenAI SDK v2.0.0 · mentions claude-fable-5.1',
    ]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][1])).toContain('xai-org/xai-sdk-python');
  });

  it('throws only when every repo fails', async () => {
    mockUpstream({});
    const { fetchSdkReleases } = await import('../../src/adapters/github-releases');
    await expect(fetchSdkReleases()).rejects.toThrow(/all 4 repos failed/);
  });
});
