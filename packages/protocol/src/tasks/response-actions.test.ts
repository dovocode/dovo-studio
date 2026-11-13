import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema'
import {
  responseActionSchema,
  resolveResponseAction,
  type ResponseAction,
  type ResponseDispatch,
} from './thread-actions'

const form: ResponseAction = {
  kind: 'form',
  description: 'Release options',
  fields: [
    {
      id: 'target',
      label: 'Target',
      type: 'choice',
      required: true,
      options: [{ value: 'beta', label: 'Beta' }],
    },
    { id: 'notes', label: 'Notes', type: 'multiline', value: 'Ready' },
  ],
  actions: [
    { id: 'send', title: 'Plan', action: { kind: 'prompt', prompt: 'Plan {{target}}: {{notes}}' } },
    {
      id: 'tool',
      title: 'Release',
      action: {
        kind: 'mcp',
        server: 'release',
        tool: 'start',
        arguments: { target: '{{target}}', nested: ['{{notes}}', 42, true] },
      },
    },
  ],
}
it('resolves native form values as plain data, with shared field validation', () => {
  expect(decode(responseActionSchema, form)).toEqual(form)
  expect(resolveResponseAction(form, { actionId: 'send', values: { target: 'beta' } })).toEqual({
    kind: 'prompt',
    prompt: 'Plan beta: Ready',
  })
  expect(
    resolveResponseAction(form, {
      actionId: 'tool',
      values: { target: 'beta', notes: '{{target}}' },
    }),
  ).toEqual({
    kind: 'mcp',
    server: 'release',
    tool: 'start',
    arguments: { target: 'beta', nested: ['{{target}}', 42, true] },
  })
  const invalid: Array<[ResponseDispatch | undefined, string]> = [
    [undefined, 'Complete the action form'],
    [{ actionId: 'missing', values: {} }, 'Choose an available form action'],
    [{ actionId: 'send', values: {} }, 'Complete Target'],
    [{ actionId: 'send', values: { target: 'prod' } }, 'Choose a valid option'],
    [{ actionId: 'send', values: { target: 'beta', extra: 'x' } }, 'unknown field'],
  ]
  for (const [dispatch, message] of invalid)
    expect(() => resolveResponseAction(form, dispatch)).toThrow(message)
})
it('rejects duplicate IDs and unknown template fields', () => {
  if (form.kind !== 'form') throw Error('Expected form')
  expect(() =>
    resolveResponseAction(
      { ...form, fields: [...form.fields, form.fields[0]] },
      { actionId: 'send', values: { target: 'beta' } },
    ),
  ).toThrow('unique')
  expect(() =>
    resolveResponseAction(
      {
        ...form,
        actions: [{ id: 'send', title: 'Send', action: { kind: 'prompt', prompt: '{{unknown}}' } }],
      },
      { actionId: 'send', values: { target: 'beta' } },
    ),
  ).toThrow('Unknown form field')
})
