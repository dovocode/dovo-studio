import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const base = new URL('../packages/studio-ui/mcp-apps/', import.meta.url)
await mkdir(base, { recursive: true })
const bundle = async (entry) =>
  (
    await build({
      entryPoints: [fileURLToPath(new URL(entry, base))],
      bundle: true,
      write: false,
      minify: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
  ).outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const page = (script, policy) =>
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body,#root{margin:0;width:100%;height:100%;background:transparent;font:14px system-ui}iframe{max-width:100%}</style></head><body><div id="root"></div><script>${script}</script></body></html>`
await writeFile(
  new URL('sandbox.json', base),
  JSON.stringify(
    page(
      await bundle('sandbox.ts'),
      "script-src 'unsafe-inline' 'unsafe-eval' http: https:; style-src 'unsafe-inline' http: https:; object-src 'none';",
    ),
  ),
)
await writeFile(
  new URL('host.json', base),
  JSON.stringify(
    page(
      await bundle('host.tsx'),
      "script-src 'unsafe-inline' 'unsafe-eval' http: https:; style-src 'unsafe-inline' http: https:; object-src 'none';",
    ),
  ),
)
