import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: {
    // Forward API calls to FastAPI so the browser never needs CORS in dev.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
