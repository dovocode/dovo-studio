import { Effect, Schema } from 'effect'
import {
  isoDateTime,
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  superRefine,
  uuidSchema,
} from '../shared/schema.js'
import { managedSkillSchema, mcpServerSchema, type ResourceSettings } from '../shared/resources.js'

/** A Bot is one persistent coordinator thread. Its id is the thread id. Harness, model,
 * permissions remain ordinary thread settings. A Bot is standalone: it belongs to no project, and
 * its thread runs in Dovo's internal no-project workspace (`SCRATCH_PROJECT_ID`). */
export const botRoleSchema = maxValue(minValue(Schema.String, 1), 120).pipe(
  Schema.check(Schema.isPattern(/\S/)),
)
export const botResponsibilitiesSchema = maxValue(Schema.String, 8000)
export const botStateSchema = Schema.Literals(['active', 'paused'])
const resourceName = maxValue(minValue(Schema.String, 1), 80)
const names = maxValue(mutableArray(resourceName), 100).pipe(
  Schema.withDecodingDefaultType(Effect.sync(() => [])),
)
/** MCP servers and skills of one Bot only. They never change the shared agent, profile,
 * project or another Bot, and they stay when the Bot's harness changes.
 *
 * Effective resources = inherited (global and computer settings, then agent; never project
 * settings, see `inheritedResourceProject`) with `disabled*` names turned off,
 * then this Bot's own definitions; an own definition replaces an inherited one by name.
 * Literal `envValues`/`headerValues` are projected to stored-secret references in every
 * client response, like other MCP settings. Send a reference back to keep it. */
export const botResourcesSchema = superRefine(
  mutableStruct({
    mcpServers: maxValue(mutableArray(mcpServerSchema), 30).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => [])),
    ),
    skills: maxValue(mutableArray(managedSkillSchema), 20).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => [])),
    ),
    /** Inherited MCP server names turned off for this Bot only. */
    disabledMcpServers: names,
    /** Inherited skill names turned off for this Bot only. */
    disabledSkills: names,
  }),
  (resources, context) => {
    for (const key of ['mcpServers', 'skills'] as const)
      if (new Set(resources[key].map((item) => item.name)).size !== resources[key].length)
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Names must be unique within this Bot',
        })
    if (resources.skills.reduce((size, skill) => size + skill.content.length, 0) > 200000)
      context.addIssue({
        code: 'custom',
        path: ['skills'],
        message: 'Skills exceed the 200 KB limit for this Bot',
      })
  },
)
export type BotResources = Schema.Schema.Type<typeof botResourcesSchema>
export const emptyBotResources = (): BotResources => ({
  mcpServers: [],
  skills: [],
  disabledMcpServers: [],
  disabledSkills: [],
})
/** Runtime-owned. Clients change it only through `/api/bots/*`; workspace edits cannot. */
export const botSchema = mutableStruct({
  role: botRoleSchema,
  responsibilities: botResponsibilitiesSchema,
  state: botStateSchema,
  revision: uuidSchema,
  createdAt: isoDateTime(Schema.String),
  updatedAt: isoDateTime(Schema.String),
  /** Absent means none of its own and nothing inherited turned off. */
  resources: Schema.optional(botResourcesSchema),
})
export type Bot = Schema.Schema.Type<typeof botSchema>
export type BotState = Schema.Schema.Type<typeof botStateSchema>

/** Paused Bots accept and queue input but start no new turns. */
export const botPaused = (task: { bot?: Bot | undefined }) => task.bot?.state === 'paused'

export const botPausedMessage = 'This Bot is paused. Resume it to start new work.'

/** Standing instructions added to every turn of a Bot's coordinator thread. */
export function botInstructions(bot: Bot) {
  return [
    `You are a persistent Dovo Bot. Your role: ${JSON.stringify(bot.role)}.`,
    bot.responsibilities.trim()
      ? `Your ongoing responsibilities, set by the user (standing instructions):\n${bot.responsibilities.trim()}`
      : '',
    'This thread is your permanent conversation. Keep continuity across turns. Use bot memory for durable notes about your responsibilities; Dovo memory tools do not share it with other threads. Never save credentials or secrets there. Your permissions are set by the user and cannot be changed by you.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The project whose scoped settings (resources) a thread inherits. A Bot is standalone: it
 * inherits global and computer settings only, also when an older Bot still has a project. */
export const inheritedResourceProject = (task: {
  repositoryId: string
  bot?: unknown
}): string | undefined => (task.bot ? undefined : task.repositoryId)

/** The resources a Bot's coordinator turns receive. Returns `inherited` unchanged for
 * other threads. Children of a Bot use their own settings, never these. */
export function applyBotResources(
  inherited: ResourceSettings,
  bot: Pick<Bot, 'resources'> | undefined,
): ResourceSettings {
  const own = bot?.resources
  if (!own) return inherited
  const off =
    (disabled: readonly string[]) =>
    <T extends { name: string; enabled: boolean }>(item: T): T =>
      disabled.includes(item.name) ? { ...item, enabled: false } : item
  const replaced = <T extends { name: string }>(items: readonly T[], mine: readonly T[]) =>
    items.filter((item) => !mine.some((entry) => entry.name === item.name))
  return {
    ...(inherited.hooks ? { hooks: inherited.hooks } : {}),
    mcpServers: [
      ...replaced(inherited.mcpServers, own.mcpServers).map(off(own.disabledMcpServers)),
      ...own.mcpServers,
    ],
    skills: [...replaced(inherited.skills, own.skills).map(off(own.disabledSkills)), ...own.skills],
  }
}

export type BotResourceSource = 'inherited' | 'bot' | 'replaces-inherited'
export type BotResourceItem = {
  kind: 'mcp' | 'skill'
  name: string
  source: BotResourceSource
  /** Effective state for this Bot. */
  enabled: boolean
  /** Inherited only: the shared definition is enabled but this Bot turns it off. */
  disabledForBot: boolean
}
/** One row per effective MCP server and skill, for Bot resource settings. Inherited rows
 * toggle `disabledMcpServers`/`disabledSkills`; own rows edit `mcpServers`/`skills`. */
export function botResourceItems(
  inherited: ResourceSettings,
  bot: Pick<Bot, 'resources'> | undefined,
): BotResourceItem[] {
  const own = bot?.resources ?? emptyBotResources()
  const rows = (
    kind: 'mcp' | 'skill',
    shared: readonly { name: string; enabled: boolean }[],
    mine: readonly { name: string; enabled: boolean }[],
    disabled: readonly string[],
  ): BotResourceItem[] => [
    ...shared
      .filter((item) => !mine.some((entry) => entry.name === item.name))
      .map((item) => ({
        kind,
        name: item.name,
        source: 'inherited' as const,
        enabled: item.enabled && !disabled.includes(item.name),
        disabledForBot: disabled.includes(item.name),
      })),
    ...mine.map((item) => ({
      kind,
      name: item.name,
      source: shared.some((entry) => entry.name === item.name)
        ? ('replaces-inherited' as const)
        : ('bot' as const),
      enabled: item.enabled,
      disabledForBot: false,
    })),
  ]
  return [
    ...rows('mcp', inherited.mcpServers, own.mcpServers, own.disabledMcpServers),
    ...rows('skill', inherited.skills, own.skills, own.disabledSkills),
  ]
}
