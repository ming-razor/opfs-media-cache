import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaCache } from '../dist/index.js';
import { createFlvLoader } from '../dist/adapters/flv.js';
import { MemoryStore, resource, delay } from './helpers.mjs';

const seek = {
  getConfig(url, range) { return { url, headers: range.from === 0 && range.to === -1 ? {} : { Range: `bytes=${range.from}-${range.to === -1 ? '' : range.to}` } }; },
  removeURLParameters: url => url
};
const source = { url: 'https://media.test/a.flv', duration: 1000 };
function mockServer(data, extra = {}) {
  const requests = [];
  return {
    requests,
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (extra.delay) await delay(extra.delay);
      if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
      const header = new Headers(init.headers).get('Range');
      if (extra.ignoreRange || !header) return new Response(data, { headers: { 'Content-Length': String(data.length) } });
      const [, from, to] = /bytes=(\d+)-(\d*)/.exec(header);
      const start = Number(from), end = Math.min(to ? Number(to) : data.length - 1, data.length - 1);
      if (start >= data.length) return new Response(null, { status: 416 });
      return new Response(data.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}` } });
    }
  };
}
function run(Loader, range = { from: 0, to: -1 }, config = {}, mediaSource = source) {
  const chunks = []; const starts = []; const loader = new Loader(seek, config);
  const result = new Promise((resolve, reject) => {
    loader.onDataArrival = (data, start) => { chunks.push(...new Uint8Array(data)); starts.push(start); };
    loader.onComplete = (from, to) => resolve({ chunks, starts, from, to });
    loader.onError = (type, info) => reject(new Error(info.msg));
    loader.open(mediaSource, range);
  });
  return { loader, result, chunks };
}
async function setup(data, serverOptions = {}) {
  const cache = await createMediaCache({ store: new MemoryStore() }); const server = mockServer(data, serverOptions);
  const Loader = createFlvLoader(cache, { resource: () => resource('a'), fetch: server.fetch, blockSize: 4 });
  return { cache, server, Loader };
}

test('FLV VOD aligned blocks replay entirely from cache, including exact-block EOF', async () => {
  const data = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]); const { Loader, server } = await setup(data);
  assert.deepEqual((await run(Loader).result).chunks, [...data]);
  assert.deepEqual((await run(Loader).result).chunks, [...data]); assert.equal(server.requests.length, 2);
});
test('FLV arbitrary seek reuses aligned blocks and preserves byte offsets', async () => {
  const { Loader, server } = await setup(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]));
  await run(Loader).result; const result = await run(Loader, { from: 2, to: 6 }).result;
  assert.deepEqual(result.chunks, [2, 3, 4, 5, 6]); assert.deepEqual(result.starts, [2, 4]);
  assert.equal(result.from, 2); assert.equal(result.to, 6); assert.equal(server.requests.length, 3);
});
test('live FLV streams without writing or replaying old cached data', async () => {
  const { Loader, cache, server } = await setup(new Uint8Array([1, 2, 3]));
  await run(Loader, undefined, { isLive: true }).result; await run(Loader, undefined, { isLive: true }).result;
  assert.equal((await cache.inspect()).bytes, 0); assert.equal(server.requests.length, 2);
});
test('a server ignoring Range falls back to uncached streaming from byte zero', async () => {
  const { Loader, cache, server } = await setup(new Uint8Array([1, 2, 3]), { ignoreRange: true });
  assert.deepEqual((await run(Loader).result).chunks, [1, 2, 3]);
  assert.equal((await cache.inspect()).bytes, 0); assert.equal(server.requests.length, 2);
});
test('a server ignoring a non-zero seek is rejected instead of corrupting offsets', async () => {
  const { Loader } = await setup(new Uint8Array([1, 2, 3]), { ignoreRange: true });
  await assert.rejects(run(Loader, { from: 1, to: -1 }).result, /ignored non-zero Range/);
});
test('HTTP errors and malformed ranges are not cached', async () => {
  const cache = await createMediaCache({ store: new MemoryStore() });
  for (const response of [() => new Response('no', { status: 404 }), () => new Response(new Uint8Array([1]), { status: 206, headers: { 'Content-Range': 'bytes 1-1/5' } })]) {
    const Loader = createFlvLoader(cache, { resource: () => resource('a'), fetch: async () => response(), blockSize: 4 });
    await assert.rejects(run(Loader).result);
  }
  assert.equal((await cache.inspect()).bytes, 0);
});
test('FLV abort cancels fetch and suppresses late callbacks', async () => {
  const { Loader, cache } = await setup(new Uint8Array([1, 2, 3]), { delay: 25 });
  const loader = new Loader(seek, {}); let calls = 0;
  loader.onDataArrival = loader.onComplete = loader.onError = () => calls++;
  loader.open(source, { from: 0, to: -1 }); await delay(2); loader.abort(); await delay(40);
  assert.equal(calls, 0); assert.equal((await cache.inspect()).bytes, 0);
});
test('credentials and configured headers reach the network', async () => {
  const { Loader, server } = await setup(new Uint8Array([1]));
  await run(Loader, undefined, { headers: { Authorization: 'Bearer test' } }, { ...source, withCredentials: true }).result;
  assert.equal(server.requests[0].init.credentials, 'include');
  assert.equal(new Headers(server.requests[0].init.headers).get('Authorization'), 'Bearer test');
});

test('aborting during cache lookup starts no network request', async () => {
  const store = new MemoryStore();
  store.read = async () => { await delay(20); return undefined; };
  const cache = await createMediaCache({ store });
  let requests = 0, callbacks = 0;
  const Loader = createFlvLoader(cache, {
    resource: () => resource('a'), blockSize: 4,
    fetch: async () => { requests++; throw new Error('unexpected fetch'); }
  });
  const loader = new Loader(seek, {});
  loader.onDataArrival = loader.onError = loader.onComplete = () => callbacks++;
  loader.open(source, { from: 0, to: -1 });
  await delay(2); loader.abort(); await delay(35);
  assert.equal(requests, 0); assert.equal(callbacks, 0);
});

test('aborting in content-length callback suppresses subsequent data and completion', async () => {
  const { Loader } = await setup(new Uint8Array([1, 2, 3]));
  for (const config of [{}, { isLive: true }]) {
    const loader = new Loader(seek, config); let calls = 0;
    loader.onContentLengthKnown = () => loader.abort();
    loader.onDataArrival = loader.onError = loader.onComplete = () => calls++;
    loader.open(source, { from: 0, to: -1 });
    await delay(30);
    assert.equal(calls, 0);
  }
});
