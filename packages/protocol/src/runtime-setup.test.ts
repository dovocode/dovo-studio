import { expect, it } from 'vitest'
import { decode } from './schema'
import { defaultTaskHarness } from './workspace'
import { runtimeDefaultsSchema } from './runtime-setup'
import {
  resolveTitleHarness,
  titleGenerationSettingsSchema,
  titleSettingsForHarness,
} from './title-generation'

it('decodes older snapshots with an unconfigured provider default', () => {
  expect(decode(runtimeDefaultsSchema, {})).toEqual({
    configured: false,
    harness: defaultTaskHarness('codex'),
  })
})
it('preserves managed ACP selection and independent title model through serialization', () => {
  const agent = {
    ...defaultTaskHarness('acp'),
    id: 'installed',
    name: 'Installed',
    acpInstallationId: 'managed-agent',
    model: 'utility-model',
    reasoning: 'low',
  }
  const settings = decode(titleGenerationSettingsSchema, titleSettingsForHarness(agent))
  expect(settings).toMatchObject({
    harness: { acpInstallationId: 'managed-agent' },
    model: 'utility-model',
  })
  const harness = resolveTitleHarness(settings, [], {
    ...defaultTaskHarness('claude'),
    model: 'main-model',
  })
  expect(harness?.provider).toBe('acp')
  expect(harness?.acpInstallationId).toBe('managed-agent')
  expect(settings.model).toBe('utility-model')
})
