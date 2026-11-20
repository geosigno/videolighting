# Contributing to videoLighting

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
end-to-end test cannot cover the behaviour. Everything lives under `test/`.

## Pull requests

- Branch from `master`.
- Keep changes focused: one logical change per PR.
- The CI must be green before a PR can be merged.

## Project layout

- `src/core`: reading the frames and the colours (shared by every effect)
- `src/halo`, `src/ambient`, `src/theme`: the three effects
- `src/react`: the React components and hooks
- `playground/`: tools for developing the plugin (not published)
- `test/unit`, `test/end-to-end`: the tests
