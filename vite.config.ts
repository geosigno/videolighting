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
      // "use client" est bien conservé en tête de react.js ; on coupe l'avertissement.
      onLog(level, log, handler) {
        if (log.code !== "MODULE_LEVEL_DIRECTIVE") {
          handler(level, log);
        }
      },
    },
  },
});
