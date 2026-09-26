import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps `jsx: preserve` for Next; tests that render components
  // need the automatic runtime instead.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    // `.test.tsx` too: the server-rendered map bootstrap test lived there and
    // silently stopped running.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
