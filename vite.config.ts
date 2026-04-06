import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/tldraw') || id.includes('node_modules/@tldraw')) {
            return 'tldraw'
          }

          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react'
          }

          if (
            id.includes('node_modules/dexie') ||
            id.includes('node_modules/date-fns') ||
            id.includes('node_modules/clsx')
          ) {
            return 'vendor'
          }

          return undefined
        },
      },
    },
    chunkSizeWarningLimit: 1800,
  },
})
