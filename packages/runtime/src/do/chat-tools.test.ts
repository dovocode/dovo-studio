import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  decode,
  doChatCreateReplySchema,
  mutableStruct,
  type DoSaveRequest,
  type McpServer,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import type { AgentAdapter, AgentRun } from '../agents/execution/types.js'

vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

it('connects a real coordinator MCP session to scoped proposals while keeping Start paired-client only', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const ownerToken = 'do-chat-tools-test-owner-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.preferences.save({ enableDo: true })
  const calls: AgentRun[] = []
  let finish = () => {}
  const hold = new Promise<void>((resolve) => {
    finish = resolve
  })
  cleanups.push(async () => finish())
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      calls.push(run)
      await hold
      run.onText('Proposal ready')
    },
  })
  const post = (path: string, input: unknown, token = ownerToken) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const request = {
    id: randomUUID(),
    text: 'Investigate the issue and propose verified changes',
    repositoryId: 'repo',
    agentId: 'agent',
  }
  const created = await post('/api/do/chat/create', request)
  expect(created.status).toBe(200)
  const { taskId } = decode(doChatCreateReplySchema, await created.json())
  await waitForRuntime(() => expect(calls).toHaveLength(1))
  expect(calls[0].agent.instructions).toContain('do_plan')
  const config: McpServer | undefined = calls[0].agent.resources?.mcpServers.find(
    (server) => server.name === 'dovo_task',
  )
  if (!config) throw new Error('Expected coordinator MCP configuration')
  expect(config.envValues?.DOVO_TASK_DO_COORDINATOR).toBe('1')
  const client = new Client({ name: 'do-chat-tools-test', version: '1' })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.envValues,
    stderr: 'pipe',
  })
  cleanups.push(() => client.close())
  await client.connect(transport)
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('do_plan')
  const discovery = await client.callTool({
    name: 'do_plan',
    arguments: { action: 'discover', runtimeId: 'local', repositoryId: 'repo' },
  })
  expect(discovery.isError).not.toBe(true)
  const plan: DoSaveRequest = {
    id: randomUUID(),
    title: 'Investigate issue',
    goal: request.text,
    maxConcurrency: 1,
    items: [
      {
        id: 'investigate',
        title: 'Inspect and verify',
        instructions: 'Inspect the issue and run focused checks. Report evidence.',
        dependsOn: [],
        target: {
          runtimeId: 'local',
          repositoryId: 'repo',
          agentId: 'agent',
          execution: 'worktree',
        },
      },
    ],
  }
  const proposal = await client.callTool({
    name: 'do_plan',
    arguments: { action: 'propose', plan },
  })
  expect(proposal.isError).not.toBe(true)
  expect(s.doRuns.read(plan.id).status).toBe('draft')
  expect(s.store.get().tasks).toHaveLength(f.workspace.tasks.length + 1)
  const review = await post('/api/do/chat/plans', { taskId })
  expect(review.status).toBe(200)
  expect(await review.json()).toMatchObject({ runs: [{ id: plan.id, status: 'draft' }] })
  const credentialFile = config.envValues?.DOVO_TASK_CREDENTIAL_FILE
  if (!credentialFile) throw new Error('Expected scoped run credential file')
  const credential = decode(
    mutableStruct({ token: Schema.String, runId: Schema.String }),
    JSON.parse(readFileSync(credentialFile, 'utf8')),
  )
  expect(
    (
      await post(
        '/api/do/start',
        { id: plan.id, expectedRevision: s.doRuns.read(plan.id).revision },
        credential.token,
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await post(
        '/api/do/agent',
        { taskId: 'foreign', parentRunId: credential.runId, command: { action: 'list' } },
        credential.token,
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await post(
        '/api/do/agent',
        { taskId, parentRunId: 'stale-run', command: { action: 'list' } },
        credential.token,
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await post('/api/do/agent', {
        taskId,
        parentRunId: credential.runId,
        command: { action: 'list' },
      })
    ).status,
  ).toBe(403)
  const foreign = { ...plan, id: randomUUID() }
  s.doRuns.save(foreign)
  expect(
    (await client.callTool({ name: 'do_plan', arguments: { action: 'read', id: foreign.id } }))
      .isError,
  ).toBe(true)
  expect(s.doRuns.read(plan.id).status).toBe('draft')
  // A lost create reply can be retried without opening a second coordinator.
  const retry = await post('/api/do/chat/create', request)
  expect(await retry.json()).toEqual({ taskId })
  expect(calls).toHaveLength(1)
  // A narrower run grant can inspect proposals but cannot create or stop work.
  const runId = s.store.taskSummary(taskId).activeRunId
  if (!runId) throw new Error('Expected an active coordinator turn')
  const readOnlyToken = s.runCredentials.issue(
    {
      taskId,
      runId,
      permissions: { provider: 'codex', permission: 'read-only' },
      readOnly: true,
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
    },
    new AbortController().signal,
  )
  const scoped = (command: unknown) =>
    post('/api/do/agent', { taskId, parentRunId: runId, command }, readOnlyToken)
  expect((await scoped({ action: 'list' })).status).toBe(200)
  expect((await scoped({ action: 'discover', runtimeId: 'local' })).status).toBe(200)
  expect((await scoped({ action: 'propose', plan: { ...plan, id: randomUUID() } })).status).toBe(
    403,
  )
  expect((await scoped({ action: 'cancel', id: plan.id })).status).toBe(403)
  expect(s.doRuns.read(plan.id).status).toBe('draft')
})
