import { cp, mkdir } from 'node:fs/promises'
const directory = new URL('../packages/runtime/dist/previews/ios-device/', import.meta.url)
await mkdir(directory, { recursive: true })
for (const name of ['Cargo.toml', 'Cargo.lock', 'src', 'LICENSE-idevice'])
  await cp(
    new URL(`../packages/runtime/native/ios-device/${name}`, import.meta.url),
    new URL(name, directory),
    { recursive: true },
  )

// Bundle maintained help with the exact runtime build. No network or model call is needed at read time.
const { readFile, writeFile } = await import('node:fs/promises')
const { execFileSync } = await import('node:child_process')
const { helpDocuments: helpNames } =
  await import('../packages/runtime/dist/agent-tools/product-help.js')
const helpDirectory = new URL('../packages/runtime/dist/help-docs/', import.meta.url)
await mkdir(helpDirectory, { recursive: true })
const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
let revision = process.env.DOVO_SOURCE_COMMIT
if (!revision) {
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    revision = 'source-archive'
  }
}
const documents = await Promise.all(
  helpNames.map(async (id) => ({
    id,
    text: await readFile(new URL(`../docs/${id}.md`, import.meta.url), 'utf8'),
  })),
)
await writeFile(
  new URL('index.json', helpDirectory),
  JSON.stringify({ version: process.env.DOVO_VERSION || rootPackage.version, revision, documents }),
)
