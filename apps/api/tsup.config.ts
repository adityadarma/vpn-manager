import { defineConfig } from 'tsup'

export default defineConfig({
  // Only bundle the main API entry point.
  // Migrations run via tsx at boot (Knex loads them dynamically via fs.scandir,
  // so they cannot be bundled into a single file).
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  noExternal: ['@vpn/shared', '@vpn/db'],
  external: ['better-sqlite3'],
  clean: true,
  outExtension() {
    return {
      js: '.js',
    }
  },
})
