import { cachedJson } from '../fetch';
import { labForTitle } from '../labs';

export interface PmMarket {
  question: string;
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
  closed?: boolean;
  endDate?: string;
  volume24hr?: number;
  slug?: string;
}
export interface PmEvent {
  id: string;
  slug: string;
  title: string;
  volume24hr?: number;
  volume?: number;
  endDate?: string;
  closed?: boolean;
  image?: string;
  tags?: { slug: string }[];
  markets: PmMarket[];
}

export interface Outcome {
  label: string;
  yes: number;
  endDate?: string;
  closed: boolean;
  vol24: number;
}
export interface Market {
  slug: string;
  title: string;
  url: string;
  vol24: number;
  volume: number;
  kind: 'release' | 'leaderboard' | 'other';
  labId?: string;
  outcomes: Outcome[];
}

const BASE = 'https://gamma-api.polymarket.com';
const UTM = '?utm_source=whenmodel.com&utm_medium=dashboard';

export function parseEvent(e: PmEvent): Market {
  const outcomes: Outcome[] = e.markets
    .map((m) => {
      let yes = 0;
      try {
        const prices = JSON.parse(m.outcomePrices ?? '[]') as string[];
        const names = JSON.parse(m.outcomes ?? '[]') as string[];
        const i = names.findIndex((n) => n.toLowerCase() === 'yes');
        yes = parseFloat(prices[i >= 0 ? i : 0] ?? '0');
      } catch {
        /* leave 0 */
      }
      return {
        label: m.groupItemTitle || m.question,
        yes,
        endDate: m.endDate,
        closed: !!m.closed,
        vol24: m.volume24hr ?? 0,
      };
    })
    .filter((o) => !/^Company [A-Z]$/.test(o.label));
  const isRelease = /released (by|on)|release date|when will .* be released/i.test(e.title);
  const isBoard = /best .*model|#1 ai model|arena|livebench|humanity|leaderboard|score/i.test(e.title);
  return {
    slug: e.slug,
    title: e.title.replace(/\.\.\.\?$/, '…?'),
    url: `https://polymarket.com/event/${e.slug}${UTM}`,
    vol24: e.volume24hr ?? 0,
    volume: e.volume ?? 0,
    kind: isRelease ? 'release' : isBoard ? 'leaderboard' : 'other',
    labId: labForTitle(e.title)?.id,
    outcomes,
  };
}

async function tagEvents(tag: string, limit = 100): Promise<PmEvent[]> {
  return cachedJson<PmEvent[]>(
    `${BASE}/events?tag_slug=${tag}&active=true&closed=false&limit=${limit}&order=volume24hr&ascending=false`,
    300,
  );
}

export async function fetchMarkets(): Promise<Market[]> {
  const [releases, ai] = await Promise.all([tagEvents('ai-releases'), tagEvents('ai')]);
  const seen = new Set<string>();
  const out: Market[] = [];
  for (const e of [...releases, ...ai]) {
    if (seen.has(e.slug) || e.closed) continue;
    seen.add(e.slug);
    const m = parseEvent(e);
    // Keep model-relevant markets only: releases, leaderboards, or anything naming a lab/model.
    if (
      m.kind === 'other' &&
      !/\b(model|agi|gpt|claude|gemini|grok|deepseek|llama|qwen|arena|open.?source)\b/i.test(m.title)
    )
      continue;
    out.push(m);
  }
  return out;
}

/** Probability that a lab ships something in the next ~N days, read from its release markets. */
export function releaseOddsForLab(markets: Market[], labId: string, horizonDays: number, now = Date.now()) {
  const horizon = now + horizonDays * 86400_000;
  let best: { p: number; label: string; title: string; url: string; endDate: string } | undefined;
  for (const m of markets) {
    if (m.labId !== labId || m.kind !== 'release') continue;
    for (const o of m.outcomes) {
      if (o.closed || !o.endDate) continue;
      const end = Date.parse(o.endDate);
      if (Number.isNaN(end) || end < now || end > horizon) continue;
      if (!best || o.yes > best.p)
        best = { p: o.yes, label: o.label, title: m.title, url: m.url, endDate: o.endDate };
    }
  }
  return best;
}
