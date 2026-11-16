export class MemoryStore {
  records = new Map(); pins = []; failWrite = false;
  async read(key) { const item = this.records.get(key); return item && structuredClone(item); }
  async list() { return [...this.records.values()].map(item => structuredClone(item.entry)); }
  async write(key, data, entry) {
    if (this.failWrite) throw new DOMException('No space', 'QuotaExceededError');
    this.records.set(key, { data: data.slice(0), entry: structuredClone(entry) });
  }
  async touch(key, entry) { this.records.get(key).entry = structuredClone(entry); }
  async remove(key) { this.records.delete(key); }
  async readPins() { return [...this.pins]; }
  async writePins(pins) { this.pins = [...pins]; }
  async repair() { return 0; }
}
export const bytes = (...values) => new Uint8Array(values).buffer;
export const resource = (assetId = 'a', extra = {}) => ({ assetId, version: 'v1', url: `https://media.test/${assetId}.ts`, ...extra });
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function loaderStats() {
  return { aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };
}
