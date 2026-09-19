import { afterEach, describe, expect, it, vi } from 'vitest';
import { collect } from '../../src/infra/source-result';

describe('collect', () => {
  afterEach(() => vi.restoreAllMocks());

  it('wraps a success', async () => {
    expect(await collect('A', async () => [1], [])).toEqual({ name: 'A', data: [1], ok: true });
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
    expect(r).toEqual({ name: 'B', data: ['fallback'], ok: false, error: 'nope' });
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
    expect(r).toEqual({ name: 'D', data: -1, ok: false, error: 'timeout' });
  });
});
