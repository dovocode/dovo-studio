import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const app = fileURLToPath(new URL('../apps/mobile/', import.meta.url))
const require = createRequire(join(app, 'package.json'))
const packageRoot = dirname(require.resolve('react-native-enriched-markdown/package.json'))
const config = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))['enriched-markdown']
const vendor = join(packageRoot, 'cpp/highlight/vendor')
const required = [
  join(vendor, 'tree-sitter/src/lib.c'),
  ...config.codeHighlightLanguages.map((language) =>
    join(vendor, 'grammars', language, 'parser.c'),
  ),
]
if (config.enableCodeHighlight && required.some((path) => !existsSync(path))) {
  // Use the app's feature flags: a workspace-root install otherwise downloads unused math assets.
  execFileSync(process.execPath, [join(packageRoot, 'postinstall.mjs')], {
    env: { ...process.env, INIT_CWD: app },
    stdio: 'inherit',
  })
  if (required.some((path) => !existsSync(path)))
    throw new Error(
      'Mobile Markdown grammars are missing. Check network access and run pnpm install again.',
    )
}
