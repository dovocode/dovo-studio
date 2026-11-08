import { expect, it } from 'vite-plus/test'
import { DurableState } from '@dovo/durable-connections'
import { decode } from '../../shared/schema.js'
import { scopedSettingsValueSchema, type SharedSettingsEntry } from '../../workspace.js'
import {
  sharedSettingsFromVersions,
  sharedSettingsVersions,
  sharedSettingsVersionEntry,
} from './shared-state-values.js'

it('retains concurrent category edits, resets and legacy values through duplicate delivery and restart', async () => {
  const storage = () => {
    let saved: unknown
    return {
      load: () => structuredClone(saved),
      save: (value: unknown) => {
        saved = structuredClone(value)
      },
    }
  }
  const leftStorage = storage()
  const open = (replicaId: string, store = storage()) =>
    DurableState.open({
      channel: 'settings',
      replicaId,
      storage: store,
      decode: (value) => decode(scopedSettingsValueSchema, value),
      validateVersion: sharedSettingsVersionEntry,
    })
  let left = await open('left', leftStorage)
  const right = await open('right')
  const legacy: SharedSettingsEntry = {
    key: 'global',
    updatedAt: 1,
    changeId: 'legacy',
    value: { projectName: 'Before', projectPinned: false },
  }
  await left.importVersions(sharedSettingsVersions([legacy]))
  await right.receive(left.batch())
  const edit = (
    changeId: string,
    value: SharedSettingsEntry['value'],
    category: 'projectName' | 'projectPinned',
  ): SharedSettingsEntry => ({
    key: 'global',
    updatedAt: 2,
    changeId,
    value,
    revisions: { [category]: { updatedAt: 2, changeId } },
  })
  await left.importVersions(
    sharedSettingsVersions([edit('rename', { projectName: 'After' }, 'projectName')]),
  )
  await right.importVersions(
    sharedSettingsVersions([edit('pin', { projectPinned: true }, 'projectPinned')]),
  )
  await left.receive(right.batch())
  await right.receive(left.batch())
  expect(sharedSettingsFromVersions(left.latest())[0]?.value).toEqual({
    projectName: 'After',
    projectPinned: true,
  })
  expect(sharedSettingsFromVersions(right.latest())).toEqual(
    sharedSettingsFromVersions(left.latest()),
  )
  await left.close()
  left = await open('left', leftStorage)
  await left.receive(right.batch())
  expect(sharedSettingsFromVersions(left.latest())[0]?.value).toEqual({
    projectName: 'After',
    projectPinned: true,
  })
  await left.importVersions(
    sharedSettingsVersions([
      {
        key: 'global',
        updatedAt: 3,
        changeId: 'reset',
        value: {},
        revisions: { projectName: { updatedAt: 3, changeId: 'reset' } },
      },
    ]),
  )
  await right.receive(left.batch())
  expect(sharedSettingsFromVersions(right.latest())[0]?.value).toEqual({ projectPinned: true })
  await Promise.all([left.close(), right.close()])
})

it('rejects unknown categories and unrelated values before publishing them', () => {
  const version = {
    key: 'global\nprojectPinned',
    updatedAt: 1,
    changeId: 'edit',
    deleted: false as const,
    value: { projectName: 'Unexpected' },
  }
  expect(() => sharedSettingsVersionEntry(version)).toThrow('unrelated')
  expect(() => sharedSettingsVersionEntry({ ...version, key: 'global\nunknown' })).toThrow(
    'category',
  )
})
