// @ts-ignore This app deliberately does not ship Node type declarations; these tests run in Node.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
// @ts-ignore This app deliberately does not ship Node type declarations; these tests run in Node.
import { tmpdir } from 'node:os';
// @ts-ignore This app deliberately does not ship Node type declarations; these tests run in Node.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  captureSnapshot,
  evaluateSnapshots,
  makeEnvelope,
  readArchive,
} from '../../scripts/dashboard-archive.mjs';

const dashboard = (generatedAt = '2026-09-20T00:00:00.000Z') => ({
  generatedAt,
  dropcon: { score: 62, level: 2 },
  labs: [{ id: 'openai', heat: 78, status: 'HOT', weekOdds: { p: 0.7 }, monthOdds: { p: 0.9 } }],
  drops: [
    {
      id: 'openai/gpt-6',
      name: 'GPT-6',
      url: 'https://example.test/gpt-6',
      labId: 'openai',
      createdAt: generatedAt,
    },
  ],
  sources: [{ name: 'Polymarket', ok: true }],
});

describe('dashboard archive', () => {
  it('writes an immutable envelope with hash, collector revision, and complete quality', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whenmodel-snapshot-'));
    const response = dashboard();
    const responseText = JSON.stringify(response);
    const result = await captureSnapshot({
      directory,
      now: () => new Date('2026-09-20T00:05:00.000Z'),
      revision: 'collector-local-revision',
      fetchImpl: async () => new Response(responseText, { status: 200 }),
    });
    const stored = JSON.parse(await readFile(result.path, 'utf8'));
    expect(stored.collectorRevision).toBe('collector-local-revision');
    expect(stored.response).toEqual(response);
    expect(stored.responseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.responseText).toBe(responseText);
    expect(stored.quality.status).toBe('legacy');
    await expect(
      captureSnapshot({
        directory,
        now: () => new Date('2026-09-20T00:05:00.000Z'),
        revision: 'x',
        fetchImpl: async () => new Response(responseText),
      }),
    ).rejects.toThrow('EEXIST');
  });

  it('rejects stale and malformed dashboard responses', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whenmodel-snapshot-'));
    await expect(
      captureSnapshot({
        directory,
        now: () => new Date('2026-09-20T01:00:00.000Z'),
        fetchImpl: async () => new Response(JSON.stringify(dashboard())),
      }),
    ).rejects.toThrow('stale');
    await expect(
      captureSnapshot({
        directory,
        fetchImpl: async () => new Response('{nope'),
      }),
    ).rejects.toThrow('valid JSON');
  });

  it('rejects an archive whose response was modified after collection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whenmodel-snapshot-'));
    const path = join(directory, 'tampered.json');
    const envelope = makeEnvelope({ response: dashboard(), collectorRevision: 'a' });
    envelope.responseSha256 = '0'.repeat(64);
    await writeFile(path, JSON.stringify(envelope));
    await expect(readArchive(directory)).rejects.toThrow('SHA-256');
  });

  it('stamps collection after the response body has been consumed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whenmodel-snapshot-'));
    const times = ['2026-09-21T00:00:00.000Z', '2026-09-21T00:01:00.000Z'];
    const result = await captureSnapshot({
      directory,
      now: () => new Date(times.shift()!),
      revision: 'a',
      fetchImpl: async () => new Response(JSON.stringify(dashboard('2026-09-21T00:00:00.000Z'))),
    });
    expect(result.envelope.requestStartedAt).toBe('2026-09-21T00:00:00.000Z');
    expect(result.envelope.fetchedAt).toBe('2026-09-21T00:01:00.000Z');
  });

  it('uses the latest collection before release and does not convert missing history into misses', () => {
    const earlier = makeEnvelope({
      response: dashboard('2026-09-20T00:00:00.000Z'),
      fetchedAt: '2026-09-20T09:00:00.000Z',
      collectorRevision: 'earlier',
    });
    const before = makeEnvelope({
      response: dashboard('2026-09-20T00:00:00.000Z'),
      fetchedAt: '2026-09-20T10:00:00.000Z',
      collectorRevision: 'a',
    });
    const after = makeEnvelope({
      response: dashboard('2026-09-21T00:10:00.000Z'),
      fetchedAt: '2026-09-21T00:15:00.000Z',
      collectorRevision: 'b',
    });
    const [report] = evaluateSnapshots(
      [earlier, before, after],
      [
        {
          labId: 'openai',
          model: 'gpt-6',
          releasedAt: '2026-09-21T00:00:00.000Z',
          sourceUrl: 'https://openai.example/release',
        },
      ],
    );
    expect(report.leadUp['24h']).toMatchObject({
      outcome: 'observed',
      snapshotCount: 2,
      snapshotFetchedAt: '2026-09-20T10:00:00.000Z',
      metrics: { heat: 78, globalScore: 62, weekOdds: 0.7, monthOdds: 0.9 },
    });
    expect(report.leadUp['72h']).toMatchObject({ outcome: 'observed' });
    expect(report.firstDetectedListing).toMatchObject({
      outcome: 'detected',
      delayFromOfficialReleaseMs: 15 * 60 * 1000,
      listing: { sourceListedAt: '2026-09-21T00:10:00.000Z' },
    });

    const [empty] = evaluateSnapshots(
      [],
      [
        {
          labId: 'openai',
          model: 'gpt-6',
          releasedAt: '2026-09-21T00:00:00.000Z',
          sourceUrl: 'https://openai.example/release',
        },
      ],
    );
    expect(empty.leadUp['7d']).toEqual({ outcome: 'unobserved', snapshotCount: 0 });
    expect(empty.firstDetectedListing).toEqual({ outcome: 'unobserved', snapshotsObserved: 0 });
  });

  it('does not mistake a different model variant for the release', () => {
    const snapshot = makeEnvelope({
      response: dashboard('2026-09-21T00:10:00.000Z'),
      fetchedAt: '2026-09-21T00:15:00.000Z',
    });
    const [report] = evaluateSnapshots(
      [snapshot],
      [
        {
          labId: 'openai',
          model: 'gpt-6-pro',
          releasedAt: '2026-09-21T00:00:00Z',
          sourceUrl: 'https://openai.example/release',
        },
      ],
    );
    expect(report.firstDetectedListing.outcome).toBe('not_detected_in_archive');
  });

  it('does not count a post-release collection as a pre-release observation', () => {
    const hindsight = makeEnvelope({
      response: dashboard('2026-09-20T23:00:00.000Z'),
      fetchedAt: '2026-09-21T00:01:00.000Z',
      collectorRevision: 'after-release',
    });
    const [report] = evaluateSnapshots(
      [hindsight],
      [
        {
          labId: 'openai',
          model: 'gpt-6',
          releasedAt: '2026-09-21T00:00:00.000Z',
          sourceUrl: 'https://openai.example/release',
        },
      ],
    );
    expect(report.leadUp['24h']).toEqual({ outcome: 'unobserved', snapshotCount: 0 });
  });

  it("reads a v4 dashboard's lab odds off its family curve, leaving an extrapolated read out", () => {
    const v4 = {
      ...dashboard('2026-09-20T00:00:00.000Z'),
      labs: [
        {
          id: 'openai',
          heat: 60,
          status: 'HOT',
          odds: {
            family: 'GPT-6',
            p72: { p: 0.3, trusted: true },
            p7: { p: 0.66, trusted: true },
            p30: { p: 0.8, trusted: false },
          },
        },
      ],
    };
    const [report] = evaluateSnapshots(
      [makeEnvelope({ response: v4, fetchedAt: '2026-09-20T10:00:00.000Z', collectorRevision: 'v4' })],
      [
        {
          labId: 'openai',
          model: 'gpt-6',
          releasedAt: '2026-09-21T00:00:00.000Z',
          sourceUrl: 'https://openai.example/release',
        },
      ],
    );
    expect(report.leadUp['24h'].metrics).toMatchObject({ weekOdds: 0.66, monthOdds: null });
  });
});
