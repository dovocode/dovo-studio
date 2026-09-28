import type { recentTools } from '../../automation/activity.js'
import type { TaskTurn } from '../../workspace.js'
import { toolPresentation } from '../presentation/tool-presentation.js'

/** A compact turn report derived from existing checkpoint and tool events. */
export function turnSummary(turn: TaskTurn, tools: ReturnType<typeof recentTools>) {
  if (turn.status === 'running') return ''
  const files = (turn.checkpoint?.files.length ?? 0) + (turn.checkpoint?.omitted.length ?? 0)
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
    `${files} ${files === 1 ? 'file' : 'files'} changed`,
    `${tests.length} ${tests.length === 1 ? 'test command' : 'test commands'}`,
    `${commands.length} ${commands.length === 1 ? 'command' : 'commands'} used`,
  ]
  return parts.join(' · ')
}
