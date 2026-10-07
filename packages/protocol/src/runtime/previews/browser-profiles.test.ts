import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema.js'
import { browserProfilesSchema } from './browser-profiles'
it('requires a default profile, unique safe IDs, and meaningful names', () => {
  const valid = (profiles: unknown) => decodeResult(browserProfilesSchema, profiles).success
  const base = { id: 'default', name: 'Default' }
  expect(valid([base, { id: 'work', name: 'Work' }])).toBe(true)
  for (const profiles of [
    [],
    [{ id: 'work', name: 'Work' }],
    [base, base],
    [base, { id: '../outside', name: 'Work' }],
    [base, { id: 'work', name: '   ' }],
  ])
    expect(valid(profiles)).toBe(false)
})
