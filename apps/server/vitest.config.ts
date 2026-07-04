import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.spec.ts"],
    setupFiles: ["./vitest.setup.ts"],
    hookTimeout: 20000,
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/__tests__/**",
        "src/index.ts",
        "src/worker.ts",
        "src/docs/**",
      ],
      // Floors set just below the suite's actual coverage (71/79/64/71 as of Phase 8) so CI
      // catches real regressions without blocking on an arbitrary aspirational number.
      thresholds: {
        statements: 65,
        branches: 75,
        functions: 60,
        lines: 65,
      },
    },
  },
});
