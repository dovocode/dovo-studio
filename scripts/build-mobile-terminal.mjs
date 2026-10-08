import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../apps/mobile/package.json', import.meta.url))
const result = await build({
  entryPoints: [fileURLToPath(new URL('../apps/mobile/terminal/client.ts', import.meta.url))],
  // postinstall runs before workspace packages have emitted dist files.
  conditions: ['development'],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  platform: 'browser',
})
const css = await readFile(require.resolve('@xterm/xterm/css/xterm.css'), 'utf8')
// Keep the WebView self-contained: no font downloads or local file permissions.
const fontCSS = (
  await Promise.all(
    ['regular', 'bold'].map(async (weight) => {
      const bytes = await readFile(
        new URL(
          `../packages/studio-ui/src/assets/fonts/jetbrains-mono-nerd-${weight}.woff2`,
          import.meta.url,
        ),
      )
      return `@font-face{font-family:'JetBrains Mono Nerd Font';src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2');font-weight:${weight === 'bold' ? 700 : 400};font-style:normal;font-display:swap}`
    }),
  )
).join('')
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>${fontCSS}${css}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#101113}body{display:flex;flex-direction:column}#terminal{box-sizing:border-box;padding:6px;flex:1;min-height:0}#keys{display:flex;gap:4px;padding:6px;overflow-x:auto;flex-shrink:0;background:#202126}#keys button{flex-shrink:0;min-width:44px;min-height:44px;padding:0 12px;border:0;border-radius:14px;background:#ffffff10;color:#ededee;font:600 14px system-ui;white-space:nowrap;touch-action:manipulation}#keys button:disabled{opacity:.35}</style></head><body><div id="terminal"></div><div id="keys" role="toolbar" aria-label="Terminal keys"></div><script>window.addEventListener("error",event=>window.ReactNativeWebView.postMessage(JSON.stringify({error:event.message})));${script}</script></body></html>`
await mkdir(new URL('../apps/mobile/assets/', import.meta.url), { recursive: true })
await writeFile(
  new URL('../apps/mobile/assets/terminal.json', import.meta.url),
  JSON.stringify(html),
)
