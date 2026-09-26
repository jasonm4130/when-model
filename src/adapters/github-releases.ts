import { modelIds, type FeedItem } from '../domain/feed';
import { cachedJson, cachedText } from '../infra/edge-cache';
import { decodeEntities, isHttpUrl, toIso } from '../infra/text';

export interface GhReleaseDto {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
}

/** One SDK release, from the Atom feed or the REST fallback. `body` is plain text, one change per line. */
export interface SdkRelease {
  tag: string;
  url: string;
  publishedAt: string;
  body: string;
}

/**
 * SDK repos whose changelogs name a model when its API id ships. This confirms a launch rather
 * than leading it: the Anthropic SDK added claude-opus-5-5 four minutes before the release.
 */
export const SDK_REPOS: readonly { repo: string; label: string }[] = [
  { repo: 'anthropics/anthropic-sdk-python', label: 'Anthropic SDK' },
  { repo: 'openai/openai-python', label: 'OpenAI SDK' },
  { repo: 'googleapis/python-genai', label: 'Google GenAI SDK' },
  { repo: 'xai-org/xai-sdk-python', label: 'xAI SDK' },
];

/** A confirmation older than this is history, not news. */
export const SDK_ALERT_HOURS = 48;
/** Releases shown per repo; newer ones that confirm a model within the alert window always show. */
const SHOWN_PER_REPO = 2;
/** Lines that mention a model without adding it: examples, docs, and removals. */
const NOT_A_MODEL_ADD =
  /\b(?:examples?|readme|docs?|documentation|cookbook|notebooks?|deprecat\w*|remov\w*|retir\w*)\b/i;

/** Model ids a changelog adds, ignoring example, docs and removal lines. */
export function releaseModelIds(body: string): string[] {
  const kept = body
    .split('\n')
    .filter((line) => !NOT_A_MODEL_ADD.test(line))
    .join('\n');
  return modelIds(kept);
}

/** GitHub's releases.atom: escaped HTML content; tags become plain text, block ends become lines. */
export function parseReleasesAtom(xml: string): SdkRelease[] {
  const out: SdkRelease[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const tag = decodeEntities(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const url = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1];
    const publishedAt = toIso(entry.match(/<updated>([^<]+)<\/updated>/)?.[1]);
    const html = decodeEntities(entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? '');
    const body = html
      .split(/\n|<\/(?:li|p|h\d)>|<br\s*\/?>/i)
      .map((line) => decodeEntities(line))
      .filter(Boolean)
      .join('\n');
    if (tag && isHttpUrl(url) && publishedAt) out.push({ tag, url, publishedAt, body });
  }
  return out;
}

export function toSdkRelease(dto: GhReleaseDto): SdkRelease | undefined {
  const publishedAt = toIso(dto.published_at);
  if (!publishedAt || !isHttpUrl(dto.html_url) || typeof dto.tag_name !== 'string') return undefined;
  return { tag: dto.tag_name, url: dto.html_url, publishedAt, body: dto.body ?? '' };
}

/**
 * Feed items for one repo. A model id counts only in the oldest release that names it, so a
 * later README bump or re-export never re-announces it, and only a confirmation from the last
 * 48 hours is an alert.
 */
export function sdkFeedItems(
  releases: readonly SdkRelease[],
  repo: string,
  label: string,
  now: number,
): FeedItem[] {
  const oldestFirst = [...releases].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  const known = new Set<string>();
  const items = oldestFirst.map((r) => {
    const added = releaseModelIds(r.body).filter((id) => !known.has(id));
    for (const id of added) known.add(id);
    const fresh = now - Date.parse(r.publishedAt) <= SDK_ALERT_HOURS * 3_600_000;
    const item: FeedItem = {
      source: 'github',
      title: `${label} ${r.tag}${added.length ? ` · confirms ${added.join(', ')}` : ''}`,
      url: r.url,
      publishedAt: r.publishedAt,
      precision: 'instant',
      meta: repo,
      alert: added.length > 0 && fresh,
    };
    return item;
  });
  const newest = items.reverse();
  return newest.filter((item, i) => i < SHOWN_PER_REPO || item.alert);
}

/** One release as a feed item, judged on its own (no older releases to suppress ids against). */
export function toFeedItem(
  release: GhReleaseDto,
  repo: string,
  label: string,
  now = Date.now(),
): FeedItem | undefined {
  const r = toSdkRelease(release);
  return r ? sdkFeedItems([r], repo, label, now)[0] : undefined;
}

async function repoReleases(repo: string): Promise<SdkRelease[]> {
  try {
    const atom = parseReleasesAtom(
      await cachedText(`https://github.com/${repo}/releases.atom`, { ttl: 1800 }),
    );
    if (atom.length) return atom;
    throw new Error('releases.atom has no entries');
  } catch (atomError) {
    // The REST API allows 60 unauthenticated calls an hour per IP, shared across Workers egress.
    const url = `https://api.github.com/repos/${repo}/releases?per_page=10`;
    const rest = await cachedJson<GhReleaseDto[] | null>(url, { ttl: 1800 }).catch((restError) => {
      throw new Error(`atom: ${atomError}; rest: ${restError}`);
    });
    return (rest ?? []).map(toSdkRelease).filter((r): r is SdkRelease => r !== undefined);
  }
}

/** Latest releases per SDK. Throws only if every repo fails; partial failure is logged. */
export async function fetchSdkReleases(): Promise<FeedItem[]> {
  const now = Date.now();
  const settled = await Promise.allSettled(
    SDK_REPOS.map(async ({ repo, label }) => sdkFeedItems(await repoReleases(repo), repo, label, now)),
  );
  const failed = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length === settled.length)
    throw new Error(`all ${settled.length} repos failed: ${failed[0].reason}`);
  for (const f of failed) console.error('[source:GitHub SDKs]', f.reason);
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
