import { decode } from '../shared/schema.js'
import { expect, it } from 'vitest'
import {
  daybreakChoices,
  modelDisplayName,
  modelCatalogChoices,
  modelDiscoveryInput,
  modelCatalogSchema,
  modelServiceTiers,
  selectedCatalogModel,
  serviceTierValue,
} from './models'
import { agentSchema, resolveTaskAgent, taskModelSchema, defaultTaskHarness } from '../workspace'

it('uses host display names, formats raw versioned GPT IDs and keeps custom identifiers intact', () => {
  expect(modelDisplayName('gpt-5.1-sol')).toBe('GPT-5.1-Sol')
  expect(modelDisplayName('openai/gpt-6.1-sol')).toBe('openai/GPT-6.1-Sol')
  expect(modelDisplayName('gpt-6.1-sol', 'GPT-6.1 Sol')).toBe('GPT-6.1 Sol')
  expect(modelDisplayName('gpt-test')).toBe('gpt-test')
  expect(modelDisplayName('my-custom-name')).toBe('my-custom-name')
  expect(
    modelCatalogChoices([
      { id: 'openai/gpt-5.1-sol', name: 'GPT-5.1-Sol' },
      { id: 'azure/gpt-5.1-sol', name: 'GPT-5.1-Sol' },
    ]).map((model) => model.name),
  ).toEqual(['GPT-5.1-Sol · openai', 'GPT-5.1-Sol · azure'])
})

it('canonicalizes discovery settings without losing environment or ACP configuration', () => {
  const agent = { ...defaultTaskHarness('codex'), env: { Z: 'last', A: 'first' }, model: 'one' }
  expect(JSON.stringify(modelDiscoveryInput(agent))).toBe(
    JSON.stringify(modelDiscoveryInput({ ...agent, env: { A: 'first', Z: 'last' }, model: 'two' })),
  )
  expect(
    modelDiscoveryInput({
      ...agent,
      provider: 'acp',
      acpInstallationId: 'installed',
      acpMode: 'plan',
      acpConfig: { option: 'value' },
    }),
  ).toMatchObject({
    model: 'one',
    acpInstallationId: 'installed',
    acpMode: 'plan',
    acpConfig: { option: 'value' },
  })
})
it('discovers Fast for the default model without assuming priority and preserves saved tiers', () => {
  const catalog = decode(modelCatalogSchema, {
    models: [
      {
        id: 'model',
        name: 'Model',
        isDefault: true,
        serviceTiers: [
          {
            id: 'advertised-tier',
            name: 'Fast',
          },
        ],
      },
    ],
    reasoning: [],
  })
  expect(selectedCatalogModel(catalog, '')?.id).toBe('model')
  expect(modelServiceTiers(catalog, '').map((tier) => tier.id)).toEqual([
    'default',
    'advertised-tier',
  ])
  expect(modelServiceTiers(catalog, '', 'saved').map((tier) => tier.id)).toEqual([
    'default',
    'advertised-tier',
    'saved',
  ])
  expect(serviceTierValue('')).toBe('default')
  expect(serviceTierValue(undefined)).toBe('default')
})
it('only offers advertised Daybreak programs, retaining unavailable saved selections visibly', () => {
  const catalog = decode(modelCatalogSchema, {
    models: [],
    reasoning: [],
    codex: {
      daybreakPrograms: ['daybreakBlue'],
      fastModeBlocked: false,
    },
  })
  expect(daybreakChoices(catalog).map((choice) => choice.id)).toEqual([
    '',
    'standard',
    'daybreakBlue',
  ])
  expect(daybreakChoices(catalog, 'daybreakRed').at(-1)?.name).toContain('unavailable')
})
it('round trips per-task overrides independently of the custom agent', () => {
  const agent = decode(agentSchema, {
    id: 'agent',
    name: 'Agent',
    provider: 'codex',
    model: 'gpt-6-astra',
    instructions: '',
    permission: 'ask',
    endpoint: '',
    serviceTier: 'priority',
    cyberAccessProgram: 'daybreakBlue',
  })
  const overrides = decode(
    taskModelSchema,
    JSON.parse(
      JSON.stringify({
        serviceTier: 'default',
        cyberAccessProgram: 'standard',
      }),
    ),
  )
  expect(
    resolveTaskAgent(
      {
        id: 'task',
        agentId: agent.id,
        agentOverrides: overrides,
      },
      [agent],
    ),
  ).toMatchObject({
    serviceTier: 'default',
    cyberAccessProgram: 'standard',
    permission: 'ask',
  })
  expect(agent.cyberAccessProgram).toBe('daybreakBlue')
})
it('distinguishes inheriting custom-agent modes from explicitly clearing them over JSON', () => {
  const agent = decode(agentSchema, {
    id: 'agent',
    name: 'Agent',
    provider: 'codex',
    model: 'model',
    instructions: '',
    permission: 'ask',
    endpoint: '',
    serviceTier: 'priority',
    cyberAccessProgram: 'daybreakBlue',
  })
  const task = {
    id: 'task',
    agentId: agent.id,
  }
  expect(
    resolveTaskAgent(
      {
        ...task,
        agentOverrides: decode(taskModelSchema, {}),
      },
      [agent],
    ),
  ).toMatchObject({
    serviceTier: 'priority',
    cyberAccessProgram: 'daybreakBlue',
  })
  const cleared = decode(
    taskModelSchema,
    JSON.parse(
      JSON.stringify({
        serviceTier: null,
        cyberAccessProgram: null,
      }),
    ),
  )
  const resolved = resolveTaskAgent(
    {
      ...task,
      agentOverrides: cleared,
    },
    [agent],
  )
  expect(resolved?.serviceTier).toBeUndefined()
  expect(resolved?.cyberAccessProgram).toBeUndefined()
})
