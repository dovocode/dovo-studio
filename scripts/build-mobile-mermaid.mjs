import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
const result = await build({
  entryPoints: [fileURLToPath(new URL('../apps/mobile/mermaid/client.ts', import.meta.url))],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
})
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;"><style>html,body{margin:0;background:transparent;color:#e8e9ed;font:14px system-ui}#diagram{padding:8px;overflow:auto}svg{display:block;max-width:100%;height:auto}</style></head><body><div id="diagram"></div><script>${script}</script></body></html>`
await mkdir(new URL('../apps/mobile/assets/', import.meta.url), { recursive: true })
await writeFile(
  new URL('../apps/mobile/assets/mermaid.json', import.meta.url),
  JSON.stringify(html),
)
