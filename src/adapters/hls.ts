import type { HlsConfig, Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from 'hls.js';
import type { MediaCache } from '../cache.js';
import type { MediaResource } from '../types.js';

export interface HlsCacheOptions {
  /** Return undefined to bypass caching. Partition authenticated representations explicitly. */
  resource: (context: LoaderContext) => MediaResource | undefined;
  /** Opt in only for immutable VOD playlists. Live playlists must remain uncached. */
  cachePlaylists?: boolean;
  /** Bounds OPFS lookup time; network requests retain the upstream loader's policies. */
  lookupTimeoutMs?: number;
}

/** Decorates the upstream loader rather than replacing its transport/retry behavior. */
export function createHlsLoader(BaseLoader: HlsConfig['loader'], cache: MediaCache, options: HlsCacheOptions): HlsConfig['loader'] {
  return class CachedHlsLoader implements Loader<LoaderContext> {
    private upstream: Loader<LoaderContext>;
    private generation = 0;
    private networkStarted = false;
    private active = false;
    private lookupStarted = 0;
    private callbacks?: LoaderCallbacks<LoaderContext>;
    context: LoaderContext | null = null;
    constructor(config: HlsConfig) { this.upstream = new BaseLoader(config); }
    get stats(): LoaderStats { return this.upstream.stats; }
    getCacheAge = (): number | null => this.upstream.getCacheAge?.() ?? null;
    getResponseHeader = (name: string): string | null => this.upstream.getResponseHeader?.(name) ?? null;

    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
      const generation = ++this.generation;
      this.context = context;
      this.callbacks = callbacks;
      this.networkStarted = false;
      this.active = true;
      this.stats.aborted = false;
      this.lookupStarted = performance.now();
      void this.loadCached(context, config, callbacks, generation).catch(error => {
        if (generation !== this.generation || !this.active) return;
        this.active = false;
        callbacks.onError({ code: 0, text: String(error) }, context, null, this.stats);
      });
    }

    private async loadCached(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>, generation: number): Promise<void> {
      let resource: MediaResource | undefined;
      let canonicalUrl = context.url;
      try { canonicalUrl = new URL(context.url, globalThis.location?.href).href; } catch { /* non-browser tests may use a relative URL */ }
      const isKey = 'keyInfo' in context || String((context as { type?: string }).type) === 'key';
      const isFragment = 'frag' in context && !isKey && context.responseType === 'arraybuffer';
      // LL-HLS partial segments and encryption keys are intentionally bypassed in v0.1.
      const isPart = 'part' in context && context.part != null;
      if (!isKey && !isPart && (isFragment || (options.cachePlaylists && context.responseType !== 'arraybuffer'))) {
        try {
          const candidate = options.resource(context);
          if (candidate) {
            resource = { ...candidate, url: canonicalUrl };
            if (context.rangeStart !== undefined && context.rangeEnd !== undefined && context.rangeEnd > context.rangeStart) {
              resource.range = [context.rangeStart, context.rangeEnd - 1];
            }
          }
        } catch { /* a resolver failure must not break the upstream loader */ }
      }
      let data: ArrayBuffer | undefined;
      if (resource) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          data = await Promise.race([
            cache.get(resource).catch(() => undefined),
            new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), options.lookupTimeoutMs ?? 150); })
          ]);
        } finally { clearTimeout(timer); }
      }
      if (generation !== this.generation) return;
      if (data) {
        this.active = false;
        const stats = this.stats;
        stats.loaded = stats.total = data.byteLength;
        stats.chunkCount = 1;
        stats.retry = 0;
        stats.loading.start = this.lookupStarted;
        stats.loading.first = stats.loading.end = performance.now();
        // Timings describe local IO. Applications using ABR should account for cache hits.
        callbacks.onSuccess({ url: canonicalUrl, data: context.responseType === 'arraybuffer' ? data : new TextDecoder().decode(data), code: 200 }, stats, context, null);
        return;
      }
      this.networkStarted = true;
      this.upstream.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, resultContext, details) => {
          if (generation !== this.generation) return;
          this.active = false;
          if (resource && (response.data instanceof ArrayBuffer || typeof response.data === 'string')) {
            // A redirected playlist has a different relative-URI base; don't persist it.
            let redirectedPlaylist = false;
            if (typeof response.data === 'string') {
              try {
                redirectedPlaylist = new URL(response.url, globalThis.location?.href).href !== new URL(context.url, globalThis.location?.href).href;
              } catch { redirectedPlaylist = response.url !== context.url; }
            }
            if (!redirectedPlaylist) {
              const bytes = typeof response.data === 'string' ? new TextEncoder().encode(response.data).buffer : response.data;
              cache.enqueuePut(resource, bytes);
            }
          }
          callbacks.onSuccess(response, stats, resultContext, details);
        },
        onError: (...args) => { if (generation === this.generation) { this.active = false; callbacks.onError(...args); } },
        onTimeout: (...args) => { if (generation === this.generation) { this.active = false; callbacks.onTimeout(...args); } },
        onProgress: (...args) => { if (generation === this.generation) callbacks.onProgress?.(...args); },
        onAbort: (...args) => { if (generation === this.generation) callbacks.onAbort?.(...args); }
      });
    }

    abort(): void {
      const notify = this.active;
      this.active = false;
      ++this.generation;
      this.stats.aborted = true;
      if (this.networkStarted) this.upstream.abort();
      if (notify && this.context) this.callbacks?.onAbort?.(this.stats, this.context, null);
    }
    destroy(): void { this.abort(); this.callbacks = undefined; this.context = null; this.upstream.destroy(); }
  };
}
