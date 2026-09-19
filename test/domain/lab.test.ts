import { describe, expect, it } from 'vitest';
import {
  FRONTIER_LABS,
  LABS,
  X_WATCHLIST,
  labById,
  labForOpenRouterId,
  labForTitle,
} from '../../src/domain/lab';

describe('lab registry', () => {
  it('has unique ids, prefixes and companies', () => {
    const ids = LABS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prefixes = LABS.flatMap((l) => l.openRouterPrefixes);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    const companies = LABS.map((l) => l.polymarketCompany);
    expect(new Set(companies).size).toBe(companies.length);
  });

  it('every frontier lab exists in the registry', () => {
    for (const id of FRONTIER_LABS) expect(labById(id)).toBeDefined();
  });

  it('maps OpenRouter ids by vendor prefix, ignoring alias tildes', () => {
    expect(labForOpenRouterId('anthropic/claude-fable-5.1')?.id).toBe('anthropic');
    expect(labForOpenRouterId('~openai/gpt-latest')?.id).toBe('openai');
    expect(labForOpenRouterId('meta-llama/llama-4')?.id).toBe('meta');
    expect(labForOpenRouterId('x-ai/grok-5')?.id).toBe('xai');
    expect(labForOpenRouterId('unknown/model')).toBeUndefined();
  });

  it('maps Polymarket titles to labs, most specific words first', () => {
    expect(labForTitle('Next Claude Opus released by...?')?.id).toBe('anthropic');
    expect(labForTitle('Claude Fable 5.2 released by...?')?.id).toBe('anthropic');
    expect(labForTitle('Gemini 3.5 released by...?')?.id).toBe('google');
    expect(labForTitle('Grok 5 released by...?')?.id).toBe('xai');
    expect(labForTitle('DeepSeek V4 released by...?')?.id).toBe('deepseek');
    expect(labForTitle('Qwen 4 released by...?')?.id).toBe('qwen');
    expect(labForTitle('Will it rain in London?')).toBeUndefined();
  });

  it('labById tolerates undefined', () => {
    expect(labById(undefined)).toBeUndefined();
    expect(labById('openai')?.short).toBe('OAI');
  });

  it('watchlist handles are unique and plausible X handles', () => {
    const handles = X_WATCHLIST.map((w) => w.handle);
    expect(new Set(handles).size).toBe(handles.length);
    for (const h of handles) expect(h).toMatch(/^[A-Za-z0-9_]{1,15}$/);
  });
});
