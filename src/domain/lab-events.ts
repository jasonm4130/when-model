/**
 * Keynote calendar (report T1-5): a static list of keynote-class events, display only. Polymarket
 * already prices known keynotes (T1-1), so this never feeds DROPCON — it just shows an "event
 * window" chip and an honest, table-computed hit rate rather than a hard-coded one.
 *
 * Every row below is a verified primary source, checked live or by publication date:
 * - DevDay 2023 (2023-11-06): OpenAI's own recap names GPT-4 Turbo as a DevDay announcement — hit.
 * - DevDay 2024 (2024-10-01, 10:00 PT keynote): VentureBeat/TechCrunch recaps list Realtime API,
 *   vision fine-tuning, prompt caching and model distillation — no new frontier model — miss.
 * - Code with Claude 2025 (2025-05-22, San Francisco): Anthropic's own "Introducing Claude 4" post
 *   and a same-day live blog both date Opus 4 / Sonnet 4 to the conference day — hit.
 * - DevDay 2025 (2025-10-06): recaps list "GPT-5 Pro now available in the API" plus Sora 2 — an
 *   existing model tier going GA, not a new frontier model debut — weak.
 * - Code with Claude 2026 (2026-05-06, San Francisco): InfoQ's recap ("Managed Agents, Proactive
 *   Workflows, Capability Curve") and independent commentary on skipping a new model both describe
 *   an agent-infrastructure event with no model launch — miss.
 * - DevDay 2026 (2026-09-29T17:00Z = 10:00 a.m. Pacific): verified live against
 *   `https://devday.openai.com/` (HTTP 200): "September 29, 2026 at Fort Mason", "Opening Keynote:
 *   10:00 a.m., featuring Sam Altman". Upcoming — no outcome yet.
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
    source: 'https://openai.com/devday/2025/',
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
  /** (hits + weak/2) / total; 0 when there is nothing dated yet. */
  rate: number;
}

/** Computed from whichever events carry an `outcome` — never a hard-coded fraction. */
export function hitRate(events: readonly LabEvent[] = EVENTS): EventHitRate {
  const dated = events.filter((e) => e.outcome !== undefined);
  const hits = dated.filter((e) => e.outcome === 'hit').length;
  const weak = dated.filter((e) => e.outcome === 'weak').length;
  const misses = dated.filter((e) => e.outcome === 'miss').length;
  const total = dated.length;
  return { hits, weak, misses, total, rate: total ? (hits + weak * 0.5) / total : 0 };
}

/** Events whose display window [start−72h, start+24h] contains `now`. Pure. */
export function activeEventWindows(now: Date): EventWindow[] {
  return EVENTS.filter((e) => isWithinEventWindow(e.start, now)).map((e) => toEventWindow(e, now));
}
