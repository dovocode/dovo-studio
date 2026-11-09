import { expect, it } from 'vite-plus/test'
import { goalCommand, goalCommandText } from './goal-command.js'
import { commandSuggestions } from '../presentation/resource-mentions.js'

it.each([
  ['/goal', { action: 'get' }],
  [' /goal clear\n', { action: 'clear' }],
  ['/goal pause', { action: 'pause' }],
  ['/goal resume', { action: 'resume' }],
  ['/goal Fix the tests\nand lint', { action: 'set', objective: 'Fix the tests\nand lint' }],
  ['/goal edit New objective', { action: 'set', objective: 'New objective' }],
])('parses explicit native goal command %s', (input, expected) => {
  expect(goalCommand(input)).toEqual(expected)
  expect(goalCommand(goalCommandText(goalCommand(input)!))).toEqual(expected)
})

it('does not interpret quoted commands or other slash commands', () => {
  for (const input of ['Please use /goal', '```\n/goal clear\n```', '/goals clear', '/goal-clear'])
    expect(goalCommand(input)).toBeUndefined()
  expect(() => goalCommand('/goal edit')).toThrow('edit <objective>')
  expect(() => goalCommand(`/goal ${'x'.repeat(4001)}`)).toThrow('4,000')
  expect(goalCommand(`/goal ${'x'.repeat(4000)}`)?.action).toBe('set')
})

it('offers goals only on supported providers', () => {
  for (const provider of ['claude', 'codex'])
    expect(commandSuggestions('go', provider).map((item) => item.id)).toEqual(['goal'])
  for (const provider of [undefined, 'acp', 'opencode'])
    expect(commandSuggestions('go', provider)).toEqual([])
})
