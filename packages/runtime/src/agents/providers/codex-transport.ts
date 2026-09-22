import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  type DataCallback,
  type Message,
  type NotificationMessage,
} from 'vscode-jsonrpc/node'
import { z } from 'zod'
// Codex uses newline-delimited JSON-RPC rather than LSP Content-Length framing.
export class JsonLineReader extends AbstractMessageReader {
  constructor(private readonly input: Readable) {
    super()
  }
  listen(callback: DataCallback) {
    const lines = createInterface({ input: this.input })
    lines.on('line', (line) => {
      try {
        const value = z
          .object({ jsonrpc: z.string().optional() })
          .passthrough()
          .parse(JSON.parse(line))
        if (value.method === 'serverRequest/resolved') {
          const resolved = z
            .object({ requestId: z.union([z.string(), z.number()]) })
            .parse(value.params)
          // App-server clears requests with this notification, rather than $/cancelRequest.
          const cancellation: NotificationMessage = {
            jsonrpc: '2.0',
            method: '$/cancelRequest',
            params: { id: resolved.requestId },
          }
          callback(cancellation)
        }
        callback({ ...value, jsonrpc: '2.0' })
      } catch (error) {
        this.fireError(error)
      }
    })
    lines.on('close', () => this.fireClose())
    this.input.on('error', (error) => this.fireError(error))
    return { dispose: () => lines.close() }
  }
}
export class JsonLineWriter extends AbstractMessageWriter {
  constructor(private readonly output: Writable) {
    super()
  }
  write(message: Message): Promise<void> {
    return new Promise((resolve, reject) => {
      this.output.write(JSON.stringify(message) + '\n', (error) => {
        if (error) {
          this.fireError(error)
          reject(error)
        } else resolve()
      })
    })
  }
  end() {
    this.output.end()
  }
}
