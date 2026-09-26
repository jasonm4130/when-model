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

// Verbatim entries from live feeds fetched 2026-09-26T00:37Z (descriptions elided): NASA's upcoming
// stream (watch page: isUpcoming, startTimestamp 2026-09-28T19:00Z), a Reuters upload 5.5 minutes
// old and still at views=0, and an OpenAI Short.
const LIVE_ENTRIES = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <id>yt:video:j9epFget1W8</id>
  <yt:videoId>j9epFget1W8</yt:videoId>
  <yt:channelId>UCLA_DiR1FfKNvjuUpBHmylQ</yt:channelId>
  <title>Space Station Operations Update (Sept. 28, 2026)</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=j9epFget1W8"/>
  <author>
   <name>NASA</name>
   <uri>https://www.youtube.com/channel/UCLA_DiR1FfKNvjuUpBHmylQ</uri>
  </author>
  <published>2026-09-25T22:24:07+00:00</published>
  <updated>2026-09-25T22:26:04+00:00</updated>
  <media:group>
   <media:title>Space Station Operations Update (Sept. 28, 2026)</media:title>
   <media:content url="https://www.youtube.com/v/j9epFget1W8?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i3.ytimg.com/vi/j9epFget1W8/hqdefault.jpg" width="480" height="360"/>
   <media:description>…</media:description>
   <media:community>
    <media:starRating count="26" average="5.00" min="1" max="5"/>
    <media:statistics views="0"/>
   </media:community>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:0VO36Y28KYE</id>
  <yt:videoId>0VO36Y28KYE</yt:videoId>
  <yt:channelId>UChqUTb7kYRX8-EiaN3XFrSQ</yt:channelId>
  <title>How drones and dollars are piling misery on Sudan's people</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=0VO36Y28KYE"/>
  <author>
   <name>Reuters</name>
   <uri>https://www.youtube.com/channel/UChqUTb7kYRX8-EiaN3XFrSQ</uri>
  </author>
  <published>2026-09-26T00:31:37+00:00</published>
  <updated>2026-09-26T00:32:00+00:00</updated>
  <media:group>
   <media:title>How drones and dollars are piling misery on Sudan's people</media:title>
   <media:content url="https://www.youtube.com/v/0VO36Y28KYE?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i1.ytimg.com/vi/0VO36Y28KYE/hqdefault.jpg" width="480" height="360"/>
   <media:description>…</media:description>
   <media:community>
    <media:starRating count="0" average="0.00" min="1" max="5"/>
    <media:statistics views="0"/>
   </media:community>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:rmDu2sSBIrw</id>
  <yt:videoId>rmDu2sSBIrw</yt:videoId>
  <yt:channelId>UCXZCJLdBC09xxGZ6gcdrc6A</yt:channelId>
  <title>Today’s forecast? Nothing but 80s, baby.</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/rmDu2sSBIrw"/>
  <author>
   <name>OpenAI</name>
   <uri>https://www.youtube.com/channel/UCXZCJLdBC09xxGZ6gcdrc6A</uri>
  </author>
  <published>2026-09-23T18:48:52+00:00</published>
  <updated>2026-09-23T18:49:12+00:00</updated>
  <media:group>
   <media:title>Today’s forecast? Nothing but 80s, baby.</media:title>
   <media:content url="https://www.youtube.com/v/rmDu2sSBIrw?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i3.ytimg.com/vi/rmDu2sSBIrw/hqdefault.jpg" width="480" height="360"/>
   <media:description>…</media:description>
   <media:community>
    <media:starRating count="220" average="5.00" min="1" max="5"/>
    <media:statistics views="7256"/>
   </media:community>
  </media:group>
 </entry>
</feed>`;

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

  it('reads the live feed layout: entry title (not media:title), statistics views, Shorts links', async () => {
    const { parseYoutubeFeed } = await import('../../src/adapters/youtube');
    expect(
      parseYoutubeFeed(LIVE_ENTRIES).map((e) => [e.videoId, e.channelId, e.publishedAt, e.views, e.url]),
    ).toEqual([
      [
        'j9epFget1W8',
        'UCLA_DiR1FfKNvjuUpBHmylQ',
        '2026-09-25T22:24:07.000Z',
        0,
        'https://www.youtube.com/watch?v=j9epFget1W8',
      ],
      [
        '0VO36Y28KYE',
        'UChqUTb7kYRX8-EiaN3XFrSQ',
        '2026-09-26T00:31:37.000Z',
        0,
        'https://www.youtube.com/watch?v=0VO36Y28KYE',
      ],
      [
        'rmDu2sSBIrw',
        'UCXZCJLdBC09xxGZ6gcdrc6A',
        '2026-09-23T18:48:52.000Z',
        7256,
        'https://www.youtube.com/shorts/rmDu2sSBIrw',
      ],
    ]);
    expect(parseYoutubeFeed(LIVE_ENTRIES)[2].title).toBe('Today’s forecast? Nothing but 80s, baby.');
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

  it('holds back a views==0 match until it is 60 minutes old (15 at zero + 30 edge cache + 15 upstream)', async () => {
    const { parseYoutubeFeed, broadcastCandidates } = await import('../../src/adapters/youtube');
    // Ordinary uploads can read views=0 for their first minutes: live, Reuters 0VO36Y28KYE did at
    // 5.5 min and had 37 views at 20.2 min; ABC had 11 views at 5.6 min.
    const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
    const entries = parseYoutubeFeed(
      feed([
        entry({ id: 'fresh', published: at(5.5) }),
        entry({ id: 'stale-body', published: at(59) }),
        entry({ id: 'aged', published: at(60) }),
        entry({ id: 'future', published: at(-60) }),
      ]),
    );
    expect(broadcastCandidates(entries, now).map((c) => c.videoId)).toEqual(['aged']);
  });

  it('without firstSeen, accepts an aged views==0 match on the first poll', async () => {
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

describe('fetchYoutubeChannel failures', () => {
  it('throws on a 200 body with no entries, so the channel counts as failed', async () => {
    mockUpstream({
      [`https://www.youtube.com/feeds/videos.xml?channel_id=${ANTHROPIC_CHANNEL}`]: '<html>consent</html>',
    });
    const { fetchYoutubeChannel, CHANNELS } = await import('../../src/adapters/youtube');
    const channel = CHANNELS.find((c) => c.channelId === ANTHROPIC_CHANNEL)!;
    await expect(fetchYoutubeChannel(channel)).rejects.toThrow(/no entries/);
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

// Moved from test/domain/lead.test.ts with the fetcher itself (domain/lead.ts is pure now).
const OPENAI = OPENAI_CHANNEL;
const ANTHROPIC = ANTHROPIC_CHANNEL;
const DEEPMIND = 'UCP7jMXSY2xbc3KCAE0MHQ-A';
const GDEV = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const feedUrl = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

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

describe('fetchBroadcasts', () => {
  it('aggregates every channel and applies broadcastCandidates', async () => {
    mockUpstream({
      [feedUrl(OPENAI)]: candidateFeed('v1'),
      [feedUrl(ANTHROPIC)]: quietFeed(ANTHROPIC),
      [feedUrl(DEEPMIND)]: quietFeed(DEEPMIND),
      [feedUrl(GDEV)]: quietFeed(GDEV),
    });
    const { fetchBroadcasts } = await import('../../src/adapters/youtube');
    const out = await fetchBroadcasts(new Date('2026-09-26T00:00:00Z'));
    expect(out.failedChannels).toEqual([]);
    expect(out.candidates).toEqual([
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
    const { fetchBroadcasts } = await import('../../src/adapters/youtube');
    const out = await fetchBroadcasts(new Date('2026-09-26T00:00:00Z'));
    expect(out.candidates.map((c) => c.videoId)).toEqual(['v1']);
    expect(out.failedChannels).toEqual(['Google for Developers']);
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
    const { fetchBroadcasts } = await import('../../src/adapters/youtube');
    const out = await fetchBroadcasts(new Date('2026-09-26T00:00:00Z'));
    expect(out.candidates.map((c) => c.videoId)).toEqual(['v1']);
    expect(out.failedChannels).toHaveLength(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][1]).toBe('Google for Developers');
    expect(String(err.mock.calls[0][2])).toMatch(/no entries/);
  });

  it('throws only when every channel fails', async () => {
    mockUpstream({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fetchBroadcasts } = await import('../../src/adapters/youtube');
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
    const { fetchBroadcasts } = await import('../../src/adapters/youtube');
    const now = new Date('2026-09-26T00:00:00Z');
    expect((await fetchBroadcasts(now)).candidates[0].scheduledStartTime).toBeUndefined();
    const withSchedule = await fetchBroadcasts(now, { probeSchedule: true });
    expect(withSchedule.candidates[0].scheduledStartTime).toBe('2026-09-28T19:00:00.000Z');
  });
});
