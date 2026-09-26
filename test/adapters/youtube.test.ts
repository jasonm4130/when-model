import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from './mock-cache';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

const OPENAI_CHANNEL = 'UCXZCJLdBC09xxGZ6gcdrc6A';
const ANTHROPIC_CHANNEL = 'UCrDwWp7EBBv4NwvScIpBDOA';

function entry(opts: {
  id: string;
  channelId?: string;
  title?: string;
  published?: string;
  views?: number | null;
  href?: string;
}) {
  const {
    id,
    channelId = OPENAI_CHANNEL,
    title = 'Introducing a new model',
    published = '2026-09-25T12:00:00+00:00',
    views = 0,
    href = `https://www.youtube.com/watch?v=${id}`,
  } = opts;
  return `<entry>
    <id>yt:video:${id}</id>
    <yt:videoId>${id}</yt:videoId>
    <yt:channelId>${channelId}</yt:channelId>
    <title>${title}</title>
    <link rel="alternate" href="${href}"/>
    <published>${published}</published>
    <updated>${published}</updated>
    ${
      views === null
        ? ''
        : `<media:group><media:community><media:statistics views="${views}"/></media:community></media:group>`
    }
  </entry>`;
}

function feed(entries: string[]): string {
  return `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
    <title>OpenAI</title>
    ${entries.join('\n')}
  </feed>`;
}

describe('parseYoutubeFeed', () => {
  it('parses a well-formed entry, decoding the title', async () => {
    const { parseYoutubeFeed } = await import('../../src/adapters/youtube');
    const xml = feed([entry({ id: 'abc123', title: 'Introducing &amp; Launching Astra', views: 42 })]);
    expect(parseYoutubeFeed(xml)).toEqual([
      {
        videoId: 'abc123',
        channelId: OPENAI_CHANNEL,
        title: 'Introducing & Launching Astra',
        url: 'https://www.youtube.com/watch?v=abc123',
        publishedAt: '2026-09-25T12:00:00.000Z',
        views: 42,
      },
    ]);
  });

  it('defaults views to -1 when the feed carries no statistics block', async () => {
    const { parseYoutubeFeed } = await import('../../src/adapters/youtube');
    const xml = feed([entry({ id: 'no-stats', views: null })]);
    expect(parseYoutubeFeed(xml)[0].views).toBe(-1);
  });

  it('drops entries missing an id, title, http link or date', async () => {
    const { parseYoutubeFeed } = await import('../../src/adapters/youtube');
    const bad = `<feed>
      <entry><title>No video id</title><link rel="alternate" href="https://x.test/1"/><published>2026-09-25T00:00:00Z</published></entry>
      <entry><yt:videoId>v2</yt:videoId><yt:channelId>c</yt:channelId><link rel="alternate" href="javascript:alert(1)"/><published>2026-09-25T00:00:00Z</published><title>Bad link</title></entry>
    </feed>`;
    expect(parseYoutubeFeed(bad)).toEqual([]);
  });
});

describe('broadcastCandidates', () => {
  const now = new Date('2026-09-26T00:00:00Z');

  it('requires views==0, a matching title and freshness within 7 days', async () => {
    const { parseYoutubeFeed, broadcastCandidates } = await import('../../src/adapters/youtube');
    const entries = parseYoutubeFeed(
      feed([
        entry({ id: 'match', title: 'Introducing GPT-Next', views: 0, published: '2026-09-25T12:00:00Z' }),
        entry({
          id: 'has-views',
          title: 'Introducing GPT-Next',
          views: 5,
          published: '2026-09-25T12:00:00Z',
        }),
        entry({
          id: 'off-topic',
          title: 'A tour of our office',
          views: 0,
          published: '2026-09-25T12:00:00Z',
        }),
        entry({ id: 'stale', title: 'Introducing GPT-Next', views: 0, published: '2026-09-01T00:00:00Z' }),
      ]),
    );
    const out = broadcastCandidates(entries, now);
    expect(out.map((c) => c.videoId)).toEqual(['match']);
    expect(out[0]).toMatchObject({ channel: 'OpenAI', labId: 'openai', views: 0 });
  });

  it('matches every listed broadcast keyword, case-insensitively', async () => {
    const { parseYoutubeFeed, broadcastCandidates } = await import('../../src/adapters/youtube');
    const titles = [
      'LIVE: Q&A',
      'DevDay keynote',
      'dev day recap',
      'we ANNOUNCE something',
      'New Model Friday',
    ];
    const entries = parseYoutubeFeed(
      feed(
        titles.map((title, i) => entry({ id: `v${i}`, title, views: 0, published: '2026-09-25T12:00:00Z' })),
      ),
    );
    expect(broadcastCandidates(entries, now)).toHaveLength(titles.length);
  });

  it('drops a video from a channel outside the watchlist', async () => {
    const { parseYoutubeFeed, broadcastCandidates } = await import('../../src/adapters/youtube');
    const entries = parseYoutubeFeed(
      feed([entry({ id: 'unknown-ch', channelId: 'UCunknown0000000000000', views: 0 })]),
    );
    expect(broadcastCandidates(entries, now)).toEqual([]);
  });

  it('without firstSeen, accepts a fresh views==0 match on the first poll', async () => {
    const { parseYoutubeFeed, broadcastCandidates } = await import('../../src/adapters/youtube');
    const entries = parseYoutubeFeed(feed([entry({ id: 'first-poll', views: 0 })]));
    expect(broadcastCandidates(entries, now)).toHaveLength(1);
  });

  it('with firstSeen, requires the candidate to have been seen at least 15 minutes ago', async () => {
    const { parseYoutubeFeed, broadcastCandidates } = await import('../../src/adapters/youtube');
    const entries = parseYoutubeFeed(feed([entry({ id: 'v1', views: 0 }), entry({ id: 'v2', views: 0 })]));
    const firstSeen = new Map([
      ['v1', '2026-09-25T23:50:00Z'], // 10 min ago: too recent
      ['v2', '2026-09-25T23:30:00Z'], // 30 min ago: two-poll gate satisfied
    ]);
    expect(broadcastCandidates(entries, now, firstSeen).map((c) => c.videoId)).toEqual(['v2']);
  });

  it('with firstSeen, drops a candidate never seen on a prior poll', async () => {
    const { parseYoutubeFeed, broadcastCandidates } = await import('../../src/adapters/youtube');
    const entries = parseYoutubeFeed(feed([entry({ id: 'unseen', views: 0 })]));
    expect(broadcastCandidates(entries, now, new Map())).toEqual([]);
  });
});

describe('fetchYoutubeChannel', () => {
  it('fetches and parses the right channel URL', async () => {
    const xml = feed([entry({ id: 'x1', channelId: ANTHROPIC_CHANNEL, views: 3 })]);
    const calls = mockUpstream({
      [`https://www.youtube.com/feeds/videos.xml?channel_id=${ANTHROPIC_CHANNEL}`]: xml,
    });
    const { fetchYoutubeChannel, CHANNELS } = await import('../../src/adapters/youtube');
    const channel = CHANNELS.find((c) => c.channelId === ANTHROPIC_CHANNEL)!;
    const out = await fetchYoutubeChannel(channel);
    expect(out).toHaveLength(1);
    expect(calls).toEqual([`https://www.youtube.com/feeds/videos.xml?channel_id=${ANTHROPIC_CHANNEL}`]);
  });
});

describe('fetchScheduledStartTime', () => {
  it('extracts an ISO startTimestamp from the watch page', async () => {
    mockUpstream({
      'https://www.youtube.com/watch?v=live1':
        '{"isUpcoming":true,"liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-09-28T19:00:00+00:00"}}',
    });
    const { fetchScheduledStartTime } = await import('../../src/adapters/youtube');
    expect(await fetchScheduledStartTime('live1')).toBe('2026-09-28T19:00:00.000Z');
  });

  it('returns undefined when the page has no liveBroadcastDetails', async () => {
    mockUpstream({ 'https://www.youtube.com/watch?v=plain': '<html>no schedule here</html>' });
    const { fetchScheduledStartTime } = await import('../../src/adapters/youtube');
    expect(await fetchScheduledStartTime('plain')).toBeUndefined();
  });

  it('fails soft and logs when the fetch itself throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpstream({});
    const { fetchScheduledStartTime } = await import('../../src/adapters/youtube');
    expect(await fetchScheduledStartTime('missing')).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
  });
});
