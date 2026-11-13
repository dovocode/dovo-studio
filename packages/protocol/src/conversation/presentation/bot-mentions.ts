import type { Task } from '../../workspace.js'
import { compareBotActivity } from '../../tasks/bot-activity.js'
import { studioReference } from '../../runtime/studio-reference.js'
import { insertPrompt } from './resource-mentions.js'

export type BotMention = { reference: string; name: string; detail: string; avatar?: string }

/** Public Bot identity only. A mention does not read private context or dispatch work. */
export function botMentionSuggestions(
  sources: readonly { runtimeId: string; name: string; tasks: readonly Task[] }[],
  query: string,
): BotMention[] {
  const needle = query.toLowerCase()
  return sources
    .flatMap((source) =>
      source.tasks
        .filter(
          (task) =>
            task.bot &&
            !task.archivedAt &&
            !task.archived &&
            !task.replica &&
            !task.delegation &&
            `${task.title} ${task.bot.role} ${source.name}`.toLowerCase().includes(needle),
        )
        .map((task) => ({ task, source })),
    )
    .sort(
      (a, b) =>
        compareBotActivity(a.task, b.task) || a.source.runtimeId.localeCompare(b.source.runtimeId),
    )
    .slice(0, 8)
    .map(({ task, source }) => ({
      reference: studioReference(source.runtimeId, 'thread', task.id),
      name: task.title,
      detail: `Bot · ${source.name}${task.bot?.state === 'paused' ? ' · Paused' : ''}`,
      avatar: task.bot?.avatar,
    }))
}

export function insertBotMention(
  text: string,
  start: number,
  caret: number,
  bot: Pick<BotMention, 'name' | 'reference'>,
) {
  return insertPrompt(text, start, caret, `@${bot.name} (\`${bot.reference}\`) `)
}
