import { createHash, randomUUID } from 'node:crypto'
import { ToolSchema, CallToolResultSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { HttpError } from '../errors.js'
import { object } from './resources.js'

type Scope = { taskId: string; server: { name: string } }
type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  cleanup: () => void
}
type View = {
  taskId: string
  appId: string
  server: string
  title: string
  tools: Map<string, Tool>
  pending: Map<string, Pending>
  send: (value: unknown) => void
  authorize: () => void
  close: () => void
}
export const appViewTools: Tool[] = [
  {
    name: 'dovo_app_list_tools',
    description:
      'List read-only tools exposed by currently open MCP Apps in this thread and server. Call this again after the user opens or closes an app.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'dovo_app_call_tool',
    description:
      'Read live app state using a tool name and arguments returned by dovo_app_list_tools. Only connected, read-only app tools are available.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, arguments: { type: 'object' } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
]
/** Live read-only tools belong to the open view, never persisted or shared between threads. */
export class AppToolViews {
  private views = new Map<string, View>()
  attach(
    scope: { taskId: string; appId: string; server: string; title: string },
    send: (value: unknown) => void,
    authorize: () => void,
    disconnected: () => void,
  ) {
    authorize()
    const viewId = randomUUID()
    if (this.views.size >= 64) throw new HttpError(429, 'Too many open MCP Apps')
    const view: View = {
      ...scope,
      send,
      authorize,
      tools: new Map(),
      pending: new Map(),
      close: () => {},
    }
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      this.views.delete(viewId)
      for (const entry of view.pending.values()) {
        entry.cleanup()
        entry.reject(new HttpError(409, 'MCP App view disconnected'))
      }
      view.pending.clear()
      disconnected()
    }
    view.close = close
    this.views.set(viewId, view)
    return {
      close,
      receive: (input: unknown) => {
        if (closed) return
        authorize()
        if (Buffer.byteLength(JSON.stringify(input)) > 128 * 1024)
          throw new HttpError(413, 'MCP App message too large')
        const value = object(input)
        if (value.type === 'tools') {
          if (
            !Array.isArray(value.tools) ||
            value.tools.length > 32 ||
            JSON.stringify(value.tools).length > 65536
          )
            throw new HttpError(400, 'Invalid MCP App tools')
          const tools = ToolSchema.array().parse(value.tools)
          const next = new Map<string, Tool>()
          for (const tool of tools) {
            if (
              tool.annotations?.readOnlyHint !== true ||
              tool.annotations.destructiveHint === true
            )
              continue
            if (!tool.name || tool.name.length > 128)
              throw new HttpError(400, 'Invalid MCP App tool name')
            const name = `dovo_app_${scope.appId.replaceAll('-', '')}_${createHash('sha256').update(tool.name).digest('hex').slice(0, 12)}`
            if (next.has(name)) throw new HttpError(400, 'Duplicate MCP App tool')
            next.set(name, tool)
          }
          view.tools = next
        } else if (value.type === 'result' && typeof value.requestId === 'string') {
          const entry = view.pending.get(value.requestId)
          if (!entry) return
          view.pending.delete(value.requestId)
          entry.cleanup()
          if (typeof value.error === 'string')
            entry.reject(new HttpError(502, value.error.slice(0, 2000)))
          else {
            const result = CallToolResultSchema.safeParse(value.result)
            if (result.success) entry.resolve(result.data)
            else entry.reject(new HttpError(502, 'Invalid MCP App tool result'))
          }
        }
      },
    }
  }
  private activeViews(scope: Scope) {
    const latest = new Map<string, View>()
    for (const view of this.views.values())
      if (view.taskId === scope.taskId && view.server === scope.server.name)
        latest.set(view.appId, view)
    return [...latest.values()]
  }
  list(scope: Scope): Tool[] {
    const tools: Tool[] = []
    for (const view of this.activeViews(scope)) {
      try {
        view.authorize()
      } catch {
        view.close()
        continue
      }
      for (const [name, tool] of view.tools)
        tools.push({
          ...tool,
          name,
          title: `${view.title} · ${tool.title ?? tool.name}`,
          description: `Read live state from the open ${view.title} app. ${tool.description ?? ''}`,
        })
    }
    return tools
  }
  async call(scope: Scope, name: string, args: unknown, signal: AbortSignal) {
    const view = this.activeViews(scope).find((entry) => entry.tools.has(name))
    const tool = view?.tools.get(name)
    if (!view || !tool)
      throw new HttpError(
        409,
        'MCP App tool is no longer available; reopen the app and list tools again',
      )
    view.authorize()
    signal.throwIfAborted()
    if (view.pending.size >= 16) throw new HttpError(429, 'MCP App tools are busy')
    if (Buffer.byteLength(JSON.stringify(args)) > 64 * 1024)
      throw new HttpError(413, 'MCP App tool arguments too large')
    const requestId = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const cancel = (error: Error) => {
        if (!view.pending.delete(requestId)) return
        cleanup()
        reject(error)
        try {
          view.send({ type: 'cancel', requestId })
        } catch {
          view.close()
        }
      }
      const abort = () => cancel(new HttpError(409, 'MCP App tool call cancelled'))
      const timer = setTimeout(() => cancel(new HttpError(504, 'MCP App tool timed out')), 30000)
      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
      }
      view.pending.set(requestId, { resolve, reject, cleanup })
      signal.addEventListener('abort', abort, { once: true })
      try {
        view.send({ type: 'call', requestId, name: tool.name, arguments: args })
      } catch (error) {
        view.pending.delete(requestId)
        cleanup()
        reject(error)
      }
    })
  }
  cancelTask(taskId: string) {
    for (const view of this.views.values()) if (view.taskId === taskId) view.close()
  }
  dispose() {
    for (const view of this.views.values()) view.close()
  }
}
