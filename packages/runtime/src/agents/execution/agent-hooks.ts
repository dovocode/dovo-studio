import { HookEvents, type HookEventData } from './hook-events.js'
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
  context?: HookContext,
): Promise<HookResult> {
  signal.throwIfAborted()
  const child = spawn(hook.command, {
    windowsHide: true,
    cwd,
    env: processEnvironment(),
    shell: true,
    detached: process.platform !== 'win32',
    stdio: [context ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-16000)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  let timedOut = false
  let cleanup: Promise<void> | undefined
  let failWait: (error: unknown) => void = () => {}
  const stop = () => {
    cleanup ??= stopOwnedChild(child)
    void cleanup.catch((error: unknown) => failWait(error))
  }
  signal.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    stop()
  }, hook.timeoutSeconds * 1000)
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      failWait = reject
      child.once('error', reject)
      child.once('close', resolve)
      if (context && child.stdin) {
        child.stdin.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EPIPE') reject(error)
        })
        child.stdin.end(JSON.stringify(context) + '\n')
      }
      if (signal.aborted) stop()
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
    await (cleanup ??= stopOwnedChild(child))
  }
}

export type HookContext = HookEventData & {
  version: 1
  event: AgentHook['event']
  cwd: string
  taskId?: string
  sessionId?: string
  harness: AgentRun['agent']['provider']
}

/** Checks gate Dovo's turn/approval boundaries. Tool and session events observe native execution. */
export async function runWithHooks(
  adapter: Pick<AgentAdapter, 'run'>,
  run: AgentRun,
  hooks: AgentHook[],
  report: (result: HookResult) => void,
  repairStarted: () => void,
) {
  const enabled = hooks.filter(
    (hook) =>
      hook.enabled &&
      (!run.compact ||
        ['before-compaction', 'after-compaction', 'turn-error', 'turn-interrupted'].includes(
          hook.event,
        )),
  )
  if (!enabled.length) return adapter.run(run)
  if (run.agent.permission === 'read-only')
    throw new Error(
      'Agent hooks require write access. Disable hooks or change the task access mode.',
    )
  const matchers = new Map(
    enabled.flatMap((hook) =>
      hook.matcher && hook.matcher !== '*' ? [[hook.name, new RegExp(hook.matcher)] as const] : [],
    ),
  )
  const observesNative = enabled.some((hook) =>
    [
      'tool-start',
      'tool-complete',
      'tool-error',
      'before-compaction',
      'after-compaction',
      'subagent-start',
      'subagent-stop',
    ].includes(hook.event),
  )
  let sessionId = run.sessionId
  const dispatch = async (
    event: AgentHook['event'],
    data: HookEventData = {},
    signal = run.signal,
    eventSession = sessionId,
  ) => {
    const failed: HookResult[] = []
    const target = [
      data.tool?.kind,
      data.tool?.name,
      data.subagent?.name,
      data.permission?.title,
    ].filter((value): value is string => !!value)
    for (const hook of enabled.filter((hook) => hook.event === event)) {
      const matcher = matchers.get(hook.name)
      if (matcher && !target.some((value) => matcher.test(value))) continue
      const result = await executeHook(hook, run.cwd, signal, {
        version: 1,
        event,
        cwd: run.cwd,
        taskId: run.taskId,
        sessionId: eventSession,
        harness: run.agent.provider,
        ...data,
      })
      report(result)
      if (!result.ok) failed.push(result)
    }
    return failed
  }
  const assertPassed = (failed: HookResult[], boundary: string) => {
    if (failed.length)
      throw new Error(
        `${boundary} hooks failed: ${failed.map((result) => result.hook.name).join(', ')}`,
      )
  }
  try {
    assertPassed(
      await dispatch(run.compact ? 'before-compaction' : 'before-turn', {
        prompt: run.prompt,
        ...(run.compact ? { trigger: 'manual' as const } : {}),
      }),
      run.compact ? 'Before-compaction' : 'Before-turn',
    )
    let prompt = run.prompt
    for (let attempt = 0; attempt <= 2; attempt++) {
      const events = observesNative ? new HookEvents(run.agent.provider, sessionId) : undefined
      let queue = Promise.resolve()
      let queueError: unknown
      const failures: HookResult[] = []
      let attached = false
      let compacted = false
      let active = true
      const enqueue = (event: AgentHook['event'], data: HookEventData = {}) => {
        if (!active || !enabled.some((hook) => hook.event === event)) return
        const eventSession = sessionId
        queue = queue
          .then(async () => {
            failures.push(...(await dispatch(event, data, run.signal, eventSession)))
          })
          .catch((error: unknown) => {
            queueError ??= error
          })
      }
      const observe = (name: string, payload: unknown) => {
        if (!active) return
        for (const { event, data } of events?.accept(name, payload) ?? []) {
          if (event === 'after-compaction') {
            if (run.compact && compacted) continue
            compacted = true
          }
          // The manual request already ran its blocking before-compaction check.
          if (run.compact && event === 'before-compaction') continue
          enqueue(event, data)
        }
      }
      try {
        await adapter.run({
          ...run,
          prompt,
          sessionId,
          attachments: attempt ? undefined : run.attachments,
          onSession: (id) => {
            sessionId = id
            if (events) events.sessionId = id
            run.onSession(id)
            if (!attached) {
              attached = true
              enqueue('session-start', { resumed: !!run.sessionId || attempt > 0 })
            }
          },
          onEvent: (name, payload) => {
            run.onEvent?.(name, payload)
            observe(name, payload)
          },
          onSubagentEvent: (name, payload, id) => {
            run.onSubagentEvent?.(name, payload, id)
            observe(name, payload)
          },
          approve: async (title, detail, kind, options) => {
            await queue
            if (queueError) throw queueError
            const permission = { title, detail }
            const blocked = await dispatch('permission-request', { permission })
            const decision = blocked.length
              ? 'deny'
              : await run.approve(title, detail, kind, options)
            failures.push(
              ...(await dispatch('permission-response', {
                permission: { ...permission, decision },
              })),
            )
            return decision
          },
        })
      } finally {
        active = false
        await queue
      }
      if (queueError) throw queueError
      assertPassed(failures, 'Lifecycle')
      run.signal.throwIfAborted()
      if (run.compact) {
        if (!compacted)
          assertPassed(
            await dispatch('after-compaction', { trigger: 'manual' }),
            'After-compaction',
          )
        return
      }
      const failed = await dispatch('after-turn')
      if (!failed.length) return
      if (attempt === 2)
        throw new Error(
          `After-turn hooks still fail after two repair attempts: ${failed.map((result) => result.hook.name).join(', ')}`,
        )
      prompt = `Required project/agent checks failed. Fix the underlying issues, then finish so Dovo can rerun the checks.\n\n${failed.map(({ hook, output }) => `${hook.name}: ${hook.command}\n${output}`).join('\n\n')}`
      repairStarted()
    }
  } catch (error) {
    const event = run.signal.aborted ? 'turn-interrupted' : 'turn-error'
    // A separate deadline allows cleanup after cancellation; preserve the original failure.
    try {
      assertPassed(
        await dispatch(
          event,
          { error: error instanceof Error ? error.message : String(error) },
          AbortSignal.timeout(3000),
        ),
        'Failure cleanup',
      )
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${error instanceof Error ? error.message : String(error)}; failure cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      )
    }
    throw error
  }
}
