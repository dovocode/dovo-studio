import { describe, expect, it } from 'vite-plus/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { linuxListeningSockets, serverOwner, ThreadServers } from './thread-servers.js'

it('only accepts explicit provenance belonging to this runtime', () => {
  const servers = new ThreadServers('runtime')
  const env = servers.environment('thread', 'agent')
  const raw = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\0')
  expect(serverOwner(raw, 'runtime')).toEqual({ taskId: 'thread', source: 'agent' })
  expect(serverOwner(raw, 'another-runtime')).toBeNull()
  expect(serverOwner('DOVO_STUDIO_SERVER_THREAD=thread\0', 'runtime')).toBeNull()
  expect(serverOwner(raw.replace('=agent', '=unknown'), 'runtime')).toBeNull()
  expect(serverOwner(raw.replaceAll('\0', ' '), 'runtime', ' ')).toEqual({
    taskId: 'thread',
    source: 'agent',
  })
})

it('reads IPv4 and IPv6 TCP listeners without including established connections', () => {
  const sockets = linuxListeningSockets(`header
 0: 0100007F:0BB8 00000000:0000 0A 0:0 0:0 0 1000 0 123 1
 1: 00000000000000000000000000000000:1F90 0:0 0A 0:0 0:0 0 1000 0 456 1
 2: 0100007F:0BB8 0:0 01 0:0 0:0 0 1000 0 789 1`)
  expect([...sockets]).toEqual([
    ['123', { port: 3000, hosts: ['127.0.0.1'] }],
    ['456', { port: 8080, hosts: ['[::1]'] }],
  ])
})

describe.skipIf(process.platform !== 'linux')('real thread-owned servers', () => {
  it('does not advertise a wildcard endpoint shadowed by another reuse-port listener', async () => {
    const discovery = new ThreadServers(randomUUID())
    const children: ReturnType<typeof spawn>[] = []
    const start = async (host: string, port: number, marked: boolean) => {
      const child = spawn(
        process.execPath,
        [
          '-e',
          `const s=require('http').createServer((q,r)=>r.end('${host}'));s.listen({port:${port},host:'${host}',reusePort:true},()=>process.send(s.address().port));`,
        ],
        {
          env: { ...process.env, ...(marked ? discovery.environment('thread', 'agent') : {}) },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      )
      children.push(child)
      const [assigned] = await once(child, 'message')
      return Number(assigned)
    }
    try {
      const port = await start('0.0.0.0', 0, true)
      await start('127.0.0.1', port, false)
      expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('127.0.0.1')
      const result = await discovery.list('thread')
      expect(result.servers).toHaveLength(1)
      expect(result.servers[0]?.url).toBeUndefined()
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }, 10000)

  it('opens the owned loopback binding when an unrelated process uses the same port', async () => {
    const discovery = new ThreadServers(randomUUID())
    const children: ReturnType<typeof spawn>[] = []
    const start = async (host: string, port: number, marked: boolean) => {
      const child = spawn(
        process.execPath,
        [
          '-e',
          `const s=require('http').createServer((q,r)=>r.end('${host}'));s.listen(${port},'${host}',()=>process.send(s.address().port));`,
        ],
        {
          env: { ...process.env, ...(marked ? discovery.environment('thread', 'agent') : {}) },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      )
      children.push(child)
      const [assigned] = await once(child, 'message')
      return Number(assigned)
    }
    try {
      const port = await start('127.0.0.2', 0, true)
      await start('127.0.0.1', port, false)
      const result = await discovery.list('thread')
      expect(result.servers).toHaveLength(1)
      const url = result.servers[0]!.url
      expect(url).toBe(`http://127.0.0.2:${port}`)
      expect(await (await fetch(url!)).text()).toBe('127.0.0.2')
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }, 10000)

  it('reports a server that ignores graceful Stop without killing its shared process group', async () => {
    const discovery = new ThreadServers(randomUUID())
    const child = spawn(
      process.execPath,
      [
        '-e',
        "process.on('SIGTERM',()=>{});const s=require('http').createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>process.send(s.address().port));",
      ],
      {
        env: { ...process.env, ...discovery.environment('unresponsive', 'agent') },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    )
    try {
      await once(child, 'message')
      const server = (await discovery.list('unresponsive')).servers[0]!
      expect(server.url).toBe(`http://127.0.0.1:${server.port}`)
      await expect(discovery.stop({ ...server, taskId: 'unresponsive' }, () => {})).rejects.toThrow(
        'still running',
      )
      expect(child.signalCode).toBeNull()
      expect(child.exitCode).toBeNull()
    } finally {
      const exit = once(child, 'exit')
      child.kill('SIGKILL')
      await exit
    }
  }, 10000)

  it('isolates threads/runtime identities, survives session recreation, and rejects stale/unauthorized stops', async () => {
    const runtime = randomUUID()
    const discovery = new ThreadServers(runtime)
    const children: ReturnType<typeof spawn>[] = []
    const start = async (env: Record<string, string>) => {
      const child = spawn(
        process.execPath,
        [
          '-e',
          "const s=require('http').createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>process.send(s.address().port));",
        ],
        {
          env: { ...process.env, ...env },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      )
      children.push(child)
      const [port] = await once(child, 'message')
      return { child, port: Number(port) }
    }
    try {
      const one = await start(discovery.environment('one', 'agent'))
      const two = await start(discovery.environment('two', 'terminal'))
      await start(new ThreadServers(randomUUID()).environment('one', 'agent'))
      const result = await discovery.list('one')
      expect(result.supported).toBe(true)
      expect(result.servers).toHaveLength(1)
      expect(result.servers[0]).toMatchObject({
        pid: one.child.pid,
        port: one.port,
        source: 'agent',
      })
      const server = result.servers[0]!
      expect((await new ThreadServers(runtime).list('one')).servers).toEqual(result.servers)
      await expect(discovery.stop({ taskId: 'two', ...server }, () => {})).rejects.toThrow(
        'stopped or changed',
      )
      await expect(
        discovery.stop({ taskId: 'one', ...server, started: 'recycled-pid' }, () => {}),
      ).rejects.toThrow('stopped or changed')
      await expect(
        discovery.stop({ taskId: 'one', ...server }, () => {
          throw new Error('Device revoked')
        }),
      ).rejects.toThrow('Device revoked')
      expect(one.child.exitCode).toBeNull()
      const exit = once(one.child, 'exit')
      await discovery.stop({ taskId: 'one', ...server }, () => {})
      await exit
      expect((await new ThreadServers(runtime).list('one')).servers).toEqual([])
      expect((await discovery.list('two')).servers).toEqual([
        expect.objectContaining({ pid: two.child.pid, port: two.port, source: 'terminal' }),
      ])
      expect(two.child.exitCode).toBeNull()
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }, 20000)
})
