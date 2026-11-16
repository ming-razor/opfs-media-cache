import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const served = { hls: 0, flv: 0 };
const server = await createServer({
  root: `${root}/demo`, configFile: false,
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
  plugins: [{ name: 'uncached-fixtures', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/media/')) {
        res.setHeader('Cache-Control', 'no-store');
        if (req.url.endsWith('.flv')) served.flv++;
        else served.hls++;
      }
      next();
    });
  } }]
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
    headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.error('Browser error:', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  page.on('requestfailed', request => console.error('Request failed:', request.url(), request.failure()?.errorText));
  await page.goto(url);
  await page.waitForFunction(() => !!window.demo);
  assert.equal(await page.evaluate(() => window.demo.cache.available), true);
  await page.evaluate(() => window.demo.cache.clear());
  const results = {};
  for (const kind of ['hls', 'flv']) {
    await context.setOffline(false);
    await page.evaluate(kind => window.demo.play(kind), kind);
    await page.waitForFunction(() => window.demo.ended || window.demo.errors.length > 0, undefined, { timeout: 20000 });
    assert.deepEqual(await page.evaluate(() => window.demo.errors), []);
    assert.equal(await page.evaluate(() => window.demo.ended), true);
    await page.evaluate(() => window.demo.cache.flush());
    const first = await page.evaluate(() => window.demo.refresh());
    console.log(`${kind} first-play cached entries:`, first.entries.map(entry => entry.resource.url));
    const requests = served[kind];
    assert.ok(requests > 0, `${kind} first playback must use the network`);
    await page.reload();
    await page.waitForFunction(() => !!window.demo);
    await context.setOffline(true);
    await page.evaluate(kind => window.demo.play(kind), kind);
    await page.waitForFunction(() => window.demo.ended || window.demo.errors.length > 0, undefined, { timeout: 20000 });
    assert.deepEqual(await page.evaluate(() => window.demo.errors), []);
    assert.equal(await page.evaluate(() => window.demo.ended), true);
    assert.equal(served[kind], requests, `${kind} offline replay must not download media`);
    const replay = await page.evaluate(() => window.demo.refresh());
    assert.ok(replay.counters.hits > 0);
    results[kind] = { initialMediaRequests: requests, replayMediaRequests: served[kind] - requests, storedBytes: first.bytes, replayCacheHits: replay.counters.hits };
    await context.setOffline(false);
  }
  // Simulate a crash before metadata commit; a fresh instance must discard the orphan.
  await page.evaluate(async () => {
    window.demo.stop();
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle('opfs-media-cache-v1');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('demo-public-v1'));
    const namespace = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    const owned = await base.getDirectoryHandle(namespace);
    const orphan = await owned.getDirectoryHandle('a'.repeat(64), { create: true });
    const writer = await (await orphan.getFileHandle('data', { create: true })).createWritable();
    await writer.write(new Uint8Array([1, 2, 3])); await writer.close();
  });
  await page.reload(); await page.waitForFunction(() => !!window.demo);
  const orphanSurvived = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle('opfs-media-cache-v1');
    for await (const [, directory] of base.entries()) {
      try { await directory.getDirectoryHandle('a'.repeat(64)); return true; } catch {}
    }
    return false;
  });
  assert.equal(orphanSurvived, false);
  assert.deepEqual(pageErrors, []);
  mkdirSync(`${root}/artifacts`, { recursive: true });
  await page.screenshot({ path: `${root}/artifacts/demo.png`, fullPage: true });
  console.log(JSON.stringify({ browser: await browser.version(), results, crashRecovery: 'passed', pageErrors }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
