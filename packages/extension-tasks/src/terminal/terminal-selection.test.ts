import { expect, it } from 'vite-plus/test'
import { terminalSelection, terminalSelectionIsCurrent } from './terminal-selection'

it('preserves editable terminal selections and rejects empty or oversized selections', () => {
  expect(terminalSelection('  output\n  next  ')).toBe('  output\n  next  ')
  expect(terminalSelection(' \n')).toBeNull()
  expect(terminalSelection('a'.repeat(100_000))).toHaveLength(100_000)
  expect(() => terminalSelection('a'.repeat(100_001))).toThrow('too large')
})

it('rejects stale terminal selections after switching computers or threads', () => {
  const owner = JSON.stringify(['computer-a', 'thread'])
  expect(terminalSelectionIsCurrent(owner, 'thread', owner, 'thread')).toBe(true)
  expect(
    terminalSelectionIsCurrent(owner, 'thread', JSON.stringify(['computer-b', 'thread']), 'thread'),
  ).toBe(false)
  expect(
    terminalSelectionIsCurrent(owner, 'thread', JSON.stringify(['computer-a', 'other']), 'other'),
  ).toBe(false)
  expect(terminalSelectionIsCurrent(owner, 'thread', owner, undefined)).toBe(false)
})
