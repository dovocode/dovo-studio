import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Compile the actual shared iOS/Android highlighter, not a JS approximation.
// This host check does not exercise either platform's UI adapters or native build system.
const app = fileURLToPath(new URL('../apps/mobile/', import.meta.url))
const require = createRequire(join(app, 'package.json'))
const root = dirname(require.resolve('react-native-enriched-markdown/package.json'))
const highlight = join(root, 'cpp/highlight')
const vendor = join(highlight, 'vendor')
const languages = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))['enriched-markdown']
  .codeHighlightLanguages
const directory = mkdtempSync(join(tmpdir(), 'dovo-markdown-highlighting-'))
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options })
try {
  // Keep installed dependencies untouched, including when another agent uses this checkout.
  const source = join(directory, 'cpp/highlight')
  mkdirSync(source, { recursive: true })
  const filename = 'CodeBlockHighlighter.cpp'
  copyFileSync(join(highlight, filename), join(source, filename))
  const patch = fileURLToPath(
    new URL('../patches/react-native-enriched-markdown@1.1.0.patch', import.meta.url),
  )
  const args = ['apply', '--include=cpp/highlight/CodeBlockHighlighter.cpp', patch]
  const alreadyPatched = spawnSync('git', [...args, '--reverse', '--check'], {
    cwd: directory,
    stdio: 'pipe',
  })
  if (alreadyPatched.status !== 0) run('git', args, { cwd: directory })
  run(process.execPath, [
    join(highlight, 'gen-registry.mjs'),
    '--vendor-dir',
    vendor,
    '--languages',
    languages.join(','),
    '--out',
    directory,
  ])
  const manifest = JSON.parse(readFileSync(join(highlight, 'grammar-versions.json'), 'utf8'))
  const sources = [join(vendor, 'tree-sitter/src/lib.c')]
  for (const language of languages) {
    sources.push(join(vendor, 'grammars', language, 'parser.c'))
    if (manifest.grammars[language].scanner)
      sources.push(join(vendor, 'grammars', language, 'scanner.c'))
  }
  const objects = sources.map((source, index) => {
    const object = join(directory, `${index}.o`)
    run('clang', [
      '-std=c11',
      '-D_DEFAULT_SOURCE',
      '-O0',
      `-I${join(vendor, 'tree-sitter/include')}`,
      '-c',
      source,
      '-o',
      object,
    ])
    return object
  })
  const binary = join(directory, 'check')
  run('clang++', [
    '-std=c++17',
    '-O0',
    '-DENRICHED_MARKDOWN_CODE_HIGHLIGHT=1',
    `-I${highlight}`,
    `-I${join(vendor, 'tree-sitter/include')}`,
    join(source, filename),
    join(highlight, 'CodeBlockLanguages.cpp'),
    join(directory, 'generated_registry.cpp'),
    fileURLToPath(new URL('./fixtures/markdown-highlighting.cpp', import.meta.url)),
    ...objects,
    '-o',
    binary,
  ])
  run(binary, [], { timeout: 15000 })
} finally {
  rmSync(directory, { recursive: true, force: true })
}
