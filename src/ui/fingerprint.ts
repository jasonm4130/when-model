/**
 * Content fingerprint of one page, shared by the server render and the browser's refresh poll.
 * Pure; safe to unit test.
 *
 * Every page reads the same /api/dashboard.json, but each shows a different slice of it, so each
 * hashes only its own slice (`PAGE_PARTS`): a new feed item offers NEW DATA on /radar and on the
 * lab it names, never on `/`. A slice holds only what a reader can see, at the precision the page
 * shows it: the level and headline, market prices as the panels render them ("66%", a thin book's "27–84%"), lab
 * reads, listing ids and prices, feed, trending and early-warning ids. It leaves out everything
 * that moves with the clock alone: `generatedAt`, raw probabilities (a curve read drifts as its
 * horizon slides), heat, days in stealth, hours ago, timings. `generatedAt` only decides which
 * release rungs are past, as it does on the page. Hashing the whole payload offered NEW DATA on
 * every rebuild. The rendered page carries its own fingerprint, so a tab opened in the background
 * and read later still notices the data it has never shown.
 */
import type { Dashboard } from '../domain/dashboard';
import type { LabStatus } from '../domain/lab-status';
import { displayOutcomes, type Market } from '../domain/market';
import { pct } from './format';
import {
  datedRungs,
  departureBoard,
  familyMarkets,
  isDeparture,
  otherServices,
  timetableState,
  windowNote,
  windowText,
  type Departure,
} from './departures';
import { labPage } from './lab-page';
import { arrivalBoard } from './signals';
import { outcomeOdds, readValue } from './odds';
import { PANEL_ROWS, asOfMs, dropPrice, otherRows, raceRows, releaseRows } from './panels';
import type { PageView } from './site';

type Visible = Partial<Dashboard>;

const list = <T>(value: readonly T[] | undefined): readonly T[] => (Array.isArray(value) ? value : []);

/** A lab's reads as its row prints them; a 72-hour or 30-day read from another family names it. */
const labReads = (l: LabStatus) => [
  l.id,
  readValue(l.odds?.p72),
  readValue(l.odds?.p7),
  readValue(l.odds?.p30),
  l.odds?.p72.family ?? null,
  l.odds?.p30.family ?? null,
];

/** Each slice of the dashboard a page can show, at displayed precision. */
const PARTS = {
  /** The level as the service status and /about print it: number, name, line and the score. */
  level: (d: Visible) => {
    const c = d.dropcon;
    return c && [c.level, c.name, c.state, c.score, c.headline, c.blurb];
  },
  /** How the score adds up, row by row, as /about prints it. */
  provenance: (d: Visible) => list(d.dropcon?.provenance).map((r) => [r.points, r.label, r.detail]),
  /**
   * The home page's departure board as printed: the next departure (with its boarding window) and
   * the "Then" rows (line, service, 7-day odds), and which lines are untimed and why.
   */
  departures: (d: Visible) => {
    const board = departureBoard(d);
    const t = Date.parse(d.generatedAt ?? '');
    const row = (x: Departure, later: boolean) =>
      later
        ? [x.lab.id, x.family, pct(x.p7)]
        : [x.lab.id, x.family, pct(x.p7), windowText(x.window, t), windowNote(x.window, t)];
    return {
      next: isDeparture(board.next) ? row(board.next, false) : board.next.reason,
      later: board.later.map((x) => row(x, true)),
      unavailable: board.unavailable.map((l) => l.id),
      untimed: board.untimed.map((l) => l.id),
      offline: board.offline,
    };
  },
  /**
   * Recent arrivals and the one service notice on the home page, as printed: each arrival's name,
   * line and minute (the same list as /radar's, without its source tags); the notice's slot, its
   * name, the day it appeared and its context.
   */
  arrivals: (d: Visible) => {
    const l = d.landed;
    return (
      l &&
      arrivalBoard({
        releases: list(l.releases),
        announcements: list(l.announcements),
        stories: list(l.stories),
      }).map((a) => [a.name, a.lab ?? null, a.at?.slice(0, 16) ?? null])
    );
  },
  notice: (d: Visible) => {
    const items = list(d.earlyWarnings?.stealth?.items);
    const slot = items[0];
    return [
      slot?.id ?? null,
      slot?.name ?? null,
      slot?.createdAt?.slice(0, 10) ?? null,
      slot?.contextLength ?? null,
      items.length,
    ];
  },
  /** The network: each line's state, its 7-day odds when timed, and its service. */
  network: (d: Visible) => {
    const up = d.measurement?.inputs?.oddsAvailable ?? true;
    return list(d.labs).map((l) => {
      const state = timetableState(l, up);
      return [
        l.id,
        state,
        state === 'scheduled' ? pct(l.odds?.p7.p) : null,
        l.odds?.family ?? null,
        l.status,
        l.releases30d,
      ];
    });
  },
  markets: (d: Visible) => {
    // Which rungs show depends on the build time (a past deadline drops out), as it does on the page.
    const asOf = asOfMs(d);
    const prices = (limit: number) => (m: Market) => [
      m.slug,
      displayOutcomes(m, limit, asOf).map((o) => [o.label, outcomeOdds(o).text]),
    ];
    return {
      releases: releaseRows(d).map(prices(PANEL_ROWS.releaseOutcomes)),
      others: otherRows(d).map(prices(PANEL_ROWS.otherOutcomes)),
      race: raceRows(d).map((o) => [o.label, pct(o.yes)]),
    };
  },
  warnings: (d: Visible) => {
    const w = d.earlyWarnings;
    return (
      w && [
        list(w.stealth?.items).map((s) => s.id),
        list(w.leaks?.items).map((x) => x.url),
        list(w.broadcasts?.items).map((b) => b.url),
        list(w.architectures?.items).map((a) => a.module),
        list(w.events?.items).map((e) => e.id),
      ]
    );
  },
  // /radar's Recent arrivals as printed: each launch once, its time to the minute and its source tags.
  landed: (d: Visible) => {
    const l = d.landed;
    return (
      l &&
      arrivalBoard({
        releases: list(l.releases),
        announcements: list(l.announcements),
        stories: list(l.stories),
      }).map((a) => [a.name, a.at?.slice(0, 16) ?? null, a.sightings.map((s) => [s.label, s.url])])
    );
  },
  drops: (d: Visible) =>
    list(d.drops)
      .slice(0, PANEL_ROWS.drops)
      .map((x) => [x.id, dropPrice(x)]),
  trending: (d: Visible) => list(d.trending).map((t) => t.id),
  papers: (d: Visible) =>
    list(d.papers)
      .slice(0, PANEL_ROWS.papers)
      .map((p) => p.id),
  feed: (d: Visible) => list(d.feed).map((f) => f.url),
  /** Source health as /about lists it: up or down, by name. */
  health: (d: Visible) => list(d.sources).map((s) => [s.name, s.ok]),
} as const;

type Part = keyof typeof PARTS;

/** What each page shows. A lab's page is its own selection (`labContent`). */
export const PAGE_PARTS: Readonly<Record<Exclude<PageView['page'], 'lab'>, readonly Part[]>> = {
  home: ['level', 'departures', 'arrivals', 'notice'],
  // The network carries each line's lead flags and the stealth count, so it hashes the warnings.
  labs: ['network', 'warnings'],
  markets: ['markets'],
  radar: ['warnings', 'landed', 'drops', 'trending', 'papers', 'feed'],
  about: ['level', 'provenance', 'health'],
};

/** One lab's page: its reads, its markets' prices and the items that name it. */
function labContent(d: Visible, id: string): unknown {
  const p = labPage(d, id);
  if (!p) return null;
  const asOf = asOfMs(d);
  return {
    reads: p.status ? labReads(p.status) : null,
    markets: p.markets.map((m) => [
      m.slug,
      displayOutcomes(m, PANEL_ROWS.releaseOutcomes, asOf).map((o) => [o.label, outcomeOdds(o).text]),
    ]),
    latest: p.status?.latest?.id ?? null,
    // The strip map's stops and the other services, as the line page prints them.
    rungs: p.status ? datedRungs(familyMarkets(d, p.status), asOf).map((r) => [r.day, pct(r.p)]) : [],
    others: p.status
      ? otherServices(d, p.status).map((o) => [o.family, o.stop ? [o.stop.day, pct(o.stop.p)] : null])
      : [],
    warnings: [
      p.leaks.map((x) => x.url),
      p.streams.map((x) => x.url),
      p.architectures.map((x) => x.module),
      p.events.map((x) => x.id),
    ],
    landed: [p.landed.map((r) => r.id), p.announcements.map((a) => a.url)],
    feed: p.feed.map((f) => f.url),
  };
}

/** The user-visible content of one page, at displayed precision. */
export function visibleContent(d: Visible, view: PageView): unknown {
  if (view.page === 'lab') return { lab: view.lab, content: labContent(d, view.lab) };
  return Object.fromEntries(PAGE_PARTS[view.page].map((part) => [part, PARTS[part](d)]));
}

export function pageFingerprint(dashboard: object, view: PageView): string {
  let content: unknown;
  try {
    content = visibleContent(dashboard as Visible, view);
  } catch {
    // A body of some other shape (an older deploy mid-rollout): hash it whole, minus its clock.
    const { generatedAt: _generatedAt, ...rest } = dashboard as Record<string, unknown>;
    content = rest;
  }
  return fnv1a(JSON.stringify(content));
}

/** 32-bit FNV-1a over UTF-16 code units: identical in the Worker and every browser, no async crypto. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
