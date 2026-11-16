# OPFS Media Cache

[中文](README.md) · [API](docs/API.md) · [Test results](docs/VALIDATION.md)

Local disk caching for HLS.js and flv.js. Media segments are saved to the Origin Private File System (OPFS) during playback and reused on subsequent plays.

The project started with a video wall that cycled through several large videos. The browser's HTTP cache could not reliably retain the full playlist, so later rotations downloaded the same content again. This library lets the application control the cache budget, retained videos and content versions.

## Features

- HLS segment caching and aligned HTTP Range blocks for FLV VOD.
- Byte budgets, LRU eviction, TTL and asset pinning for video playlists.
- Versioned resource identities and content integrity checks.
- Network fallback when cached files are missing, damaged or unavailable.
- TypeScript interfaces and player loader adapters; no Service Worker setup required.

## Try the demo

Requires Node.js 22+.

```sh
git clone https://github.com/ming-razor/opfs-media-cache.git
cd opfs-media-cache
npm ci
npm run demo
```

Play either sample, reload the page and play again to see cache hits. Once its playlist and media have been saved, the sample can also play offline.

Version 0.1.0 is available from this repository. For use in another project, run `npm pack` and install the generated tarball. The npm release is still pending. Install HLS.js or flv.js separately as needed.

## HLS.js

```ts
import Hls from 'hls.js';
import { createMediaCache } from 'opfs-media-cache';
import { createHlsLoader } from 'opfs-media-cache/hls';

const cache = await createMediaCache({
  namespace: 'screen-videos',
  maxBytes: 2 * 1024 ** 3
});
await cache.setPinnedAssets(['intro']);

const hls = new Hls({
  loader: createHlsLoader(Hls.DefaultConfig.loader, cache, {
    resource: context => ({
      assetId: 'intro', version: 'v1', url: context.url
    })
  })
});
hls.loadSource('/videos/intro/index.m3u8');
hls.attachMedia(document.querySelector('video')!);
```

Media segments are cached by default. Set `cachePlaylists: true` for immutable VOD playlists if offline replay is needed. Keep playlist caching disabled for live streams. Change `version` when the media changes.

For FLV, use `createFlvLoader` from `opfs-media-cache/flv` as the player's `customLoader`. It caches aligned Range blocks for HTTP FLV VOD. Live streams and parameter-based seeks use the network. See the [Chinese README](README.md#接入-flvjs) for the complete example.

## Deployment

Use HTTPS or localhost with OPFS file support. Playback tests currently run on Chrome and Chromium. If OPFS is unavailable, loading falls back to the network. Cache capacity is subject to the browser's origin quota and available disk space.

FLV caching requires valid `206 Content-Range` responses. Cross-origin servers must expose the `Content-Range` header. Web Locks coordinates cache access across tabs; without it, operations are serialized within each cache instance.

Keep `namespace` or `variant` separate for user-specific media and clear that data on logout. Pinning prevents budget eviction; expiration and explicit deletion still apply. Local cache timings can affect adaptive-bitrate estimates, so fixed-bitrate video playlists are the initial focus.

Native HLS interception, WebSocket FLV, DRM offline playback and LL-HLS partial-segment persistence are outside the current adapter support. Storage backends for IndexedDB and Cache Storage are planned; custom implementations can already be injected through the `MediaStore` interface.

## Development

```sh
npm run check
npm run test:browser
npm run fixtures
npm pack --dry-run
```

The browser test checks first playback, page reload, offline replay and recovery of an incomplete cache entry. On macOS it uses an installed Chrome; elsewhere install Playwright Chromium or set `CHROME_PATH`. See [the test record](docs/VALIDATION.md) for the workload and results.

## Acknowledgments

Player integrations use [HLS.js](https://github.com/video-dev/hls.js) and [flv.js](https://github.com/bilibili/flv.js). The storage design draws on [Shaka Player](https://github.com/shaka-project/shaka-player) and [hls-movie-player-with-cache](https://github.com/code4fukui/hls-movie-player-with-cache).

[MIT License](LICENSE) · [Dependency notices](NOTICE.md)
