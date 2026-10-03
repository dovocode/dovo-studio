import { resolveScopedSettings } from '../../runtime/connection/scoped-settings.js'
import type { RuntimeDefaults } from '../../runtime/connection/runtime-setup.js'
import { mergeResources, type ResourceSettings } from '../../shared/resources.js'
import { resolveTaskAgent, type Agent, type Repository, type Task } from '../../workspace.js'

/** @ files and MCP servers (like Claude), $ skills (like Codex), / skills at a line start,
 * and # saved prompts. */
export type MentionTrigger = '@' | '$' | '/' | '#'
export type ComposerMention = { trigger: MentionTrigger; start: number; query: string }

/** The mention being typed at the caret, or undefined. "@" and "$" must start the text or
 * follow whitespace; "/" only starts a line, so paths and URLs in prose do not trigger it. */
export function composerMention(text: string, caret: number): ComposerMention | undefined {
  const before = text.slice(0, caret)
  const at = /(^|\s)@([^\s@]*)$/.exec(before)
  if (at) return { trigger: '@', start: caret - at[2].length - 1, query: at[2] }
  const skill = /(^|\s)\$([\w.-]*)$/.exec(before)
  if (skill) return { trigger: '$', start: caret - skill[2].length - 1, query: skill[2] }
  const saved = /(^|\s)#([\w.-]*)$/.exec(before)
  if (saved) return { trigger: '#', start: caret - saved[2].length - 1, query: saved[2] }
  const slash = /(^|\n)[ \t]*\/([\w.-]*)$/.exec(before)
  if (slash) return { trigger: '/', start: caret - slash[2].length - 1, query: slash[2] }
  return undefined
}

/** The skills and MCP servers a task's agent receives: its project's merged with its agent's. */
export function taskResources(
  task: Pick<Task, 'id' | 'agentId' | 'agentOverrides' | 'harness' | 'repositoryId'>,
  workspace: { agents: readonly Agent[]; repositories: readonly Repository[] },
  defaults?: RuntimeDefaults,
): ResourceSettings {
  const repository = workspace.repositories.find(
    (repository) => repository.id === task.repositoryId,
  )
  return mergeResources(
    resolveScopedSettings(defaults, repository).resources,
    resolveTaskAgent(task, workspace.agents)?.resources,
  )
}

export type ResourceSuggestion = {
  kind: 'skill' | 'mcp'
  name: string
  description?: string
  /** Disabled skills can still be mentioned: their instructions join that one message. */
  enabled: boolean
}

/** Skills for "$" and "/", enabled MCP servers for "@", best matches first. */
export function resourceSuggestions(
  resources: ResourceSettings,
  trigger: MentionTrigger,
  query: string,
  limit = 8,
): ResourceSuggestion[] {
  const needle = query.toLowerCase()
  if (trigger === '#') return []
  const items: ResourceSuggestion[] =
    trigger === '@'
      ? resources.mcpServers
          .filter((server) => server.enabled)
          .map((server) => ({ kind: 'mcp' as const, name: server.name, enabled: true }))
      : resources.skills.map((skill) => ({
          kind: 'skill' as const,
          name: skill.name,
          description: skill.description,
          enabled: skill.enabled,
        }))
  return items
    .filter((item) => item.name.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        Number(b.name.toLowerCase().startsWith(needle)) -
          Number(a.name.toLowerCase().startsWith(needle)) ||
        Number(b.enabled) - Number(a.enabled) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentioned = (text: string, prefix: string, name: string, lineStart = false) =>
  new RegExp(
    `${lineStart ? '(^|\\n)[ \\t]*' : '(^|\\s)'}${escape(prefix)}${escape(name)}(?=$|[\\s.,;:!?)])`,
    'i',
  ).test(text)

/** Skills (by $name or a leading /name) and enabled MCP servers (by @name) a message names. */
export function mentionedResources(text: string, resources: ResourceSettings) {
  return {
    skills: resources.skills.filter(
      (skill) => mentioned(text, '$', skill.name) || mentioned(text, '/', skill.name, true),
    ),
    mcpServers: resources.mcpServers.filter(
      (server) => server.enabled && mentioned(text, '@', server.name),
    ),
  }
}

/** Built-in "/" commands, listed before skills at the start of a line. */
export type ComposerCommand = {
  id: 'review' | 'compact' | 'new-session' | 'undo'
  name: string
  description: string
}
export const composerCommands: readonly ComposerCommand[] = [
  { id: 'review', name: 'review', description: 'Ask the agent to review its changes' },
  { id: 'compact', name: 'compact', description: 'Summarize older agent context' },
  { id: 'new-session', name: 'new-session', description: 'Start the agent fresh next message' },
  { id: 'undo', name: 'undo', description: 'Undo the last turn’s file changes' },
]
export function commandSuggestions(query: string) {
  const needle = query.toLowerCase()
  return composerCommands.filter((command) => command.name.startsWith(needle))
}

/** Saved prompts of the task's project for "#", name matches first. */
export function promptSuggestions(
  prompts: readonly { id: string; name: string; text: string }[],
  query: string,
  limit = 8,
) {
  const needle = query.toLowerCase()
  return prompts
    .filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(needle) ||
        (needle.length > 2 && prompt.text.toLowerCase().includes(needle)),
    )
    .sort(
      (a, b) =>
        Number(b.name.toLowerCase().startsWith(needle)) -
          Number(a.name.toLowerCase().startsWith(needle)) || a.name.localeCompare(b.name),
    )
    .slice(0, limit)
}

/** Replaces the "#query" at `start` with the prompt's text. */
export function insertPrompt(text: string, start: number, caret: number, prompt: string) {
  const inserted = text.slice(0, start) + prompt + text.slice(caret)
  return { text: inserted, caret: start + prompt.length }
}
