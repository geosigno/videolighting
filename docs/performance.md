# Performance on a phone

Measured on 2026-11-21 on an iPhone 16e (iOS 27.2.1, Safari 27.2) with the compatibility page
(`bun run dev:lan`, then `/compat.html`), on a Mux HLS stream played natively with `crossorigin`.

- The worker reads a frame with a median latency of 11 ms and no measurable main-thread cost (0 ms, p95 1 ms).
- Reading on the main thread instead costs 6 ms per frame read (median).
- The first frame read takes 80 to 300 ms, the time the worker needs to start.

Every case of the compatibility page behaved as described in the README's
[CORS section](../README.md#cors): same-origin video, CORS with `crossorigin`, `MediaStream`, hls.js
and native HLS were readable, and without CORS they were blocked. One case differs between browsers
without being a failure: Safari plays a native HLS stream without `crossorigin` but its frames can't
be read, where Chrome refuses to play it.

The desktop figures are in the [README](../README.md#performance), measured with
`bun run test:e2e` (`core` tests).
