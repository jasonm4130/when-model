import { describe, expect, it } from 'vitest';
import {
  ANNOUNCED_WINDOW_DAYS,
  REVISION_MIN_DAYS,
  announcedNotUsable,
  announcementBatches,
  availabilityBatches,
  huggingFaceSightings,
  launchStorySightings,
  ledgerWrites,
  openRouterSightings,
  postSightings,
  qwenChatSightings,
  releaseEventsFromLedger,
  resolveAnnouncements,
  type AnnouncementRow,
  type AvailabilityRow,
  type LedgerBatch,
} from '../../src/domain/availability';
import type { SourceResult } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { FeedItem } from '../../src/domain/feed';
import { SOURCE } from '../../src/domain/sources';

const T0 = Date.parse('2026-09-20T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

function drop(id: string, extra: Partial<Drop> = {}): Drop {
  return {
    id,
    name: id,
    lab: id.split('/')[0],
    createdAt: iso(T0),
    url: `https://openrouter.ai/${id}`,
    free: false,
    textOutput: true,
    ...extra,
  };
}

function ok<T>(name: string, data: T): SourceResult<T> {
  return { name, ok: true, data };
}

function down<T>(name: string, data: T): SourceResult<T> {
  return { name, ok: false, error: 'timeout', data };
}

function feedItem(source: FeedItem['source'], title: string, url: string): FeedItem {
  return { source, title, url, publishedAt: iso(T0), alert: true, precision: 'day' };
}

function row(labId: AvailabilityRow['labId'], sku: string, at: number, extra: Partial<AvailabilityRow> = {}) {
  return { labId, sku, firstAvailableAt: iso(at), source: 'openrouter', baseline: false, ...extra };
}

describe('sightings', () => {
  it('keys OpenRouter listings without :free or :batch, skips generators and never places a stealth slot', () => {
    const items = openRouterSightings([
      drop('qwen/qwen3.8-27b'),
      drop('qwen/qwen3.8-27b:free'),
      drop('qwen/qwen3.8-27b:batch'),
      drop('google/veo-4', { textOutput: false }),
      drop('stealth/ox-alpha', { stealth: true, name: 'Ox Alpha' }),
      drop('nvidia/nemotron-5'),
    ]);
    expect(items).toEqual([
      {
        key: 'qwen/qwen3.8-27b',
        meta: { role: 'availability', name: 'qwen/qwen3.8-27b', labId: 'qwen', skus: ['qwen3.8-27b'] },
      },
      { key: 'stealth/ox-alpha', meta: { role: 'stealth', name: 'Ox Alpha' } },
      { key: 'nvidia/nemotron-5', meta: { role: 'availability', name: 'nvidia/nemotron-5' } },
    ]);
  });

  it('reads an inactive chat.qwen.ai model as an announcement, not availability', () => {
    const prime = 'qwen3.8-max-prime';
    expect(
      qwenChatSightings([
        { id: prime, name: 'Qwen3.8-Max-Prime', active: true, visitorActive: false },
        { id: 'qwen4-max', name: 'Qwen4-Max', active: false },
      ]),
    ).toEqual([
      {
        key: prime,
        meta: {
          role: 'availability',
          name: 'Qwen3.8-Max-Prime',
          labId: 'qwen',
          skus: ['qwen3.8-max-prime'],
          visitorActive: false,
        },
      },
      {
        key: 'qwen4-max#inactive',
        meta: {
          role: 'announcement',
          name: 'Qwen4-Max',
          labId: 'qwen',
          skus: ['qwen4-max'],
          url: 'https://chat.qwen.ai/',
        },
      },
    ]);
  });

  it('places an untagged Hugging Face repo only when it names a versioned model', () => {
    const items = huggingFaceSightings([
      { id: 'Qwen/Qwen3.8-27B-Instruct-FP8', pipelineTag: 'text-generation' },
      { id: 'Qwen/Qwen3.8-9B' },
      { id: 'Qwen/SAE-Res-Research-W64K' },
    ]);
    expect(items.map((i) => i.meta.skus)).toEqual([['qwen3.8-27b'], ['qwen3.8-9b'], undefined]);
    expect(items.every((i) => i.meta.role === 'availability')).toBe(true);
  });

  it('makes a launch-shaped post of this lab an announcement, and keeps every other post only to seed', () => {
    const items = postSightings(
      [
        {
          title: 'Introducing Muse Spark 1.3',
          url: 'https://about.fb.com/news/2026/09/muse-spark-1-3/',
          publishedAt: iso(T0),
          precision: 'instant',
        },
        {
          title: 'Introducing Muse Spark 1.3',
          url: 'https://about.fb.com/news/2026/09/muse-spark-1-3/?utm=x',
          publishedAt: iso(T0),
          precision: 'instant',
        },
        {
          title: 'Our new data centre in Ohio',
          url: 'https://about.fb.com/news/2026/09/ohio/',
          publishedAt: iso(T0),
          precision: 'instant',
        },
        {
          title: 'Introducing Qwen4 on our cloud',
          url: 'https://about.fb.com/news/2026/09/qwen4/',
          publishedAt: iso(T0),
          precision: 'instant',
        },
      ],
      'meta',
    );
    expect(items).toHaveLength(3);
    expect(items[0].meta).toMatchObject({ role: 'announcement', labId: 'meta', skus: ['muse-spark-1.3'] });
    expect(items[1].meta).toEqual({
      role: 'post',
      name: 'Our new data centre in Ohio',
      url: 'https://about.fb.com/news/2026/09/ohio/',
      publishedAt: iso(T0),
    });
    // Launch-shaped, but the model is another lab's: an announcement of nothing we can place.
    expect(items[2].meta).toMatchObject({ role: 'announcement', labId: 'meta' });
    expect(items[2].meta.skus).toBeUndefined();
  });

  it('reads a Hacker News launch story as the lab speaking only when it links the lab site', () => {
    const items = launchStorySightings([
      { ...feedItem('hn', 'Qwen3.9-Max', 'https://qwen.ai/blog?id=qwen3.9-max'), precision: undefined },
      feedItem('hn', 'Qwen3.9-Max is out', 'https://www.theverge.com/qwen'),
      feedItem('hn', 'Qwen3.9-Max again', 'https://qwen.ai/blog?id=qwen3.9-max'),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].meta).toMatchObject({ role: 'announcement', labId: 'qwen', skus: ['qwen3.9-max'] });
    expect(items[1].meta).toEqual({
      role: 'post',
      name: 'Qwen3.9-Max is out',
      url: 'https://www.theverge.com/qwen',
    });
  });
});

describe('batches', () => {
  it('gives each availability source that answered its own kind, and a failed source none', () => {
    const batches = availabilityBatches({
      openrouter: ok(SOURCE.openrouter, [drop('qwen/qwen3.8-27b')]),
      qwenChat: down('chat.qwen.ai models', []),
      huggingFace: [
        { ...ok('HF Qwen', [{ id: 'Qwen/Qwen3.8-9B' }]), org: 'Qwen' },
        { ...down('HF deepseek-ai', []), org: 'deepseek-ai' },
        { ...ok('HF xai-org', []), org: 'xai-org' },
      ],
    });
    expect(batches.map((b) => [b.kind, b.name, b.source])).toEqual([
      ['avail:openrouter', SOURCE.openrouter, 'openrouter'],
      ['avail:hf:Qwen', 'HF Qwen', 'hf:Qwen'],
    ]);
    expect(availabilityBatches({ openrouter: down(SOURCE.openrouter, [drop('qwen/qwen3.8-27b')]) })).toEqual(
      [],
    );
  });

  it('reads chat.qwen.ai as its own kind when it answered', () => {
    const [batch] = availabilityBatches({
      openrouter: ok(SOURCE.openrouter, []),
      qwenChat: ok('chat.qwen.ai models', [{ id: 'qwen3.8-flash', name: 'Qwen3.8-Flash', active: true }]),
    });
    expect(batch).toMatchObject({ kind: 'avail:qwen-chat', source: 'qwen-chat' });
  });

  it('reuses the first-party lab feeds, the launch search and the cron-only lab sites', () => {
    const batches = announcementBatches({
      feeds: [
        ok(SOURCE.openai, [feedItem('openai', 'Introducing GPT-6', 'https://openai.com/index/gpt-6/')]),
        ok(SOURCE.hackerNews, [feedItem('hn', 'Introducing GPT-6', 'https://openai.com/index/gpt-6/')]),
        ok(SOURCE.github, [
          feedItem('github', 'openai-python v3.0.0', 'https://github.com/openai/openai-python'),
        ]),
        down(SOURCE.anthropic, [
          feedItem('anthropic', 'Introducing Claude Opus 6', 'https://www.anthropic.com/news/opus-6'),
        ]),
        ok(SOURCE.deepmind, [
          { ...feedItem('deepmind', 'Gemini 4 Pro', 'https://blog.google/gemini-4'), precision: undefined },
        ]),
        ok('some other feed', [feedItem('openai', 'x', 'https://example.com')]),
      ],
      launchStories: ok(SOURCE.hnLaunches, [
        feedItem('hn', 'Introducing GPT-6', 'https://openai.com/index/gpt-6/'),
      ]),
      posts: [
        { ...ok('Meta newsroom', []), source: 'meta', labId: 'meta' },
        { ...down('DeepSeek news', []), source: 'deepseek', labId: 'deepseek' },
        {
          ...ok('DeepSeek news', [
            {
              title: 'DeepSeek-V4.1 Release',
              url: 'https://api-docs.deepseek.com/news/news260910',
              publishedAt: iso(T0),
              precision: 'day' as const,
            },
          ]),
          source: 'deepseek',
          labId: 'deepseek',
        },
      ],
    });
    expect(batches.map((b) => [b.kind, b.source])).toEqual([
      ['announce:openai', 'openai'],
      ['announce:deepmind', 'deepmind'],
      ['announce:hn', 'hn'],
      ['announce:deepseek', 'deepseek'],
    ]);
    expect(batches[1].items[0].meta).toMatchObject({
      role: 'announcement',
      labId: 'google',
      skus: ['gemini-4-pro'],
    });
    expect(batches[3].items[0].meta).toMatchObject({ labId: 'deepseek', skus: ['deepseek-v4.1'] });
    expect(announcementBatches({ feeds: [] })).toEqual([]);
  });
});

describe('ledgerWrites', () => {
  const batch: LedgerBatch = {
    kind: 'avail:openrouter',
    name: SOURCE.openrouter,
    source: 'openrouter',
    items: [
      {
        key: 'qwen/qwen3.5-plus-20260420',
        meta: { role: 'availability', name: 'Qwen3.5 Plus', labId: 'qwen', skus: ['qwen3.5-plus@20260420'] },
      },
      {
        key: 'qwen/qwen3.8-27b',
        meta: { role: 'availability', name: 'Qwen3.8 27B', labId: 'qwen', skus: ['qwen3.8-27b'] },
      },
      { key: 'stealth/ox-alpha', meta: { role: 'stealth', name: 'Ox Alpha' } },
      { key: 'nvidia/nemotron-5', meta: { role: 'availability', name: 'Nemotron 5' } },
      { key: 'https://qwen.ai/x', meta: { role: 'post', name: 'Hello' } },
      {
        key: 'qwen4-max',
        meta: {
          role: 'announcement',
          name: 'Qwen4-Max',
          labId: 'qwen',
          skus: ['qwen4-max'],
          url: 'https://chat.qwen.ai/',
          publishedAt: iso(T0),
        },
      },
      { key: 'no-url', meta: { role: 'announcement', name: 'Qwen4', labId: 'qwen', skus: ['qwen4'] } },
    ],
  };

  it('writes a seeded kind as baseline rows for every item it can place', () => {
    const writes = ledgerWrites(batch, { newKeys: [], seeded: true }, iso(T0));
    expect(writes.availability).toEqual([
      {
        labId: 'qwen',
        sku: 'qwen3.5-plus@20260420',
        name: 'Qwen3.5 Plus',
        firstAvailableAt: iso(T0),
        source: 'openrouter',
        sourceKey: 'qwen/qwen3.5-plus-20260420',
        baseline: true,
        snapshot: '20260420',
      },
      {
        labId: 'qwen',
        sku: 'qwen3.8-27b',
        name: 'Qwen3.8 27B',
        firstAvailableAt: iso(T0),
        source: 'openrouter',
        sourceKey: 'qwen/qwen3.8-27b',
        baseline: true,
      },
    ]);
    expect(writes.announcements).toEqual([
      {
        labId: 'qwen',
        sku: 'qwen4-max',
        firstSeenAt: iso(T0),
        source: 'openrouter',
        url: 'https://chat.qwen.ai/',
        title: 'Qwen4-Max',
        publishedAt: iso(T0),
        baseline: true,
      },
      {
        labId: 'qwen',
        sku: 'qwen4',
        firstSeenAt: iso(T0),
        source: 'openrouter',
        url: 'no-url',
        title: 'Qwen4',
        baseline: true,
      },
    ]);
    expect(writes.dropped).toEqual(['nvidia/nemotron-5']);
  });

  it('writes a new repo older than every recorded repo in view as a baseline: it slid in from below', () => {
    const items = huggingFaceSightings([
      { id: 'Qwen/Qwen3.8-9B', pipelineTag: 'text-generation', createdAt: '2026-09-10T00:00:00.000Z' },
      { id: 'Qwen/Qwen3.9-72B', pipelineTag: 'text-generation', createdAt: '2026-09-05T00:00:00.000Z' },
      { id: 'Qwen/Qwen3.7-4B', pipelineTag: 'text-generation', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'Qwen/Qwen3.6-14B', pipelineTag: 'text-generation', createdAt: '2026-07-01T00:00:00.000Z' },
    ]);
    const hf: LedgerBatch = { kind: 'avail:hf:Qwen', name: 'HF Qwen', source: 'hf:Qwen', items };
    const recorded = { newKeys: ['Qwen/Qwen3.9-72B', 'Qwen/Qwen3.6-14B'], seeded: false };
    expect(ledgerWrites(hf, recorded, iso(T0)).availability.map((r) => [r.sku, r.baseline])).toEqual([
      ['qwen3.9-72b', false],
      ['qwen3.6-14b', true],
    ]);
    // With no recorded repo in view there is no floor: a listing without creation times reads as before.
    const bare = {
      ...hf,
      items: items.map((i) => ({ key: i.key, meta: { ...i.meta, createdAt: undefined } })),
    };
    expect(ledgerWrites(bare, recorded, iso(T0)).availability.every((r) => !r.baseline)).toBe(true);
    const allNew = { newKeys: items.map((i) => i.key), seeded: false };
    expect(ledgerWrites(hf, allNew, iso(T0)).availability.every((r) => !r.baseline)).toBe(true);
  });

  it('writes only the keys new to the kind once it has a baseline', () => {
    const writes = ledgerWrites(
      batch,
      { newKeys: ['qwen/qwen3.8-27b', 'stealth/ox-alpha'], seeded: false },
      iso(T0),
    );
    expect(writes.availability.map((r) => [r.sku, r.baseline])).toEqual([['qwen3.8-27b', false]]);
    expect(writes.announcements).toEqual([]);
    expect(writes.dropped).toEqual([]);
  });
});

describe('releaseEventsFromLedger', () => {
  const now = T0 + 90 * DAY;

  it('never forms an event from a baseline row, or from a row after now', () => {
    expect(
      releaseEventsFromLedger(
        [row('qwen', 'qwen3.8-27b', T0, { baseline: true }), row('qwen', 'qwen3.9-max', now + HOUR)],
        now,
      ),
    ).toEqual([]);
  });

  it('times a release by its earliest source: chat.qwen.ai days before OpenRouter is one event', () => {
    // The table keeps one row per sku, the earliest; OpenRouter's later sighting was ignored.
    const [event] = releaseEventsFromLedger([row('qwen', 'qwen3.9-max', T0, { source: 'qwen-chat' })], now);
    expect(event).toMatchObject({
      id: `qwen@${iso(T0)}`,
      labId: 'qwen',
      frontier: true,
      tier: 'flagship',
      rules: ['qwen: first max of a version'],
      firstAvailableSource: 'qwen-chat',
      skus: ['qwen3.9-max'],
    });
    expect(event).not.toHaveProperty('announcedAt');
  });

  it('groups a lab within two hours of the first row, anchored, never chained', () => {
    const events = releaseEventsFromLedger(
      [
        row('openai', 'gpt-6-sol', T0),
        row('openai', 'gpt-6-luna', T0 + 1.5 * HOUR),
        row('openai', 'gpt-6-pro', T0 + 2 * HOUR),
        // 2.5 h after the first row, though only 30 minutes after the last.
        row('openai', 'gpt-6-mini', T0 + 2.5 * HOUR),
        row('anthropic', 'claude-opus-6', T0 + HOUR),
      ],
      now,
    );
    expect(events.map((e) => [e.labId, e.firstAvailableAt, e.skus])).toEqual([
      ['openai', iso(T0 + 2.5 * HOUR), ['gpt-6-mini']],
      ['anthropic', iso(T0 + HOUR), ['claude-opus-6']],
      ['openai', iso(T0), ['gpt-6-sol', 'gpt-6-luna', 'gpt-6-pro']],
    ]);
    expect(events[0].tier).toBe('minor');
    expect(events[2].tier).toBe('flagship');
  });

  it(`folds a snapshot within ${REVISION_MIN_DAYS} days of its base into that release, and makes a later one a revision`, () => {
    const events = releaseEventsFromLedger(
      [
        row('deepseek', 'deepseek-v4-flash', T0),
        row('deepseek', 'deepseek-v4-flash@0925', T0 + 5 * DAY),
        row('deepseek', 'deepseek-v4-flash@1220', T0 + 5 * DAY + REVISION_MIN_DAYS * DAY),
      ],
      now,
    );
    expect(events.map((e) => [e.firstAvailableAt, e.skus, e.tier])).toEqual([
      [iso(T0 + 35 * DAY), ['deepseek-v4-flash@1220'], 'minor'],
      [iso(T0), ['deepseek-v4-flash', 'deepseek-v4-flash@0925'], 'minor'],
    ]);
  });

  it('reads a new snapshot of a baseline model as a revision, never part of the baseline', () => {
    const events = releaseEventsFromLedger(
      [row('qwen', 'qwen3.5-plus', T0, { baseline: true }), row('qwen', 'qwen3.5-plus@20260420', T0 + DAY)],
      now,
    );
    expect(events.map((e) => e.skus)).toEqual([['qwen3.5-plus@20260420']]);
  });

  it('tiers each release with the marks of every row before it, baselines included', () => {
    // Qwen4's debut is flagship; the next large Qwen4 is not, and neither is an open size under 100B.
    const events = releaseEventsFromLedger(
      [
        row('qwen', 'qwen4-235b', T0),
        row('qwen', 'qwen4-397b', T0 + DAY),
        row('qwen', 'qwen4.1-32b', T0 + 2 * DAY),
      ],
      now,
    );
    expect(events.map((e) => [e.skus[0], e.tier, e.rules])).toEqual([
      ['qwen4.1-32b', 'minor', ['qwen: plus/flash/omni/size variant/dated after debut']],
      ['qwen4-397b', 'minor', ['qwen: plus/flash/omni/size variant/dated after debut']],
      ['qwen4-235b', 'flagship', ['qwen: debut of a new version (non-small tier)']],
    ]);
    const afterBaseline = releaseEventsFromLedger(
      [row('qwen', 'qwen4-plus', T0, { baseline: true }), row('qwen', 'qwen4-235b', T0 + DAY)],
      now,
    );
    expect(afterBaseline.map((e) => e.tier)).toEqual(['minor']);
  });

  it('reads the earliest non-baseline announcement a release satisfied as its lead', () => {
    const [event] = releaseEventsFromLedger(
      [row('openai', 'gpt-6-sol', T0), row('openai', 'gpt-6-luna', T0 + HOUR)],
      now,
      [
        { firstSeenAt: iso(T0 - 5 * HOUR), baseline: false, usableSku: 'gpt-6-sol' },
        { firstSeenAt: iso(T0 - 9 * HOUR), baseline: true, usableSku: 'gpt-6-sol' },
        { firstSeenAt: iso(T0 - 2 * HOUR), baseline: false, usableSku: 'gpt-6-luna' },
        // A post after the release is a lagging post, not a lead.
        { firstSeenAt: iso(T0 + 3 * HOUR), baseline: false, usableSku: 'gpt-6-sol' },
        { firstSeenAt: iso(T0 - 20 * HOUR), baseline: false },
      ],
    );
    expect(event).toMatchObject({ announcedAt: iso(T0 - 5 * HOUR), leadH: 5 });
  });
});

describe('announced, not yet usable', () => {
  const announcement = (
    sku: string,
    seenAt: number,
    extra: Partial<AnnouncementRow> = {},
  ): AnnouncementRow => ({
    labId: 'openai',
    sku,
    firstSeenAt: iso(seenAt),
    source: 'openai',
    url: `https://openai.com/index/${sku}/`,
    title: `Introducing ${sku}`,
    baseline: false,
    ...extra,
  });

  it('stays open until a same-lab sku satisfies it, and resolves to the earliest one', () => {
    const open = [
      announcement('gpt-6', T0),
      announcement('gpt-7', T0),
      announcement('gpt-5', T0, { usableAt: iso(T0) }),
    ];
    expect(resolveAnnouncements(open, [])).toEqual([]);
    expect(
      resolveAnnouncements(open, [
        { labId: 'openai', sku: 'gpt-6-sol', firstAvailableAt: iso(T0 + 2 * HOUR) },
        { labId: 'openai', sku: 'gpt-6-luna', firstAvailableAt: iso(T0 + HOUR) },
        { labId: 'openai', sku: 'gpt-6.5', firstAvailableAt: iso(T0) },
        { labId: 'anthropic', sku: 'gpt-7', firstAvailableAt: iso(T0) },
        { labId: 'openai', sku: 'gpt-5', firstAvailableAt: iso(T0) },
      ]),
    ).toEqual([{ labId: 'openai', sku: 'gpt-6', usableAt: iso(T0 + HOUR), usableSku: 'gpt-6-luna' }]);
  });

  it('keeps a new snapshot announced while only its base is usable open, and times its release lead', () => {
    const [post] = postSightings(
      [
        {
          title: 'DeepSeek-V4-Flash-1015 Release',
          url: 'https://api-docs.deepseek.com/news/news261015',
          publishedAt: iso(T0),
          precision: 'day',
        },
      ],
      'deepseek',
    );
    const batch = { kind: 'announce:deepseek', name: 'DeepSeek news', source: 'deepseek', items: [post] };
    const [announced] = ledgerWrites(batch, { newKeys: [post.key], seeded: false }, iso(T0)).announcements;
    expect(announced.sku).toBe('deepseek-v4-flash@1015');

    const base = { labId: 'deepseek', sku: 'deepseek-v4-flash', firstAvailableAt: iso(T0 - 170 * DAY) };
    expect(resolveAnnouncements([announced], [base])).toEqual([]);
    expect(announcedNotUsable([announced], T0 + DAY)).toEqual([
      expect.objectContaining({ sku: 'deepseek-v4-flash@1015', hoursSince: 24 }),
    ]);

    // The snapshot ships a day later: the announcement resolves to it, and its release has the lead.
    const shipped = { labId: 'deepseek', sku: 'deepseek-v4-flash@1015', firstAvailableAt: iso(T0 + DAY) };
    const [update] = resolveAnnouncements([announced], [base, shipped]);
    expect(update).toMatchObject({ usableAt: iso(T0 + DAY), usableSku: 'deepseek-v4-flash@1015' });
    const [event] = releaseEventsFromLedger(
      [
        row('deepseek', 'deepseek-v4-flash', T0 - 170 * DAY),
        row('deepseek', 'deepseek-v4-flash@1015', T0 + DAY),
      ],
      T0 + 2 * DAY,
      [{ ...announced, usableSku: update.usableSku }],
    );
    expect(event).toMatchObject({ skus: ['deepseek-v4-flash@1015'], announcedAt: iso(T0), leadH: 24 });
  });

  it('resolves a preview post by the models it launched, which carry no "preview"', () => {
    const [post] = postSightings(
      [
        {
          title: 'DeepSeek-V4 Preview Release',
          url: 'https://api-docs.deepseek.com/news/news260424',
          publishedAt: iso(T0),
          precision: 'day',
        },
      ],
      'deepseek',
    );
    const batch = { kind: 'announce:deepseek', name: 'DeepSeek news', source: 'deepseek', items: [post] };
    const [announced] = ledgerWrites(batch, { newKeys: [post.key], seeded: false }, iso(T0)).announcements;
    expect(announced.sku).toBe('deepseek-v4-preview');
    expect(
      resolveAnnouncements(
        [announced],
        [
          { labId: 'deepseek', sku: 'deepseek-v4-pro', firstAvailableAt: iso(T0 + HOUR) },
          { labId: 'deepseek', sku: 'deepseek-v4-flash', firstAvailableAt: iso(T0 + HOUR) },
        ],
      ),
    ).toEqual([
      {
        labId: 'deepseek',
        sku: 'deepseek-v4-preview',
        usableAt: iso(T0 + HOUR),
        usableSku: 'deepseek-v4-flash',
      },
    ]);
  });

  it('resolves a post about a model already usable to a time before the post: a lagging post', () => {
    expect(
      resolveAnnouncements(
        [announcement('gpt-6', T0)],
        [{ labId: 'openai', sku: 'gpt-6', firstAvailableAt: iso(T0 - DAY) }],
      ),
    ).toEqual([{ labId: 'openai', sku: 'gpt-6', usableAt: iso(T0 - DAY), usableSku: 'gpt-6' }]);
  });

  it(`warns for ${ANNOUNCED_WINDOW_DAYS} days, newest first, flagging a baseline announcement`, () => {
    const now = T0 + 10 * DAY;
    const warnings = announcedNotUsable(
      [
        announcement('gpt-6', T0),
        announcement('gpt-6-pro', T0 + 9 * DAY, { baseline: true }),
        announcement('gpt-5.9', now - ANNOUNCED_WINDOW_DAYS * DAY),
        announcement('gpt-6-sol', T0, { usableAt: iso(T0 + DAY) }),
        announcement('gpt-7', now + HOUR),
      ],
      now,
    );
    expect(warnings).toEqual([
      {
        labId: 'openai',
        sku: 'gpt-6-pro',
        title: 'Introducing gpt-6-pro',
        url: 'https://openai.com/index/gpt-6-pro/',
        source: 'openai',
        seenAt: iso(T0 + 9 * DAY),
        hoursSince: 24,
        baseline: true,
      },
      expect.objectContaining({ sku: 'gpt-6', hoursSince: 240, baseline: false }),
    ]);
  });
});
