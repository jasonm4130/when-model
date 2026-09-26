import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../fixtures/read';
import { mockUpstream } from './mock-cache';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ANTHROPIC_ATOM = fixture('anthropic-sdk-releases.atom');
const OPENAI_ATOM = fixture('openai-sdk-releases.atom');
const XAI_ATOM = fixture('xai-sdk-releases.atom');

const release = {
  tag_name: 'v0.80.0',
  html_url: 'https://github.com/anthropics/anthropic-sdk-python/releases/tag/v0.80.0',
  published_at: '2026-09-18T10:00:00Z',
  body: '## Features\n* api: add support for claude-fable-5-1 and claude-mythos-5-1\n* fixes streaming',
};
const AFTER = Date.parse('2026-09-19T00:00:00Z');

describe('releaseModelIds', () => {
  it('takes every model a changelog adds and ignores examples, docs and removals', async () => {
    const { releaseModelIds } = await import('../../src/adapters/github-releases');
    expect(releaseModelIds(release.body)).toEqual(['claude-fable-5.1', 'claude-mythos-5.1']);
    expect(
      releaseModelIds(
        [
          'Update README examples to use grok-4.6',
          'docs: mention gemini-3.5-flash in the quickstart',
          'Remove deprecated claude-3-opus alias',
          'Add GPT-6 Sol and Luna model identifiers',
        ].join('\n'),
      ),
    ).toEqual(['gpt-6-sol']);
  });
});

describe('parseReleasesAtom', () => {
  it('reads tags, links, times and escaped HTML bodies as one change per line', async () => {
    const { parseReleasesAtom } = await import('../../src/adapters/github-releases');
    const releases = parseReleasesAtom(ANTHROPIC_ATOM);
    expect(releases.map((r) => [r.tag, r.url, r.publishedAt])).toEqual([
      [
        'v1.8.0',
        'https://github.com/anthropics/anthropic-sdk-python/releases/tag/v1.8.0',
        '2026-09-22T16:25:23.000Z',
      ],
      [
        'v1.7.0',
        'https://github.com/anthropics/anthropic-sdk-python/releases/tag/v1.7.0',
        '2026-09-18T16:12:53.000Z',
      ],
    ]);
    expect(releases[0].body).toContain(
      'api: add support for claude-opus-5-5, inline tool definitions and MCP tool-list pinning (beta) (b5cc700)',
    );
    expect(releases[0].body).not.toMatch(/<|&lt;/);
    expect(parseReleasesAtom('<feed><entry><title>v1</title></entry></feed>')).toEqual([]);
  });
});

describe('sdkFeedItems', () => {
  it('confirms Claude Opus 5.5 from the Anthropic SDK, as an alert only inside 48 hours', async () => {
    const { parseReleasesAtom, sdkFeedItems } = await import('../../src/adapters/github-releases');
    const releases = parseReleasesAtom(ANTHROPIC_ATOM);
    const repo = 'anthropics/anthropic-sdk-python';
    const fresh = sdkFeedItems(releases, repo, 'Anthropic SDK', Date.parse('2026-09-23T00:00:00Z'));
    expect(fresh).toEqual([
      {
        source: 'github',
        title: 'Anthropic SDK v1.8.0 · confirms claude-opus-5.5',
        url: 'https://github.com/anthropics/anthropic-sdk-python/releases/tag/v1.8.0',
        publishedAt: '2026-09-22T16:25:23.000Z',
        precision: 'instant',
        meta: repo,
        alert: true,
      },
      expect.objectContaining({ title: 'Anthropic SDK v1.7.0', alert: false }),
    ]);
    const stale = sdkFeedItems(releases, repo, 'Anthropic SDK', Date.parse('2026-09-26T00:00:00Z'));
    expect(stale[0]).toMatchObject({
      title: 'Anthropic SDK v1.8.0 · confirms claude-opus-5.5',
      alert: false,
    });
  });

  it('keeps an alerting release visible after newer releases push it past the per-repo cap', async () => {
    const { parseReleasesAtom, sdkFeedItems } = await import('../../src/adapters/github-releases');
    const releases = parseReleasesAtom(OPENAI_ATOM);
    const inWindow = sdkFeedItems(
      releases,
      'openai/openai-python',
      'OpenAI SDK',
      Date.parse('2026-09-24T12:00:00Z'),
    );
    expect(inWindow.map((f) => [f.title, f.alert])).toEqual([
      ['OpenAI SDK v3.19.2', false],
      ['OpenAI SDK v3.19.1', false],
      ['OpenAI SDK v3.18.0 · confirms gpt-6-sol', true],
    ]);
    const later = sdkFeedItems(
      releases,
      'openai/openai-python',
      'OpenAI SDK',
      Date.parse('2026-09-26T00:00:00Z'),
    );
    expect(later.map((f) => f.title)).toEqual(['OpenAI SDK v3.19.2', 'OpenAI SDK v3.19.1']);
  });

  it('never re-announces a model a README bump or later release names again', async () => {
    const { parseReleasesAtom, sdkFeedItems } = await import('../../src/adapters/github-releases');
    const releases = parseReleasesAtom(XAI_ATOM);
    expect(releases.map((r) => r.tag)).toEqual(['v1.20.0', 'v1.19.0', 'v1.18.0']);
    const out = sdkFeedItems(
      releases,
      'xai-org/xai-sdk-python',
      'xAI SDK',
      Date.parse('2026-08-19T00:00:00Z'),
    );
    expect(out.map((f) => f.title)).toEqual(['xAI SDK v1.20.0', 'xAI SDK v1.19.0']);

    const again = [
      {
        tag: 'v2',
        url: 'https://g.test/2',
        publishedAt: '2026-09-18T12:00:00Z',
        body: 'Add grok-4.6-fast and grok-4.6',
      },
      {
        tag: 'v1',
        url: 'https://g.test/1',
        publishedAt: '2026-09-18T11:00:00Z',
        body: 'Add grok-4.6 to ChatModel',
      },
    ];
    expect(sdkFeedItems(again, 'r', 'L', AFTER).map((f) => [f.title, f.alert])).toEqual([
      ['L v2 · confirms grok-4.6-fast', true],
      ['L v1 · confirms grok-4.6', true],
    ]);
  });
});

describe('toFeedItem', () => {
  it('judges one REST release on its own', async () => {
    const { toFeedItem } = await import('../../src/adapters/github-releases');
    const f = toFeedItem(release, 'anthropics/anthropic-sdk-python', 'Anthropic SDK', AFTER)!;
    expect(f).toMatchObject({
      source: 'github',
      title: 'Anthropic SDK v0.80.0 · confirms claude-fable-5.1, claude-mythos-5.1',
      meta: 'anthropics/anthropic-sdk-python',
      alert: true,
      precision: 'instant',
      publishedAt: '2026-09-18T10:00:00.000Z',
    });
    expect(toFeedItem({ ...release, body: undefined }, 'r', 'L', AFTER)).toMatchObject({
      title: 'L v0.80.0',
      alert: false,
    });
    expect(toFeedItem(release, 'r', 'L')?.alert).toBe(false);
  });

  it('rejects releases missing a date, url or tag', async () => {
    const { toFeedItem } = await import('../../src/adapters/github-releases');
    expect(toFeedItem({ ...release, published_at: undefined }, 'r', 'L')).toBeUndefined();
    expect(toFeedItem({ ...release, html_url: 'ftp://x' }, 'r', 'L')).toBeUndefined();
    expect(toFeedItem({ ...release, tag_name: undefined }, 'r', 'L')).toBeUndefined();
  });
});

describe('fetchSdkReleases', () => {
  it('reads releases.atom, falls back to REST, and logs a repo that fails both', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-23T00:00:00Z') });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = mockUpstream({
      'https://github.com/anthropics/anthropic-sdk-python/releases.atom': ANTHROPIC_ATOM,
      'https://github.com/openai/openai-python/releases.atom': '<feed></feed>',
      'https://api.github.com/repos/openai/openai-python/releases?per_page=10': [
        { ...release, tag_name: 'v2.0.0', published_at: '2026-09-22T20:00:00Z', body: 'Add gpt-6-sol' },
        { tag_name: 'broken' },
      ],
      'https://api.github.com/repos/googleapis/python-genai/releases?per_page=10': null,
    });
    const { fetchSdkReleases } = await import('../../src/adapters/github-releases');
    const out = await fetchSdkReleases();
    expect(out.map((f) => [f.title, f.alert])).toEqual([
      ['Anthropic SDK v1.8.0 · confirms claude-opus-5.5', true],
      ['Anthropic SDK v1.7.0', false],
      ['OpenAI SDK v2.0.0 · confirms gpt-6-sol', true],
    ]);
    expect(calls).toContain('https://github.com/xai-org/xai-sdk-python/releases.atom');
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][1])).toMatch(/atom: .*xai-org\/xai-sdk-python.*; rest: /);
  });

  it('throws only when every repo fails', async () => {
    mockUpstream({});
    const { fetchSdkReleases } = await import('../../src/adapters/github-releases');
    await expect(fetchSdkReleases()).rejects.toThrow(/all 4 repos failed/);
  });
});
