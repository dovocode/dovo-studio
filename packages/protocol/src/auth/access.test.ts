import { expect, it } from 'vitest'
import {
  accessLabel,
  accessModes,
  selectableAccessModes,
  supportsAccess,
  supportsUtilities,
} from './access'

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

it('does not present Hermes approval policies as a read-only sandbox', () => {
  expect(supportsAccess('hermes', 'read-only')).toBe(false)
  for (const mode of accessModes) expect(supportsAccess('hermes', mode.id)).toBe(true)
})

it('restricts utilities to providers with a tool-disable boundary', () => {
  for (const provider of ['hermes', 'grok', 'muse'] as const) {
    expect(supportsUtilities(provider)).toBe(false)
    expect(supportsAccess(provider, 'read-only')).toBe(false)
  }
  expect(supportsUtilities('copilot')).toBe(true)
})
