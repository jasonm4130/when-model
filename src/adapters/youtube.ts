/**
 * Lab YouTube channels, watched for scheduled-broadcast candidates (report T1-3).
 *
 * A lab's Atom feed carries an entry for a video the moment it is scheduled, before it airs:
 * `views` sits at 0 and the title is often a placeholder ("New models in the API"). That is the
 * only lead signal here; ordinary uploads clear `views=0` fast (see `broadcastCandidates` below),
 * so the same test doubles as a scheduled-vs-ordinary discriminator.
 */
import type { LabId } from '../domain/lab';
import type { BroadcastCandidate } from '../domain/lead';
import { cachedText } from '../infra/edge-cache';
import { decodeEntities, isHttpUrl, toIso } from '../infra/text';

export interface YoutubeChannel {
  channelId: string;
  /** Human label shown on the card; also the expected Atom `<title>` (verified below). */
  label: string;
  labId: LabId;
}

/**
 * Channel titles verified live 2026-09-26 (`curl .../feeds/videos.xml?channel_id=…`, then
 * `<title>`): OpenAI, Anthropic, Google DeepMind, Google for Developers — all HTTP 200.
 * No xAI: `@xai` resolves to an unrelated channel (report T1-3).
 */
export const CHANNELS: readonly YoutubeChannel[] = [
  { channelId: 'UCXZCJLdBC09xxGZ6gcdrc6A', label: 'OpenAI', labId: 'openai' },
  { channelId: 'UCrDwWp7EBBv4NwvScIpBDOA', label: 'Anthropic', labId: 'anthropic' },
  { channelId: 'UCP7jMXSY2xbc3KCAE0MHQ-A', label: 'Google DeepMind', labId: 'google' },
  { channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', label: 'Google for Developers', labId: 'google' },
];

export interface YoutubeEntry {
  videoId: string;
  channelId: string;
  title: string;
  url: string;
  publishedAt: string;
  /** -1 when the feed carries no `media:statistics` block, so it can never satisfy `views === 0`. */
  views: number;
}

const ENTRY = /<entry>([\s\S]*?)<\/entry>/g;
const VIDEO_ID = /<yt:videoId>([^<]+)<\/yt:videoId>/;
const CHANNEL_ID = /<yt:channelId>([^<]+)<\/yt:channelId>/;
const TITLE = /<title>([^<]*)<\/title>/;
const LINK = /<link rel="alternate" href="([^"]+)"/;
const PUBLISHED = /<published>([^<]+)<\/published>/;
const VIEWS = /<media:statistics views="(\d+)"/;

/** Atom feed → entries. Malformed entries (no id, title, http link or date) are dropped. */
export function parseYoutubeFeed(xml: string): YoutubeEntry[] {
  const out: YoutubeEntry[] = [];
  for (const m of xml.matchAll(ENTRY)) {
    const block = m[1];
    const videoId = block.match(VIDEO_ID)?.[1];
    const channelId = block.match(CHANNEL_ID)?.[1];
    const title = decodeEntities(block.match(TITLE)?.[1] ?? '');
    const url = block.match(LINK)?.[1] ?? '';
    const publishedAt = toIso(block.match(PUBLISHED)?.[1]);
    const viewsRaw = block.match(VIEWS)?.[1];
    if (!videoId || !channelId || !title || !isHttpUrl(url) || !publishedAt) continue;
    out.push({
      videoId,
      channelId,
      title,
      url,
      publishedAt,
      views: viewsRaw !== undefined ? Number(viewsRaw) : -1,
    });
  }
  return out;
}

/** One channel's feed, cached at the edge. Throws on a non-200 or network failure. */
export async function fetchYoutubeChannel(channel: YoutubeChannel): Promise<YoutubeEntry[]> {
  const xml = await cachedText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`, {
    ttl: 1800,
  });
  return parseYoutubeFeed(xml);
}

const BROADCAST_TITLE = /introduc|live|livestream|keynote|new model|dev ?day|announce|launch/i;
const CANDIDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SEEN_AGE_MS = 15 * 60 * 1000;

/**
 * Empirical check (2026-09-26, current entries across all four feeds, ages 8.2h–303d): every
 * upload already has thousands of views by the time it appears in the feed at all — none sit at
 * `views=0`. `views=0` is therefore not an ordinary-upload artifact; when it does show up on a
 * fresh, title-matching entry it is a real signal, not caching lag. The two-poll ≥15min gate below
 * exists to reject the (unobserved but plausible) case of a genuinely fast-indexing view counter.
 *
 * Pure: candidates where `views === 0`, `publishedAt` is within the last 7 days, and the title
 * matches a broadcast-shaped pattern. When `firstSeen` is supplied (videoId → ISO first-seen time,
 * meant to be backed by D1 across cron polls), a candidate must also have been seen at least 15
 * minutes ago — i.e. present on a prior poll, not just this one.
 */
export function broadcastCandidates(
  entries: readonly YoutubeEntry[],
  now: Date,
  firstSeen?: ReadonlyMap<string, string>,
): BroadcastCandidate[] {
  const nowMs = now.getTime();
  const out: BroadcastCandidate[] = [];
  for (const entry of entries) {
    if (entry.views !== 0) continue;
    if (!BROADCAST_TITLE.test(entry.title)) continue;
    const publishedMs = Date.parse(entry.publishedAt);
    if (!Number.isFinite(publishedMs) || publishedMs > nowMs || nowMs - publishedMs > CANDIDATE_WINDOW_MS)
      continue;
    if (firstSeen) {
      const seenAt = firstSeen.get(entry.videoId);
      const seenMs = seenAt ? Date.parse(seenAt) : NaN;
      if (!Number.isFinite(seenMs) || nowMs - seenMs < MIN_SEEN_AGE_MS) continue;
    }
    const channel = CHANNELS.find((c) => c.channelId === entry.channelId);
    if (!channel) continue;
    out.push({
      videoId: entry.videoId,
      channel: channel.label,
      labId: channel.labId,
      title: entry.title,
      url: entry.url,
      publishedAt: entry.publishedAt,
      views: entry.views,
    });
  }
  return out;
}

const LIVE_BROADCAST_DETAILS = /"liveBroadcastDetails":\{[^}]*"startTimestamp":"([^"]+)"/;

/**
 * Optional, fail-soft: the watch page's `liveBroadcastDetails.startTimestamp` for a scheduled
 * premiere/livestream. Verified live 2026-09-26 against a known-upcoming video
 * (`youtube.com/watch?v=j9epFget1W8`): HTTP 200, no bot wall, `"isUpcoming":true` and
 * `"liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-09-28T19:00:00+00:00"}`
 * present in the served HTML. Never throws; returns undefined on any fetch or parse failure so a
 * missing schedule never costs the underlying candidate.
 */
export async function fetchScheduledStartTime(videoId: string): Promise<string | undefined> {
  try {
    const html = await cachedText(`https://www.youtube.com/watch?v=${videoId}`, { ttl: 300 });
    return toIso(html.match(LIVE_BROADCAST_DETAILS)?.[1]);
  } catch (e) {
    console.error('[source:youtube watch]', videoId, e instanceof Error ? e.message : e);
    return undefined;
  }
}
