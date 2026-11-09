import { decode, mutableStruct, type GoalCommand } from '@dovo/protocol'
import { Schema } from 'effect'
import { ResponseError } from 'vscode-jsonrpc/node'

const goalResponse = mutableStruct({
  goal: Schema.NullOr(
    mutableStruct({
      objective: Schema.String,
      status: Schema.Literals([
        'active',
        'paused',
        'blocked',
        'usageLimited',
        'budgetLimited',
        'complete',
      ]),
      tokensUsed: Schema.Number,
      timeUsedSeconds: Schema.Number,
    }),
  ),
})

/** Use the native store. Read/clear/pause never submit a model prompt. */
export async function codexGoal(
  request: (method: string, params: object) => Promise<unknown>,
  threadId: string,
  command: GoalCommand,
  accepted: () => void,
  text: (value: string) => void,
): Promise<string | undefined> {
  const call = async (method: string, params: object) => {
    try {
      return await request(method, params)
    } catch (error) {
      if (error instanceof ResponseError && error.code === -32601)
        throw new Error(
          'This Codex version does not support native goals. Update Codex on the thread computer.',
        )
      throw error
    }
  }
  if (command.action === 'clear') {
    await call('thread/goal/clear', { threadId, origin: 'user' })
    accepted()
    text('Goal cleared.')
    return undefined
  }
  if (command.action === 'pause' || command.action === 'resume') {
    const current = decode(goalResponse, await call('thread/goal/get', { threadId })).goal
    if (!current) throw new Error('No goal set. Use /goal <objective> first.')
  }
  const response = await call(
    command.action === 'get' ? 'thread/goal/get' : 'thread/goal/set',
    command.action === 'get'
      ? { threadId }
      : {
          threadId,
          origin: 'user',
          status: command.action === 'pause' ? 'paused' : 'active',
          ...(command.action === 'set' ? { objective: command.objective } : {}),
        },
  )
  const { goal } = decode(goalResponse, response)
  accepted()
  if (!goal) {
    text('No goal set. Use /goal <objective> to set one.')
    return undefined
  }
  text(
    `Goal ${goal.status}: ${goal.objective}\nUsage: ${goal.tokensUsed.toLocaleString('en-US')} tokens · ${goal.timeUsedSeconds}s`,
  )
  return command.action === 'set' || command.action === 'resume'
    ? `Continue working toward this goal: ${goal.objective}`
    : undefined
}
