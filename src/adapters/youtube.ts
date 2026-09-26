/**
 * Lab YouTube channels, watched for scheduled-broadcast candidates (report T1-3).
 *
 * A lab's Atom feed carries an entry for a video the moment it is scheduled, before it airs:
 * `views` sits at 0 and the title is often a placeholder ("New models in the API"). That is the
 * only lead signal here; ordinary uploads leave `views=0` within minutes (measured in
 * `broadcastCandidates` below), so an entry that stays at 0 for an hour is a scheduled one.
 */
import type { LabId } from '../domain/lab';
import type { BroadcastCandidate } from '../domain/lead';
import { cachedText, cachedTextOrStale } from '../infra/edge-cache';
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

/** Edge-cache lifetime of a channel feed, in seconds. `broadcastCandidates` compensates for it. */
const FEED_TTL_S = 1800;
/**
 * How long a channel's last good feed stands in when YouTube fails. The feed endpoint fails in
 * bursts (2026-09-26: the OpenAI feed returned 404 twice in four rounds a second apart, then 200;
 * Anthropic failed 6 of 8 in one 43-second window), and one failed channel used to mark the whole
 * source down and skip the ledger write. Over 28 polls 15 minutes apart that day, every channel
 * failed 10 or 11 times, in runs of up to an hour, and all four answered together only 10 times.
 * Each colo keeps its own copy, so the window is a day: an old copy only adds streams, and
 * candidates are still judged as of when it was fetched.
 */
const STALE_TTL_S = 24 * 3600;

/** One channel's entries; `staleFrom` is set when YouTube failed and a last good copy was read. */
export interface ChannelFeed {
  entries: YoutubeEntry[];
  /** When the served copy was fetched: candidates are read as of then. */
  staleFrom?: string;
}

/**
 * One channel's feed, cached at the edge, falling back to its last good copy (up to
 * `STALE_TTL_S` old) when YouTube fails. Throws on a non-200, a network failure, or a body with no
 * parseable entries when there is no such copy: every watched channel carries 15, so an empty parse
 * means the response was not the feed (an interstitial, a format change) and must count as failed.
 */
export async function fetchYoutubeChannel(channel: YoutubeChannel): Promise<ChannelFeed> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
  const noEntries = () => new Error(`no entries in ${url}`);
  const { text, stale } = await cachedTextOrStale(url, {
    ttl: FEED_TTL_S,
    staleTtl: STALE_TTL_S,
    // Never cache, or keep as last good, a body that is not the feed.
    validate: (body) => {
      if (!parseYoutubeFeed(body).length) throw noEntries();
      return true;
    },
  });
  const entries = parseYoutubeFeed(text);
  if (!entries.length) throw noEntries();
  return stale ? { entries, staleFrom: stale.fetchedAt } : { entries };
}

const BROADCAST_TITLE = /introduc|live|livestream|keynote|new model|dev ?day|announce|launch/i;
const CANDIDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SEEN_AGE_MS = 15 * 60 * 1000;
/** YouTube's own `cache-control: public, max-age=900` on the feed; a body can be served that stale. */
const UPSTREAM_MAX_AGE_S = 900;
/**
 * 15 minutes at views=0 as of the moment the body was generated. The body we read can be our
 * edge TTL plus YouTube's max-age old, so the entry must be 15 + 30 + 15 = 60 minutes old.
 */
const MIN_ZERO_VIEW_AGE_MS = MIN_SEEN_AGE_MS + (FEED_TTL_S + UPSTREAM_MAX_AGE_S) * 1000;

/**
 * Empirical check (2026-09-26: ten high-volume news channels plus NASA polled at 00:37Z, eight
 * of them again at 00:52Z): ordinary uploads can read `views=0` briefly — Reuters `0VO36Y28KYE`
 * did at 5.5 min and had 37 views at 20.2 min, while ABC had 11 views at 5.6 min and DW 131 at
 * 6.6 min. Every
 * entry still at `views=0` past 20 minutes was a scheduled stream (NASA `j9epFget1W8` at 2.2h,
 * Sky News `RMKgbL7dXP4` and `SPtvJn-RRZE` at 3.5h and 4.8h, all `isUpcoming` on their watch
 * pages). DW's feed came back byte-identical across the 15-minute gap, so the stats in a body can
 * lag by YouTube's max-age too. None of the four lab feeds had a `views=0` entry at the time.
 *
 * Pure: candidates where `views === 0`, the entry is between 60 minutes and 7 days old, and the
 * title matches a broadcast-shaped pattern. When `firstSeen` is supplied (videoId → ISO first-seen
 * time, meant to be backed by D1 across cron polls), a candidate must also have been seen at least
 * 15 minutes ago — i.e. present on a prior poll, not just this one.
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
    const ageMs = nowMs - publishedMs;
    if (!Number.isFinite(ageMs) || ageMs < MIN_ZERO_VIEW_AGE_MS || ageMs > CANDIDATE_WINDOW_MS) continue;
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
    const html = await cachedText(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      ttl: 1800,
    });
    return toIso(html.match(LIVE_BROADCAST_DETAILS)?.[1]);
  } catch (e) {
    console.error('[source:youtube watch]', videoId, e instanceof Error ? e.message : e);
    return undefined;
  }
}

/** One poll of every lab channel. `failedChannels` is non-empty when the list is partial. */
export interface BroadcastFetch {
  candidates: BroadcastCandidate[];
  /** Labels of channels whose feed failed this poll with no last good copy; their candidates are missing, not absent. */
  failedChannels: string[];
  /** Labels of channels read from their last good copy (at most two hours old) because YouTube failed. */
  staleChannels?: string[];
}

/**
 * Every lab channel's Atom feed → stateless broadcast candidates (views=0, 60 min to 7 days old,
 * broadcast-shaped title). Individual channel failures are logged and reported in
 * `failedChannels`; this throws only when every channel fails. The two-poll first-seen gate is the
 * caller's (see `src/domain/early-warnings.ts`), since it needs D1. With `probeSchedule`, each
 * candidate's watch page (about 1.2 MB, cached 30 minutes) is fetched, fail-soft, for its
 * `scheduledStartTime`. Candidates are rare, so this costs nothing on a normal poll.
 */
export async function fetchBroadcasts(
  now: Date,
  options: { probeSchedule?: boolean } = {},
): Promise<BroadcastFetch> {
  const settled = await Promise.allSettled(CHANNELS.map((channel) => fetchYoutubeChannel(channel)));
  const failedChannels: string[] = [];
  const staleChannels: string[] = [];
  const candidates: BroadcastCandidate[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      failedChannels.push(CHANNELS[i].label);
      console.error('[source:YouTube broadcasts]', CHANNELS[i].label, r.reason);
      return;
    }
    // A last good copy is read as of when it was fetched, so its views=0 entries still had to be
    // an hour old then: an ordinary upload at 0 views in an old body is not a scheduled stream now.
    if (r.value.staleFrom) staleChannels.push(CHANNELS[i].label);
    candidates.push(
      ...broadcastCandidates(r.value.entries, r.value.staleFrom ? new Date(r.value.staleFrom) : now),
    );
  });
  if (failedChannels.length === settled.length)
    throw new Error(`all ${settled.length} YouTube channels failed`);

  const polled = { failedChannels, ...(staleChannels.length ? { staleChannels } : {}) };
  if (!options.probeSchedule || candidates.length === 0) return { candidates, ...polled };
  const withSchedule = await Promise.all(
    candidates.map(async (c) => {
      const scheduledStartTime = await fetchScheduledStartTime(c.videoId);
      return scheduledStartTime ? { ...c, scheduledStartTime } : c;
    }),
  );
  return { candidates: withSchedule, ...polled };
}
