# Contributing

Use Node.js 22+, run `npm ci`, then `npm run check`. Run `npm run test:browser` when changing OPFS, loader lifecycle or playback integration. Test media can be regenerated with `npm run fixtures` when FFmpeg is installed.

Changes to cache identity, byte ranges, quota handling, eviction, pinning, error recovery or loader cancellation need behavioral regression coverage. Do not replace a passing behavioral check with an assertion that merely mirrors implementation details.

Keep business motivation, API examples and support boundaries aligned with changes. Performance claims require a reproducible workload, browser/device versions, cold/warm definitions and measurements. Do not claim greater storage quota or guaranteed permanence simply because the backend is OPFS.

Before publication, choose the repository owner, verify package-name availability, fill in the repository URL and review bundled third-party notices. This local project does not publish itself.
