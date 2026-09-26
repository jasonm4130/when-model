/**
 * Network half of `pnpm backtest --refresh`. Every function returns plain data for raw/*.json;
 * nothing here is imported by the Worker. Requests are sequential-ish (small pool) and capped,
 * because these are free public APIs.
 */
import { labForTitle } from '../../src/domain/lab';
import {
  compactPoints,
  DAY,
  eventKind,
  parseRung,
  trimGammaEvent,
  type RawEvent,
  type RawSeries,
} from './markets';
import type { HnHit, HnPull, OpenRouterModel } from './events';

const UA = 'whenmodel.com/1.0 (+https://whenmodel.com; signal dashboard) backtest';
const GAMMA = 'https://gamma-api.polymarket.com/events/keyset';
const CLOB = 'https://clob.polymarket.com/prices-history';
const HN = 'https://hn.algolia.com/api/v1/search_by_date';
const OPENROUTER = 'https://openrouter.ai/api/v1/models';

/** Keyset pages to read per query. The closed `ai` tag was 12 pages on 2026-09-26. */
export const MAX_GAMMA_PAGES = 16;
/** CLOB rejects windows over 15 days with 400 "interval is too long". */
export const MAX_CLOB_WINDOW = 15 * DAY;
/** Rungs whose deadline falls before this are not pulled: the scored window starts 2026-04-01. */
export const CLOB_FROM = Date.parse('2026-03-20T00:00:00Z') / 1000;
/** Non-model launches that share a lab's title pattern. */
const NOT_A_MODEL = /\b(app|apps|image|veo|sora|bidi|atlas|video|music|audio|device|browser)\b/i;

async function getJson(url: string, attempts = 3): Promise<unknown> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Walks `/events/keyset` with `after_cursor` (the only cursor parameter Gamma honours), stopping on
 * a short page, a missing cursor, a page of already-seen ids, or the page cap.
 */
export async function fetchGammaEvents(query: string): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let cursor = '';
  for (let page = 0; page < MAX_GAMMA_PAGES; page++) {
    const url = `${GAMMA}?${query}&limit=50${cursor ? `&after_cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = (await getJson(url)) as { events?: Record<string, unknown>[]; next_cursor?: string };
    const batch = Array.isArray(body.events) ? body.events : [];
    const fresh = batch.filter((e) => !seen.has(String(e.id)));
    for (const e of fresh) seen.add(String(e.id));
    events.push(...fresh);
    if (batch.length < 50 || !fresh.length || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return events;
}

/** Release-shaped events for a frontier (or curated) lab; everything else is dropped before the CLOB pull. */
export function isReleaseEvent(event: RawEvent, extraIds: ReadonlySet<string>): boolean {
  if (extraIds.has(event.id)) return true;
  return Boolean(eventKind(event.title) && labForTitle(event.title) && !NOT_A_MODEL.test(event.title));
}

export async function fetchReleaseEvents(extraIds: ReadonlySet<string>): Promise<RawEvent[]> {
  const closed = await fetchGammaEvents('tag_slug=ai&closed=true');
  const open = await fetchGammaEvents('tag_slug=ai-releases&closed=false');
  const byId = new Map<string, RawEvent>();
  for (const raw of [...closed, ...open]) {
    const event = trimGammaEvent(raw);
    if (!event || !isReleaseEvent(event, extraIds)) continue;
    // Open events only contribute rungs that have already resolved.
    if (!event.closed) event.markets = event.markets.filter((m) => m.resolved);
    if (event.markets.length) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

/** The window each rung's price history is pulled for: the last 15 days before it stopped trading. */
export function clobWindow(
  market: RawEvent['markets'][number],
  kind: 'by' | 'on',
): [number, number] | undefined {
  const rung = parseRung(market.label, kind, market.endDate);
  if (!rung || !market.resolved || !market.yesToken) return undefined;
  const closed = market.closedTime ? Date.parse(market.closedTime) / 1000 : rung.deadline + DAY;
  const end = Math.min(closed, rung.deadline + DAY);
  if (end < CLOB_FROM) return undefined;
  const opened = Date.parse(market.openedAt) / 1000;
  const start = Math.max(opened, end - MAX_CLOB_WINDOW);
  return end > start ? [Math.floor(start), Math.ceil(end)] : undefined;
}

export async function fetchSeries(events: readonly RawEvent[]): Promise<Record<string, RawSeries>> {
  const jobs: { token: string; start: number; end: number }[] = [];
  for (const event of events) {
    const kind = eventKind(event.title) ?? 'by';
    for (const market of event.markets) {
      const window = clobWindow(market, kind);
      if (window && market.yesToken) jobs.push({ token: market.yesToken, start: window[0], end: window[1] });
    }
  }
  const results = await pool(jobs, 4, async (job) => {
    const url = `${CLOB}?market=${job.token}&startTs=${job.start}&endTs=${job.end}&fidelity=60`;
    const body = (await getJson(url)) as { history?: { t: number; p: number }[] };
    const points = compactPoints((body.history ?? []).map((h) => [h.t, h.p] as const));
    return [job.token, { startTs: job.start, endTs: job.end, fidelity: 60, points }] as const;
  });
  return Object.fromEntries(results.sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

export interface HnQuery {
  id: string;
  query: string;
  from: string;
  to: string;
}

export async function fetchHn(queries: readonly HnQuery[]): Promise<Record<string, HnPull>> {
  const out: Record<string, HnPull> = {};
  for (const q of queries) {
    const from = Date.parse(q.from) / 1000;
    const to = Date.parse(q.to) / 1000;
    const params = new URLSearchParams({
      query: q.query,
      tags: 'story',
      hitsPerPage: '100',
      numericFilters: `created_at_i>=${from},created_at_i<=${to}`,
    });
    const body = (await getJson(`${HN}?${params}`)) as { hits?: Record<string, unknown>[] };
    const hits: HnHit[] = (body.hits ?? [])
      .map((h) => ({
        id: String(h.objectID),
        t: Number(h.created_at_i),
        title: String(h.title ?? ''),
        url: typeof h.url === 'string' ? h.url : '',
        points: Number(h.points ?? 0),
      }))
      .sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    out[q.id] = { query: q.query, from: q.from, to: q.to, hits };
  }
  return out;
}

export async function fetchOpenRouter(): Promise<OpenRouterModel[]> {
  const body = (await getJson(OPENROUTER)) as { data?: Record<string, unknown>[] };
  return (body.data ?? [])
    .map((m) => ({
      id: String(m.id),
      name: String(m.name ?? ''),
      created: Number(m.created),
      canonical: String(m.canonical_slug ?? ''),
    }))
    .filter((m) => Number.isFinite(m.created))
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
}
