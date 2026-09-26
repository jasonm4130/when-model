/**
 * What the markets, drops and feed panels show, and how their source pills read. Pure; the server
 * render, the browser's refresh fingerprint and the tests all read the same selections, so "as
 * rendered" means one thing.
 */
import type { Dashboard } from '../domain/dashboard';
import type { Drop } from '../domain/drop';
import type { FeedSource } from '../domain/feed';
import { LABS, type LabId } from '../domain/lab';
import { displayOutcomes, isPlaceholderOutcome, type Market, type Outcome } from '../domain/market';
import { perMillion } from './format';

/** Rows each panel renders. Phones (≤480px) see the first `MOBILE_*` and a <details> for the rest. */
export const PANEL_ROWS = {
  releases: 14,
  releaseOutcomes: 4,
  others: 12,
  otherOutcomes: 3,
  race: 8,
  drops: 22,
  papers: 6,
} as const;
export const MOBILE_MARKETS = 6;
export const MOBILE_DROPS = 8;
/** Below 900px the feed has no inner scroller: this many items, then an expander. */
export const MOBILE_FEED = 12;

type MarketsView = Partial<Pick<Dashboard, 'markets' | 'bestModelMarket'>>;

/** Release markets with at least one open outcome to show, busiest first. */
export function releaseRows(d: MarketsView): Market[] {
  return (d.markets ?? [])
    .filter((m) => m.kind === 'release' && displayOutcomes(m, PANEL_ROWS.releaseOutcomes).length > 0)
    .slice(0, PANEL_ROWS.releases);
}

/** Leaderboard markets other than the best-model race, then everything else model-relevant. */
export function otherRows(d: MarketsView): Market[] {
  const markets = d.markets ?? [];
  const shown = (m: Market) => displayOutcomes(m, PANEL_ROWS.otherOutcomes).length > 0;
  const boards = markets.filter(
    (m) => m.kind === 'leaderboard' && m.slug !== d.bestModelMarket?.slug && shown(m),
  );
  const other = markets.filter((m) => m.kind === 'other' && shown(m));
  return [...boards.slice(0, 10), ...other.slice(0, 10)].slice(0, PANEL_ROWS.others);
}

/** The best-model race: open, named outcomes, likeliest first. */
export function raceRows(d: MarketsView): Outcome[] {
  const best = d.bestModelMarket;
  if (!best) return [];
  return best.outcomes
    .filter((o) => !o.closed && !isPlaceholderOutcome(o))
    .sort((a, b) => b.yes - a.yes)
    .slice(0, PANEL_ROWS.race);
}

/** A listing's price column: "FREE", "—", or "$in / $out" per million tokens. */
export function dropPrice(x: Pick<Drop, 'free' | 'promptPerM' | 'completionPerM'>): string {
  if (x.free) return 'FREE';
  if (x.promptPerM === undefined) return '—';
  return `${perMillion(x.promptPerM)} / ${perMillion(x.completionPerM ?? 0)}`;
}

/** Listings that are anonymous stealth slots: flagged by OpenRouter's adapter or live in early warnings. */
export function stealthIds(d: Partial<Pick<Dashboard, 'drops' | 'earlyWarnings'>>): Set<string> {
  const ids = new Set((d.earlyWarnings?.stealth?.items ?? []).map((s) => s.id));
  for (const x of d.drops ?? []) if (x.stealth) ids.add(x.id);
  return ids;
}

// ─── feed sources ────────────────────────────────────────────────────────────

export const FEED_LABELS: Readonly<Record<FeedSource, string>> = {
  hn: 'HN',
  openai: 'OPENAI',
  deepmind: 'DEEPMIND',
  anthropic: 'ANTHROPIC',
  github: 'GITHUB',
  xai: 'XAI',
};

/** A lab's own feed wears the lab's colour from `LABS`, so the feed and the lab cards agree. */
const FEED_LAB: Readonly<Partial<Record<FeedSource, LabId>>> = {
  openai: 'openai',
  deepmind: 'google',
  anthropic: 'anthropic',
  xai: 'xai',
};
/** Hacker News and GitHub are nobody's lab. HN was orange, the same as Anthropic. */
const FEED_OWN: Readonly<Partial<Record<FeedSource, string>>> = {
  hn: 'var(--yellow)',
  github: 'var(--muted)',
};

export function feedColour(source: FeedSource): string {
  const lab = FEED_LAB[source];
  return (lab && LABS.find((l) => l.id === lab)?.color) || FEED_OWN[source] || 'var(--muted)';
}

// ─── source pills ────────────────────────────────────────────────────────────

/** A panel older than this is no longer live: three missed 5-minute polls. */
export const STALE_AFTER_MS = 15 * 60_000;

export type PillState = 'live' | 'stale' | 'partial' | 'down';

export interface SourcePill {
  state: PillState;
  text: string;
  tone: 'live' | 'warn' | 'err';
  /** Which sources answered or why they didn't, for the tooltip. */
  title: string;
  /** When a live or partial pill turns stale on an open page, and what it then says. */
  staleAt?: string;
  staleText?: string;
}

type SourceHealth = Pick<Dashboard['sources'][number], 'name' | 'ok' | 'error'>;

/**
 * A panel's status pill, from its own sources' results: LIVE when every one answered, PARTIAL when
 * some did, DOWN when none did, and STALE once the data is `STALE_AFTER_MS` old. `label` names the
 * source ("POLYMARKET") or, for several, what they are ("FEEDS": "PARTIAL · 5/6 FEEDS").
 */
export function sourcePill(
  health: readonly SourceHealth[],
  names: readonly string[],
  generatedAt: string,
  now: number,
  label = names.length === 1 ? names[0].toUpperCase() : 'SOURCES',
): SourcePill {
  const results = names.map(
    (name) => health.find((s) => s.name === name) ?? { name, ok: false, error: 'no result' },
  );
  const down = results.filter((r) => !r.ok);
  const up = results.length - down.length;
  const title = results.map((r) => (r.ok ? `${r.name}: ok` : `${r.name}: ${r.error ?? 'down'}`)).join(' · ');
  const scope =
    names.length === 1
      ? label
      : down.length && up
        ? `${up}/${names.length} ${label}`
        : `${names.length} ${label}`;
  if (!up) return { state: 'down', text: `DOWN · ${scope}`, tone: 'err', title };

  const staleAtMs = Date.parse(generatedAt) + STALE_AFTER_MS;
  const staleText = `STALE · ${scope}`;
  if (!(now < staleAtMs)) return { state: 'stale', text: staleText, tone: 'warn', title };
  const staleAt = new Date(staleAtMs).toISOString();
  return down.length
    ? { state: 'partial', text: `PARTIAL · ${scope}`, tone: 'warn', title, staleAt, staleText }
    : { state: 'live', text: `LIVE · ${scope}`, tone: 'live', title, staleAt, staleText };
}

/** True when the named source answered this build; a missing result counts as down. */
export function sourceOk(health: readonly SourceHealth[], name: string): boolean {
  return health.some((s) => s.name === name && s.ok);
}
