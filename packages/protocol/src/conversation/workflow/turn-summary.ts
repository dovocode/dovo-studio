import { checkpointFileCount } from '../../scm/repositories/file-previews.js'
import type { recentTools } from '../../automation/activity.js'
import type { TaskTurn } from '../../workspace.js'
import { toolPresentation } from '../presentation/tool-presentation.js'

/** A compact turn report derived from checkpoint and tool events. */
export function turnSummary(
  turn: TaskTurn,
  tools: ReturnType<typeof recentTools>,
  includeFiles = true,
) {
  if (turn.status === 'running') return ''
  const files = checkpointFileCount(turn.checkpoint)
  const commands = tools
    .filter((tool) => tool.turnId === turn.id)
    .map((tool) => toolPresentation(tool.payload, tool.summary, tool.inputPayload))
    .filter((item) => item.kind === 'command')
  const tests = commands.filter((item) =>
    /(?:^|\s)(?:test|vitest|jest|pytest|go test|cargo test)(?:\s|$)/i.test(
      item.input || item.title,
    ),
  )
  const parts = [
    ...(includeFiles ? [`${files} ${files === 1 ? 'file' : 'files'} changed`] : []),
    `${tests.length} ${tests.length === 1 ? 'test command' : 'test commands'}`,
    `${commands.length} ${commands.length === 1 ? 'command' : 'commands'} used`,
  ]
  return parts.join(' · ')
}
