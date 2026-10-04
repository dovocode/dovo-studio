import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import {
  createMessageConnection,
  ResponseError,
  ErrorCodes,
  Message,
  type DataCallback,
} from 'vscode-jsonrpc/node'
import { JsonLineReader, JsonLineWriter } from '../codex/codex-transport.js'
import { stopOwnedChild } from '../../execution/stop-owned-child.js'
import { processEnvironment } from '../../../process.js'
import type { AgentDiscovery } from '@dovo/protocol'
import { hermesLaunch } from './hermes-launch.js'

export function openHermesConnection(
  agent: AgentDiscovery,
  cwd: string,
  managedDirectory?: string,
) {
  const launch = hermesLaunch(agent)
  const child = spawn(launch.command, launch.args, {
    cwd,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: processEnvironment({
      ...launch.env,
      ...(managedDirectory ? { HERMES_MANAGED_DIR: managedDirectory } : {}),
      // An inherited yolo flag must not silently bypass Dovo approvals.
      HERMES_YOLO_MODE: '0',
    }),
  })
  const controller = new AbortController()
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (text: string) => {
    stderr = (stderr + text).slice(-4000)
  })
  // Same wire framing as Codex, with a bounded frame before readline allocates a line.
  let bytes = 0
  const input = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      for (let start = 0; start < chunk.length;) {
        const newline = chunk.indexOf(10, start)
        const end = newline < 0 ? chunk.length : newline + 1
        bytes += end - start
        if (bytes > 32 * 1024 * 1024)
          return callback(new Error('Hermes gateway frame exceeds 32 MiB'))
        if (newline >= 0) bytes = 0
        start = end
      }
      callback(null, chunk)
    },
  })
  class GatewayReader extends JsonLineReader {
    listen(callback: DataCallback) {
      return super.listen((message) => {
        const forwarded =
          Message.isRequest(message) && message.params && !Array.isArray(message.params)
            ? { ...message, params: { ...message.params, dovo_request_id: String(message.id) } }
            : message
        callback(forwarded)
      })
    }
  }
  const rpc = createMessageConnection(new GatewayReader(input), new JsonLineWriter(child.stdin))
  const fail = (error: Error) => {
    if (!controller.signal.aborted) controller.abort(error)
    rpc.dispose()
  }
  input.on('error', fail)
  child.stdout.on('error', fail).pipe(input)
  child.on('error', fail)
  child.on('exit', (code) => fail(new Error(`Hermes gateway exited (${code}). ${stderr}`.trim())))
  rpc.onError(([error]) => fail(error))
  rpc.onClose(() => fail(new Error('Hermes gateway connection closed')))
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const events: { handle?: (value: unknown) => void } = {}
  const requests: {
    handle?: (method: string, params: unknown, frameId: string) => Promise<unknown>
  } = {}
  rpc.onNotification('event', (value: unknown) => {
    if (value && typeof value === 'object' && 'type' in value && value.type === 'gateway.ready')
      resolveReady()
    events.handle?.(value)
  })
  rpc.onRequest((method, params: unknown) => {
    if (!requests.handle)
      throw new ResponseError(
        ErrorCodes.MethodNotFound,
        `Dovo does not support Hermes request ${method}`,
      )
    const frameId =
      params &&
      typeof params === 'object' &&
      'dovo_request_id' in params &&
      typeof params.dovo_request_id === 'string'
        ? params.dovo_request_id
        : ''
    return requests.handle(method, params, frameId)
  })
  rpc.listen()
  const wait = <T>(value: Promise<T>, signal?: AbortSignal, timeout?: number): Promise<T> => {
    const combined = AbortSignal.any([
      controller.signal,
      ...(signal ? [signal] : []),
      ...(timeout ? [AbortSignal.timeout(timeout)] : []),
    ])
    return new Promise((resolve, reject) => {
      const abort = () => reject(combined.reason)
      if (combined.aborted) {
        void value.catch(() => {})
        abort()
        return
      }
      combined.addEventListener('abort', abort, { once: true })
      value.then(resolve, reject).finally(() => combined.removeEventListener('abort', abort))
    })
  }
  return {
    signal: controller.signal,
    events,
    requests,
    ready: (signal?: AbortSignal) => wait(ready, signal, 30000),
    request: (method: string, params: object, signal?: AbortSignal, timeout?: number) =>
      wait(rpc.sendRequest<unknown>(method, params), signal, timeout),
    close: async () => {
      fail(new Error('Hermes gateway closed'))
      await stopOwnedChild(child)
    },
  }
}
