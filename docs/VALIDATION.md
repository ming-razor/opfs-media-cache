# Validation record

Local verification date: **2026-11-17 (Asia/Shanghai)**.

Environment: macOS, Node.js 22.20.0, TypeScript 5.9.3, HLS.js 1.7.4, flv.js 1.6.2, Google Chrome 157.0.8103.51. Dependency resolution is recorded in package-lock.json.

## Checks

- `npm run typecheck`: library declarations and actual demo player integrations.
- `npm test`: 31 behavioral regression tests using an injected in-memory Store. Covers identity/version/range isolation, TTL, LRU, pinning, admission, quota failure, corruption, bounded writes, cleanup, cancellation, loader transport preservation, relative playlist bases, Range validation, seeking and live bypass.
- `npm run demo:build`: production build of the demonstration.
- `npm run test:browser`: isolated real Chrome and OPFS; original synthetic four-second HLS/FLV fixtures. The fixture server applies `Cache-Control: no-store`.
- `npm pack --dry-run`: package exports, declarations and distributable file list.

## Real-browser results

| Format | First-play media HTTP requests | After reload, offline replay media HTTP requests | Offline cache hits |
| --- | ---: | ---: | ---: |
| HLS (one playlist + four segments) | 5 | 0 | 5 |
| FLV (64 KiB blocks) | 6 | 0 | 6 |

Both replays reached the media ended event with no player/page errors. The HLS data totaled 375,489 logical stored bytes. After both formats, the namespace held 731,486 logical stored bytes; this includes FLV's per-block length headers and excludes filesystem/JSON overhead.

The browser test also inserted an OPFS directory containing only `data`, then reloaded the page. Initialization removed that uncommitted directory.

## Limits of this record

This is a correctness smoke test on small fixtures, not a throughput, memory, large-playlist or cross-backend benchmark. It does not certify Safari, Firefox, older Chromium, native HLS, DRM, LL-HLS, WebSocket FLV, long-running multi-tab contention or arbitrary live streams. This record describes local validation. Consult GitHub Actions for the current remote CI status. Source repository: https://github.com/ming-razor/opfs-media-cache. No npm release has been created.
