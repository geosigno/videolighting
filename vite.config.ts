import path from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      entryRoot: "src",
    }),
  ],
  build: {
    lib: {
      entry: {
        index: path.resolve(import.meta.dirname, "src/index.ts"),
        react: path.resolve(import.meta.dirname, "src/react/index.ts"),
      },
      formats: ["es"],
    },
    rolldownOptions: {
      external: ["react", "react/jsx-runtime"],
      // "use client" is kept at the top of react.js; this only silences the warning.
      onLog(level, log, handler) {
        if (log.code !== "MODULE_LEVEL_DIRECTIVE") {
          handler(level, log);
        }
      },
    },
  },
});
