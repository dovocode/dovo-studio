import { cp, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
const directory = new URL('../packages/runtime/dist/previews/ios-device/', import.meta.url)
await mkdir(directory, { recursive: true })
for (const name of ['Cargo.toml', 'Cargo.lock', 'src', 'LICENSE-idevice'])
  await cp(
    new URL(`../packages/runtime/native/ios-device/${name}`, import.meta.url),
    new URL(name, directory),
    { recursive: true },
  )
const require = createRequire(new URL('../packages/runtime/package.json', import.meta.url))
const grammars = new URL('../packages/runtime/dist/scm/reviews/grammars/', import.meta.url)
await mkdir(grammars, { recursive: true })
for (const language of ['python', 'go', 'rust', 'java', 'kotlin', 'swift', 'c_sharp', 'php']) {
  const filename = `tree-sitter-${language}.wasm`
  await cp(require.resolve(`tree-sitter-wasms/out/${filename}`), new URL(filename, grammars))
}
