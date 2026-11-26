import { maskFileMentions, mentionQuery } from './file-mentions.js'
import { resolveScopedSettings } from '../../runtime/connection/scoped-settings.js'
import type { RuntimeDefaults } from '../../runtime/connection/runtime-setup.js'
import { mergeResources, type ResourceSettings } from '../../shared/resources.js'
import { resolveTaskAgent, type Agent, type Repository, type Task } from '../../workspace.js'
import { applyBotResources, inheritedResourceProject } from '../../tasks/bots.js'
import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'

export const nativeSkillsSchema = mutableArray(
  mutableStruct({ name: Schema.String, description: Schema.optional(Schema.String) }),
)
export type NativeSkill = Schema.Schema.Type<typeof nativeSkillsSchema>[number]

/** @ Bots, agents, models and MCP servers, @file: paths, $ skills (like Codex), / skills at a line start,
 * and # saved prompts. */
export type MentionTrigger = '@file:' | '@' | '$' | '/' | '#'
export type ComposerMention = { trigger: MentionTrigger; start: number; query: string }

/** The mention being typed at the caret, or undefined. "@" and "$" must start the text or
 * follow whitespace; "/" only starts a line, so paths and URLs in prose do not trigger it. */
export function composerMention(text: string, caret: number): ComposerMention | undefined {
  const file = mentionQuery(text, caret)
  if (file) return { trigger: '@file:', ...file }
  const before = text.slice(0, caret)
  const at = /(^|\s)@([^\s@]*)$/.exec(before)
  if (at) return { trigger: '@', start: caret - at[2].length - 1, query: at[2] }
  const skill = /(^|\s)\$([\w.-]*)$/.exec(before)
  if (skill) return { trigger: '$', start: caret - skill[2].length - 1, query: skill[2] }
  const saved = /(^|\s)#([\w.-]*)$/.exec(before)
  if (saved) return { trigger: '#', start: caret - saved[2].length - 1, query: saved[2] }
  const slash = /(^|\n)[^\S\r\n]*\/([\w.-]*)$/.exec(before)
  if (slash) return { trigger: '/', start: caret - slash[2].length - 1, query: slash[2] }
  return undefined
}

type ResourceThread = Pick<
  Task,
  'id' | 'agentId' | 'agentOverrides' | 'harness' | 'repositoryId' | 'bot' | 'botMention'
>
type ResourceBot = ResourceThread & Pick<Task, 'replica' | 'archivedAt'>

/** Merge a thread's project and agent settings. An explicit Bot call resolves the local
 * coordinator's current settings and Bot overrides. */
export function taskResources(
  task: ResourceThread,
  workspace: {
    agents: readonly Agent[]
    repositories: readonly Repository[]
    tasks?: readonly ResourceBot[]
    runtimeId?: string
  },
  defaults?: RuntimeDefaults,
  agent?: Pick<Agent, 'resources'>,
): ResourceSettings {
  const invocation = task.botMention?.sourceRuntimeId ? task.botMention : undefined
  if (invocation && workspace.runtimeId && invocation.runtimeId !== workspace.runtimeId)
    return mergeResources()
  const owner = invocation
    ? workspace.tasks?.find(
        (candidate) =>
          candidate.id === invocation.botId &&
          !!candidate.bot &&
          !candidate.replica &&
          !candidate.archivedAt,
      )
    : task
  if (!owner) return mergeResources()
  const project = inheritedResourceProject(owner)
  const repository = workspace.repositories.find((repository) => repository.id === project)
  const ownerAgent = invocation
    ? resolveTaskAgent(owner, workspace.agents)
    : (agent ?? resolveTaskAgent(task, workspace.agents))
  return applyBotResources(
    mergeResources(resolveScopedSettings(defaults, repository).resources, ownerAgent?.resources),
    owner.bot,
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
  nativeSkills: readonly NativeSkill[] = [],
): ResourceSuggestion[] {
  const needle = query.toLowerCase()
  if (trigger === '#' || trigger === '@file:') return []
  const items: ResourceSuggestion[] =
    trigger === '@'
      ? resources.mcpServers
          .filter((server) => server.enabled)
          .map((server) => ({ kind: 'mcp' as const, name: server.name, enabled: true }))
      : [
          ...resources.skills,
          ...nativeSkills
            .filter(
              (skill) =>
                !resources.skills.some(
                  (configured) => configured.name.toLowerCase() === skill.name.toLowerCase(),
                ),
            )
            .map((skill) => ({ ...skill, enabled: true })),
        ].map((skill) => ({
          kind: 'skill' as const,
          name: skill.name,
          description: skill.description,
          enabled: skill.enabled,
        }))
  return items
    .filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        (item.kind === 'skill' && item.description?.toLowerCase().includes(needle)),
    )
    .sort(
      (a, b) =>
        Number(b.name.toLowerCase().includes(needle)) -
          Number(a.name.toLowerCase().includes(needle)) ||
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

export const mentionsSkill = (text: string, name: string) =>
  mentioned(text, '$', name) || mentioned(text, '/', name, true)

/** Skills (by $name or a leading /name) and enabled MCP servers (by @name) a message names. */
export function mentionedResources(text: string, resources: ResourceSettings) {
  const prose = maskFileMentions(text).replace(/(^|\s)@(thread:|file(?=\s|$))/gi, '$1$2')
  return {
    skills: resources.skills.filter((skill) => mentionsSkill(prose, skill.name)),
    mcpServers: resources.mcpServers.filter(
      (server) => server.enabled && mentioned(prose, '@', server.name),
    ),
  }
}

/** Built-in "/" commands, listed before skills at the start of a line. */
export type ComposerCommand = {
  id: 'review' | 'compact' | 'new-session' | 'goal'
  name: string
  description: string
}
export const composerCommands: readonly ComposerCommand[] = [
  { id: 'goal', name: 'goal', description: 'Set, view or clear a native agent goal' },
  { id: 'review', name: 'review', description: 'Ask the agent to review its changes' },
  { id: 'compact', name: 'compact', description: 'Summarize older agent context' },
  { id: 'new-session', name: 'new-session', description: 'Start the agent fresh next message' },
]
export function commandSuggestions(query: string, provider?: string, nativeGoals = false) {
  const needle = query.toLowerCase()
  return composerCommands.filter(
    (command) =>
      command.name.startsWith(needle) &&
      (command.id !== 'goal' ||
        provider === 'claude' ||
        provider === 'codex' ||
        (provider === 'opencode' && nativeGoals)),
  )
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
