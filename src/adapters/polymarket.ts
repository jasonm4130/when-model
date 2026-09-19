import { labForTitle } from '../domain/lab';
import { classifyMarket, isModelRelevant, isUnnamedSlot, type Market, type Outcome } from '../domain/market';
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
}
export interface PolymarketEventDto {
  slug?: string;
  title?: string;
  volume24hr?: number;
  volume?: number;
  closed?: boolean;
  markets?: PolymarketMarketDto[];
}

const GAMMA = 'https://gamma-api.polymarket.com';
const UTM = '?utm_source=whenmodel.com&utm_medium=dashboard';
/** Tags that hold the release and leaderboard markets we care about. */
const TAGS = ['ai-releases', 'ai'] as const;
const TTL_SECONDS = 300;

function yesPrice(market: PolymarketMarketDto): number {
  try {
    const prices = JSON.parse(market.outcomePrices ?? '[]') as string[];
    const names = JSON.parse(market.outcomes ?? '[]') as string[];
    const i = names.findIndex((n) => n.toLowerCase() === 'yes');
    const price = Number.parseFloat(prices[i >= 0 ? i : 0] ?? '0');
    return Number.isFinite(price) ? price : 0;
  } catch {
    return 0;
  }
}

function toOutcome(market: PolymarketMarketDto): Outcome {
  return {
    label: market.groupItemTitle || market.question || '?',
    yes: yesPrice(market),
    endDate: market.endDate,
    closed: !!market.closed,
    vol24: market.volume24hr ?? 0,
  };
}

/** Map one Gamma event to a domain Market, or undefined if it lacks the fields we need. */
export function toMarket(event: PolymarketEventDto): Market | undefined {
  if (typeof event.slug !== 'string' || typeof event.title !== 'string') return undefined;
  return {
    slug: event.slug,
    title: event.title.replace(/\.\.\.\?$/, '…?'),
    url: `https://polymarket.com/event/${encodeURIComponent(event.slug)}${UTM}`,
    vol24: event.volume24hr ?? 0,
    volume: event.volume ?? 0,
    kind: classifyMarket(event.title),
    labId: labForTitle(event.title)?.id,
    outcomes: (event.markets ?? []).map(toOutcome).filter((o) => !isUnnamedSlot(o.label)),
  };
}

/** Distinct, open, model-relevant markets across the tracked tags. */
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

async function eventsForTag(tag: string): Promise<PolymarketEventDto[]> {
  const url = `${GAMMA}/events?tag_slug=${tag}&active=true&closed=false&limit=100&order=volume24hr&ascending=false`;
  return (await cachedJson<PolymarketEventDto[] | null>(url, { ttl: TTL_SECONDS })) ?? [];
}

export async function fetchMarkets(): Promise<Market[]> {
  const perTag = await Promise.all(TAGS.map(eventsForTag));
  return selectMarkets(perTag.flat());
}
