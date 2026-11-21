<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://videolighting.geosigno.fr/media/logo-on-dark.svg">
    <img alt="videoLighting" src="https://videolighting.geosigno.fr/media/logo-on-light.svg" width="440">
  </picture>
</h1>

[![npm version](https://img.shields.io/npm/v/videolighting.svg)](https://www.npmjs.com/package/videolighting)
[![npm downloads](https://img.shields.io/npm/dm/videolighting.svg)](https://www.npmjs.com/package/videolighting)
[![types included](https://img.shields.io/npm/types/videolighting.svg)](https://www.npmjs.com/package/videolighting)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/videolighting.svg)](https://bundlephobia.com/package/videolighting)
[![license](https://img.shields.io/npm/l/videolighting.svg)](./LICENSE)

Reads the colours along the edges of a `<video>` and uses them: a **halo** around the player,
an **ambient** background, **CSS variables** for your UI, or the raw colours for anything else.
No dependency, ESM, TypeScript types included, React bindings optional.

Demo and documentation: <https://videolighting.geosigno.fr/>

- [Install](#install) · [Quick start](#quick-start) · [Effects](#effects) · [Colours without rendering](#colours-without-rendering-watch)
- [React](#react) · [CSS reference](#css-reference) · [Before you use it: CORS](#before-you-use-it-cors)
- [Behaviour](#behaviour) · [Browser support](#browser-support) · [How it works](#how-it-works) · [API summary](#api-summary)

## Install

```sh
npm install videolighting
yarn add videolighting
pnpm add videolighting
bun add videolighting
```

ESM only. `videolighting/react` needs `react >= 18` (optional peer dependency).

## Quick start

Vanilla:

```ts
import { halo } from "videolighting";

const video = document.querySelector("video")!;
const stop = halo(video); // call stop() to remove it
```

React:

```tsx
import { Halo } from "videolighting/react";

<Halo>
  <video src="/a.mp4" crossOrigin="anonymous" />
</Halo>
```

Both need the browser to be allowed to read the video's pixels: see [CORS](#before-you-use-it-cors).

## Effects

Every effect has the same shape: `effect(video, element?, options?)`, and returns a function that stops it.

- `video`: the `<video>`, or an element that contains one (the first `<video>` inside is used).
- `element`: where the effect applies. Default: the video's parent.
- `options`: the effect's own settings, plus `onError` (see [Errors](#errors)).

Several effects on the same video share a single read of its frames.

### `halo`: colour bands around the video

```ts
import { halo } from "videolighting";

halo(video);
halo(video, undefined, { reach: 200, opacity: 0.6 });
```

| Option | Default | |
| --- | --- | --- |
| `reach` | `140` | How far the bands reach from the video, in px. |
| `opacity` | `0.85` | Strength of the bands at the video's edge, 0 to 1. |

It draws every sampled frame as it comes (raw edge colours, no smoothing). Under
`prefers-reduced-motion` it repaints at most once a second. For a reach that is not in px, set
`--vl-reach` in CSS instead (see [CSS reference](#css-reference)).

### `ambient`: a background in the video's colours

```ts
import { ambient } from "videolighting";

ambient(video);
ambient(video, undefined, { variant: "mosaic" });
```

| Option | Default | |
| --- | --- | --- |
| `variant` | `"blobs"` | `"blobs"`: three soft blobs in the video's dominant, second and mean colours, drifting slowly. `"mosaic"`: a soft picture of the video's surroundings. |
| `animate` | `true` | Let the blobs drift. Always `false` under `prefers-reduced-motion`. |

The layer sits behind the video, over a dark base (`#101018`).

### `theme`: CSS variables for your UI

```ts
import { theme } from "videolighting";

theme(video); // sets --video-primary and --video-secondary on the video's parent
```

```css
button {
  background: var(--video-primary);
  color: white;
}
```

| Option | Default | |
| --- | --- | --- |
| `minContrast` | `4.5` | Contrast ratio white text must reach on the colour (4.5 is WCAG AA). The colour is darkened, only as much as needed, to get there. `1` leaves the video's colours as they are. |

## Colours without rendering: `watch`

`watch(video, options?)` gives the colours as data, to use as you like (your own canvas, WebGL, smart
lights…). It renders nothing.

```ts
import { watch } from "videolighting";

const watcher = watch(video);
const stopListening = watcher.subscribe(({ primary, secondary, mean }) => {
  // each is [r, g, b], 0 to 255
});

watcher.state(); // the colours now
watcher.destroy(); // release this handle
```

- `subscribe(listener)`: the smoothed colours, on every display frame while they move, and once right away with the current ones. Returns the unsubscribe function.
- `onSample(listener)`: the raw edge colours of every sampled frame (`{ top, right, bottom, left }`, arrays of `[r, g, b]`).
- `state()`: the smoothed colours now. The same object until they change.
- `stats()`: `{ method, references, samples, skipped, watcherMs }`, for diagnostics.
- `destroy()`: release this handle. The read stops 50 ms after the last handle is released (so that a quick unmount and remount does not restart it).

`Colors`:

| | |
| --- | --- |
| `mean` | Mean of the colours along the video's edges. |
| `primary` | Dominant colour, by area. |
| `secondary` | Second dominant colour, by area. |

Options (the read is shared per video: **the first handle's options win**, the following ones are ignored):

| Option | Default | |
| --- | --- | --- |
| `tau` | `0.12` | Time constant of the smoothing, in seconds. |
| `vibrant` | `true` | `primary` and `secondary` are the most vivid colours of the whole picture (a pink shirt on a beige scene). `false` gives the plain dominant colours along the edges, by area. |
| `depth` | `0.15` | Depth of the sampled border, as a share of the frame's smaller side. |
| `points` | `12` | Colours read along the longer sides (the shorter sides get proportionally fewer). |
| `method` | `"auto"` | `"auto"` measures WebGL and canvas on your device and picks; `"webgl"` or `"canvas"` force one. |
| `worker` | `true` | `false` reads on the main thread (slower, always works). |
| `aroundVideo` | `false` | Set it for a handle that only draws around the video: see [Off screen](#off-screen). |
| `onError` | | See [Errors](#errors). |

## React

```tsx
import { Ambient, Halo, LightingProvider, Theme, useColors } from "videolighting/react";
```

### Components

`Halo`, `Ambient` and `Theme` render an element and run their effect on it. They take the effect's
options as props, plus:

| Prop | Default | |
| --- | --- | --- |
| `as` | `"div"` | The element rendered. |
| `className`, `style`, `children` | | As on any element. |
| `video` | the provider's video, else the first `<video>` among the children | Pass a `HTMLVideoElement` to use another. |
| `onError` | | See [Errors](#errors). |

```tsx
<Halo reach={200} opacity={0.6}>
  <video src="/a.mp4" crossOrigin="anonymous" />
</Halo>

<Ambient variant="mosaic">
  <video src="/a.mp4" crossOrigin="anonymous" />
</Ambient>

<Theme minContrast={3}>
  <video src="/a.mp4" crossOrigin="anonymous" />
  <button style={{ background: "var(--video-primary)" }}>Play</button>
</Theme>
```

A video that arrives late or is swapped among the children is picked up.

### `LightingProvider`: one video and one set of read options for a tree

```tsx
const [video, setVideo] = useState<HTMLVideoElement | null>(null);

<LightingProvider video={video} options={{ method: "webgl", tau: 0.2 }}>
  <Halo><video ref={setVideo} src="/a.mp4" crossOrigin="anonymous" /></Halo>
  <Title />
</LightingProvider>
```

`options` takes the read options of [`watch`](#colours-without-rendering-watch)
and `onError`. They hold only while **every** handle on that video lives under the provider: a
vanilla `halo(video)` or a `useColors(video)` outside the provider keeps the read alive with its own
settings.

### Hooks

```tsx
function Title({ video }: { video: HTMLVideoElement | null }) {
  const { primary } = useColors(video, { maxFps: 15 });
  return <h1 style={{ color: `rgb(${primary.join(",")})` }}>…</h1>;
}
```

- `useColors(video?, { maxFps? })`: the smoothed colours as React state. One render per display frame while they move, at most `maxFps` per second when given. Without `video`, the provider's. Before the first frame, and on the server, it gives a neutral dark colour.
- `useColorsEvent(video, callback)`: calls `callback` with the colours on every display frame, **without rendering**: for what animates (a canvas, a CSS variable). A new `callback` on each render does not resubscribe.

### Server Components and SSR

`videolighting/react` is a client module (`"use client"`). Import it from Server Components as usual: it
stays on the client side of the boundary. Nothing runs on the server; the effects start after mount.

## CSS reference

| Name | Set on | Meaning |
| --- | --- | --- |
| `--video-primary`, `--video-secondary` | the element `theme` applies to | Colours for white text, ready for `background`. |
| `--vl-reach`, `--vl-opacity` | the halo layer | Reach and opacity of the halo. The `reach` and `opacity` options set them on the layer, which wins over the same variables set higher up. Set them on a parent to use a length that is not in px (`calc()`, `%`, `vw`). |
| `--vl-radius` | the halo layer | The video's corner radius, in px (or any length): the halo's corners follow the rounded shape. Read once from the video's `border-radius` (else from its element's), so you only set it when the rounding is somewhere else, such as a wrapper with `overflow: hidden`, or is not in px. A pill (radius of half the side or more) shows a step in the middle of the side. |
| `--vl-primary`, `--vl-secondary`, `--vl-mean` | the ambient layer | The raw colours of the blobs. |

Each layer is a `div` with `data-vl="halo"` or `data-vl="ambient"`, `aria-hidden="true"`,
`pointer-events: none`, `position: absolute; inset: 0; z-index: -1`, inserted first in its element.

**What `halo` and `ambient` do to the element they apply to** (the video's parent by default), until
they are stopped:

- it gets `position: relative` if it was `static`, and `isolation: isolate` (so that the layer stays behind its content without leaving the element). Both are restored on stop.
- the halo extends **outside** the element: a parent with `overflow: hidden` clips it. Give the halo's element room, or move the `overflow` up.

## Before you use it: CORS

The browser only lets a page read the pixels of a video that is **same-origin, or served with CORS
headers and loaded with `crossorigin="anonymous"`**. Otherwise the video plays but the canvas is
"tainted": reading is refused, and the effect reports it through `onError`.

1. **Same origin**: nothing to do.
2. **Another origin (a CDN, S3, Bunny, Akamai…)**:
   - set `crossorigin="anonymous"` on the `<video>` (`crossOrigin="anonymous"` in React) **before** its `src` is set. A video that already started loading without it keeps its restriction: set the attribute in the markup, not afterwards.
   - make the server answer with `Access-Control-Allow-Origin` (your site's origin, or `*`).
   - **on every response, including `206 Partial Content`** (Range requests, which is how browsers stream a video). A server that sends the header on full responses only fails once the browser seeks.
   - for HLS, the playlist and **every segment** need it too.
3. **Without CORS**, there is no workaround: videos of another origin cannot be read.

Also unsupported:

- **DRM-protected video** (EME): the browser never exposes its frames.
- **A video in an iframe**: pass the `<video>` of your own document.
- The `poster` is read the same way: same origin, or CORS (see [Poster](#poster)).

### Errors

Pass `onError` to any effect, hook option or provider to be told when reading fails:

```ts
halo(video, undefined, {
  onError: (error) => console.warn("no glow:", error),
});
```

It is called **once**, and the read stops. The message depends on the browser (a `SecurityError` for
a video that is not CORS-enabled). Without `onError` a refusal is silent: the video plays, there is
simply no effect.

## Behaviour

### Off screen

The read pauses while the video is off screen (with a 200 px margin: a halo spills out of its video),
but only if everything using it just draws around it (`halo`). `ambient`, `theme`, `watch()` and the
hooks can sit anywhere in the page, so they keep the colours coming while the video plays. `watch()`
takes `aroundVideo: true` for a handle that, like a halo, only draws around the video.

A paused video presents no new frame, so nothing is read; when it is seeked or played again the new
frame is read.

### Poster

While the browser shows the `poster` (until the video is first played or sought, whatever `preload`
says), the colours come from that image: an effect matches what is on screen and is not blank before
the first frame. The poster must be readable like the video (same origin, or CORS). The frames take
over at the first play or seek.

### Reduced motion

Under `prefers-reduced-motion: reduce`:

- `ambient`'s blobs do not drift (read when the effect starts).
- `halo` repaints at most once a second, which removes the flicker of a video that cuts quickly.

### Performance

A frame is read in a Web Worker (through a `VideoFrame`), so the main thread only hands the frame
over. The read picks WebGL or a 2D canvas by measuring both on your device (and measures again if
the video's size changes or the device slows down). If the main thread would spend more than 10 % of its
time on it (the fallback engine, on a slow device), frames are skipped, never queued.

**Measured** on 2026-11-20, MacBook Pro (Apple M1 Pro, macOS 27.0.1), 25 fps clip, `halo` + `ambient` +
`theme` running together (`bun run test:e2e`, `core` tests). *Latency* is the median time from a frame
being requested to its colours being ready; *main thread* is the time the page's main thread spends per sample.

| Browser | Method | Clip | Latency (p50) | Main thread / sample | Frames read |
| --- | --- | --- | --- | --- | --- |
| Chrome 157 | auto | 2160p | 3.8 ms | 0.05 ms | |
| Chrome 157 | WebGL | 1080p | 2.9 ms | 0.06 ms | 25 / 25 fps |
| Chrome 157 | canvas | 1080p | 6.0 ms | 0.05 ms | 25 / 25 fps |
| Firefox (Playwright build) | auto | 2160p | 11.0 ms | 4.83 ms | |
| Firefox (Playwright build) | WebGL | 1080p | 9.0 ms | 1.29 ms | 25 / 25 fps |
| Firefox (Playwright build) | canvas | 1080p | 3.0 ms | 1.34 ms | 25 / 25 fps |
| WebKit (Playwright build) | auto | 2160p | 3.0 ms | 0.11 ms | |
| WebKit (Playwright build) | WebGL | 1080p | 2.0 ms | 0.01 ms | 25 / 25 fps |
| WebKit (Playwright build) | canvas | 1080p | 12.0 ms | 0.13 ms | 25 / 25 fps |

Firefox creates the `VideoFrame` on the main thread, which is why its main-thread cost is higher; Firefox and
Safari round timers to 1 ms, so their figures are coarse. These are one machine's figures, not a promise:
run `bun run test:e2e` on yours.

**On a phone**, measured on 2026-11-21 on an iPhone 16e (iOS 27.2.1, Safari 27.2) with the compatibility page
(`bun run dev:lan`, then `/compat.html`), on a Mux HLS stream played natively with `crossorigin`: the worker
reads a frame with a median latency of 11 ms and no measurable main-thread cost (0 ms, p95 1 ms). Reading on
the main thread instead costs 6 ms per sample (median). The first sample takes 80 to 300 ms, the time for the
worker to start. Every case of the page behaved as documented in [CORS section](#before-you-use-it-cors)
(same-origin, CORS with `crossorigin`, `MediaStream`, hls.js and native HLS were readable; without CORS they
were blocked), except one that is not a failure: Safari plays a native HLS stream without `crossorigin`, but
its frames cannot be read, where Chrome refuses to play it.

### Fallbacks

| Situation | What happens |
| --- | --- |
| No Worker, `VideoFrame` or `OffscreenCanvas` | Reads on the main thread. |
| A Content-Security-Policy blocks the worker (it is created from a `blob:` URL) | Reads on the main thread. To keep the worker, allow `worker-src blob:`. |
| No `requestVideoFrameCallback` | `onError` is called, nothing is rendered, the video is untouched. |
| No `IntersectionObserver` | The read never pauses off screen. |
| Server-side rendering | Nothing runs; `useColors` returns a neutral dark colour. |

## Browser support

The browser must have `requestVideoFrameCallback`: Chrome and Edge 83, Safari 15.4, Firefox 132.

The end-to-end tests run on current Chromium, Firefox and WebKit. The React bindings pass them with React 19
(in the CI) and React 18.3 (checked by hand before the release).

## How it works

Each sampled frame is squashed to 256×144, and a ring of `points` colours (default 12 on the long
sides) is read along its edges, to a depth of `depth` (15 % of the smaller side). From that come the
raw edge colours (`halo`), and three smoothed colours: the mean, and the two most vivid or dominant
(`ambient`, `theme`, `watch`).

## API summary

`videolighting`:

- Effects: `halo`, `ambient`, `theme` (with `HaloOptions`, `AmbientOptions`, `ThemeOptions`, `Effect`, `EffectOptions`).
- Data: `watch` (with `Watcher`, `WatcherOptions`, `WatcherStats`, `Colors`, `Rgb`, `MethodChoice`).

`videolighting/react`:

- Components: `Halo`, `Ambient`, `Theme` (with `HaloProps`, `AmbientProps`, `ThemeProps`), `LightingProvider` (with `LightingProviderProps`).
- Hooks: `useColors`, `useColorsEvent`.

Versions follow [semver](https://semver.org). See the [changelog](./CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Code of conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

MIT
