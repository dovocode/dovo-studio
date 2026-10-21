import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const base = fileURLToPath(new URL('src/', import.meta.url))
const compiler = await compile(await readFile(new URL('src/styles.css', import.meta.url), 'utf8'), {
  base,
  onDependency() {},
})
const scanner = new Scanner({
  sources: [
    'src',
    '../../apps/auth-server/src',
    '../../apps/connect-server/src',
    '../../apps/artifact-server/src',
    '../../apps/site/src',
  ].map((path) => ({
    base: fileURLToPath(new URL(path, import.meta.url)),
    pattern: '**/*.{ts,tsx}',
    negated: false,
  })),
})
const css = compiler.build(scanner.scan())
await writeFile(new URL('dist/styles.css', import.meta.url), css)
await writeFile(
  new URL('dist/styles.js', import.meta.url),
  'export const webUiStyles = ' + JSON.stringify(css) + '\n',
)
await writeFile(
  new URL('dist/styles.d.ts', import.meta.url),
  'export declare const webUiStyles: string\n',
)
