/**
 * One lab's slice of the dashboard, for `/labs/<id>` and the home page's top three. Pure filters
 * over the memoised dashboard: a lab page makes no fetch of its own, and the refresh fingerprint
 * reads these same selections, so "what the lab page shows" means one thing.
 */
import type { Dashboard } from '../domain/dashboard';
import type { ArchitectureWarning, BroadcastWarning, LeakWarning } from '../domain/early-warnings';
import type { FeedItem, FeedSource } from '../domain/feed';
import { labById, type Lab, type LabId } from '../domain/lab';
import type { LabStatus } from '../domain/lab-status';
import type { LandedAnnouncement, LandedRelease } from '../domain/landed';
import type { EventWindow } from '../domain/lead';
import { displayOutcomes, type Market } from '../domain/market';
import { trustedP } from '../domain/lab-status';
import { PANEL_ROWS, asOfMs } from './panels';

/** How many of each list a lab page shows. */
export const LAB_PAGE_ROWS = { feed: 8 } as const;

/** The labs' own feeds: every post on one concerns its lab, whatever the title says. */
export const LAB_FEED_SOURCE: Readonly<Partial<Record<FeedSource, LabId>>> = {
  openai: 'openai',
  deepmind: 'google',
  anthropic: 'anthropic',
  xai: 'xai',
};

/** An item concerns a lab when it is from the lab's own feed or its title names the lab's models. */
function concerns(lab: Lab, source: FeedSource | undefined, title: string): boolean {
  if (source && LAB_FEED_SOURCE[source] !== undefined) return LAB_FEED_SOURCE[source] === lab.id;
  return lab.titlePattern.test(title);
}

/** Feed items that concern one lab, newest first as the feed already is. */
export function labFeed(feed: readonly FeedItem[], id: LabId): FeedItem[] {
  const lab = labById(id);
  return lab ? feed.filter((f) => concerns(lab, f.source, f.title)) : [];
}

/**
 * The top labs by their 7-day odds: trusted reads first (an extrapolated read is shown but never
 * scored), then the read itself, then the heat order the list already has. Labs with no read come
 * last, so with the odds offline this is the heat ranking.
 */
export function topLabs(labs: readonly LabStatus[], n = 3): LabStatus[] {
  return labs
    .map((l, i) => ({ l, i }))
    .sort(
      (a, b) =>
        trustedP(b.l.odds?.p7) - trustedP(a.l.odds?.p7) ||
        (b.l.odds?.p7.p ?? -1) - (a.l.odds?.p7.p ?? -1) ||
        a.i - b.i,
    )
    .slice(0, n)
    .map(({ l }) => l);
}

export interface LabPage {
  lab: Lab;
  /** The lab's card, as the lab list has it; absent only for a body of another shape. */
  status?: LabStatus;
  /** Its release markets with something still open to show, busiest first. */
  markets: Market[];
  /** The market behind its headline read, else its busiest: "its next named market". */
  next?: Market;
  leaks: LeakWarning[];
  streams: BroadcastWarning[];
  architectures: ArchitectureWarning[];
  events: EventWindow[];
  landed: LandedRelease[];
  announcements: LandedAnnouncement[];
  feed: FeedItem[];
}

type LabPageInput = Partial<
  Pick<Dashboard, 'labs' | 'markets' | 'earlyWarnings' | 'landed' | 'feed' | 'generatedAt'>
>;

/** Everything `/labs/<id>` shows, filtered from the dashboard. Undefined for an id not in the registry. */
export function labPage(d: LabPageInput, id: string): LabPage | undefined {
  const lab = labById(id);
  if (!lab) return undefined;
  const asOf = asOfMs(d);
  const status = (d.labs ?? []).find((l) => l.id === lab.id);
  const markets = (d.markets ?? []).filter(
    (m) =>
      m.kind === 'release' &&
      m.labId === lab.id &&
      displayOutcomes(m, PANEL_ROWS.releaseOutcomes, asOf).length > 0,
  );
  const marketUrl = status?.odds?.marketUrl;
  const next = markets.find((m) => m.url === marketUrl) ?? markets[0];
  const w = d.earlyWarnings;
  const l = d.landed;
  const announcements = (l?.announcements ?? []).filter((a) => concerns(lab, a.source, a.title));
  return {
    lab,
    status,
    markets,
    next,
    leaks: (w?.leaks.items ?? []).filter((x) => x.labId === lab.id),
    streams: (w?.broadcasts.items ?? []).filter((x) => x.labId === lab.id),
    architectures: (w?.architectures.items ?? []).filter((x) => x.labId === lab.id),
    events: (w?.events.items ?? []).filter((x) => x.labId === lab.id),
    landed: (l?.releases ?? []).filter((r) => r.labId === lab.id),
    announcements,
    // A launch post the lab section already lists is not repeated as a headline.
    feed: labFeed(d.feed ?? [], lab.id)
      .filter((f) => !announcements.some((a) => a.url === f.url))
      .slice(0, LAB_PAGE_ROWS.feed),
  };
}

/** How many early warnings name the lab: the count its page and the lab list print. */
export function labWarningCount(p: LabPage): number {
  return p.leaks.length + p.streams.length + p.architectures.length + p.events.length;
}
