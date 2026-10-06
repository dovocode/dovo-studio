import { spawn } from 'node:child_process'
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc/node'
import { JsonLineReader, JsonLineWriter } from '../providers/codex/codex-transport.js'
import { processEnvironment } from '../../process.js'
import { stopOwnedChild } from '../execution/stop-owned-child.js'
export async function withCatalogRpc<T>(
  executable: string,
  args: string[],
  load: (rpc: MessageConnection) => Promise<T>,
  env?: Record<string, string>,
): Promise<T> {
  // Detached like the other owned launchers, so helper processes stop with their group.
  const child = spawn(executable, args, {
    windowsHide: true,
    env: processEnvironment(env),
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const rpc = createMessageConnection(
    new JsonLineReader(child.stdout),
    new JsonLineWriter(child.stdin),
  )
  let stderr = '',
    rejectExit: (error: Error) => void = () => {}
  child.stderr.on('data', (data) => {
    stderr = (stderr + String(data)).slice(-2000)
  })
  const exited = new Promise<never>((_, reject) => {
    rejectExit = reject
  })
  child.on('error', rejectExit)
  child.on('exit', (code) => rejectExit(new Error(`Model discovery exited (${code}). ${stderr}`)))
  // Discovery never grants tool permissions or runs a prompt.
  rpc.onRequest(() => {
    throw new Error('Tool requests are unavailable during model discovery')
  })
  const timer = setTimeout(() => rejectExit(new Error('Model discovery timed out')), 20000)
  rpc.listen()
  try {
    return await Promise.race([load(rpc), exited])
  } finally {
    clearTimeout(timer)
    rpc.dispose()
    await stopOwnedChild(child).catch(() => undefined)
  }
}
