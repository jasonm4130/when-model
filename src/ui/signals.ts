/**
 * Presentation of the lead signals: per-lab flags, one-sentence track records built from the
 * measured constants, and the sources each panel's pill reads (`sourcePill` in `panels.ts` builds
 * the pill). Pure; safe to unit test.
 */
import {
  ARCHITECTURE_LAST_LEAD,
  ARCHITECTURE_TRACK,
  BROADCAST_TRACK,
  LEAK_TRACK,
  type EarlyWarnings,
} from '../domain/early-warnings';
import { hitRate } from '../domain/lab-events';
import type { Landed } from '../domain/landed';
import { labForModelId, type FeedSource } from '../domain/feed';
import { LABS, type LabId } from '../domain/lab';
import { SOURCE } from '../domain/sources';
import { REVEAL_STATS } from '../domain/stealth';

const round1 = (x: number) => Math.round(x * 10) / 10;
/** "a, b and c". */
const andList = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** One short sentence per signal, every number from its track-record constant. */
export const TRACK_LINES = {
  stealth: `${REVEAL_STATS.all.n} revealed slots listed officially a median ${round1(REVEAL_STATS.all.medianDays)} days later.`,
  leaks: `${LEAK_TRACK.launched} of ${LEAK_TRACK.n} leaks listed within ${LEAK_TRACK.windowDays} days, a median ${round1(LEAK_TRACK.medianLeadDays)} days later (in-sample).`,
  // The misses are part of the record: a stream list without them read as "OpenAI always streams first".
  broadcasts: `Streams went up ahead of ${BROADCAST_TRACK.n} of ${BROADCAST_TRACK.n + BROADCAST_TRACK.openAiMisses.length} OpenAI launches checked, a median ${BROADCAST_TRACK.medianLeadHours} h ahead (${BROADCAST_TRACK.minLeadHours}–${BROADCAST_TRACK.maxLeadHours} h); none before ${andList(BROADCAST_TRACK.openAiMisses)}.`,
  architectures: `Led ${ARCHITECTURE_TRACK.leads} of ${ARCHITECTURE_TRACK.n} dated releases, a median ${ARCHITECTURE_TRACK.medianLeadDays} days ahead (Qwen and Z.ai only), but none of the ${ARCHITECTURE_TRACK.datedSinceLastLead} since ${ARCHITECTURE_LAST_LEAD}.`,
  events: (() => {
    const rate = hitRate();
    return `${rate.hits} of ${rate.total} past keynotes debuted a frontier model.`;
  })(),
} as const;

export interface LeadFlag {
  kind: 'leak' | 'stream' | 'arch' | 'keynote';
  /** Short tag text, e.g. "LEAK ×2" or "STREAM 5H". */
  label: string;
  /** What raised it, for the hover title. */
  detail: string;
  /** The early-warnings subsection that lists it, on /radar. */
  href: string;
}

const hours = (h: number) => `${Math.max(0, Math.round(h))}H`;
const count = (n: number) => (n > 1 ? ` ×${n}` : '');

/**
 * The lead signals that name this lab: unlisted leaks, scheduled streams, pending architectures
 * and keynote windows. Stealth slots are anonymous by design, so no card ever carries one.
 */
export function leadFlags(w: EarlyWarnings, labId: LabId): LeadFlag[] {
  const flags: LeadFlag[] = [];
  const leaks = w.leaks.items.filter((l) => l.labId === labId);
  if (leaks.length)
    flags.push({
      kind: 'leak',
      label: `LEAK${count(leaks.length)}`,
      detail: leaks.map((l) => `${l.title} (${l.sourceName})`).join('; '),
      href: '/radar#ew-leaks',
    });
  const streams = w.broadcasts.items.filter((b) => b.labId === labId);
  if (streams.length) {
    const next = streams
      .map((b) => b.startsInHours)
      .filter((h): h is number => h !== undefined && h >= 0)
      .sort((a, b) => a - b)[0];
    flags.push({
      kind: 'stream',
      label: `STREAM${next !== undefined ? ` ${hours(next)}` : count(streams.length)}`,
      detail: streams.map((b) => `${b.channel}: ${b.title}`).join('; '),
      href: '/radar#ew-streams',
    });
  }
  const archs = w.architectures.items.filter((a) => a.labId === labId);
  if (archs.length)
    flags.push({
      kind: 'arch',
      label: `ARCH${count(archs.length)}`,
      detail: archs.map((a) => `${a.module}, ${Math.round(a.daysPending)}d pending`).join('; '),
      href: '/radar#ew-arch',
    });
  const events = w.events.items.filter((e) => e.labId === labId);
  if (events.length) {
    const e = events[0];
    flags.push({
      kind: 'keynote',
      label: e.hoursToStart >= 0 ? `KEYNOTE ${hours(e.hoursToStart)}` : 'KEYNOTE LIVE',
      detail: events.map((x) => x.label).join('; '),
      href: '/radar#ew-events',
    });
  }
  return flags;
}

/** The sources each signals panel reads. */
export const EARLY_WARNING_SOURCES = [
  SOURCE.openrouter,
  SOURCE.hnLeaks,
  SOURCE.testingCatalog,
  SOURCE.youtube,
  SOURCE.transformers,
] as const;
/** The labs' own feeds LANDED reads announcements from, named so no check depends on list order. */
export const LANDED_LAB_FEEDS = [SOURCE.openai, SOURCE.deepmind, SOURCE.anthropic, SOURCE.xai] as const;
export const LANDED_SOURCES = [SOURCE.openrouter, SOURCE.hnLaunches, ...LANDED_LAB_FEEDS] as const;

/** "5h ago" / "3d ago" from fractional hours, for rows that carry an age rather than a timestamp. */
export function hoursAgo(h: number): string {
  return h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
}

/** "2.6d" under ten days, whole days above. */
export function daysShort(n: number): string {
  return `${n < 10 ? n.toFixed(1) : Math.round(n)}d`;
}

// ─── recent arrivals ─────────────────────────────────────────────────────────

/** One place a launch was seen: its OpenRouter listing, the lab's own post, or a Hacker News story. */
export interface ArrivalSighting {
  kind: 'listing' | 'post' | 'story';
  /** The tag as printed: "OPENROUTER", "ANTHROPIC POST", "HN". */
  label: string;
  /** Its hover title, e.g. "883 points on Hacker News": points move every poll, so they stay off the tag. */
  title?: string;
  url: string;
}

/** One launch on /radar's Recent arrivals, with every source that saw it. */
export interface Arrival {
  /** The launch as named by its listing, else by the post or story that is all there is of it. */
  name: string;
  lab?: string;
  labId?: LabId;
  url: string;
  /** When it arrived: the first listing, else the post or story. */
  at: string;
  /** "dated by day" posts. */
  dayOnly: boolean;
  sightings: ArrivalSighting[];
}

const POST_LABEL: Readonly<Partial<Record<FeedSource, string>>> = {
  openai: 'OPENAI POST',
  deepmind: 'DEEPMIND POST',
  anthropic: 'ANTHROPIC POST',
  xai: 'XAI POST',
};

const storyTag = (s: { score: number; url: string }): ArrivalSighting => ({
  kind: 'story',
  label: 'HN',
  title: `${s.score} points on Hacker News`,
  url: s.url,
});

/** A listing's model id without its vendor: "anthropic/claude-sonnet-5.5" → "claude-sonnet-5.5". */
const bare = (id: string) => id.replace(/^[^/]+\//, '').toLowerCase();

/** A post or story names a listed model when one of its ids is the model, or the model's tail ("sonnet-5.5"). */
const names = (ids: readonly string[], models: readonly string[]) =>
  ids.some((id) => models.some((m) => m === id || m.endsWith(`-${id}`)));

/**
 * The week's launches, each once: a listing gathers the lab posts and Hacker News stories that name
 * one of its models, and a post or story no listing claims stands as its own arrival. Newest first.
 * A launch seen three ways is one row with three tags, never three rows.
 */
export function arrivalBoard(l: Pick<Landed, 'releases' | 'announcements' | 'stories'>): Arrival[] {
  // Posts and stories are claimed separately: a story often links the very post it discusses.
  const usedPosts = new Set<string>();
  const usedStories = new Set<string>();
  /** The line a post or story no listing claims belongs to, from the first model it names. */
  const lineOf = (ids: readonly string[]) => {
    const labId = ids.map(labForModelId).find(Boolean);
    const lab = LABS.find((x) => x.id === labId);
    return lab ? { lab: lab.name, labId: lab.id } : {};
  };
  const out: Arrival[] = l.releases.map((r) => {
    const models = r.models.map((m) => bare(m.id));
    const sightings: ArrivalSighting[] = [
      { kind: 'listing', label: 'OPENROUTER', url: r.models[0]?.url ?? 'https://openrouter.ai/models' },
    ];
    for (const a of l.announcements)
      if (!usedPosts.has(a.url) && names(a.modelIds, models)) {
        usedPosts.add(a.url);
        sightings.push({
          kind: 'post',
          label: POST_LABEL[a.source] ?? `${a.source.toUpperCase()} POST`,
          url: a.url,
        });
      }
    for (const s of l.stories)
      if (!usedStories.has(s.url) && names(s.modelIds, models)) {
        usedStories.add(s.url);
        sightings.push(storyTag(s));
      }
    return {
      name: r.name,
      lab: r.lab,
      ...(r.labId ? { labId: r.labId } : {}),
      url: sightings[0].url,
      at: r.firstListedAt,
      dayOnly: false,
      sightings,
    };
  });
  for (const a of l.announcements)
    if (!usedPosts.has(a.url))
      out.push({
        name: a.title,
        ...lineOf(a.modelIds),
        url: a.url,
        at: a.seenAt,
        dayOnly: a.precision === 'day',
        sightings: [
          { kind: 'post', label: POST_LABEL[a.source] ?? `${a.source.toUpperCase()} POST`, url: a.url },
        ],
      });
  for (const s of l.stories)
    if (!usedStories.has(s.url))
      out.push({
        name: s.title,
        ...lineOf(s.modelIds),
        url: s.url,
        at: s.publishedAt,
        dayOnly: false,
        sightings: [storyTag(s)],
      });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
