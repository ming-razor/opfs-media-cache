import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaCache } from '../dist/index.js';
import { createHlsLoader } from '../dist/adapters/hls.js';
import { MemoryStore, resource, bytes, delay, loaderStats } from './helpers.mjs';

function setup(extra = {}) {
  let requests = 0, aborts = 0;
  class Upstream {
    stats = loaderStats();
    load(context, config, cb) {
      if (this.stats.loading.start) throw new Error('Loader can only be used once.');
      this.stats.loading.start = performance.now();
      requests++; this.context = context; this.cb = cb;
      const result = context.responseType === 'arraybuffer' ? bytes(1, 2, 3) : '#EXTM3U';
      this.timer = setTimeout(() => cb.onSuccess({ url: context.url, data: result, code: 200 }, this.stats, context, null), 3);
    }
    abort() { aborts++; clearTimeout(this.timer); this.cb?.onAbort?.(this.stats, this.context, null); }
    destroy() { clearTimeout(this.timer); }
  }
  return { Upstream, requests: () => requests, aborts: () => aborts, ...extra };
}
const fragment = { url: 'https://media.test/a.ts', responseType: 'arraybuffer', frag: {}, part: null };
const load = (Ctor, context = fragment) => new Promise((resolve, reject) => {
  const loader = new Ctor({}); loader.load(context, {}, { onSuccess: resolve, onError: reject, onTimeout: reject });
});
const resolveResource = context => resource('a', { url: context.url });

test('HLS preserves upstream single-use lifecycle and reuses committed bytes on second load', async () => {
  const state = setup(); const cache = await createMediaCache({ store: new MemoryStore() });
  const Loader = createHlsLoader(state.Upstream, cache, { resource: resolveResource });
  await load(Loader); await cache.flush(); const result = await load(Loader);
  assert.equal(state.requests(), 1); assert.deepEqual(result.data, bytes(1, 2, 3));
});
test('HLS converts exclusive rangeEnd to inclusive cache identity', async () => {
  const state = setup(); const cache = await createMediaCache({ store: new MemoryStore() });
  const Loader = createHlsLoader(state.Upstream, cache, { resource: resolveResource });
  await load(Loader, { ...fragment, rangeStart: 5, rangeEnd: 8 }); await cache.flush();
  assert.deepEqual((await cache.inspect()).entries[0].resource.range, [5, 7]);
});
test('playlists, encryption keys and LL-HLS parts bypass persistence by default', async () => {
  const state = setup(); const cache = await createMediaCache({ store: new MemoryStore() });
  const Loader = createHlsLoader(state.Upstream, cache, { resource: resolveResource });
  for (const context of [{ url: 'https://media.test/a.m3u8?token=x', responseType: 'text' }, { ...fragment, keyInfo: {} }, { ...fragment, part: {} }]) { await load(Loader, context); await load(Loader, context); }
  await cache.flush(); assert.equal(state.requests(), 6); assert.equal((await cache.inspect()).bytes, 0);
});
test('explicit immutable VOD playlist caching works with query strings', async () => {
  const state = setup(); const cache = await createMediaCache({ store: new MemoryStore() });
  const Loader = createHlsLoader(state.Upstream, cache, { resource: resolveResource, cachePlaylists: true });
  const ctx = { url: 'https://media.test/a.m3u8?token=x', responseType: 'text' };
  await load(Loader, ctx); await cache.flush(); assert.equal((await load(Loader, ctx)).data, '#EXTM3U'); assert.equal(state.requests(), 1);
});
test('abort during cache lookup emits one abort and no late success', async () => {
  const store = new MemoryStore(); store.read = async () => { await delay(20); return undefined; };
  const state = setup(); const cache = await createMediaCache({ store });
  const Loader = createHlsLoader(state.Upstream, cache, { resource: resolveResource });
  const loader = new Loader({}); let successes = 0, aborts = 0;
  loader.load(fragment, {}, { onSuccess() { successes++; }, onError() {}, onTimeout() {}, onAbort() { aborts++; } });
  loader.abort(); loader.destroy(); await delay(40);
  assert.equal(successes, 0); assert.equal(aborts, 1); assert.equal(state.requests(), 0);
});
test('abort during network delegates cancellation and does not double notify', async () => {
  const state = setup(); const cache = await createMediaCache({ store: new MemoryStore() });
  const Loader = createHlsLoader(state.Upstream, cache, { resource: () => undefined });
  const loader = new Loader({}); let aborts = 0, successes = 0;
  loader.load(fragment, {}, { onSuccess() { successes++; }, onError() {}, onTimeout() {}, onAbort() { aborts++; } });
  await delay(1); loader.abort(); await delay(10);
  assert.equal(aborts, 1); assert.equal(successes, 0); assert.equal(state.aborts(), 1);
});
test('bounded cache lookup falls back to the network', async () => {
  const store = new MemoryStore(); store.read = async () => { await delay(30); return undefined; };
  const state = setup(); const cache = await createMediaCache({ store });
  const Loader = createHlsLoader(state.Upstream, cache, { resource: resolveResource, lookupTimeoutMs: 1 });
  await load(Loader); assert.equal(state.requests(), 1); await cache.flush();
});

test('relative VOD playlist cache returns an absolute URI base for referenced fragments', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://media.test/demo/' } });
  try {
    const state = setup(); const cache = await createMediaCache({ store: new MemoryStore() });
    const Loader = createHlsLoader(state.Upstream, cache, { resource: resolveResource, cachePlaylists: true });
    const context = { url: '/media/a.m3u8', responseType: 'text' };
    await load(Loader, context); await cache.flush();
    assert.equal((await load(Loader, context)).url, 'https://media.test/media/a.m3u8');
    assert.equal(state.requests(), 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
  }
});
