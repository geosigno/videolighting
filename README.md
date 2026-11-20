# videolight

Reads the colours along the edges of a `<video>` and uses them: a glow around
the player, an ambient background, CSS variables for your UI, a letterbox fill.

> **Alpha** (`0.1.0-alpha.0`). The API may still change.

## Install

```sh
bun add videolight@alpha   # or: npm i videolight@alpha
```

ESM only. The React entry (`videolight/react`) needs `react >= 18` (optional
peer dependency): **only React 19 is tested**.

## Vanilla

Every effect is `effect(video, element?, options?)` and returns a stop function.
`element` is where it applies (default: the video's parent).

```ts
import { ambient, halo, letterbox, theme, watch } from "videolight";

const video = document.querySelector("video")!;

const stop = halo(video); // colour bands fading out around the video
// CSS: --glow-reach (default 140px), --glow-opacity (default 0.85)

ambient(video, undefined, { variant: "mosaic" }); // "blobs" (default) | "mosaic"

theme(video); // sets --video-primary / --video-secondary on the parent
// button { background: var(--video-primary); color: white; }

letterbox(video); // fills the empty bars around a video that does not fit

const watcher = watch(video); // the smoothed colours, no rendering
watcher.subscribe(({ primary, secondary, mean }) => {
  // each is [r, g, b]
});
```

## React

```tsx
import { Ambient, Halo, Letterbox, Theme, useColors } from "videolight/react";

<Halo>
  <video src="/a.mp4" crossOrigin="anonymous" />
</Halo>

<Ambient options={{ variant: "mosaic" }}>
  <video src="/a.mp4" />
</Ambient>

<Theme>
  <video src="/a.mp4" />
  <button style={{ background: "var(--video-primary)" }}>Play</button>
</Theme>

<Letterbox>
  <video src="/a.mp4" />
</Letterbox>

function Title({ video }: { video: HTMLVideoElement | null }) {
  const { primary } = useColors(video, { maxFps: 15 });
  return <h1 style={{ color: `rgb(${primary.join(",")})` }}>…</h1>;
}
```

`videolight/react` is a client module (`"use client"`): import it from Server
Components as usual, it stays on the client side of the boundary.

## Limit

The browser must be able to read the pixels: same origin, or CORS headers plus
`crossorigin="anonymous"` on the `<video>`. DRM-protected video and videos in
iframes are not supported. Pass `onError` to be told when reading is refused.

## Known alpha leftovers

Names inherited from the working name "glow", kept as is in the alpha and
undecided before the beta:

- `GlowProvider`, `useGlow`, `glowComponent` (React); `createGlow`, `Glow` (core)
- CSS variables `--glow-reach`, `--glow-opacity` (halo) and
  `--glow-primary`, `--glow-secondary`, `--glow-mean` (ambient)
- attribute `data-glow` on the halo element

## License

MIT
