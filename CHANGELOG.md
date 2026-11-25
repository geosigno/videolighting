# Changelog

## 1.0.0

First stable release, in preparation: `1.0.0-alpha.2` is on npm. The package is now **`videolighting`** (it was `videolight` up to `0.1.0-alpha`).

Between `1.0.0-alpha.1` and `1.0.0-alpha.2`, the `variant` option and the shape of `Colors` changed (see the last points of the list below).

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

- `theme` writes its variables at most 10 times a second instead of on every display frame. They are inherited, so each write restyles everything under the themed element: on a page of 777 elements a write per frame cost half a core and gigabytes of memory in Chrome.
- `ambient` (blobs) changes color at most 30 times a second instead of on every display frame: each change repaints the three blobs.
- A browser without `requestVideoFrameCallback` reports it through `onError` instead of throwing.
- A worker blocked by a Content-Security-Policy no longer stalls the read: it carries on on the main thread.
- Under `prefers-reduced-motion`, the halo repaints at most once a second.
- `halo`, `ambient` and `theme` take the same `variant`, each on its own: `"vibrant"` (default: the video's strongest colors, saturation multiplied by 1.2) or `"natural"` (the video's own colors, drawn softly).
  - `halo`: `"natural"` is new, the edge colors as one soft cloud drawn with a single CSS blur (`blur` option, `--vl-blur`).
  - `ambient`: `"vibrant"` is the former `"blobs"`, `"natural"` the former `"mosaic"`.
  - `theme`: `"natural"` replaces the read option `vibrant: false`, which is removed.
- `Colors` (`watch`, `useColors`, `useColorsEvent`) is now `{ natural: { primary, secondary }, vibrant: { primary, secondary }, mean }` instead of `{ primary, secondary, mean }`.
- The halo's corners follow the video's rounded shape: the glow fades from the rounded edge, not from the bounding box. Each corner is the color of the frame's own corner, and the bands start and end on it. The radius is read once from the video's `border-radius`; set `--vl-radius` when the rounding is elsewhere.
