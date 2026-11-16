import type { MediaCache } from '../cache.js';
import type { MediaResource } from '../types.js';
import { abortError } from '../types.js';

export interface FlvSource { url: string; duration?: number; filesize?: number; cors?: boolean; withCredentials?: boolean; isLive?: boolean }
export interface FlvRange { from: number; to: number }
export interface FlvSeekHandler {
  getConfig(url: string, range: FlvRange): { url: string; headers: Headers | object };
  removeURLParameters(url: string): string;
}
export interface FlvLoaderConfig {
  isLive?: boolean;
  seekType?: 'range' | 'param' | 'custom';
  referrerPolicy?: ReferrerPolicy;
  headers?: Record<string, string>;
}
export interface FlvLoader {
  _status: number;
  _needStash: boolean;
  readonly type: string;
  readonly status: number;
  readonly needStashBuffer: boolean;
  onContentLengthKnown: (length: number) => void;
  onURLRedirect: (url: string) => void;
  onDataArrival: (data: ArrayBuffer, start: number, received?: number) => void;
  onError: (type: unknown, info: { code: number; msg: string }) => void;
  onComplete: (from: number, to: number) => void;
  open(source: FlvSource, range: FlvRange): void;
  isWorking(): boolean;
  abort(): void;
  destroy(): void;
}
export interface FlvLoaderConstructor { new(seek: FlvSeekHandler, config: FlvLoaderConfig): FlvLoader }

export interface FlvCacheOptions {
  resource: (source: FlvSource) => MediaResource;
  /** Range block size, default 1 MiB. Must fit maxEntryBytes. */
  blockSize?: number;
  fetch?: typeof globalThis.fetch;
}

class RangeUnsupported extends Error {}

/** HTTP(S) FLV VOD uses aligned Range blocks; live streams bypass persistence. */
export function createFlvLoader(cache: MediaCache, options: FlvCacheOptions): FlvLoaderConstructor {
  const blockSize = options.blockSize ?? 1024 ** 2;
  if (!Number.isSafeInteger(blockSize) || blockSize <= 0 || blockSize + 8 > cache.maxEntryBytes) {
    throw new RangeError('blockSize must be positive and fit maxEntryBytes');
  }
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  return class CachedFlvLoader implements FlvLoader {
    readonly type = 'opfs-range-loader';
    _status = 0;
    _needStash = true;
    get status(): number { return this._status; }
    get needStashBuffer(): boolean { return this._needStash; }
    onContentLengthKnown: FlvLoader['onContentLengthKnown'] = () => {};
    onURLRedirect: FlvLoader['onURLRedirect'] = () => {};
    onDataArrival: FlvLoader['onDataArrival'] = () => {};
    onError: FlvLoader['onError'] = () => {};
    onComplete: FlvLoader['onComplete'] = () => {};
    private controller?: AbortController;
    private generation = 0;
    constructor(private seek: FlvSeekHandler, private config: FlvLoaderConfig) {}
    isWorking(): boolean { return this._status === 1 || this._status === 2; }

    open(source: FlvSource, range: FlvRange): void {
      this.abort();
      const generation = ++this.generation;
      this.controller = new AbortController();
      this._status = 1;
      void this.run(source, range, this.controller.signal, generation).catch(error => {
        if (generation !== this.generation || this.controller?.signal.aborted) return;
        this._status = 3;
        this.onError('Exception', { code: -1, msg: String(error instanceof Error ? error.message : error) });
      });
    }

    private init(source: FlvSource, headers: Headers, signal: AbortSignal): RequestInit {
      return {
        headers, signal, credentials: source.withCredentials ? 'include' : 'same-origin',
        mode: source.cors === false ? 'same-origin' : 'cors',
        referrerPolicy: this.config.referrerPolicy ?? 'no-referrer-when-downgrade'
      };
    }

    private async run(source: FlvSource, range: FlvRange, signal: AbortSignal, generation: number): Promise<void> {
      if (!Number.isSafeInteger(range.from) || range.from < 0 || (range.to !== -1 && (!Number.isSafeInteger(range.to) || range.to < range.from))) throw new RangeError('Invalid FLV byte range');
      if (!/^https?:/i.test(new URL(source.url, globalThis.location?.href).protocol)) throw new Error('Only HTTP(S) media is supported');
      const isLive = this.config.isLive || (source as FlvSource & { isLive?: boolean }).isLive;
      if (isLive || (this.config.seekType && this.config.seekType !== 'range')) {
        await this.stream(source, range, signal, generation); return;
      }
      const resource = options.resource(source);
      let position = range.from;
      let received = 0;
      let total = source.filesize;
      while (range.to === -1 || position <= range.to) {
        if (signal.aborted || generation !== this.generation) throw abortError();
        const start = Math.floor(position / blockSize) * blockSize;
        const end = start + blockSize - 1;
        const key: MediaResource = { ...resource, url: source.url, range: [start, end], variant: JSON.stringify([resource.variant ?? '', 'flv-block-v1']) };
        const frame = await cache.get(key);
        if (signal.aborted || generation !== this.generation) throw abortError();
        let bytes: ArrayBuffer | undefined;
        if (frame && frame.byteLength > 8) {
          const savedTotal = new DataView(frame).getFloat64(0);
          if (!Number.isSafeInteger(savedTotal) || savedTotal <= start || (total !== undefined && total !== savedTotal)) throw new Error('FLV resource length changed; update the resource version');
          total = savedTotal;
          bytes = frame.slice(8);
        }
        if (!bytes) {
          const headers = new Headers(this.config.headers);
          headers.set('Range', `bytes=${start}-${end}`);
          const response = await request(source.url, this.init(source, headers, signal));
          if (signal.aborted) { await response.body?.cancel(); throw abortError(); }
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
          if (response.status === 416 && total !== undefined && start >= total) break;
          if (response.status === 200 || (response.status === 206 && !match)) {
            await response.body?.cancel();
            // Never label a full-file response as a byte block. Preserve playback by
            // switching to uncached streaming from the next undispatched byte.
            await this.stream(source, { from: position, to: range.to }, signal, generation, range.from, received);
            return;
          }
          if (response.status !== 206 || !match) { await response.body?.cancel(); throw new RangeUnsupported(`Expected 206 with exposed Content-Range, received ${response.status}`); }
          const actualStart = Number(match[1]), actualEnd = Number(match[2]);
          const responseTotal = Number(match[3]);
          if (total !== undefined && total !== responseTotal) { await response.body?.cancel(); throw new Error('FLV resource length changed; update the resource version'); }
          total = responseTotal;
          if (!Number.isSafeInteger(total) || total <= 0 || actualStart !== start || actualEnd !== Math.min(end, total - 1)) {
            await response.body?.cancel(); throw new Error('Invalid Content-Range');
          }
          bytes = await response.arrayBuffer();
          if (bytes.byteLength !== actualEnd - actualStart + 1) throw new Error('Truncated FLV range');
          if (signal.aborted || generation !== this.generation) throw abortError();
          // Await each commit: bounds pending write memory to one range block.
          const saved = new Uint8Array(bytes.byteLength + 8);
          new DataView(saved.buffer).setFloat64(0, total);
          saved.set(new Uint8Array(bytes), 8);
          await cache.put(key, saved.buffer);
          if (response.url && response.url !== source.url) this.onURLRedirect(response.url);
        }
        if (signal.aborted || generation !== this.generation) throw abortError();
        if (bytes.byteLength === 0 || bytes.byteLength > blockSize) throw new Error('Invalid cached FLV block');
        if (bytes.byteLength < blockSize) total = start + bytes.byteLength;
        if (total !== undefined && received === 0) this.onContentLengthKnown(Math.min(total - range.from, range.to === -1 ? Infinity : range.to - range.from + 1));
        if (signal.aborted || generation !== this.generation) return;
        const limit = Math.min(start + bytes.byteLength, range.to === -1 ? Infinity : range.to + 1);
        const data = bytes.slice(position - start, limit - start);
        if (data.byteLength === 0) break;
        this._status = 2;
        received += data.byteLength;
        const byteStart = position;
        position += data.byteLength;
        this.onDataArrival(data, byteStart, received);
        if (signal.aborted || generation !== this.generation) return;
        if (total !== undefined && position >= total) break;
      }
      if (signal.aborted || generation !== this.generation) return;
      this._status = 4;
      this.onComplete(range.from, range.from + received - 1);
    }

    private async stream(source: FlvSource, range: FlvRange, signal: AbortSignal, generation: number, originalStart = range.from, initialReceived = 0): Promise<void> {
      const seekConfig = this.seek.getConfig(source.url, range);
      const headers = new Headers(seekConfig.headers as HeadersInit);
      new Headers(this.config.headers).forEach((value, key) => headers.set(key, value));
      const response = await request(seekConfig.url, this.init(source, headers, signal));
      if (signal.aborted || generation !== this.generation) { await response.body?.cancel(); throw abortError(); }
      if (!response.ok || !response.body) throw new Error(`FLV HTTP ${response.status}`);
      if (range.from > 0 && this.config.seekType !== 'param' && this.config.seekType !== 'custom' && response.status !== 206) {
        await response.body.cancel(); throw new Error('Server ignored non-zero Range; refusing to mislabel bytes');
      }
      const contentRange = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('Content-Range') ?? '');
      if (response.status === 206 && (!contentRange || Number(contentRange[1]) !== range.from)) {
        await response.body.cancel(); throw new Error('Streaming Content-Range is missing or mismatched');
      }
      const length = Number(response.headers.get('Content-Length'));
      if (length > 0 && initialReceived === 0) this.onContentLengthKnown(length);
      if (signal.aborted || generation !== this.generation) { await response.body.cancel(); return; }
      if (response.url && response.url !== source.url) this.onURLRedirect(this.seek.removeURLParameters(response.url));
      if (signal.aborted || generation !== this.generation) { await response.body.cancel(); return; }
      const reader = response.body.getReader();
      let position = range.from, received = initialReceived;
      const limit = range.to === -1 ? Infinity : range.to + 1;
      try {
        while (position < limit) {
          const { value, done } = await reader.read();
          if (signal.aborted || generation !== this.generation) throw abortError();
          if (done) break;
          const chunk = value.slice(0, Math.min(value.byteLength, limit - position));
          this._status = 2;
          const start = position;
          position += chunk.byteLength; received += chunk.byteLength;
          this.onDataArrival(chunk.buffer, start, received);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (signal.aborted || generation !== this.generation) return;
      if (length > 0 && position - range.from < Math.min(length, limit - range.from)) throw new Error('Truncated FLV stream');
      this._status = 4; this.onComplete(originalStart, position - 1);
    }

    abort(): void { ++this.generation; this.controller?.abort(); this._status = 0; }
    destroy(): void {
      this.abort();
      this.onDataArrival = this.onComplete = this.onContentLengthKnown = this.onURLRedirect = () => {};
      this.onError = () => {};
    }
  };
}
