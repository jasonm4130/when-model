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

// Verbatim lines of the live `models/__init__.py` (raw.githubusercontent.com and jsdelivr both
// 200 16777 bytes, identical, 2026-09-26), trimmed to the header, four imports and the else branch.
const LIVE_INIT_PY = `# limitations under the License.
from typing import TYPE_CHECKING

from ..utils import _LazyModule
from ..utils.import_utils import define_import_structure


if TYPE_CHECKING:
    from .qwen3_vl_moe import *
    from .qwen4_exp import *
    from .radio import *
    from .zoedepth import *
else:
    import sys

    _file = globals()["__file__"]
    sys.modules[__name__] = _LazyModule(__name__, _file, define_import_structure(_file), module_spec=__spec__)
`;

describe('parseModuleNames', () => {
  it('reads indented "from .X import *" lines and ignores comments', async () => {
    const { parseModuleNames } = await import('../../src/adapters/transformers-arch');
    expect(parseModuleNames(INIT_PY)).toEqual(['albert', 'qwen3', 'qwen4_exp', 'glm5_next']);
  });

  it('reads only the module imports from the live file layout', async () => {
    const { parseModuleNames } = await import('../../src/adapters/transformers-arch');
    expect(parseModuleNames(LIVE_INIT_PY)).toEqual(['qwen3_vl_moe', 'qwen4_exp', 'radio', 'zoedepth']);
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

  it('treats a 200 with no module imports as a failure and falls back', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = mockUpstream({ [PRIMARY]: '<html>429 Too Many Requests</html>', [FALLBACK]: LIVE_INIT_PY });
    const { fetchTransformersModules } = await import('../../src/adapters/transformers-arch');
    expect(await fetchTransformersModules()).toEqual(['qwen3_vl_moe', 'qwen4_exp', 'radio', 'zoedepth']);
    expect(calls).toEqual([PRIMARY, FALLBACK]);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('throws rather than reporting zero modules when neither body is the registry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpstream({ [PRIMARY]: '', [FALLBACK]: '<html>error</html>' });
    const { fetchTransformersModules } = await import('../../src/adapters/transformers-arch');
    await expect(fetchTransformersModules()).rejects.toThrow(/no "from \.X import \*" lines/);
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
    expect(re.test('Qwen 40B')).toBe(false);
    expect(re.test('ColQwen4')).toBe(false);
  });

  // Real modules from the live registry against real OpenRouter listing names (2026-09-26
  // `/api/v1/models`): the names that existed before each module shipped must not clear it, and the
  // name it actually shipped under must. qwen3_5 (+6.9d) and qwen3_next (+2.4d) are report T1-4 leads.
  it.each([
    ['qwen3_5', ['Qwen: Qwen3 235B A22B', 'Qwen: Qwen3 Next 80B A3B Instruct'], 'Qwen: Qwen3.5 397B A17B'],
    ['qwen3_5_moe', ['Qwen: Qwen3 235B A22B', 'Qwen: Qwen3 30B A3B'], 'Qwen: Qwen3.5-35B-A3B'],
    [
      'qwen3_next',
      ['Qwen: Qwen3 235B A22B', 'Qwen: Qwen3 Coder 480B A35B'],
      'Qwen: Qwen3 Next 80B A3B Instruct',
    ],
    ['qwen3_vl_moe', ['Qwen: Qwen3 235B A22B'], 'Qwen: Qwen3 VL 235B A22B Instruct'],
    // Nothing named Qwen4 exists yet; the shipped name here is the one hypothetical row.
    ['qwen4_exp', ['Qwen: Qwen3.8 Max Prime', 'Qwen: Qwen3.8 2.4T A95B'], 'Qwen: Qwen4 72B'],
    ['gemma4', ['Google: Gemma 3 27B', 'Google: Gemma 3 4B'], 'Google: Gemma 4 31B'],
    [
      'deepseek_v4',
      ['DeepSeek: DeepSeek V3.2', 'DeepSeek: DeepSeek V3 0324'],
      'DeepSeek: DeepSeek V4 Pro 0423',
    ],
    ['deepseek_v32', ['DeepSeek: DeepSeek V3.1', 'DeepSeek: DeepSeek V3'], 'DeepSeek: DeepSeek V3.2 Exp'],
    ['kimi_k25', ['MoonshotAI: Kimi K2 Thinking', 'MoonshotAI: Kimi K2 0905'], 'MoonshotAI: Kimi K2.5'],
    ['gpt_oss', ['OpenAI: GPT-4o'], 'OpenAI: gpt-oss-120b'],
    ['ministral3', ['Mistral: Mistral Small 3.1 24B'], 'Mistral: Ministral 3 14B 2512'],
    [
      'mistral4',
      ['Mistral: Mistral Small 3.2 24B', 'Mistral: Mistral Large 3 2512'],
      'Mistral: Mistral Small 4',
    ],
  ])(
    '%s stays pending on earlier names and clears on the name it shipped as',
    async (module, before, shipped) => {
      const { familyRegex } = await import('../../src/adapters/transformers-arch');
      const re = familyRegex(module);
      expect(before.filter((name) => re.test(name))).toEqual([]);
      expect(re.test(shipped)).toBe(true);
    },
  );
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

// Moved from test/domain/lead.test.ts with the fetcher itself (domain/lead.ts is pure now).
describe('fetchArchitectures', () => {
  it('detects a live novel module beyond BASELINE and backdates the seeded one via PENDING_SEED', async () => {
    const { BASELINE } = await import('../../src/adapters/transformers-arch');
    const lines = BASELINE.map((m) => `    from .${m} import *`).join('\n');
    vi.resetModules();
    mockUpstream({
      [PRIMARY]: `if TYPE_CHECKING:\n${lines}\n    from .qwen_test_variant import *\n`,
    });
    const now = new Date('2026-09-26T12:03:40Z'); // exactly 31 days after the seed's verified mergedAt
    const { fetchArchitectures } = await import('../../src/adapters/transformers-arch');
    const out = await fetchArchitectures([], now);

    expect(out.find((a) => a.module === 'qwen_test_variant')).toMatchObject({
      labId: 'qwen',
      since: now.toISOString(),
      sinceSource: 'detected',
      daysPending: 0,
      pending: true,
    });
    expect(out.find((a) => a.module === 'qwen4_exp')).toMatchObject({
      labId: 'qwen',
      since: '2026-08-26T12:03:40Z',
      sinceSource: 'seed',
      daysPending: 31,
      pending: true,
    });
  });

  it('clears a listed module and passes firstSeen through', async () => {
    const { BASELINE } = await import('../../src/adapters/transformers-arch');
    const lines = BASELINE.map((m) => `    from .${m} import *`).join('\n');
    vi.resetModules();
    mockUpstream({ [PRIMARY]: `if TYPE_CHECKING:\n${lines}\n` });
    const { fetchArchitectures } = await import('../../src/adapters/transformers-arch');
    const now = new Date('2026-09-26T12:03:40Z');
    const out = await fetchArchitectures([{ id: 'qwen/qwen4-72b', name: 'Qwen4 72B' }], now);
    expect(out.find((a) => a.module === 'qwen4_exp')?.pending).toBe(false);
  });
});
