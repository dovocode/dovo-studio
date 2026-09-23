import { decode } from './schema.js'
import { expect, it } from 'vitest'
import {
  daybreakChoices,
  modelCatalogSchema,
  modelServiceTiers,
  selectedCatalogModel,
  serviceTierValue,
} from './models'
import { agentSchema, resolveTaskAgent, taskModelSchema } from './workspace'
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
