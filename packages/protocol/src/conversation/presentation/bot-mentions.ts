import { threadReferenceLink } from './studio-links.js'
import type { Agent, Task } from '../../workspace.js'
import { compareBotActivity } from '../../tasks/bot-activity.js'
import { studioReference } from '../../runtime/studio-reference.js'
import { insertPrompt } from './resource-mentions.js'
import { messageReferences } from './composer-references.js'
import { parseStudioReference } from '../../runtime/studio-reference.js'

export type BotMention = {
  kind?: 'thread'
  reference: string
  name: string
  detail: string
  avatar?: string
}

/** Public Bot identity only. Sending a mention saves a child copy without dispatching work. */
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

export function agentMentionSuggestions(
  runtimeId: string,
  repositoryId: string | undefined,
  agents: readonly Pick<Agent, 'id' | 'name' | 'provider'>[],
  query: string,
) {
  const needle = query.toLowerCase()
  return agents
    .filter((agent) => agent.name.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((agent) => ({
      kind: 'agent' as const,
      reference: `agent:${[runtimeId, repositoryId ?? '', agent.id].map(encodeURIComponent).join('/')}`,
      name: agent.name,
      detail: `Agent · ${agent.provider}`,
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

export const insertAgentMention = insertBotMention

/** Only explicit saved mentions in sent prose, never bare IDs, code or historical messages. */
export function botMentionTargets(text: string) {
  return messageReferences(text, { skills: [], mcpServers: [] }).flatMap((reference) => {
    if (reference.kind !== 'bot') return []
    const match = /\(`(studio:[^`\s]+)`\)$/.exec(text.slice(reference.start, reference.end))
    const target = match && parseStudioReference(match[1])
    return target?.kind === 'thread' ? [target] : []
  })
}

/** Search thread titles without loading or copying their private conversation history. */
export function contextMentionSuggestions(
  sources: Parameters<typeof botMentionSuggestions>[0],
  query: string,
): BotMention[] {
  const explicit = query.toLowerCase().startsWith('thread:')
  const needle = (explicit ? query.slice(7) : query).toLowerCase()
  const threads: BotMention[] = !explicit
    ? []
    : sources
        .flatMap((source) =>
          source.tasks
            .filter(
              (task) =>
                !task.bot &&
                !task.example &&
                !task.replica &&
                !task.delegation &&
                `${task.title} ${source.name}`.toLowerCase().includes(needle),
            )
            .map((task) => ({
              kind: 'thread' as const,
              reference: threadReferenceLink(source.runtimeId, task.id),
              name: task.title || 'Untitled thread',
              detail: `Thread · ${source.name}${task.archived || task.archivedAt ? ' · Archived' : ''}`,
            })),
        )
        .slice(0, 8)
  return [...(explicit ? [] : botMentionSuggestions(sources, query)), ...threads]
}
export function insertThreadMention(
  text: string,
  start: number,
  caret: number,
  thread: Pick<BotMention, 'name' | 'reference'>,
) {
  const label = thread.name.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]/g, ' ')
  return insertPrompt(text, start, caret, `[${label}](${thread.reference}) `)
}
