import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterModelDto } from '../../src/adapters/openrouter';
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

  it('encodes odd path segments in the URL', async () => {
    const { toDrop } = await import('../../src/adapters/openrouter');
    expect(toDrop({ ...fable, id: 'x/weird id?' })?.url).toBe('https://openrouter.ai/x/weird%20id%3F');
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
