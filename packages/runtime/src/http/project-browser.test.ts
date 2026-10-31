import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, rm, writeFile, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IncomingMessage } from 'node:http'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'

vi.setConfig(runtimeIntegration)
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function setup() {
  const f = await fixture()
  cleanup.push(f.cleanup)
  const token = 'project-browser-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Browse',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const post = (operation: string, input: Record<string, unknown> = {}, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/files/${operation}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, ...input }),
    })
  return { ...f, runtime, task, post, token }
}

it('authenticates browsing and content search, validates paths, and does not prepare a checkout', async () => {
  const s = await setup()
  await mkdir(join(s.directory, 'src'))
  await writeFile(join(s.directory, 'src', 'code.ts'), 'first\nconst needle = 1\n')
  const prepare = vi
    .spyOn(s.runtime.services.checkouts, 'directory')
    .mockRejectedValue(new Error('Read must not prepare checkout'))
  s.runtime.services.store.updateTask(s.task.id, (task) => ({ ...task, execution: 'worktree' }))
  const addWorktree = vi
    .spyOn(s.runtime.services.git, 'addWorktree')
    .mockRejectedValue(new Error('Browsing must not create the pending worktree'))
  expect((await s.post('directory', {}, 'wrong')).status).toBe(401)
  const root = await s.post('directory')
  expect(root.status).toBe(200)
  expect(await root.json()).toMatchObject({
    entries: expect.arrayContaining([{ path: 'src', kind: 'directory' }]),
    truncated: false,
  })
  expect((await s.post('directory', { directory: '..' })).status).toBe(400)
  expect((await s.post('directory', { directory: '.git' })).status).toBe(400)
  expect((await s.post('search-content', { query: '' })).status).toBe(400)
  const search = await s.post('search-content', { query: 'needle' })
  expect(search.status).toBe(200)
  expect(await search.json()).toMatchObject({
    matches: [{ path: 'src/code.ts', line: 2, excerpt: 'const needle = 1' }],
    truncated: false,
  })
  expect(prepare).not.toHaveBeenCalled()
  expect(addWorktree).not.toHaveBeenCalled()
})

it('keeps linked checkout search separate and retains read-only write protection', async () => {
  const s = await setup()
  const directory = await mkdtemp(join(tmpdir(), 'dovo-browser-linked-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'linked.ts'), 'linked needle\n')
  await writeFile(join(s.directory, 'primary.ts'), 'primary needle\n')
  s.runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [
      ...workspace.repositories,
      { id: 'linked', name: 'Linked', path: directory, branch: '', kind: 'folder' },
    ],
  }))
  s.runtime.services.store.updateTask(s.task.id, (task) => ({
    ...task,
    linkedCheckouts: [
      { id: 'link', repositoryId: 'linked', execution: 'main', access: 'read-only' },
    ],
  }))
  const primary = await s.post('search-content', { query: 'needle' })
  expect(await primary.json()).toMatchObject({ matches: [{ path: 'primary.ts' }] })
  const linked = await s.post('search-content', { query: 'needle', checkoutId: 'link' })
  expect(linked.status).toBe(200)
  expect(await linked.json()).toMatchObject({ matches: [{ path: 'linked.ts' }] })
  expect((await s.post('directory', { checkoutId: 'unknown' })).status).toBe(404)
  expect(
    (
      await s.post('write', {
        checkoutId: 'link',
        path: 'linked.ts',
        expectedContents: 'linked needle\n',
        contents: 'changed',
      })
    ).status,
  ).toBe(403)
})

it('interrupts content scanning when the client cancels its request', async () => {
  const s = await setup()
  let startedResolve!: (signal: AbortSignal) => void
  const started = new Promise<AbortSignal>((resolve) => {
    startedResolve = resolve
  })
  let interruptedResolve!: () => void
  const interrupted = new Promise<void>((resolve) => {
    interruptedResolve = resolve
  })
  vi.spyOn(s.runtime.services.projectFiles, 'contentSearch').mockImplementation(
    (_cwd, _query, _plain, signal) => {
      if (!signal) throw new Error('Search must receive the request cancellation signal')
      startedResolve(signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            interruptedResolve()
            reject(signal.reason)
          },
          { once: true },
        )
      })
    },
  )
  const controller = new AbortController()
  const response = fetch(`http://127.0.0.1:${s.runtime.port}/api/tasks/files/search-content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: s.task.id, query: 'needle' }),
    signal: controller.signal,
  }).then(
    (response) => ({ response }),
    (error: unknown) => ({ error }),
  )
  const signal = await started
  controller.abort()
  await interrupted
  expect(signal.aborted).toBe(true)
  expect(await response).toMatchObject({ error: { name: 'AbortError' } })
})

it('removes request and socket cancellation listeners after a failed directory read', async () => {
  const s = await setup()
  const once = vi.spyOn(IncomingMessage.prototype, 'once')
  expect((await s.post('directory', { directory: '..' })).status).toBe(400)
  const index = once.mock.calls.findIndex(([event]) => event === 'aborted')
  expect(index).toBeGreaterThanOrEqual(0)
  const request = once.mock.contexts[index]
  if (!(request instanceof IncomingMessage)) throw new Error('No search request was observed')
  const listener = once.mock.calls[index][1]
  expect(request.listeners('aborted')).not.toContain(listener)
  expect(request.socket.listeners('close')).not.toContain(listener)
})

it('opens and edits contained file and folder aliases over authenticated HTTP while denying escapes', async () => {
  const s = await setup()
  await mkdir(join(s.directory, 'src'))
  await writeFile(join(s.directory, 'src', 'code.ts'), 'original')
  await symlink('src', join(s.directory, 'alias'))
  await symlink('src/code.ts', join(s.directory, 'linked.ts'))
  await symlink('..', join(s.directory, 'external'))
  expect((await s.post('directory', { directory: 'alias' })).status).toBe(200)
  for (const path of ['alias/code.ts', 'linked.ts']) {
    const read = await s.post('read', { path })
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ path, contents: 'original' })
  }
  const write = await s.post('write', {
    path: 'linked.ts',
    expectedContents: 'original',
    contents: 'edited',
  })
  expect(write.status).toBe(200)
  expect(await readFile(join(s.directory, 'src', 'code.ts'), 'utf8')).toBe('edited')
  expect((await s.post('read', { path: 'external/private.txt' })).status).toBe(400)
  expect(
    (
      await s.post('write', {
        path: 'external/private.txt',
        expectedContents: '',
        contents: 'denied',
      })
    ).status,
  ).toBe(400)
})
