import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { decode, mutableStruct, type McpServer } from '@dovo/protocol'
import { Schema } from 'effect'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import type { AgentAdapter, AgentRun, AgentSteer } from '../agents/execution/types.js'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
const question = {
  key: 'direction',
  title: 'Choose a direction',
  questions: [
    {
      id: 'approach',
      header: 'Approach',
      question: 'Which approach?',
      options: [{ value: 'small', label: 'Small change' }],
      custom: true,
    },
  ],
}
function resultText(result: Awaited<ReturnType<Client['callTool']>>) {
  const block = CallToolResultSchema.parse(result).content.find((part) => part.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Expected text')
  return block.text
}
async function setup(readOnly = false) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const owner = 'agent-interactions-test-owner-token-at-least-32-chars'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => ({
    ...f.workspace,
    agents: f.workspace.agents.map((agent) => ({
      ...agent,
      permission: readOnly ? 'read-only' : 'ask',
    })),
  }))
  const runs: AgentRun[] = []
  let finish = () => {}
  const promise = new Promise<void>((resolve) => {
    finish = resolve
  })
  const gate = { promise, resolve: () => finish() }
  cleanups.push(async () => gate.resolve())
  const steer = vi.fn<AgentSteer>(async () => {})
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      runs.push(run)
      run.onSession('tool-forms-session')
      if (runs.length === 1) {
        run.onSteer?.(steer)
        await gate.promise
      }
      run.onText('Completed')
    },
  })
  // Tools also work without a primary project or any Studio Tools feature flags.
  const scratch = await s.scratch.ensure()
  const task = s.tasks.create({
    title: 'General',
    repositoryId: scratch.id,
    agentId: 'agent',
    objective: 'Original',
  })
  const execution = await s.tasks.start(task.id)
  await waitForRuntime(() => expect(runs).toHaveLength(1))
  const config: McpServer | undefined = runs[0].agent.resources?.mcpServers.find(
    (server) => server.name === 'dovo_task',
  )
  if (!config) throw new Error('Expected regular task tools')
  const client = new Client({ name: 'interactions-test', version: '1' })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.envValues,
    stderr: 'ignore',
  })
  cleanups.push(async () => {
    await client.close()
    await transport.close()
  })
  await client.connect(transport)
  const credential = decode(
    mutableStruct({ token: Schema.String, runId: Schema.String }),
    JSON.parse(readFileSync(config.envValues?.DOVO_TASK_CREDENTIAL_FILE ?? '', 'utf8')),
  )
  const post = (path: string, input: unknown, token = credential.token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  return { s, task, execution, runs, gate, steer, client, credential, post, owner }
}

it.each(['live', 'finished', 'declined'] as const)(
  'delivers regular questions through MCP when %s, without duplicate forms or answers',
  async (timing) => {
    const { s, task, execution, runs, gate, steer, client, post, owner } = await setup()
    const call = () =>
      client.callTool({ name: 'ask_question', arguments: { ...question, taskId: 'other' } })
    const first = await call()
    expect(first.isError).not.toBe(true)
    const opened = decode(
      mutableStruct({ id: Schema.String, status: Schema.String }),
      JSON.parse(resultText(first)),
    )
    expect(opened.status).toBe('pending')
    expect((await call()).isError).not.toBe(true)
    expect(s.questions.list()).toHaveLength(1)
    expect(s.questions.list()[0]).toMatchObject({
      id: opened.id,
      taskId: task.id,
      prompt: { blocking: false },
    })
    expect(
      (
        await client.callTool({
          name: 'ask_question',
          arguments: { ...question, title: 'Changed question' },
        })
      ).isError,
    ).toBe(true)
    if (timing !== 'live') {
      gate.resolve()
      await execution.done
    }
    expect(s.questions.list()).toHaveLength(1)
    const input = {
      id: opened.id,
      answers: timing === 'declined' ? null : { approach: ['Custom answer'] },
    }
    expect((await post('/api/tasks/answer', input, owner)).status).toBe(200)
    expect((await post('/api/tasks/answer', input, owner)).status).toBe(200)
    await waitForRuntime(() =>
      expect(timing === 'live' ? steer.mock.calls.length : runs.length).toBe(
        timing === 'live' ? 1 : 2,
      ),
    )
    const retry = timing === 'live' ? await call() : undefined
    expect(retry?.isError).not.toBe(true)
    expect(
      retry &&
        decode(mutableStruct({ status: Schema.String }), JSON.parse(resultText(retry))).status,
    ).toBe(timing === 'live' ? 'answered' : undefined)
    gate.resolve()
    await execution.done
    await waitForRuntime(() =>
      expect(
        s.store.task(task.id).messages.filter((message) => message.role === 'user'),
      ).toHaveLength(2),
    )
    expect(s.questions.list()).toHaveLength(0)
    expect(
      s.store
        .task(task.id)
        .messages.filter((message) => message.role === 'user')
        .at(-1)?.text,
    ).toBe(
      timing === 'declined'
        ? 'The user declined to answer:\nWhich approach?'
        : 'Which approach?\nCustom answer',
    )
  },
)

it('allows read-only progress, validates tool inputs and restricts raw HTTP to this active turn', async () => {
  const { s, task, client, credential, post, owner, gate, execution } = await setup(true)
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(['ask_question', 'todos']),
  )
  expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('studio_threads')
  const items = [
    { text: 'Inspect', status: 'completed' },
    { text: 'Explain', status: 'in-progress' },
  ]
  expect(
    (await client.callTool({ name: 'todos', arguments: { action: 'set', items, taskId: 'other' } }))
      .isError,
  ).not.toBe(true)
  expect(s.store.task(task.id).nativeTodos).toEqual(items)
  const list = await client.callTool({ name: 'todos', arguments: { action: 'list' } })
  expect(JSON.parse(resultText(list))).toEqual({ items })
  for (const invalid of [
    [{ text: 'Bad', status: 'done' }],
    [{ text: ' ', status: 'pending' }],
    [
      { id: 'same', text: 'First', status: 'pending' },
      { id: 'same', text: 'Second', status: 'pending' },
    ],
    Array.from({ length: 101 }, () => items[0]),
  ])
    expect(
      (await client.callTool({ name: 'todos', arguments: { action: 'set', items: invalid } }))
        .isError,
    ).toBe(true)
  expect(s.store.task(task.id).nativeTodos).toEqual(items)
  for (const path of ['/api/agent/todos', '/api/agent/question']) {
    const command = path.endsWith('todos') ? { action: 'set', items } : question
    for (const input of [
      { taskId: 'other', parentRunId: credential.runId, command },
      { taskId: task.id, command },
      { taskId: task.id, parentRunId: 'wrong', command },
    ])
      expect((await post(path, input)).status).toBe(403)
    expect(
      (await post(path, { taskId: task.id, parentRunId: credential.runId, command }, owner)).status,
    ).toBe(403)
  }
  for (const questions of [
    [question.questions[0], question.questions[0]],
    [{ ...question.questions[0], secret: true }],
  ])
    expect(
      (await client.callTool({ name: 'ask_question', arguments: { ...question, questions } }))
        .isError,
    ).toBe(true)
  expect(s.questions.list()).toHaveLength(0)
  expect(
    (await client.callTool({ name: 'todos', arguments: { action: 'set', items: [] } })).isError,
  ).not.toBe(true)
  expect(s.store.task(task.id).nativeTodos).toBeUndefined()
  gate.resolve()
  await execution.done
  expect((await client.callTool({ name: 'todos', arguments: { action: 'list' } })).isError).toBe(
    true,
  )
})

it('cancels a tool question on Stop without sending an invented answer', async () => {
  const { s, task, client, gate, execution } = await setup()
  expect((await client.callTool({ name: 'ask_question', arguments: question })).isError).not.toBe(
    true,
  )
  const id = s.questions.list()[0].id
  const cancelled = execution.done.catch((error: unknown) => error)
  s.tasks.cancel(task.id)
  gate.resolve()
  expect(await cancelled).toMatchObject({ cause: { message: 'Cancelled by user' } })
  expect(s.questions.list()).toHaveLength(0)
  expect(s.store.task(task.id).queue).toBeUndefined()
  expect(() => s.questions.respond(id, { approach: ['small'] })).toThrow('cancelled')
  expect(s.store.task(task.id).messages.filter((message) => message.role === 'user')).toHaveLength(
    1,
  )
})
