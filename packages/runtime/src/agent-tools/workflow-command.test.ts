import { expect, it } from 'vite-plus/test'
import { workflowCommand } from './workflow-command.js'

const plan = {
  action: 'create',
  id: 'review',
  name: 'Review',
  phases: [{ id: 'read', title: 'Read' }],
}
it('validates structured and encoded phase lists', () => {
  for (const phases of [plan.phases, JSON.stringify(plan.phases)])
    expect(workflowCommand({ ...plan, phases })).toEqual(plan)
  for (const command of [
    { action: 'list' },
    { action: 'read', id: 'review' },
    { action: 'attach', id: 'review', phaseId: 'read', childId: 'child-42' },
  ])
    expect(workflowCommand(command)).toEqual(command)
})
it.each(['null', '{}', '[]', 'true', '42', '[{}]', '[{"id":"read"}]'])(
  'rejects invalid encoded phases: %s',
  (phases) => {
    expect(() => workflowCommand({ ...plan, phases })).toThrow('phases')
  },
)
it('rejects malformed JSON and fields that do not belong to the action', () => {
  expect(() => workflowCommand({ ...plan, phases: 'private-metadata{' })).toThrow(
    'Workflow phases must contain a valid JSON array.',
  )
  expect(() => workflowCommand({ action: 'list', phases: plan.phases })).toThrow('phases')
  expect(() => workflowCommand({ ...plan, execute: true })).toThrow('execute')
})
