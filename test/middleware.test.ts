import { describe, expect, it } from 'vitest';
import { onRequest } from '../src/middleware';

describe('security headers', () => {
  it('sets a strict CSP and the usual hardening headers on every response', async () => {
    const res = await (
      onRequest as unknown as (ctx: unknown, next: () => Promise<Response>) => Promise<Response>
    )(
      { request: new Request('https://whenmodel.com/') },
      async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    );
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('https://app.skopia.dev');
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toBeTruthy();
    expect(await res.text()).toBe('<html></html>');
  });
});
