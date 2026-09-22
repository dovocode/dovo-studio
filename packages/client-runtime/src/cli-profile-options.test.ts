import { expect, it } from 'vitest'
import { cliProfileOptions } from './cli-profile-options.js'

it('keeps a saved account when discovery is unavailable or returns different accounts', () => {
  expect(cliProfileOptions([], 'work', 'CLI default')).toEqual([
    { id: '', name: 'CLI default' },
    { id: 'work', name: 'work · Current selection' },
  ])
  expect(
    cliProfileOptions([{ id: 'personal', name: 'Personal', active: true }], 'work', 'CLI default'),
  ).toContainEqual({ id: 'work', name: 'work · Current selection' })
})

it('marks active accounts without selecting them and deduplicates profile IDs', () => {
  expect(
    cliProfileOptions(
      [
        { id: 'work', name: 'Work', username: 'dominic' },
        { id: 'work', name: 'Work', username: 'dominic', active: true },
      ],
      'work',
      'Choose profile',
    ),
  ).toEqual([
    { id: '', name: 'Choose profile' },
    { id: 'work', name: 'Work · dominic · Active' },
  ])
})
