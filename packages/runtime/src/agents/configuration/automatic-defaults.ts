import {
  configuredTaskHarness,
  defaultTaskHarness,
  titleSettingsForHarness,
  type Agent,
  type ModelCatalog,
} from '@dovo/protocol'
import type { Services } from '../../services.js'

/** Compare advertised family versions, not catalogue order or which model happens to be default. */
export function latestCodexModel(catalog: ModelCatalog, family: 'sol' | 'luna') {
  const candidates = catalog.models.flatMap((model) => {
    const match = /^gpt-(\d+(?:\.\d+)*)-(sol|luna)(?:$|-)/.exec(model.id)
    return !model.hidden && match?.[2] === family
      ? [{ model, version: match[1].split('.').map(Number) }]
      : []
  })
  candidates.sort((a, b) => {
    for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
      const difference = (b.version[i] ?? 0) - (a.version[i] ?? 0)
      if (difference) return difference
    }
    return b.model.id.localeCompare(a.model.id, undefined, { numeric: true })
  })
  return candidates[0]?.model.id
}

/** Called by the runtime launcher before publishing its first connection. No prompts or paid turns. */
export async function initializeAgentDefaults(
  s: Pick<Services, 'agents' | 'defaults' | 'titles' | 'db'>,
) {
  const before = s.defaults.get()
  if (configuredTaskHarness(before) && s.titles.hasSavedSettings()) return
  const codex: Agent = { ...defaultTaskHarness('codex'), id: 'automatic-defaults', name: 'Codex' }
  const adapter = await s.agents.get('codex')
  const available = (await adapter.probe(codex)).available
  let task = available
    ? { ...defaultTaskHarness('codex'), model: 'gpt-6.1-sol', reasoning: 'medium' }
    : { ...defaultTaskHarness('claude'), model: 'opus', reasoning: 'medium' }
  let title = { ...task, model: available ? 'gpt-6-luna' : 'sonnet', reasoning: 'low' }
  if (available && adapter.models) {
    try {
      const catalog = await adapter.models(codex)
      task = { ...task, model: latestCodexModel(catalog, 'sol') ?? task.model }
      title = { ...title, model: latestCodexModel(catalog, 'luna') ?? title.model }
    } catch (cause) {
      console.warn(
        'Could not discover Codex models for initial defaults; using bundled Sol/Luna defaults.',
        cause,
      )
    }
  }
  s.db.transaction(() => {
    const current = s.defaults.get()
    // User edits made during discovery take precedence over automatic setup.
    if (!configuredTaskHarness(current)) {
      s.defaults.save({
        ...current,
        harness: current.scopedSettings ? current.harness : task,
        ...(current.scopedSettings
          ? {
              scopedSettings: {
                ...current.scopedSettings,
                environment: {
                  ...current.scopedSettings.environment,
                  taskDefaults: {
                    ...current.scopedSettings.environment.taskDefaults,
                    harness: task,
                  },
                },
              },
            }
          : {}),
      })
    }
    if (!s.titles.hasSavedSettings())
      s.titles.save(titleSettingsForHarness({ ...title, id: 'automatic-title', name: 'Titles' }))
  })()
}
