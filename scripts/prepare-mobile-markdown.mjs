import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export function prepareMobileMarkdown(packageRoot, config) {
  if (!config.enableCodeHighlight || config.codeHighlightLanguages.length === 0) return
  const manifestPath = join(packageRoot, 'cpp/highlight/grammar-versions.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const vendor = join(packageRoot, 'cpp/highlight/vendor')
  // Both native builds gate highlighting on this completion marker. Parser files alone
  // can survive a partial download without the queries, scanners or headers they need.
  const required = new Set([
    'grammars/.stamp',
    'tree-sitter/src/lib.c',
    'tree-sitter/include/tree_sitter/api.h',
  ])
  const addQuery = (language) => {
    const query = `grammars/${language}/highlights.scm`
    if (required.has(query)) return
    const grammar = manifest.grammars[language]
    if (!grammar) throw new Error(`Unknown mobile Markdown grammar: ${language}`)
    required.add(query)
    // TypeScript/TSX use JavaScript's captures even when it isn't in the compiled subset.
    for (const parent of grammar.inherits ?? []) addQuery(parent)
  }
  for (const language of config.codeHighlightLanguages) {
    addQuery(language)
    required.add(`grammars/${language}/parser.c`)
    required.add(`grammars/${language}/tree_sitter/parser.h`)
    const grammar = manifest.grammars[language]
    if (grammar.scanner) required.add(`grammars/${language}/scanner.c`)
    for (const source of grammar.sharedSrc ?? [])
      required.add(`grammars/${language}/${source.split('/').at(-1)}`)
  }
  const missing = () =>
    [...required].filter(
      (path) => !statSync(join(vendor, path), { throwIfNoEntry: false })?.isFile(),
    )
  if (missing().length === 0) return
  // The vendor's normal cache checks only parser.c. Force a repair so a missing
  // scanner/query/header is restored even when its old completion marker remains.
  execFileSync(
    process.execPath,
    [
      join(packageRoot, 'vendor-grammars.mjs'),
      '--from-npm',
      '--vendor-dir',
      vendor,
      '--manifest',
      manifestPath,
      '--force',
    ],
    { stdio: 'inherit' },
  )
  const remaining = missing()
  if (remaining.length)
    throw new Error(
      `Mobile Markdown native assets are incomplete: ${remaining.join(', ')}. Run pnpm install again.`,
    )
}

if (import.meta.main) {
  const app = fileURLToPath(new URL('../apps/mobile/', import.meta.url))
  const require = createRequire(join(app, 'package.json'))
  const packageRoot = dirname(require.resolve('react-native-enriched-markdown/package.json'))
  const config = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))['enriched-markdown']
  prepareMobileMarkdown(packageRoot, config)
}
