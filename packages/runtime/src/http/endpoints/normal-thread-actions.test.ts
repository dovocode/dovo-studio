import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { Schema } from 'effect'
import {
  decode,
  agentTurnSettings,
  defaultTaskHarness,
  mutableStruct,
  noStudioTools,
  threadActionResultSchema,
  type Automation,
  type Task,
} from '@dovo/protocol'
import { botTestToken, setupBotRuntime, type BotRunInput } from '../../testing/bots'
import { waitForRuntime } from '../../testing/integration'

async function connect(input: BotRunInput) {
  const config = input.agent.resources?.mcpServers.find((server) => server.name === 'dovo_task')
  if (!config) throw Error('Expected regular Dovo MCP tools')
  expect(config.envValues?.DOVO_TASK_READ_ONLY).toBe('1')
  expect(JSON.parse(config.envValues?.DOVO_STUDIO_TOOLS ?? '{}')).toEqual(noStudioTools())
  const client = new Client({ name: 'normal-thread-actions-test', version: '1' })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.envValues,
    stderr: 'ignore',
  })
  await client.connect(transport)
  const credential = decode(
    mutableStruct({ token: Schema.String, runId: Schema.String }),
    JSON.parse(readFileSync(config.envValues?.DOVO_TASK_CREDENTIAL_FILE ?? '', 'utf8')),
  )
  return { client, transport, credential, taskId: config.envValues?.DOVO_TASK_ID }
}

for (const origin of ['normal', 'automation'] as const)
  it(`prepares a new-thread card through real read-only MCP in a ${origin} thread, then requires paired-human Send`, async () => {
    const f = await setupBotRuntime()
    const s = f.runtime.services
    const scratch = await s.scratch.ensure()
    const draft = (): Task => ({
      ...f.draft(),
      title: 'Reviewed follow-up',
      harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
    })
    let sourceId = ''
    let actionId = ''
    let toolCalls = 0
    let sourceFinished = false
    let sourceFailure: unknown
    const prepare = async (input: BotRunInput) => {
      const tools = await connect(input)
      try {
        const available = await tools.client.listTools()
        expect(available.tools.some((tool) => tool.name === 'thread_prepare')).toBe(true)
        const before = s.store.get().tasks.length
        const runs = s.jobs.list().length
        const result = CallToolResultSchema.parse(
          await tools.client.callTool({
            name: 'thread_prepare',
            arguments: { key: 'follow-up', title: 'Follow up', prompt: 'Suggested follow-up' },
          }),
        )
        expect(result.isError).not.toBe(true)
        const block = result.content.find((part) => part.type === 'text')
        if (!block || block.type !== 'text') throw Error('Expected action receipt')
        const prepared = decode(mutableStruct({ id: Schema.String }), JSON.parse(block.text))
        actionId = prepared.id
        if (!tools.taskId) throw Error('Expected MCP source thread ID')
        sourceId = tools.taskId
        expect(s.store.taskSummary(sourceId).bot).toBeUndefined()
        expect(s.store.get().tasks).toHaveLength(before)
        expect(s.jobs.list()).toHaveLength(runs)
        expect(f.inputs).toHaveLength(1)
        const send = {
          sourceTaskId: sourceId,
          actionId,
          messageId: randomUUID(),
          createTask: draft(),
          text: 'Human input',
        }
        const denied = await f.request(
          '/api/thread-actions/send',
          send,
          'POST',
          undefined,
          tools.credential.token,
        )
        expect(denied.status).toBe(403)
        expect(
          (
            await f.request(
              '/api/thread-actions/dismiss',
              { sourceTaskId: sourceId, actionId },
              'POST',
              undefined,
              tools.credential.token,
            )
          ).status,
        ).toBe(403)
        expect(s.store.taskSummary(sourceId).threadActions?.[0].state).toBe('prepared')
        expect(s.store.get().tasks).toHaveLength(before)
        toolCalls++
      } catch (error) {
        sourceFailure = error
        throw error
      } finally {
        await tools.client.close()
        await tools.transport.close()
      }
      sourceFinished = true
    }
    f.runtime.run.mockImplementation(async (input) => {
      input.onSession(randomUUID())
      if (input.prompt.includes('PREPARE FOLLOW-UP')) await prepare(input)
      input.onText('Done')
    })
    let sourceResponse: Response
    if (origin === 'normal') {
      const source = { ...draft(), title: 'Normal source', harness: defaultTaskHarness('codex') }
      sourceId = source.id
      sourceResponse = await f.request('/api/tasks/message', {
        id: source.id,
        createTask: source,
        messageId: randomUUID(),
        text: 'PREPARE FOLLOW-UP',
        turnSettings: agentTurnSettings(
          { ...defaultTaskHarness('codex'), permission: 'read-only' },
          true,
        ),
      })
    } else {
      const flow: Automation = {
        id: 'card-source-workflow',
        name: 'Prepare follow-up',
        enabled: true,
        nodes: ['trigger', 'task'].map((id, index) => ({
          id,
          type: 'automation',
          position: { x: index * 100, y: 0 },
          data: {
            kind: index === 0 ? 'trigger' : 'task',
            label: id,
            trigger: 'manual',
            schedule: '',
            timezone: 'UTC',
            objective: 'PREPARE FOLLOW-UP',
            agentId: '',
            repositoryId: scratch.id,
            harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
          },
        })),
        edges: [{ id: 'start', source: 'trigger', target: 'task' }],
      }
      s.store.update((workspace) => ({ ...workspace, automations: [flow] }))
      sourceResponse = await f.request('/api/jobs/run', { id: flow.id, requestId: randomUUID() })
    }
    expect(sourceResponse.status).toBe(200)
    await waitForRuntime(() => {
      if (sourceFailure) throw sourceFailure
      expect(sourceFinished).toBe(true)
      expect(toolCalls).toBe(1)
      expect(s.store.taskSummary(sourceId).status).toBe('review')
    })
    await waitForRuntime(() =>
      expect(s.jobs.list().every((run) => run.status === 'completed')).toBe(true),
    )
    expect(s.store.taskSummary(sourceId).origin).toBe(
      origin === 'automation' ? 'card-source-workflow' : undefined,
    )
    expect(
      s.store.task(sourceId).messages.some((message) => message.source?.kind === 'automation'),
    ).toBe(origin === 'automation')
    const count = s.store.get().tasks.length
    // The preparing turn is read-only even when the normal source's saved harness is broader.
    const tooBroad = await f.request('/api/thread-actions/send', {
      sourceTaskId: sourceId,
      actionId,
      messageId: randomUUID(),
      createTask: { ...draft(), harness: defaultTaskHarness('codex') },
      text: 'Needs broader access',
    })
    expect(tooBroad.status).toBe(403)
    expect(await tooBroad.json()).toMatchObject({ mutationRejected: true })
    expect(s.store.get().tasks).toHaveLength(count)
    const target = draft()
    const payload = {
      sourceTaskId: sourceId,
      actionId,
      messageId: randomUUID(),
      createTask: target,
      text: 'Human edited follow-up',
    }
    const agentDevice = await fetch(`http://127.0.0.1:${f.runtime.port}/api/thread-actions/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botTestToken}`,
        'Content-Type': 'application/json',
        'x-dovo-agent-access': '1',
      },
      body: JSON.stringify(payload),
    })
    expect(agentDevice.status).toBe(403)
    expect(s.store.get().tasks).toHaveLength(count)
    const sent = await f.request('/api/thread-actions/send', payload)
    expect(sent.status).toBe(200)
    expect(decode(threadActionResultSchema, await sent.json()).action.sent?.taskId).toBe(target.id)
    await waitForRuntime(() => expect(s.store.taskSummary(target.id).status).toBe('review'))
    expect(s.store.get().tasks).toHaveLength(count + 1)
    expect(f.inputs).toHaveLength(2)
    expect(f.inputs[1].prompt).toContain('Human edited follow-up')
    expect((await f.request('/api/thread-actions/send', payload)).status).toBe(200)
    expect(f.inputs).toHaveLength(2)
  })
