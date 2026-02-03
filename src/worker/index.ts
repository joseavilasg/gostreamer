import { Hono } from 'hono';
import { CacheService } from './services/cache.service';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// Proxy with optimized caching for HLS
app.all('/server/*', async (c) => {
  const SERVER_HOST = (c.env as Env).SERVER_HOST;
  if (!SERVER_HOST) {
    return c.json({ error: 'unknown host' }, 500);
  }

  // Only allow GET and OPTIONS methods
  if (c.req.method !== 'GET' && c.req.method !== 'OPTIONS') {
    return c.json({ error: 'Method not allowed' }, 405);
  }

  // Handle OPTIONS preflight
  if (c.req.method === 'OPTIONS') {
    const origin = c.req.header('Origin');
    const requestOrigin = new URL(c.req.url).origin;

    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':
          origin === requestOrigin ? origin : 'null',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const path = c.req.path.replace('/server', '');

  // Prevent path traversal attacks
  if (path.includes('..') || path.includes('//') || path.includes('\\')) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  // Validate HLS file extensions only
  const allowedExtensions = ['.m3u8', '.ts', '.aac', '.mp4'];
  const hasValidExtension = allowedExtensions.some((ext) =>
    path.toLowerCase().endsWith(ext),
  );

  if (!hasValidExtension) {
    return c.json({ error: 'not allowed' }, 403);
  }

  // Validate SERVER_HOST format (prevent SSRF)
  if (
    !/^[\w\d.-]+:\d+$/.test(SERVER_HOST) &&
    !/^[\w\d.-]+$/.test(SERVER_HOST)
  ) {
    return c.json({ error: 'invalid server configuration' }, 500);
  }

  const targetUrl = `http://${SERVER_HOST}${path}`;
  const url = new URL(c.req.url);
  const queryString = url.search;
  const fullTargetUrl = targetUrl + queryString;

  try {
    // Validate same-origin
    const origin = c.req.header('Origin');
    const requestOrigin = new URL(c.req.url).origin;

    if (origin && origin !== requestOrigin) {
      return c.json({ error: 'cross-origin requests not allowed' }, 403);
    }

    // Copy original request headers and remove sensitive ones
    const headers = new Headers(c.req.raw.headers);
    headers.delete('host');
    headers.delete('cookie');
    headers.delete('authorization');
    headers.delete('x-forwarded-for');
    headers.delete('x-real-ip');

    // Get cache configuration for HLS
    const cacheConfig = CacheService.getHLSCacheConfig(path);

    // Fetch with caching
    const response = await CacheService.cachedFetch({
      targetUrl: fullTargetUrl,
      headers,
      method: c.req.method,
      body: c.req.raw.body,
      cacheConfig,
      executionCtx: c.executionCtx,
    });

    // Validate content-type for HLS files
    const contentType = response.headers.get('content-type');
    const isValidContentType =
      !contentType ||
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegURL') ||
      contentType.includes('video/mp2t') ||
      contentType.includes('audio/aac') ||
      contentType.includes('video/mp4') ||
      contentType.includes('application/octet-stream');

    if (!isValidContentType) {
      console.warn('Unexpected content-type:', contentType);
    }

    // Prepare response headers
    const responseHeaders = new Headers(response.headers);

    // Set CORS headers only for same-origin
    if (origin) {
      responseHeaders.set('Access-Control-Allow-Origin', origin);
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', '*');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return c.json({ error: 'failed to proxy request' }, 500);
  }
});

// Handle OPTIONS for CORS
app.options('/server/*', (_) => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
});

export default app;
