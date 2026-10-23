import { build } from 'esbuild'
import { tokenStyles } from '../packages/design/src/tokens.ts'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobileRequire = createRequire(new URL('../apps/mobile/package.json', import.meta.url))
const require = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
const { compile } = require('@tailwindcss/node')
const { Scanner } = require('@tailwindcss/oxide')
const source = (await readFile(root + 'packages/web-ui/src/styles.css', 'utf8')).replace(
  "@import '@dovo/design/tokens.css';",
  '',
)
const compiler = await compile(source + '\n' + tokenStyles, {
  base: root + 'packages/web-ui/src',
  onDependency() {},
})
const scanner = new Scanner({
  sources: ['packages/extension-runtime/src', 'packages/web-ui/src'].map((path) => ({
    base: root + path,
    pattern: '**/*.{ts,tsx}',
    negated: false,
  })),
})
const css = compiler.build(scanner.scan())
const result = await build({
  entryPoints: [root + 'apps/mobile/remote-desktop/client.tsx'],
  bundle: true,
  write: false,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [
    {
      name: 'single-react',
      setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
          path: mobileRequire.resolve(args.path),
        }))
      },
    },
  ],
  // postinstall runs before workspace packages emit dist files.
  alias: {
    '@dovo/web-ui/button': root + 'packages/web-ui/src/button.tsx',
    '@dovo/web-ui/input': root + 'packages/web-ui/src/input.tsx',
  },
  jsx: 'automatic',
  conditions: ['development'],
  define: { 'process.env.NODE_ENV': '"production"' },
})
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data: blob:;connect-src ws: wss:;"><style>${css}
*,::before,::after{border-color:var(--border)}html,body{margin:0;min-height:100%;background:var(--background);color:var(--foreground);font-family:-apple-system,system-ui,sans-serif}#app{padding:16px}button,input{min-height:44px}input{font-size:16px!important}img[tabindex]{touch-action:none}button{white-space:normal!important}</style></head><body><div id="app"></div><script type="module">${script}</script></body></html>`
await mkdir(root + 'apps/mobile/assets', { recursive: true })
await writeFile(root + 'apps/mobile/assets/remote-desktop.json', JSON.stringify(html))
