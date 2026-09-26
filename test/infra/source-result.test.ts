import { afterEach, describe, expect, it, vi } from 'vitest';
import { collect } from '../../src/infra/source-result';

describe('collect', () => {
  afterEach(() => vi.restoreAllMocks());

  it('wraps a success', async () => {
    expect(await collect('A', async () => [1], [])).toEqual({
      name: 'A',
      data: [1],
      ok: true,
      ms: expect.any(Number),
    });
  });

  it('times the source by wall clock, for the build log', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_250);
    expect((await collect('T', async () => 1, 0)).ms).toBe(250);
  });

  it('degrades to the fallback on failure and logs once', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await collect(
      'B',
      async () => {
        throw new Error('nope');
      },
      ['fallback'],
    );
    expect(r).toEqual({ name: 'B', data: ['fallback'], ok: false, error: 'nope', ms: expect.any(Number) });
    expect(err).toHaveBeenCalledWith('[source:B]', 'nope');
  });

  it('stringifies non-Error throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await collect('C', async () => Promise.reject('raw'), 0);
    expect(r.error).toBe('raw');
  });

  it('times out slow sources', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await collect('D', () => new Promise<number>(() => {}), -1, 5);
    expect(r).toEqual({ name: 'D', data: -1, ok: false, error: 'timeout', ms: expect.any(Number) });
  });
});
