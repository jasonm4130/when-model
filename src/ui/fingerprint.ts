/**
 * Content fingerprint of a dashboard, shared by the server render and the browser's refresh poll.
 * Pure; safe to unit test.
 *
 * It hashes only what a reader can see, at the precision the page shows it: the level, score and
 * headline, market prices as the panels render them ("66%", "27–84¢"), lab reads, listing ids and
 * prices, feed, trending and early-warning ids. It leaves out everything that moves with the clock
 * alone: `generatedAt`, raw probabilities (a curve read drifts as its horizon slides), days in
 * stealth, hours ago, timings. `generatedAt` only decides which release rungs are past, as it does
 * on the page. Hashing the whole payload offered NEW DATA on every rebuild. The
 * rendered page carries its own fingerprint, so a tab opened in the background and read later still
 * notices the data it has never shown.
 */
import type { Dashboard } from '../domain/dashboard';
import { displayOutcomes, type Market } from '../domain/market';
import { pct } from './format';
import { outcomeOdds, readValue } from './odds';
import { PANEL_ROWS, asOfMs, dropPrice, otherRows, raceRows, releaseRows } from './panels';

type Visible = Partial<Dashboard>;

const list = <T>(value: readonly T[] | undefined): readonly T[] => (Array.isArray(value) ? value : []);

/** The user-visible content of a dashboard, at displayed precision. */
export function visibleContent(d: Visible): unknown {
  const c = d.dropcon;
  const w = d.earlyWarnings;
  // Which rungs show depends on the build time (a past deadline drops out), as it does on the page.
  const asOf = asOfMs(d);
  const prices = (limit: number) => (m: Market) => [
    m.slug,
    displayOutcomes(m, limit, asOf).map((o) => [o.label, outcomeOdds(o).text]),
  ];
  return {
    dropcon: c && [c.level, c.name, c.state, c.score, c.headline, list(c.provenance).map((r) => r.points)],
    releases: releaseRows(d).map(prices(PANEL_ROWS.releaseOutcomes)),
    others: otherRows(d).map(prices(PANEL_ROWS.otherOutcomes)),
    race: raceRows(d).map((o) => [o.label, pct(o.yes)]),
    labs: list(d.labs).map((l) => [
      l.id,
      readValue(l.odds?.p72),
      readValue(l.odds?.p7),
      readValue(l.odds?.p30),
    ]),
    drops: list(d.drops)
      .slice(0, PANEL_ROWS.drops)
      .map((x) => [x.id, dropPrice(x)]),
    feed: list(d.feed).map((f) => f.url),
    trending: list(d.trending).map((t) => t.id),
    papers: list(d.papers)
      .slice(0, PANEL_ROWS.papers)
      .map((p) => p.id),
    warnings: w && [
      list(w.stealth?.items).map((s) => s.id),
      list(w.leaks?.items).map((x) => x.url),
      list(w.broadcasts?.items).map((b) => b.url),
      list(w.architectures?.items).map((a) => a.module),
    ],
    landed: d.landed?.bannerText ?? null,
  };
}

export function dashboardFingerprint(dashboard: object): string {
  let content: unknown;
  try {
    content = visibleContent(dashboard as Visible);
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
