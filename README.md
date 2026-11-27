<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://videolighting.geosigno.fr/media/logo-on-dark.svg">
    <img alt="videolighting" src="https://videolighting.geosigno.fr/media/logo-on-light.svg" width="440">
  </picture>
</h1>

[![npm version](https://img.shields.io/npm/v/videolighting.svg)](https://www.npmjs.com/package/videolighting)
[![npm downloads](https://img.shields.io/npm/dm/videolighting.svg)](https://www.npmjs.com/package/videolighting)
[![types included](https://img.shields.io/npm/types/videolighting.svg)](https://www.npmjs.com/package/videolighting)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/videolighting.svg)](https://bundlephobia.com/package/videolighting)
[![license](https://img.shields.io/npm/l/videolighting.svg)](./LICENSE)

videolighting makes a page pick up the colors of the video it plays. It can put a glow around the
player, paint the background behind it, or pass the colors to your CSS so your buttons match the
picture. It has no dependencies and ships its own types. The React components are optional.

Demo and documentation: <https://videolighting.geosigno.fr/>

- [Install](#install) · [Quick start](#quick-start) · [Effects](#effects) · [Reading the colors yourself](#reading-the-colors-yourself)
- [React](#react) · [CSS reference](#css-reference) · [CORS](#cors)
- [Behavior](#behavior) · [Browser support](#browser-support) · [How it works](#how-it-works)

## Install

```sh
npm install videolighting
yarn add videolighting
pnpm add videolighting
bun add videolighting
```

The package is ESM only. `videolighting/react` needs `react >= 18`, as an optional peer dependency.

## Quick start

Without a framework:

```ts
import { halo } from "videolighting";

const video = document.querySelector("video")!;
const stop = halo(video); // call stop() to remove it
```

With React:

```tsx
import { Halo } from "videolighting/react";

<Halo>
  <video src="/a.mp4" crossOrigin="anonymous" />
</Halo>
```

In both cases the browser has to be allowed to read the video's pixels. If your video comes from
another domain, read the [CORS](#cors) section first.

## Effects

There are three effects, and they are all called the same way: `effect(video, element?, options?)`.
Each returns a function that stops it.

- `video` is the `<video>`, or an element that contains one. In that case the first `<video>` inside is used.
- `element` is where the effect applies. By default it is the video's parent.
- `options` are the effect's own settings, plus `onError` (see [Errors](#errors)).

You can run several effects on the same video. They share a single read of its frames.

### Variants

Every effect has a `variant` option with the same two values. You choose it per effect, so two
effects on the same video can use different ones.

| | `"vibrant"` (default) | `"natural"` |
| --- | --- | --- |
| In short | The video's strongest colors, with extra saturation. | The video's real colors, drawn softly. |
| `halo` | Bands of color that fade away from each edge of the video. | One soft blurred glow around the video. |
| `ambient` | Three soft blobs that drift slowly, in the picture's most vivid colors. | A blurred picture of what is around the edges of the video. |
| `theme` | The two most vivid colors anywhere in the picture, such as a pink shirt in a beige scene. | The two colors that cover the most area along the edges. |

`vibrant` boosts saturation by 20% in all three effects. Grays are left alone, so a dull scene
doesn't turn neon. `natural` uses the colors exactly as they are in the video.

### Halo

A glow around the video, in the colors of its edges.

```ts
import { halo } from "videolighting";

halo(video);
halo(video, undefined, { reach: 200, opacity: 0.6 });
halo(video, undefined, { variant: "natural" });
```

| Option | Default | |
| --- | --- | --- |
| `variant` | `"vibrant"` | `"vibrant"` or `"natural"`. See [Variants](#variants). |
| `reach` | `140` | How far the bands reach from the video, in px. With `"natural"` it is how far the color goes before the blur spreads it, and the default is `20`. |
| `opacity` | `0.85` | Strength of the halo at the video's edge, from 0 to 1. |
| `blur` | `40` | Radius of the blur, in px. Only used by `"natural"`. |

The halo is redrawn on every frame that is read, with no smoothing. If the user asked for reduced
motion, it is redrawn at most once a second. For a reach that isn't in px, set `--vl-reach` in CSS
instead (see the [CSS reference](#css-reference)).

Each color is painted as a light: the darker it is, the more transparent. A dark edge gives a faint
glow on a dark page, and on a light page it leaves a light tint instead of a shadow. Nothing to set
for a light or a dark theme.

The halo's corners follow the rounded shape you see: the video's own `border-radius`, or else that
of the first ancestor that clips it to a rounded shape (`overflow` other than `visible`). There is
nothing to set.

### Ambient

A background in the video's colors.

```ts
import { ambient } from "videolighting";

ambient(video);
ambient(video, undefined, { variant: "natural" });
```

| Option | Default | |
| --- | --- | --- |
| `variant` | `"vibrant"` | `"vibrant"` or `"natural"`. See [Variants](#variants). |
| `animate` | `true` | Lets the blobs of `"vibrant"` drift. It is always off when the user asked for reduced motion. |

The layer sits behind the video, over a dark base (`#101018`).

### Theme

CSS variables for your own UI.

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
| `variant` | `"vibrant"` | `"vibrant"` or `"natural"`. See [Variants](#variants). |
| `minContrast` | `4.5` | The contrast ratio white text must reach on the color. 4.5 is WCAG AA. The color is darkened just enough to get there. Use `1` to keep the video's colors untouched. |

Apply `theme` to the elements that actually use the colors, not to `<body>`. CSS variables are
inherited, so every color change makes the browser restyle everything underneath. On a large page
this gets expensive: we measured half a CPU core and gigabytes of memory in Chrome on a page of 777
elements. On the few elements that use the colors, the cost is next to nothing.

```ts
// Slow: the whole page is restyled on each new color.
theme(video, document.body);

// Fast: only the elements that use the colors.
for (const element of document.querySelectorAll<HTMLElement>(".follows-video")) {
  theme(video, element);
}
```

Calling `theme` several times on the same video still reads it only once. The variables are written
at most 10 times a second.

## Reading the colors yourself

`watch(video, options?)` gives you the colors as data and draws nothing. Use it for your own canvas,
WebGL, smart lights, or anything else.

```ts
import { watch } from "videolighting";

const watcher = watch(video);
const stopListening = watcher.subscribe(({ natural, vibrant, mean }) => {
  // natural.primary, vibrant.secondary, mean… each is [r, g, b], from 0 to 255
});

watcher.state(); // the current colors
watcher.destroy(); // release this handle
```

- `subscribe(listener)` calls you with the smoothed colors on every display frame while they are changing, and once straight away with the current ones. It returns the function that unsubscribes.
- `onSample(listener)` calls you with the raw edge colors of every frame that is read, as `{ top, right, bottom, left }`, each an array of `[r, g, b]`.
- `state()` returns the current smoothed colors. You get the same object until they change.
- `stats()` returns `{ method, references, samples, skipped, watcherMs }`, for diagnostics.
- `destroy()` releases this handle. Reading stops 50 ms after the last handle is released, so a quick unmount and remount doesn't restart it.

The colors you receive:

| | |
| --- | --- |
| `mean` | The average color along the video's edges. |
| `natural` | `{ primary, secondary }`, the two colors that cover the most area along the edges, unchanged. |
| `vibrant` | `{ primary, secondary }`, the two most vivid colors anywhere in the picture, with extra saturation. When the picture has nothing vivid, these are the `natural` ones with extra saturation. |

A video is read once, however many handles it has. The options of the first handle are the ones
used, and those of later handles are ignored.

| Option | Default | |
| --- | --- | --- |
| `tau` | `0.12` | Time constant of the smoothing, in seconds. |
| `depth` | `0.15` | How deep into the frame the border is sampled, as a share of the frame's smaller side. |
| `points` | `12` | How many colors are read along the longer sides. The shorter sides get proportionally fewer. |
| `method` | `"auto"` | `"auto"` times WebGL and canvas on the device and picks the faster. `"webgl"` and `"canvas"` force one. |
| `worker` | `true` | Set it to `false` to read on the main thread. That is slower but always works. |
| `aroundVideo` | `false` | Set it for a handle that only draws around the video. See [Off screen](#off-screen). |
| `onError` | | See [Errors](#errors). |

## React

```tsx
import { Ambient, Halo, LightingProvider, Theme, useColors } from "videolighting/react";
```

### Components

`Halo`, `Ambient` and `Theme` each render an element and run their effect on it. They take the
effect's options as props, plus these:

| Prop | Default | |
| --- | --- | --- |
| `as` | `"div"` | The element to render. |
| `className`, `style`, `children` | | As on any element. |
| `video` | the provider's video, or else the first `<video>` among the children | Pass an `HTMLVideoElement` to use another one. |
| `onError` | | See [Errors](#errors). |

```tsx
<Halo reach={200} opacity={0.6}>
  <video src="/a.mp4" crossOrigin="anonymous" />
</Halo>

<Ambient variant="natural">
  <video src="/a.mp4" crossOrigin="anonymous" />
</Ambient>

<Theme minContrast={3}>
  <video src="/a.mp4" crossOrigin="anonymous" />
  <button style={{ background: "var(--video-primary)" }}>Play</button>
</Theme>
```

If the video is added later or replaced among the children, the component picks up the new one.

### Sharing one video across components

`LightingProvider` gives a whole tree the same video and the same read options.

```tsx
const [video, setVideo] = useState<HTMLVideoElement | null>(null);

<LightingProvider video={video} options={{ method: "webgl", tau: 0.2 }}>
  <Halo><video ref={setVideo} src="/a.mp4" crossOrigin="anonymous" /></Halo>
  <Title />
</LightingProvider>
```

`options` takes the read options of [`watch`](#reading-the-colors-yourself) and `onError`. They
only apply while everything that reads this video is under the provider. A plain `halo(video)` or a
`useColors(video)` outside it keeps the read going with its own settings.

### Hooks

```tsx
function Title({ video }: { video: HTMLVideoElement | null }) {
  const { vibrant } = useColors(video, { maxFps: 15 });
  return <h1 style={{ color: `rgb(${vibrant.primary.join(",")})` }}>…</h1>;
}
```

- `useColors(video?, { maxFps? })` returns the smoothed colors as React state. The component renders once per display frame while they are changing, or at most `maxFps` times a second if you set it. Without `video` it uses the provider's. Before the first frame, and on the server, it returns a neutral dark color.
- `useColorsEvent(video, callback)` calls `callback` with the colors on every display frame without rendering the component. Use it for things that animate, such as a canvas or a CSS variable. Passing a new `callback` on each render doesn't resubscribe.

### Server Components and SSR

`videolighting/react` is a client module (`"use client"`). You can import it from Server Components
as usual, and it stays on the client side of the boundary. Nothing runs on the server. The effects
start after mount.

## CSS reference

| Name | Set on | Meaning |
| --- | --- | --- |
| `--video-primary`, `--video-secondary` | the element `theme` applies to | Colors that white text is readable on, ready to use as a `background`. |
| `--vl-reach`, `--vl-opacity` | the halo layer | Reach and opacity of the halo. The `reach` and `opacity` options set them on the layer itself, which wins over a value set higher up. Set them on a parent when you need a length that isn't in px, such as `calc()`, `%` or `vw`. |
| `--vl-blur` | the halo layer | Radius of the blur of the `"natural"` halo. The `blur` option sets it on the layer. |
| `--vl-primary`, `--vl-secondary`, `--vl-mean` | the ambient layer | The colors of the blobs of the `"vibrant"` ambient. |

Each layer is a `div` with `data-vl="halo"` or `data-vl="ambient"`, `aria-hidden="true"`,
`pointer-events: none` and `position: absolute; inset: 0; z-index: -1`. It is inserted as the first
child of its element.

While they run, `halo` and `ambient` change two things on the element they apply to, which is the
video's parent by default:

- It gets `position: relative` if it was `static`, and `isolation: isolate`, so the layer stays behind the element's content without going behind the element itself. Both are put back when the effect stops.
- The halo extends outside the element, so a parent with `overflow: hidden` clips it. Give the halo's element some room, or move the `overflow` further up.

## CORS

A page can only read the pixels of a video that is on the same origin, or that is **served with CORS
headers and loaded with `crossorigin="anonymous"`**. Without that the video plays normally, but the
browser refuses to hand over its pixels and the effect reports the failure through `onError`.

1. If the video is on the same origin as the page, there is nothing to do.
2. If it comes from another origin (a CDN, S3, Bunny, Akamai and so on):
   - Set `crossorigin="anonymous"` on the `<video>` (`crossOrigin="anonymous"` in React) before its `src` is set. A video that started loading without it stays restricted, so put the attribute in the markup rather than adding it afterwards.
   - Make the server answer with `Access-Control-Allow-Origin`, set to your site's origin or to `*`.
   - Send that header on every response, including `206 Partial Content`. Browsers stream video with Range requests, so a server that only sends the header on full responses fails as soon as the browser seeks.
   - For HLS, the playlist and every segment need the header too.
3. Without CORS there is no workaround. A video from another origin can't be read.

A few other cases can't work either:

- DRM-protected video (EME). The browser never exposes its frames.
- A video inside an iframe. Pass a `<video>` of your own document.
- A `poster` from another origin without CORS. It is read the same way as the video (see [Poster](#poster)).

### Errors

Pass `onError` to any effect, hook option or provider to find out when reading fails:

```ts
halo(video, undefined, {
  onError: (error) => console.warn("no glow:", error),
});
```

`onError` is called once, then reading stops. The message depends on the browser. For a video
without CORS it is a `SecurityError`. If you don't pass `onError`, a failure is silent. The video
still plays, you just get no effect.

## Behavior

### Off screen

Reading pauses while the video is off screen, with a 200 px margin because a halo spills out of its
video. This only happens when everything that uses the video just draws around it, which is the case
of `halo`. `ambient`, `theme`, `watch()` and the hooks can be anywhere on the page, so they keep the
colors coming for as long as the video plays. Pass `aroundVideo: true` to `watch()` for a handle
that, like a halo, only draws around the video.

A paused video shows no new frame, so nothing is read. When it is played again or seeked, the new
frame is read.

### Poster

While the browser shows the `poster`, the colors come from that image, so an effect matches what is
on screen instead of staying blank until the first frame. The poster is shown until the video is
first played or seeked, whatever `preload` says. It has to be readable like the video, which means
same origin or CORS.

### Reduced motion

When the user asked for reduced motion (`prefers-reduced-motion: reduce`):

- The blobs of `ambient` don't drift. This is checked once, when the effect starts.
- `halo` is redrawn at most once a second, which removes the flicker of a video with quick cuts.

### Performance

Frames are read in a Web Worker, through a `VideoFrame`, so the main thread only hands each frame
over. The read times WebGL and a 2D canvas on the device and uses the faster one, and only switches
to the other when it is at least 30% faster. It times them again if the video's size changes, if
the device slows down, and every minute. If reading would take more than 10% of
the main thread's time, which can happen with the fallback engine on a slow device, frames are
skipped rather than queued.

The figures below were measured on 2026-11-20 on a MacBook Pro (Apple M1 Pro, macOS 27.0.1), with a
25 fps clip and `halo`, `ambient` and `theme` running together. Latency is the median time between
asking for a frame and having its colors. Main thread is the time the page's main thread spends on
each frame read.

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

Firefox creates the `VideoFrame` on the main thread, which is why its main-thread cost is higher.
Firefox and Safari round timers to 1 ms, so their figures are coarse. These numbers come from one
machine. Run `bun run test:e2e` to get yours.

On an iPhone 16e (Safari 27.2), the worker reads a frame with a median latency of 11 ms and no
measurable cost on the main thread. The details are in [docs/performance.md](./docs/performance.md).

### Fallbacks

| Situation | What happens |
| --- | --- |
| No Worker, `VideoFrame` or `OffscreenCanvas` | Frames are read on the main thread. |
| A Content-Security-Policy blocks the worker, which is created from a `blob:` URL | Frames are read on the main thread. Allow `worker-src blob:` to keep the worker. |
| No `requestVideoFrameCallback` | `onError` is called, nothing is drawn, and the video is left alone. |
| No `IntersectionObserver` | Reading never pauses off screen. |
| Server-side rendering | Nothing runs. `useColors` returns a neutral dark color. |

## Browser support

The browser needs `requestVideoFrameCallback`, which means Chrome and Edge 83, Safari 15.4 or
Firefox 132.

The end-to-end tests run on current Chromium, Firefox and WebKit. The React bindings pass them with
React 19 in the CI, and were checked by hand with React 18.3 before the release.

## How it works

Each frame that is read is first shrunk to 256×144. A ring of colors is then read along its edges:
12 on the long sides by default (`points`), to a depth of 15% of the smaller side (`depth`). The
`halo` and the `"natural"` ambient use these edge colors directly. The rest (`theme`, the
`"vibrant"` ambient, `watch`) uses five smoothed colors worked out from them: the average, the two
that cover the most area, and the two most vivid.

Versions follow [semver](https://semver.org). See the [changelog](./CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Code of conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

MIT
