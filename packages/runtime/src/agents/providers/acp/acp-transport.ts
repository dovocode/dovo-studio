import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk/unstable'
import { processEnvironment } from '../../../process.js'
import { stopAcpChild } from './acp-process.js'
import type { AcpLaunch } from '../../execution/types.js'

// Keep the SDK's default explicit. Large image prompts remain supported.
export const ACP_MAX_MESSAGE_BYTES = 32 * 1024 * 1024

type Lifecycle = { signal: AbortSignal; closed: Promise<void>; close: () => void }

/** Both protocols share framing and owned-process cleanup, never their wire handlers. */
export function openAcpTransport<T extends Lifecycle>(
  launch: AcpLaunch,
  connect: (stream: Stream) => T,
  cwd?: string,
  signal?: AbortSignal,
  onStderr?: (text: string) => void,
) {
  signal?.throwIfAborted()
  const env = { ...processEnvironment(), ...launch.env }
  delete env.DOVO_OWNER_TOKEN
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(launch.command, launch.args, {
    windowsHide: true,
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (onStderr) {
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', onStderr)
  } else child.stderr.resume()
  let inputClosed = false
  const active = connect(
    ndJsonStream(
      new WritableStream<Uint8Array>({
        write: (chunk) =>
          new Promise<void>((resolve, reject) => {
            child.stdin.write(chunk, (error) => (error ? reject(error) : resolve()))
          }),
      }),
      new ReadableStream<Uint8Array>({
        start: (controller) => {
          child.stdout.on('data', (chunk: Buffer) => {
            // Buffer is already a Uint8Array; copying each stdout chunk doubles transient
            // allocation for large ACP messages before the SDK's framing buffer sees it.
            if (!inputClosed) controller.enqueue(chunk)
          })
          child.stdout.on('end', () => {
            if (!inputClosed) controller.close()
            inputClosed = true
          })
          child.stdout.on('error', (error) => {
            if (!inputClosed) controller.error(error)
            inputClosed = true
          })
        },
        cancel: () => {
          inputClosed = true
          child.stdout.destroy()
        },
      }),
      { maxMessageBytes: ACP_MAX_MESSAGE_BYTES },
    ),
  )
  let rejectExit: (error: Error) => void = () => {}
  const exited = new Promise<never>((_, reject) => {
    rejectExit = reject
  })
  void exited.catch(() => {})
  void active.closed.then(() => {
    rejectExit(
      active.signal.reason instanceof Error
        ? active.signal.reason
        : new Error('ACP connection closed'),
    )
    void close()
  })
  child.on('error', rejectExit)
  // An agent that exits closes stdin; an unobserved pipe 'error' would crash the runtime.
  child.stdin.on('error', (error) => rejectExit(error))
  child.on('exit', (code) =>
    rejectExit(new Error(`ACP ${basename(launch.command)} exited (${code})`)),
  )
  const close = () => {
    signal?.removeEventListener('abort', abort)
    active.close()
    return stopAcpChild(child)
  }
  const abort = () => {
    void close()
  }
  signal?.addEventListener('abort', abort, { once: true })
  return {
    child,
    active,
    exited,
    close,
    authentication: launch.authentication,
    apiKey: !!env.XAI_API_KEY,
  }
}
