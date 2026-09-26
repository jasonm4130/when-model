/**
 * Pure release-event helpers: first first-party HN story as the announcement, OpenRouter
 * `created` as availability, and the "some frontier lab lists a model within h" outcome the
 * base rate and the market forecast are both scored against.
 */
import { FRONTIER_LABS, labForOpenRouterId, type LabId } from '../../src/domain/lab';

export interface HnHit {
  id: string;
  /** created_at_i, epoch seconds. */
  t: number;
  title: string;
  url: string;
  /** Final points at pull time. Algolia has no at-the-time counts, so this is display only. */
  points: number;
}

export interface HnPull {
  query: string;
  from: string;
  to: string;
  hits: HnHit[];
}

export interface OpenRouterModel {
  id: string;
  name: string;
  /** Epoch seconds. OpenRouter can rewrite it (space-bunny-alpha moved by 28h), so it is availability, not a lead. */
  created: number;
  canonical: string;
}

/** `host` or `host/path-prefix`, matched case-insensitively against the story URL. */
export function isFirstParty(url: string, hosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase();
  return hosts.some((entry) => {
    const [h, ...rest] = entry.toLowerCase().split('/');
    const prefix = rest.length ? `/${rest.join('/')}` : '';
    return (host === h || host.endsWith(`.${h}`)) && path.startsWith(prefix);
  });
}

/** Earliest story in the pull that links a first-party host and (optionally) names the model. */
export function firstPartyStory(
  pull: HnPull | undefined,
  hosts: readonly string[],
  title?: RegExp,
): HnHit | undefined {
  return pull?.hits.find((hit) => isFirstParty(hit.url, hosts) && (!title || title.test(hit.title)));
}

/** Earliest `created` among the listed ids that OpenRouter still serves. */
export function availability(
  models: readonly OpenRouterModel[],
  ids: readonly string[],
): OpenRouterModel | undefined {
  return models
    .filter((m) => ids.includes(m.id))
    .reduce<OpenRouterModel | undefined>(
      (best, m) => (!best || m.created < best.created ? m : best),
      undefined,
    );
}

/** Listings that count as "a frontier lab listed a model": no aliases, batch/free twins or routers. */
export function frontierListings(
  models: readonly OpenRouterModel[],
  lab?: LabId,
): { t: number; lab: LabId }[] {
  const out: { t: number; lab: LabId }[] = [];
  for (const m of models) {
    if (m.id.startsWith('~') || /:(batch|free)$/.test(m.id)) continue;
    const found = labForOpenRouterId(m.id);
    if (!found || !FRONTIER_LABS.has(found.id) || (lab && found.id !== lab)) continue;
    out.push({ t: m.created, lab: found.id });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 1 when some listing lands in (t, t + horizon]. `times` must be sorted. */
export function listedWithin(times: readonly number[], t: number, horizon: number): 0 | 1 {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo < times.length && times[lo] <= t + horizon ? 1 : 0;
}
