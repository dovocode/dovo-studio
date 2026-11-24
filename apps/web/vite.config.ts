import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'
import { rendererBuildIdentity } from '../../scripts/packaging/renderer-build-identity.mjs'

export default defineConfig({
  define: {
    __DOVO_RENDERER_BUILD__: JSON.stringify(
      rendererBuildIdentity(new URL('../../', import.meta.url)),
    ),
  },
  server: {
    port: 4173,
    strictPort: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), tanstackStart(), react()],
})
