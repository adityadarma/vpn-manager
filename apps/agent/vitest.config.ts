import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },
})
