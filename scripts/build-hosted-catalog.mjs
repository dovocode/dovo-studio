import { build } from 'esbuild'
import { mkdir, writeFile, cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url)
const path = (relative) => fileURLToPath(new URL(relative, root))
const bundle = async (entry, extra = {}) =>
  (
    await build({
      entryPoints: [path(entry)],
      bundle: true,
      write: false,
      minify: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      ...extra,
    })
  ).outputFiles[0].text
const css = (
  await build({
    entryPoints: [path('apps/site/src/app/globals.css')],
    bundle: true,
    write: false,
    minify: true,
  })
).outputFiles[0].text
const website = await bundle('apps/design-system/src/hosted-screens-website-entry.tsx', {
  define: { 'process.env.NODE_ENV': '"production"', __dovoCatalogCss: JSON.stringify(css) },
  alias: {
    'next/link': path('apps/design-system/src/hosted-screens-website-link.tsx'),
    'next/image': path('apps/design-system/src/hosted-screens-website-image.tsx'),
  },
  // CSS is embedded in the isolated document separately.
  loader: { '.css': 'empty' },
})
const viewer = await bundle('apps/artifact-server/src/viewer.tsx', {
  define: { location: '__dovoCatalogLocation' },
})
await writeFile(
  path('apps/design-system/src/hosted-screens.generated.json'),
  JSON.stringify({ website, viewer, css }),
)
await mkdir(path('apps/design-system/public/website'), { recursive: true })
await cp(path('apps/site/public'), path('apps/design-system/public/website'), { recursive: true })
