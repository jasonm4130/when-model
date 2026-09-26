import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from './mock-cache';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

const PRIMARY =
  'https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/__init__.py';
const FALLBACK =
  'https://cdn.jsdelivr.net/gh/huggingface/transformers@main/src/transformers/models/__init__.py';

const INIT_PY = `if TYPE_CHECKING:
    from .albert import *
    from .qwen3 import *
    from .qwen4_exp import *
    # from .commented_out import * (not a real import)
    from .glm5_next import *
else:
    pass
`;

describe('parseModuleNames', () => {
  it('reads indented "from .X import *" lines and ignores comments', async () => {
    const { parseModuleNames } = await import('../../src/adapters/transformers-arch');
    expect(parseModuleNames(INIT_PY)).toEqual(['albert', 'qwen3', 'qwen4_exp', 'glm5_next']);
  });

  it('finds nothing in a file with no matching imports', async () => {
    const { parseModuleNames } = await import('../../src/adapters/transformers-arch');
    expect(parseModuleNames('from typing import TYPE_CHECKING\n')).toEqual([]);
  });
});

describe('fetchTransformersModules', () => {
  it('uses the primary URL when it succeeds', async () => {
    const calls = mockUpstream({ [PRIMARY]: INIT_PY });
    const { fetchTransformersModules } = await import('../../src/adapters/transformers-arch');
    expect(await fetchTransformersModules()).toEqual(['albert', 'qwen3', 'qwen4_exp', 'glm5_next']);
    expect(calls).toEqual([PRIMARY]);
  });

  it('falls back to jsdelivr when the primary fetch fails, logging the failure', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpstream({ [FALLBACK]: INIT_PY });
    const { fetchTransformersModules } = await import('../../src/adapters/transformers-arch');
    expect(await fetchTransformersModules()).toEqual(['albert', 'qwen3', 'qwen4_exp', 'glm5_next']);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('throws when both the primary and the fallback fail', async () => {
    mockUpstream({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fetchTransformersModules } = await import('../../src/adapters/transformers-arch');
    await expect(fetchTransformersModules()).rejects.toThrow();
  });
});

describe('labIdForModule', () => {
  it('maps every documented prefix to its lab', async () => {
    const { labIdForModule } = await import('../../src/adapters/transformers-arch');
    expect(labIdForModule('qwen4_exp')).toBe('qwen');
    expect(labIdForModule('glm5_next')).toBe('zai');
    expect(labIdForModule('deepseek_v4')).toBe('deepseek');
    expect(labIdForModule('gemma4')).toBe('google');
    expect(labIdForModule('llama4')).toBe('meta');
    expect(labIdForModule('mistral4')).toBe('mistral');
    expect(labIdForModule('ministral3')).toBe('mistral');
    expect(labIdForModule('kimi_k25')).toBe('moonshot');
    expect(labIdForModule('gpt_oss')).toBe('openai');
    expect(labIdForModule('grok5')).toBe('xai');
  });

  it('returns undefined for a module with no tracked lab', async () => {
    const { labIdForModule } = await import('../../src/adapters/transformers-arch');
    expect(labIdForModule('albert')).toBeUndefined();
  });
});

describe('familyRegex', () => {
  it("matches the report's own example: qwen4_exp -> /qwen[ -]?4/i", async () => {
    const { familyRegex } = await import('../../src/adapters/transformers-arch');
    const re = familyRegex('qwen4_exp');
    expect(re.test('Qwen4')).toBe(true);
    expect(re.test('Qwen 4')).toBe(true);
    expect(re.test('Qwen-4-Turbo')).toBe(true);
    expect(re.test('Qwen3')).toBe(false);
  });
});

describe('pendingArchitectures', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const baseline = ['albert', 'qwen3', 'qwen4_exp'];
  // Round timestamps here so daysPending comes out exact; the real evidence (with its odd
  // seconds) lives in the actual exported PENDING_SEED, checked separately below.
  const seed = [
    {
      module: 'qwen4_exp',
      mergedAt: '2026-08-26T12:00:00Z',
      pr: 48337,
      source: 'https://github.com/huggingface/transformers/pull/48337',
    },
  ];

  it('backdates a seeded module even though it is already in the baseline', async () => {
    const { pendingArchitectures } = await import('../../src/adapters/transformers-arch');
    const out = pendingArchitectures(baseline, baseline, seed, [], now);
    expect(out).toEqual([
      {
        module: 'qwen4_exp',
        labId: 'qwen',
        since: '2026-08-26T12:00:00Z',
        sinceSource: 'seed',
        daysPending: 31,
        pending: true,
      },
    ]);
  });

  it('clears pending once a listing name matches the family', async () => {
    const { pendingArchitectures } = await import('../../src/adapters/transformers-arch');
    const out = pendingArchitectures(
      baseline,
      baseline,
      seed,
      [{ id: 'qwen/qwen4-72b', name: 'Qwen4 72B' }],
      now,
    );
    expect(out[0].pending).toBe(false);
  });

  it('marks a novel module (beyond baseline, no seed) as detected now with daysPending 0', async () => {
    const { pendingArchitectures } = await import('../../src/adapters/transformers-arch');
    const modules = [...baseline, 'glm5_next'];
    const out = pendingArchitectures(modules, baseline, [], [], now);
    expect(out).toEqual([
      {
        module: 'glm5_next',
        labId: 'zai',
        since: now.toISOString(),
        sinceSource: 'detected',
        daysPending: 0,
        pending: true,
      },
    ]);
  });

  it('uses firstSeen for a novel module once it has been recorded', async () => {
    const { pendingArchitectures } = await import('../../src/adapters/transformers-arch');
    const modules = [...baseline, 'glm5_next'];
    const firstSeen = new Map([['glm5_next', '2026-09-20T12:00:00Z']]);
    const out = pendingArchitectures(modules, baseline, [], [], now, firstSeen);
    expect(out[0]).toMatchObject({
      since: '2026-09-20T12:00:00Z',
      sinceSource: 'first-seen',
      daysPending: 6,
    });
  });

  it('ignores a baseline module with no seed entry and no novelty', async () => {
    const { pendingArchitectures } = await import('../../src/adapters/transformers-arch');
    expect(pendingArchitectures(baseline, baseline, [], [], now)).toEqual([]);
  });

  it('drops a tracked module with no lab mapping', async () => {
    const { pendingArchitectures } = await import('../../src/adapters/transformers-arch');
    const modules = [...baseline, 'some_unmapped_arch'];
    expect(pendingArchitectures(modules, baseline, [], [], now)).toEqual([]);
  });
});

describe('BASELINE and PENDING_SEED', () => {
  it('BASELINE is the live 2026-09-26 module list and contains qwen4_exp', async () => {
    const { BASELINE } = await import('../../src/adapters/transformers-arch');
    expect(BASELINE).toHaveLength(519);
    expect(BASELINE).toContain('qwen4_exp');
    expect(new Set(BASELINE).size).toBe(BASELINE.length);
  });

  it('PENDING_SEED carries the GitHub-API-verified qwen4_exp merge', async () => {
    const { PENDING_SEED } = await import('../../src/adapters/transformers-arch');
    expect(PENDING_SEED).toEqual([
      {
        module: 'qwen4_exp',
        mergedAt: '2026-08-26T12:03:40Z',
        pr: 48337,
        source: 'https://github.com/huggingface/transformers/pull/48337',
      },
    ]);
  });
});
