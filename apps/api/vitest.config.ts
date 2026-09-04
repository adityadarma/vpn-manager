import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },
})
