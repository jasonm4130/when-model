import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from '../adapters/mock-cache';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

const OPENAI = 'UCXZCJLdBC09xxGZ6gcdrc6A';
const ANTHROPIC = 'UCrDwWp7EBBv4NwvScIpBDOA';
const DEEPMIND = 'UCP7jMXSY2xbc3KCAE0MHQ-A';
const GDEV = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const feedUrl = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const TRANSFORMERS_PRIMARY =
  'https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/__init__.py';

function candidateFeed(videoId: string, title = 'Introducing something new'): string {
  return `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
    <entry>
      <yt:videoId>${videoId}</yt:videoId>
      <yt:channelId>${OPENAI}</yt:channelId>
      <title>${title}</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/>
      <published>2026-09-25T12:00:00+00:00</published>
      <media:group><media:community><media:statistics views="0"/></media:community></media:group>
    </entry>
  </feed>`;
}

/** A channel with nothing scheduled: one ordinary upload that already has views. */
function quietFeed(channelId: string): string {
  return `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
    <entry>
      <yt:videoId>quiet-${channelId}</yt:videoId>
      <yt:channelId>${channelId}</yt:channelId>
      <title>Introducing a feature</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=quiet"/>
      <published>2026-09-25T12:00:00+00:00</published>
      <media:group><media:community><media:statistics views="5120"/></media:community></media:group>
    </entry>
  </feed>`;
}

describe('isWithinEventWindow / toEventWindow', () => {
  const start = '2026-09-29T17:00:00Z';

  it('is true from 72h before start through 24h after, inclusive', async () => {
    const { isWithinEventWindow } = await import('../../src/domain/lead');
    expect(isWithinEventWindow(start, new Date('2026-09-26T16:59:00Z'))).toBe(false);
    expect(isWithinEventWindow(start, new Date('2026-09-26T17:00:00Z'))).toBe(true);
    expect(isWithinEventWindow(start, new Date('2026-09-30T17:00:00Z'))).toBe(true);
    expect(isWithinEventWindow(start, new Date('2026-09-30T17:01:00Z'))).toBe(false);
  });

  it('rejects an unparseable start', async () => {
    const { isWithinEventWindow } = await import('../../src/domain/lead');
    expect(isWithinEventWindow('not-a-date', new Date())).toBe(false);
  });

  it('builds the window bounds and signed hoursToStart', async () => {
    const { toEventWindow } = await import('../../src/domain/lead');
    const event = {
      id: 'e1',
      label: 'DevDay 2026',
      labId: 'openai' as const,
      start,
      source: 'https://x.test',
    };
    const w = toEventWindow(event, new Date('2026-09-27T00:00:00Z'));
    expect(w).toEqual({
      id: 'e1',
      label: 'DevDay 2026',
      labId: 'openai',
      start,
      windowStart: '2026-09-26T17:00:00.000Z',
      windowEnd: '2026-09-30T17:00:00.000Z',
      source: 'https://x.test',
      hoursToStart: 65,
    });
  });
});

describe('fetchBroadcasts', () => {
  it('aggregates every channel and applies broadcastCandidates', async () => {
    mockUpstream({
      [feedUrl(OPENAI)]: candidateFeed('v1'),
      [feedUrl(ANTHROPIC)]: quietFeed(ANTHROPIC),
      [feedUrl(DEEPMIND)]: quietFeed(DEEPMIND),
      [feedUrl(GDEV)]: quietFeed(GDEV),
    });
    const { fetchBroadcasts } = await import('../../src/domain/lead');
    const out = await fetchBroadcasts(new Date('2026-09-26T00:00:00Z'));
    expect(out).toEqual([
      {
        videoId: 'v1',
        channel: 'OpenAI',
        labId: 'openai',
        title: 'Introducing something new',
        url: 'https://www.youtube.com/watch?v=v1',
        publishedAt: '2026-09-25T12:00:00.000Z',
        views: 0,
      },
    ]);
  });

  it('logs and skips a failed channel, still returning the others', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpstream({
      [feedUrl(OPENAI)]: candidateFeed('v1'),
      [feedUrl(ANTHROPIC)]: quietFeed(ANTHROPIC),
      [feedUrl(DEEPMIND)]: quietFeed(DEEPMIND),
      // GDEV missing on purpose: mockUpstream throws "404 <url>" for it.
    });
    const { fetchBroadcasts } = await import('../../src/domain/lead');
    const out = await fetchBroadcasts(new Date('2026-09-26T00:00:00Z'));
    expect(out.map((c) => c.videoId)).toEqual(['v1']);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('counts a 200 that is not a feed as a failed channel', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpstream({
      [feedUrl(OPENAI)]: candidateFeed('v1'),
      [feedUrl(ANTHROPIC)]: quietFeed(ANTHROPIC),
      [feedUrl(DEEPMIND)]: quietFeed(DEEPMIND),
      [feedUrl(GDEV)]: '<html>Before you continue to YouTube</html>',
    });
    const { fetchBroadcasts } = await import('../../src/domain/lead');
    expect((await fetchBroadcasts(new Date('2026-09-26T00:00:00Z'))).map((c) => c.videoId)).toEqual(['v1']);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][1])).toMatch(/no entries/);
  });

  it('throws only when every channel fails', async () => {
    mockUpstream({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fetchBroadcasts } = await import('../../src/domain/lead');
    await expect(fetchBroadcasts(new Date('2026-09-26T00:00:00Z'))).rejects.toThrow(
      /all 4 YouTube channels failed/,
    );
  });

  it('probes the watch page for a scheduledStartTime only when asked', async () => {
    mockUpstream({
      [feedUrl(OPENAI)]: candidateFeed('v1'),
      [feedUrl(ANTHROPIC)]: quietFeed(ANTHROPIC),
      [feedUrl(DEEPMIND)]: quietFeed(DEEPMIND),
      [feedUrl(GDEV)]: quietFeed(GDEV),
      'https://www.youtube.com/watch?v=v1':
        '{"liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-09-28T19:00:00+00:00"}}',
    });
    const { fetchBroadcasts } = await import('../../src/domain/lead');
    const now = new Date('2026-09-26T00:00:00Z');
    expect((await fetchBroadcasts(now))[0].scheduledStartTime).toBeUndefined();
    const withSchedule = await fetchBroadcasts(now, { probeSchedule: true });
    expect(withSchedule[0].scheduledStartTime).toBe('2026-09-28T19:00:00.000Z');
  });
});

describe('fetchArchitectures', () => {
  it('detects a live novel module beyond BASELINE and backdates the seeded one via PENDING_SEED', async () => {
    const { BASELINE } = await import('../../src/adapters/transformers-arch');
    const lines = BASELINE.map((m) => `    from .${m} import *`).join('\n');
    vi.resetModules();
    mockUpstream({
      [TRANSFORMERS_PRIMARY]: `if TYPE_CHECKING:\n${lines}\n    from .qwen_test_variant import *\n`,
    });
    const now = new Date('2026-09-26T12:03:40Z'); // exactly 31 days after the seed's verified mergedAt
    const { fetchArchitectures } = await import('../../src/domain/lead');
    const out = await fetchArchitectures([], now);

    expect(out.find((a) => a.module === 'qwen_test_variant')).toMatchObject({
      labId: 'qwen',
      since: now.toISOString(),
      sinceSource: 'detected',
      daysPending: 0,
      pending: true,
    });
    expect(out.find((a) => a.module === 'qwen4_exp')).toMatchObject({
      labId: 'qwen',
      since: '2026-08-26T12:03:40Z',
      sinceSource: 'seed',
      daysPending: 31,
      pending: true,
    });
  });

  it('clears a listed module and passes firstSeen through', async () => {
    const { BASELINE } = await import('../../src/adapters/transformers-arch');
    const lines = BASELINE.map((m) => `    from .${m} import *`).join('\n');
    vi.resetModules();
    mockUpstream({ [TRANSFORMERS_PRIMARY]: `if TYPE_CHECKING:\n${lines}\n` });
    const { fetchArchitectures } = await import('../../src/domain/lead');
    const now = new Date('2026-09-26T12:03:40Z');
    const out = await fetchArchitectures([{ id: 'qwen/qwen4-72b', name: 'Qwen4 72B' }], now);
    expect(out.find((a) => a.module === 'qwen4_exp')?.pending).toBe(false);
  });
});
