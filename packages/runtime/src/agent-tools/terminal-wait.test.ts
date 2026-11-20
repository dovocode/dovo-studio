import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { decode, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import { taskToolsServer } from './config.js'

vi.setConfig(runtimeIntegration)

const summarySchema = mutableStruct({
  id: Schema.String,
  running: Schema.Boolean,
  exitCode: Schema.optional(Schema.Number),
  outputTail: Schema.String,
  turn: Schema.Number,
  waitResult: Schema.optional(Schema.Literals(['activity', 'exit', 'timeout'])),
  activity: Schema.optional(mutableStruct({ state: Schema.String })),
})

// Reports working, then one state per line of input, then exits as the PTY's own program.
const agent = `
const report = (state) => process.stdout.write('\\x1b]7501;state=' + state + '\\x1b\\\\')
const states = ['blocked', 'done']
report('working')
process.stdin.on('data', () => {
  const next = states.shift()
  if (next === 'done') report('working')
  if (next) report(next)
  else process.exit(3)
})
`

it.skipIf(!['linux', 'darwin'].includes(process.platform))(
  'waits on a task terminal for a reported state, a current match, a timeout and a real exit',
  async () => {
    const f = await fixture()
    const token = 'terminal-wait-owner-token-with-32-characters'
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    const client = new Client({ name: 'terminal-wait-test', version: '1' })
    let transport: StdioClientTransport | undefined
    try {
      const s = runtime.services
      s.store.update(() => f.workspace)
      const task = s.tasks.create({
        title: 'Terminal wait',
        agentId: 'agent',
        repositoryId: 'repo',
        objective: '',
      })
      const user = s.terminals.create(task.id, f.directory)
      const runId = randomUUID()
      s.store.updateTask(task.id, (current) => ({ ...current, activeRunId: runId }))
      const runToken = s.runCredentials.issue(
        {
          taskId: task.id,
          runId,
          permissions: { provider: 'codex', permission: 'ask' },
          readOnly: false,
          artifacts: false,
          pipelineWatching: false,
          pullRequestWatching: false,
          deviceHub: false,
          memoryScopes: [],
        },
        new AbortController().signal,
      )
      const config = taskToolsServer(
        task.id,
        runtime.port,
        runToken,
        '127.0.0.1',
        false,
        false,
        runId,
      )
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          '--import',
          createRequire(import.meta.url).resolve('tsx'),
          fileURLToPath(new URL('./server.ts', import.meta.url)),
        ],
        env: { ...config.envValues },
        stderr: 'ignore',
      })
      await client.connect(transport)
      const call = async (name: string, arguments_: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: arguments_ })
        const content = result.content as { type: string; text: string }[]
        return { error: result.isError === true, text: content[0]?.text ?? '' }
      }
      const read = async (arguments_: Record<string, unknown>) => {
        const result = await call('terminal_read', arguments_)
        if (result.error) throw new Error(result.text)
        return decode(summarySchema, JSON.parse(result.text))
      }
      const script = join(f.directory, 'report-agent.cjs')
      await writeFile(script, agent)
      const opened = await call('terminal_run', {
        command: `exec '${process.execPath}' '${script}'`,
      })
      if (opened.error) throw new Error(opened.text)
      const { id } = decode(mutableStruct({ id: Schema.String }), JSON.parse(opened.text))
      const info = () => s.terminals.get(id).info
      await waitForRuntime(() => expect(info().activity?.state).toBe('working'))
      const send = (id: string) =>
        fetch(`http://127.0.0.1:${runtime.port}/api/terminals/send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${runToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, data: '\r' }),
        })
      expect((await send(user.id)).status).toBe(403)

      // Working is not a requested state, so the bounded wait times out with the current report.
      let started = Date.now()
      expect(await read({ id, until: ['blocked', 'done'], waitMs: 300 })).toMatchObject({
        running: true,
        waitResult: 'timeout',
        activity: { state: 'working' },
      })
      expect(Date.now() - started).toBeGreaterThanOrEqual(250)
      const observers = () => s.terminals.get(id).observers.size
      expect(observers()).toBe(0)
      // Without until, a read keeps its earlier shape.
      expect(await read({ id, summary: true })).not.toHaveProperty('waitResult')

      // A report that arrives during the wait ends it.
      started = Date.now()
      const blocked = read({ id, until: ['blocked'], waitMs: 15000 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      const sent = await send(id)
      expect(sent.status).toBe(200)
      expect(await sent.json()).toEqual({ turn: 0 })
      expect(await blocked).toMatchObject({
        running: true,
        waitResult: 'activity',
        turn: 1,
        activity: { state: 'blocked' },
      })
      expect(Date.now() - started).toBeLessThan(10000)

      // The same report still holds, so a second wait returns at once.
      started = Date.now()
      expect(await read({ id, until: ['blocked'], waitMs: 15000 })).toMatchObject({
        waitResult: 'activity',
        activity: { state: 'blocked' },
      })
      expect(Date.now() - started).toBeLessThan(2000)

      expect(await read({ id, afterTurn: 1, until: ['blocked'] })).toMatchObject({
        waitResult: 'timeout',
        turn: 1,
      })
      expect((await call('terminal_input', { id, data: '', submit: true })).error).toBe(false)
      await waitForRuntime(() => expect(info().activity?.state).toBe('done'))
      expect(await read({ id, afterTurn: 1 })).toMatchObject({
        waitResult: 'activity',
        turn: 2,
      })

      // A caller that disconnects ends the runtime wait and its subscription.
      const disconnect = new AbortController()
      const abandoned = client.callTool(
        { name: 'terminal_read', arguments: { id, until: ['blocked'], waitMs: 15000 } },
        undefined,
        { signal: disconnect.signal },
      )
      await waitForRuntime(() => expect(observers()).toBe(1))
      disconnect.abort()
      await expect(abandoned).rejects.toThrow(/abort/i)
      await waitForRuntime(() => expect(observers()).toBe(0))

      // Program exit ends a wait for a state that never arrives, with its real exit code.
      started = Date.now()
      const exited = read({ id, until: ['blocked'], waitMs: 15000 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect((await call('terminal_input', { id, data: '', submit: true })).error).toBe(false)
      expect(await exited).toMatchObject({ running: false, exitCode: 3, waitResult: 'exit' })
      expect(Date.now() - started).toBeLessThan(10000)

      // The wait has the same task scope as a read: the user's shell stays out of reach.
      for (const arguments_ of [
        { id: user.id, until: ['idle'], waitMs: 100 },
        { id, until: [], waitMs: 100 },
        { id, until: ['working'], waitMs: 100 },
      ])
        expect((await call('terminal_read', arguments_)).error).toBe(true)

      // Explicit close ends a wait at once with a clear error, not after a timeout.
      const second = await call('terminal_run', {
        command: `exec '${process.execPath}' '${script}'`,
      })
      if (second.error) throw new Error(second.text)
      const other = decode(mutableStruct({ id: Schema.String }), JSON.parse(second.text)).id
      await waitForRuntime(() =>
        expect(s.terminals.get(other).info.activity?.state).toBe('working'),
      )
      const closedSession = s.terminals.get(other)
      started = Date.now()
      const closing = call('terminal_read', { id: other, until: ['blocked'], waitMs: 15000 })
      await waitForRuntime(() => expect(closedSession.observers.size).toBe(1))
      expect((await call('terminal_close', { id: other })).error).toBe(false)
      expect(await closing).toEqual({ error: true, text: 'The terminal was closed while waiting' })
      expect(Date.now() - started).toBeLessThan(10000)
      expect(closedSession.observers.size).toBe(0)
    } finally {
      await client.close()
      await transport?.close()
      await runtime.close()
      await f.cleanup()
    }
  },
)
