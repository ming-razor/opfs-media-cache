import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaCache, resourceKey } from '../dist/index.js';
import { MemoryStore, bytes, resource } from './helpers.mjs';

const create = (extra = {}) => createMediaCache({ store: new MemoryStore(), maxBytes: 12, maxEntryBytes: 8, ...extra });

test('round-trip bytes, stable identity, and caller buffer isolation', async () => {
  const cache = await create(); const input = bytes(1, 2, 3);
  const pending = cache.put(resource(), input); new Uint8Array(input)[0] = 9;
  assert.equal(await pending, true);
  assert.deepEqual(await cache.get(resource()), bytes(1, 2, 3));
  assert.equal((await cache.inspect()).counters.hitBytes, 3);
});
test('versions, byte ranges, complete URL and variants do not alias', async () => {
  const cache = await create(); await cache.put(resource(), bytes(1));
  for (const extra of [{ version: 'v2' }, { range: [0, 0] }, { url: 'https://other.test/a.ts' }, { variant: 'other-user' }]) assert.equal(await cache.get(resource('a', extra)), undefined);
});
test('TTL expires pinned and ordinary resources', async () => {
  let now = 1; const cache = await create({ now: () => now, ttlMs: 10 });
  await cache.setPinnedAssets(['a']); await cache.put(resource(), bytes(1)); now = 11;
  assert.equal(await cache.get(resource()), undefined); assert.equal((await cache.inspect()).bytes, 0);
});
test('LRU uses access times and budget is respected', async () => {
  let now = 1; const cache = await create({ maxBytes: 6, now: () => now++ });
  await cache.put(resource('a'), bytes(1, 1, 1)); await cache.put(resource('b'), bytes(2, 2, 2));
  await cache.get(resource('a')); await cache.put(resource('c'), bytes(3, 3, 3));
  assert.equal(await cache.get(resource('b')), undefined); assert.ok(await cache.get(resource('a'))); assert.equal((await cache.inspect()).bytes, 6);
});
test('pinned playlist is not evicted; infeasible writes do not churn other entries', async () => {
  const cache = await create({ maxBytes: 6 }); await cache.setPinnedAssets(['a']);
  await cache.put(resource('a'), bytes(1, 1, 1, 1)); await cache.put(resource('b'), bytes(2));
  assert.equal(await cache.put(resource('c'), bytes(3, 3, 3)), false);
  assert.ok(await cache.get(resource('b'))); assert.ok(await cache.get(resource('a')));
});
test('oversize admission does not evict existing cache', async () => {
  const cache = await create(); await cache.put(resource('a'), bytes(1));
  assert.equal(await cache.put(resource('b'), new ArrayBuffer(9)), false);
  assert.ok(await cache.get(resource('a')));
});
test('quota failure is observable and returns false', async () => {
  const events = []; const store = new MemoryStore(); store.failWrite = true;
  const cache = await create({ store, onEvent: event => events.push(event) });
  assert.equal(await cache.put(resource(), bytes(1)), false); assert.equal(events.at(-1).reason, 'write');
});
test('same-length corruption is detected, removed and treated as a miss', async () => {
  const store = new MemoryStore(); const cache = await create({ store }); await cache.put(resource(), bytes(1));
  new Uint8Array([...store.records.values()][0].data)[0] = 7;
  assert.equal(await cache.get(resource()), undefined); assert.equal(store.records.size, 0);
});
test('broken access-time updates preserve playable cached bytes', async () => {
  const store = new MemoryStore(); const cache = await create({ store }); await cache.put(resource(), bytes(1));
  store.touch = async () => { throw new Error('disk unavailable'); };
  assert.deepEqual(await cache.get(resource()), bytes(1));
});
test('background writes are bounded and flush observes committed data', async () => {
  const events = []; const cache = await create({ maxPendingWriteBytes: 2, onEvent: event => events.push(event) });
  cache.enqueuePut(resource('a'), bytes(1, 2)); cache.enqueuePut(resource('b'), bytes(3));
  await cache.flush(); assert.deepEqual(await cache.get(resource('a')), bytes(1, 2));
  assert.equal(await cache.get(resource('b')), undefined); assert.ok(events.some(event => event.reason === 'write-backpressure'));
});
test('removeAsset and clear wait for scheduled writes and stay namespace-local', async () => {
  const cache = await create(); cache.enqueuePut(resource('a'), bytes(1)); await cache.removeAsset('a');
  assert.equal((await cache.inspect()).bytes, 0);
  cache.enqueuePut(resource('b'), bytes(2)); await cache.clear(); assert.equal((await cache.inspect()).bytes, 0);
});
test('concurrent writes serialize budget accounting', async () => {
  const cache = await create({ maxBytes: 4 });
  await Promise.all(['a', 'b', 'c'].map(id => cache.put(resource(id), bytes(1, 2, 3))));
  assert.equal((await cache.inspect()).bytes, 3);
});
test('OPFS unavailable degrades to network-only without hidden memory persistence', async () => {
  const cache = await createMediaCache(); assert.equal(cache.available, false);
  assert.equal(await cache.get(resource()), undefined); assert.equal(await cache.put(resource(), bytes(1)), false);
});
test('observer exceptions do not break storage', async () => {
  const cache = await create({ onEvent() { throw new Error('consumer'); } });
  assert.equal(await cache.put(resource(), bytes(1)), true); assert.ok(await cache.get(resource()));
});
test('invalid keys and budgets are rejected', async () => {
  assert.throws(() => resourceKey(resource('a', { range: [3, 2] })), RangeError);
  assert.throws(() => resourceKey(resource('a', { version: '' })), TypeError);
  await assert.rejects(create({ maxBytes: -1 }), RangeError);
});

test('disabled storage stays usable when Web Crypto is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    const cache = await createMediaCache();
    assert.equal(cache.available, false);
    assert.equal(await cache.get(resource()), undefined);
    assert.equal(await cache.put(resource(), bytes(1)), false);
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});

test('pending write budget rejects invalid values', async () => {
  for (const value of [0, -1, NaN, Infinity, 0.5]) {
    await assert.rejects(create({ maxPendingWriteBytes: value }), RangeError);
  }
});

test('an in-flight write keeps its original identity when the caller changes the object', async () => {
  const cache = await create();
  const original = resource('a', { range: [0, 0] });
  const expected = structuredClone(original);
  const task = cache.put(original, bytes(1));
  original.assetId = 'b'; original.range[0] = 1; original.range[1] = 1;
  assert.equal(await task, true);
  const { entries } = await cache.inspect();
  assert.deepEqual(entries[0].resource, expected);
  assert.deepEqual(await cache.get(expected), bytes(1));
});
