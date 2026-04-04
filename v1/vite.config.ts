import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Allow cloud preview hosts used by remote dev environments.
    allowedHosts: true,
    port: 5177,
    strictPort: true,
  },
})
