import { labForTitle } from '../domain/lab';
import {
  classifyMarket,
  isBucketTitle,
  isModelRelevant,
  isThinBook,
  isUnnamedSlot,
  outcomeDeadline,
  type Market,
  type Outcome,
} from '../domain/market';
import { cachedJson } from '../infra/edge-cache';

/** Gamma API shapes, as observed. Everything optional: the parser must not trust them. */
export interface PolymarketMarketDto {
  question?: string;
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
  closed?: boolean;
  endDate?: string;
  volume24hr?: number;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  lastTradePrice?: number;
  oneDayPriceChange?: number;
  /** Gamma sends this one as a decimal string. */
  liquidity?: string | number;
  /** JSON array of token ids, aligned with `outcomes`. */
  clobTokenIds?: string;
}
export interface PolymarketEventDto {
  id?: string | number;
  slug?: string;
  title?: string;
  volume24hr?: number;
  volume?: number;
  closed?: boolean;
  negRisk?: boolean;
  endDate?: string;
  markets?: PolymarketMarketDto[];
}
/** One page of `/events/keyset`. The last full page still carries a cursor; the page after it is empty. */
export interface PolymarketKeysetPageDto {
  events?: PolymarketEventDto[];
  next_cursor?: string;
}

const GAMMA = 'https://gamma-api.polymarket.com';
const UTM = '?utm_source=whenmodel.com&utm_medium=dashboard';
/** Gamma caps keyset pages at 50 events. */
export const KEYSET_PAGE_SIZE = 50;
/** A bound on the walk: ai-releases fits one page today, and paid Workers would allow 10,000 fetches. */
export const KEYSET_MAX_PAGES = 3;
const LISTING = `active=true&closed=false&order=volume24hr&ascending=false&limit=${KEYSET_PAGE_SIZE}`;
/** Release markets, plus the "which company has the best AI model" series (563 KB, where tag `ai` was 6.5 MB). */
const LISTINGS = [
  `${GAMMA}/events/keyset?tag_slug=ai-releases&${LISTING}`,
  `${GAMMA}/events/keyset?series_slug=best-ai-company&${LISTING}`,
] as const;
const TTL_SECONDS = 300;

function num(value: unknown): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

function jsonList(value: string | undefined): unknown[] {
  try {
    const list: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Index of the Yes share, falling back to the first outcome. */
function yesIndex(market: PolymarketMarketDto): number {
  const i = jsonList(market.outcomes).findIndex((n) => typeof n === 'string' && n.toLowerCase() === 'yes');
  return i >= 0 ? i : 0;
}

function yesPrice(market: PolymarketMarketDto, yes: number): number {
  const price = Number.parseFloat(String(jsonList(market.outcomePrices)[yes] ?? '0'));
  return Number.isFinite(price) ? price : 0;
}

interface OutcomeContext {
  /** The event is one yes/no question, so its lone outcome is labelled "Yes". */
  single: boolean;
  /** Release events get a parsed deadline; `bucket` marks date-bucket events. */
  release?: { bucket: boolean };
}

/** Gamma quotes bid, ask and last trade for the first outcome token, which is Yes on every live market. */
function bookFields(market: PolymarketMarketDto, yes: number): Partial<Outcome> {
  const token = jsonList(market.clobTokenIds)[yes];
  const book: Partial<Outcome> =
    yes === 0
      ? {
          bestBid: num(market.bestBid),
          bestAsk: num(market.bestAsk),
          spread: num(market.spread),
          lastTradePrice: num(market.lastTradePrice),
          oneDayPriceChange: num(market.oneDayPriceChange),
        }
      : {};
  return {
    ...book,
    liquidity: num(market.liquidity),
    clobTokenId: typeof token === 'string' && token ? token : undefined,
    thin: isThinBook(book.bestBid, book.bestAsk),
  };
}

function toOutcome(market: PolymarketMarketDto, context: OutcomeContext): Outcome {
  const yes = yesIndex(market);
  const outcome: Outcome = {
    label: market.groupItemTitle || (context.single ? 'Yes' : market.question) || '?',
    yes: yesPrice(market, yes),
    endDate: market.endDate,
    closed: !!market.closed,
    vol24: market.volume24hr ?? 0,
  };
  // Closed outcomes keep no book: nothing trades there.
  if (!outcome.closed) Object.assign(outcome, bookFields(market, yes));
  if (context.release) {
    Object.assign(
      outcome,
      outcomeDeadline([market.question, market.groupItemTitle], {
        ...context.release,
        endDate: market.endDate,
      }),
    );
  }
  return outcome;
}

/** Map one Gamma event to a domain Market, or undefined if it lacks the fields we need. */
export function toMarket(event: PolymarketEventDto): Market | undefined {
  if (typeof event.slug !== 'string' || typeof event.title !== 'string') return undefined;
  const kind = classifyMarket(event.title);
  const markets = event.markets ?? [];
  const context: OutcomeContext = {
    single: markets.length === 1,
    release: kind === 'release' ? { bucket: !!event.negRisk || isBucketTitle(event.title) } : undefined,
  };
  return {
    slug: event.slug,
    title: event.title.replace(/\.\.\.\?$/, '…?'),
    url: `https://polymarket.com/event/${encodeURIComponent(event.slug)}${UTM}`,
    vol24: event.volume24hr ?? 0,
    volume: event.volume ?? 0,
    kind,
    labId: labForTitle(event.title)?.id,
    outcomes: markets.map((m) => toOutcome(m, context)).filter((o) => !isUnnamedSlot(o.label)),
  };
}

/** Distinct, open, model-relevant markets across the tracked listings. */
export function selectMarkets(events: readonly PolymarketEventDto[]): Market[] {
  const seen = new Set<string>();
  const out: Market[] = [];
  for (const event of events) {
    if (event.closed) continue;
    const market = toMarket(event);
    if (!market || seen.has(market.slug) || !isModelRelevant(market)) continue;
    seen.add(market.slug);
    out.push(market);
  }
  return out;
}

/**
 * Walk a `/events/keyset` listing. The cursor parameter is `after_cursor`; Gamma silently ignores
 * any other name and serves page 1 again, so the walk also stops on a short or empty page, a
 * repeated event id, a missing cursor, or after `KEYSET_MAX_PAGES` pages.
 */
export async function keysetEvents(listing: string): Promise<PolymarketEventDto[]> {
  const events: PolymarketEventDto[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < KEYSET_MAX_PAGES; page++) {
    const url = cursor ? `${listing}&after_cursor=${encodeURIComponent(cursor)}` : listing;
    const body = await cachedJson<PolymarketKeysetPageDto | null>(url, { ttl: TTL_SECONDS });
    const batch = Array.isArray(body?.events) ? body.events : [];
    let repeated = false;
    for (const event of batch) {
      const id = String(event.id ?? event.slug ?? '');
      if (id && seen.has(id)) repeated = true;
      else {
        if (id) seen.add(id);
        events.push(event);
      }
    }
    cursor = typeof body?.next_cursor === 'string' && body.next_cursor ? body.next_cursor : undefined;
    if (repeated || batch.length < KEYSET_PAGE_SIZE || !cursor) break;
  }
  return events;
}

export async function fetchMarkets(): Promise<Market[]> {
  const perListing = await Promise.all(LISTINGS.map(keysetEvents));
  return selectMarkets(perListing.flat());
}
