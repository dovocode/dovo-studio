import { expect, it } from 'vite-plus/test'
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

it('offers Cursor native modes and safely falls back from unsupported approval policies', async () => {
  const { resolveProviderAccess, changeAgentProvider, defaultTaskHarness } =
    await import('../index.js')
  expect(selectableAccessModes('full-access', 'cursor').map((mode) => mode.id)).toEqual([
    'read-only',
    'auto',
    'full-access',
  ])
  expect(supportsAccess('cursor', 'ask')).toBe(false)
  expect(supportsAccess('cursor', 'workspace-write')).toBe(false)
  expect(resolveProviderAccess('cursor', 'ask')).toBe('read-only')
  expect(resolveProviderAccess('cursor', 'auto')).toBe('auto')
  expect(
    changeAgentProvider(
      { ...defaultTaskHarness('codex'), id: 'a', name: 'A', permission: 'ask' },
      'cursor',
    ).permission,
  ).toBe('read-only')
})
