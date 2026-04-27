import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,   // bind to 0.0.0.0 — required for Docker
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('/react-dom/') || id.includes('/react/')) return 'vendor-react'
            if (id.includes('@tanstack/react-router'))                  return 'vendor-router'
            if (id.includes('@tanstack/react-query'))                   return 'vendor-query'
            if (id.includes('@radix-ui/') || id.includes('@base-ui/'))  return 'vendor-radix'
            if (id.includes('lucide-react'))                            return 'vendor-icons'
            if (id.includes('/zod/'))                                   return 'vendor-utils'
          }
        },
      },
    },
  },
})

