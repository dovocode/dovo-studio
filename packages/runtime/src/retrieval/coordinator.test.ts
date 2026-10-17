import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, type RuntimeIcon } from '@dovo/protocol'
import { openDatabase } from '../storage/database.js'
import { SharedRetrieval, type RetrievalTransport } from './coordinator.js'
import { retrievalFresh } from './context.js'
import { validateRead, githubRead, jiraRead, type RetrievalRequest } from './request.js'

const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
const request: RetrievalRequest = {
  provider: 'github',
  instance: 'github.com',
  reader: 'a'.repeat(64),
  args: ['api', 'repos/example/project/pulls'],
}
function fleet() {
  let now = 1000
  const nodes = new Map<string, { coordinator: SharedRetrieval; role: RuntimeIcon }>()
  const upstream = vi.fn<() => Promise<string>>(async () => 'upstream')
  const send: RetrievalTransport = async (peer, path, input, schema) => {
    const node = nodes.get(peer.id)
    if (!node) throw new Error('offline')
    return decode(
      schema,
      path.endsWith('/host')
        ? node.coordinator.status()
        : path.endsWith('/invalidate')
          ? (node.coordinator.forget(request.provider, request.instance, request.reader),
            { ok: true })
          : await node.coordinator.serve(validateRead(input), upstream),
    )
  }
  const add = (
    id: string,
    role: RuntimeIcon,
    settings: { enabled?: boolean; preferredHost?: string } = {},
  ) => {
    const db = openDatabase(':memory:')
    databases.push(db)
    const coordinator = new SharedRetrieval(
      db,
      () => ({ id, role, ...settings }),
      () =>
        [...nodes.keys()]
          .filter((key) => key !== id)
          .map((key) => ({
            id: key,
            name: key,
            connection: { address: 'http://' + key, token: 'paired' },
          })),
      send,
      () => now,
    )
    nodes.set(id, { coordinator, role })
    return coordinator
  }
  return {
    add,
    nodes,
    upstream,
    advance: (ms: number) => {
      now += ms
    },
  }
}
it('prefers servers over desktops and laptops, sharing concurrent requests and cached results', async () => {
  const f = fleet()
  const server = f.add('server', 'server')
  const desktop = f.add('desktop', 'desktop')
  const laptop = f.add('laptop', 'laptop')
  const local = vi.fn<() => Promise<string>>(async () => 'local')
  expect(await Promise.all([laptop.read(request, local), desktop.read(request, local)])).toEqual([
    'upstream',
    'upstream',
  ])
  expect(f.upstream).toHaveBeenCalledTimes(1)
  expect(local).not.toHaveBeenCalled()
  expect(server.status().local).toBe(1)
  await laptop.read(request, local)
  expect(f.upstream).toHaveBeenCalledTimes(1)
})
it('falls back to a desktop and then local operation when preferred hosts disconnect', async () => {
  const f = fleet()
  f.add('server', 'server')
  f.add('desktop', 'desktop')
  const laptop = f.add('laptop', 'laptop')
  const local = vi.fn<() => Promise<string>>(async () => 'local')
  await laptop.read(request, local)
  f.nodes.delete('server')
  f.advance(16000)
  expect(await laptop.read(request, local)).toBe('upstream')
  f.nodes.delete('desktop')
  f.advance(16000)
  expect(await laptop.read(request, local)).toBe('local')
})
it('uses deterministic tie breaking and returns work to a restored server', async () => {
  const f = fleet()
  f.add('a', 'desktop')
  const desktop = f.add('z', 'desktop')
  const local = vi.fn<() => Promise<string>>(async () => 'local')
  await desktop.read(request, local)
  expect(local).not.toHaveBeenCalled()
  const server = f.add('server', 'server')
  f.advance(16000)
  await desktop.read(request, local)
  expect(server.status().local).toBe(1)
})
it('separates provider instances, accounts, projects and arguments', async () => {
  const f = fleet()
  const local = f.add('local', 'server')
  const load = vi.fn<() => Promise<string>>(async () => 'value')
  for (const input of [
    request,
    { ...request, reader: 'b'.repeat(64) },
    { ...request, args: ['api', 'repos/other/project/pulls'] },
    {
      ...request,
      instance: 'enterprise.example',
      args: ['api', '--hostname', 'enterprise.example', 'repos/example/project/pulls'],
    },
    {
      provider: 'jira' as const,
      instance: 'https://example.atlassian.net',
      reader: request.reader,
      project: 'TEAM',
      args: ['jira', 'workitem', 'view', 'TEAM-1', '--json'],
    },
  ])
    await local.read(input, load)
  expect(load).toHaveBeenCalledTimes(5)
})
it('honors fresh reads and broadcasts invalidation after writes', async () => {
  const f = fleet()
  f.add('server', 'server')
  const laptop = f.add('laptop', 'laptop')
  const local = vi.fn<() => Promise<string>>(async () => 'local')
  await laptop.read(request, local)
  await retrievalFresh(true, () => laptop.read(request, local))
  expect(f.upstream).toHaveBeenCalledTimes(2)
  await laptop.invalidate(request.provider, request.instance, request.reader)
  await laptop.read(request, local)
  expect(f.upstream).toHaveBeenCalledTimes(3)
})
it('does not persist failed or invalidated in-flight reads', async () => {
  const f = fleet()
  const local = f.add('local', 'server')
  await expect(
    local.serve(request, async () => {
      throw new Error('upstream failed')
    }),
  ).rejects.toThrow('upstream failed')
  let finish: (value: string) => void = () => {}
  const pending = local.serve(
    request,
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  await Promise.resolve()
  local.forget(request.provider, request.instance, request.reader)
  finish('old')
  await pending
  const load = vi.fn<() => Promise<string>>(async () => 'new')
  expect((await local.serve(request, load)).value).toBe('new')
  expect(load).toHaveBeenCalledTimes(1)
})
it('never treats GitHub mutations or Jira writes as shared reads', () => {
  expect(githubRead(['api', 'graphql', '-f', 'query=query { viewer { login } }'])).toBe(true)
  expect(
    githubRead([
      'api',
      'graphql',
      '-f',
      'query=query { viewer { login } } mutation { deleteIssue(input:{id:"x"}) { clientMutationId } }',
    ]),
  ).toBe(false)
  expect(githubRead(['api', 'repos/a/b/issues', '--method', 'POST'])).toBe(false)
  expect(jiraRead(['jira', 'workitem', 'comment', 'create', '--key', 'TEAM-1'])).toBe(false)
  expect(
    jiraRead(['jira', 'workitem', 'search', '--jql', 'project = TEAM', '--limit', '31', '--json']),
  ).toBe(true)
  expect(jiraRead(['jira', 'workitem', 'search', '--output', '/tmp/file'])).toBe(false)
  expect(() =>
    validateRead({ ...request, args: ['api', 'https://other.example/private'] }),
  ).toThrow(/relative GitHub API endpoint/)
})

it('refreshes watch subscriptions on the executor and stops when interest expires', async () => {
  const f = fleet()
  const server = f.add('server', 'server')
  const laptop = f.add('laptop', 'laptop')
  server.start(f.upstream)
  try {
    await laptop.read({ ...request, watch: true }, async () => 'local')
    expect(server.status().watches).toBe(1)
    expect(laptop.status().watches).toBe(0)
    f.advance(30000)
    await server.tick()
    expect(f.upstream).toHaveBeenCalledTimes(2)
    f.advance(180001)
    await server.tick()
    expect(server.status().watches).toBe(0)
    expect(f.upstream).toHaveBeenCalledTimes(2)
  } finally {
    await server.stop()
  }
})
it('hands an active desktop subscription to a returning preferred server', async () => {
  const f = fleet()
  const desktop = f.add('desktop', 'desktop')
  const laptop = f.add('laptop', 'laptop')
  desktop.start(f.upstream)
  try {
    await laptop.read({ ...request, watch: true }, async () => 'local')
    expect(desktop.status().watches).toBe(1)
    const server = f.add('server', 'server')
    f.advance(16000)
    await desktop.tick()
    expect(desktop.status().watches).toBe(0)
    expect(server.status().watches).toBe(1)
  } finally {
    await desktop.stop()
  }
})

it('honors an explicit preferred host and disables sharing per computer', async () => {
  const f = fleet()
  f.add('server', 'server')
  const preferred = f.add('preferred', 'desktop')
  const laptop = f.add('laptop', 'laptop', { preferredHost: 'preferred' })
  const load = vi.fn<() => Promise<string>>(async () => 'local')
  await laptop.read(request, load)
  expect(preferred.status().local).toBe(1)
  const disabled = f.add('disabled', 'laptop', { enabled: false })
  expect(await disabled.read(request, load)).toBe('local')
  expect(disabled.active()).toBe(false)
})
it('reuses immutable commit content while refreshing mutable PR data', async () => {
  const f = fleet()
  const local = f.add('local', 'server')
  const load = vi.fn<() => Promise<string>>(async () => 'content')
  const commit = { ...request, args: ['api', 'repos/team/app/commits/' + 'a'.repeat(40)] }
  await local.read(commit, load)
  await local.read(request, load)
  f.advance(16000)
  await local.read(commit, load)
  await local.read(request, load)
  expect(load).toHaveBeenCalledTimes(3)
})
