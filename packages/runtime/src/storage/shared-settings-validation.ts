import {
  catalogSkillSource,
  type ScopedSettingsValue,
  type SharedSettingsEntry,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { validateDefaultHarness } from './runtime-defaults.js'

export function validatePrompts(value: ScopedSettingsValue) {
  const agents = value.agents ?? []
  if (
    new Set(agents.map((agent) => agent.id)).size !== agents.length ||
    new Set(agents.map((agent) => agent.name.trim().toLowerCase())).size !== agents.length
  )
    throw new HttpError(400, 'Agent configurations require unique IDs and names in each scope.')
  for (const agent of agents) {
    validateDefaultHarness(agent)
  }
  const prompts = value.prompts ?? []
  if (
    prompts.some((prompt) => !/^[\w.-]+$/.test(prompt.name) || !prompt.text.trim()) ||
    new Set(prompts.map((prompt) => prompt.name.toLowerCase())).size !== prompts.length
  )
    throw new HttpError(
      400,
      'Prompts require nonempty text and unique names using letters, numbers, dots, dashes or underscores.',
    )
}
export function prepareShared(value: ScopedSettingsValue): ScopedSettingsValue {
  if (value.agents)
    value = {
      ...value,
      agents: value.agents.map((agent) => ({
        ...agent,
        resources: prepareShared({ resources: agent.resources }).resources,
      })),
    }
  if (!value.resources) return value
  return {
    ...value,
    resources: {
      ...value.resources,
      skills: value.resources.skills.map((skill) => {
        if (!skill.sourcePath) return skill
        if (!catalogSkillSource(skill))
          throw new HttpError(
            400,
            'Local skill supporting files belong to this environment. Use instructions only for shared skills, or keep the skill in an environment-specific scope.',
          )
        return { ...skill, sourcePath: undefined }
      }),
    },
  }
}
export function validateShared(value: ScopedSettingsValue) {
  validatePrompts(value)
  for (const agent of value.agents ?? []) {
    if (agent.acpInstallationId)
      throw new HttpError(400, 'Installed ACP agents belong to one environment.')
    validateShared({ resources: agent.resources })
  }
  if (value.resources?.skills.some((skill) => skill.sourcePath))
    throw new HttpError(400, 'Shared skills cannot contain environment-specific file paths.')
  if (
    value.resources?.mcpServers.some(
      (server) =>
        Object.keys(server.envValues ?? {}).length || Object.keys(server.headerValues ?? {}).length,
    )
  )
    throw new HttpError(
      400,
      'Shared MCP settings must reference environment variables. Keep literal credentials in environment-specific overrides.',
    )
  if (value.taskDefaults?.harness?.acpInstallationId)
    throw new HttpError(
      400,
      'Installed ACP agents belong to one environment. Select them in an environment-specific scope.',
    )
}
export function validateSharedEntry(entry: SharedSettingsEntry) {
  if (entry.key !== 'global' && !/^project:[^/\s]+\/[^\r\n]+$/.test(entry.key))
    throw new HttpError(400, 'Invalid shared project identity')
  validateShared(entry.value)
}
