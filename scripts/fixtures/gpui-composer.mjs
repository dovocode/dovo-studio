// Deterministic composer fixture. Uses private Git files and a fake provider only.
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startRuntime } from '../../packages/runtime/dist/index.js'
const root = process.env.DOVO_DATA_ROOT
if (!root) throw new Error('DOVO_DATA_ROOT is required')
const directory = join(root, 'project')
await mkdir(directory, { recursive: true })
execFileSync('git', ['init', '-q', '-b', 'main', directory])
await writeFile(join(directory, 'hello.txt'), 'Private composer file\n')
await writeFile(join(directory, 'other.txt'), 'Other private composer file\n')
const token = randomBytes(32).toString('hex')
const runtime = await startRuntime({
  databasePath: join(root, 'runtime.sqlite'),
  ownerToken: token,
  host: '127.0.0.1',
  port: 0,
})
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await runtime.close()
    process.exit(0)
  })
const s = runtime.services
const skill = {
  name: 'private-skill',
  description: 'Private disabled skill',
  enabled: false,
  content: 'Only apply to this message',
}
const server = {
  name: 'private-server',
  enabled: true,
  transport: 'stdio',
  command: 'node',
  args: [],
  env: {},
  headerEnv: {},
}
s.defaults.save(
  {
    ...s.defaults.get(),
    scopedSettings: {
      environment: { resources: { skills: [skill], mcpServers: [server] } },
      shared: [
        {
          key: 'global',
          updatedAt: Date.now(),
          changeId: 'private-fixture',
          value: {
            prompts: [
              { id: 'prompt', name: 'private-prompt', text: 'Inspect the 🦀 without edits.' },
            ],
          },
        },
      ],
    },
  },
  false,
)
s.store.update((workspace) => ({
  ...workspace,
  agents: [
    {
      id: 'agent',
      name: 'Private agent',
      provider: 'claude',
      model: '',
      permission: 'ask',
      instructions: '',
      endpoint: '',
    },
  ],
  repositories: [{ id: 'repo', name: 'Private composer project', path: directory, branch: 'main' }],
  tasks: [],
  automations: [],
}))
s.agents.get = async () => ({
  probe: async () => ({ provider: 'claude', available: true, detail: 'Private fixture' }),
  run: async (run) => {
    run.onSession('private-session')
    run.onText('Private review completed.')
  },
})
const task = s.tasks.create({
  title: 'Composer fixture',
  repositoryId: 'repo',
  agentId: 'agent',
  objective: '',
  execution: 'main',
})
s.tasks.create({
  title: 'Other draft',
  repositoryId: 'repo',
  agentId: 'agent',
  objective: '',
  execution: 'main',
})
await writeFile(join(root, 'fixture.json'), JSON.stringify({ taskId: task.id }))
await writeFile(
  join(root, 'runtime-connection.pending'),
  JSON.stringify({ address: 'http://127.0.0.1:' + runtime.port, token }),
  { mode: 0o600 },
)
await rename(join(root, 'runtime-connection.pending'), join(root, 'runtime-connection.json'))
