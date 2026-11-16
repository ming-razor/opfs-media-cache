import { OpfsStore } from './opfs-store.js';
import type { CacheEntry, CacheEvent, CacheOptions, MediaResource, MediaStore } from './types.js';
import { resourceKey, sha256 } from './types.js';

export interface CacheCounters { hits: number; misses: number; hitBytes: number; writtenBytes: number; errors: number; evictions: number }

export class MediaCache {
  readonly namespace: string;
  readonly maxBytes: number;
  readonly maxEntryBytes: number;
  readonly available: boolean;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Set<Promise<boolean>>();
  private pendingBytes = 0;
  private counters = { hits: 0, misses: 0, hitBytes: 0, writtenBytes: 0, errors: 0, evictions: 0 };
  private constructor(private options: CacheOptions, private store?: MediaStore) {
    this.namespace = options.namespace ?? 'default';
    this.maxBytes = options.maxBytes ?? 1024 ** 3;
    this.maxEntryBytes = options.maxEntryBytes ?? 32 * 1024 ** 2;
    this.available = !!store;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0 || !Number.isSafeInteger(this.maxEntryBytes) || this.maxEntryBytes <= 0) {
      throw new RangeError('Cache budgets must be positive safe integers');
    }
    if (options.ttlMs !== undefined && (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0)) throw new RangeError('ttlMs must be positive and finite');
  }

  static async create(options: CacheOptions = {}): Promise<MediaCache> {
    let store = options.store;
    let failure: unknown;
    if (!store) {
      try { store = await OpfsStore.open(options.namespace ?? 'default'); }
      catch (error) { failure = error; }
    }
    const cache = new MediaCache(options, store);
    if (failure) cache.emit({ type: 'error', reason: 'storage-unavailable', error: failure });
    if (store) {
      try { await cache.lock(() => store!.repair()); }
      catch (error) { cache.emit({ type: 'error', reason: 'repair', error }); }
    }
    return cache;
  }

  private now(): number { return this.options.now?.() ?? Date.now(); }

  private lock<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      if (globalThis.navigator?.locks) return navigator.locks.request(`opfs-media-cache:${this.namespace}`, task);
      return task();
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => {});
    return result;
  }

  private emit(event: CacheEvent): void {
    if (event.type === 'error') this.counters.errors++;
    // Observability must never break playback or a successful storage commit.
    try { this.options.onEvent?.(event); } catch { /* consumer exception is isolated */ }
  }

  async get(resource: MediaResource): Promise<ArrayBuffer | undefined> {
    const key = await sha256(new TextEncoder().encode(resourceKey(resource)));
    if (!this.store) { this.miss(resource); return undefined; }
    return this.lock(async () => {
      try {
        const result = await this.store!.read(key);
        if (!result) { this.miss(resource); return undefined; }
        const { entry, data } = result;
        if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
          await this.store!.remove(key); this.miss(resource); return undefined;
        }
        if (entry.size !== data.byteLength || (this.options.verifyIntegrity !== false && entry.sha256 !== await sha256(data))) {
          throw new Error('Cached data integrity check failed');
        }
        // A failed access-time update must not discard an otherwise valid cache hit.
        await this.store!.touch(key, { ...entry, accessedAt: this.now() }).catch(error => this.emit({ type: 'error', resource, reason: 'touch', error }));
        this.counters.hits++; this.counters.hitBytes += data.byteLength;
        this.emit({ type: 'hit', resource, bytes: data.byteLength });
        return data;
      } catch (error) {
        await this.store!.remove(key).catch(() => {});
        this.emit({ type: 'error', resource, reason: 'read', error });
        this.miss(resource); return undefined;
      }
    });
  }

  private miss(resource: MediaResource): void {
    this.counters.misses++; this.emit({ type: 'miss', resource });
  }

  enqueuePut(resource: MediaResource, data: ArrayBuffer): void {
    const byteLength = data.byteLength;
    const limit = this.options.maxPendingWriteBytes ?? 64 * 1024 ** 2;
    if (this.pendingBytes + data.byteLength > limit) {
      this.emit({ type: 'skip', resource, reason: 'write-backpressure' }); return;
    }
    this.pendingBytes += byteLength;
    const task = this.put(resource, data).catch(error => {
      this.emit({ type: 'error', resource, reason: 'background-write', error }); return false;
    });
    this.pending.add(task);
    void task.then(() => { this.pending.delete(task); this.pendingBytes -= byteLength; });
  }

  /** Wait for all writes scheduled by HLS callbacks before closing the page. */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all(this.pending);
    await this.tail;
  }

  async put(resource: MediaResource, data: ArrayBuffer): Promise<boolean> {
    const identity = resourceKey(resource);
    if (!this.store || data.byteLength > Math.min(this.maxEntryBytes, this.maxBytes)) {
      this.emit({ type: 'skip', resource, reason: !this.store ? 'storage-unavailable' : 'entry-too-large' }); return false;
    }
    // Copy before returning control: a player may transfer/detach its original buffer.
    const copy = data.slice(0);
    const key = await sha256(new TextEncoder().encode(identity));
    const digest = await sha256(copy);
    return this.lock(async () => {
      try {
        const entries = await this.store!.list();
        const pins = new Set(await this.store!.readPins());
        const now = this.now();
        const retained: CacheEntry[] = [];
        for (const entry of entries) {
          if (entry.expiresAt !== null && entry.expiresAt <= now) await this.store!.remove(entry.key);
          else if (entry.key !== key) retained.push(entry);
        }
        let usage = retained.reduce((sum, entry) => sum + entry.size, 0);
        const candidates = retained.filter(entry => !pins.has(entry.resource.assetId)).sort((a, b) => a.accessedAt - b.accessedAt);
        const victims: CacheEntry[] = [];
        for (const entry of candidates) {
          if (usage + copy.byteLength <= this.maxBytes) break;
          usage -= entry.size; victims.push(entry);
        }
        // Check feasibility before eviction: a pinned playlist must not churn itself.
        if (usage + copy.byteLength > this.maxBytes) {
          this.emit({ type: 'skip', resource, reason: 'pinned-budget-exceeded' }); return false;
        }
        for (const victim of victims) {
          await this.store!.remove(victim.key); this.counters.evictions++;
          this.emit({ type: 'evict', resource: victim.resource, bytes: victim.size });
        }
        const entry: CacheEntry = {
          schema: 1, key, resource, size: copy.byteLength, sha256: digest,
          createdAt: now, accessedAt: now,
          expiresAt: this.options.ttlMs === undefined ? null : now + this.options.ttlMs
        };
        await this.store!.write(key, copy, entry);
        this.counters.writtenBytes += copy.byteLength;
        this.emit({ type: 'write', resource, bytes: copy.byteLength }); return true;
      } catch (error) {
        this.emit({ type: 'error', resource, reason: 'write', error }); return false;
      }
    });
  }

  /** Replaces the persistent pin set for this namespace. Does not download assets. */
  async setPinnedAssets(assetIds: string[]): Promise<void> {
    if (this.store) await this.lock(() => this.store!.writePins(assetIds));
  }

  async removeAsset(assetId: string): Promise<void> {
    if (!this.store) return;
    await this.flush();
    await this.lock(async () => {
      for (const entry of await this.store!.list()) if (entry.resource.assetId === assetId) await this.store!.remove(entry.key);
    });
  }

  async clear(): Promise<void> {
    if (!this.store) return;
    await this.flush();
    await this.lock(async () => {
      for (const entry of await this.store!.list()) await this.store!.remove(entry.key);
      await this.store!.writePins([]);
    });
  }

  async inspect(): Promise<{ available: boolean; entries: CacheEntry[]; bytes: number; pinnedAssets: string[]; counters: CacheCounters; quota?: StorageEstimate }> {
    const local = this.store ? await this.lock(async () => ({ entries: await this.store!.list(), pinnedAssets: await this.store!.readPins() })) : { entries: [], pinnedAssets: [] };
    const quota = await globalThis.navigator?.storage?.estimate?.().catch(() => undefined);
    return { available: this.available, ...local, bytes: local.entries.reduce((sum, entry) => sum + entry.size, 0), counters: { ...this.counters }, quota };
  }
}

export const createMediaCache = MediaCache.create;
