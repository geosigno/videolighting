# Changelog

## 1.0.0

First stable release. The package is now **`videolighting`** (it was `videolight` during the alpha).

### Migrating from `videolight@0.1.0-alpha`

| Alpha | 1.0.0 |
| --- | --- |
| package `videolight` | package `videolighting` |
| `GlowProvider`, `GlowProviderProps` | `LightingProvider`, `LightingProviderProps` |
| `--glow-reach`, `--glow-opacity` | `--vl-reach`, `--vl-opacity` |
| `--glow-primary`, `--glow-secondary`, `--glow-mean` | `--vl-primary`, `--vl-secondary`, `--vl-mean` |
| `data-glow` attribute | `data-vl` |
| error messages prefixed `glow:` | prefixed `videolighting:` |

Removed from the public API (now internal): `createGlow`, `Glow`, `watchVideo`, `sampleEdges`,
`EDGE_POINTS`, `SampleCost`, `EdgeColors`, `WatchOptions`, `useGlow`, `glowComponent`,
`GlowComponentProps`, `GlowTargets`. `--video-primary` and `--video-secondary` (the `theme` effect) are unchanged.

### Changes

- A browser without `requestVideoFrameCallback` reports it through `onError` instead of throwing.
- A worker blocked by a Content-Security-Policy no longer stalls the read: it carries on on the main thread.
- Under `prefers-reduced-motion`, the halo repaints at most once a second.
