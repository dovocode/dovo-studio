import { decode, mutableStruct, previewDevicesSchema, previewResultSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { fromJSONSchema } from 'zod'
import type { JSONSchema } from 'zod/v4/core'
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { WebSocket } from 'ws'
import { screenshotPoint } from './screenshot-point.js'

const taskId = process.env.DOVO_TASK_ID
const address = process.env.DOVO_TASK_URL
const token = process.env.DOVO_TASK_TOKEN
if (!taskId || !address || !token)
  throw new Error('Dovo task tools are missing their runtime scope')
const parentRunId = process.env.DOVO_TASK_RUN_ID
const task = taskId
const base = address
const credential = token
const readOnly = process.env.DOVO_TASK_READ_ONLY === '1'
const artifactsEnabled = process.env.DOVO_TASK_ARTIFACTS_ENABLED === '1'
const artifacts = () => {
  if (!artifactsEnabled) throw new Error('Dovo Artifacts is disabled')
}
const terminals = new Set<string>()
const writable = () => {
  if (readOnly) throw new Error('This agent has read-only access to Dovo task tools')
}
const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})
const args = Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
const string = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value
}
const number = (value: unknown, name: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 3840)
    throw new Error(`${name} must be a coordinate from 0 to 3840`)
  return value
}
async function post(path: string, input: unknown): Promise<unknown> {
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  })
  const result: unknown = await response.json()
  if (!response.ok) {
    const message = decode(mutableStruct({ error: Schema.String }), result)
    throw new Error(message.error)
  }
  return result
}
async function socket(path: string, payloads: unknown[], firstMessage = false): Promise<string> {
  const url = new URL(path, base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url)
    const timeout = setTimeout(() => {
      client.terminate()
      reject(new Error('Dovo tool connection timed out'))
    }, 10_000)
    const finish = (value: string) => {
      clearTimeout(timeout)
      client.close()
      resolve(value)
    }
    client.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    client.once('open', () => {
      for (const payload of payloads) client.send(JSON.stringify(payload))
      if (!firstMessage) setTimeout(() => finish('Sent'), 300)
    })
    if (firstMessage)
      client.once('message', (data) =>
        finish(
          (Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data)
          )
            .toString('utf8')
            .slice(-32_000),
        ),
      )
  })
}

const server = new McpServer(
  { name: 'dovo-task', version: '0.1.0' },
  { maxToolInputElements: 10_000 },
)
const tools: Array<
  Omit<Tool, 'inputSchema'> & {
    inputSchema: JSONSchema.JSONSchema & { type: 'object' }
  }
> = [
  {
    name: 'subagent_spawn',
    description:
      'Launch a Dovo child agent on Codex, Claude, OpenCode, or a named configuration (including ACP). It works in this thread’s checkout with its own conversation. Supply all necessary context in prompt. Access cannot exceed the parent. Use a stable key to retry safely. Children are stopped when the parent turn ends; read or wait for results before finishing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string' as const },
        name: { type: 'string' as const },
        prompt: { type: 'string' as const },
        provider: {
          type: 'string' as const,
          enum: ['codex', 'claude', 'opencode', 'hermes', 'copilot', 'grok', 'muse', 'acp'],
        },
        checkoutId: {
          type: 'string' as const,
          description:
            'Optional linked checkout ID from the parent context; use it as the child working directory.',
        },
        agentId: { type: 'string' as const },
        model: { type: 'string' as const },
        reasoning: { type: 'string' as const },
        permission: {
          type: 'string' as const,
          enum: ['read-only', 'ask', 'workspace-write', 'auto', 'full-access'],
        },
      },
      required: ['key', 'name', 'prompt'],
    },
  },
  {
    name: 'subagent_list',
    description:
      'List this thread’s Dovo child agents and named configurations available in its project. Returns metadata only; use read or wait for child answers.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  ...(['read', 'wait', 'cancel'] as const).map((action) => ({
    name: `subagent_${action}`,
    description:
      action === 'wait'
        ? 'Wait up to 20 seconds for a child’s final answer. If still running, wait again. Returns only the answer and status, excluding raw events and tool output.'
        : action === 'read'
          ? 'Read a child’s status and final answer.'
          : 'Stop a child agent belonging to this parent thread.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        ...(action === 'wait'
          ? { timeoutMs: { type: 'integer' as const, minimum: 0, maximum: 20000 } }
          : {}),
      },
      required: ['id'],
    },
  })),
  ...(artifactsEnabled
    ? [
        {
          name: 'artifact_list',
          description: 'List persistent Dovo artifacts in this thread. Returns metadata only.',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        {
          name: 'artifact_read',
          description:
            'Read a Dovo artifact’s content and revision, optionally an earlier revision.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              id: { type: 'string' as const },
              revision: { type: 'integer' as const, minimum: 1 },
            },
            required: ['id'],
          },
        },
      ]
    : []),
  {
    name: 'devices',
    description: 'List iOS and Android devices available to this task.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'device',
    description:
      'Boot, open a URL, launch an app, inspect apps, or take a screenshot. Screenshots are returned as images.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        action: {
          type: 'string' as const,
          enum: [
            'boot',
            'shutdown',
            'open',
            'screenshot',
            'apps',
            'launch',
            'relaunch',
            'portrait',
            'landscape',
            'light',
            'dark',
          ],
        },
        url: { type: 'string' as const },
        bundleId: { type: 'string' as const },
      },
      required: ['id', 'action'],
    },
  },
  ...(!readOnly
    ? [
        ...(artifactsEnabled
          ? [
              {
                name: 'artifact_create',
                description:
                  'Create a persistent artifact in this thread. Dovo shows a preview card on desktop and mobile. Use markdown for documents, html for self-contained interactive pages, svg for diagrams, code for source files. HTML runs in a sandbox without external network access; embed assets and scripts. Returns the artifact ID and revision, not its body.',
                inputSchema: {
                  type: 'object' as const,
                  properties: {
                    title: { type: 'string' as const },
                    format: { type: 'string' as const, enum: ['markdown', 'html', 'svg', 'code'] },
                    content: { type: 'string' as const },
                    language: { type: 'string' as const },
                  },
                  required: ['title', 'format', 'content'],
                },
              },
              {
                name: 'artifact_update',
                description:
                  'Save a new revision of an existing Dovo artifact, keeping earlier versions. Read first and pass expectedRevision to avoid overwriting newer work. Supply its complete title, format and content.',
                inputSchema: {
                  type: 'object' as const,
                  properties: {
                    id: { type: 'string' as const },
                    expectedRevision: { type: 'integer' as const, minimum: 1 },
                    title: { type: 'string' as const },
                    format: { type: 'string' as const, enum: ['markdown', 'html', 'svg', 'code'] },
                    content: { type: 'string' as const },
                    language: { type: 'string' as const },
                  },
                  required: ['id', 'expectedRevision', 'title', 'format', 'content'],
                },
              },
            ]
          : []),
        {
          name: 'simulator_tap',
          description:
            'Tap an open simulator at x,y in screenshot pixels. Physical devices do not support touch here.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              id: { type: 'string' as const },
              x: { type: 'number' as const },
              y: { type: 'number' as const },
            },
            required: ['id', 'x', 'y'],
          },
        },
        {
          name: 'simulator_text',
          description: 'Type into the focused control on an open simulator.',
          inputSchema: {
            type: 'object' as const,
            properties: { id: { type: 'string' as const }, value: { type: 'string' as const } },
            required: ['id', 'value'],
          },
        },
        {
          name: 'terminal_run',
          description:
            'Run an interactive, persistent, or user-visible command in this task’s Dovo terminal and return its terminal ID. Use your normal command tool for quick noninteractive commands.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              command: { type: 'string' as const },
              checkoutId: { type: 'string' as const, description: 'Optional linked checkout ID.' },
            },
            required: ['command'],
          },
        },
        {
          name: 'terminal_close',
          description:
            'Close a terminal opened by this task tool session after its output is no longer needed. Stops a live process and releases its retained output.',
          inputSchema: {
            type: 'object' as const,
            properties: { id: { type: 'string' as const } },
            required: ['id'],
          },
        },
        {
          name: 'terminal_read',
          description: 'Read recent output from a terminal opened by this task tool session.',
          inputSchema: {
            type: 'object' as const,
            properties: { id: { type: 'string' as const } },
            required: ['id'],
          },
        },
        {
          name: 'terminal_input',
          description:
            'Send input to a terminal opened by this task tool session. Use carriage return to submit a line.',
          inputSchema: {
            type: 'object' as const,
            properties: { id: { type: 'string' as const }, data: { type: 'string' as const } },
            required: ['id', 'data'],
          },
        },
      ]
    : []),
]
async function callTool(name: string, arguments_: unknown): Promise<CallToolResult> {
  try {
    const input = decode(args, arguments_ ?? {})
    switch (name) {
      case 'subagent_spawn':
        return text(await post('/api/subagents/spawn', { ...input, taskId: task, parentRunId }))
      case 'subagent_list':
        return text(await post('/api/subagents/list', { taskId: task }))
      case 'subagent_read':
      case 'subagent_wait':
      case 'subagent_cancel':
        return text(
          await post(`/api/subagents/${name.slice('subagent_'.length)}`, {
            id: string(input.id, 'id'),
            timeoutMs: input.timeoutMs,
            taskId: task,
          }),
        )
      case 'artifact_list':
        artifacts()
        return text(await post('/api/artifacts/list', { taskId: task }))
      case 'artifact_read':
        artifacts()
        return text(
          await post('/api/artifacts/read', {
            taskId: task,
            id: input.id,
            revision: input.revision,
          }),
        )
      case 'artifact_create':
      case 'artifact_update':
        artifacts()
        writable()
        return text(
          await post(
            name === 'artifact_create' ? '/api/artifacts/create' : '/api/artifacts/update',
            { ...input, taskId: task, parentRunId },
          ),
        )
      case 'devices':
        return text(
          decode(previewDevicesSchema, await post('/api/previews/devices', { taskId: task })),
        )
      case 'device': {
        const id = string(input.id, 'id')
        const action = string(input.action, 'action')
        if (
          ![
            'boot',
            'shutdown',
            'open',
            'screenshot',
            'apps',
            'launch',
            'relaunch',
            'portrait',
            'landscape',
            'light',
            'dark',
          ].includes(action)
        )
          throw new Error('Unsupported device action')
        if (action !== 'screenshot' && action !== 'apps') writable()
        const result = decode(
          previewResultSchema,
          await post('/api/previews/action', {
            taskId: task,
            id,
            action,
            ...(input.url === undefined ? {} : { url: string(input.url, 'url') }),
            ...(input.bundleId === undefined
              ? {}
              : { bundleId: string(input.bundleId, 'bundleId') }),
          }),
        )
        if (result.image)
          return {
            content: [
              {
                type: 'image' as const,
                data: result.image.replace(/^data:image\/png;base64,/, ''),
                mimeType: 'image/png',
              },
            ],
          }
        return text(result)
      }
      case 'simulator_tap':
      case 'simulator_text': {
        writable()
        const id = string(input.id, 'id')
        if (!id.startsWith('ios:') && !id.startsWith('android:'))
          throw new Error('Choose a simulator device')
        const opened = decode(
          mutableStruct({
            id: Schema.String,
            screenPoints: Schema.optional(
              mutableStruct({ width: Schema.Number, height: Schema.Number }),
            ),
          }),
          await post('/api/previews/simulator/open', { taskId: task, id }),
        )
        if (name === 'simulator_text')
          return text(
            await post('/api/previews/simulator/input', {
              taskId: task,
              id: opened.id,
              input: { type: 'text', text: string(input.value, 'value') },
            }),
          )
        const screenshotX = number(input.x, 'x')
        const screenshotY = number(input.y, 'y')
        let point = { x: screenshotX / 2, y: screenshotY / 2 }
        if (id.startsWith('ios:')) {
          if (!opened.screenPoints) throw new Error('Simulator point dimensions are unavailable')
          const screenshot = decode(
            previewResultSchema,
            await post('/api/previews/action', { taskId: task, id, action: 'screenshot' }),
          )
          if (!screenshot.image) throw new Error('Simulator screenshot is unavailable')
          point = screenshotPoint(screenshot.image, opened.screenPoints, screenshotX, screenshotY)
        }
        const { x, y } = point
        await post('/api/previews/simulator/input', {
          taskId: task,
          id: opened.id,
          input: { type: 'pointer', phase: 'down', pointerType: 'touch', x, y },
        })
        return text(
          await post('/api/previews/simulator/input', {
            taskId: task,
            id: opened.id,
            input: { type: 'pointer', phase: 'up', pointerType: 'touch', x, y },
          }),
        )
      }
      case 'terminal_run': {
        writable()
        const terminal = decode(
          mutableStruct({ id: Schema.String }),
          await post('/api/terminals/run', {
            taskId: task,
            command: string(input.command, 'command'),
            ...(typeof input.checkoutId === 'string' ? { checkoutId: input.checkoutId } : {}),
            newTerminal: true,
          }),
        )
        terminals.add(terminal.id)
        return text(terminal)
      }
      case 'terminal_close': {
        writable()
        const id = string(input.id, 'id')
        if (!terminals.has(id)) throw new Error('Open this task terminal with terminal_run first')
        const result = await post('/api/terminals/close', { id })
        terminals.delete(id)
        return text(result)
      }
      case 'terminal_read':
      case 'terminal_input': {
        if (name === 'terminal_input') writable()
        const id = string(input.id, 'id')
        if (!terminals.has(id)) throw new Error('Open this task terminal with terminal_run first')
        const ticket = decode(
          mutableStruct({ ticket: Schema.String }),
          await post('/api/terminals/ticket', { id }),
        )
        const path = `/ws/terminal?ticket=${encodeURIComponent(ticket.ticket)}`
        return text(
          await socket(
            path,
            name === 'terminal_input' ? [{ type: 'input', data: string(input.data, 'data') }] : [],
            name === 'terminal_read',
          ),
        )
      }
      default:
        throw new Error('Unknown task tool')
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    }
  }
}
for (const tool of tools)
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: fromJSONSchema(tool.inputSchema) },
    (input) => callTool(tool.name, input),
  )
await server.connect(new StdioServerTransport())
