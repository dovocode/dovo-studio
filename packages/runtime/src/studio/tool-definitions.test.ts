import { expect, it } from 'vite-plus/test'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js'
import { noStudioTools } from '@dovo/protocol'
import { studioToolCommand, studioToolDefinitions } from './tool-definitions.js'

it('validates both restore definitions through the advertised automation schema', () => {
  const tool = studioToolDefinitions({ ...noStudioTools(), automations: true }).find(
    (entry) => entry.name === 'studio_automations',
  )
  if (!tool) throw new Error('Missing automation tool')
  const validate = new AjvJsonSchemaValidator().getValidator(ToolSchema.parse(tool).inputSchema)
  const definition = { id: 'flow', name: 'Flow', nodes: [], edges: [] }
  const command = { action: 'restore', id: 'run', expected: definition, definition }
  expect(validate({ command }).valid).toBe(true)
  for (const enabled of [true, false, null])
    expect(
      validate({ command: { ...command, definition: { ...definition, enabled } } }).valid,
    ).toBe(true)
  expect(
    validate({ command: { ...command, definition: { ...definition, enabled: 'true' } } }).valid,
  ).toBe(false)
  expect(
    validate({ command: { ...command, definition: { ...definition, future: true } } }).valid,
  ).toBe(true)
  for (const field of ['expected', 'definition']) {
    for (const invalid of [null, { id: 'flow' }, { ...definition, nodes: 'invalid' }]) {
      expect(validate({ command: { ...command, [field]: invalid } }).valid).toBe(false)
    }
  }
})

const commands = [
  { name: 'studio_threads', command: { action: 'read', id: 'thread-42' } },
  {
    name: 'studio_automations',
    command: { action: 'run', id: 'workflow-42', requestId: 'run-42' },
  },
  {
    name: 'studio_automations',
    command: {
      action: 'dryRun',
      automation: { id: 'workflow-42', name: 'Workflow', nodes: [], edges: [] },
      input: { payload: { ref: 'main' }, sourceUnchanged: true },
      stopAt: 'task-42',
    },
  },
  { name: 'studio_browsers', command: { action: 'snapshot', id: 'tab-42' } },
  { name: 'studio_browsers', command: { action: 'elements', id: 'tab-42' } },
  { name: 'studio_browsers', command: { action: 'certificate', id: 'tab-42' } },
  { name: 'studio_ui', command: { action: 'theme-set', sessionId: 'ui-42', mode: 'dark' } },
  { name: 'studio_diagnostics', command: { action: 'health' } },
  { name: 'studio_diagnostics', command: { action: 'event', id: 'event-42', offset: 8000 } },
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
