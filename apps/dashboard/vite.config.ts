import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/sites': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/integrations': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ai': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/oauth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/stats': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/sdk': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ingest': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/webhooks': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/meta': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/recommendations': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    }
  }
})
