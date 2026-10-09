import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import type { AgentAdapter } from '../agents/execution/types.js'
import { Schema } from 'effect'
import { taskToolsServer } from './config.js'
import * as previews from '../previews/devices.js'
import * as native from '../previews/simulator-native.js'
import {
  decode,
  mutableStruct,
  artifactWriteResponseSchema,
  artifactResponseSchema,
  pullDetailSchema,
} from '@dovo/protocol'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'

afterEach(() => vi.restoreAllMocks())

it('offers task-scoped simulator controls through a provider MCP connection', async () => {
  const token = 'task-tools-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const client = new Client({ name: 'task-tools-test', version: '1.0.0' })
  let transport: StdioClientTransport | undefined
  try {
    runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'task',
          title: 'Tool test',
          repositoryId: 'repo',
          agentId: '',
          status: 'draft',
          createdAt: new Date().toISOString(),
          messages: [],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    vi.spyOn(previews, 'previewDevices').mockResolvedValue({
      host: 'Test Mac',
      devices: [],
      diagnostics: [],
    })
    const action = vi
      .spyOn(previews, 'previewDeviceAction')
      .mockResolvedValue({ ok: true, image: 'data:image/png;base64,aGVsbG8=' })
    runtime.services.preferences.save({ enableArtifacts: true })
    const server = taskToolsServer('task', runtime.port, token, '127.0.0.1', false, true)
    transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, value]],
          ),
        ),
        ...server.envValues,
      },
      stderr: 'ignore',
    })
    await client.connect(transport)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('terminal_run')
    expect((await client.callTool({ name: 'devices' })).isError).not.toBe(true)
    const invalid = await client.callTool({ name: 'device', arguments: { id: 3, action: 'boot' } })
    expect(invalid.isError).toBe(true)
    expect(action).not.toHaveBeenCalled()
    const oversized = await client.callTool({
      name: 'devices',
      arguments: { values: Array.from({ length: 10_001 }, () => 0) },
    })
    expect(oversized.isError).toBe(true)
    expect(decodeToolText(oversized)).toContain('10000 elements')
    expect((await client.callTool({ name: 'devices' })).isError).not.toBe(true)
    const scopedChildren = await client.callTool({
      name: 'subagent_list',
      arguments: { taskId: 'another-thread' },
    })
    expect(JSON.parse(decodeToolText(scopedChildren))).toMatchObject({ agents: [] })
    const idleSpawn = await client.callTool({
      name: 'subagent_spawn',
      arguments: {
        key: 'idle',
        name: 'Idle',
        prompt: 'Inspect',
        provider: 'claude',
        taskId: 'another-thread',
      },
    })
    expect(idleSpawn.isError).toBe(true)
    expect(decodeToolText(idleSpawn)).toContain('active parent turn')
    expect((await client.callTool({ name: 'devices', arguments: {} })).content).toEqual([
      { type: 'text', text: JSON.stringify({ host: 'Test Mac', devices: [], diagnostics: [] }) },
    ])
    const screenshot = await client.callTool({
      name: 'device',
      arguments: { id: 'ios:test', action: 'screenshot' },
    })
    expect(screenshot.content).toEqual([{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }])
    expect(action).toHaveBeenCalledWith({ taskId: 'task', id: 'ios:test', action: 'screenshot' })
    const created = await client.callTool({
      name: 'artifact_create',
      arguments: {
        title: 'Notes',
        format: 'markdown',
        content: '# Persisted notes',
        taskId: 'another-thread',
      },
    })
    const result = decode(artifactWriteResponseSchema, JSON.parse(decodeToolText(created)))
    expect(result.artifact.taskId).toBe('task')
    expect(runtime.services.artifacts.read('task', result.artifact.id).content).toBe(
      '# Persisted notes',
    )
    const read = await client.callTool({
      name: 'artifact_read',
      arguments: { id: result.artifact.id },
    })
    expect(decode(artifactResponseSchema, JSON.parse(decodeToolText(read))).artifact.revision).toBe(
      1,
    )
  } finally {
    await client.close()
    await transport?.close()
    await runtime.close()
  }
})
function decodeToolText(result: Awaited<ReturnType<Client['callTool']>>) {
  const item = CallToolResultSchema.parse(result).content.find((item) => item.type === 'text')
  if (!item || item.type !== 'text') throw new Error('Expected a text result')
  return item.text
}

it('taps the point corresponding to a full-resolution iOS screenshot', async () => {
  const token = 'task-tools-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const client = new Client({ name: 'task-tap-test', version: '1.0.0' })
  let transport: StdioClientTransport | undefined
  try {
    runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'task',
          title: 'Tap test',
          repositoryId: 'repo',
          agentId: '',
          status: 'draft',
          createdAt: new Date().toISOString(),
          messages: [],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    vi.spyOn(previews, 'previewDevices').mockResolvedValue({
      host: 'Test Mac',
      diagnostics: [],
      devices: [
        { id: 'ios:test', name: 'iPhone', platform: 'ios', state: 'booted', runtime: 'iOS' },
      ],
    })
    const png = Buffer.alloc(24)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
    png.writeUInt32BE(1179, 16)
    png.writeUInt32BE(2556, 20)
    vi.spyOn(previews, 'previewDeviceAction').mockResolvedValue({
      ok: true,
      image: `data:image/png;base64,${png.toString('base64')}`,
    })
    const input = vi.fn<native.NativeSimulator['input']>(async () => {})
    vi.spyOn(native, 'iosSimulator').mockResolvedValue({
      screenPoints: () => ({ width: 393, height: 852 }),
      input,
      start: () => () => {},
      release: async () => {},
      close: async () => {},
    })
    const server = taskToolsServer('task', runtime.port, token, '127.0.0.1')
    transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, value]],
          ),
        ),
        ...server.envValues,
      },
      stderr: 'ignore',
    })
    await client.connect(transport)
    const result = await client.callTool({
      name: 'simulator_tap',
      arguments: { id: 'ios:test', x: 600, y: 1200 },
    })
    expect(result.isError).not.toBe(true)
    expect(input.mock.calls.map(([value]) => value)).toEqual([
      { type: 'pointer', phase: 'down', pointerType: 'touch', button: 'left', x: 200, y: 400 },
      { type: 'pointer', phase: 'up', pointerType: 'touch', button: 'left', x: 200, y: 400 },
    ])
  } finally {
    await client.close()
    await transport?.close()
    await runtime.close()
  }
})

it('keeps read-only providers from sending task terminal or device input', async () => {
  const server = taskToolsServer('task', 1, 'unused-token', '127.0.0.1', true, true)
  const client = new Client({ name: 'read-only-test', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: { ...server.envValues },
    stderr: 'ignore',
  })
  try {
    await client.connect(transport)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'subagent_spawn',
      'subagent_list',
      'subagent_read',
      'subagent_wait',
      'subagent_cancel',
      'artifact_list',
      'artifact_read',
      'devices',
      'device',
    ])
    expect(
      (
        await client.callTool({
          name: 'artifact_create',
          arguments: { title: 'Blocked', format: 'html', content: '<h1>Blocked</h1>' },
        })
      ).isError,
    ).toBe(true)
    expect(
      (await client.callTool({ name: 'terminal_run', arguments: { command: 'echo unsafe' } }))
        .isError,
    ).toBe(true)
    expect(
      (await client.callTool({ name: 'device', arguments: { id: 'ios:test', action: 'boot' } }))
        .isError,
    ).toBe(true)
  } finally {
    await client.close()
    await transport.close()
  }
})

it('does not advertise or execute artifacts unless explicitly enabled', async () => {
  const server = taskToolsServer('task', 1, 'unused-token', '127.0.0.1')
  const client = new Client({ name: 'disabled-artifacts-test', version: '1' })
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: { ...server.envValues },
    stderr: 'ignore',
  })
  try {
    await client.connect(transport)
    expect((await client.listTools()).tools.some((tool) => tool.name.startsWith('artifact_'))).toBe(
      false,
    )
    expect(
      (await client.listTools()).tools.some((tool) => tool.name === 'pull_request_watch'),
    ).toBe(false)
    expect(
      (
        await client.callTool({
          name: 'artifact_create',
          arguments: { title: 'Blocked', format: 'markdown', content: 'Blocked' },
        })
      ).isError,
    ).toBe(true)
    expect(
      (await client.callTool({ name: 'artifact_read', arguments: { id: 'blocked' } })).isError,
    ).toBe(true)
  } finally {
    await client.close()
    await transport.close()
  }
})

it('registers a project-scoped PR watch through MCP and immediately rejects old sessions when disabled', async () => {
  const f = await fixture()
  const token = 'pr-watch-mcp-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const s = runtime.services
  const client = new Client({ name: 'pr-watch-test', version: '1' })
  let transport: StdioClientTransport | undefined
  try {
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'PR',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
    })
    const url = 'https://github.com/team/project/pull/7'
    const read = vi.spyOn(s.pullCache, 'feedback').mockResolvedValue(
      decode(pullDetailSchema, {
        pull: {
          number: 7,
          title: 'PR',
          url,
          state: 'open',
          draft: false,
          author: 'me',
          updatedAt: '2026-10-07',
          head: 'fix',
          base: 'main',
          labels: [],
          repositoryUrl: 'https://github.com/team/project',
          headSha: 'a'.repeat(40),
          baseSha: 'b'.repeat(40),
          body: '',
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          mergeable: true,
          reviewers: [],
          assignees: [],
        },
        comments: [],
        checks: [],
        files: [],
        warnings: [],
      }),
    )
    s.preferences.save({ enablePullRequestWatching: true })
    const server = taskToolsServer(
      task.id,
      runtime.port,
      token,
      '127.0.0.1',
      false,
      false,
      undefined,
      true,
    )
    transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...server.envValues },
      stderr: 'ignore',
    })
    await client.connect(transport)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      'pull_request_watch',
    )
    const watch = await client.callTool({
      name: 'pull_request_watch',
      arguments: { action: 'watch', url, taskId: 'another-thread' },
    })
    expect(watch.isError).not.toBe(true)
    expect(JSON.parse(decodeToolText(watch))).toMatchObject({
      watch: { number: 7, url, status: 'watching' },
      failedChecks: [],
    })
    expect(read).toHaveBeenCalledWith(f.directory, 7, true)
    expect(s.db.prepare('SELECT task_id FROM task_pull_watches').all()).toEqual([
      { task_id: task.id },
    ])
    expect(
      (await client.callTool({ name: 'pull_request_watch', arguments: { action: 'watch' } }))
        .isError,
    ).toBe(true)
    expect(
      (await client.callTool({ name: 'pull_request_watch', arguments: { action: 'invalid' } }))
        .isError,
    ).toBe(true)
    expect(
      JSON.parse(
        decodeToolText(
          await client.callTool({ name: 'pull_request_watch', arguments: { action: 'stop' } }),
        ),
      ),
    ).toMatchObject({ watch: { status: 'stopped' } })
    s.preferences.save({ enablePullRequestWatching: false })
    const disabled = await client.callTool({
      name: 'pull_request_watch',
      arguments: { action: 'watch', url },
    })
    expect(disabled.isError).toBe(true)
    expect(decodeToolText(disabled)).toContain('Enable the experimental PR feedback watcher')
    const unauthenticated = await fetch(`http://127.0.0.1:${runtime.port}/api/pull-request-watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id, action: 'status' }),
    })
    expect(unauthenticated.status).toBe(401)
    const pairedToken = 'paired-pr-watch-test-token'
    s.devices.add('Test phone', pairedToken)
    s.preferences.save({ enablePullRequestWatching: true })
    const paired = await fetch(`http://127.0.0.1:${runtime.port}/api/pull-request-watch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pairedToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id, action: 'watch', url }),
    })
    expect(paired.status).toBe(403)
    s.store.update((workspace) => ({
      ...workspace,
      agents: workspace.agents.map((agent) => ({ ...agent, permission: 'read-only' })),
    }))
    const readOnly = await client.callTool({
      name: 'pull_request_watch',
      arguments: { action: 'watch', url },
    })
    expect(readOnly.isError).toBe(true)
    expect(decodeToolText(readOnly)).toContain('read-only threads')
  } finally {
    await client.close()
    await transport?.close()
    await runtime.close()
    await f.cleanup()
  }
})

it('does not advertise the PR watcher in read-only harnesses, even with the flag enabled', async () => {
  const server = taskToolsServer(
    'task',
    1,
    'unused-token',
    '127.0.0.1',
    true,
    false,
    undefined,
    true,
  )
  const client = new Client({ name: 'readonly-pr-watch-test', version: '1' })
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: { ...server.envValues },
    stderr: 'ignore',
  })
  try {
    await client.connect(transport)
    expect(
      (await client.listTools()).tools.some((tool) => tool.name === 'pull_request_watch'),
    ).toBe(false)
    expect(
      (
        await client.callTool({
          name: 'pull_request_watch',
          arguments: { action: 'watch', url: 'https://github.com/a/b/pull/7' },
        })
      ).isError,
    ).toBe(true)
  } finally {
    await client.close()
    await transport.close()
  }
})

it('launches and receives a cross-harness child through the real task MCP server', async () => {
  const f = await fixture()
  const token = 'task-tools-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        if (run.agent.provider === 'claude') {
          run.onText('Answer from Claude')
          return
        }
        if (!run.taskId) throw new Error('Expected a parent task')
        const configuration = taskToolsServer(
          run.taskId,
          runtime.port,
          token,
          '127.0.0.1',
          false,
          false,
          s.store.task(run.taskId).activeRunId,
        )
        const client = new Client({ name: 'parent-tools-test', version: '1.0.0' })
        const transport = new StdioClientTransport({
          command: configuration.command,
          args: configuration.args,
          env: { ...configuration.envValues },
          stderr: 'ignore',
        })
        try {
          await client.connect(transport)
          const spawned = await client.callTool({
            name: 'subagent_spawn',
            arguments: {
              key: 'review',
              name: 'Review',
              prompt: 'Review current files',
              provider: 'claude',
              taskId: 'forged-parent',
              parentRunId: 'forged-attempt',
            },
          })
          const { id } = decode(
            mutableStruct({ id: Schema.String }),
            JSON.parse(decodeToolText(spawned)),
          )
          expect(s.store.task(id).delegation?.parentTaskId).toBe(run.taskId)
          const waited = await client.callTool({
            name: 'subagent_wait',
            arguments: { id, timeoutMs: 20000 },
          })
          expect(JSON.parse(decodeToolText(waited))).toMatchObject({
            id,
            running: false,
            status: 'review',
            result: 'Answer from Claude',
          })
          const list = await client.callTool({ name: 'subagent_list', arguments: {} })
          expect(JSON.parse(decodeToolText(list))).toMatchObject({
            agents: [{ id, status: 'review' }],
          })
          run.onText('Received the child answer')
        } finally {
          await client.close()
          await transport.close()
        }
      },
    })
    const parent = s.tasks.create({
      title: 'Parent',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Delegate review',
    })
    await (
      await s.tasks.start(parent.id)
    ).done
    expect(s.store.task(parent.id).status).toBe('review')
  } finally {
    await runtime.close()
    await f.cleanup()
  }
}, 30000)

it('isolates agent commands from the user shell and closes only terminals opened by that tool session', async () => {
  const f = await fixture()
  const token = 'terminal-cleanup-owner-token-with-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const client = new Client({ name: 'terminal-cleanup-test', version: '1' })
  let transport: StdioClientTransport | undefined
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'Terminal',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: '',
    })
    const user = s.terminals.create(task.id, f.directory)
    const input = vi.spyOn(s.terminals, 'input')
    const config = taskToolsServer(task.id, runtime.port, token, '127.0.0.1')
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
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('terminal_close')
    const opened = await client.callTool({
      name: 'terminal_run',
      arguments: { command: 'printf tool-output' },
    })
    const { id } = decode(mutableStruct({ id: Schema.String }), JSON.parse(decodeToolText(opened)))
    expect(id).not.toBe(user.id)
    expect(input.mock.calls.every(([target]) => target === id)).toBe(true)
    expect(
      (await client.callTool({ name: 'terminal_close', arguments: { id: user.id } })).isError,
    ).toBe(true)
    expect((await client.callTool({ name: 'terminal_close', arguments: { id } })).isError).not.toBe(
      true,
    )
    expect(s.terminals.list().map((terminal) => terminal.id)).toEqual([user.id])
  } finally {
    await client.close()
    await transport?.close()
    await runtime.close()
    await f.cleanup()
  }
}, 15000)

it('offers pipeline watches beside PR watches, scopes IDs and enforces runtime opt-in and authentication', async () => {
  const f = await fixture()
  const token = 'pipeline-tools-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const client = new Client({ name: 'pipeline-watch-test', version: '1' })
  let transport: StdioClientTransport | undefined
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'Watch runs',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
    })
    const read = vi
      .spyOn(s.forgeWork, 'request')
      .mockImplementation(async (_repo, _operation, input) => {
        const { id } = decode(mutableStruct({ id: Schema.String }), input)
        return {
          run: {
            id,
            title: 'Build',
            url: `https://github.com/team/project/actions/runs/${id}`,
            ref: 'main',
            sha: 'a'.repeat(40),
            actor: 'author',
            status: 'running',
            createdAt: '',
            updatedAt: '',
          },
          jobs: [],
          cachedAt: new Date().toISOString(),
        }
      })
    s.preferences.save({ enablePipelineWatching: true, enablePullRequestWatching: true })
    const server = taskToolsServer(
      task.id,
      runtime.port,
      token,
      '127.0.0.1',
      false,
      false,
      undefined,
      true,
      true,
    )
    transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...server.envValues },
      stderr: 'ignore',
    })
    await client.connect(transport)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['pipeline_watch', 'pull_request_watch']),
    )
    const result = await client.callTool({
      name: 'pipeline_watch',
      arguments: { action: 'watch', runIds: ['7', '8'], taskId: 'another' },
    })
    expect(result.isError).not.toBe(true)
    expect(JSON.parse(decodeToolText(result))).toMatchObject({
      watches: [
        { runId: '7', status: 'watching' },
        { runId: '8', status: 'watching' },
      ],
    })
    expect(read).toHaveBeenCalledWith('repo', 'pipelines/detail', { id: '7', refresh: true })
    expect(s.db.prepare('SELECT DISTINCT task_id FROM task_pipeline_watches').all()).toEqual([
      { task_id: task.id },
    ])
    for (const arguments_ of [
      { action: 'watch' },
      { action: 'watch', runIds: [] },
      { action: 'watch', runIds: [7] },
      { action: 'invalid' },
    ]) {
      expect(
        (await client.callTool({ name: 'pipeline_watch', arguments: arguments_ })).isError,
      ).toBe(true)
    }
    s.preferences.save({ enablePipelineWatching: false })
    expect(
      decodeToolText(
        await client.callTool({ name: 'pipeline_watch', arguments: { action: 'status' } }),
      ),
    ).toContain('Enable the experimental pipeline watcher')
    expect(
      (
        await fetch(`http://127.0.0.1:${runtime.port}/api/pipeline-watch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, action: 'status' }),
        })
      ).status,
    ).toBe(401)
    const pairedToken = 'paired-pipeline-watch-test-token'
    s.devices.add('Paired phone', pairedToken)
    expect(
      (
        await fetch(`http://127.0.0.1:${runtime.port}/api/pipeline-watch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pairedToken}` },
          body: JSON.stringify({ taskId: task.id, action: 'status' }),
        })
      ).status,
    ).toBe(403)
  } finally {
    await client.close()
    await transport?.close()
    await runtime.close()
    await f.cleanup()
  }
})

it.each([
  { readOnly: true, enabled: true },
  { readOnly: false, enabled: false },
])('hides pipeline watches when access or opt-in is absent: %j', async ({ readOnly, enabled }) => {
  const server = taskToolsServer(
    'task',
    1,
    'unused-token',
    '127.0.0.1',
    readOnly,
    false,
    undefined,
    false,
    enabled,
  )
  const client = new Client({ name: 'pipeline-gating-test', version: '1' })
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: { ...server.envValues },
    stderr: 'ignore',
  })
  try {
    await client.connect(transport)
    expect((await client.listTools()).tools.some((tool) => tool.name === 'pipeline_watch')).toBe(
      false,
    )
    expect(
      (
        await client.callTool({
          name: 'pipeline_watch',
          arguments: { action: 'watch', runIds: ['7'] },
        })
      ).isError,
    ).toBe(true)
  } finally {
    await client.close()
    await transport.close()
  }
})
