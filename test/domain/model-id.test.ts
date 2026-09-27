import { describe, expect, it } from 'vitest';
import { canonicalModel, satisfies, skuBase, type ModelHint } from '../../src/domain/model-id';

const openrouter: ModelHint = { source: 'openrouter' };
const hf: ModelHint = { source: 'huggingface' };
const qwenChat: ModelHint = { source: 'id', labId: 'qwen' };
const qwenTitle: ModelHint = { source: 'title', labId: 'qwen' };

describe('canonicalModel: one sku per model across sources (the design examples)', () => {
  it.each<[string, string, ModelHint, string]>([
    ['OpenRouter', 'qwen/qwen3.8-max-prime', openrouter, 'qwen3.8-max-prime'],
    ['chat.qwen.ai', 'qwen3.8-max-prime', { ...qwenChat, name: 'Qwen3.8-Max-Prime' }, 'qwen3.8-max-prime'],
    ['Hugging Face', 'Qwen/Qwen3.8-Max-Prime', hf, 'qwen3.8-max-prime'],
    ['a launch title', 'Introducing Qwen3.8-Max-Prime', qwenTitle, 'qwen3.8-max-prime'],
    ['an HF quant repo', 'Qwen/Qwen3.8-27B-Instruct-FP8', hf, 'qwen3.8-27b'],
    ['its OpenRouter listing', 'qwen/qwen3.8-27b', openrouter, 'qwen3.8-27b'],
    ['an active-parameter suffix', 'qwen/qwen3.8-2.4t-a95b', openrouter, 'qwen3.8-2.4t'],
    ['OpenRouter :free', 'qwen/qwen3.8-27b:free', openrouter, 'qwen3.8-27b'],
    ['OpenRouter :batch', 'qwen/qwen3.8-27b:batch', openrouter, 'qwen3.8-27b'],
    ['OpenRouter :thinking', 'qwen/qwen3.8-27b:thinking', openrouter, 'qwen3.8-27b'],
  ])('%s: %s → qwen:%s', (_, raw, hint, sku) => {
    expect(canonicalModel(raw, hint)).toMatchObject({ labId: 'qwen', sku, base: sku });
  });

  it('pulls a trailing date into the snapshot, in every spelling', () => {
    expect(canonicalModel('qwen/qwen3.5-plus-20260420', openrouter)).toMatchObject({
      labId: 'qwen',
      sku: 'qwen3.5-plus@20260420',
      base: 'qwen3.5-plus',
      snapshot: '20260420',
      version: '3.5',
    });
    expect(canonicalModel('deepseek/deepseek-v4-flash-0731', openrouter)).toMatchObject({
      labId: 'deepseek',
      sku: 'deepseek-v4-flash@0731',
      base: 'deepseek-v4-flash',
      snapshot: '0731',
    });
    expect(canonicalModel('gpt-5.5-2026-04-23', { source: 'id', labId: 'openai' })).toMatchObject({
      sku: 'gpt-5.5@2026-04-23',
      base: 'gpt-5.5',
    });
    expect(canonicalModel('mistral-large-2.1_09-2026', { source: 'id', labId: 'mistral' })).toMatchObject({
      snapshot: '09-2026',
    });
  });

  it('spells every Claude one way: a docs snapshot, the OpenRouter alias and a bare title share a base', () => {
    const docs = canonicalModel('claude-opus-5-5-20260922', { source: 'id', labId: 'anthropic' });
    expect(docs).toMatchObject({
      labId: 'anthropic',
      sku: 'claude-opus-5.5@20260922',
      base: 'claude-opus-5.5',
      family: 'claude',
    });
    expect(canonicalModel('anthropic/claude-opus-5.5', openrouter)).toMatchObject({ sku: 'claude-opus-5.5' });
    expect(canonicalModel('Opus 5.5', { source: 'title', labId: 'anthropic' })).toMatchObject({
      labId: 'anthropic',
      sku: 'claude-opus-5.5',
    });
    expect(canonicalModel('anthropic/claude-4.5-sonnet', openrouter)).toMatchObject({
      sku: 'claude-sonnet-4.5',
    });
  });

  it('keeps a tier word the grammar stops at as the variant, outside the sku', () => {
    const contributor = canonicalModel('meta/muse-spark-1.2-contributor', openrouter);
    expect(contributor).toMatchObject({ labId: 'meta', sku: 'muse-spark-1.2', variant: 'contributor' });
    expect(canonicalModel('meta/muse-spark-1.2', openrouter)).not.toHaveProperty('variant');
    // Suffixes that are not tier words are simply dropped.
    expect(canonicalModel('Qwen/Qwen3.8-27B-Instruct-FP8', hf)).not.toHaveProperty('variant');
  });

  it('falls back to the stripped slug, tagged unversioned, for an id with no version', () => {
    expect(canonicalModel('openai/gpt-chat-latest', openrouter)).toEqual({
      labId: 'openai',
      sku: 'gpt-chat-latest',
      base: 'gpt-chat-latest',
      family: 'gpt',
      unversioned: true,
    });
    expect(canonicalModel('x-ai/grok-build-0.1', openrouter)).toMatchObject({
      labId: 'xai',
      unversioned: true,
    });
  });

  it('reads the display name when the id carries no versioned model', () => {
    expect(
      canonicalModel('deepseek/deepseek-chat', { source: 'openrouter', name: 'DeepSeek: DeepSeek V3.1' }),
    ).toMatchObject({ labId: 'deepseek', sku: 'deepseek-v3.1', version: '3.1' });
  });

  it('places a title by its model first, then by the feed that carried it', () => {
    // A Qwen model in another lab's feed is still Qwen's.
    expect(canonicalModel('Qwen3.8-Max now on Vertex', { source: 'title', labId: 'google' })).toMatchObject({
      labId: 'qwen',
    });
    expect(canonicalModel('Welcome to our new office', qwenTitle)).toBeUndefined();
  });

  it('falls back to the model name for a bare id with no lab hint', () => {
    expect(canonicalModel('gpt-6-sol', { source: 'id' })).toMatchObject({
      labId: 'openai',
      sku: 'gpt-6-sol',
    });
  });

  it('needs the model at the start of a bare id', () => {
    // DeepSeek's draft model for Gemma is not a Gemma release.
    expect(canonicalModel('deepseek-ai/eagle3-gemma4-12b', hf)).toMatchObject({
      labId: 'deepseek',
      unversioned: true,
    });
  });

  it.each([
    ['an image model', 'Qwen/Qwen-Image-2.1', hf],
    ['a TTS repo', 'Qwen/Qwen3-TTS-1.7B', hf],
    ['an embedding repo', 'Qwen/Qwen3-Embedding-8B', hf],
    ['a video generator', 'google/veo-4', openrouter],
    ['an unknown lab', 'nvidia/nemotron-5', openrouter],
    ['a community HF quant', 'someone/Qwen3.8-27B-GGUF', hf],
    ['a third-party fine-tune', 'nvidia/llama-3.1-nemotron-70b-instruct', openrouter],
    ['an empty id', '  ', qwenChat],
  ])('drops %s', (_, raw, hint) => {
    expect(canonicalModel(raw, hint)).toBeUndefined();
  });
});

describe('skuBase / satisfies', () => {
  it('strips the snapshot', () => {
    expect(skuBase('qwen3.5-plus@20260420')).toBe('qwen3.5-plus');
    expect(skuBase('gpt-6')).toBe('gpt-6');
  });

  it('matches an announcement to the same model or its line, by whole tokens', () => {
    expect(satisfies('gpt-6', 'gpt-6')).toBe(true);
    expect(satisfies('gpt-6', 'gpt-6-sol')).toBe(true);
    expect(satisfies('gpt-6', 'gpt-6@2026-09-30')).toBe(true);
    expect(satisfies('gpt-6', 'gpt-6.5')).toBe(false);
    expect(satisfies('gpt-6-sol', 'gpt-6')).toBe(false);
  });
});
