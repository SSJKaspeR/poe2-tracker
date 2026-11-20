import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Quick check on the real PoB engine (part of `npm run check`).
export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    include: ['tests/smoke/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
