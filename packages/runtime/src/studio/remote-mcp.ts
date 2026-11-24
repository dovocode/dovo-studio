import { remoteMcpWrites, type RemoteMcpClaim } from '@dovo/protocol'
import { HttpError } from '../errors.js'
import type { Services } from '../services.js'
import { forwardedThreadScope, requireStudioPart, studioTool } from './tools.js'

/** External callers select saved agents and models. The saved project and agent policies control each run. */
export async function remoteMcpTool(s: Services, claim: RemoteMcpClaim, authorize: () => void) {
  authorize()
  const { input, grantId } = claim
  if (claim.access !== 'run' && remoteMcpWrites(input))
    throw new HttpError(403, 'This MCP grant has read-only access.')
  if (input.part === 'events') {
    requireStudioPart(s, 'threads')
    return s.activity.remoteMcpEvents.poll(input.command)
  }
  const caller = {
    runtimeId: 'connect-mcp',
    threadId: grantId,
    title: 'External MCP app',
  }
  const scope = forwardedThreadScope(caller.runtimeId, caller.threadId)
  if (input.part === 'threads' && input.command.action === 'create') {
    const { model, ...request } = input.command
    return studioTool(
      s,
      scope,
      input.part,
      {
        ...request,
        ...(model ? { agentOverrides: { model } } : {}),
      },
      authorize,
    )
  }
  const bot =
    input.part === 'threads' &&
    input.command.action === 'send' &&
    s.store.taskSummary(input.command.id).bot
  return studioTool(
    s,
    scope,
    input.part,
    input.command,
    authorize,
    undefined,
    bot ? caller : undefined,
  )
}
