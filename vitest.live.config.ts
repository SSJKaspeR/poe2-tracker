import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Live tests against external services (poe.ninja). Not run in CI.

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
