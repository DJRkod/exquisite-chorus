import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy the API so the browser stays same-origin in dev, as in production.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
