import { Hono } from 'hono';
import { CacheService } from './services/cache.service';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

type StreamType = 'live' | 'on-demand' | 'unknown';

const isValidPath = (path: string) => {
  if (path.includes('..') || path.includes('//') || path.includes('\\')) {
    return false;
  }

  return true;
};

const isValidServerHost = (serverHost: string) => {
  return /^[\w\d.-]+:\d+$/.test(serverHost) || /^[\w\d.-]+$/.test(serverHost);
};

const isIpHost = (serverHost: string) => {
  const host = serverHost.split(':')[0];
  const isIPv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  const isIPv6 = /^(?:\[[0-9a-fA-F:]+\]|[0-9a-fA-F:]+)$/.test(host);
  return isIPv4 || isIPv6;
};

const buildUpstreamHeaders = (reqHeaders: Headers, targetUrl: string) => {
  const headers = new Headers(reqHeaders);
  try {
    const parsedTarget = new URL(targetUrl);
    headers.set('host', parsedTarget.host);
  } catch (_) {
    // ignore parse errors; fetch will fail later
  }
  headers.delete('cookie');
  headers.delete('authorization');
  headers.delete('x-forwarded-for');
  headers.delete('x-real-ip');
  return headers;
};

const parseMasterVariants = (manifest: string) => {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const variants: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!/^#EXT-X-STREAM-INF/i.test(lines[i])) continue;

    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j];
      if (!candidate) continue;
      if (candidate.startsWith('#')) continue;
      variants.push(candidate);
      i = j;
      break;
    }
  }

  return variants;
};

const detectTypeFromManifest = (manifest: string): StreamType | 'master' => {
  const isMaster = /#EXT-X-STREAM-INF/i.test(manifest);
  if (isMaster) return 'master';

  const isVod =
    /#EXT-X-PLAYLIST-TYPE:VOD/i.test(manifest) ||
    /#EXT-X-ENDLIST/i.test(manifest);

  return isVod ? 'on-demand' : 'live';
};

const detectHlsStreamType = async (
  entryUrl: string,
  reqHeaders: Headers,
): Promise<StreamType> => {
  const maxDepth = 3;
  let currentUrl = entryUrl;
  const baseHost = new URL(entryUrl).host;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const headers = buildUpstreamHeaders(reqHeaders, currentUrl);
    headers.set(
      'accept',
      'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
    );

    const response = await fetch(currentUrl, {
      method: 'GET',
      headers,
    });

    if (!response.ok) return 'unknown';

    const manifest = await response.text();
    const detected = detectTypeFromManifest(manifest);
    if (detected !== 'master') return detected;

    const variants = parseMasterVariants(manifest);
    if (variants.length === 0) return 'unknown';

    const nextUrl = new URL(variants[0], currentUrl);
    if (nextUrl.host !== baseHost) return 'unknown';
    currentUrl = nextUrl.toString();
  }

  return 'unknown';
};

app.get('/server-type/*', async (c) => {
  const SERVER_HOST = (c.env as Env).SERVER_HOST;
  if (!SERVER_HOST) {
    return c.json({ error: 'unknown host' }, 500);
  }

  const path = c.req.path.replace('/server-type', '');

  if (!isValidPath(path)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  if (!path.toLowerCase().endsWith('.m3u8')) {
    return c.json({ error: 'not allowed' }, 403);
  }

  if (!isValidServerHost(SERVER_HOST)) {
    return c.json({ error: 'invalid server configuration' }, 500);
  }

  if (isIpHost(SERVER_HOST)) {
    return c.json(
      {
        error: 'server host must be a DNS hostname (not a literal IP address)',
      },
      400,
    );
  }

  const queryString = new URL(c.req.url).search;
  const targetUrl = `http://${SERVER_HOST}${path}${queryString}`;

  try {
    const origin = c.req.header('Origin');
    const requestOrigin = new URL(c.req.url).origin;

    if (origin && origin !== requestOrigin) {
      return c.json({ error: 'cross-origin requests not allowed' }, 403);
    }

    const streamType = await detectHlsStreamType(targetUrl, c.req.raw.headers);

    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });

    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      headers.set('Access-Control-Allow-Headers', '*');
    }

    return new Response(JSON.stringify({ streamType }), { headers });
  } catch (error) {
    console.error('Stream type detect error:', error);
    return c.json({ streamType: 'unknown' satisfies StreamType }, 200);
  }
});

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
  if (!isValidPath(path)) {
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
  if (!isValidServerHost(SERVER_HOST)) {
    return c.json({ error: 'invalid server configuration' }, 500);
  }

  // Reject literal IP addresses to avoid Cloudflare "Direct IP access not allowed" (Error 1003)
  if (isIpHost(SERVER_HOST)) {
    return c.json(
      {
        error: 'server host must be a DNS hostname (not a literal IP address)',
      },
      400,
    );
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

    // Copy original request headers and prepare safe headers for the upstream
    const headers = buildUpstreamHeaders(c.req.raw.headers, fullTargetUrl);

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

    if (response.status >= 500) {
      const errorHeaders = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });

      if (origin) {
        errorHeaders.set('Access-Control-Allow-Origin', origin);
        errorHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        errorHeaders.set('Access-Control-Allow-Headers', '*');
      }

      return new Response(JSON.stringify({ error: 'upstream unavailable' }), {
        status: 502,
        headers: errorHeaders,
      });
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
