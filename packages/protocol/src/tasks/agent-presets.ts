import type { Agent } from '../workspace.js'
/** An explicit server override keeps its launch settings while receiving a newer baseline. */
export function pendingAgentPresets(presets: readonly Agent[], agents: readonly Agent[]) {
  return presets.filter((preset) => {
    const saved = agents.find((agent) => agent.id === preset.id)
    return !saved || JSON.stringify(saved.globalPreset) !== JSON.stringify(preset)
  })
}
