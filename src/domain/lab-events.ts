/**
 * Keynote calendar (report T1-5): a static list of keynote-class events, display only. Polymarket
 * already prices known keynotes (T1-1), so this never feeds DROPCON — it just shows an "event
 * window" chip and an honest, table-computed hit rate rather than a hard-coded one.
 *
 * "Hit" means the keynote debuted a new frontier model. Every past row cites a source that
 * existed when checked on 2026-09-26 (openai.com answers scripted requests with 403, so its rows
 * were confirmed through the Wayback Machine or OpenAI's own developer forum instead):
 * - DevDay 2023 (2023-11-06): OpenAI's announcement post names GPT-4 Turbo — hit.
 * - DevDay 2024 (2024-10-01): VentureBeat's recap lists Realtime API, vision fine-tuning, prompt
 *   caching and model distillation — no new model — miss.
 * - Code with Claude 2025 (2025-05-22): Anthropic's "Introducing Claude 4" post is dated the
 *   conference day and introduces Opus 4 / Sonnet 4 — hit.
 * - DevDay 2025 (2025-10-06): OpenAI's forum announcement (posted 2025-10-06T23:39Z) lists "GPT-5
 *   Pro in the API", Sora 2 in the API and two cheaper "-mini" models — an existing model reaching
 *   the API, not a new frontier model — weak. It is counted, but not as a hit.
 * - Code with Claude 2026 (2026-05-06, San Francisco): InfoQ's recap ("Managed Agents, Proactive
 *   Workflows, Capability Curve") describes an agent-infrastructure event whose model references
 *   are to the already-shipped Opus 4.7; OpenRouter lists no Anthropic model between Opus 4.7
 *   (2026-04-16) and Opus 4.8 (2026-05-27) — miss.
 * - DevDay 2026 (2026-09-29T17:00Z = 10:00 a.m. PDT): verified live against
 *   `https://devday.openai.com/` (HTTP 200): "September 29, 2026 at Fort Mason", "Opening Keynote:
 *   10:00 a.m., featuring Sam Altman", "All times are Pacific Time". Upcoming — no outcome yet.
 *
 * Past rows' dates are verified; their time of day is a nominal 10:00 Pacific (with that date's
 * DST offset) and only matters for the display window, which has long closed for all of them.
 *
 * I/O 2026's reported "hit" is dropped: the critic flags it as never checked against a primary
 * source, and this file only carries outcomes it can cite one for.
 */
import { isWithinEventWindow, toEventWindow, type EventWindow } from './lead';
import type { LabId } from './lab';

export type EventOutcome = 'hit' | 'weak' | 'miss';

export interface LabEvent {
  id: string;
  label: string;
  labId: LabId;
  /** ISO keynote start time. */
  start: string;
  source: string;
  /** Undefined for an event that hasn't happened yet. */
  outcome?: EventOutcome;
}

export const EVENTS: readonly LabEvent[] = [
  {
    id: 'devday-2023',
    label: 'OpenAI DevDay 2023',
    labId: 'openai',
    start: '2023-11-06T18:00:00Z',
    source: 'https://openai.com/index/new-models-and-developer-products-announced-at-devday/',
    outcome: 'hit',
  },
  {
    id: 'devday-2024',
    label: 'OpenAI DevDay 2024',
    labId: 'openai',
    start: '2024-10-01T17:00:00Z',
    source:
      'https://venturebeat.com/ai/openai-devday-2024-4-major-updates-that-will-make-ai-more-accessible-and-affordable',
    outcome: 'miss',
  },
  {
    id: 'code-with-claude-2025',
    label: 'Code with Claude 2025',
    labId: 'anthropic',
    start: '2025-05-22T17:00:00Z',
    source: 'https://www.anthropic.com/news/claude-4',
    outcome: 'hit',
  },
  {
    id: 'devday-2025',
    label: 'OpenAI DevDay 2025',
    labId: 'openai',
    start: '2025-10-06T17:00:00Z',
    source:
      'https://community.openai.com/t/devday-2025-apps-sdk-sora-2-gpt-5-pro-agentkit-new-image-generation-and-speech-to-speech-mini-models-and-more/1361279',
    outcome: 'weak',
  },
  {
    id: 'code-with-claude-2026',
    label: 'Code with Claude 2026',
    labId: 'anthropic',
    start: '2026-05-06T17:00:00Z',
    source: 'https://www.infoq.com/news/2026/05/code-with-claude/',
    outcome: 'miss',
  },
  {
    id: 'devday-2026',
    label: 'OpenAI DevDay 2026',
    labId: 'openai',
    start: '2026-09-29T17:00:00Z',
    source: 'https://devday.openai.com/',
  },
];

export interface EventHitRate {
  hits: number;
  weak: number;
  misses: number;
  total: number;
  /** hits / total: only a new frontier model counts, `weak` rows do not. 0 with nothing dated yet. */
  rate: number;
}

/** Computed from whichever events carry an `outcome` — never a hard-coded fraction. */
export function hitRate(events: readonly LabEvent[] = EVENTS): EventHitRate {
  const dated = events.filter((e) => e.outcome !== undefined);
  const hits = dated.filter((e) => e.outcome === 'hit').length;
  const weak = dated.filter((e) => e.outcome === 'weak').length;
  const misses = dated.filter((e) => e.outcome === 'miss').length;
  const total = dated.length;
  return { hits, weak, misses, total, rate: total ? hits / total : 0 };
}

/** Events whose display window [start−72h, start+24h] contains `now`. Pure. */
export function activeEventWindows(now: Date): EventWindow[] {
  return EVENTS.filter((e) => isWithinEventWindow(e.start, now)).map((e) => toEventWindow(e, now));
}
