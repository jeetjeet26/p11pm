import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "scripts/**/*.{test,spec}.mjs",
    ],
    exclude: ["tests/e2e/**", "tests/load/**", "node_modules/**", ".next/**"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
