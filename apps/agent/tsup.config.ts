import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
  ],
  format: ['esm'],
  target: 'node24',
  noExternal: [/(.*)/], // Bundle all dependencies into one file to eliminate node_modules
  clean: true,
  outExtension() {
    return {
      js: '.js',
    }
  },
})
