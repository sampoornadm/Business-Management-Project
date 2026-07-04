import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.spec.tsx", "src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      // Pages/hooks/components are verified via the Playwright E2E suite (apps/web/e2e/), not
      // component unit tests — coverage here is scoped to plain-function logic in src/lib where
      // unit tests actually live, so the threshold means something rather than being gamed to a
      // near-zero global number.
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/axios.ts", "src/lib/auth-store.ts", "src/lib/env.ts", "src/lib/query-client.ts"],
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 90,
        lines: 90,
      },
    },
  },
});
