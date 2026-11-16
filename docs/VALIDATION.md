# Test results

Verified locally on **2026-11-17** with Node.js 22.20.0, TypeScript 5.9.3, HLS.js 1.7.4, flv.js 1.6.2 and Google Chrome 157.0.8103.51. Resolved dependencies are recorded in `package-lock.json`.

## Running the checks

```sh
npm run check
npm run test:browser
npm pack --dry-run
```

The regression suite has 38 cases covering cache identity, versions, byte ranges, TTL, LRU, pinning, write budgets, quota errors, corruption recovery and loader cancellation. It also checks completed HLS statistics after destruction, network-only fallback without Web Crypto, and writes whose caller reuses a resource object.

The browser suite uses real OPFS storage and four-second videos generated from FFmpeg test sources. The test server sends `Cache-Control: no-store` for the media. Each format is played once, the page is reloaded, and playback is repeated offline.

## Playback results

| Format | First-play media requests | Offline replay requests | Offline cache hits |
| --- | ---: | ---: | ---: |
| HLS: one playlist and four segments | 5 | 0 | 5 |
| FLV: 64 KiB blocks | 6 | 0 | 6 |

Both formats reached the ended event without player or page errors. HLS used 375,489 stored bytes; the namespace used 731,486 bytes after both formats, including FLV block headers. File metadata and temporary writes are counted separately by the browser.

The suite also creates a data file without its commit metadata, reloads the page and checks that initialization removes the incomplete entry.

## Coverage

These checks cover playback and cache recovery on small fixtures. Large playlists, long-running workloads, Safari/Firefox playback and cross-backend performance comparisons are still to be tested.

[GitHub Actions](https://github.com/ming-razor/opfs-media-cache/actions) runs the type checks, regression suite, demo build, Chromium playback tests and package check on Linux.
