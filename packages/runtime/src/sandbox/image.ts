import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ImageFile = { path: string; content: Buffer }
export type ImageSource = { files: ImageFile[]; hash: string }

/** The image definition ships beside the compiled runtime. Source checkouts read it directly. */
function imageDirectory() {
  const shipped = fileURLToPath(new URL('../sandbox-image/', import.meta.url))
  if (existsSync(join(shipped, 'Dockerfile'))) return shipped
  return fileURLToPath(new URL('../../sandbox/', import.meta.url))
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? listFiles(root, join(directory, entry.name))
        : Promise.resolve(entry.isFile() ? [relative(root, join(directory, entry.name))] : []),
    ),
  )
  return nested.flat().sort((left, right) => left.localeCompare(right))
}

/** Read the image files and hash them with the build arguments. A change to either builds a new
 * image tag; nothing is published to a registry. */
export async function loadImageSource(
  buildArgs: Readonly<Record<string, string>>,
  directory = imageDirectory(),
): Promise<ImageSource> {
  const names = await listFiles(directory)
  if (!names.includes('Dockerfile'))
    throw new Error(`The sandbox image definition is missing from ${directory}`)
  const files = await Promise.all(
    names.map(async (path) => ({
      path: path.split('\\').join('/'),
      content: await readFile(join(directory, path)),
    })),
  )
  const hash = createHash('sha256')
  for (const file of files) hash.update(file.path).update('\0').update(file.content).update('\0')
  hash.update(
    JSON.stringify(Object.entries(buildArgs).sort(([left], [right]) => left.localeCompare(right))),
  )
  return { files, hash: hash.digest('hex') }
}

export const imageTag = (source: ImageSource) => `dovo-sandbox:${source.hash.slice(0, 16)}`

/** Write the files to a real directory: a packaged runtime may read them from an archive. */
export async function writeBuildContext(source: ImageSource) {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-sandbox-image-'))
  try {
    for (const file of source.files) {
      const target = join(directory, file.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.content)
      if (file.path.startsWith('bin/')) await chmod(target, 0o755)
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return { directory, dispose: () => rm(directory, { recursive: true, force: true }) }
}

/** The agent-tools MCP server bundled for Node inside the container. */
export async function readAgentToolsBundle() {
  const here = fileURLToPath(new URL('.', import.meta.url))
  // Compiled runtime: dist/sandbox-tools. Source checkout: the built copy in dist.
  for (const candidate of [
    join(here, '..', 'sandbox-tools', 'agent-tools.mjs'),
    join(here, '..', '..', 'dist', 'sandbox-tools', 'agent-tools.mjs'),
  ])
    if (existsSync(candidate)) return readFile(candidate)
  throw new Error(
    'The sandbox agent-tools bundle is missing. Build the runtime with `pnpm --filter @dovo/runtime build`.',
  )
}
