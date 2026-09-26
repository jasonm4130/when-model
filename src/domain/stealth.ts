import { FRONTIER_LABS, type LabId } from './lab';

/**
 * OpenRouter Stealth Watch: anonymous slots a lab uses to test a model before its launch, and the
 * track record of the slots that were revealed. Pure; the listings arrive as OpenRouter drops.
 */

const DAY_MS = 86_400_000;

/** OpenRouter's own routers. They pick another model per request and are never stealth slots. */
export const OPENROUTER_ROUTERS: ReadonlySet<string> = new Set([
  'auto',
  'auto-beta',
  'bodybuilder',
  'free',
  'fusion',
  'pareto-code',
]);

const STEALTH_NAME = /\b(alpha|beta)$/i;

/**
 * Frontier-class capability claimed in so many words. It is the vendor's marketing, not evidence: of
 * the revealed slots whose stealth-era description survives in the API, it matches Union Alpha
 * (Unbiased), Hunter Alpha (Xiaomi) and Sonoma Sky/Dusk Alpha (xAI), one frontier lab in three, and
 * misses Horizon and Quasar (OpenAI), which claimed nothing. Deliberately narrow: "a frontier
 * omni-modal model" (Healer Alpha, Xiaomi) does not match.
 */
const FRONTIER_CLAIM =
  /\bfrontier[- ](?:level|class|grade|model|intelligence|performance|capabilit(?:y|ies))\b/i;

const EXCERPT_CHARS = 160;

/** The fields the classifier reads. An OpenRouter `Drop` satisfies it. */
export interface StealthCandidate {
  id: string;
  name: string;
  createdAt: string;
  url?: string;
  context?: number;
  /** USD per million tokens. */
  promptPerM?: number;
  completionPerM?: number;
  description?: string;
}

/**
 * Anything under `stealth/`, OpenRouter's namespace for them by Aug 2026 (Ox Alpha), or a free
 * `openrouter/*` id outside the router list whose name ends in Alpha or Beta, which is how the earlier
 * slots in `REVEALS`, Quasar Alpha (Apr 2025) to Owl Alpha (Apr 2026), were listed.
 */
export function isStealthSlot(
  model: Pick<StealthCandidate, 'id' | 'name' | 'promptPerM' | 'completionPerM'>,
): boolean {
  const [vendor, slug = ''] = model.id.split('/');
  if (vendor === 'stealth') return true;
  return (
    vendor === 'openrouter' &&
    !OPENROUTER_ROUTERS.has(slug.replace(/:.*$/, '')) &&
    model.promptPerM === 0 &&
    model.completionPerM === 0 &&
    STEALTH_NAME.test(model.name.replace(/\s*\(free\)$/i, '').trim())
  );
}

export function claimsFrontier(description: string | undefined): boolean {
  return FRONTIER_CLAIM.test(description ?? '');
}

/** The first sentence when it is short, else a word-boundary cut. Markdown links keep their text. */
export function descriptionExcerpt(description: string | undefined): string | undefined {
  const plain = description
    ?.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return undefined;
  const sentence = /^.+?[.!?](?=\s|$)/.exec(plain)?.[0];
  if (sentence && sentence.length <= EXCERPT_CHARS) return sentence;
  if (plain.length <= EXCERPT_CHARS) return plain;
  const cut = plain.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

export interface StealthSlot {
  id: string;
  name: string;
  url?: string;
  /** When the slot appeared: OpenRouter `created`, or an earlier first-seen time. */
  createdAt: string;
  /** Fractional days since `createdAt`, never negative. */
  daysInStealth: number;
  contextLength?: number;
  descriptionExcerpt?: string;
  /** See `claimsFrontier`: the vendor's claim, a weak filter at best. */
  claimsFrontier: boolean;
}

/**
 * Live stealth slots, newest first.
 *
 * OpenRouter's `created` is not fixed: space-bunny-alpha was first seen with `created`
 * 2026-09-22T10:58Z and later reported 2026-09-23T14:48:04Z, so the slot looked about 28h younger
 * than it was. Pass `firstSeen` (id to ISO time, e.g. from a first-seen ledger) when you have it;
 * the earlier of the two times wins.
 */
export function stealthSlots(
  models: readonly StealthCandidate[],
  now: number,
  firstSeen?: ReadonlyMap<string, string>,
): StealthSlot[] {
  const slots: StealthSlot[] = [];
  for (const model of models) {
    if (!isStealthSlot(model)) continue;
    const seen = Date.parse(firstSeen?.get(model.id) ?? '');
    const start = Math.min(Date.parse(model.createdAt), Number.isFinite(seen) ? seen : Infinity);
    if (!Number.isFinite(start)) continue;
    slots.push({
      id: model.id,
      name: model.name,
      url: model.url,
      createdAt: new Date(start).toISOString(),
      daysInStealth: Math.max(0, (now - start) / DAY_MS),
      contextLength: model.context,
      descriptionExcerpt: descriptionExcerpt(model.description),
      claimsFrontier: claimsFrontier(model.description),
    });
  }
  return slots.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** How a slot's identity became known. */
export type RevealAttribution =
  /** The slot's own `/endpoints` description names the model. */
  | 'api-description'
  /** A notice on the slot's openrouter.ai page names the model. */
  | 'model-page'
  /** An OpenRouter blog announcement. */
  | 'openrouter-blog'
  /** Only people outside OpenRouter and the lab say so. */
  | 'third-party';

export interface StealthReveal {
  /** The slot as people called it. */
  slot: string;
  /** Every OpenRouter id the slot used. The earliest `created` starts the clock. */
  slotIds: readonly string[];
  stealthCreatedAt: string;
  revealedAs: string;
  /** The official OpenRouter listings. The earliest `created` stops the clock. */
  officialIds: readonly string[];
  officialCreatedAt: string;
  vendor: string;
  labId?: LabId;
  attribution: RevealAttribution;
  /** Where the attribution can be checked. */
  source: string;
  /** Both timestamps and a first-party attribution were checked; only verified rows feed the medians. */
  verified: boolean;
  note?: string;
}

/**
 * Resolved stealth slots, hand-curated because the `/endpoints` description is cut off at about 210
 * characters, usually before the identity. Every timestamp is OpenRouter `created`, re-read from
 * `/api/v1/models/{id}/endpoints` on 2026-09-26 (retired slugs still answer there). Slots that carry no
 * identity on OpenRouter (Cypher Alpha 2025-07-01, Aurora Alpha 2026-02-09) are left out, so the
 * medians describe slots that were revealed, not every slot.
 */
export const REVEALS: readonly StealthReveal[] = [
  {
    slot: 'Union Alpha',
    slotIds: ['stealth/union-alpha'],
    stealthCreatedAt: '2026-09-16T14:42:03Z',
    revealedAs: 'Pareto',
    officialIds: ['unbiased/pareto'],
    officialCreatedAt: '2026-09-17T23:02:58Z',
    vendor: 'Unbiased',
    attribution: 'model-page',
    source: 'https://openrouter.ai/stealth/union-alpha',
    verified: true,
    note: "A priced third-party model, not OpenRouter's openrouter/pareto-code router.",
  },
  {
    slot: 'Sherlock Think/Dash Alpha',
    slotIds: ['openrouter/sherlock-think-alpha', 'openrouter/sherlock-dash-alpha'],
    stealthCreatedAt: '2025-11-15T17:49:46Z',
    revealedAs: 'Grok 4.1 Fast',
    officialIds: ['x-ai/grok-4.1-fast'],
    officialCreatedAt: '2025-11-19T21:25:02Z',
    vendor: 'xAI',
    labId: 'xai',
    attribution: 'api-description',
    source: 'https://openrouter.ai/api/v1/models/openrouter/sherlock-think-alpha/endpoints',
    verified: true,
  },
  {
    slot: 'Pony Alpha',
    slotIds: ['openrouter/pony-alpha'],
    stealthCreatedAt: '2026-02-06T16:04:15Z',
    revealedAs: 'GLM-5',
    officialIds: ['z-ai/glm-5'],
    officialCreatedAt: '2026-02-11T16:59:42Z',
    vendor: 'Z.ai',
    labId: 'zai',
    attribution: 'model-page',
    source: 'https://openrouter.ai/openrouter/pony-alpha',
    verified: true,
  },
  {
    slot: 'Ox Alpha',
    slotIds: ['stealth/ox-alpha'],
    stealthCreatedAt: '2026-08-20T20:04:55Z',
    revealedAs: 'GLM-5.3-Flash',
    officialIds: ['z-ai/glm-5.3-flash'],
    officialCreatedAt: '2026-08-26T13:59:01Z',
    vendor: 'Z.ai',
    labId: 'zai',
    attribution: 'model-page',
    source: 'https://openrouter.ai/stealth/ox-alpha',
    verified: true,
  },
  {
    slot: 'Andromeda Alpha',
    slotIds: ['openrouter/andromeda-alpha'],
    stealthCreatedAt: '2025-10-21T20:03:14Z',
    revealedAs: 'Nemotron Nano 2 VL',
    officialIds: ['nvidia/nemotron-nano-12b-v2-vl'],
    officialCreatedAt: '2025-10-28T18:19:25Z',
    vendor: 'NVIDIA',
    attribution: 'api-description',
    source: 'https://openrouter.ai/api/v1/models/openrouter/andromeda-alpha/endpoints',
    verified: true,
  },
  {
    slot: 'Hunter/Healer Alpha',
    slotIds: ['openrouter/healer-alpha', 'openrouter/hunter-alpha'],
    stealthCreatedAt: '2026-03-11T20:24:28Z',
    revealedAs: 'MiMo-V2-Pro and MiMo-V2-Omni',
    officialIds: ['xiaomi/mimo-v2-pro', 'xiaomi/mimo-v2-omni'],
    officialCreatedAt: '2026-03-18T19:54:03Z',
    vendor: 'Xiaomi',
    attribution: 'model-page',
    source: 'https://openrouter.ai/openrouter/hunter-alpha',
    verified: true,
  },
  {
    slot: 'Polaris Alpha',
    slotIds: ['openrouter/polaris-alpha'],
    stealthCreatedAt: '2025-11-06T17:55:07Z',
    revealedAs: 'GPT-5.1',
    officialIds: ['openai/gpt-5.1'],
    officialCreatedAt: '2025-11-13T18:58:25Z',
    vendor: 'OpenAI',
    labId: 'openai',
    attribution: 'api-description',
    source: 'https://openrouter.ai/api/v1/models/openrouter/polaris-alpha/endpoints',
    verified: true,
  },
  {
    slot: 'Bert-Nebulon Alpha',
    slotIds: ['openrouter/bert-nebulon-alpha'],
    stealthCreatedAt: '2025-11-24T17:24:18Z',
    revealedAs: 'Mistral Large 3',
    officialIds: ['mistralai/mistral-large-2512'],
    officialCreatedAt: '2025-12-01T21:27:52Z',
    vendor: 'Mistral',
    labId: 'mistral',
    attribution: 'api-description',
    source: 'https://openrouter.ai/api/v1/models/openrouter/bert-nebulon-alpha/endpoints',
    verified: true,
  },
  {
    slot: 'Horizon Alpha/Beta',
    slotIds: ['openrouter/horizon-alpha', 'openrouter/horizon-beta'],
    stealthCreatedAt: '2025-07-30T22:18:04Z',
    revealedAs: 'GPT-5',
    officialIds: ['openai/gpt-5'],
    officialCreatedAt: '2025-08-07T17:23:33Z',
    vendor: 'OpenAI',
    labId: 'openai',
    attribution: 'openrouter-blog',
    source: 'https://openrouter.ai/blog/announcements/gpt-5-is-now-live/',
    verified: true,
  },
  {
    slot: 'Quasar/Optimus Alpha',
    slotIds: ['openrouter/quasar-alpha', 'openrouter/optimus-alpha'],
    stealthCreatedAt: '2025-04-02T20:46:49Z',
    revealedAs: 'GPT-4.1',
    officialIds: ['openai/gpt-4.1'],
    officialCreatedAt: '2025-04-14T17:23:05Z',
    vendor: 'OpenAI',
    labId: 'openai',
    attribution: 'openrouter-blog',
    source: 'https://openrouter.ai/blog/announcements/quasar-alpha-and-optimus-alpha-reveal/',
    verified: true,
  },
  {
    slot: 'Sonoma Sky/Dusk Alpha',
    slotIds: ['openrouter/sonoma-sky-alpha', 'openrouter/sonoma-dusk-alpha'],
    stealthCreatedAt: '2025-09-05T17:23:21Z',
    revealedAs: 'Grok 4 Fast',
    officialIds: ['x-ai/grok-4-fast'],
    officialCreatedAt: '2025-09-19T00:01:30Z',
    vendor: 'xAI',
    labId: 'xai',
    attribution: 'model-page',
    source: 'https://openrouter.ai/openrouter/sonoma-sky-alpha',
    verified: true,
  },
  {
    slot: 'Owl Alpha',
    slotIds: ['openrouter/owl-alpha'],
    stealthCreatedAt: '2026-04-28T17:49:49Z',
    revealedAs: 'LongCat-2.0',
    officialIds: ['meituan/longcat-2.0'],
    officialCreatedAt: '2026-07-20T13:37:38Z',
    vendor: 'Meituan',
    attribution: 'third-party',
    source: 'https://www.longcatai.org/news/owl-alpha-openrouter',
    verified: false,
    note: 'No notice on the OpenRouter page. Third-party reports date the reveal to the LongCat-2.0 open-weights release on 2026-06-30, about 62 days in; the OpenRouter listing came 83 days in.',
  },
];

/** Stealth listing to official listing, in fractional days. */
export function revealDays(reveal: StealthReveal): number {
  return (Date.parse(reveal.officialCreatedAt) - Date.parse(reveal.stealthCreatedAt)) / DAY_MS;
}

export function isFrontierReveal(reveal: StealthReveal): boolean {
  return reveal.labId !== undefined && FRONTIER_LABS.has(reveal.labId);
}

/** Median of `revealDays`; NaN for no rows. */
export function medianRevealDays(reveals: readonly StealthReveal[]): number {
  const days = reveals.map(revealDays).sort((a, b) => a - b);
  if (days.length === 0) return Number.NaN;
  const mid = days.length >> 1;
  return days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
}

const VERIFIED = REVEALS.filter((r) => r.verified);
const VERIFIED_FRONTIER = VERIFIED.filter(isFrontierReveal);

/** The track record behind "day N in stealth; the median reveal came at day M". Verified rows only. */
export const REVEAL_STATS = {
  all: { n: VERIFIED.length, medianDays: medianRevealDays(VERIFIED) },
  frontier: { n: VERIFIED_FRONTIER.length, medianDays: medianRevealDays(VERIFIED_FRONTIER) },
} as const;
