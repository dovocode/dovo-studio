import { expect, it } from 'vite-plus/test'
import { studioToolCommand } from './tool-definitions.js'

const commands = [
  { name: 'studio_threads', command: { action: 'read', id: 'thread-42' } },
  {
    name: 'studio_automations',
    command: { action: 'run', id: 'workflow-42', requestId: 'run-42' },
  },
  { name: 'studio_browsers', command: { action: 'snapshot', id: 'tab-42' } },
  { name: 'studio_ui', command: { action: 'theme-set', sessionId: 'ui-42', mode: 'dark' } },
  { name: 'studio_diagnostics', command: { action: 'health' } },
]
it.each(commands)('validates structured and encoded $name commands', ({ name, command }) => {
  for (const value of [command, JSON.stringify(command)])
    expect(studioToolCommand(name, { command: value, runtimeId: 'runtime-42' })).toEqual(command)
})
it.each(commands)(
  'rejects a misplaced target before $name can run locally',
  ({ name, command }) => {
    for (const value of [
      { ...command, runtimeId: 'remote' },
      JSON.stringify({ ...command, runtimeId: 'remote' }),
    ])
      expect(() => studioToolCommand(name, { command: value })).toThrow(
        'Put runtimeId beside command',
      )
  },
)
it.each([
  'null',
  '[]',
  'true',
  '42',
  '"nested-string"',
  '{}',
  '{"action":"other"}',
  '{"action":"read"}',
])('rejects invalid encoded Studio commands: %s', (command) => {
  expect(() => studioToolCommand('studio_threads', { command })).toThrow(/Expected|Missing/)
})
it('rejects malformed metadata without echoing it', () => {
  expect(() => studioToolCommand('studio_threads', { command: 'private-metadata{' })).toThrow(
    'Studio command must contain a valid JSON object.',
  )
  expect(() => studioToolCommand('other', { command: {} })).toThrow('Unknown Studio tool')
})
