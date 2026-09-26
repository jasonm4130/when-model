import { describe, expect, it } from 'vitest';
import { ARCHITECTURE_TRACK, BROADCAST_TRACK, LEAK_TRACK } from '../../src/domain/early-warnings';
import { hitRate } from '../../src/domain/lab-events';
import { SOURCE } from '../../src/domain/sources';
import { REVEAL_STATS } from '../../src/domain/stealth';
import {
  EARLY_WARNING_SOURCES,
  LANDED_SOURCES,
  TRACK_LINES,
  daysShort,
  hoursAgo,
  leadFlags,
} from '../../src/ui/signals';
import { sourcePill } from '../../src/ui/panels';
import { warnings } from '../fixtures/warnings';

describe('lead flags', () => {
  it('puts every lead signal that names a lab on its card, and never an anonymous stealth slot', () => {
    const w = warnings();
    expect(leadFlags(w, 'openai')).toEqual([
      {
        kind: 'leak',
        label: 'LEAK ×2',
        detail:
          'OpenAI tests GPT-6.1 ahead of release (TestingCatalog); GPT-6.1 spotted in the API (Hacker News)',
        href: '#ew-leaks',
      },
      {
        kind: 'stream',
        label: 'STREAM 5H',
        detail: 'OpenAI: OpenAI DevDay 2026 keynote',
        href: '#ew-streams',
      },
      { kind: 'keynote', label: 'KEYNOTE 70H', detail: 'OpenAI DevDay 2026', href: '#ew-events' },
    ]);
    expect(leadFlags(w, 'qwen')).toEqual([
      { kind: 'arch', label: 'ARCH', detail: 'qwen4_exp, 31d pending', href: '#ew-arch' },
    ]);
    expect(leadFlags(w, 'anthropic')).toEqual([]);
  });

  it('counts streams without a start time and marks a keynote under way', () => {
    const w = warnings();
    w.broadcasts.items = [
      { ...w.broadcasts.items[0], startsInHours: undefined },
      { ...w.broadcasts.items[0], videoId: 'v2', startsInHours: -1 },
    ];
    w.events.items = [{ ...w.events.items[0], hoursToStart: -2 }];
    w.architectures.items = [w.architectures.items[0], { ...w.architectures.items[0], module: 'qwen4_moe' }];
    expect(leadFlags(w, 'openai').map((f) => f.label)).toEqual(['LEAK ×2', 'STREAM ×2', 'KEYNOTE LIVE']);
    expect(leadFlags(w, 'qwen').map((f) => f.label)).toEqual(['ARCH ×2']);
  });
});

describe('track lines', () => {
  it('builds each one short sentence from its constant', () => {
    expect(TRACK_LINES.stealth).toBe(
      `${REVEAL_STATS.all.n} revealed slots listed officially a median ${Math.round(REVEAL_STATS.all.medianDays * 10) / 10} days later.`,
    );
    expect(TRACK_LINES.leaks).toBe(
      `${LEAK_TRACK.launched} of ${LEAK_TRACK.n} leaks listed within ${LEAK_TRACK.windowDays} days, a median 1.6 days later (in-sample).`,
    );
    // The misses and the denominator are part of the record, not only the streams that went up.
    expect(TRACK_LINES.broadcasts).toBe(
      `Streams went up ahead of ${BROADCAST_TRACK.n} of ${BROADCAST_TRACK.n + BROADCAST_TRACK.openAiMisses.length} OpenAI launches checked, a median ${BROADCAST_TRACK.medianLeadHours} h ahead (${BROADCAST_TRACK.minLeadHours}–${BROADCAST_TRACK.maxLeadHours} h); none before GPT-5.4, GPT-5.5, GPT-6 Astra and GPT-6 Sol/Luna.`,
    );
    expect(TRACK_LINES.architectures).toBe(
      `Led ${ARCHITECTURE_TRACK.leads} of ${ARCHITECTURE_TRACK.n} dated releases, a median ${ARCHITECTURE_TRACK.medianLeadDays} days ahead (Qwen and Z.ai only).`,
    );
    const rate = hitRate();
    expect(TRACK_LINES.events).toBe(`${rate.hits} of ${rate.total} past keynotes debuted a frontier model.`);
    for (const line of Object.values(TRACK_LINES)) expect(line.split('. ').length).toBe(1);
  });
});

describe('signals panel pills', () => {
  // Both panels wear the shared `sourcePill` over these lists, like every other panel.
  const at = '2026-09-26T12:00:00Z';
  const now = Date.parse(at);
  const all = (ok: boolean) => EARLY_WARNING_SOURCES.map((name) => ({ name, ok }));

  it('is LIVE only when every source behind the panel answered', () => {
    expect(sourcePill(all(true), EARLY_WARNING_SOURCES, at, now, 'SOURCES').text).toBe('LIVE · 5 SOURCES');
    const partial = all(true).map((s) => (s.name === SOURCE.youtube ? { ...s, ok: false } : s));
    const pill = sourcePill(partial, EARLY_WARNING_SOURCES, at, now, 'SOURCES');
    expect([pill.text, pill.tone]).toEqual(['PARTIAL · 4/5 SOURCES', 'warn']);
    expect(pill.title).toContain(`${SOURCE.youtube}: down`);
    expect(sourcePill(all(false), EARLY_WARNING_SOURCES, at, now, 'SOURCES').text).toBe('DOWN · 5 SOURCES');
    // A source the health list never mentions is down, not quietly live.
    expect(sourcePill(all(true).slice(1), EARLY_WARNING_SOURCES, at, now, 'SOURCES').text).toBe(
      'PARTIAL · 4/5 SOURCES',
    );
    expect(sourcePill([], LANDED_SOURCES, at, now, 'SOURCES')).toMatchObject({
      text: 'DOWN · 6 SOURCES',
      tone: 'err',
    });
  });
});

describe('row ages', () => {
  it('reads hours under two days and days after', () => {
    expect(hoursAgo(5.4)).toBe('5h ago');
    expect(hoursAgo(50)).toBe('2d ago');
    expect(daysShort(2.61)).toBe('2.6d');
    expect(daysShort(31.2)).toBe('31d');
  });
});
