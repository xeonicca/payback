import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Runs only under `pnpm test:emulator`, which starts the Firestore emulator
// and sets FIRESTORE_EMULATOR_HOST. Files share one emulator, so run serially.
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/emulator/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '~': path.resolve(__dirname, './'),
    },
  },
})
