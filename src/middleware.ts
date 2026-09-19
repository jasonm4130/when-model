import { defineMiddleware } from 'astro:middleware';

/**
 * Security headers for every response the Worker renders. Static assets under /_astro get
 * theirs from the adapter-generated _headers file.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://app.skopia.dev https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self' https://app.skopia.dev https://cloudflareinsights.com",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const onRequest = defineMiddleware(async (_ctx, next) => {
  const res = await next();
  res.headers.set('content-security-policy', CSP);
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return res;
});
