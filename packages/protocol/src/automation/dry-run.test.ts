import { expect, it } from 'vite-plus/test'
import type { Automation, AutomationData } from '../workspace.js'
import {
  automationDryRunCounts,
  automationDryRunDefaults,
  automationDryRunFields,
  automationDryRunRequest,
} from './dry-run.js'
import { defaultGithubTrigger } from './triggers.js'

const data: AutomationData = {
  kind: 'trigger',
  label: 'Trigger',
  trigger: 'webhook',
  schedule: '',
  timezone: 'UTC',
  objective: '',
  agentId: '',
  repositoryId: '',
}
function flow(trigger: Partial<AutomationData>, monitor?: Automation['monitor']): Automation {
  return {
    id: 'flow',
    name: 'Flow',
    monitor,
    nodes: [
      {
        id: 'trigger',
        type: 'automation',
        position: { x: 0, y: 0 },
        data: { ...data, ...trigger },
      },
      {
        id: 'review',
        type: 'automation',
        position: { x: 0, y: 0 },
        data: { ...data, kind: 'review', label: 'Review' },
      },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'review' }],
  }
}

it('generates sample input that matches each trigger', () => {
  const now = Date.parse('2026-11-16T10:00:00Z')
  expect(automationDryRunDefaults(flow({ trigger: 'manual' }), now)).toEqual({})
  expect(
    automationDryRunDefaults(flow({ trigger: 'once', runAt: '2026-12-01T08:30' }), now)
      .scheduledFor,
  ).toBe('2026-12-01T08:30:00.000Z')
  // An invalid schedule leaves the time for the person to enter.
  expect(automationDryRunDefaults(flow({ trigger: 'schedule', schedule: 'nope' }), now)).toEqual({})
  const github = automationDryRunDefaults(
    flow({
      trigger: 'github',
      github: { ...defaultGithubTrigger, repository: 'acme/app', event: 'pull_request.opened' },
    }),
    now,
  )
  expect(github.payload).toMatchObject({
    event: 'pull_request.opened',
    actor: 'octocat',
    context: {
      repository: 'github.com/acme/app',
      item: { url: 'https://github.com/acme/app/pull/1' },
    },
  })
  expect(
    automationDryRunDefaults(flow({ trigger: 'manual' }, { url: 'https://example.com' })),
  ).toEqual({ sourceText: 'Sample source content' })
})

it('builds a request from the form and rejects invalid sample input', () => {
  const webhook = flow({ trigger: 'webhook' }, { url: 'https://example.com' })
  const fields = automationDryRunFields(webhook)
  expect(JSON.parse(fields.payload)).toMatchObject({ event: 'sample' })
  expect(
    automationDryRunRequest(webhook, {
      ...fields,
      payload: ' ',
      sourceUnchanged: true,
      stopAt: 'review',
    }),
  ).toEqual({
    flow: webhook,
    input: { payload: {}, sourceText: 'Sample source content', sourceUnchanged: true },
    stopAt: 'review',
  })
  expect(() => automationDryRunRequest(webhook, { ...fields, payload: '{' })).toThrow(
    'Enter the sample payload as JSON.',
  )
  // A trigger is not a stop point, and fields for other triggers are not sent.
  expect(
    automationDryRunRequest(flow({ trigger: 'manual' }), { ...fields, stopAt: 'trigger' }),
  ).toEqual({ flow: flow({ trigger: 'manual' }), input: {} })
  const schedule = flow({ trigger: 'schedule', schedule: '0 9 * * *' })
  expect(
    automationDryRunRequest(schedule, { ...fields, scheduledFor: '2026-11-17T10:00+01:00' }).input,
  ).toEqual({ scheduledFor: '2026-11-17T09:00:00.000Z' })
  expect(() => automationDryRunRequest(schedule, { ...fields, scheduledFor: 'tomorrow' })).toThrow(
    /ISO date and time/,
  )
})

it('counts step results for the summary', () => {
  const step = { nodeId: 'n', label: 'n', kind: 'task', inputs: [] }
  expect(
    automationDryRunCounts({
      steps: [
        { ...step, status: 'ran' },
        { ...step, status: 'simulated' },
        { ...step, status: 'simulated' },
        { ...step, status: 'not-reached' },
      ],
    }),
  ).toEqual({ ran: 1, simulated: 2, notReached: 1 })
})
