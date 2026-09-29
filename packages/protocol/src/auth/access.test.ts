import { expect, it } from 'vitest'
import { accessLabel, accessModes, selectableAccessModes } from './access'

it('offers four access modes while retaining existing read-only selections', () => {
  expect(accessModes.map((mode) => mode.id)).toEqual([
    'ask',
    'workspace-write',
    'auto',
    'full-access',
  ])
  expect(selectableAccessModes().map((mode) => mode.id)).toEqual(accessModes.map((mode) => mode.id))
  expect(selectableAccessModes('read-only').at(-1)?.id).toBe('read-only')
  expect(accessLabel('read-only')).toBe('Read only')
})
