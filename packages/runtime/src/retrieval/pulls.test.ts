import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { decode, RuntimeRequestError } from '@dovo/protocol'
import { openDatabase } from '../storage/database.js'
import { SharedRetrieval, type RetrievalTransport } from './coordinator.js'
import { pullPeerRequestSchema, type PullPeerScope, type PullOperation } from './pulls.js'
import { retrievalFresh } from './context.js'

const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
const scope: PullPeerScope = {
  provider: 'github',
  instance: 'https://github.com',
  repository: 'team/app',
  readerIdentity: 'verified-work-account',
}
const list: PullOperation = { kind: 'list', state: 'open', page: 1, background: false }
const action: PullOperation = {
  kind: 'act',
  input: { action: 'close', number: 7, headSha: 'a'.repeat(40) },
}
function fleet() {
  let now = 1000
  let loseWriteResponse = false
  const nodes = new Map<string, SharedRetrieval>()
  const upstream = vi.fn<() => Promise<string>>(async () => 'server')
  const send: RetrievalTransport = async (peer, path, input, schema) => {
    const node = nodes.get(peer.id)
    if (!node) throw new RuntimeRequestError({ kind: 'request', message: 'offline' })
    if (path.endsWith('/host')) return decode(schema, node.status())
    const request = decode(pullPeerRequestSchema, input)
    const value = await node.servePull(
      request.scope,
      request.operation,
      Schema.String,
      upstream,
      request.fresh,
    )
    if (loseWriteResponse && request.operation.kind === 'act')
      throw new RuntimeRequestError({ kind: 'request', message: 'Lost response after execution' })
    return decode(schema, { host: peer.id, value })
  }
  const add = (
    id: string,
    role: 'server' | 'desktop' | 'laptop',
    settings: { preferredHost?: string } = {},
  ) => {
    const db = openDatabase(':memory:')
    databases.push(db)
    const peers = () =>
      ['server', 'other', 'laptop']
        .filter((key) => key !== id)
        .map((key) => ({
          id: key,
          name: key,
          connection: { address: 'http://' + key, token: 'paired', runtimeId: key },
        }))
    const create = () =>
      new SharedRetrieval(
        db,
        () => ({ id, role, ...settings }),
        peers,
        send,
        () => now,
      )
    const node = create()
    nodes.set(id, node)
    return {
      node,
      settings,
      db,
      restart: () => {
        const restored = create()
        nodes.set(id, restored)
        return restored
      },
    }
  }
  return {
    add,
    nodes,
    upstream,
    loseWriteResponse: () => {
      loseWriteResponse = true
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}
it('keeps all repositories, details and writes on the preferred peer and shares its cache', async () => {
  const f = fleet()
  f.add('server', 'server')
  f.add('other', 'desktop')
  const { node } = f.add('laptop', 'laptop', { preferredHost: 'server' })
  const local = vi.fn<() => Promise<string>>(async () => 'local')
  expect(
    await Promise.all([
      node.pull(scope, list, Schema.String, local),
      node.pull(scope, list, Schema.String, local),
    ]),
  ).toEqual(['server', 'server'])
  expect(f.upstream).toHaveBeenCalledTimes(1)
  await node.pull(
    { ...scope, repository: 'team/second' },
    { kind: 'detail', number: 7 },
    Schema.String,
    local,
  )
  await node.pull(scope, action, Schema.String, local)
  await node.pull(scope, list, Schema.String, local)
  expect(f.upstream).toHaveBeenCalledTimes(4)
  expect(local).not.toHaveBeenCalled()
})
it('uses the selected machine by default even when a paired server is available', async () => {
  const f = fleet()
  f.add('server', 'server')
  const laptop = f.add('laptop', 'laptop')
  laptop.db
    .prepare('INSERT INTO pull_owners VALUES(?,?)')
    .run(JSON.stringify([scope.provider, scope.instance, scope.readerIdentity]), 'server')
  const local = vi.fn<() => Promise<string>>(async () => 'local')
  expect(await laptop.node.pull(scope, list, Schema.String, local)).toBe('local')
  expect(await laptop.node.pull(scope, action, Schema.String, local)).toBe('local')
  expect(f.upstream).not.toHaveBeenCalled()
})
it('retains an explicitly preferred owner through outages and restarts, without replaying elsewhere', async () => {
  const f = fleet()
  f.add('server', 'server')
  const laptop = f.add('laptop', 'laptop', { preferredHost: 'server' })
  const local = vi.fn<() => Promise<string>>(async () => 'local')
  await laptop.node.pull(scope, list, Schema.String, local)
  f.nodes.delete('server')
  f.add('other', 'desktop')
  f.advance(16000)
  const restored = laptop.restart()
  await expect(restored.pull(scope, list, Schema.String, local)).rejects.toMatchObject({
    status: 503,
  })
  await expect(restored.pull(scope, action, Schema.String, local)).rejects.toThrow(
    'may already have completed',
  )
  expect(local).not.toHaveBeenCalled()
  expect(f.upstream).toHaveBeenCalledTimes(1)
  f.add('server', 'server')
  f.advance(16000)
  expect(await restored.pull(scope, list, Schema.String, local)).toBe('server')
})
it('returns to the selected machine when an explicit preference is cleared, including after restart', async () => {
  const f = fleet()
  f.add('server', 'server')
  const laptop = f.add('laptop', 'laptop', { preferredHost: 'server' })
  const local = vi.fn<() => Promise<string>>(async () => 'local')
  await laptop.node.pull(scope, list, Schema.String, local)
  laptop.settings.preferredHost = ''
  f.advance(16000)
  expect(await laptop.restart().pull(scope, list, Schema.String, local)).toBe('local')
})
it('isolates accounts, repositories and pages and bypasses its cache on explicit refresh', async () => {
  const f = fleet()
  const { node } = f.add('server', 'server')
  const load = vi.fn<() => Promise<string>>(async () => 'value')
  await node.pull(scope, list, Schema.String, load)
  await node.pull(scope, list, Schema.String, load)
  await node.pull({ ...scope, readerIdentity: 'personal' }, list, Schema.String, load)
  await node.pull({ ...scope, repository: 'team/other' }, list, Schema.String, load)
  await node.pull(scope, { ...list, page: 2 }, Schema.String, load)
  await retrievalFresh(true, () => node.pull(scope, list, Schema.String, load))
  expect(load).toHaveBeenCalledTimes(5)
})
it('never persists failed reads or allows a late read to restore data invalidated by a write', async () => {
  const f = fleet()
  const { node } = f.add('server', 'server')
  await expect(
    node.pull(scope, list, Schema.String, async () => {
      throw Error('failed')
    }),
  ).rejects.toThrow('failed')
  let started = false
  let finish: (value: string) => void = () => {}
  const pending = node.pull(
    scope,
    list,
    Schema.String,
    () =>
      new Promise<string>((resolve) => {
        started = true
        finish = resolve
      }),
  )
  await vi.waitFor(() => expect(started).toBe(true))
  await node.pull(scope, action, Schema.String, async () => 'written')
  finish('old')
  await pending
  expect(await node.pull(scope, list, Schema.String, async () => 'new')).toBe('new')
})

it('does not retry an action on the owner or another computer when the response is lost after execution', async () => {
  const f = fleet()
  f.add('server', 'server')
  f.add('other', 'desktop')
  const { node } = f.add('laptop', 'laptop', { preferredHost: 'server' })
  const local = vi.fn<() => Promise<string>>(async () => 'local')
  f.loseWriteResponse()
  await expect(node.pull(scope, action, Schema.String, local)).rejects.toThrow(
    'may already have completed',
  )
  expect(f.upstream).toHaveBeenCalledTimes(1)
  expect(local).not.toHaveBeenCalled()
})
