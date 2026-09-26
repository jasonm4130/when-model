import { expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ env: {} }));
import { recordDashboardFirstSeen } from '../../src/app/capture-history';
import { readLedger } from '../../src/app/load-dashboard';
import { assembleDashboard } from '../../src/domain/dashboard';
import type { FeedItem } from '../../src/domain/feed';
import { SqliteD1 } from '../infra/sqlite-d1';

const DAY = 86_400_000;
const T1 = Date.parse('2026-09-26T04:00:00Z');

/** xAI release notes as the live cold build fetched them: date-only, one page, #anchors. */
const note = (title: string, date: string, alert: boolean): FeedItem => ({
  source: 'xai',
  title,
  url: `https://docs.x.ai/developers/release-notes#${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  publishedAt: `${date}T00:00:00.000Z`,
  precision: 'day',
  alert,
});
const XAI = [
  note('Grok 4.7', '2026-09-21', true),
  note('Grok Voice Transcribe 2.0', '2026-09-17', false),
  note('Grok 4.6', '2026-08-12', true),
  note('Grok Bot', '2026-08-11', false),
  note('Grok 4.5', '2026-07-08', true),
  note('Priority Processing', '2026-06-15', false),
];

const stories = (n: number, now: number): FeedItem[] =>
  Array.from({ length: n }, (_, i) => ({
    source: 'hn',
    title: `Story ${i}`,
    url: `https://example.com/s${i}`,
    publishedAt: new Date(now - (i + 1) * 3_600_000).toISOString(),
    score: 100,
    precision: 'instant',
    alert: false,
  }));

const build = (now: number, hn: number, ledger?: Awaited<ReturnType<typeof readLedger>>) =>
  assembleDashboard(
    {
      markets: { name: 'Polymarket', ok: true, data: [] },
      drops: { name: 'OpenRouter', ok: true, data: [] },
      trending: { name: 'HF trending', ok: true, data: [] },
      papers: { name: 'HF papers', ok: true, data: [] },
      feeds: [
        { name: 'Hacker News', ok: true, data: stories(hn, now) },
        { name: 'xAI news', ok: true, data: XAI },
      ],
      ...(ledger ? { ledger: { name: 'First-seen ledger', ok: true, data: ledger } } : {}),
    },
    now,
  );

it('seeds every dated post on a busy first capture, so none resurfaces later as a fresh announcement', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const db = new SqliteD1();
  // The seeding capture is busy: 58 HN stories push all but the newest xAI notes off the 60-item feed.
  const first = build(T1, 58);
  expect(first.feed.filter((f) => f.source === 'xai').length).toBeLessThan(XAI.length);
  await recordDashboardFirstSeen(db, first, new Date(T1).toISOString());
  // Two quiet captures later every note fits under the cap.
  for (const t of [T1 + 2 * DAY, T1 + 3 * DAY]) {
    await recordDashboardFirstSeen(db, build(t, 8, await readLedger(db, t)), new Date(t).toISOString());
  }
  const rows = db.sqlite
    .prepare("select key, first_seen_at, seeded from first_seen where kind = 'feed-day:xai'")
    .all() as { key: string; first_seen_at: string; seeded: number }[];
  expect(rows).toHaveLength(XAI.length);
  expect(rows.every((r) => r.seeded === 1 && r.first_seen_at === new Date(T1).toISOString())).toBe(true);

  const render = T1 + 3 * DAY + 15 * 60_000;
  const landed = build(render, 8, await readLedger(db, render)).landed;
  // Grok 4.7 (Sep 21) is older than the 7-day window by now; nothing from July or August comes back.
  expect(landed.announcements).toEqual([]);
});
