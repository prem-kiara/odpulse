import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Large CSV uploads (12–30 MB) + SQLite ingest can take 15–60s.
        // Default proxy timeout is too short and leaves the client with an empty body.
        timeout: 10 * 60 * 1000,      // 10 min
        proxyTimeout: 10 * 60 * 1000, // 10 min
      },
    },
  },
})
