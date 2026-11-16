# Attribution and dependencies

The cache implementation in this repository was written for this project. No source files from the design-reference repositories were copied or modified.

Design references:

- Shaka Player, https://github.com/shaka-project/shaka-player — Apache-2.0; offline storage lifecycle and pluggable storage architecture.
- hls-movie-player-with-cache, https://github.com/code4fukui/hls-movie-player-with-cache — MIT; HLS persistent caching and cache-first playback.

Optional peer/development dependencies retain their own licenses:

- HLS.js, https://github.com/video-dev/hls.js — Apache-2.0.
- flv.js, https://github.com/bilibili/flv.js — Apache-2.0.
- TypeScript and Playwright — Apache-2.0.
- Vite — MIT.

The published library package excludes player implementations and demo bundles. If redistributing a built demo, preserve the licenses/notices supplied with its bundled dependencies. `demo/public/media` contains synthetic test content generated with FFmpeg test sources; it contains no downloaded third-party footage.
