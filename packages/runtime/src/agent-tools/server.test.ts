import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startRuntime } from '../index.js'
import { taskToolsServer } from './config.js'
import * as previews from '../previews/devices.js'
import * as native from '../previews/simulator-native.js'
import { decode, artifactWriteResponseSchema, artifactResponseSchema } from '@dovo/protocol'
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
