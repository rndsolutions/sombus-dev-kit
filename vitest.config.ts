import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['sdk/typescript/test/**/*.test.ts', 'executors/*/test/**/*.test.ts', 'examples/*/test/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 20_000 },
});
