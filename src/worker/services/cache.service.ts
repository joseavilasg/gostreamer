interface Caches {
  default: {
    put(request: Request | string, response: Response): Promise<undefined>;
    match(request: Request | string): Promise<Response | undefined>;
  };
}

declare let caches: Caches;

export interface CacheConfig {
  /** Virtual hostname for cache key (e.g., 'cache.cdn.com') */
  cacheKeyHostname: string;
  /** Maximum cache time in seconds */
  maxAge: number;
  /** Whether the content is immutable */
  immutable?: boolean;
  /** Whether this request should be cached */
  shouldCache: boolean;
}

export interface CachedProxyOptions {
  /** Full URL of the resource to fetch */
  targetUrl: string;
  /** Request headers */
  headers: Headers;
  /** HTTP method */
  method: string;
  /** Request body (for POST, PUT, etc.) */
  body?: BodyInit | null;
  /** Cache configuration */
  cacheConfig: CacheConfig;
  /** Execution context for background tasks */
  executionCtx?: ExecutionContext;
}

export class CacheService {
  string(): string {
    return 'cache service';
  }

  /**
   * Creates a normalized cache key
   */
  private static createCacheKey(targetUrl: string, hostname: string): string {
    const cacheKey = new URL(targetUrl);
    cacheKey.hostname = hostname;
    return cacheKey.href;
  }

  /**
   * Generates appropriate cache headers
   */
  private static getCacheHeaders(config: CacheConfig): string {
    const { maxAge, immutable } = config;
    const immutableStr = immutable ? ', immutable' : '';
    return `public, max-age=${maxAge}, s-maxage=${maxAge}${immutableStr}`;
  }

  /**
   * Attempts to get response from cache
   */
  private static async getFromCache(
    cacheKey: string,
  ): Promise<Response | undefined> {
    const cache = caches.default;
    return await cache.match(cacheKey);
  }

  /**
   * Saves response to cache (in background)
   */
  private static async putInCache(
    cacheKey: string,
    response: Response,
    executionCtx?: ExecutionContext,
  ): Promise<void> {
    const cache = caches.default;
    const cachePromise = cache.put(cacheKey, response.clone());

    if (executionCtx) {
      executionCtx.waitUntil(cachePromise);
    } else {
      await cachePromise;
    }
  }

  /**
   * Proxy with intelligent caching
   */
  public static async cachedFetch(
    options: CachedProxyOptions,
  ): Promise<Response> {
    const { targetUrl, headers, method, body, cacheConfig, executionCtx } =
      options;

    const cacheKey = CacheService.createCacheKey(
      targetUrl,
      cacheConfig.cacheKeyHostname,
    );

    // Try to get from cache if enabled
    if (cacheConfig.shouldCache) {
      const cachedResponse = await CacheService.getFromCache(cacheKey);
      if (cachedResponse) {
        console.log('Cache hit:', targetUrl);
        return cachedResponse;
      }
    }

    // Fetch from origin server
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
    });

    if (!response.ok) {
      return new Response(null, {
        status: response.status,
      });
    }

    // Prepare response headers
    const responseHeaders = new Headers(response.headers);

    // Cache headers
    const cacheControl = CacheService.getCacheHeaders(cacheConfig);
    responseHeaders.set('Cache-Control', cacheControl);

    // Streaming headers
    responseHeaders.set('Accept-Ranges', 'bytes');

    const finalResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });

    // Cache if enabled
    if (cacheConfig.shouldCache && response.ok) {
      await CacheService.putInCache(cacheKey, finalResponse, executionCtx);
      console.log('Cached:', targetUrl);
    }

    return finalResponse;
  }

  /**
   * Cache configuration for HLS files
   */
  public static getHLSCacheConfig(path: string): CacheConfig {
    const isM3U8 = path.endsWith('.m3u8');
    const isSegment =
      path.endsWith('.ts') || path.endsWith('.aac') || path.endsWith('.mp4');

    if (isM3U8) {
      // Playlists: short cache (updated frequently)
      return {
        cacheKeyHostname: 'cache.cdn.com',
        maxAge: 2,
        immutable: false,
        shouldCache: false, // Don't cache live playlists
      };
    }

    if (isSegment) {
      // Segments: long cache (immutable)
      return {
        cacheKeyHostname: 'cache.cdn.com',
        maxAge: 31536000, // 1 year
        immutable: true,
        shouldCache: true,
      };
    }

    // Other files: medium cache
    return {
      cacheKeyHostname: 'cache.cdn.com',
      maxAge: 3600, // 1 hour
      immutable: false,
      shouldCache: true,
    };
  }
}
