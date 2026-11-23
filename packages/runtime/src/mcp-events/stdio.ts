import { DiagnosticStdioTransport } from '../mcp-apps/stdio-transport.js'
import { processEnvironment } from '../process.js'
import { mcpServerEnvironment } from '../agents/configuration/mcp-settings.js'
import type { McpServer } from '@dovo/protocol'
import type { McpOutcome } from '@agentclientprotocol/sdk/unstable'

type Request = {
  requestId: string
  method: string
  params: Record<string, unknown>
  signal: AbortSignal
  notify: (method: string, params: unknown) => void
}
type Pending = {
  resolve: (outcome: McpOutcome) => void
  reject: (reason: unknown) => void
  notify: Request['notify']
}

/** One modern stdio transport per source, with notifications routed by parent request ID. */
export class McpEventsStdio {
  private closed = false
  private transport?: DiagnosticStdioTransport
  private opening?: Promise<void>
  private pending = new Map<string, Pending>()

  constructor(
    private server: McpServer,
    private cwd: string,
  ) {}

  get idle() {
    return !this.opening && !this.pending.size
  }

  private async open() {
    if (this.closed) throw new Error('MCP stdio connection was retired; retry the read')
    const current = this.transport
    if (current) {
      await this.opening
      if (this.transport !== current) throw new Error('MCP stdio server closed while connecting')
      return current
    }
    const transport = new DiagnosticStdioTransport({
      command: this.server.command,
      args: this.server.args,
      cwd: this.cwd,
      env: {
        ...Object.fromEntries(
          Object.entries(processEnvironment()).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
        ...mcpServerEnvironment(this.server),
      },
    })
    this.transport = transport
    transport.onclose = () => {
      if (this.transport !== transport) return
      this.transport = undefined
      for (const pending of this.pending.values())
        pending.reject(new Error('MCP stdio server closed'))
    }
    transport.onerror = (error) => {
      if (this.transport !== transport) return
      for (const pending of this.pending.values()) pending.reject(error)
    }
    transport.onmessage = (message) => {
      if (this.transport !== transport) return
      if ('id' in message && ('result' in message || 'error' in message)) {
        if (typeof message.id !== 'string') return
        this.pending
          .get(message.id)
          ?.resolve('result' in message ? { result: message.result } : { error: message.error })
      } else if (
        'method' in message &&
        !('id' in message) &&
        message.method.startsWith('notifications/events/')
      ) {
        const id = (message.params?._meta as Record<string, unknown> | undefined)?.[
          'io.modelcontextprotocol/subscriptionId'
        ]
        if (typeof id !== 'string') return
        const pending = this.pending.get(id)
        try {
          pending?.notify(message.method, message.params)
        } catch (error) {
          pending?.reject(error)
        }
      }
    }
    const opening = transport.start()
    this.opening = opening
    try {
      await opening
      return transport
    } catch (error) {
      await transport.close()
      throw error
    } finally {
      if (this.opening === opening) this.opening = undefined
    }
  }

  async request({ requestId, method, params, signal, notify }: Request) {
    signal.throwIfAborted()
    const transport = await this.open()
    signal.throwIfAborted()
    let cancel = () => {}
    let responded = false
    try {
      const outcome = await new Promise<McpOutcome>((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject, notify })
        cancel = () => {
          reject(signal.reason)
        }
        signal.addEventListener('abort', cancel, { once: true })
        void transport.send({ jsonrpc: '2.0', id: requestId, method, params }).catch(reject)
      })
      responded = true
      return outcome
    } finally {
      this.pending.delete(requestId)
      signal.removeEventListener('abort', cancel)
      // A rejected stream notification also ends the request on a shared connection.
      if (!responded && (signal.aborted || method === 'events/stream'))
        void transport
          .send({
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: { requestId },
          })
          .catch(() => {})
    }
  }

  async close() {
    this.closed = true
    await this.transport?.close()
  }
}
