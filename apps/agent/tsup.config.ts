import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
  ],
  format: ['esm'],
  target: 'node24',
  noExternal: ['@vpn/shared'],
  clean: true,
  outExtension() {
    return {
      js: '.js',
    }
  },
})
