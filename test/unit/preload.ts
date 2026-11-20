import { plugin } from "bun";

const INLINE_WORKER = /\?worker&inline$/u;
const ANY = /.*/u;

// `bun test` cannot load Vite's `?worker&inline` imports (src/core/capture.ts):
// stand in an empty class, since no test starts a real read.
plugin({
  name: "vite-inline-worker-stub",
  setup(build) {
    build.onResolve({ filter: INLINE_WORKER }, (args) => ({
      namespace: "inline-worker-stub",
      path: args.path,
    }));
    build.onLoad({ filter: ANY, namespace: "inline-worker-stub" }, () => ({
      contents: "export default class {}",
      loader: "js",
    }));
  },
});
