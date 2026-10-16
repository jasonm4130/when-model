import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QWEN_CHAT_MODELS_URL,
  fetchQwenChatModels,
  isQwenChatBody,
  toChatModel,
} from '../../src/adapters/qwen-chat';
import { fixture } from '../fixtures/read';

const body = fixture('qwen-chat-models.json');

afterEach(() => vi.unstubAllGlobals());

/** Serve `text` for the models URL through the real edge cache (no Cache API in Node). */
function serve(text: string, status = 200, type = 'application/json') {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(text, { status, headers: { 'content-type': type } });
  });
  return calls;
}

describe('qwen chat mapper', () => {
  it('maps a model, keeping is_visitor_active only when the list says', () => {
    expect(
      toChatModel({
        id: 'qwen3.8-max',
        name: 'Qwen3.8-Max',
        info: { is_active: true, is_visitor_active: false },
      }),
    ).toEqual({
      id: 'qwen3.8-max',
      name: 'Qwen3.8-Max',
      active: true,
      visitorActive: false,
    });
    expect(toChatModel({ id: 'qwen4-max', info: {} })).toEqual({
      id: 'qwen4-max',
      name: 'qwen4-max',
      active: false,
    });
    expect(toChatModel({ name: 'No id' })).toBeUndefined();
    expect(toChatModel({ id: '' })).toBeUndefined();
  });

  it('accepts only a JSON body with a non-empty data.data', () => {
    expect(isQwenChatBody(body)).toBe(true);
    expect(isQwenChatBody('<!doctype html><title>Sign in</title>')).toBe(false);
    expect(isQwenChatBody('{"success":false,"data":{"data":[{"id":"x"}]}}')).toBe(false);
    expect(isQwenChatBody('{"success":true,"data":{"data":[]}}')).toBe(false);
    expect(isQwenChatBody('{"success":true}')).toBe(false);
    expect(isQwenChatBody('null')).toBe(false);
    expect(isQwenChatBody('not json')).toBe(false);
  });
});

describe('fetchQwenChatModels', () => {
  it('reads every listed model from the captured list', async () => {
    const calls = serve(body);
    expect(await fetchQwenChatModels()).toEqual([
      { id: 'qwen3.7-plus', name: 'Qwen3.7-Plus', active: true, visitorActive: true },
      { id: 'qwen3.8-max', name: 'Qwen3.8-Max', active: true, visitorActive: true },
      { id: 'qwen3.8-omni-flash', name: 'Qwen3.8-Omni-Flash', active: true, visitorActive: false },
    ]);
    expect(calls).toEqual([QWEN_CHAT_MODELS_URL]);
  });

  it.each([
    ['a login page', '<!doctype html><html><body>Sign in</body></html>'],
    ['success: false', '{"success":false,"data":{"data":[{"id":"qwen3.8-max"}]}}'],
    ['an empty list', '{"success":true,"data":{"data":[]}}'],
  ])('throws on %s, so the source reads down instead of seeding nothing', async (_, text) => {
    serve(text);
    await expect(fetchQwenChatModels()).rejects.toThrow('failed validation');
  });

  it('throws on a non-2xx', async () => {
    serve('rate limited', 429, 'text/plain');
    await expect(fetchQwenChatModels()).rejects.toThrow(`429 ${QWEN_CHAT_MODELS_URL}`);
  });
});
