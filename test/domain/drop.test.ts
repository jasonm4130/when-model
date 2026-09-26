import { describe, expect, it } from 'vitest';
import {
  daysSince,
  monthlyHistogram,
  releaseEvents,
  RELEASE_EVENT_WINDOW_MS,
  withinDays,
  type Drop,
} from '../../src/domain/drop';

const drop = (iso: string): Drop => ({ id: 'x', name: 'x', lab: 'x', createdAt: iso, url: 'u', free: false });

describe('monthlyHistogram', () => {
  it('buckets by UTC month with the current month last', () => {
    const now = new Date('2026-09-19T12:00:00Z');
    const h = monthlyHistogram(
      [
        drop('2026-09-01T00:00:00Z'),
        drop('2026-09-30T23:59:59Z'),
        drop('2026-08-31T23:59:59Z'),
        drop('2025-10-01T00:00:00Z'),
        drop('2025-09-30T00:00:00Z'),
        drop('2027-01-01T00:00:00Z'),
      ],
      12,
      now,
    );
    expect(h).toHaveLength(12);
    expect(h[11]).toBe(1);
    expect(h[10]).toBe(1);
    expect(h[0]).toBe(1);
    expect(h.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('handles a January boundary', () => {
    const h = monthlyHistogram([drop('2025-12-15T00:00:00Z')], 3, new Date('2026-01-10T00:00:00Z'));
    expect(h).toEqual([0, 1, 0]);
  });
});

describe('time helpers', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  it('daysSince floors to whole days', () => {
    expect(daysSince('2026-09-19T01:00:00Z', now)).toBe(0);
    expect(daysSince('2026-09-17T13:00:00Z', now)).toBe(1);
  });
  it('withinDays is exclusive at the boundary', () => {
    expect(withinDays('2026-09-13T12:00:01Z', 6, now)).toBe(true);
    expect(withinDays('2026-09-13T12:00:00Z', 6, now)).toBe(false);
  });
  it('does not count future or invalid timestamps as past releases', () => {
    for (const iso of ['2026-09-19T12:00:01Z', '2026-09-20T12:00:00Z', 'invalid']) {
      expect(withinDays(iso, 7, now)).toBe(false);
      expect(daysSince(iso, now)).toBeUndefined();
    }
    expect(withinDays(new Date(now).toISOString(), 7, now)).toBe(true);
    expect(daysSince(new Date(now).toISOString(), now)).toBe(0);
  });
});

describe('releaseEvents', () => {
  const now = Date.parse('2026-09-26T00:00:00Z');
  const listing = (id: string, createdAt: string, extra: Partial<Drop> = {}): Drop => ({
    id,
    name: id.split('/')[1],
    lab: 'OpenAI',
    labId: 'openai',
    createdAt,
    url: `https://openrouter.ai/${id}`,
    free: false,
    textOutput: true,
    ...extra,
  });
  const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

  it('folds one launch of several SKUs into one frontier event', () => {
    const events = releaseEvents(
      [
        listing('openai/gpt-6-luna-pro', '2026-09-22T18:13:11Z'),
        listing('openai/gpt-6-luna', '2026-09-22T18:13:06Z'),
        listing('openai/gpt-6-sol-pro', '2026-09-22T18:13:01Z'),
        listing('openai/gpt-6-sol', '2026-09-22T18:12:55Z'),
      ],
      now,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'openai@2026-09-22T18:12:55Z',
      lab: 'OpenAI',
      labId: 'openai',
      frontier: true,
      firstListedAt: '2026-09-22T18:12:55Z',
    });
    expect(events[0].models.map((m) => m.id)).toEqual([
      'openai/gpt-6-sol',
      'openai/gpt-6-sol-pro',
      'openai/gpt-6-luna',
      'openai/gpt-6-luna-pro',
    ]);
    expect(events[0].models[0]).toEqual({
      id: 'openai/gpt-6-sol',
      name: 'gpt-6-sol',
      url: 'https://openrouter.ai/openai/gpt-6-sol',
      createdAt: '2026-09-22T18:12:55Z',
    });
  });

  it('anchors the two-hour window to the first listing', () => {
    const t0 = '2026-09-20T12:00:00.000Z';
    const events = releaseEvents(
      [
        listing('openai/a', t0),
        listing('openai/b', at(t0, RELEASE_EVENT_WINDOW_MS)),
        listing('openai/c', at(t0, RELEASE_EVENT_WINDOW_MS + 1000)),
        listing('openai/d', at(t0, RELEASE_EVENT_WINDOW_MS + 2000)),
      ],
      now,
    );
    expect(events.map((e) => e.models.map((m) => m.id))).toEqual([
      ['openai/c', 'openai/d'],
      ['openai/a', 'openai/b'],
    ]);
  });

  it('collapses :free twins onto the paid listing, by canonical slug or by id', () => {
    const events = releaseEvents(
      [
        listing('qwen/qwen3.8-27b:free', '2026-08-14T15:55:09Z', {
          lab: 'Alibaba Qwen',
          labId: 'qwen',
          canonicalSlug: 'qwen/qwen3.8-27b-20260814',
        }),
        listing('qwen/qwen3.8-27b', '2026-08-14T15:55:10Z', {
          lab: 'Alibaba Qwen',
          labId: 'qwen',
          canonicalSlug: 'qwen/qwen3.8-27b-20260814',
        }),
        listing('poolside/laguna:free', '2026-07-21T16:51:23Z', { lab: 'Poolside', labId: undefined }),
        listing('poolside/laguna', '2026-07-21T16:51:23Z', { lab: 'Poolside', labId: undefined }),
        listing('liquid/lfm:free', '2026-08-11T17:48:39Z', { lab: 'LiquidAI', labId: undefined }),
      ],
      now,
    );
    expect(events.map((e) => [e.lab, e.models.map((m) => `${m.id} ${m.createdAt}`)])).toEqual([
      ['Alibaba Qwen', ['qwen/qwen3.8-27b 2026-08-14T15:55:09Z']],
      ['LiquidAI', ['liquid/lfm:free 2026-08-11T17:48:39Z']],
      ['Poolside', ['poolside/laguna 2026-07-21T16:51:23Z']],
    ]);
  });

  it('groups labs outside the registry by vendor prefix and marks them non-frontier', () => {
    const events = releaseEvents(
      [
        listing('xiaomi/mimo-v2-pro', '2026-03-18T19:54:03Z', { lab: 'Xiaomi', labId: undefined }),
        listing('xiaomi/mimo-v2-omni', '2026-03-18T19:55:03Z', { lab: 'Xiaomi', labId: undefined }),
        listing('mistralai/mistral-large-2512', '2026-03-18T19:54:30Z', { lab: 'Mistral', labId: 'mistral' }),
      ],
      now,
    );
    expect(events.map((e) => [e.id, e.frontier, e.labId, e.models.length])).toEqual([
      ['mistral@2026-03-18T19:54:30Z', false, 'mistral', 1],
      ['xiaomi@2026-03-18T19:54:03Z', false, undefined, 2],
    ]);
  });

  it('leaves out stealth slots, non-text generators and future or undated listings', () => {
    const events = releaseEvents(
      [
        listing('stealth/space-bunny-alpha', '2026-09-23T14:48:04Z', {
          lab: 'Stealth',
          labId: undefined,
          stealth: true,
        }),
        listing('google/nano-banana', '2026-09-20T00:00:00Z', { labId: 'google', textOutput: false }),
        listing('openai/next', '2026-09-27T00:00:00Z'),
        listing('openai/undated', 'soon'),
        listing('openai/legacy', '2026-09-19T00:00:00Z', { textOutput: undefined }),
      ],
      now,
    );
    expect(events.flatMap((e) => e.models.map((m) => m.id))).toEqual(['openai/legacy']);
    expect(releaseEvents([], now)).toEqual([]);
  });
});
