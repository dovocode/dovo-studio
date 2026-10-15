import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { prepareMobileMarkdown } from './prepare-mobile-markdown.mjs'

const config = { enableCodeHighlight: true, codeHighlightLanguages: ['typescript'] }
const assets = [
  'grammars/.stamp',
  'tree-sitter/src/lib.c',
  'tree-sitter/include/tree_sitter/api.h',
  'grammars/typescript/parser.c',
  'grammars/typescript/scanner.c',
  'grammars/typescript/scanner.h',
  'grammars/typescript/tree_sitter/parser.h',
  'grammars/typescript/highlights.scm',
  'grammars/javascript/highlights.scm',
]

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dovo-markdown-assets-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const highlight = join(root, 'cpp/highlight')
  const vendor = join(highlight, 'vendor')
  const manifest = {
    grammars: {
      typescript: {
        scanner: true,
        sharedSrc: ['../../common/scanner.h'],
        inherits: ['javascript'],
      },
      javascript: {},
    },
  }
  mkdirSync(highlight, { recursive: true })
  writeFileSync(join(highlight, 'grammar-versions.json'), JSON.stringify(manifest))
  for (const asset of assets) {
    const path = join(vendor, asset)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'fixture')
  }
  // Exercise the real process boundary without downloading or modifying installed dependencies.
  writeFileSync(
    join(root, 'vendor-grammars.mjs'),
    `import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const args = process.argv.slice(2)
writeFileSync(new URL('./restore.json', import.meta.url), JSON.stringify(args))
const vendor = args[args.indexOf('--vendor-dir') + 1]
for (const asset of ${JSON.stringify(assets)}) {
  const path = join(vendor, asset)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'restored')
}
`,
  )
  return { root, vendor }
}

await test('complete native assets are left untouched', (t) => {
  const { root } = fixture(t)
  prepareMobileMarkdown(root, config)
  assert.equal(existsSync(join(root, 'restore.json')), false)
})

for (const asset of assets) {
  await test(`repairs a partial download missing ${asset}`, (t) => {
    const { root, vendor } = fixture(t)
    rmSync(join(vendor, asset))
    prepareMobileMarkdown(root, config)
    assert.equal(readFileSync(join(vendor, asset), 'utf8'), 'restored')
    const args = JSON.parse(readFileSync(join(root, 'restore.json'), 'utf8'))
    assert.ok(args.includes('--force'), 'must bypass the vendor parser-only cache')
    assert.ok(args.includes('--from-npm'))
  })
}

await test('rejects an incomplete repair even when the vendor exits successfully', (t) => {
  const { root, vendor } = fixture(t)
  rmSync(join(vendor, 'grammars/.stamp'))
  writeFileSync(join(root, 'vendor-grammars.mjs'), '')
  assert.throws(() => prepareMobileMarkdown(root, config), /incomplete: grammars\/\.stamp/)
})

await test('a failed download is reported', (t) => {
  const { root, vendor } = fixture(t)
  rmSync(join(vendor, 'grammars/.stamp'))
  writeFileSync(join(root, 'vendor-grammars.mjs'), 'process.exit(1)')
  assert.throws(() => prepareMobileMarkdown(root, config), /Command failed/)
})

await test('a directory cannot stand in for the completion marker', (t) => {
  const { root, vendor } = fixture(t)
  const stamp = join(vendor, 'grammars/.stamp')
  rmSync(stamp)
  mkdirSync(stamp)
  writeFileSync(join(root, 'vendor-grammars.mjs'), '')
  assert.throws(() => prepareMobileMarkdown(root, config), /incomplete: grammars\/\.stamp/)
})

await test('disabled highlighting and an empty language subset require no native assets', () => {
  prepareMobileMarkdown('/unused', { ...config, enableCodeHighlight: false })
  prepareMobileMarkdown('/unused', { ...config, codeHighlightLanguages: [] })
})
