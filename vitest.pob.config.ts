import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Integration tests against the real Path of Building engine.
// Requires `npm run setup:pob` first.
export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    include: ['tests/pob/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
