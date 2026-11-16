import Hls from 'hls.js';
import flvjs from 'flv.js';
import { createMediaCache } from '../src/index.js';
import { createHlsLoader } from '../src/adapters/hls.js';
import { createFlvLoader } from '../src/adapters/flv.js';
import type { CacheEvent } from '../src/types.js';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = el<HTMLVideoElement>('video');
const logs: string[] = [];
const errors: string[] = [];
let hls: Hls | undefined;
let flv: ReturnType<typeof flvjs.createPlayer> | undefined;
let ended = false;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function log(event: CacheEvent) {
  const label = event.resource ? `${event.resource.assetId} ${event.resource.range?.join('-') ?? event.resource.url.split('/').pop()}` : '';
  logs.unshift(`${new Date().toLocaleTimeString()}  ${event.type.padEnd(6)} ${label} ${event.reason ?? ''}`);
  el('log').textContent = logs.slice(0, 60).join('\n');
  clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh(), 50);
}
const cache = await createMediaCache({ namespace: 'demo-public-v1', maxBytes: 128 * 1024 ** 2, onEvent: log });
await cache.setPinnedAssets(['demo-hls', 'demo-flv']);
const resource = (assetId: string, url: string) => ({ assetId, version: 'synthetic-v1', url, variant: 'public' });

async function refresh() {
  const info = await cache.inspect();
  el('backend').textContent = info.available ? 'OPFS 已连接' : '网络模式 · OPFS 不可用';
  el('hits').textContent = String(info.counters.hits);
  el('bytes').textContent = `${(info.bytes / 1024).toFixed(1)} KB`;
  el('entries').textContent = String(info.entries.length);
  el('evictions').textContent = String(info.counters.evictions);
  el('quota').textContent = info.quota?.quota ? `站点配额估算 ${(info.quota.quota / 1024 ** 3).toFixed(1)} GB；演示预算 128 MB。` : '';
  return info;
}
function stop() {
  video.pause(); hls?.destroy(); hls = undefined;
  flv?.destroy(); flv = undefined;
  video.removeAttribute('src'); video.load();
  el('playback').textContent = '已停止';
}
async function play(kind: 'hls' | 'flv') {
  stop(); ended = false; errors.length = 0;
  el('playback').textContent = `正在播放 ${kind.toUpperCase()}`;
  if (kind === 'hls') {
    if (!Hls.isSupported()) throw new Error('本演示需要支持 HLS.js / MSE 的浏览器');
    hls = new Hls({
      enableWorker: false,
      loader: createHlsLoader(Hls.DefaultConfig.loader, cache, {
        resource: context => resource('demo-hls', context.url),
        // These generated fixtures are immutable VOD, including their playlist.
        cachePlaylists: true
      })
    });
    hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) errors.push(data.details); });
    hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(report); });
    hls.loadSource('/media/sample.m3u8'); hls.attachMedia(video);
  } else {
    if (!flvjs.isSupported()) throw new Error('本演示需要支持 flv.js / MSE 的浏览器');
    flv = flvjs.createPlayer({ type: 'flv', url: new URL('/media/sample.flv', location.href).href, isLive: false }, {
      enableWorker: false, lazyLoad: false,
      customLoader: createFlvLoader(cache, { resource: source => resource('demo-flv', source.url), blockSize: 64 * 1024 })
    });
    flv.on(flvjs.Events.ERROR, (...args: unknown[]) => errors.push(args.map(String).join(' ')));
    flv.attachMediaElement(video); flv.load(); await video.play();
  }
}
function report(error: unknown) { const message = String(error); errors.push(message); el('playback').textContent = message; }
video.addEventListener('ended', () => { ended = true; el('playback').textContent = '播放完成 · 可以刷新后重播'; void cache.flush().then(refresh); });
el('hls').onclick = () => { void play('hls').catch(report); };
el('flv').onclick = () => { void play('flv').catch(report); };
el('stop').onclick = stop;
el('clear').onclick = () => { stop(); void cache.clear().then(refresh).catch(report); };
el<HTMLInputElement>('pin').onchange = event => { void cache.setPinnedAssets((event.target as HTMLInputElement).checked ? ['demo-hls', 'demo-flv'] : []).then(refresh); };
await refresh();
el('playback').textContent = '选择一种格式开始';

// Inspectable API used by the browser smoke test; no application internals are required.
Object.assign(window, { demo: { cache, play, stop, refresh, errors, get ended() { return ended; } } });
