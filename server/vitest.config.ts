import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // mongodb-memory-server downloads a mongod binary on its first run.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
})
