// Two private runtimes deliberately share a task ID. No provider or personal data is used.
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../../packages/runtime/dist/index.js'
const root = process.env.DOVO_DATA_ROOT
if (!root) throw new Error('DOVO_DATA_ROOT is required')
const runtimes = []
for (const name of ['first', 'second']) {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  const token = randomBytes(32).toString('hex')
  const runtime = await startRuntime({
    databasePath: join(directory, 'runtime.sqlite'),
    ownerToken: token,
    host: '127.0.0.1',
    port: 0,
  })
  runtimes.push(runtime)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [],
    agents: [],
    automations: [],
    tasks: [
      {
        id: 'shared-task',
        title: `${name} server task`,
        repositoryId: '',
        agentId: '',
        status: 'draft',
        createdAt: '2026-10-13T12:00:00Z',
        draft: '',
        messages: [],
        files: [],
        example: false,
      },
    ],
  }))
  await writeFile(
    join(directory, 'runtime-connection.pending'),
    JSON.stringify({ address: `http://127.0.0.1:${runtime.port}`, token }),
    { mode: 0o600 },
  )
  await rename(
    join(directory, 'runtime-connection.pending'),
    join(directory, 'runtime-connection.json'),
  )
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await Promise.all(runtimes.map((runtime) => runtime.close()))
    process.exit(0)
  })
