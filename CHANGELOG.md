# Changelog

## 0.1.0 — unreleased

- Rewrite the Chinese and English guides around setup, usage and cache management.
- Preserve completed HLS statistics when the loader is destroyed.
- Keep network-only fallback working without Web Crypto.
- Snapshot resource identities before asynchronous writes and validate queue/deadline settings.
- Stop FLV callbacks and new requests after cancellation during cache lookup or length callbacks.

- Add namespace-scoped OPFS storage with integrity validation and commit metadata.
- Add logical byte budgets, LRU, TTL, persistent asset pinning and observable fallback.
- Add HLS.js loader decoration and flv.js Range-block loading with live bypass.
- Add TypeScript declarations, synthetic fixtures, a local demo, regression tests and Chromium replay/recovery checks.
