import { expect, it } from 'vitest'
import { builtInAgentPresets, pendingAgentPresets } from './agent-presets'
import { agentSchema, defaultTaskHarness } from '../workspace'
import { decode } from '../shared/schema'
import { runtimeDefaultsSchema } from '../runtime/connection/runtime-setup'
import { resolveScopedAgents, scopedAgentEntries } from '../runtime/connection/scoped-settings'
it('syncs a newer baseline without considering an explicit server override outdated', () => {
  const preset = { ...defaultTaskHarness('codex'), id: 'preset', name: 'Default' }
  const saved = { ...preset, endpoint: '/server/codex', globalPreset: preset, serverOverride: true }
  expect(pendingAgentPresets([preset], [saved])).toEqual([])
  const updated = { ...preset, instructions: 'Format before finishing' }
  expect(pendingAgentPresets([updated], [saved])).toEqual([updated])
  expect(pendingAgentPresets([preset], [])).toEqual([preset])
})

it('provides ready-to-configure profiles with stable identities and provider-owned model defaults', () => {
  const presets = builtInAgentPresets()
  expect(presets.map((agent) => agent.name)).toEqual([
    'Codex',
    'Claude Code',
    'OpenCode',
    'Cursor',
    'GitHub Copilot',
    'Hermes',
    'Grok Build',
    'Muse',
  ])
  expect(new Set(presets.map((agent) => agent.id)).size).toBe(presets.length)
  for (const preset of presets) {
    expect(decode(agentSchema, preset)).toEqual(preset)
    expect(preset.model).toBe('')
    expect(preset.endpoint).toBe('')
    expect(preset.executablePath).toBeUndefined()
    expect(preset.configDirectory).toBeUndefined()
  }
  presets[0].instructions = 'Do not share mutable state'
  expect(builtInAgentPresets()[0].instructions).toBe('')
})

it('inherits built-in profiles, overrides them by ID and restores them when an override is removed', () => {
  const codex = builtInAgentPresets()[0]
  const global = { ...codex, model: 'global-model' }
  const computer = { ...global, model: 'computer-model' }
  const runtime = decode(runtimeDefaultsSchema, {
    scopedSettings: {
      environment: { agents: [computer] },
      shared: [{ key: 'global', updatedAt: 1, changeId: 'one', value: { agents: [global] } }],
    },
  })
  expect(
    scopedAgentEntries(runtime, undefined, [], 'global').find(
      (entry) => entry.agent.id === codex.id,
    ),
  ).toEqual({ agent: codex, scope: 'built-in' })
  expect(
    resolveScopedAgents(runtime, undefined, []).filter((agent) => agent.id === codex.id),
  ).toEqual([computer])
  runtime.scopedSettings!.environment.agents = []
  expect(
    resolveScopedAgents(runtime, undefined, []).find((agent) => agent.id === codex.id),
  ).toEqual(global)
  runtime.scopedSettings!.shared[0].value.agents = []
  expect(
    resolveScopedAgents(runtime, undefined, []).find((agent) => agent.id === codex.id),
  ).toEqual(codex)
  const custom = { ...defaultTaskHarness('claude'), id: 'existing', name: 'Reviewer' }
  expect(resolveScopedAgents(undefined, undefined, [custom])).toContainEqual(custom)
})
