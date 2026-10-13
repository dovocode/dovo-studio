// Private runtime fixture for native checkpoint/session/checkout integration checks.
// Uses real Git snapshots and HTTP endpoints without invoking an agent provider.
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startRuntime } from '../../packages/runtime/dist/index.js'

const root = process.env.DOVO_DATA_ROOT
if (!root) throw new Error('DOVO_DATA_ROOT is required for the private fixture')
const directories = [join(root, 'project'), join(root, 'linked')]
for (const directory of directories) {
  await mkdir(directory, { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], { stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'GPUI fixture')
  git('config', 'user.email', 'gpui@example.invalid')
  await writeFile(join(directory, 'hello.txt'), 'original 🦀\n')
  git('add', '.')
  git('commit', '-qm', 'Initial fixture')
}
const token = randomBytes(32).toString('hex')
const runtime = await startRuntime({
  databasePath: join(root, 'runtime.sqlite'),
  ownerToken: token,
  host: '127.0.0.1',
  port: 0,
})
async function stop() {
  await runtime.close()
  process.exit(0)
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
const s = runtime.services
// Keep execution private and deterministic; never launch a personal provider CLI.
let failAutomation = true
s.agents.get = async () => ({
  probe: async (agent) => ({
    provider: agent.provider,
    available: true,
    detail: 'Private fixture',
  }),
  run: async (run) => {
    if (s.store.taskSummary(run.taskId).origin === 'code-review') {
      run.onText(JSON.stringify({summary:'Private independent review',notVerified:['Physical device verification'],findings:[{path:'hello.txt',line:1,severity:'high',title:'Fixture greeting changed',trigger:'Read the changed greeting',impact:'The original greeting is lost',suggestion:'Restore the greeting'}]}))
      return
    }
    run.onSession('private-fixture-session')
    run.onPromptAccepted?.()
    if (run.taskId && !run.compact && failAutomation) {
      failAutomation = false
      throw new Error('Fixture provider disconnected')
    }
    if (run.compact)
      run.onEvent?.('item/completed', {
        item: { id: 'fixture-compaction', type: 'contextCompaction' },
      })
    else run.onText('Fixture execution completed')
  },
})
s.preferences.save({ worktreesRoot: join(root, 'worktrees'), enableCodeReviews: true })
s.store.update(() => ({
  version: 1,
  runtimeAddress: '',
  agents: [
    {
      id: 'agent',
      name: 'Fixture agent',
      provider: 'codex',
      model: '',
      instructions: '',
      permission: 'ask',
      endpoint: '',
    },
  ],
  repositories: directories.map((path, i) => ({
    id: i ? 'linked' : 'repo',
    name: i ? 'Linked project' : 'Primary project',
    path,
    branch: 'main',
  })),
  tasks: [],
  automations: [],
}))
const task = s.tasks.create({
  title: 'Saved changes',
  agentId: 'agent',
  repositoryId: 'repo',
  objective: 'Inspect revisions',
  execution: 'main',
  linkedCheckouts: [{ id: 'link', repositoryId: 'linked', execution: 'main', access: 'edit' }],
})
const checkpoints = []
for (const [i, directory] of directories.entries()) {
  const before = await s.git.snapshot(directory, `refs/dovo/checkpoints/turn/${i}/before`)
  await writeFile(join(directory, 'hello.txt'), i ? 'linked change 🦀\n' : 'primary change 🦀\n')
  // An image forces the native saved-preview path rather than an inline text diff.
  if (!i)
    await writeFile(
      join(directory, 'preview.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYAQMAAADaua+7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURSKL5v///9qfpIcAAAABYktHRAH/Ai3eAAAAB3RJTUUH6goNBy0Df71P6AAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0xMC0xM1QwNzo0NTowMyswMDowMK8P3IYAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMTAtMTNUMDc6NDU6MDMrMDA6MDDeUmQ6AAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTEwLTEzVDA3OjQ1OjAzKzAwOjAwiUdF5QAAAAxJREFUCNdjYKAtAAAAYAABN5AXeAAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
  const after = await s.git.snapshot(directory, `refs/dovo/checkpoints/turn/${i}/after`)
  checkpoints.push({ before, after, ...(await s.git.checkpointChanges(directory, before, after)) })
}
s.store.updateTaskHistory(task.id, (current) => ({
  ...current,
  status: 'review',
  checkoutLocked: true,
  checkoutBranch: 'main',
  sessionId: 'fixture-session',
  sessionAgentId: 'agent',
  contextUsage: { used: 100, limit: 1000, updatedAt: new Date().toISOString() },
  messages: [
    {
      id: 'request',
      role: 'user',
      text: 'Inspect saved changes',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'reply',
      role: 'assistant',
      text: 'Both projects updated.',
      createdAt: new Date().toISOString(),
    },
  ],
  files: checkpoints[0].files,
  turns: [
    {
      id: 'turn',
      assistantId: 'reply',
      agentId: 'agent',
      provider: 'codex',
      model: 'fixture',
      status: 'completed',
      startedAt: new Date().toISOString(),
      checkpoint: {
        ...checkpoints[0],
        linked: [
          {
            ...checkpoints[1],
            checkoutId: 'link',
            repositoryId: 'linked',
            repositoryName: 'Linked project',
            directory: directories[1],
            branch: 'main',
          },
        ],
      },
    },
  ],
}))
s.store.update((workspace) => ({
  ...workspace,
  repositories: workspace.repositories.map((repo) =>
    repo.id !== 'repo'
      ? repo
      : {
          ...repo,
          prompts: [
            { id: 'prompt', name: 'review', text: 'Check changes and run the relevant tests.' },
          ],
          actions: [
            {
              id: 'action',
              name: 'Show native fixture',
              command: 'printf "native-project-action\\n"',
            },
          ],
          templates: [
            {
              id: 'template',
              name: 'Native follow-up',
              objective: 'Continue the native task.',
              harness: {
                provider: 'codex',
                model: 'frozen-fixture',
                permission: 'ask',
                endpoint: '',
                instructions: '',
              },
              execution: 'main',
            },
          ],
        },
  ),
}))
const flowNodes = ['trigger', 'review', 'task', 'final'].map((id, index) => ({
  id,
  type: 'automation',
  position: { x: index * 240, y: 0 },
  data: {
    kind: id === 'trigger' ? 'trigger' : id === 'task' ? 'task' : 'review',
    label: id,
    trigger: 'manual',
    schedule: '',
    timezone: 'UTC',
    objective: 'Run fixture automation',
    agentId: 'agent',
    repositoryId: 'repo',
  },
}))
s.store.update((workspace) => ({
  ...workspace,
  automations: [
    {
      id: 'flow',
      name: 'Native fixture workflow',
      enabled: false,
      nodes: flowNodes,
      edges: flowNodes
        .slice(1)
        .map((node, index) => ({
          id: 'edge-' + index,
          source: flowNodes[index].id,
          target: node.id,
        })),
    },
  ],
}))
await writeFile(join(root, 'fixture.json'), JSON.stringify({ taskId: task.id }))
// Publish only after all setup is complete; Rust and GUI drivers use the same fixture.
await writeFile(
  join(root, 'runtime-connection.json'),
  JSON.stringify({ address: `http://127.0.0.1:${runtime.port}`, token }),
  { mode: 0o600 },
)
