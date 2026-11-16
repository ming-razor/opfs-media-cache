import type { CacheEntry, MediaStore } from './types.js';
import { sha256 } from './types.js';

function missing(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

export class OpfsStore implements MediaStore {
  private constructor(private root: FileSystemDirectoryHandle) {}

  static async open(namespace: string): Promise<OpfsStore> {
    if (!globalThis.navigator?.storage?.getDirectory) throw new Error('OPFS is unavailable; HTTPS or localhost and a supported browser are required');
    const root = await navigator.storage.getDirectory();
    const owned = await root.getDirectoryHandle('opfs-media-cache-v1', { create: true });
    const name = await sha256(new TextEncoder().encode(namespace));
    return new OpfsStore(await owned.getDirectoryHandle(name, { create: true }));
  }

  private async folder(key: string, create = false): Promise<FileSystemDirectoryHandle | undefined> {
    try { return await this.root.getDirectoryHandle(key, { create }); }
    catch (error) { if (missing(error)) return undefined; throw error; }
  }

  private async metadata(folder: FileSystemDirectoryHandle): Promise<CacheEntry> {
    const file = await (await folder.getFileHandle('entry.json')).getFile();
    const entry = JSON.parse(await file.text()) as CacheEntry;
    if (entry.schema !== 1 || !/^[a-f0-9]{64}$/.test(entry.key) || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
      !entry.resource?.assetId || !entry.resource.version || !entry.resource.url || !Number.isFinite(entry.accessedAt) ||
      !Number.isFinite(entry.createdAt) || (entry.expiresAt !== null && !Number.isFinite(entry.expiresAt)) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid cache metadata');
    return entry;
  }

  private async writeFile(folder: FileSystemDirectoryHandle, name: string, content: string | ArrayBuffer): Promise<void> {
    const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
    try { await writable.write(content); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
  }

  async read(key: string): Promise<{ entry: CacheEntry; data: ArrayBuffer } | undefined> {
    const folder = await this.folder(key);
    if (!folder) return undefined;
    const entry = await this.metadata(folder);
    if (entry.key !== key) throw new Error('Mismatched cache key');
    const data = await (await folder.getFileHandle('data')).getFile();
    if (data.size !== entry.size) throw new Error('Incomplete cache file');
    return { entry, data: await data.arrayBuffer() };
  }

  async list(): Promise<CacheEntry[]> {
    const entries: CacheEntry[] = [];
    for await (const [key, handle] of (this.root as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind !== 'directory' || !/^[a-f0-9]{64}$/.test(key)) continue;
      try {
        const folder = handle as FileSystemDirectoryHandle;
        const entry = await this.metadata(folder);
        const file = await (await folder.getFileHandle('data')).getFile();
        if (entry.key !== key || file.size !== entry.size) throw new Error('Incomplete cache file');
        entries.push(entry);
      } catch { await this.remove(key); }
    }
    return entries;
  }

  async write(key: string, data: ArrayBuffer, entry: CacheEntry): Promise<void> {
    // A metadata record is a commit marker. Never expose old metadata with new data.
    await this.remove(key);
    const folder = (await this.folder(key, true))!;
    try {
      await this.writeFile(folder, 'data', data);
      await this.writeFile(folder, 'entry.json', JSON.stringify(entry));
    } catch (error) { await this.remove(key).catch(() => {}); throw error; }
  }

  async touch(key: string, entry: CacheEntry): Promise<void> {
    const folder = await this.folder(key);
    if (folder) await this.writeFile(folder, 'entry.json', JSON.stringify(entry));
  }

  async remove(key: string): Promise<void> {
    try { await this.root.removeEntry(key, { recursive: true }); }
    catch (error) { if (!missing(error)) throw error; }
  }

  async readPins(): Promise<string[]> {
    try {
      const file = await (await this.root.getFileHandle('pins.json')).getFile();
      const value: unknown = JSON.parse(await file.text());
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid pin metadata');
      return value;
    } catch (error) { if (missing(error)) return []; throw error; }
  }

  async writePins(assetIds: string[]): Promise<void> {
    await this.writeFile(this.root, 'pins.json', JSON.stringify([...new Set(assetIds)]));
  }

  async repair(): Promise<number> {
    let before = 0;
    for await (const [, handle] of (this.root as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) if (handle.kind === 'directory') before++;
    return before - (await this.list()).length;
  }
}
