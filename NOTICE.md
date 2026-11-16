# Dependencies and acknowledgments

OPFS Media Cache is MIT licensed.

The player adapters use the public loader APIs of these optional peer dependencies:

| Dependency | License |
| --- | --- |
| [HLS.js](https://github.com/video-dev/hls.js) | Apache-2.0 |
| [flv.js](https://github.com/bilibili/flv.js) | Apache-2.0 |

Development dependencies include TypeScript and Playwright (Apache-2.0), and Vite (MIT). Their license files are included with the installed packages. Player code and the demo bundle are excluded from the library tarball; when distributing the built demo, retain the bundled dependencies' notices.

The cache design draws on [Shaka Player](https://github.com/shaka-project/shaka-player) (Apache-2.0) and [hls-movie-player-with-cache](https://github.com/code4fukui/hls-movie-player-with-cache) (MIT).

The media in `demo/public/media` is generated from FFmpeg test sources. See `scripts/generate-fixtures.mjs` to regenerate it.
