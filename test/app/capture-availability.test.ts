import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QWEN_CHAT_MODELS_URL } from '../../src/adapters/qwen-chat';
import { DEEPSEEK_NEWS_URL, META_NEWSROOM_URL } from '../../src/adapters/lab-feeds';
import { hfOrgUrl } from '../../src/adapters/huggingface';
import {
  HF_ORGS,
  captureAvailability,
  pollAvailability,
  type AvailabilityPoll,
} from '../../src/app/capture-availability';
import {
  releaseEventsFromLedger,
  type ChatModel,
  type HubRepo,
  type LabPost,
} from '../../src/domain/availability';
import type { DashboardInputs, SourceResult } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { FeedItem } from '../../src/domain/feed';
import { SOURCE } from '../../src/domain/sources';
import { readFirstSeen } from '../../src/infra/snapshot-store';
import { fixture } from '../fixtures/read';
import { SqliteD1 } from '../infra/sqlite-d1';

const T0 = Date.parse('2026-09-23T01:00:00.000Z');
const QUARTER = 15 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function ok<T>(name: string, data: T): SourceResult<T> {
  return { name, ok: true, data, ms: 12 };
}

function down<T>(name: string, data: T): SourceResult<T> {
  return { name, ok: false, data, error: 'timeout', ms: 8000 };
}

function drop(id: string, name = id): Drop {
  return {
    id,
    name,
    lab: id.split('/')[0],
    createdAt: iso(T0),
    url: `https://openrouter.ai/${id}`,
    free: false,
    textOutput: true,
  };
}

function inputs(drops: Drop[], extra: Partial<DashboardInputs> = {}): DashboardInputs {
  return {
    markets: ok(SOURCE.polymarket, []),
    drops: ok(SOURCE.openrouter, drops),
    trending: ok(SOURCE.hfTrending, []),
    papers: ok(SOURCE.hfPapers, []),
    feeds: [],
    ...extra,
  };
}

function poll(
  chat: ChatModel[] | undefined,
  hf: Record<string, HubRepo[] | undefined> = {},
  posts: { meta?: LabPost[]; deepseek?: LabPost[] } = {},
): () => Promise<AvailabilityPoll> {
  return async () => ({
    qwenChat: chat ? ok('chat.qwen.ai models', chat) : down('chat.qwen.ai models', []),
    huggingFace: HF_ORGS.map((org) => {
      const repos = hf[org];
      return { ...(repos ? ok(`HF ${org}`, repos) : down(`HF ${org}`, [])), org };
    }),
    posts: [
      {
        ...(posts.meta ? ok('Meta newsroom', posts.meta) : down('Meta newsroom', [])),
        source: 'meta',
        labId: 'meta',
      },
      {
        ...(posts.deepseek ? ok('DeepSeek news', posts.deepseek) : down('DeepSeek news', [])),
        source: 'deepseek',
        labId: 'deepseek',
      },
    ],
  });
}

const at = (ms: number) => () => ms;

function availabilityRows(db: SqliteD1) {
  return db.sqlite
    .prepare(
      'SELECT lab_id, sku, first_available_at, source, baseline FROM availability ORDER BY lab_id, sku',
    )
    .all() as { lab_id: string; sku: string; first_available_at: string; source: string; baseline: number }[];
}

function announcementRows(db: SqliteD1) {
  return db.sqlite
    .prepare(
      'SELECT lab_id, sku, first_seen_at, source, baseline, usable_at, usable_sku FROM announcements ORDER BY sku',
    )
    .all();
}

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('captureAvailability', () => {
  it('seeds every kind as a baseline on its first capture, then writes only what is new', async () => {
    const db = new SqliteD1();
    const hf = { Qwen: [{ id: 'Qwen/Qwen3.8-27B', pipelineTag: 'image-text-to-text' }] };
    const first = await captureAvailability(db, inputs([drop('qwen/qwen3.8-27b'), drop('openai/gpt-5.5')]), {
      poll: poll([{ id: 'qwen3.8-max', name: 'Qwen3.8-Max', active: true }], hf),
      now: at(T0),
    });
    expect(availabilityRows(db)).toEqual([
      { lab_id: 'openai', sku: 'gpt-5.5', first_available_at: iso(T0), source: 'openrouter', baseline: 1 },
      { lab_id: 'qwen', sku: 'qwen3.8-27b', first_available_at: iso(T0), source: 'openrouter', baseline: 1 },
      { lab_id: 'qwen', sku: 'qwen3.8-max', first_available_at: iso(T0), source: 'qwen-chat', baseline: 1 },
    ]);
    expect(first.sources.find((s) => s.name === SOURCE.openrouter)).toMatchObject({
      ok: true,
      items: 2,
      seeded: true,
      newSkuCount: 2,
    });

    // A quarter-hour later: one new listing, and chat.qwen.ai lists a model it has switched off.
    const second = await captureAvailability(
      db,
      inputs([drop('qwen/qwen3.8-27b'), drop('openai/gpt-5.5'), drop('openai/gpt-6-sol')]),
      {
        poll: poll(
          [
            { id: 'qwen3.8-max', name: 'Qwen3.8-Max', active: true },
            { id: 'qwen3.9-max', name: 'Qwen3.9-Max', active: false },
          ],
          hf,
        ),
        now: at(T0 + QUARTER),
      },
    );
    expect(availabilityRows(db).filter((r) => r.baseline === 0)).toEqual([
      {
        lab_id: 'openai',
        sku: 'gpt-6-sol',
        first_available_at: iso(T0 + QUARTER),
        source: 'openrouter',
        baseline: 0,
      },
    ]);
    expect(announcementRows(db)).toEqual([
      {
        lab_id: 'qwen',
        sku: 'qwen3.9-max',
        first_seen_at: iso(T0 + QUARTER),
        source: 'qwen-chat',
        baseline: 0,
        usable_at: null,
        usable_sku: null,
      },
    ]);
    const openrouter = second.sources.find((s) => s.name === SOURCE.openrouter);
    expect(openrouter).toMatchObject({ newSkus: ['openai:gpt-6-sol'], newSkuCount: 1 });
    expect(openrouter).not.toHaveProperty('seeded');
    expect(second.sources.find((s) => s.name === 'chat.qwen.ai models')?.newSkus).toEqual([
      'qwen:qwen3.9-max',
    ]);

    // Switched on, then listed on OpenRouter a day later: one release, timed by chat.qwen.ai.
    const third = await captureAvailability(db, inputs([drop('qwen/qwen3.8-27b')]), {
      poll: poll([{ id: 'qwen3.9-max', name: 'Qwen3.9-Max', active: true }], hf),
      now: at(T0 + 2 * QUARTER),
    });
    expect(third.resolved).toBe(1);
    await captureAvailability(db, inputs([drop('qwen/qwen3.9-max')]), {
      poll: poll([{ id: 'qwen3.9-max', name: 'Qwen3.9-Max', active: true }], hf),
      now: at(T0 + 96 * QUARTER),
    });
    expect(announcementRows(db)).toEqual([
      expect.objectContaining({
        sku: 'qwen3.9-max',
        usable_at: iso(T0 + 2 * QUARTER),
        usable_sku: 'qwen3.9-max',
      }),
    ]);
    const rows = availabilityRows(db).map((r) => ({
      labId: r.lab_id as 'qwen',
      sku: r.sku,
      firstAvailableAt: r.first_available_at,
      source: r.source,
      baseline: r.baseline === 1,
    }));
    const events = releaseEventsFromLedger(rows, T0 + 200 * QUARTER);
    expect(events.map((e) => [e.labId, e.skus, e.firstAvailableSource, e.firstAvailableAt])).toEqual([
      ['qwen', ['qwen3.9-max'], 'qwen-chat', iso(T0 + 2 * QUARTER)],
      ['openai', ['gpt-6-sol'], 'openrouter', iso(T0 + QUARTER)],
    ]);
  });

  it('adds nothing for a new Hugging Face quant of a model already available', async () => {
    const db = new SqliteD1();
    const repo = (id: string) => ({ id, pipelineTag: 'text-generation' });
    await captureAvailability(db, inputs([drop('qwen/qwen3.8-27b')]), {
      poll: poll(undefined, { Qwen: [repo('Qwen/Qwen3.6-35B')] }),
      now: at(T0),
    });
    await captureAvailability(db, inputs([drop('qwen/qwen3.8-27b')]), {
      poll: poll(undefined, { Qwen: [repo('Qwen/Qwen3.6-35B'), repo('Qwen/Qwen3.8-27B-Instruct-FP8')] }),
      now: at(T0 + QUARTER),
    });
    expect(availabilityRows(db).map((r) => [r.sku, r.baseline])).toEqual([
      ['qwen3.6-35b', 1],
      ['qwen3.8-27b', 1],
    ]);
    // The quant is a new key in its own kind, but its sku was already available.
    expect((await readFirstSeen(db, 'avail:hf:Qwen')).map((r) => r.key)).toContain(
      'Qwen/Qwen3.8-27B-Instruct-FP8',
    );
  });

  it('never makes a release of a model re-listed after the first-seen prune', async () => {
    const db = new SqliteD1();
    await captureAvailability(db, inputs([drop('openai/gpt-5.5'), drop('openai/gpt-5')]), {
      poll: poll(undefined),
      now: at(T0),
    });
    await captureAvailability(db, inputs([drop('openai/gpt-5')]), {
      poll: poll(undefined),
      now: at(T0 + QUARTER),
    });
    // gpt-5.5 unlisted for over 90 days: its first_seen key is pruned, then it comes back.
    const later = T0 + 100 * 86_400_000;
    const summary = await captureAvailability(db, inputs([drop('openai/gpt-5'), drop('openai/gpt-5.5')]), {
      poll: poll(undefined),
      now: at(later),
    });
    expect(summary.sources.find((s) => s.name === SOURCE.openrouter)?.newSkuCount).toBe(0);
    expect(availabilityRows(db).map((r) => [r.sku, r.first_available_at, r.baseline])).toEqual([
      ['gpt-5', iso(T0), 1],
      ['gpt-5.5', iso(T0), 1],
    ]);
  });

  it('writes nothing for a source that failed, and logs every source', async () => {
    const db = new SqliteD1();
    const summary = await captureAvailability(
      db,
      inputs([drop('qwen/qwen3.8-27b')], {
        drops: down(SOURCE.openrouter, [drop('qwen/qwen3.8-27b')]),
        feeds: [ok(SOURCE.openai, [] as FeedItem[])],
        launchStories: ok(SOURCE.hnLaunches, [] as FeedItem[]),
      }),
      { poll: poll(undefined, { Qwen: [{ id: 'Qwen/Qwen3.8-27B' }] }), now: at(T0) },
    );
    expect(availabilityRows(db).map((r) => r.source)).toEqual(['hf:Qwen']);
    expect(summary.observedAt).toBe(iso(T0));
    expect(summary.sources.map((s) => [s.name, s.ok])).toEqual([
      [SOURCE.openrouter, false],
      ['chat.qwen.ai models', false],
      ...HF_ORGS.map((org) => [`HF ${org}`, org === 'Qwen']),
      [SOURCE.openai, true],
      [SOURCE.hnLaunches, true],
      ['Meta newsroom', false],
      ['DeepSeek news', false],
    ]);
    expect(summary.sources[0]).toMatchObject({ error: 'timeout', ms: 8000, items: 1 });
    expect(log).toHaveBeenCalledWith('[availability]', JSON.stringify(summary));
  });

  it('records a launch post as an announcement and logs the ids it could not place', async () => {
    const db = new SqliteD1();
    const post = (title: string, slug: string): LabPost => ({
      title,
      url: `https://about.fb.com/news/2026/09/${slug}/`,
      publishedAt: iso(T0),
      precision: 'instant',
    });
    await captureAvailability(db, inputs([]), {
      poll: poll(undefined, {}, { meta: [post('Connect 2026', 'connect')] }),
      now: at(T0),
    });
    const summary = await captureAvailability(
      db,
      inputs([drop('nvidia/nemotron-5'), drop('meta/muse-spark-1.2')]),
      {
        poll: poll(
          undefined,
          {},
          { meta: [post('Connect 2026', 'connect'), post('Introducing Muse Spark 2', 'muse-spark-2')] },
        ),
        now: at(T0 + QUARTER),
      },
    );
    expect(announcementRows(db)).toEqual([
      expect.objectContaining({
        lab_id: 'meta',
        sku: 'muse-spark-2',
        source: 'meta',
        baseline: 0,
        usable_at: null,
      }),
    ]);
    expect(summary.sources.find((s) => s.name === SOURCE.openrouter)).toMatchObject({
      seeded: true,
      dropped: ['nvidia/nemotron-5'],
      droppedCount: 1,
    });
  });

  it('isolates a failing write to its own kind, and a failing resolve to the resolve step', async () => {
    const db = new SqliteD1();
    db.sqlite.exec('UPDATE availability_metadata SET row_count = 50000');
    const summary = await captureAvailability(db, inputs([drop('openai/gpt-5.5')]), {
      poll: poll([{ id: 'qwen4-max', name: 'Qwen4-Max', active: false }]),
      now: at(T0),
    });
    expect(summary.sources[0]).toMatchObject({
      name: SOURCE.openrouter,
      error: 'availability logical capacity reached',
    });
    expect(announcementRows(db)).toHaveLength(1);

    const broken = new SqliteD1();
    const prepare = broken.prepare.bind(broken);
    vi.spyOn(broken, 'prepare').mockImplementation((query: string) => {
      if (query.includes('WHERE usable_at IS NULL')) throw new Error('D1_ERROR');
      return prepare(query);
    });
    const failed = await captureAvailability(broken, inputs([drop('openai/gpt-5.5')]), {
      poll: poll(undefined),
      now: at(T0),
    });
    expect(failed).toMatchObject({ resolved: 0, error: 'D1_ERROR' });
    expect(availabilityRows(broken)).toHaveLength(1);
  });
});

describe('captureAvailability through a D1 failure', () => {
  /** A database whose next statement matching `pattern` fails once, as a dropped D1 connection does. */
  function flaky(): { db: SqliteD1; failNext: (pattern: string) => void } {
    const db = new SqliteD1();
    const prepare = db.prepare.bind(db);
    let failing: string | undefined;
    vi.spyOn(db, 'prepare').mockImplementation((query: string) => {
      if (failing && query.includes(failing)) {
        failing = undefined;
        throw new Error('D1_ERROR: Network connection lost.');
      }
      return prepare(query);
    });
    return { db, failNext: (pattern) => (failing = pattern) };
  }

  it('writes a release sighted during a failed ledger write on the next capture', async () => {
    const { db, failNext } = flaky();
    await captureAvailability(db, inputs([drop('openai/gpt-5.5')]), { poll: poll(undefined), now: at(T0) });
    failNext('INSERT OR IGNORE INTO availability');
    const failed = await captureAvailability(db, inputs([drop('openai/gpt-5.5'), drop('openai/gpt-6')]), {
      poll: poll(undefined),
      now: at(T0 + QUARTER),
    });
    expect(failed.sources[0]).toMatchObject({ error: 'D1_ERROR: Network connection lost.' });
    const next = await captureAvailability(db, inputs([drop('openai/gpt-5.5'), drop('openai/gpt-6')]), {
      poll: poll(undefined),
      now: at(T0 + 2 * QUARTER),
    });
    expect(next.sources[0]).toMatchObject({ newSkus: ['openai:gpt-6'], newSkuCount: 1 });
    expect(availabilityRows(db).map((r) => [r.sku, r.first_available_at, r.baseline])).toEqual([
      ['gpt-5.5', iso(T0), 1],
      ['gpt-6', iso(T0 + 2 * QUARTER), 0],
    ]);
  });

  it('seeds a kind again when its baseline rows failed to write, never leaving it seeded without them', async () => {
    const { db, failNext } = flaky();
    failNext('INSERT OR IGNORE INTO availability');
    await captureAvailability(db, inputs([drop('openai/gpt-5.5')]), { poll: poll(undefined), now: at(T0) });
    expect(availabilityRows(db)).toEqual([]);
    expect(await readFirstSeen(db, 'avail:openrouter')).toEqual([]);
    const next = await captureAvailability(db, inputs([drop('openai/gpt-5.5')]), {
      poll: poll(undefined),
      now: at(T0 + QUARTER),
    });
    expect(next.sources[0]).toMatchObject({ seeded: true, newSkus: ['openai:gpt-5.5'] });
    expect(availabilityRows(db).map((r) => [r.sku, r.baseline])).toEqual([['gpt-5.5', 1]]);
  });

  it('keeps the first sighting when the first-seen write fails after the ledger write', async () => {
    const { db, failNext } = flaky();
    await captureAvailability(db, inputs([drop('openai/gpt-5.5')]), { poll: poll(undefined), now: at(T0) });
    failNext('INSERT OR IGNORE INTO first_seen');
    await captureAvailability(db, inputs([drop('openai/gpt-5.5'), drop('openai/gpt-6')]), {
      poll: poll(undefined),
      now: at(T0 + QUARTER),
    });
    const next = await captureAvailability(db, inputs([drop('openai/gpt-5.5'), drop('openai/gpt-6')]), {
      poll: poll(undefined),
      now: at(T0 + 2 * QUARTER),
    });
    // The retry finds gpt-6 new to the kind again; the ledger keeps its earlier sighting.
    expect(next.sources[0]).toMatchObject({ newSkuCount: 0 });
    expect(availabilityRows(db).map((r) => [r.sku, r.first_available_at])).toEqual([
      ['gpt-5.5', iso(T0)],
      ['gpt-6', iso(T0 + QUARTER)],
    ]);
    expect((await readFirstSeen(db, 'avail:openrouter')).map((r) => r.key).sort()).toEqual([
      'openai/gpt-5.5',
      'openai/gpt-6',
    ]);
  });
});

describe('captureAvailability before migration 0003', () => {
  it('records nothing, so no kind seeds without its baseline rows', async () => {
    const db = new SqliteD1(['0001_snapshots.sql', '0002_first_seen.sql']);
    const summary = await captureAvailability(db, inputs([drop('openai/gpt-5.5')]), {
      poll: poll(undefined),
      now: at(T0),
    });
    expect(summary.error).toBe('release ledger tables missing (apply migration 0003)');
    expect(await readFirstSeen(db, 'avail:openrouter')).toEqual([]);
  });
});

describe('pollAvailability', () => {
  it('reads every cron-only source through the edge cache, one result per Hugging Face org', async () => {
    const bodies: Record<string, string> = {
      [QWEN_CHAT_MODELS_URL]: fixture('qwen-chat-models.json'),
      [hfOrgUrl('Qwen')]: fixture('hf-org-qwen.json'),
      [META_NEWSROOM_URL]: fixture('meta-newsroom-rss.xml'),
      [DEEPSEEK_NEWS_URL]: fixture('deepseek-docs-home.html.txt'),
      'https://api-docs.deepseek.com/news/news260910/': fixture('deepseek-news-post.html.txt'),
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return bodies[url] === undefined ? new Response('busy', { status: 503 }) : new Response(bodies[url]);
    });
    const result = await pollAvailability();
    expect(result.qwenChat).toMatchObject({ name: 'chat.qwen.ai models', ok: true });
    expect(result.qwenChat.data).toHaveLength(3);
    expect(result.huggingFace.map((r) => [r.org, r.name, r.ok])).toEqual(
      HF_ORGS.map((org) => [org, `HF ${org}`, org === 'Qwen']),
    );
    expect(result.posts.map((p) => [p.name, p.source, p.labId, p.ok, p.data.length > 0])).toEqual([
      ['Meta newsroom', 'meta', 'meta', true, true],
      ['DeepSeek news', 'deepseek', 'deepseek', true, true],
    ]);
    expect(HF_ORGS).toEqual(['openai', 'google', 'xai-org', 'deepseek-ai', 'Qwen', 'meta-llama']);
    expect(calls.length).toBe(4 + HF_ORGS.length);
  });
});
