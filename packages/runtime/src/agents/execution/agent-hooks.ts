import { spawn } from 'node:child_process'
import type { AgentHook } from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from './types.js'
import { stopOwnedChild } from './stop-owned-child.js'
import { processEnvironment } from '../../process.js'

export interface HookResult {
  hook: AgentHook
  ok: boolean
  output: string
}

export async function executeHook(
  hook: AgentHook,
  cwd: string,
  signal: AbortSignal,
): Promise<HookResult> {
  signal.throwIfAborted()
  const child = spawn(hook.command, {
    windowsHide: true,
    cwd,
    env: processEnvironment(),
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-16000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  let timedOut = false
  const stop = () => {
    void stopOwnedChild(child)
  }
  signal.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    stop()
  }, hook.timeoutSeconds * 1000)
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    signal.throwIfAborted()
    return {
      hook,
      ok: code === 0 && !timedOut,
      output: `${timedOut ? 'Hook timed out.\n' : ''}${output}`,
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    await stopOwnedChild(child)
  }
}

/** Failed post-checks get at most two repair turns; completion requires a passing check. */
export async function runWithHooks(
  adapter: Pick<AgentAdapter, 'run'>,
  run: AgentRun,
  hooks: AgentHook[],
  report: (result: HookResult) => void,
  repairStarted: () => void,
) {
  const enabled = run.compact ? [] : hooks.filter((hook) => hook.enabled)
  if (enabled.length && run.agent.permission === 'read-only')
    throw new Error(
      'Agent hooks require write access. Disable hooks or change the task access mode.',
    )
  const checks = async (event: AgentHook['event']) => {
    const failed: HookResult[] = []
    for (const hook of enabled.filter((hook) => hook.event === event)) {
      const result = await executeHook(hook, run.cwd, run.signal)
      report(result)
      if (!result.ok) failed.push(result)
    }
    return failed
  }
  const before = await checks('before-turn')
  if (before.length)
    throw new Error(
      `Before-turn hooks failed: ${before.map((result) => result.hook.name).join(', ')}`,
    )
  let sessionId = run.sessionId
  let prompt = run.prompt
  for (let attempt = 0; attempt <= 2; attempt++) {
    await adapter.run({
      ...run,
      prompt,
      sessionId,
      attachments: attempt ? undefined : run.attachments,
      onSession: (id) => {
        sessionId = id
        run.onSession(id)
      },
    })
    run.signal.throwIfAborted()
    const failed = await checks('after-turn')
    if (!failed.length) return
    if (attempt === 2)
      throw new Error(
        `After-turn hooks still fail after two repair attempts: ${failed.map((result) => result.hook.name).join(', ')}`,
      )
    prompt = `Required project/agent checks failed. Fix the underlying issues, then finish so Dovo can rerun the checks.\n\n${failed.map(({ hook, output }) => `${hook.name}: ${hook.command}\n${output}`).join('\n\n')}`
    repairStarted()
  }
}
