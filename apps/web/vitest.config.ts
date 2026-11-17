import { defineConfig } from 'vitest/config'
import path from 'path'

// Separate from vite.config.ts so tests do not run the router code generator
// or the Tailwind plugin.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
