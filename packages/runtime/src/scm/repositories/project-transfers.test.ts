import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID, createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  chmod,
  stat,
  symlink,
  readdir,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startRuntime } from '../../index.js'
import { exec } from '../../process.js'
import {
  decode,
  projectTransferInspectionSchema,
  projectTransferSchema,
  projectTransferManifestSchema,
  projectTransferPlanSchema,
  type ProjectTransferStart,
} from '@dovo/protocol'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration.js'
import { addRepository } from './repositories.js'
import { transferPath, projectTransferRemote } from './project-transfer-files.js'
import { runClientEffect } from '@dovo/client-runtime'
import { listWorktreesEffect, worktreeChoicesEffect } from '../git/worktrees.js'
import { TaskCheckout } from '../tasks/task-checkout.js'
vi.mock('node:fs/promises', async (importOriginal) => {
  const files = await importOriginal<typeof import('node:fs/promises')>()
  return { ...files, rm: vi.fn<typeof files.rm>(files.rm) }
})
vi.setConfig(runtimeIntegration)
const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(rm).mockReset()
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
})
const owner = 'project-copy-test-owner-at-least-32-characters'
async function host(databasePath = ':memory:') {
  const runtime = await startRuntime({ databasePath, ownerToken: owner, port: 0 })
  cleanup.push(runtime.close)
  const post = (action: string, input: unknown = {}, token = owner) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/scm/project-transfer/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  return { ...runtime, post }
}
async function setup(git = false, persistentTarget = false) {
  const root = await mkdtemp(join(tmpdir(), 'dovo-copy-test-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  vi.stubEnv('DOVO_DATA_ROOT', join(root, 'dovo'))
  const source = await host(),
    target = await host(persistentTarget ? join(root, 'target.sqlite') : ':memory:')
  const path = join(root, 'source')
  await mkdir(path)
  await writeFile(join(path, 'readme.txt'), 'Source project')
  if (git) {
    await exec('git', ['init', '-b', 'main', path])
    await exec('git', ['config', 'user.email', 'copy@example.test'], { cwd: path })
    await exec('git', ['config', 'user.name', 'Copy test'], { cwd: path })
    await exec('git', ['add', '.'], { cwd: path })
    await exec('git', ['commit', '-qm', 'Local initial commit'], { cwd: path })
  }
  const repository = await addRepository(source.services, {
    source: 'local',
    name: 'My project',
    path,
  })
  source.services.retrievalPeers.register('owner', {
    sessionId: 'copy',
    peers: [
      {
        id: target.services.runtimeId,
        name: 'Destination',
        connection: {
          address: `http://127.0.0.1:${target.port}`,
          token: owner,
          runtimeId: target.services.runtimeId,
        },
      },
    ],
  })
  const input: ProjectTransferStart = {
    id: randomUUID(),
    repositoryId: repository.id,
    targetId: target.services.runtimeId,
    ignoredFiles: [],
  }
  const result = async () => {
    await waitForRuntime(() =>
      expect(
        source.services.projectTransfers.list().find((job) => job.id === input.id)?.state,
      ).toMatch(/completed|failed|cancelled/),
    )
    const job = source.services.projectTransfers.list().find((job) => job.id === input.id)
    expect(job?.error).toBeUndefined()
    expect(job?.state).toBe('completed')
    const copied = target.services.store
      .get()
      .repositories.find((repo) => repo.id === job?.targetRepositoryId)
    expect(copied).toBeDefined()
    return copied!
  }
  return { root, source, target, repository, path, input, result }
}
it.each([true, false])(
  'copies many files with batch support %s, preserving source bytes',
  async (batchesSupported) => {
    const { source, target, path, input, result } = await setup()
    const originalStatus = target.services.projectTransfers.status.bind(
      target.services.projectTransfers,
    )
    vi.spyOn(target.services.projectTransfers, 'status').mockImplementation((...args) => ({
      ...originalStatus(...args),
      batchesSupported,
    }))
    const batch = vi.spyOn(target.services.projectTransfers, 'batch')
    const files = Array.from({ length: 300 }, (_, i) => ({
      name: `file-${i}.txt`,
      contents: i % 7 ? `contents-${i}` : '',
    }))
    await Promise.all(files.map((file) => writeFile(join(path, file.name), file.contents)))
    await writeFile(join(path, 'binary'), Buffer.alloc(300000, 123))
    expect((await source.post('start', input)).status).toBe(200)
    const copied = await result()
    await Promise.all(
      files.map(async (file) => {
        expect(await readFile(join(copied.path, file.name), 'utf8')).toBe(file.contents)
        expect(await readFile(join(path, file.name), 'utf8')).toBe(file.contents)
      }),
    )
    expect(await readFile(join(copied.path, 'binary'))).toEqual(Buffer.alloc(300000, 123))
    expect(batch.mock.calls.length).toBeGreaterThanOrEqual(batchesSupported ? 2 : 0)
    expect(batch.mock.calls.length).toBeLessThanOrEqual(batchesSupported ? 5 : 0)
    for (const [input] of batch.mock.calls) {
      expect(input.chunks.length).toBeLessThanOrEqual(128)
      expect(
        input.chunks.reduce((sum, chunk) => sum + Buffer.from(chunk.data, 'base64').length, 0),
      ).toBeLessThanOrEqual(256 * 1024)
    }
  },
)
it('copies the selected worktree with its index and dirty files, creating one destination thread', async () => {
  const { root, source, target, repository, path, input, result } = await setup(true)
  const worktree = join(root, 'feature-worktree')
  await exec('git', ['worktree', 'add', '-b', 'feature-copy', worktree], { cwd: path })
  await writeFile(join(worktree, 'readme.txt'), 'Staged worktree text')
  await exec('git', ['add', 'readme.txt'], { cwd: worktree })
  await writeFile(join(worktree, 'readme.txt'), 'Working worktree text')
  await writeFile(join(worktree, 'untracked.txt'), 'Local file')
  await writeFile(join(worktree, '.env.local'), 'STAYS=private')
  input.worktreePath = worktree
  input.destination = { parentDirectory: root }
  input.thread = { title: 'Continue on destination', prompt: '' }
  const inspection = await source.post('inspect', {
    repositoryId: repository.id,
    worktreePath: worktree,
  })
  expect(inspection.status).toBe(200)
  expect(
    decode(projectTransferInspectionSchema, await inspection.json()).ignoredFiles.map(
      (file) => file.path,
    ),
  ).toContain('.env.local')
  const plan = await source.post('plan', {
    repositoryId: repository.id,
    worktreePath: worktree,
    targetId: input.targetId,
  })
  expect(plan.status).toBe(200)
  expect(decode(projectTransferPlanSchema, await plan.json()).repositories).toEqual([])
  expect((await source.post('start', input)).status).toBe(200)
  const copied = await result()
  const copiedPath = source.services.projectTransfers.list()[0]!.path!
  expect(copiedPath.startsWith(target.services.preferences.worktreesRoot())).toBe(true)
  expect(copied.path.startsWith(root)).toBe(true)
  expect(copied.path).not.toBe(copiedPath)
  expect(await readFile(join(copied.path, 'readme.txt'), 'utf8')).toBe('Source project')
  expect(
    (await exec('git', ['branch', '--show-current'], { cwd: copied.path })).stdout.trim(),
  ).toBe('main')
  expect(await readFile(join(copiedPath, 'readme.txt'), 'utf8')).toBe('Working worktree text')
  expect((await exec('git', ['show', ':readme.txt'], { cwd: copiedPath })).stdout).toBe(
    'Staged worktree text',
  )
  expect((await exec('git', ['branch', '--show-current'], { cwd: copiedPath })).stdout.trim()).toBe(
    'feature-copy',
  )
  expect(await readFile(join(copiedPath, 'untracked.txt'), 'utf8')).toBe('Local file')
  expect(await readdir(copiedPath)).not.toContain('.env.local')
  expect(await readFile(join(path, 'readme.txt'), 'utf8')).toBe('Source project')
  const task = target.services.store.task(target.services.store.get().tasks[0]!.id)
  expect(task).toMatchObject({
    title: input.thread.title,
    repositoryId: copied.id,
    execution: 'worktree',
    existingWorktreePath: copiedPath,
    checkoutBranch: 'feature-copy',
    status: 'draft',
    messages: [],
  })
  expect(source.services.projectTransfers.list()[0]?.targetTaskId).toBe(task?.id)
  expect((await source.post('retry', { id: input.id })).status).toBe(200)
  const receipt = await target.post('commit', { id: input.id })
  expect(await receipt.json()).toMatchObject({ taskId: task?.id, repositoryId: copied.id })
  expect(target.services.store.get().tasks).toHaveLength(1)
})
it('copies source files when ignored files exceed the optional selection limit', async () => {
  const { source, path, input, result } = await setup(true)
  await writeFile(join(path, '.gitignore'), 'local-cache/\n.expo/\n')
  await mkdir(join(path, 'local-cache'))
  await mkdir(join(path, '.expo'))
  await writeFile(join(path, '.expo', 'generated'), 'Generated output')
  for (let offset = 0; offset < 10001; offset += 100) {
    await Promise.all(
      Array.from({ length: Math.min(100, 10001 - offset) }, (_, index) =>
        writeFile(join(path, 'local-cache', `${offset + index}.txt`), 'Optional local file'),
      ),
    )
  }
  const response = await source.post('inspect', { repositoryId: input.repositoryId })
  expect(response.status).toBe(200)
  const inspection = decode(projectTransferInspectionSchema, await response.json())
  expect(inspection.ignoredFilesTruncated).toBe(true)
  expect(inspection.ignoredFiles).toHaveLength(10000)
  expect(inspection.ignoredFiles.some((file) => file.path.startsWith('.expo/'))).toBe(false)
  const selected = inspection.ignoredFiles[0]!.path
  input.ignoredFiles = [selected]
  expect((await source.post('start', input)).status).toBe(200)
  const copied = await result()
  expect(await readFile(join(copied.path, 'readme.txt'), 'utf8')).toBe('Source project')
  expect(await readFile(join(copied.path, selected), 'utf8')).toBe('Optional local file')
  expect(await readdir(join(copied.path, 'local-cache'))).toHaveLength(1)
  expect(await readdir(join(path, 'local-cache'))).toHaveLength(10001)
})
it('rejects a worktree path outside the selected project', async () => {
  const { root, source, repository, path, input } = await setup(true)
  const other = join(root, 'other')
  await mkdir(other)
  const inspect = await source.post('inspect', { repositoryId: repository.id, worktreePath: other })
  expect(inspect.status).toBe(409)
  input.worktreePath = path
  input.destination = { parentDirectory: root }
  expect((await source.post('start', input)).status).toBe(200)
  await waitForRuntime(() =>
    expect(source.services.projectTransfers.list()[0]?.state).toBe('failed'),
  )
  expect(source.services.projectTransfers.list()[0]?.error).toContain('belonging to this project')
})
it('requires destination support before transferring files for a new thread', async () => {
  const { source, target, input } = await setup()
  input.thread = { title: 'New thread', prompt: '' }
  const original = target.services.projectTransfers.status.bind(target.services.projectTransfers)
  vi.spyOn(target.services.projectTransfers, 'status').mockImplementation((...args) => ({
    ...original(...args),
    worktreesSupported: false,
  }))
  const begin = vi.spyOn(target.services.projectTransfers, 'begin')
  expect((await source.post('start', input)).status).toBe(200)
  await waitForRuntime(() =>
    expect(source.services.projectTransfers.list()[0]?.state).toBe('failed'),
  )
  expect(source.services.projectTransfers.list()[0]?.error).toContain('Update the destination')
  expect(begin).not.toHaveBeenCalled()
  expect(target.services.store.get().repositories).toEqual([])
  expect(target.services.store.get().tasks).toEqual([])
})
it('starts the requested prompt in the copied checkout and preserves a draft if startup fails', async () => {
  const { source, target, input, result } = await setup()
  input.thread = { title: 'Fix the tests', prompt: 'Check the transferred changes' }
  const start = vi
    .spyOn(target.services.tasks, 'start')
    .mockRejectedValue(new Error('Agent not installed'))
  expect((await source.post('start', input)).status).toBe(200)
  const copied = await result()
  const task = target.services.store.task(target.services.store.get().tasks[0]!.id)
  expect(task).toMatchObject({ repositoryId: copied.id, execution: 'main', status: 'draft' })
  expect(task?.messages[0]?.text).toBe(input.thread.prompt)
  expect(start).toHaveBeenCalledExactlyOnceWith(task?.id)
  expect(source.services.projectTransfers.list()[0]).toMatchObject({
    targetTaskId: task?.id,
    threadStartError: 'Agent not installed',
  })
  expect((await source.post('retry', { id: input.id })).status).toBe(200)
  expect(start).toHaveBeenCalledTimes(1)
})
it('copies a plain workspace directly, with binary chunks, empty files, ignored selection and no chats', async () => {
  const { source, target, path, input, result } = await setup()
  const binary = Buffer.alloc(700000)
  for (let i = 0; i < binary.length; i++) binary[i] = i % 251
  await writeFile(join(path, 'asset.bin'), binary)
  await writeFile(join(path, 'empty'), '')
  await writeFile(join(path, '.env'), 'SECRET_CONFIG=selected')
  await writeFile(join(path, '.env.private'), 'KEEP_HERE=1')
  await mkdir(join(path, 'node_modules'))
  await writeFile(join(path, 'node_modules', 'generated'), 'Do not copy')
  if (process.platform !== 'win32') await symlink('/etc/passwd', join(path, 'external-link'))
  const inspect = decode(
    projectTransferInspectionSchema,
    await (await source.post('inspect', { repositoryId: input.repositoryId })).json(),
  )
  expect(inspect.ignoredFiles.map((file) => file.path).sort()).toEqual(['.env', '.env.private'])
  await chmod(join(path, '.env'), 0o600)
  input.ignoredFiles = ['.env']
  expect((await source.post('start', input)).status).toBe(200)
  const copied = await result()
  expect(await readFile(join(copied.path, 'asset.bin'))).toEqual(binary)
  expect(await readFile(join(copied.path, 'empty'), 'utf8')).toBe('')
  expect(await readFile(join(copied.path, '.env'), 'utf8')).toBe('SECRET_CONFIG=selected')
  const configMode = (await stat(join(copied.path, '.env'))).mode & 0o777
  expect(process.platform === 'win32' || configMode === 0o600).toBe(true)
  expect((await readdir(copied.path)).sort()).toEqual(['.env', 'asset.bin', 'empty', 'readme.txt'])
  expect(target.services.store.get().tasks).toEqual([])
  expect(source.services.store.get().repositories).toHaveLength(1)
  expect(await readFile(join(path, '.env.private'), 'utf8')).toBe('KEEP_HERE=1')
  const logs = JSON.stringify(target.services.activity.list('', '', 0))
  expect(logs).not.toContain(Buffer.from('SECRET_CONFIG=selected').toString('base64'))
})
it('preserves unpushed commits, branches, tags, staged edits, dirty files and deletions without copying Git config', async () => {
  const { source, path, input, result } = await setup(true)
  const git = (args: string[]) => exec('git', args, { cwd: path }).then((result) => result.stdout)
  await writeFile(join(path, '.gitignore'), '.env*\nnode_modules/\n')
  await writeFile(join(path, 'delete-me'), 'old')
  await writeFile(join(path, 'run.sh'), '#!/bin/sh\necho ready\n')
  await chmod(join(path, 'run.sh'), 0o755)
  await git(['add', '.'])
  await git(['commit', '-qm', 'Unpushed changes'])
  await git(['branch', 'local-feature'])
  await git(['tag', 'local-tag'])
  await git(['remote', 'add', 'origin', 'https://github.com/test/source.git'])
  await git(['config', 'credential.helper', '!secret-do-not-copy'])
  await writeFile(join(path, 'readme.txt'), 'Staged version')
  await git(['add', 'readme.txt'])
  await writeFile(join(path, 'readme.txt'), 'Working version')
  await rm(join(path, 'delete-me'))
  await writeFile(join(path, 'new.txt'), 'Untracked')
  await writeFile(join(path, '.env.local'), 'selected=1')
  input.ignoredFiles = ['.env.local']
  const before = await git(['status', '--porcelain=v1'])
  const head = (await git(['rev-parse', 'HEAD'])).trim()
  expect((await source.post('start', input)).status).toBe(200)
  const copied = await result()
  const copiedGit = (args: string[]) =>
    exec('git', args, { cwd: copied.path }).then((result) => result.stdout.trim())
  expect(await copiedGit(['rev-parse', 'HEAD'])).toBe(head)
  expect(await copiedGit(['branch', '--show-current'])).toBe('main')
  expect(await copiedGit(['rev-parse', 'local-feature'])).toBe(head)
  expect(await copiedGit(['rev-parse', 'local-tag'])).toBe(head)
  expect(await copiedGit(['show', ':readme.txt'])).toBe('Staged version')
  expect(await readFile(join(copied.path, 'readme.txt'), 'utf8')).toBe('Working version')
  expect(await copiedGit(['status', '--porcelain=v1'])).toBe(before.trim())
  expect(await copiedGit(['remote', 'get-url', 'origin'])).toBe(
    'https://github.com/test/source.git',
  )
  expect(await readFile(join(copied.path, '.git/config'), 'utf8')).not.toContain(
    'secret-do-not-copy',
  )
  expect(
    process.platform === 'win32' ||
      ((await stat(join(copied.path, 'run.sh'))).mode & 0o111) === 0o111,
  ).toBe(true)
  expect(await git(['status', '--porcelain=v1'])).toBe(before)
})
it('deduplicates starts and reconciles a lost commit response without registering twice', async () => {
  const { source, target, input, result } = await setup()
  input.thread = { title: 'Transferred thread', prompt: 'Continue here' }
  const start = vi
    .spyOn(target.services.tasks, 'start')
    .mockResolvedValue({ done: Promise.resolve() })
  const original = globalThis.fetch
  let lost = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const response = await original(url, init)
    if (
      !lost &&
      (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url) ===
        `http://127.0.0.1:${target.port}/api/scm/project-transfer/commit`
    ) {
      lost = true
      throw new Error('Response lost after commit')
    }
    return response
  })
  const first = await source.post('start', input),
    second = await source.post('start', input)
  expect(decode(projectTransferSchema, await first.json()).id).toBe(input.id)
  expect(second.status).toBe(200)
  await result()
  expect(lost).toBe(true)
  expect(target.services.store.get().tasks).toHaveLength(1)
  expect(start).toHaveBeenCalledTimes(1)
  expect(target.services.store.get().repositories).toHaveLength(1)
  expect((await source.post('retry', { id: input.id })).status).toBe(200)
  expect(target.services.store.get().repositories).toHaveLength(1)
})
it('cancels during copying, removes partial files and retries the saved request', async () => {
  const { source, target, path, input, result } = await setup()
  await writeFile(join(path, 'large'), Buffer.alloc(800000))
  const original = target.services.projectTransfers.chunk.bind(target.services.projectTransfers)
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const chunk = vi
    .spyOn(target.services.projectTransfers, 'chunk')
    .mockImplementationOnce(async (...args) => {
      await barrier
      return original(...args)
    })
  expect((await source.post('start', input)).status).toBe(200)
  await waitForRuntime(() => expect(chunk).toHaveBeenCalled())
  const pending = source.post('cancel', { id: input.id })
  release()
  expect((await pending).status).toBe(200)
  expect(source.services.projectTransfers.list()[0]?.state).toBe('cancelled')
  expect(target.services.store.get().repositories).toEqual([])
  expect((await source.post('retry', { id: input.id })).status).toBe(200)
  await result()
  expect(target.services.store.get().repositories).toHaveLength(1)
})
it('requires real pairing, rejects agent credentials and isolates receiving-device grants', async () => {
  const { source, target, input } = await setup()
  expect((await source.post('start', input, 'invalid')).status).toBe(401)
  expect((await source.post('start', { ...input, targetId: 'unpaired' })).status).toBe(409)
  const controller = new AbortController()
  source.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'test',
        title: 'Agent',
        repositoryId: '',
        agentId: '',
        status: 'running',
        activeRunId: 'run',
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  const token = source.services.runCredentials.issue(
    {
      taskId: 'test',
      runId: 'run',
      readOnly: false,
      permissions: { provider: 'codex', permission: 'ask' },
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
    },
    controller.signal,
  )
  expect((await source.post('start', input, token)).status).toBe(403)
  controller.abort()
  const other = 'other-valid-device-token-at-least-32-characters'
  target.services.devices.add('Other phone', other)
  const manifest = {
    id: randomUUID(),
    runtimeId: target.services.runtimeId,
    name: 'Copy',
    entries: [],
  }
  expect((await target.post('begin', manifest)).status).toBe(200)
  expect((await target.post('commit', { id: manifest.id }, other)).status).toBe(404)
  expect((await target.post('discard', { id: manifest.id }, other)).status).toBe(404)
  expect(
    (await target.post('begin', { ...manifest, id: randomUUID(), runtimeId: 'wrong-computer' }))
      .status,
  ).toBe(409)
  expect((await target.post('discard', { id: manifest.id })).status).toBe(200)
})
it('rejects traversal, Git metadata, symlink escapes, nonportable paths and corrupt bytes', async () => {
  const { target } = await setup()
  for (const path of [
    '../outside',
    '/tmp/escape',
    'C:/escape',
    'file:stream',
    '.git/config',
    'folder/.GIT/config',
    'x\\y',
    'con.txt',
    'alias.',
  ])
    expect(() => transferPath(path)).toThrow('file name cannot be copied')
  const manifest = decode(projectTransferManifestSchema, {
    id: randomUUID(),
    runtimeId: target.services.runtimeId,
    name: 'Corrupt',
    entries: [
      {
        path: 'file.txt',
        kind: 'file',
        bytes: 4,
        mode: 0o600,
        sha256: createHash('sha256').update('good').digest('hex'),
      },
    ],
  })
  expect((await target.post('begin', manifest)).status).toBe(200)
  expect(
    (await target.post('chunk', { id: manifest.id, index: 0, offset: 1, data: 'YmFkIQ==' })).status,
  ).toBe(409)
  expect(
    (await target.post('chunk', { id: manifest.id, index: 0, offset: 0, data: 'YmFkIQ==' })).status,
  ).toBe(200)
  const failed = await target.post('commit', { id: manifest.id })
  expect(failed.status).toBe(409)
  expect(await failed.text()).toContain('verification')
  expect(target.services.store.get().repositories).toEqual([])
  expect(
    (
      await target.post('begin', {
        ...manifest,
        id: randomUUID(),
        entries: [{ ...manifest.entries[0], path: '../escape' }],
      })
    ).status,
  ).toBe(400)
})
it('reports an interrupted job after restarting the source and retains completed destination receipts', async () => {
  const { source, target, input, result, root } = await setup(false, true)
  expect((await source.post('start', input)).status).toBe(200)
  const copied = await result()
  const receipt = target.services.projectTransfers.status(input.id, 'owner')
  expect(receipt.result?.path).toBe(copied.path)
  await target.close()
  const restartedTarget = await host(join(root, 'target.sqlite'))
  expect(restartedTarget.services.projectTransfers.status(input.id, 'owner')).toEqual(receipt)
  expect((await restartedTarget.post('commit', { id: input.id })).status).toBe(200)
  expect(restartedTarget.services.store.get().repositories).toHaveLength(1)
  const persisted = await host(join(root, 'persistent.sqlite'))
  const pending = {
    id: randomUUID(),
    repositoryId: 'source',
    targetId: 'target',
    targetName: 'Target',
    transport: 'p2p',
    state: 'copying',
    bytes: 1,
    totalBytes: 2,
    updatedAt: Date.now(),
  }
  persisted.services.db.prepare('INSERT INTO project_transfers VALUES (?,?)').run(
    pending.id,
    JSON.stringify({
      job: pending,
      input: { ...input, id: pending.id },
      fingerprint: 'fingerprint',
      device: 'owner',
    }),
  )
  await persisted.close()
  const restarted = await host(join(root, 'persistent.sqlite'))
  expect(restarted.services.projectTransfers.list()[0]).toMatchObject({
    state: 'failed',
    error: expect.stringContaining('restarted'),
  })
})
it('keeps credential-bearing and executable Git remotes out of the destination configuration', () => {
  for (const remote of [
    'https://token@github.com/org/repo.git',
    'ssh://git:password@host/org/repo',
    'ext::evil command',
    '/local/path',
    'file:///local/path',
  ])
    expect(projectTransferRemote(remote)).toBeUndefined()
  expect(projectTransferRemote('git@github.com:org/repo.git')).toBe('git@github.com:org/repo.git')
  expect(projectTransferRemote('ssh://git@host:2222/org/repo')).toBe('ssh://git@host:2222/org/repo')
})

it('reuses a matching destination project and preserves its dirty checkout and colliding branch', async () => {
  const { root, source, target, repository, path, input, result } = await setup(true)
  const git = (cwd: string, args: string[]) =>
    exec('git', args, { cwd }).then((result) => result.stdout.trim())
  await git(path, ['remote', 'add', 'origin', 'git@github.com:copy/project.git'])
  const main = join(root, 'destination-main')
  await exec('git', ['clone', path, main])
  await git(main, ['remote', 'set-url', 'origin', 'https://github.com/copy/project'])
  const destination = await addRepository(target.services, {
    source: 'local',
    name: 'Existing project',
    path: main,
  })
  const customRoot = join(root, 'custom-worktrees')
  target.services.preferences.save({ worktreesRoot: customRoot })
  const feature = join(root, 'source-feature')
  await git(path, ['worktree', 'add', '-b', 'feature-copy', feature])
  await writeFile(join(feature, 'committed.txt'), 'Unpushed feature commit')
  await git(feature, ['add', '.'])
  await git(feature, ['commit', '-qm', 'Only on source feature'])
  const head = await git(feature, ['rev-parse', 'HEAD'])
  await writeFile(join(feature, 'readme.txt'), 'Staged')
  await git(feature, ['add', '.'])
  await writeFile(join(feature, 'readme.txt'), 'Dirty')
  await rm(join(feature, 'committed.txt'))
  await writeFile(join(feature, 'untracked'), 'Local')
  await git(main, ['branch', 'feature-copy'])
  const beforeRefs = await git(main, [
    'for-each-ref',
    '--format=%(refname):%(objectname)',
    'refs/heads/',
  ])
  await writeFile(join(main, 'readme.txt'), 'Destination local edit')
  const beforeStatus = await git(main, ['status', '--porcelain=v1'])
  const plan = await source.post('plan', {
    repositoryId: repository.id,
    worktreePath: feature,
    targetId: input.targetId,
  })
  expect(decode(projectTransferPlanSchema, await plan.json())).toEqual({
    repositories: [{ id: destination.id, name: destination.name, path: main }],
    worktreesRoot: customRoot,
  })
  input.worktreePath = feature
  input.destination = { repositoryId: destination.id }
  input.thread = { title: 'Continue feature', prompt: '' }
  expect((await source.post('start', input)).status).toBe(200)
  const copied = await result()
  expect(copied.id).toBe(destination.id)
  const copiedPath = source.services.projectTransfers.list()[0]!.path!
  expect(copiedPath.startsWith(customRoot)).toBe(true)
  expect(await git(copiedPath, ['rev-parse', 'HEAD'])).toBe(head)
  expect(await git(copiedPath, ['show', ':readme.txt'])).toBe('Staged')
  expect(await readFile(join(copiedPath, 'readme.txt'), 'utf8')).toBe('Dirty')
  expect(await git(copiedPath, ['status', '--porcelain=v1'])).toBe(
    await git(feature, ['status', '--porcelain=v1']),
  )
  expect(await git(main, ['status', '--porcelain=v1'])).toBe(beforeStatus)
  expect(await readFile(join(main, 'readme.txt'), 'utf8')).toBe('Destination local edit')
  for (const ref of beforeRefs.split('\n'))
    expect(
      await git(main, ['for-each-ref', '--format=%(refname):%(objectname)', 'refs/heads/']),
    ).toContain(ref)
  const task = target.services.store.get().tasks[0]!
  expect(task).toMatchObject({
    repositoryId: destination.id,
    execution: 'worktree',
    existingWorktreePath: copiedPath,
  })
  expect(task.checkoutBranch).toMatch(/^dovo\/copy-/)
  const choices = await runClientEffect(worktreeChoicesEffect(target.services, destination.id))
  expect(choices.worktrees.some((entry) => entry.path === copiedPath)).toBe(true)
  const listed = await runClientEffect(listWorktreesEffect(target.services))
  expect(listed.worktrees.find((entry) => entry.path === copiedPath)).toMatchObject({
    repositoryId: destination.id,
    threadIds: [task.id],
  })
  const checkouts = new TaskCheckout(target.services.store, target.services.git)
  expect(await checkouts.directory(task.id)).toBe(copiedPath)
  expect((await source.post('retry', { id: input.id })).status).toBe(200)
  expect(target.services.store.get().repositories).toHaveLength(1)
  expect(target.services.store.get().tasks).toHaveLength(1)
})

it('requires a project location and linked-worktree support before sending worktree files', async () => {
  const { root, source, target, path, input } = await setup(true)
  const feature = join(root, 'feature')
  await exec('git', ['worktree', 'add', '-b', 'feature', feature], { cwd: path })
  input.worktreePath = feature
  const begin = vi.spyOn(target.services.projectTransfers, 'begin')
  await source.post('start', input)
  await waitForRuntime(() =>
    expect(source.services.projectTransfers.list()[0]?.state).toBe('failed'),
  )
  expect(source.services.projectTransfers.list()[0]?.error).toContain('parent folder')
  expect(begin).not.toHaveBeenCalled()
  const original = target.services.projectTransfers.status.bind(target.services.projectTransfers)
  vi.spyOn(target.services.projectTransfers, 'status').mockImplementation((...args) => ({
    ...original(...args),
    linkedWorktreesSupported: false,
  }))
  input.id = randomUUID()
  input.destination = { parentDirectory: root }
  await source.post('start', input)
  await waitForRuntime(() =>
    expect(source.services.projectTransfers.list().find((job) => job.id === input.id)?.state).toBe(
      'failed',
    ),
  )
  expect(
    source.services.projectTransfers.list().find((job) => job.id === input.id)?.error,
  ).toContain('Update the destination')
  expect(begin).not.toHaveBeenCalled()
})

it.each([true, false])(
  'cleans a failed linked checkout (existing project: %s) and retries safely',
  async (existingProject) => {
    const { root, source, target, path, input, result } = await setup(true)
    const main = join(root, 'destination')
    const projects = join(root, 'projects')
    await mkdir(projects)
    let destinationId: string | undefined
    if (existingProject) {
      await exec('git', ['clone', path, main])
      const destination = await addRepository(target.services, {
        source: 'local',
        path: main,
        name: 'Existing',
      })
      destinationId = destination.id
      // The original project is local-only; remove clone's filesystem origin as well.
      await exec('git', ['remote', 'remove', 'origin'], { cwd: main })
    }
    const feature = join(root, 'feature')
    await exec('git', ['worktree', 'add', '-b', 'feature', feature], { cwd: path })
    input.worktreePath = feature
    input.destination = destinationId
      ? { repositoryId: destinationId }
      : { parentDirectory: projects }
    input.thread = { title: 'Transferred', prompt: '' }
    const create = vi.spyOn(target.services.tasks, 'create').mockImplementationOnce(() => {
      throw new Error('Unable to save thread')
    })
    let cleanupStarted = false
    let releaseCleanup!: () => void
    const cleanupBarrier = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const remove = vi.mocked(rm).getMockImplementation()
    if (!remove) throw new Error('Missing file cleanup implementation')
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (typeof path === 'string' && path.endsWith(`/out-${input.id}`)) {
        cleanupStarted = true
        await cleanupBarrier
      }
      return remove(path, options)
    })
    try {
      expect((await source.post('start', input)).status).toBe(200)
      await waitForRuntime(() => expect(cleanupStarted).toBe(true))
      expect(source.services.projectTransfers.list()[0]?.state).toBe('registering')
    } finally {
      releaseCleanup()
      vi.mocked(rm).mockReset()
    }
    await waitForRuntime(() =>
      expect(source.services.projectTransfers.list()[0]?.state).toBe('failed'),
    )
    expect(source.services.projectTransfers.list()[0]?.error).toContain('Unable to save thread')
    const remainingWorktrees = existingProject
      ? (await exec('git', ['worktree', 'list', '--porcelain'], { cwd: main })).stdout
          .trim()
          .split('\n\n')
      : []
    expect(remainingWorktrees).toHaveLength(existingProject ? 1 : 0)
    expect(target.services.store.get().repositories).toHaveLength(existingProject ? 1 : 0)
    expect(await readdir(projects)).toEqual([])
    expect(target.services.store.get().tasks).toHaveLength(0)
    create.mockRestore()
    expect((await source.post('retry', { id: input.id })).status).toBe(200)
    await result()
    expect(target.services.store.get().repositories).toHaveLength(1)
    expect(target.services.store.get().tasks).toHaveLength(1)
  },
)

it('copies detached worktrees and creates the main checkout from its separate detached HEAD', async () => {
  const { root, source, target, path, input, result } = await setup(true)
  const feature = join(root, 'detached-feature')
  await exec('git', ['worktree', 'add', '--detach', feature], { cwd: path })
  await writeFile(join(path, 'primary-only'), 'New primary commit')
  await exec('git', ['add', '.'], { cwd: path })
  await exec('git', ['commit', '-qm', 'Primary changes'], { cwd: path })
  await exec('git', ['checkout', '--detach'], { cwd: path })
  await exec('git', ['branch', '-D', 'main'], { cwd: path })
  input.worktreePath = feature
  input.destination = { parentDirectory: root }
  input.thread = { title: 'Detached checkout', prompt: '' }
  await source.post('start', input)
  const primary = await result()
  const copiedPath = source.services.projectTransfers.list()[0]!.path!
  expect(await readFile(join(primary.path, 'primary-only'), 'utf8')).toBe('New primary commit')
  expect(await readdir(copiedPath)).not.toContain('primary-only')
  expect((await exec('git', ['branch', '--show-current'], { cwd: copiedPath })).stdout.trim()).toBe(
    '',
  )
  expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: primary.path })).stdout).toBe(
    (await exec('git', ['rev-parse', 'HEAD'], { cwd: path })).stdout,
  )
  const task = target.services.store.get().tasks[0]!
  const checkouts = new TaskCheckout(target.services.store, target.services.git)
  expect(await checkouts.directory(task.id)).toBe(copiedPath)
})

it('keeps a completed linked checkout and its thread after the destination restarts', async () => {
  const { root, source, target, path, input, result } = await setup(true, true)
  const feature = join(root, 'feature')
  await exec('git', ['worktree', 'add', '-b', 'feature', feature], { cwd: path })
  input.worktreePath = feature
  input.destination = { parentDirectory: root }
  input.thread = { title: 'Continue after restart', prompt: '' }
  await source.post('start', input)
  const primary = await result()
  const receipt = target.services.projectTransfers.status(input.id, 'owner')
  await target.close()
  const restarted = await host(join(root, 'target.sqlite'))
  expect(restarted.services.projectTransfers.status(input.id, 'owner')).toEqual(receipt)
  expect(await (await restarted.post('commit', { id: input.id })).json()).toEqual(receipt.result)
  const task = restarted.services.store.get().tasks[0]!
  expect(
    await new TaskCheckout(restarted.services.store, restarted.services.git).directory(task.id),
  ).toBe(receipt.result!.path)
  const listed = await runClientEffect(listWorktreesEffect(restarted.services))
  expect(listed.worktrees.find((entry) => entry.path === receipt.result!.path)).toMatchObject({
    repositoryId: primary.id,
    threadIds: [task.id],
  })
})

it('cleans only the interrupted worktree on restart, including custom worktree locations', async () => {
  const { root, target, path } = await setup(true, true)
  const main = join(root, 'existing-project')
  await exec('git', ['clone', path, main])
  await addRepository(target.services, { source: 'local', path: main, name: 'Existing' })
  const worktrees = join(root, 'custom-root')
  await mkdir(worktrees)
  const abandoned = await mkdtemp(join(worktrees, 'copy-'))
  const keep = join(worktrees, 'keep')
  await exec('git', ['worktree', 'add', '-b', 'abandoned', abandoned], { cwd: main })
  await exec('git', ['worktree', 'add', '-b', 'keep', keep], { cwd: main })
  await writeFile(join(main, 'readme.txt'), 'Keep main changes')
  const id = randomUUID()
  target.services.db.prepare('INSERT INTO project_transfer_receipts VALUES (?,?)').run(
    id,
    JSON.stringify({
      id,
      device: 'owner',
      worktree: { path: abandoned, repositoryPath: main, branch: 'abandoned' },
    }),
  )
  await target.close()
  const restarted = await host(join(root, 'target.sqlite'))
  const beginId = randomUUID()
  expect(
    (
      await restarted.post('begin', {
        id: beginId,
        runtimeId: restarted.services.runtimeId,
        name: 'Ready check',
        entries: [],
      })
    ).status,
  ).toBe(200)
  await restarted.post('discard', { id: beginId })
  expect(await readdir(worktrees)).toEqual(['keep'])
  expect(await readFile(join(main, 'readme.txt'), 'utf8')).toBe('Keep main changes')
  const branches = (await exec('git', ['branch', '--format=%(refname)'], { cwd: main })).stdout
  expect(branches).not.toContain('abandoned')
  expect(branches).toContain('keep')
  await restarted.close()
  const again = await host(join(root, 'target.sqlite'))
  const nextId = randomUUID()
  expect(
    (
      await again.post('begin', {
        id: nextId,
        runtimeId: again.services.runtimeId,
        name: 'Ready again',
        entries: [],
      })
    ).status,
  ).toBe(200)
  await again.post('discard', { id: nextId })
  expect(await readdir(worktrees)).toEqual(['keep'])
})
it('accepts more than 100,000 files through the authenticated transfer route and still bounds metadata', async () => {
  const { target } = await setup()
  const entries = Array.from({ length: 100001 }, (_, index) => ({
    path: `src/component-${index}.txt`,
    kind: 'file' as const,
    bytes: 0,
    sha256: createHash('sha256').update('').digest('hex'),
    mode: 0o644,
  }))
  const manifest = {
    id: randomUUID(),
    runtimeId: target.services.runtimeId,
    name: 'Large project',
    entries,
  }
  expect(Buffer.byteLength(JSON.stringify(manifest))).toBeGreaterThan(8 * 1024 * 1024)
  const response = await target.post('begin', manifest)
  expect(response.status).toBe(200)
  expect((await target.post('discard', { id: manifest.id })).status).toBe(200)
  expect(
    (
      await target.post('begin', {
        ...manifest,
        id: randomUUID(),
        entries: Array(260003).fill(entries[0]),
      })
    ).status,
  ).toBe(400)
})
