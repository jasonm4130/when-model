/**
 * LANDED: launches that already happened. Displayed, labelled and linked, never scored: they
 * detect a release after the fact, and v2 reached DROPCON 1 on exactly this kind of activity.
 * Pure: `now` is passed in.
 */
import { releaseEvents, withinDays, type Drop, type ReleaseModel } from './drop';
import { distinctAlertModels, isReleaseHeadline, modelIds, type FeedItem, type FeedSource } from './feed';
import type { LabId } from './lab';

/** First-party lab feeds whose alerting posts count as announcements. */
const LAB_FEEDS: ReadonlySet<FeedSource> = new Set<FeedSource>(['openai', 'deepmind', 'anthropic', 'xai']);

/** Stories need this much traction to count as a launch event (F4). */
export const LAUNCH_STORY_POINTS = 150;
/**
 * A date-only post is pinned to 00:00Z of its date, so its first sighting can trail that by a
 * day plus time zones and the 15-minute cron. A sighting later than this is a missed baseline
 * (a busy capture, an outage, the 90-day prune), not news, so the printed date stands.
 */
export const FEED_DAY_MAX_LAG_MS = 36 * 3_600_000;
const BANNER_HOURS = 48;
const HOUR_MS = 3_600_000;

export interface LandedRelease {
  id: string;
  lab: string;
  labId?: LabId;
  /** The event's listings, named without their vendor prefix. */
  name: string;
  /** OpenRouter `created` of the first listing: availability, not announcement. */
  firstListedAt: string;
  hoursAgo: number;
  models: ReleaseModel[];
}

export interface LandedStory {
  title: string;
  url: string;
  score: number;
  publishedAt: string;
  modelIds: string[];
}

export interface LandedAnnouncement {
  source: FeedSource;
  title: string;
  url: string;
  publishedAt: string;
  /** When the post counts from: the ledger's first sighting for a date-only post, else `publishedAt`. */
  seenAt: string;
  precision: 'instant' | 'day';
  modelIds: string[];
}

export interface Landed {
  /** Always false: after-the-fact activity is shown, never scored. */
  scored: false;
  /** Distinct frontier text launches listed on OpenRouter in the last 7 days, newest first. */
  releases: LandedRelease[];
  /** Hacker News launch stories: 150+ points, a release-shaped title, one per URL and model. */
  stories: LandedStory[];
  /** Launch posts from the labs' own feeds in the last 7 days. */
  announcements: LandedAnnouncement[];
  /** Distinct model ids across stories and announcements, so one launch counts once. */
  models: string[];
  /** A frontier launch was listed in the last 48 hours: show "MODELS JUST LANDED" beside the level. */
  banner: boolean;
  bannerText?: string;
  summary: string;
}

export interface LandedInputs {
  drops: readonly Drop[];
  /** Every feed item fetched, uncapped. */
  feed: readonly FeedItem[];
  /** Day-precision post URL → first sighting, from the ledger. */
  feedDaySeen?: ReadonlyMap<string, string>;
}

/** Lower-case host without `www.`, no query, hash or trailing slash: one story per article. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path}`;
  } catch {
    return url;
  }
}

function eventName(models: readonly ReleaseModel[]): string {
  const names = [...new Set(models.map((m) => m.name.replace(/^[^:]+:\s*/, '')))];
  return names.length <= 2 ? names.join(' / ') : `${names[0]} +${names.length - 1} more`;
}

export function buildLanded(input: LandedInputs, now: number): Landed {
  const releases: LandedRelease[] = releaseEvents(input.drops, now)
    .filter((e) => e.frontier && withinDays(e.firstListedAt, 7, now))
    .map((e) => ({
      id: e.id,
      lab: e.lab,
      ...(e.labId ? { labId: e.labId } : {}),
      name: eventName(e.models),
      firstListedAt: e.firstListedAt,
      hoursAgo: Math.round(((now - Date.parse(e.firstListedAt)) / HOUR_MS) * 10) / 10,
      models: e.models,
    }));

  const stories: LandedStory[] = [];
  const storyUrls = new Set<string>();
  const storyModels = new Set<string>();
  const candidates = input.feed
    .filter(
      (f) =>
        f.source === 'hn' &&
        (f.score ?? 0) >= LAUNCH_STORY_POINTS &&
        isReleaseHeadline(f.title) &&
        withinDays(f.publishedAt, 7, now),
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const f of candidates) {
    const key = canonicalUrl(f.url);
    const ids = modelIds(f.title);
    if (storyUrls.has(key) || ids.every((id) => storyModels.has(id))) continue;
    storyUrls.add(key);
    for (const id of ids) storyModels.add(id);
    stories.push({
      title: f.title,
      url: f.url,
      score: f.score ?? 0,
      publishedAt: f.publishedAt,
      modelIds: ids,
    });
  }

  const announcementUrls = new Set<string>();
  const announcements: LandedAnnouncement[] = [];
  for (const f of input.feed) {
    if (!LAB_FEEDS.has(f.source) || !f.alert) continue;
    const precision = f.precision ?? 'instant';
    const sighted = precision === 'day' ? input.feedDaySeen?.get(f.url) : undefined;
    const seenAt =
      sighted && Date.parse(sighted) - Date.parse(f.publishedAt) <= FEED_DAY_MAX_LAG_MS
        ? sighted
        : f.publishedAt;
    const key = canonicalUrl(f.url);
    if (!withinDays(seenAt, 7, now) || announcementUrls.has(key)) continue;
    announcementUrls.add(key);
    announcements.push({
      source: f.source,
      title: f.title,
      url: f.url,
      publishedAt: f.publishedAt,
      seenAt,
      precision,
      modelIds: modelIds(f.title),
    });
  }
  announcements.sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt));

  const models = distinctAlertModels([
    ...stories.map((s) => ({
      source: 'hn' as const,
      title: s.title,
      url: s.url,
      publishedAt: s.publishedAt,
      alert: true,
    })),
    ...announcements.map((a) => ({
      source: a.source,
      title: a.title,
      url: a.url,
      publishedAt: a.publishedAt,
      alert: true,
    })),
  ]);

  const fresh = releases.filter((r) => now - Date.parse(r.firstListedAt) < BANNER_HOURS * HOUR_MS);
  const n = releases.length;
  return {
    scored: false,
    releases,
    stories,
    announcements,
    models,
    banner: fresh.length > 0,
    ...(fresh.length ? { bannerText: `MODELS JUST LANDED: ${fresh.map((r) => r.name).join(', ')}` } : {}),
    summary: n
      ? `${n} frontier launch${n === 1 ? '' : 'es'} this week: ${releases.map((r) => r.name).join(', ')}`
      : 'No frontier launches listed on OpenRouter this week',
  };
}
