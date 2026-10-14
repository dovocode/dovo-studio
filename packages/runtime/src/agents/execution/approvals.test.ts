import { afterEach, expect, it } from 'vite-plus/test'
import { openDatabase } from '../../storage/database.js'
import { WorkspaceStore } from '../../storage/workspace.js'
import { RuntimePreferences } from '../../storage/runtime-preferences.js'
import { Approvals } from './approvals.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture() {
  const db = openDatabase(':memory:')
  cleanups.push(() => db.close())
  const store = new WorkspaceStore(db)
  store.update((workspace) => ({
    ...workspace,
    repositories: ['one', 'two'].map((id) => ({
      id,
      name: id,
      path: `/tmp/${id}`,
      branch: 'main',
    })),
    tasks: ['one', 'other-thread', 'two', 'no-project'].map((id) => ({
      id,
      repositoryId: id === 'no-project' ? '' : id === 'other-thread' ? 'one' : id,
      title: id,
      agentId: '',
      status: 'running' as const,
      createdAt: new Date().toISOString(),
      messages: [],
      files: [],
      draft: '',
      example: false,
    })),
  }))
  const preferences = new RuntimePreferences(db)
  const approvals = new Approvals(undefined, store, preferences)
  cleanups.push(() => approvals.dispose())
  const request = (title: string, detail = '{}', taskId = 'one') =>
    approvals.request(taskId, title, detail, new AbortController().signal)
  const webRequest = (title: string, detail = '{}', taskId = 'one') =>
    approvals.request(taskId, title, detail, new AbortController().signal, 'web')
  return { db, store, approvals, request, webRequest, preferences }
}

it('applies the computer-wide rule across projects and projectless threads and persists it', async () => {
  const { db, store, approvals, request, webRequest, preferences } = fixture()
  expect(preferences.get().allowWebRequests).toBe(false)
  const pending = ['one', 'two', 'no-project'].map((taskId) =>
    webRequest('WebSearch', '{}', taskId),
  )
  const shell = request('Run command', '{"command":"curl https://example.com"}')
  const files = request('Apply file changes')
  preferences.save({ allowWebRequests: true })
  approvals.applyWebRules()
  await expect(Promise.all(pending)).resolves.toEqual(['approve', 'approve', 'approve'])
  expect(approvals.list().map((item) => item.title)).toEqual(['Run command', 'Apply file changes'])
  const reopened = new Approvals(undefined, new WorkspaceStore(db), new RuntimePreferences(db))
  cleanups.push(() => reopened.dispose())
  for (const taskId of ['one', 'two', 'no-project'])
    await expect(
      reopened.request(taskId, 'WebFetch', '{}', new AbortController().signal, 'web'),
    ).resolves.toBe('approve')
  expect(store.get().repositories.every((project) => !project.approvedWebRequests)).toBe(true)
  approvals.dispose()
  await expect(shell).resolves.toBe('deny')
  await expect(files).resolves.toBe('deny')
})

it('turning off the computer-wide flag restores project rules without changing them', async () => {
  const { store, approvals, webRequest, preferences } = fixture()
  store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((project) => ({
      ...project,
      approvedWebRequests: project.id === 'one',
    })),
  }))
  preferences.save({ allowWebRequests: true })
  await expect(webRequest('WebFetch', '{}', 'two')).resolves.toBe('approve')
  preferences.save({ allowWebRequests: false })
  await expect(webRequest('WebSearch')).resolves.toBe('approve')
  const second = webRequest('WebSearch', '{}', 'two')
  const projectless = webRequest('WebSearch', '{}', 'no-project')
  approvals.applyWebRules()
  expect(approvals.list()).toHaveLength(2)
  approvals.dispose()
  await expect(second).resolves.toBe('deny')
  await expect(projectless).resolves.toBe('deny')
})

it('remembers web browsing and search across threads and restarts, then respects revocation', async () => {
  const { db, store, approvals, webRequest } = fixture()
  const first = webRequest('WebFetch', JSON.stringify({ url: 'https://example.com' }))
  expect(approvals.list()[0].rememberRule).toBe('web')
  approvals.respond(approvals.list()[0].id, true, true)
  await expect(first).resolves.toBe('approve')
  expect(store.get().repositories[0].approvedWebRequests).toBe(true)
  expect(store.get().repositories[0].approvedCommands).toBeUndefined()
  const reopened = new Approvals(undefined, new WorkspaceStore(db))
  cleanups.push(() => reopened.dispose())
  await expect(
    reopened.request(
      'other-thread',
      'WebSearch',
      '{"query":"new search"}',
      new AbortController().signal,
      'web',
    ),
  ).resolves.toBe('approve')
  await expect(
    reopened.request(
      'one',
      'webfetch',
      'http://another-website.test',
      new AbortController().signal,
      'web',
    ),
  ).resolves.toBe('approve')
  expect(reopened.list()).toHaveLength(0)
  store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((project) => ({
      ...project,
      approvedWebRequests: false,
    })),
  }))
  const next = webRequest('WebSearch')
  expect(approvals.list()).toHaveLength(1)
  approvals.respond(approvals.list()[0].id, false)
  await expect(next).resolves.toBe('deny')
})

it('resolves concurrent web requests in the approved project without approving another project or commands', async () => {
  const { approvals, request, webRequest } = fixture()
  const first = webRequest('WebFetch')
  const parallel = webRequest('WebSearch', '{}', 'other-thread')
  const other = webRequest('WebFetch', '{}', 'two')
  const shell = request('Run command', '{"command":"curl https://example.com"}')
  const files = request('Apply file changes')
  approvals.respond(approvals.list()[0].id, true, true)
  await expect(first).resolves.toBe('approve')
  await expect(parallel).resolves.toBe('approve')
  expect(approvals.list().map((item) => item.title)).toEqual([
    'WebFetch',
    'Run command',
    'Apply file changes',
  ])
  approvals.dispose()
  await expect(other).resolves.toBe('deny')
  await expect(shell).resolves.toBe('deny')
  await expect(files).resolves.toBe('deny')
})

it.each([false, true])('allow once / deny (allow=%s) never save a web rule', async (allow) => {
  const { store, approvals, webRequest } = fixture()
  const pending = webRequest('WebSearch')
  approvals.respond(approvals.list()[0].id, allow, !allow)
  await expect(pending).resolves.toBe(allow ? 'approve' : 'deny')
  expect(store.get().repositories[0].approvedWebRequests).toBeUndefined()
})

it('does not offer a project rule when no project exists', async () => {
  const { approvals, webRequest } = fixture()
  const pending = webRequest('WebFetch', '{}', 'no-project')
  const id = approvals.list()[0].id
  expect(approvals.list()[0].rememberRule).toBeNull()
  expect(() => approvals.respond(id, true, true)).toThrow('cannot be saved as a project rule')
  approvals.respond(id, true)
  await expect(pending).resolves.toBe('approve')
})

it.each(['WebFetch', 'WebSearch', 'Copilot url request', 'Web request'])(
  'does not trust the display title %s as a web permission',
  async (title) => {
    const { store, approvals, request } = fixture()
    store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((project) => ({
        ...project,
        approvedWebRequests: true,
      })),
    }))
    const pending = request(title, '{"url":"https://example.com"}')
    const id = approvals.list()[0].id
    expect(approvals.list()[0].rememberRule).toBeNull()
    expect(() => approvals.respond(id, true, true)).toThrow('cannot be saved as a project rule')
    approvals.respond(id, false)
    await expect(pending).resolves.toBe('deny')
  },
)

it('resolves scoped decisions and rejects scopes the request never offered', async () => {
  const { approvals, request } = fixture()
  const pending = request('Run command', '{"command":"pnpm test"}')
  // No scopes were offered with this request.
  expect(() => approvals.decide(approvals.list()[0].id, 'session')).toThrow('session scope')
  approvals.decide(approvals.list()[0].id, 'approve')
  await expect(pending).resolves.toBe('approve')
})

it('passes a native always decision through without inventing a Dovo rule', async () => {
  const { store, approvals } = fixture()
  const pending = approvals.request(
    'one',
    'Apply file changes',
    'src/app.ts',
    new AbortController().signal,
    undefined,
    { session: true, always: true },
  )
  expect(approvals.list()[0].scopes).toEqual({ session: true, always: true })
  approvals.decide(approvals.list()[0].id, 'always')
  await expect(pending).resolves.toBe('always')
  expect(store.get().repositories[0].approvedCommands).toBeUndefined()
  const second = approvals.request(
    'one',
    'Apply file changes',
    'src/app.ts',
    new AbortController().signal,
    undefined,
    { session: true, always: true },
  )
  approvals.decide(approvals.list()[0].id, 'session')
  await expect(second).resolves.toBe('session')
})

it('expires a pending approval after the saved policy changes before a remembered rule can be written', async () => {
  const { store, approvals, request } = fixture()
  const { defaultTaskHarness } = await import('@dovo/protocol')
  store.updateTask('one', (task) => ({ ...task, harness: defaultTaskHarness('codex') }))
  const pending = request('Run command', '{"command":"rm fixture"}')
  const id = approvals.list()[0].id
  store.updateTask('one', (task) => ({ ...task, harness: { ...task.harness!, permission: 'ask' } }))
  expect(() => approvals.decide(id, 'always')).toThrow('Access changed')
  await expect(pending).resolves.toBe('deny')
  expect(store.get().repositories[0].approvedCommands).toBeUndefined()
  expect(approvals.list()).toEqual([])
})
