import type { FeedItem } from '../domain/feed';
import { cachedJson } from '../infra/edge-cache';
import { isHttpUrl, toIso } from '../infra/text';

export interface GhReleaseDto {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
}

/** SDK repos whose changelogs tend to name a model before the blog post does. */
export const SDK_REPOS: readonly { repo: string; label: string }[] = [
  { repo: 'anthropics/anthropic-sdk-python', label: 'Anthropic SDK' },
  { repo: 'openai/openai-python', label: 'OpenAI SDK' },
  { repo: 'googleapis/python-genai', label: 'Google GenAI SDK' },
  { repo: 'xai-org/xai-sdk-python', label: 'xAI SDK' },
];

const MODEL_ID = /\b(gpt|claude|gemini|grok)[-\w.]*\d[-\w.]*/i;

export function toFeedItem(release: GhReleaseDto, repo: string, label: string): FeedItem | undefined {
  const publishedAt = toIso(release.published_at);
  if (!publishedAt || !isHttpUrl(release.html_url) || typeof release.tag_name !== 'string') return undefined;
  const modelHint = (release.body ?? '').match(MODEL_ID)?.[0];
  return {
    source: 'github',
    title: `${label} ${release.tag_name}${modelHint ? ` · mentions ${modelHint}` : ''}`,
    url: release.html_url,
    publishedAt,
    meta: repo,
    alert: !!modelHint,
  };
}

/** Latest releases per SDK. Throws only if every repo fails; partial failure is logged. */
export async function fetchSdkReleases(): Promise<FeedItem[]> {
  const settled = await Promise.allSettled(
    SDK_REPOS.map(async ({ repo, label }) => {
      const url = `https://api.github.com/repos/${repo}/releases?per_page=2`;
      const releases = await cachedJson<GhReleaseDto[] | null>(url, { ttl: 1800 });
      return (releases ?? [])
        .map((r) => toFeedItem(r, repo, label))
        .filter((f): f is FeedItem => f !== undefined);
    }),
  );
  const failed = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length === settled.length)
    throw new Error(`all ${settled.length} repos failed: ${failed[0].reason}`);
  for (const f of failed) console.error('[source:GitHub SDKs]', f.reason);
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
