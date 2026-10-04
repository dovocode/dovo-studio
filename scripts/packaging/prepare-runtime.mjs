import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'
import { appendFile } from 'node:fs/promises'
import { prepareRuntime } from './prepared-runtime.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = process.env.DOVO_PREPARED_RUNTIME
if (!directory || !isAbsolute(directory))
  throw new Error('Set DOVO_PREPARED_RUNTIME to a new absolute directory')
await prepareRuntime(root, directory)
if (process.env.GITHUB_ENV)
  await appendFile(process.env.GITHUB_ENV, `DOVO_PREPARED_RUNTIME=${directory}\n`)
