import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { defineConfig } from 'vite-plus'
import { fileURLToPath } from 'node:url'
import { writeDesktopBuildStamp } from '../../scripts/packaging/desktop-build-stamp.mjs'

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
  },
  base: './',
  run: {
    tasks: {
      bundle: {
        command: 'vp build',
        cache: {
          // Generated directory entries must not become inputs on the next clean runner.
          input: [{ auto: true }, '!.', '!dist', '!dist/**', '!dist-electron', '!dist-electron/**'],
          output: [{ auto: true }, 'dist/**', 'dist-electron/**'],
        },
      },
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts' },
    }),
    {
      name: 'dovo-desktop-build-stamp',
      apply: 'build',
      closeBundle: {
        order: 'post',
        sequential: true,
        handler: () => writeDesktopBuildStamp(fileURLToPath(new URL('../../', import.meta.url))),
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
})
