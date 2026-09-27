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

  it('folds a Contributor into its Muse Spark, as the variant outside the sku', () => {
    const contributor = canonicalModel('meta/muse-spark-1.2-contributor', openrouter);
    expect(contributor).toMatchObject({ labId: 'meta', sku: 'muse-spark-1.2', variant: 'contributor' });
    expect(canonicalModel('meta/muse-spark-1.2', openrouter)).not.toHaveProperty('variant');
    // Packaging words end the sku and are not a variant.
    expect(canonicalModel('Qwen/Qwen3.8-27B-Instruct-FP8', hf)).not.toHaveProperty('variant');
  });

  // Live ids the grammar stops short of: each is a model of its own, so its words past the grammar
  // stay in the sku, and a later release never folds into an earlier model's row.
  it.each<[string, string, string, ModelHint]>([
    ['qwen/qwen3-235b-a22b', 'qwen', 'qwen3-235b', openrouter],
    ['qwen/qwen3-235b-a22b-2507', 'qwen', 'qwen3-235b@2507', openrouter],
    ['qwen/qwen3-235b-a22b-thinking-2507', 'qwen', 'qwen3-235b-thinking@2507', openrouter],
    ['qwen/qwen3-30b-a3b-instruct-2507', 'qwen', 'qwen3-30b@2507', openrouter],
    ['Qwen/Qwen3-30B-A3B-Thinking-2507-FP8', 'qwen', 'qwen3-30b-thinking@2507', hf],
    ['Qwen/Qwen3.8-27B-Instruct-2610', 'qwen', 'qwen3.8-27b@2610', hf],
    ['qwen/qwen3.8-35b-a3b', 'qwen', 'qwen3.8-35b', openrouter],
    ['qwen/qwen3.8-35b-a3b-thinking', 'qwen', 'qwen3.8-35b-thinking', openrouter],
    ['Qwen/Qwen3.8-VL-27B-Instruct', 'qwen', 'qwen3.8-vl-27b', hf],
    ['qwen/qwen3-vl-235b-a22b-instruct', 'qwen', 'qwen3-vl-235b', openrouter],
    ['Qwen/Qwen3-VL-8B-Instruct', 'qwen', 'qwen3-vl-8b', hf],
    ['qwen/qwen2.5-vl-72b-instruct', 'qwen', 'qwen2.5-vl-72b', openrouter],
    ['qwen/qwen3.5-flash-02-23', 'qwen', 'qwen3.5-flash@02-23', openrouter],
    ['deepseek/deepseek-v3.1-terminus', 'deepseek', 'deepseek-v3.1-terminus', openrouter],
    ['deepseek-ai/DeepSeek-V2-Chat-0628', 'deepseek', 'deepseek-v2-chat@0628', hf],
    ['deepseek/deepseek-r1-distill-llama-70b', 'deepseek', 'deepseek-r1-distill-llama-70b', openrouter],
    ['google/gemini-3.1-pro-preview-customtools', 'google', 'gemini-3.1-pro-preview-customtools', openrouter],
    ['google/gemma-4-E4B-it-qat-q4_0-unquantized', 'google', 'gemma-4-e4b', hf],
    ['openai/gpt-5.2-chat', 'openai', 'gpt-5.2-chat', openrouter],
    ['meta-llama/llama-4-maverick', 'meta', 'llama-4-maverick', openrouter],
    ['meta-llama/Llama-3.2-3B-Instruct-SpinQuant_INT4_EO8', 'meta', 'llama-3.2-3b', hf],
    ['z-ai/glm-5.3-flashx', 'zai', 'glm-5.3-flashx', openrouter],
    ['moonshotai/kimi-k2.7-code', 'moonshot', 'kimi-k2.7-code', openrouter],
    ['mistralai/mistral-medium-3-5', 'mistral', 'mistral-medium-3.5', openrouter],
    ['mistralai/mistral-medium-3', 'mistral', 'mistral-medium-3', openrouter],
  ])('keeps the model words past the grammar: %s → %s:%s', (raw, labId, sku, hint) => {
    expect(canonicalModel(raw, hint)).toMatchObject({ labId, sku });
  });

  it('reads the display name past its model, without OpenRouter’s "(free)"', () => {
    // The o-series grammar stops at `o3-mini-high`, so the name places it: never as o3 itself.
    expect(
      canonicalModel('openai/o3-mini-high', { source: 'openrouter', name: 'OpenAI: o3 Mini High' }),
    ).toMatchObject({ labId: 'openai', sku: 'o3-mini-high' });
    expect(
      canonicalModel('openai/o4-mini-high', { source: 'openrouter', name: 'OpenAI: o4 Mini High (free)' }),
    ).toMatchObject({ sku: 'o4-mini-high' });
    expect(canonicalModel('openai/o3-mini', openrouter)).toMatchObject({ sku: 'o3-mini' });
  });

  it('reads a hyphenated point version, and a lab docs id with it', () => {
    expect(canonicalModel('claude-3-5-haiku-20241022', { source: 'id', labId: 'anthropic' })).toMatchObject({
      sku: 'claude-haiku-3.5@20241022',
      version: '3.5',
    });
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
    ['an image generator (any-to-any on the Hub)', 'deepseek-ai/Janus-Pro-7B', hf],
    ['its flow-matching twin', 'deepseek-ai/JanusFlow-1.3B', hf],
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

  it('needs an announced snapshot itself: the base that shipped months before is not it', () => {
    expect(satisfies('deepseek-v4-flash@1015', 'deepseek-v4-flash')).toBe(false);
    expect(satisfies('deepseek-v4-flash@1015', 'deepseek-v4-flash@0731')).toBe(false);
    expect(satisfies('deepseek-v4-flash@1015', 'deepseek-v4-flash@1015')).toBe(true);
    // One date, spelled by a title and by a listing.
    expect(satisfies('qwen3.5-plus@0420', 'qwen3.5-plus@20260420')).toBe(true);
    expect(satisfies('gemini-3-flash@06-17', 'gemini-3-flash@0617')).toBe(true);
    expect(satisfies('qwen3.5-plus@0420', 'qwen3.5-plus@20260421')).toBe(false);
  });

  it('lets a preview be satisfied by its line: the models it launched carry no "preview"', () => {
    const title = canonicalModel('DeepSeek-V4 Preview Release', { source: 'title', labId: 'deepseek' });
    expect(title?.sku).toBe('deepseek-v4-preview');
    expect(satisfies('deepseek-v4-preview', 'deepseek-v4-flash')).toBe(true);
    expect(satisfies('deepseek-v4-preview', 'deepseek-v4-pro')).toBe(true);
    expect(satisfies('gemini-3-pro-preview', 'gemini-3-pro-preview')).toBe(true);
    expect(satisfies('gemini-3-pro-preview', 'gemini-3-pro')).toBe(true);
    expect(satisfies('deepseek-v4-preview', 'deepseek-v4.1-flash')).toBe(false);
  });
});
