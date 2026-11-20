import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { decode, mutableStruct, type Task } from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { createServices } from '../services.js'
import { openDatabase } from '../storage/database.js'

/** A controlled container CLI. `listing` holds `ps` until the test releases it. */
const cli = vi.hoisted(() => ({
  calls: [] as string[][],
  containers: new Map<string, { thread: string; running: boolean }>(),
  listing: undefined as { started: () => void; held: Promise<void> } | undefined,
}))
vi.mock('./container-cli.js', async (original) => ({
  ...(await original<typeof import('./container-cli.js')>()),
  detectContainerCli: async () => ({
    cli: { kind: 'docker' as const, command: 'docker', rootless: false },
  }),
  runCli: async (_command: string, args: readonly string[]) => {
    cli.calls.push([...args])
    const ok = (stdout = '') => ({ stdout, stderr: '', code: 0 })
    const name = args.at(-1) ?? ''
    if (args[0] === 'ps' && cli.listing) {
      cli.listing.started()
      await cli.listing.held
    }
    if (args[0] === 'ps')
      return ok(
        [...cli.containers]
          .map(([key, item]) => `${key}\t${item.thread}\t${item.running ? 'running' : 'exited'}`)
          .join('\n'),
      )
    if (args[0] === 'stop' && cli.containers.has(name)) {
      cli.containers.get(name)!.running = false
      return ok()
    }
    if (args[0] === 'rm' && cli.containers.delete(name)) return ok()
    return { stdout: '', stderr: 'Error: No such container', code: 1 }
  },
}))

const temporary: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  cli.calls.length = 0
  cli.containers.clear()
  cli.listing = undefined
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const thread: Task = {
  id: 'task-1',
  title: 'Sandboxed',
  repositoryId: 'repo',
  agentId: 'agent',
  status: 'draft',
  createdAt: '2026-11-20T00:00:00Z',
  draft: '',
  files: [],
  example: false,
  messages: [],
}

it('keeps the sandbox of an unreadable task through startup cleanup until it is deleted', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-unreadable-sandbox-'))
  temporary.push(directory)
  const databasePath = join(directory, 'runtime.sqlite')
  const open = async (use: (services: ReturnType<typeof createServices>) => Promise<void>) => {
    const db = openDatabase(databasePath)
    const services = createServices(db, 'sandbox-cleanup-owner-token-with-32-characters')
    try {
      await use(services)
    } finally {
      await services.sandboxes.dispose()
      await services.tasks.dispose()
      db.close()
    }
  }
  let privateFile = ''
  let container = ''
  let stored = ''
  await open(async (services) => {
    services.store.update((current) => ({ ...current, tasks: [thread] }))
    const state = services.sandboxes.stateDirectory(thread.id)
    mkdirSync(state, { recursive: true })
    privateFile = join(state, 'notes.txt')
    writeFileSync(privateFile, 'keep')
    container = services.sandboxes.containerName(thread.id)
    stored = decode(
      mutableStruct({ value: Schema.String }),
      services.db.prepare('SELECT value FROM workspace_tasks WHERE task_id = ?').get(thread.id),
    ).value
    // A newer runtime wrote a status that this runtime cannot read.
    services.db
      .prepare('UPDATE workspace_tasks SET value = ? WHERE task_id = ?')
      .run(JSON.stringify({ ...JSON.parse(stored), status: 'from-a-newer-runtime' }), thread.id)
  })
  cli.containers.set(container, { thread: thread.id, running: true })

  vi.spyOn(console, 'error').mockImplementation(() => {})
  await open(async (services) => {
    expect(services.store.get().tasks).toEqual([])
    await services.sandboxes.reconcile()
  })
  expect(cli.calls.filter((args) => args[0] === 'rm')).toEqual([])
  expect(cli.containers.get(container)).toEqual({ thread: thread.id, running: false })
  expect(readFileSync(privateFile, 'utf8')).toBe('keep')
  vi.restoreAllMocks()

  // After a compatible row loads again, an explicit deletion releases the sandbox.
  const db = openDatabase(databasePath)
  db.prepare('UPDATE workspace_tasks SET value = ? WHERE task_id = ?').run(stored, thread.id)
  db.close()
  await open(async (services) => {
    expect(services.store.get().tasks.map((task) => task.id)).toEqual([thread.id])
    services.store.update((current) => ({ ...current, tasks: [] }))
    await services.sandboxes.reconcile()
  })
  expect(cli.containers.has(container)).toBe(false)
  expect(existsSync(privateFile)).toBe(false)
})

it('drains startup cleanup before shutdown finishes and leaves the rest to the next runtime', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-sandbox-shutdown-'))
  temporary.push(directory)
  const options = {
    databasePath: join(directory, 'runtime.sqlite'),
    ownerToken: 'sandbox-shutdown-owner-token-with-32-characters',
    port: 0,
  }
  mkdirSync(join(directory, 'sandboxes', 'threads'), { recursive: true })
  let started = () => {}
  let release = () => {}
  const listing = new Promise<void>((resolve) => (started = resolve))
  cli.listing = { started, held: new Promise<void>((resolve) => (release = resolve)) }
  const first = await startRuntime(options)
  // A thread that no longer exists: startup cleanup removes its container and files.
  const container = first.services.sandboxes.containerName('deleted-task')
  const privateFile = join(first.services.sandboxes.stateDirectory('deleted-task'), 'notes.txt')
  mkdirSync(join(privateFile, '..'), { recursive: true })
  writeFileSync(privateFile, 'from the previous runtime')
  cli.containers.set(container, { thread: 'deleted-task', running: true })
  await listing

  const closing = first.close()
  const outcome = await Promise.race([
    closing.then(() => 'closed'),
    new Promise((resolve) => setTimeout(() => resolve('draining'), 500)),
  ])
  expect(outcome).toBe('draining')
  expect(first.services.db.open).toBe(true)
  release()
  await closing
  expect(first.services.db.open).toBe(false)
  // Shutdown started before the listing returned, so this runtime ran no further cleanup.
  expect(cli.calls.map((args) => args[0])).toEqual(['ps'])
  expect(cli.containers.get(container)).toEqual({ thread: 'deleted-task', running: true })
  expect(readFileSync(privateFile, 'utf8')).toBe('from the previous runtime')

  cli.listing = undefined
  const replacement = await startRuntime(options)
  try {
    await replacement.services.sandboxes.reconcile()
  } finally {
    await replacement.close()
  }
  expect(cli.containers.has(container)).toBe(false)
  expect(existsSync(privateFile)).toBe(false)
}, 30_000)
