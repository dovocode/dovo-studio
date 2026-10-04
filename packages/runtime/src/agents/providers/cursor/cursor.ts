import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from 'vscode-jsonrpc/node'
import { decode, modelCatalogSchema, supportsAccess, isImageAttachment } from '@dovo/protocol'
import type { AgentDiscovery } from '@dovo/protocol'
import { cursorEventSchema, cursorInputSchema } from './cursor-runtime.js'
import type { AgentAdapter } from '../../execution/types.js'
import { processEnvironment } from '../../../process.js'
import { stopOwnedChild } from '../../execution/stop-owned-child.js'
import { nativeWait } from '../shared/native.js'
import { mcpHeaders, mcpServerEnvironment } from '../../configuration/mcp-settings.js'

export function openCursorWorker(agent: AgentDiscovery, cwd: string, entry?: URL) {
  const compiled = new URL('./cursor-worker.js', import.meta.url)
  const file =
    entry ?? (existsSync(compiled) ? compiled : new URL('./cursor-worker.ts', import.meta.url))
  const child = fork(file, [], {
    execArgv: file.pathname.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : [],
    cwd,
    detached: process.platform !== 'win32',
    env: processEnvironment(agent.env),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  // SDK logging is never the wire transport. Drain both streams to avoid backpressure.
  child.stdout?.resume()
  child.stderr?.resume()
  const rpc = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child))
  const lifetime = new AbortController()
  const fail = (error: Error) => {
    lifetime.abort(error)
    rpc.dispose()
  }
  child.on('error', fail)
  child.on('exit', (code) => fail(new Error(`Cursor SDK worker exited (${code})`)))
  rpc.onError(([error]) => fail(error))
  rpc.onClose(() => fail(new Error('Cursor SDK worker connection closed')))
  rpc.listen()
  return {
    rpc,
    signal: lifetime.signal,
    fail,
    async close() {
      rpc.dispose()
      await stopOwnedChild(child)
    },
  }
}

export function createCursorAdapter(openWorker = openCursorWorker): AgentAdapter {
  return {
    async models(agent) {
      const worker = openWorker(agent, homedir())
      try {
        return decode(
          modelCatalogSchema,
          await nativeWait(worker.rpc.sendRequest<unknown>('models'), worker.signal, 30000),
        )
      } finally {
        await worker.close()
      }
    },
    async probe(agent) {
      const worker = openWorker(agent, homedir())
      try {
        await nativeWait(worker.rpc.sendRequest('probe'), worker.signal, 30000)
        return {
          provider: 'cursor',
          available: true,
          detail: 'Cursor SDK authenticated. Agents run locally on this runtime.',
        }
      } catch (error) {
        return {
          provider: 'cursor',
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        }
      } finally {
        await worker.close()
      }
    },
    async run(run) {
      run.signal.throwIfAborted()
      if (run.compact)
        throw new Error(
          'Cursor SDK manages context automatically and exposes no manual compaction API',
        )
      if (!supportsAccess('cursor', run.agent.permission))
        throw new Error(
          'Cursor SDK supports read-only, Auto-review, and full access; choose a native mode',
        )
      const directory = run.ephemeral ? await mkdtemp(join(tmpdir(), 'dovo-cursor-')) : undefined
      let worker: ReturnType<typeof openCursorWorker> | undefined
      try {
        const input = cursorInputSchema.parse({
          cwd: run.cwd,
          sessionId: run.sessionId,
          model: run.agent.model,
          reasoning: run.agent.reasoning,
          permission: run.agent.permission,
          tools: run.tools,
          prompt: [run.agent.instructions, run.prompt].filter(Boolean).join('\n\n'),
          images: (run.attachments ?? [])
            .filter(isImageAttachment)
            .map((file) => ({ data: file.data, mimeType: file.mime })),
          storeDirectory: directory,
          mcpServers: Object.fromEntries(
            (run.agent.resources?.mcpServers ?? [])
              .filter(
                (server) =>
                  server.enabled && run.tools !== 'none' && run.agent.permission !== 'read-only',
              )
              .map((server) => [
                server.name,
                server.transport === 'stdio'
                  ? {
                      type: 'stdio',
                      command: server.command,
                      args: server.args,
                      env: mcpServerEnvironment(server),
                    }
                  : { type: 'http', url: server.url, headers: mcpHeaders(server) },
              ]),
          ),
        })
        worker = openWorker(run.agent, run.cwd)
        const host = worker
        const signal = AbortSignal.any([run.signal, host.signal])
        host.rpc.onNotification('event', (raw: unknown) => {
          if (signal.aborted) return
          try {
            const event = cursorEventSchema.parse(raw)
            if (event.type === 'text') run.onText(event.text)
            else if (event.type === 'boundary') run.onTextBoundary?.()
            else if (event.type === 'session') run.onSession(event.id)
            else if (event.type === 'event') {
              if (event.name === 'cursor/tool_call') run.onActivity('Cursor tool activity')
              run.onEvent?.(event.name, event.payload)
            } else {
              run.onPromptAccepted?.()
              if (event.steer)
                run.onSteer?.(async (value) => {
                  if (value.attachments?.length)
                    throw new Error(
                      'Cursor SDK steering supports text only; send attachments as a follow-up',
                    )
                  await nativeWait(host.rpc.sendRequest('steer', value.prompt), signal, 30000)
                })
            }
          } catch (error) {
            host.fail(error instanceof Error ? error : new Error(String(error)))
          }
        })
        await nativeWait(host.rpc.sendRequest('run', input), signal)
      } finally {
        run.onSteer?.(undefined)
        try {
          if (worker) {
            try {
              await nativeWait(worker.rpc.sendRequest('cancel'), worker.signal, 2000)
            } catch (error) {
              if (!worker.signal.aborted)
                run.onActivity(
                  `Cursor cancellation: ${error instanceof Error ? error.message : String(error)}`,
                )
            } finally {
              await worker.close()
            }
          }
        } finally {
          if (directory) await rm(directory, { recursive: true, force: true })
        }
      }
    },
  }
}
