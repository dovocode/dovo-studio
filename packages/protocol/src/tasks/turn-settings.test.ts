import { expect, it } from 'vite-plus/test'
import { Schema } from 'effect'
import {
  agentTurnSettings,
  applyTurnSettings,
  sameTurnSettings,
  turnSettingsMatchHarness,
  type Agent,
  defaultTaskHarness,
  turnSettingsSchema,
} from '../workspace'

const agent: Agent = {
  ...defaultTaskHarness('codex'),
  id: 'agent',
  name: 'Default',
  model: 'old-model',
  permission: 'ask',
  serviceTier: 'priority',
  cyberAccessProgram: 'daybreakBlue',
  approvalPolicy: 'on-request',
  env: { BEFORE: 'yes' },
}

it('applies every composer setting to one turn without mutating the defaults', () => {
  const next = {
    ...agent,
    model: 'new-model',
    reasoning: 'high',
    permission: 'read-only' as const,
    serviceTier: undefined,
    cyberAccessProgram: undefined,
    approvalPolicy: 'never' as const,
    sandboxMode: 'read-only' as const,
    env: undefined,
    instructions: 'Review only',
  }
  const settings = agentTurnSettings(next, true)
  expect(
    sameTurnSettings(
      settings,
      Schema.decodeUnknownSync(turnSettingsSchema)(JSON.parse(JSON.stringify(settings))),
    ),
  ).toBe(true)
  const selected = applyTurnSettings(agent, settings)
  expect(selected).toMatchObject({
    id: 'agent',
    name: 'Default',
    model: 'new-model',
    reasoning: 'high',
    permission: 'read-only',
    approvalPolicy: 'never',
    sandboxMode: 'read-only',
    instructions: 'Review only',
  })
  expect(selected.env).toBeUndefined()
  expect(selected.serviceTier).toBeUndefined()
  expect(selected.cyberAccessProgram).toBeUndefined()
  expect(agent.model).toBe('old-model')
  expect(agent.permission).toBe('ask')
  expect(agent.serviceTier).toBe('priority')
  expect(settings.harness).not.toHaveProperty('id')
})

it('compares the full configuration and keeps the provider and installation locked', () => {
  const settings = agentTurnSettings({ ...agent, env: { A: '1', B: '2' } }, true)
  expect(
    sameTurnSettings(settings, agentTurnSettings({ ...agent, env: { B: '2', A: '1' } }, true)),
  ).toBe(true)
  expect(
    sameTurnSettings(settings, agentTurnSettings({ ...agent, permission: 'full-access' }, true)),
  ).toBe(false)
  expect(turnSettingsMatchHarness(settings, agent)).toBe(true)
  expect(
    turnSettingsMatchHarness({ ...settings, harness: { ...agent, provider: 'claude' } }, agent),
  ).toBe(false)
  expect(
    turnSettingsMatchHarness(
      { ...settings, harness: { ...agent, acpInstallationId: 'other' } },
      agent,
    ),
  ).toBe(false)
})

it('keeps existing model-only messages compatible', () => {
  const settings = agentTurnSettings({ ...agent, model: 'new-model', reasoning: 'low' })
  expect(settings).toEqual({ provider: 'codex', model: 'new-model', reasoning: 'low' })
  const selected = applyTurnSettings(agent, settings)
  expect(selected.permission).toBe('ask')
  expect(selected.env).toEqual(agent.env)
  expect(selected.serviceTier).toBeUndefined()
})
