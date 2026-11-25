# Contributing to videolighting

Thanks for your interest in contributing!

## Prerequisites

This project uses [Bun](https://bun.sh). Install it, then:

```bash
bun install
```

Git hooks (lint & format on commit) are installed automatically by the `prepare` script.

## Development

| Task | Command |
| --- | --- |
| Playground (reference page) | `bun run dev` |
| Playground on your LAN (phone tests) | `bun run dev:lan` |
| Type-check | `bun run typecheck` |
| Unit tests | `bun run test` |
| End-to-end tests (Chromium, Firefox, WebKit) | `bun run test:e2e` |
| Lint & format | `bun run check` (or `bun run fix` to auto-fix) |
| Build | `bun run build` |
| Validate the npm package | `bun run lint:pkg` |

Before opening a PR, make sure `check`, `typecheck`, `test`, `test:e2e` and `build` pass.
The CI runs them.

## Tests

Few tests, all meaningful. End-to-end tests come first: a unit test exists only where an
end-to-end test cannot cover the behavior. Everything lives under `test/`.

Tests of speed (frame rate, time budgets) are tagged `@perf`. A shared CI runner has no GPU, so the
CI leaves them out and runs Chromium and Firefox; run everything on the three engines on your machine with
`bun run test:e2e` (Firefox runs in the CI too; WebKit runs every night and from the Actions tab, "E2E").

## Releasing

1. Run `bun run check`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run lint:pkg` locally.
2. Bump `version` in `package.json`, add the entry to `CHANGELOG.md`, commit and push.
3. Publish a GitHub Release (tag `vX.Y.Z`): the `Release` workflow publishes to npm with provenance.

## Pull requests

- Branch from `master`.
- Keep changes focused: one logical change per PR.
- The CI must be green before a PR can be merged.

## Project layout

- `src/core`: reading the frames and the colors (shared by every effect)
- `src/halo`, `src/ambient`, `src/theme`: the three effects
- `src/react`: the React components and hooks
- `playground/`: tools for developing the plugin (not published)
- `test/unit`, `test/end-to-end`: the tests
