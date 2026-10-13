import { spawn } from 'node:child_process'
import { createMessageConnection } from 'vscode-jsonrpc/node'
import type { Agent } from '@dovo/protocol'
import { processEnvironment } from '../../../process.js'
import { stopOwnedChild } from '../../execution/stop-owned-child.js'
import { codexThreadEntries } from '../../execution/native-thread.js'
import { JsonLineReader, JsonLineWriter } from './codex-transport.js'

/** Historical reads must never start, resume, or interrupt a model turn. */
export async function readCodexThread(agent: Agent, id: string, cwd?: string) {
  const child = spawn(
    agent.endpoint || 'codex',
    ['app-server', '--listen', 'stdio://', ...(agent.args ?? [])],
    {
      cwd,
      env: processEnvironment(agent.env),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  child.stderr.resume()
  const rpc = createMessageConnection(
    new JsonLineReader(child.stdout),
    new JsonLineWriter(child.stdin),
  )
  let timeout: ReturnType<typeof setTimeout> | undefined
  let fail!: (error: Error) => void
  const failure = new Promise<never>((_, reject) => {
    fail = reject
  })
  child.on('error', fail)
  child.stdin.on('error', fail)
  child.once('exit', () => fail(new Error('Codex exited while reading the native thread')))
  rpc.listen()
  try {
    return await Promise.race([
      (async () => {
        await rpc.sendRequest('initialize', {
          clientInfo: { name: 'dovo_studio', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        })
        await rpc.sendNotification('initialized', {})
        return codexThreadEntries(
          await rpc.sendRequest('thread/read', { threadId: id, includeTurns: true }),
        )
      })(),
      failure,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Reading the native Codex thread timed out')),
          10000,
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
    rpc.dispose()
    await stopOwnedChild(child)
  }
}
