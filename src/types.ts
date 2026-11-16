export interface MediaResource {
  /** Stable logical video identifier; pinning is applied to this identifier. */
  assetId: string;
  /** Change when bytes change. Required: URLs alone do not establish freshness. */
  version: string;
  url: string;
  /** Inclusive byte range. HLS's exclusive rangeEnd is converted by its adapter. */
  range?: readonly [number, number];
  /** Include representation/user/header identity when one URL can return different bytes. */
  variant?: string;
}

export interface CacheEntry {
  schema: 1;
  key: string;
  resource: MediaResource;
  size: number;
  sha256: string;
  createdAt: number;
  accessedAt: number;
  expiresAt: number | null;
}

/** Store methods run under MediaCache's namespace lock. */
export interface MediaStore {
  read(key: string): Promise<{ entry: CacheEntry; data: ArrayBuffer } | undefined>;
  list(): Promise<CacheEntry[]>;
  write(key: string, data: ArrayBuffer, entry: CacheEntry): Promise<void>;
  touch(key: string, entry: CacheEntry): Promise<void>;
  remove(key: string): Promise<void>;
  readPins(): Promise<string[]>;
  writePins(assetIds: string[]): Promise<void>;
  repair(): Promise<number>;
}

export type CacheEvent = {
  type: 'hit' | 'miss' | 'write' | 'skip' | 'evict' | 'error';
  resource?: MediaResource;
  bytes?: number;
  reason?: string;
  error?: unknown;
};

export interface CacheOptions {
  namespace?: string;
  /** Logical media-byte budget, not a promise of available browser disk space. */
  maxBytes?: number;
  maxEntryBytes?: number;
  /** Bounds HLS background write buffers; excess writes are skipped. */
  maxPendingWriteBytes?: number;
  ttlMs?: number;
  verifyIntegrity?: boolean;
  onEvent?: (event: CacheEvent) => void;
  /** Supply a store for testing or an alternate persistence backend. */
  store?: MediaStore;
  now?: () => number;
}

export function resourceKey(resource: MediaResource): string {
  if (!resource.assetId || !resource.version || !resource.url) {
    throw new TypeError('assetId, version and url must be non-empty');
  }
  const range = resource.range;
  if (range && (!Number.isSafeInteger(range[0]) || !Number.isSafeInteger(range[1]) || range[0] < 0 || range[1] < range[0])) {
    throw new RangeError('range must contain inclusive non-negative safe integers');
  }
  return JSON.stringify([resource.assetId, resource.version, resource.url, range ?? null, resource.variant ?? '']);
}

export async function sha256(data: BufferSource): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

export function abortError(): DOMException {
  return new DOMException('Operation aborted', 'AbortError');
}
