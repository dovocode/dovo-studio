import { expect, it } from 'vite-plus/test'
import { responsePrepareCommand } from './response-prepare-command.js'

const offer = { key: 'check-tests', title: 'Check tests' }
const actions = [
  { kind: 'prompt', prompt: 'Continue here' },
  { kind: 'command', command: 'pnpm test' },
  { kind: 'mcp', server: 'issues', tool: 'read', arguments: { id: 42 } },
  {
    kind: 'form',
    description: 'Choose a label',
    fields: [{ id: 'label', label: 'Label', type: 'text' }],
    actions: [{ id: 'send', title: 'Send', action: { kind: 'prompt', prompt: 'Use {{label}}' } }],
  },
]

it.each(actions)('validates structured and encoded review actions: %s', (action) => {
  for (const value of [action, JSON.stringify(action)]) {
    expect(responsePrepareCommand({ ...offer, action: value })).toEqual({ ...offer, action })
  }
})

it.each([
  'null',
  '[]',
  'true',
  '42',
  '"nested-string"',
  '{}',
  '{"kind":"other"}',
  '{"kind":"command"}',
  '{"kind":"command","command":"pnpm test","execute":true}',
])('rejects malformed or unsupported actions without execution: %s', (action) => {
  expect(() => responsePrepareCommand({ ...offer, action })).toThrow(/action[.:]/)
})

it('rejects invalid JSON and excess envelope fields', () => {
  expect(() => responsePrepareCommand({ ...offer, action: 'private-metadata{' })).toThrow(
    'Response action must contain a valid JSON object.',
  )
  expect(() => responsePrepareCommand({ ...offer, action: actions[0], runNow: true })).toThrow(
    'runNow: Expected no excess property',
  )
})
