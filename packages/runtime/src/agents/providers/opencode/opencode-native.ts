import { OwnedProcessShutdownError } from '../../execution/stop-owned-child.js'
import { nativeAgentWorking, type Subagent } from '@dovo/protocol'
import type { AgentRun } from '../../execution/types.js'
import { updateSubagents } from '../../execution/subagents.js'

/** OpenCode serves child sessions independently; drain them before releasing MCP/event bindings. */
export function opencodeNative(
  run: AgentRun,
  sessionId: string,
  stop: (id: string) => Promise<void>,
  active: () => Promise<ReadonlySet<string>>,
) {
  let agents: Subagent[] = []
  const children = () => agents.filter(nativeAgentWorking)
  const update = (method: string, payload: unknown) => {
    agents = updateSubagents(
      agents,
      'opencode',
      payload,
      new Date().toISOString(),
      method,
      sessionId,
    )
    run.onSubagentEvent?.(method, payload, sessionId)
  }
  const refresh = async (stopped = false) => {
    if (!children().length) return
    const working = await active()
    for (const agent of children())
      if (!working.has(agent.id))
        update(stopped ? 'session.execution.interrupted' : 'session.execution.succeeded', {
          data: { sessionID: agent.id },
        })
  }
  const cancel = async (id?: string) => {
    await Promise.all(
      children()
        .filter((agent) => !id || id === agent.id)
        .map((agent) => stop(agent.id)),
    )
    await refresh(true)
  }
  run.onNativeSession?.({ stop: cancel }, sessionId)
  return {
    update,
    owns: (id: string) => agents.some((agent) => agent.id === id),
    async drain(stream: Promise<unknown>) {
      run.onNativeTurnEnd?.()
      if (children().length) run.onActivity('Waiting for native agents')
      while (children().length) {
        run.signal.throwIfAborted()
        await refresh()
        if (!children().length) break
        await Promise.race([
          stream.then(() => {
            throw new Error('OpenCode child event stream closed')
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 250)),
        ])
      }
    },
    async close(cancelled: boolean) {
      if (cancelled) {
        try {
          await cancel()
          if (children().length) throw new Error('Child sessions are still active')
        } catch (cause) {
          throw new OwnedProcessShutdownError('OpenCode child shutdown was not confirmed', {
            cause,
          })
        }
      }
      run.onSubagentEvent?.('dovo/session/closed', {}, sessionId)
    },
  }
}
