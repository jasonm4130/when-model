import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterModelDto } from '../../src/adapters/openrouter';
import { releaseEvents } from '../../src/domain/drop';
import { stealthSlots } from '../../src/domain/stealth';
import live from '../fixtures/openrouter-models.json';
import { mockUpstream } from './mock-cache';

afterEach(() => vi.resetModules());

const fable: OpenRouterModelDto = {
  id: 'anthropic/claude-fable-5.1',
  name: 'Anthropic: Claude Fable 5.1',
  created: 1_789_800_000,
  context_length: 1_000_000,
  pricing: { prompt: '0.00001', completion: '0.00005' },
  architecture: { modality: 'text+image->text' },
};

describe('toDrop', () => {
  it('maps a listing, converting price per token to per million', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    const d = toDrop(fable)!;
    expect(d).toMatchObject({
      id: 'anthropic/claude-fable-5.1',
      name: 'Claude Fable 5.1',
      lab: 'Anthropic',
      labId: 'anthropic',
      context: 1_000_000,
      modality: 'text+image->text',
      url: 'https://openrouter.ai/anthropic/claude-fable-5.1',
      free: false,
    });
    expect(d.promptPerM).toBeCloseTo(10);
    expect(d.completionPerM).toBeCloseTo(50);
    expect(d.createdAt).toBe(new Date(1_789_800_000_000).toISOString());
  });

  it('falls back to the vendor prefix for unknown labs and flags free models', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    const d = toDrop({
      id: 'newlab/thing:free',
      name: 'NewLab: Thing (free)',
      created: 1,
      pricing: { prompt: '0' },
    })!;
    expect(d.lab).toBe('NewLab');
    expect(d.labId).toBeUndefined();
    expect(d.free).toBe(true);
    expect(d.promptPerM).toBe(0);
    expect(d.completionPerM).toBeUndefined();
  });

  it('skips aliases, batch variants, routers and malformed rows', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    expect(toDrop({ ...fable, id: '~anthropic/latest' })).toBeUndefined();
    expect(toDrop({ ...fable, id: 'anthropic/x:batch' })).toBeUndefined();
    expect(toDrop({ ...fable, id: 'openrouter/auto' })).toBeUndefined();
    expect(toDrop({ ...fable, created: undefined })).toBeUndefined();
    expect(toDrop({ ...fable, name: undefined })).toBeUndefined();
  });

  it('maps negative prices to undefined', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    const d = toDrop({ ...fable, pricing: { prompt: '-1', completion: '-1' } })!;
    expect(d.promptPerM).toBeUndefined();
    expect(d.completionPerM).toBeUndefined();
    expect(d.free).toBe(false);
  });

  it('skips routers by tokenizer, third-party ones included, and by id without one', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    const router = { ...fable, id: 'typesafe/jev-router', name: 'TypeSafe: Jev Router' };
    expect(toDrop({ ...router, architecture: { tokenizer: 'Router' } })).toBeUndefined();
    expect(toDrop({ ...router, architecture: { tokenizer: 'Other' } })).toBeDefined();
    const free = { prompt: '0', completion: '0' };
    expect(
      toDrop({ id: 'openrouter/free', name: 'Free Models Router', created: 1, pricing: free }),
    ).toBeUndefined();
    expect(
      toDrop({ id: 'openrouter/auto-beta', name: 'Auto Beta', created: 1, pricing: free }),
    ).toBeUndefined();
  });

  it('keeps openrouter/* stealth slots, labelled as stealth, with their description', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    const d = toDrop({
      id: 'openrouter/horizon-alpha',
      name: 'Horizon Alpha',
      created: 1_753_913_884,
      description: 'This is a cloaked model provided to the community to gather feedback.',
      pricing: { prompt: '0', completion: '0' },
      architecture: { modality: 'text+image->text', output_modalities: ['text'], tokenizer: 'Other' },
    })!;
    expect(d).toMatchObject({
      id: 'openrouter/horizon-alpha',
      name: 'Horizon Alpha',
      lab: 'Stealth',
      labId: undefined,
      stealth: true,
      free: true,
      description: 'This is a cloaked model provided to the community to gather feedback.',
      url: 'https://openrouter.ai/openrouter/horizon-alpha',
    });
  });

  it('takes the lab label from the "Vendor:" prefix, then the id prefix', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    expect(toDrop({ ...fable, id: 'xiaomi/mimo', name: 'Xiaomi: MiMo' })).toMatchObject({
      lab: 'Xiaomi',
      name: 'MiMo',
    });
    expect(toDrop({ ...fable, id: 'unbiased/pareto', name: 'Pareto' })).toMatchObject({
      lab: 'unbiased',
      name: 'Pareto',
    });
    expect(toDrop({ ...fable, id: 'x-ai/grok-4.7', name: 'SpaceXAI: Grok 4.7' })).toMatchObject({
      lab: 'xAI',
    });
  });

  it('maps canonical slug and output modalities, keeping descriptions for stealth slots only', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    const d = toDrop({
      ...fable,
      canonical_slug: 'anthropic/claude-fable-5.1-20260831',
      description: 'A model.',
    })!;
    expect(d).toMatchObject({
      canonicalSlug: 'anthropic/claude-fable-5.1-20260831',
      outputModalities: ['text'],
      textOutput: true,
      stealth: false,
      description: undefined,
    });
    const image = toDrop({ ...fable, architecture: { output_modalities: ['image', 'text'] } })!;
    expect(image).toMatchObject({ outputModalities: ['image', 'text'], textOutput: false });
    const bare = toDrop({ ...fable, architecture: undefined })!;
    expect(bare).toMatchObject({ outputModalities: undefined, textOutput: undefined });
    expect(toDrop({ ...fable, architecture: { output_modalities: [] } })?.textOutput).toBe(false);
  });

  it('encodes odd path segments in the URL', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    expect(toDrop({ ...fable, id: 'x/weird id?' })?.url).toBe('https://openrouter.ai/x/weird%20id%3F');
  });

  it('maps hugging_face_id, live 2026-09-26 on qwen/qwen3.8-flash', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    expect(
      toDrop({
        ...fable,
        id: 'qwen/qwen3.8-flash',
        name: 'Qwen: Qwen3.8 Flash',
        hugging_face_id: 'Qwen/Qwen3.8-Flash-Next',
      }),
    ).toMatchObject({ huggingFaceId: 'Qwen/Qwen3.8-Flash-Next' });
    expect(toDrop(fable)?.huggingFaceId).toBeUndefined();
    expect(toDrop({ ...fable, hugging_face_id: 42 as unknown as string })?.huggingFaceId).toBeUndefined();
  });
});

describe('fetchDrops', () => {
  it('returns listings newest first', async () => {
    mockUpstream({
      'https://openrouter.ai/api/v1/models': {
        data: [
          { ...fable, created: 10 },
          { ...fable, id: 'openai/gpt-6', name: 'OpenAI: GPT-6', created: 20 },
          { id: 'bad' },
        ],
      },
    });
    const { fetchDrops } = await import('../../src/adapters/openrouter');
    expect((await fetchDrops()).map((d) => d.id)).toEqual(['openai/gpt-6', 'anthropic/claude-fable-5.1']);
  });

  it('tolerates a body without data', async () => {
    mockUpstream({ 'https://openrouter.ai/api/v1/models': {} });
    const { fetchDrops } = await import('../../src/adapters/openrouter');
    expect(await fetchDrops()).toEqual([]);
  });
});

describe('live /models fixture (2026-09-26)', () => {
  const NOW = Date.parse('2026-09-26T00:11:29Z');

  it('keeps real listings and the stealth slot, and no router, alias or batch row', async () => {
    mockUpstream({ 'https://openrouter.ai/api/v1/models': live });
    const { fetchDrops } = await import('../../src/adapters/openrouter');
    const drops = await fetchDrops();
    const ids = drops.map((d) => d.id);
    expect(ids).toEqual([
      'stealth/space-bunny-alpha',
      'openai/gpt-6-luna-pro',
      'openai/gpt-6-luna',
      'openai/gpt-6-sol-pro',
      'openai/gpt-6-sol',
      'anthropic/claude-opus-5.5',
      'x-ai/grok-4.7',
      'unbiased/pareto',
      'openai/gpt-6-astra',
      'openai/gpt-6-astra-pro',
      'meta/muse-spark-1.3-contributor',
      'meta/muse-spark-1.3',
      'qwen/qwen3.8-27b',
      'qwen/qwen3.8-27b:free',
      'google/gemini-3.1-flash-image',
    ]);
    expect(drops.every((d) => (d.promptPerM ?? 0) >= 0 && (d.completionPerM ?? 0) >= 0)).toBe(true);
    expect(drops[0]).toMatchObject({ name: 'Space Bunny Alpha', lab: 'Stealth', stealth: true, free: true });
    expect(drops.find((d) => d.id === 'unbiased/pareto')?.lab).toBe('unbiased');
  });

  it('yields one GPT-6 Sol/Luna event, collapses the Qwen twin and skips the image model', async () => {
    mockUpstream({ 'https://openrouter.ai/api/v1/models': live });
    const { fetchDrops } = await import('../../src/adapters/openrouter');
    const events = releaseEvents(await fetchDrops(), NOW);
    expect(
      events.map((e) => `${e.firstListedAt} ${e.lab} ${e.frontier ? 'F' : '-'} ${e.models.length}`),
    ).toEqual([
      '2026-09-22T18:12:55.000Z OpenAI F 4',
      '2026-09-22T16:32:12.000Z Anthropic F 1',
      '2026-09-21T16:19:01.000Z xAI F 1',
      '2026-09-17T23:02:58.000Z unbiased - 1',
      '2026-09-04T20:13:55.000Z OpenAI F 2',
      '2026-09-02T19:45:59.000Z Meta F 2',
      '2026-08-14T15:55:10.000Z Alibaba Qwen F 1',
    ]);
    expect(events.find((e) => e.labId === 'qwen')?.models.map((m) => m.id)).toEqual(['qwen/qwen3.8-27b']);
  });

  it('finds Space Bunny Alpha as the one live stealth slot', async () => {
    mockUpstream({ 'https://openrouter.ai/api/v1/models': live });
    const { fetchDrops } = await import('../../src/adapters/openrouter');
    const slots = stealthSlots(await fetchDrops(), NOW);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      id: 'stealth/space-bunny-alpha',
      createdAt: '2026-09-23T14:48:04.000Z',
      contextLength: 1_000_000,
      claimsFrontier: false,
    });
    expect(slots[0].daysInStealth).toBeCloseTo(2.39, 2);
  });
});
