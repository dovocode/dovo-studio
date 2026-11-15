import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vite-plus/test'
import sharp from 'sharp'
import { OpenCode, type JobInfo } from '@opencode/client'
import type { AgentRun } from '../../execution/types.js'
import { opencodeV2Adapter } from './opencode-v2.js'
import { opencodeJobs } from './opencode-jobs.js'
import { readOpencodeJob } from './opencode-job-preview.js'
import { opencodeGoal } from './opencode-goal.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function fixture() {
  let stream: ServerResponse | undefined
  let goal: unknown = null
  let inventory: JobInfo[] = []
  let history: unknown[] = []
  let output = 'shell output'
  let preview: Buffer = Buffer.from('not an image')
  let shellStatus = 'running'
  let sequence = 0
  let connections = 0
  let offline = false
  let streamStatus = 200
  let version = '2.3.0'
  const saved: unknown[] = []
  const calls: Array<{ path: string; method: string; body: unknown; query: URLSearchParams }> = []
  const prompted = deferred<void>()
  const commanded = deferred<void>()
  const reconnected = deferred<void>()
  const emit = (type: string, data: unknown) => {
    const durable = type.startsWith('session.') && !type.endsWith('.delta')
    const event = {
      type,
      data,
      created: Date.now(),
      id: crypto.randomUUID(),
      ...(durable ? { durable: { aggregateID: 'session', seq: ++sequence, version: 1 } } : {}),
    }
    if (durable) saved.push(event)
    if (!offline) stream?.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/event') {
      connections++
      if (streamStatus !== 200) {
        response.writeHead(streamStatus).end('{}')
        return
      }
      offline = false
      stream = response
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.flushHeaders()
      emit('server.connected', {})
      if (connections > 1) reconnected.resolve()
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const path = url.pathname
      const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
      calls.push({ path, method: request.method ?? '', body, query: url.searchParams })
      response.setHeader('Content-Type', 'application/json')
      const json = (value: unknown) => response.end(JSON.stringify(value))
      if (path === '/api/info') return json({ version })
      if (path === '/api/session/session' && request.method === 'GET')
        return json({ data: { tokens: 0, cost: 0 } })
      if (path === '/api/session/active') return json({ data: {} })
      if (path === '/api/session') return json({ data: { id: 'session' } })
      if (path.endsWith('/prompt')) {
        json({ id: 'accepted' })
        prompted.resolve()
        return
      }
      if (path.endsWith('/command')) {
        const text = body && typeof body === 'object' && 'text' in body ? body.text : ''
        if (text === 'pause' && goal && typeof goal === 'object')
          goal = { ...goal, status: 'paused' }
        if (text === 'clear') goal = null
        response.writeHead(204).end()
        commanded.resolve()
        return
      }
      if (path.endsWith('/interrupt')) return json({})
      if (path.endsWith('/wait')) {
        response.writeHead(204).end()
        return
      }
      if (path === '/api/permission/request' || path === '/api/session/session/form')
        return json({ data: [] })
      if (path === '/api/experimental/session/session/log') {
        response.setHeader('Content-Type', 'text/event-stream')
        for (const event of saved) {
          if (
            event &&
            typeof event === 'object' &&
            'durable' in event &&
            event.durable &&
            typeof event.durable === 'object' &&
            'seq' in event.durable &&
            typeof event.durable.seq === 'number' &&
            event.durable.seq > Number(url.searchParams.get('after') ?? -1)
          )
            response.write(`data: ${JSON.stringify(event)}\n\n`)
        }
        response.end(
          `data: ${JSON.stringify({ type: 'log.synced', aggregateID: 'session', seq: sequence })}\n\n`,
        )
        return
      }
      if (path === '/api/session/session/message') return json({ data: history, cursor: {} })
      if (path === '/api/rpc/opencode.goal/get') return json({ output: goal })
      if (path === '/api/experimental/job') return json({ data: inventory })
      if (path.endsWith('/output'))
        return json({
          data: { output, cursor: output.length, size: output.length, truncated: false },
        })
      if (path === '/api/shell/shell' && request.method === 'DELETE') {
        shellStatus = 'killed'
        inventory = inventory.filter((job) => job.kind !== 'shell')
        response.writeHead(204).end()
        return
      }
      if (path === '/api/shell/shell')
        return json({
          data: {
            id: 'shell',
            status: shellStatus,
            ...(shellStatus === 'exited' ? { exit: 0 } : {}),
          },
        })
      if (path.startsWith('/api/fs/read/')) {
        response.setHeader('Content-Type', 'image/png')
        response.end(preview)
        return
      }
      if (request.method === 'PATCH' || path.endsWith('/model')) {
        response.writeHead(204).end()
        return
      }
      return json({})
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  const endpoint = `http://127.0.0.1:${address.port}`
  const events: Array<{ name: string; payload: unknown }> = []
  const controller = new AbortController()
  const run: AgentRun = {
    agent: {
      id: 'agent',
      name: 'OpenCode',
      provider: 'opencode',
      endpoint,
      model: 'test/model',
      permission: 'read-only',
      instructions: '',
    },
    cwd: '/tmp',
    prompt: 'Work',
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    onSession: () => {},
    onText: () => {},
    onActivity: () => {},
    approve: async () => 'deny',
    ask: async () => null,
    onEvent: (name, payload) => events.push({ name, payload }),
    onSubagentEvent: (name, payload) => events.push({ name, payload }),
  }
  return {
    run,
    events,
    emit,
    prompted,
    commanded,
    reconnected,
    calls,
    controller,
    disconnect(status = 200) {
      offline = true
      streamStatus = status
      stream?.end()
    },
    get connections() {
      return connections
    },
    set version(value: string) {
      version = value
    },
    api: OpenCode.make({ baseUrl: endpoint }),
    set goal(value: unknown) {
      goal = value
    },
    set jobs(value: JobInfo[]) {
      inventory = value
    },
    set output(value: string) {
      output = value
    },
    set preview(value: Buffer) {
      preview = value
    },
    set history(value: unknown[]) {
      history = value
    },
    set shellStatus(value: string) {
      shellStatus = value
    },
    async close() {
      stream?.end()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
const shell: JobInfo = {
  kind: 'shell',
  id: 'one',
  sessionID: 'session',
  shellID: 'shell',
  command: 'sleep 1',
  status: 'running',
  time: { started: 1 },
}

it('restores missed completion and text from durable events without resending work', async () => {
  const f = await fixture()
  const text: string[] = []
  f.run.onText = (value) => text.push(value)
  try {
    const running = opencodeV2Adapter.run(f.run)
    await f.prompted.promise
    f.emit('session.execution.started', { sessionID: 'session' })
    f.emit('session.text.delta', {
      sessionID: 'session',
      assistantMessageID: 'answer',
      ordinal: 0,
      delta: 'First ',
    })
    // Let the client consume the last durable cursor before dropping the stream.
    await new Promise((resolve) => setTimeout(resolve, 30))
    f.disconnect()
    f.emit('session.text.ended', {
      sessionID: 'session',
      assistantMessageID: 'answer',
      ordinal: 0,
      text: 'First and last.',
    })
    f.emit('session.execution.succeeded', { sessionID: 'session' })
    await running
    expect(text.join('')).toBe('First and last.')
    expect(f.connections).toBe(2)
    expect(f.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(1)
    expect(f.calls.some((call) => call.path.endsWith('/interrupt'))).toBe(false)
  } finally {
    await f.close()
  }
})

it('recovers job inventory while waiting for background completion', async () => {
  const f = await fixture()
  try {
    f.jobs = [shell]
    const running = opencodeV2Adapter.run(f.run)
    await f.prompted.promise
    f.emit('session.execution.started', { sessionID: 'session' })
    f.emit('session.execution.succeeded', { sessionID: 'session' })
    await new Promise((resolve) => setTimeout(resolve, 40))
    f.disconnect()
    f.shellStatus = 'exited'
    f.jobs = [{ ...shell, status: 'completed' }]
    await running
    expect(
      f.events.some(
        (event) =>
          event.name === 'dovo/opencode/job' &&
          event.payload &&
          typeof event.payload === 'object' &&
          'status' in event.payload &&
          event.payload.status === 'completed',
      ),
    ).toBe(true)
    expect(f.connections).toBe(2)
    expect(f.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(1)
  } finally {
    await f.close()
  }
})

it('does not retry a rejected event connection or replay an uncertain prompt', async () => {
  const f = await fixture()
  try {
    const running = opencodeV2Adapter.run(f.run)
    await f.prompted.promise
    f.emit('session.execution.started', { sessionID: 'session' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    f.disconnect(401)
    await expect(running).rejects.toThrow('UnsupportedContentType')
    expect(f.connections).toBe(2)
    expect(f.calls.filter((call) => call.path.endsWith('/prompt'))).toHaveLength(1)
  } finally {
    await f.close()
  }
})

it('refreshes, pauses and clears native goals and rejects older servers', async () => {
  const f = await fixture()
  try {
    f.goal = { objective: 'Keep working', status: 'active', rounds: 3 }
    const goal = opencodeGoal(f.run, f.api, 'session')
    f.run.goal = { action: 'get' }
    expect(await goal.control()).toBe(true)
    expect(goal.active).toBe(true)
    f.run.goal = { action: 'pause' }
    expect(await goal.control()).toBe(true)
    expect(goal.active).toBe(false)
    f.run.goal = { action: 'clear' }
    expect(await goal.control()).toBe(true)
    expect(f.events.at(-1)).toEqual({ name: 'dovo/opencode/goal', payload: null })
    f.version = '2.2.4'
    f.run.goal = { action: 'set', objective: 'Unsupported' }
    await expect(goal.control()).rejects.toThrow('2.2.5')
  } finally {
    await f.close()
  }
})

it('Stop pauses an active goal before interrupting and confirms the stopped session', async () => {
  const f = await fixture()
  try {
    const running = opencodeV2Adapter.run(f.run)
    await f.prompted.promise
    f.emit('session.execution.started', { sessionID: 'session' })
    f.goal = { objective: 'Keep working', status: 'active', rounds: 1 }
    f.emit('rpc.opencode.goal.changed', {
      sessionID: 'session',
      goal: { objective: 'Keep working', status: 'active', rounds: 1 },
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    f.controller.abort()
    await expect(running).rejects.toThrow('Task cancelled')
    const command = f.calls.findIndex((call) => call.path.endsWith('/command'))
    const interrupt = f.calls.findIndex((call) => call.path.endsWith('/interrupt'))
    expect(command).toBeGreaterThan(-1)
    expect(interrupt).toBeGreaterThan(command)
    expect(f.calls.some((call) => call.path.endsWith('/wait'))).toBe(true)
    expect(f.events).toContainEqual({
      name: 'dovo/opencode/goal',
      payload: { sessionId: 'session', objective: 'Keep working', status: 'paused', rounds: 1 },
    })
  } finally {
    await f.close()
  }
})

it('keeps a native goal turn open through continuation and ignores early goal clearing', async () => {
  const f = await fixture()
  let finished = false
  try {
    const running = opencodeV2Adapter.run(f.run).then(() => {
      finished = true
    })
    await f.prompted.promise
    f.emit('session.execution.started', { sessionID: 'session' })
    f.goal = { objective: 'Finish work', status: 'active', rounds: 1 }
    f.emit('session.execution.succeeded', { sessionID: 'session' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(finished).toBe(false)
    f.emit('session.execution.started', { sessionID: 'session' })
    f.goal = null
    f.emit('rpc.opencode.goal.changed', { sessionID: 'session', goal: null })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(finished).toBe(false)
    f.emit('session.execution.succeeded', { sessionID: 'session' })
    await running
    expect(finished).toBe(true)
    expect(f.events).toContainEqual({
      name: 'dovo/opencode/goal',
      payload: { sessionId: 'session', objective: 'Finish work', status: 'active', rounds: 1 },
    })
  } finally {
    await f.close()
  }
})

it('maps only successful parent checklist writes and recovers a saved empty list', async () => {
  const f = await fixture()
  try {
    f.run.sessionId = 'session'
    f.history = [
      {
        type: 'assistant',
        content: [
          {
            type: 'tool',
            name: 'todowrite',
            state: { status: 'completed', metadata: { todos: [] } },
          },
        ],
      },
    ]
    const running = opencodeV2Adapter.run(f.run)
    await f.prompted.promise
    f.emit('session.execution.started', { sessionID: 'session' })
    f.emit('session.tool.input.started', { sessionID: 'session', id: 'todo', name: 'todowrite' })
    f.emit('session.tool.success', {
      sessionID: 'child',
      id: 'todo',
      content: [],
      metadata: { todos: [{ content: 'Wrong', status: 'pending' }] },
    })
    f.emit('session.tool.success', {
      sessionID: 'session',
      id: 'todo',
      content: [],
      metadata: { todos: [{ content: 'Bad', status: 'unknown' }] },
    })
    f.emit('session.tool.failed', { sessionID: 'session', id: 'todo', error: { message: 'No' } })
    f.emit('session.tool.success', {
      sessionID: 'session',
      id: 'todo',
      content: [],
      metadata: {
        todos: [
          { content: 'Kept', status: 'in_progress' },
          { content: 'Skipped', status: 'cancelled' },
        ],
      },
    })
    f.emit('session.execution.succeeded', { sessionID: 'session' })
    await running
    expect(f.events.filter((event) => event.name === 'todo.updated')).toEqual([
      { name: 'todo.updated', payload: { properties: { sessionID: 'session', todos: [] } } },
      {
        name: 'todo.updated',
        payload: {
          properties: {
            sessionID: 'session',
            todos: [
              { content: 'Kept', status: 'in_progress' },
              { content: 'Skipped', status: 'cancelled' },
            ],
          },
        },
      },
    ])
  } finally {
    await f.close()
  }
})

it('tracks owned shell output and confirmed Stop, without reviving a stopped job', async () => {
  const f = await fixture()
  try {
    f.jobs = [shell, { ...shell, id: 'foreign', sessionID: 'other' }]
    const jobs = opencodeJobs(f.run, f.api, 'session', () => false)
    await jobs.initialize(true)
    expect(jobs.owns('job:one')).toBe(true)
    expect(jobs.owns('job:foreign')).toBe(false)
    expect((await jobs.read('job:one'))[0]?.text).toBe('shell output')
    await expect(jobs.stop('job:foreign')).rejects.toThrow('does not belong')
    await jobs.stop('job:one')
    f.jobs = [shell]
    await jobs.refresh()
    expect(f.events.at(-1)?.payload).toMatchObject({ id: 'job:one', status: 'cancelled' })
    expect(
      f.calls.some((call) => call.method === 'DELETE' && call.path === '/api/shell/shell'),
    ).toBe(true)
  } finally {
    await f.close()
  }
})

it('recovers descendant job ownership, makes raster previews and rejects foreign jobs', async () => {
  const f = await fixture()
  try {
    f.preview = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    f.jobs = [
      {
        ...shell,
        kind: 'subagent',
        id: 'child-job',
        childSessionID: 'child',
        agent: 'explore',
        description: 'Explore',
      },
      {
        kind: 'image',
        id: 'picture',
        sessionID: 'child',
        status: 'completed',
        path: '/tmp/image.png',
        model: 'image',
        time: { started: 1 },
      },
      {
        kind: 'image',
        id: 'foreign',
        sessionID: 'other',
        status: 'completed',
        path: '/tmp/private.png',
        model: 'image',
        time: { started: 1 },
      },
    ]
    const entries = await readOpencodeJob(f.run.agent, 'job:picture', 'session', '/tmp')
    expect(entries[0]?.image?.mime).toBe('image/webp')
    const metadata = await sharp(Buffer.from(entries[0]?.image?.data ?? '', 'base64')).metadata()
    expect(metadata.width).toBe(20)
    await expect(readOpencodeJob(f.run.agent, 'job:foreign', 'session', '/tmp')).rejects.toThrow(
      'does not belong',
    )
    expect(f.calls.some((call) => call.path.includes('private.png'))).toBe(false)
  } finally {
    await f.close()
  }
})
