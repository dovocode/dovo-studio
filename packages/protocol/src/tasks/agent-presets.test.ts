import { expect, it } from 'vitest'
import { pendingAgentPresets } from './agent-presets'
import { defaultTaskHarness } from '../workspace'
it('syncs a newer baseline without considering an explicit server override outdated', () => {
  const preset = { ...defaultTaskHarness('codex'), id: 'preset', name: 'Default' }
  const saved = { ...preset, endpoint: '/server/codex', globalPreset: preset, serverOverride: true }
  expect(pendingAgentPresets([preset], [saved])).toEqual([])
  const updated = { ...preset, instructions: 'Format before finishing' }
  expect(pendingAgentPresets([updated], [saved])).toEqual([updated])
  expect(pendingAgentPresets([preset], [])).toEqual([preset])
})
