import { build } from 'esbuild'
import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const base = new URL('../packages/studio-ui/mcp-apps/', import.meta.url)
await mkdir(base, { recursive: true })
// Typechecks and builds can read these assets while another workspace task regenerates them.
const publish = async (name, html) => {
  const target = new URL(name, base)
  const temporary = new URL(`${name}.${randomUUID()}.tmp`, base)
  try {
    await writeFile(temporary, JSON.stringify(html))
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}
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
      conditions: ['development'],
      define: { 'process.env.NODE_ENV': '"production"' },
    })
  ).outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const page = (script, policy) =>
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body,#root{margin:0;width:100%;height:100%;background:transparent;font:14px system-ui}iframe{max-width:100%}</style></head><body><div id="root"></div><script>${script}</script></body></html>`
await publish(
  'sandbox.json',
  page(
    await bundle('sandbox.ts'),
    "script-src 'unsafe-inline' 'unsafe-eval' http: https:; style-src 'unsafe-inline' http: https:; object-src 'none';",
  ),
)
await publish(
  'host.json',
  page(
    await bundle('host.tsx'),
    "script-src 'unsafe-inline' 'unsafe-eval' http: https:; style-src 'unsafe-inline' http: https:; object-src 'none';",
  ),
)
