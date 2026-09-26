import { describe, expect, it } from 'vitest';
import architectureJson from '../../data/backtest/architecture.json';
import broadcastsJson from '../../data/backtest/broadcasts.json';
import type { Drop } from '../../src/domain/drop';
import {
  ARCHITECTURE_TRACK,
  BROADCAST_TRACK,
  LEAK_TRACK,
  STEALTH_TRACK,
  buildEarlyWarnings,
  isLanguageModule,
} from '../../src/domain/early-warnings';
import type { LeakItem } from '../../src/domain/feed';
import type { BroadcastCandidate, PendingArchitecture } from '../../src/domain/lead';
import { EMPTY_LEDGER, ledgerFromRows } from '../../src/domain/ledger';
import { REVEAL_STATS } from '../../src/domain/stealth';
import { LEAK_STORIES } from '../fixtures/leak-titles-labelled';

const NOW = Date.parse('2026-09-26T03:00:00Z');
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const ok = <T>(data: T) => ({ ok: true, data });
const listing = (id: string, name: string): Drop => ({
  id,
  name,
  lab: 'x',
  createdAt: '2026-09-01T00:00:00.000Z',
  url: `https://openrouter.ai/${id}`,
  free: false,
});
const leak = (
  source: LeakItem['source'],
  title: string,
  ids: string[],
  publishedAt = '2026-09-25T00:00:00.000Z',
): LeakItem => ({
  source,
  title,
  url: `https://example.test/${encodeURIComponent(title)}`,
  publishedAt,
  modelIds: ids,
  cue: 'spotted',
});
const broadcast: BroadcastCandidate = {
  videoId: 'v1',
  channel: 'OpenAI',
  labId: 'openai',
  title: 'OpenAI DevDay 2026 livestream',
  url: 'https://www.youtube.com/watch?v=v1',
  publishedAt: '2026-09-25T20:00:00.000Z',
  views: 0,
  scheduledStartTime: '2026-09-26T17:00:00.000Z',
};
const arch = (
  module: string,
  labId: PendingArchitecture['labId'],
  daysPending: number,
  pending = true,
): PendingArchitecture => ({
  module,
  labId,
  since: '2026-09-20T00:00:00.000Z',
  sinceSource: 'detected',
  daysPending,
  pending,
});

describe('track records', () => {
  it('pins the leak record to the labelled outcomes it was measured on', () => {
    const resolved = LEAK_STORIES.filter((o) => !o.listed && !o.pending);
    const launched = resolved.filter((o) => o.launchedAfterDays !== undefined);
    expect([resolved.length, launched.length]).toEqual([LEAK_TRACK.n, LEAK_TRACK.launched]);
    expect([LEAK_TRACK.n, LEAK_TRACK.launched]).toEqual([13, 10]);
    expect(LEAK_TRACK.precision).toBeCloseTo(10 / 13, 10);
    // The GPT-6 "Astra" story counts once, from TestingCatalog, where it ran first.
    const astra = LEAK_STORIES.filter((o) => o.title.includes('"Astra"'));
    expect(astra.map((o) => o.source)).toEqual(['testingcatalog']);
    expect(median(launched.map((o) => o.launchedAfterDays!))).toBe(LEAK_TRACK.medianLeadDays);
  });

  it('pins the broadcast record to data/backtest/broadcasts.json', () => {
    const leads = broadcastsJson.broadcasts.map((b) => b.leadH);
    expect(leads).toHaveLength(BROADCAST_TRACK.n);
    expect(median(leads)).toBe(BROADCAST_TRACK.medianLeadHours);
    expect(Math.min(...leads)).toBe(BROADCAST_TRACK.minLeadHours);
    expect(Math.max(...leads)).toBe(BROADCAST_TRACK.maxLeadHours);
  });

  it('pins the architecture record to data/backtest/architecture.json', () => {
    const dated = architectureJson.architecture.filter((a) => a.verdict !== 'pending');
    const count = (v: string) => dated.filter((a) => a.verdict === v).length;
    expect([dated.length, count('leads'), count('coincident'), count('lags')]).toEqual([
      ARCHITECTURE_TRACK.n,
      ARCHITECTURE_TRACK.leads,
      ARCHITECTURE_TRACK.coincident,
      ARCHITECTURE_TRACK.lags,
    ]);
    const leadHours = dated.filter((a) => a.verdict === 'leads').map((a) => a.leadH ?? Number.NaN);
    const leadDays = median(leadHours) / 24;
    expect(Math.round(leadDays * 10) / 10).toBe(ARCHITECTURE_TRACK.medianLeadDays);
  });

  it('takes the stealth record from REVEAL_STATS, never a count of REVEALS', () => {
    expect(STEALTH_TRACK.n).toBe(REVEAL_STATS.all.n);
    expect(STEALTH_TRACK.summary).toContain(`${REVEAL_STATS.frontier.n} were frontier labs`);
  });
});

describe('isLanguageModule', () => {
  it('drops speech, OCR and encoder modules', () => {
    for (const m of ['qwen3_asr', 'glm_ocr', 'deepseek_ocr2', 'siglip2', 'qwen3_tts', 'kimi_audio_encoder'])
      expect(isLanguageModule(m)).toBe(false);
    for (const m of ['qwen4_exp', 'glm5_next', 'gemma4', 'deepseek_v4'])
      expect(isLanguageModule(m)).toBe(true);
  });
});

describe('buildEarlyWarnings', () => {
  it('is never scored and falls back to stateless rules with no ledger', () => {
    const w = buildEarlyWarnings({ drops: ok([]), leaks: [] }, NOW);
    expect(w.scored).toBe(false);
    expect(w.leaks.ok).toBe(false);
    expect(w.broadcasts).toMatchObject({ ok: false, items: [] });
    expect(w.architectures).toMatchObject({ ok: false, items: [] });
    expect(w.events.track.n).toBeGreaterThan(0);
  });

  it('keeps only unlisted leaks, newest first, with source attribution and one row per URL', () => {
    const drops = [listing('openai/gpt-6-sol', 'GPT-6 Sol')];
    const tc = leak(
      'testingcatalog',
      'Anthropic tests Opus 5.6 ahead of release',
      ['claude-opus-5.6'],
      '2026-09-25T10:00:00.000Z',
    );
    const w = buildEarlyWarnings(
      {
        drops: ok(drops),
        leaks: [
          { ...ok([leak('hn', 'GPT-6 Sol spotted', ['gpt-6-sol']), tc]), source: 'hn' },
          { ...ok([tc]), source: 'testingcatalog' },
        ],
      },
      NOW,
    );
    expect(w.leaks.items.map((l) => [l.title, l.sourceName])).toEqual([
      ['Anthropic tests Opus 5.6 ahead of release', 'TestingCatalog'],
    ]);
    expect(w.leaks).toMatchObject({ ok: true, checkedAgainstListings: true });
    expect(w.leaks.sources).toEqual([
      { source: 'hn', ok: true },
      { source: 'testingcatalog', ok: true },
    ]);
    expect(w.leaks.track.summary).toMatch(
      /^10 of 13 resolved leaks listed on OpenRouter within 14 days \(77%\), a median 1\.6 days after the leak/,
    );
  });

  it('says when a leak source is down or listings could not be checked', () => {
    const w = buildEarlyWarnings(
      {
        drops: { ok: false, data: [] },
        leaks: [
          { ...ok([leak('hn', 'GPT-6 Sol spotted', ['gpt-6-sol'])]), source: 'hn' },
          { ok: false, data: [], source: 'testingcatalog' },
        ],
      },
      NOW,
    );
    expect(w.leaks.ok).toBe(false);
    expect(w.leaks.checkedAgainstListings).toBe(false);
    expect(w.leaks.items).toHaveLength(1);
    expect(w.stealth.ok).toBe(false);
  });

  it('applies the two-poll rule from the ledger and reports hours to the scheduled start', () => {
    const fresh = buildEarlyWarnings(
      { drops: ok([]), leaks: [], broadcasts: ok([broadcast]), ledger: EMPTY_LEDGER },
      NOW,
    );
    expect(fresh.broadcasts.items[0]).toMatchObject({ confirmed: false, startsInHours: 14 });
    expect(fresh.broadcasts.items[0].firstSeenAt).toBeUndefined();
    const seen = ledgerFromRows([
      { kind: 'broadcast', key: 'v1', firstSeenAt: '2026-09-26T02:30:00.000Z', seeded: false },
    ]);
    const confirmed = buildEarlyWarnings(
      { drops: ok([]), leaks: [], broadcasts: ok([broadcast]), ledger: seen },
      NOW,
    );
    expect(confirmed.broadcasts.items[0]).toMatchObject({
      confirmed: true,
      firstSeenAt: '2026-09-26T02:30:00.000Z',
    });
    const stateless = buildEarlyWarnings(
      { drops: ok([]), leaks: [], broadcasts: ok([{ ...broadcast, scheduledStartTime: undefined }]) },
      NOW,
    );
    expect(stateless.broadcasts.items[0].confirmed).toBeUndefined();
    expect(stateless.broadcasts.items[0].startsInHours).toBeUndefined();
    expect(stateless.broadcasts.ok).toBe(true);
  });

  it('lists pending language-model architectures, frontier labs first', () => {
    const w = buildEarlyWarnings(
      {
        drops: ok([]),
        leaks: [],
        architectures: ok([
          arch('glm6', 'zai', 20),
          arch('gemma5', 'google', 2),
          arch('qwen9_next', 'qwen', 9),
          arch('qwen3_asr', 'qwen', 30),
          arch('qwen4_exp', 'qwen', 31, false),
        ]),
      },
      NOW,
    );
    expect(w.architectures.items.map((a) => [a.module, a.frontier])).toEqual([
      ['qwen9_next', true],
      ['gemma5', true],
      ['glm6', false],
    ]);
  });

  it('shows the DevDay window from 72 hours before the keynote', () => {
    const before = buildEarlyWarnings({ drops: ok([]), leaks: [] }, Date.parse('2026-09-26T16:59:00Z'));
    const during = buildEarlyWarnings({ drops: ok([]), leaks: [] }, Date.parse('2026-09-27T00:00:00Z'));
    expect(before.events.items).toEqual([]);
    expect(during.events.items.map((e) => e.labId)).toContain('openai');
  });

  it('dates stealth slots from the ledger when OpenRouter moved created later', () => {
    const slot = { ...listing('stealth/ox-alpha', 'Ox Alpha'), createdAt: '2026-09-25T00:00:00.000Z' };
    const ledger = ledgerFromRows([
      { kind: 'stealth', key: 'stealth/ox-alpha', firstSeenAt: '2026-09-24T00:00:00.000Z', seeded: false },
    ]);
    const w = buildEarlyWarnings({ drops: ok([slot]), leaks: [], ledger }, NOW);
    expect(w.stealth.items[0].createdAt).toBe('2026-09-24T00:00:00.000Z');
  });
});
