# OPFS Media Cache

Application-managed persistent media caching for video playlists, built with TypeScript and the Origin Private File System.

Source: [ming-razor/opfs-media-cache](https://github.com/ming-razor/opfs-media-cache). This is an **experimental v0.1.0 project**, not an existing npm release. See [the Chinese README](README.md) for complete examples and limitations.

## Features

- A HLS.js loader decorator: upstream networking and cancellation, versioned segment caching, inclusive byte-range identities, bounded asynchronous writes. Immutable VOD playlists can be cached explicitly; live playlists, encryption keys and LL-HLS parts are not persisted by default.
- A flv.js custom loader: aligned HTTP Range blocks for VOD, seek reuse, cached file length and bounded per-block buffering. Live FLV and parameter-based seeks use uncached streaming.
- OPFS files with commit metadata, SHA-256 validation, orphan cleanup, logical byte budgets, LRU, TTL and persistent asset pinning.
- Namespace-scoped Web Locks when available; storage failures fall back to normal networking.
- A local demo with original synthetic HLS/FLV fixtures and Chromium refresh/offline replay checks.

## Run locally

Requires Node.js 22+.

```sh
npm ci
npm run check
npm run demo
npm run test:browser
npm pack --dry-run
```

On macOS the browser test uses an installed Google Chrome. Elsewhere install Playwright Chromium using `npx playwright install --with-deps chromium`, or specify `CHROME_PATH`.

The core exports `createMediaCache`, `MediaCache`, `OpfsStore` and TypeScript interfaces. Import adapters from `opfs-media-cache/hls` and `opfs-media-cache/flv`. Players are optional peer dependencies and are not bundled into the core library. Package locally with `npm pack` before installing in another project.

## Design boundaries

OPFS does **not** grant a larger independent storage quota than IndexedDB or Cache Storage. All share browser-managed origin storage constraints. No benchmark establishes a performance win for this implementation.

Callers must maintain immutable content versions and partition authenticated variants. Pinning prevents automatic budget eviction, not TTL expiration, explicit clearing or browser storage eviction; it does not pre-download assets. Pinning more media than the budget cannot guarantee full cache coverage.

The current implementation uses asynchronous writable files, not Worker SyncAccessHandles. HLS buffers one complete fragment before storage; FLV buffers one range block. Local-cache timing can affect adaptive-bitrate estimates, so fixed-representation playlists are the initial target.

HTTPS/localhost and compatible OPFS file APIs are required. Without Web Locks, only single-instance serialization is provided. Safari/Firefox playback combinations have not been certified. There is no Service Worker, native HLS interception, DRM offline-license implementation, WebSocket FLV cache, full HLS prefetcher or cross-instance network deduplication.

## Acknowledgments

Design references: [Shaka Player](https://github.com/shaka-project/shaka-player) and [hls-movie-player-with-cache](https://github.com/code4fukui/hls-movie-player-with-cache). This project is a new implementation, not copied code. Player integrations use the official [HLS.js](https://github.com/video-dev/hls.js) and [flv.js](https://github.com/bilibili/flv.js) loader contracts.

MIT licensed. See [NOTICE.md](NOTICE.md).
