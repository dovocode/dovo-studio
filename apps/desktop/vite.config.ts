import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts' },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
})
