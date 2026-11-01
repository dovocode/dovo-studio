import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, glob } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
async function read(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
async function digest(files) {
  const hash = createHash('sha256')
  hash.update(`${process.version}:${process.platform}:${process.arch}`)
  for (const file of [...new Set(files)].sort((a, b) => a.localeCompare(b))) {
    const bytes = await read(file)
    if (!bytes) return undefined
    hash.update(file).update('\0').update(createHash('sha256').update(bytes).digest())
  }
  return hash.digest('hex')
}

/** Reuse a generated bundle only while its real import graph and outputs are unchanged. */
export async function generatedAssetsCache(script, outputs, extraInputs = []) {
  const scriptPath = fileURLToPath(script)
  outputs = outputs.map((path) => fileURLToPath(new URL(path, script)))
  const configuration = []
  for await (const file of glob(
    ['package.json', 'tsconfig*.json', '{apps,packages}/*/{package.json,tsconfig*.json}'],
    { cwd: root },
  ))
    configuration.push(resolve(root, file))
  const required = [
    scriptPath,
    fileURLToPath(import.meta.url),
    root + 'pnpm-lock.yaml',
    root + 'pnpm-workspace.yaml',
    ...configuration,
    ...extraInputs,
  ]
  const path = root + 'node_modules/.cache/dovo-generated-assets/' + basename(scriptPath) + '.json'
  let saved
  const bytes = await read(path)
  if (bytes) {
    try {
      saved = JSON.parse(bytes.toString())
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  const inputs =
    Array.isArray(saved?.inputs) && saved.inputs.every((file) => typeof file === 'string')
      ? saved.inputs
      : []
  const current =
    inputs.length > 0 &&
    typeof saved.inputHash === 'string' &&
    typeof saved.outputHash === 'string' &&
    saved.inputHash === (await digest([...required, ...inputs])) &&
    saved.outputHash === (await digest(outputs))
  return {
    current,
    async save(dependencies = []) {
      const inputs = dependencies
        .filter((file) => !file.startsWith('(disabled):'))
        .map((file) => resolve(file))
      const inputHash = await digest([...required, ...inputs])
      const outputHash = await digest(outputs)
      if (!inputHash || !outputHash) {
        for (const file of [...required, ...inputs, ...outputs]) {
          if (!(await read(file))) throw new Error(`Generated asset file is missing: ${file}`)
        }
      }
      await mkdir(dirname(path), { recursive: true })
      const temporary = path + '.' + randomUUID()
      await writeFile(
        temporary,
        JSON.stringify({ inputs: [...new Set([...required, ...inputs])], inputHash, outputHash }),
      )
      await rename(temporary, path)
    },
  }
}
