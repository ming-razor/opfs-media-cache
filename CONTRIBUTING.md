# Contributing

Use Node.js 22 or later.

```sh
npm ci
npm run check
npm run test:browser
```

`check` runs the type checks, regression suite and demo build. The browser suite checks playback against real OPFS storage. Run it when changing a loader, file handling or cache lifecycle. Test fixtures can be regenerated with FFmpeg using `npm run fixtures`.

Please include a regression test for changes to resource identity, byte ranges, cancellation, eviction or recovery. Keep the API documentation and examples in sync with the implementation.

For storage backend work, start with `MediaStore` in `src/types.ts`. Keep persistence details in the store and playback logic in the adapters. A new backend should pass the same cache behavior tests before adding backend-specific cases.

Performance reports are welcome. Include the browser and device, video sizes, cache state and steps needed to reproduce the results. For bugs, a small media sample or a minimal reproduction is especially helpful.

See [RELEASING.md](docs/RELEASING.md) for the release process.
