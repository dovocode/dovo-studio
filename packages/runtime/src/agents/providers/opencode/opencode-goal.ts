import { Schema } from 'effect'
import { decode, nativeGoalSchema } from '@dovo/protocol'
import type { OpenCodeClient } from '@opencode/client'
import { gte, valid } from 'semver'
import type { AgentRun } from '../../execution/types.js'

const goalSchema = Schema.NullOr(
  nativeGoalSchema.mapFields(({ sessionId: _sessionId, ...fields }) => fields),
)

export function opencodeGoal(run: AgentRun, api: OpenCodeClient, sessionID: string) {
  let active = false
  let revision = 0
  const publish = (value: unknown) => {
    const goal = decode(goalSchema, value)
    active = goal?.status === 'active'
    revision++
    run.onEvent?.('dovo/opencode/goal', goal ? { ...goal, sessionId: sessionID } : null)
    return goal
  }
  const read = async (signal = run.signal) => {
    const before = revision
    const result = await api.rpc.call(
      {
        rpcID: 'opencode.goal',
        method: 'get',
        input: { sessionID },
        location: { directory: run.cwd },
      },
      { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
    )
    if (before === revision) publish(result.output)
  }
  return {
    get active() {
      return active
    },
    publish,
    read,
    async supported() {
      const info = await api.server.info({
        signal: AbortSignal.any([run.signal, AbortSignal.timeout(5000)]),
      })
      return !!valid(info.version) && gte(info.version, '2.2.5')
    },
    async control() {
      if (!run.goal) return false
      if (!(await this.supported()))
        throw new Error(
          'Native goals require OpenCode 2.2.5 or later. Update OpenCode on this computer.',
        )
      if (run.goal.action === 'get') {
        await read()
        run.onPromptAccepted?.()
        run.onText('Goal state refreshed.')
        return true
      }
      await api.session.command(
        {
          sessionID,
          name: 'goal',
          text: run.goal.action === 'set' ? run.goal.objective : run.goal.action,
        },
        { signal: run.signal },
      )
      run.onPromptAccepted?.()
      await read()
      if (run.goal.action === 'clear' || run.goal.action === 'pause') {
        run.onText(run.goal.action === 'clear' ? 'Goal cleared.' : 'Goal paused.')
        return true
      }
      return false
    },
  }
}
