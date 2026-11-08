import { expect, it } from 'vite-plus/test'
import { DurableState } from '@dovo/durable-connections'
import { decode, scopedSettingsValueSchema } from '@dovo/protocol'
import { openDatabase } from './database.js'
import { sharedStateJournal } from './shared-state-journal.js'
import { RuntimeDefaults } from './runtime-defaults.js'

it('migrates the legacy settings journal, retains its recovery document and appends atomically', async () => {
  const db = openDatabase(':memory:')
  const version = {
    key: 'global',
    updatedAt: 1,
    changeId: 'owner:1',
    deleted: false as const,
    value: { taskDefaults: { setupCommand: 'old' } },
  }
  const legacy = JSON.stringify({
    protocol: 1,
    channel: 'shared-settings:v1',
    replicaId: 'owner',
    journal: [{ sequence: 1, version }],
    checkpoints: { phone: 3 },
  })
  db.prepare('INSERT INTO documents VALUES (?,?)').run('durable-state:shared-settings:v1', legacy)
  const storage = sharedStateJournal(db, 'owner', 'owner')
  const state = await DurableState.open({
    channel: 'shared-settings:v1',
    replicaId: 'owner',
    storage,
    decode: (value) => decode(scopedSettingsValueSchema, value),
  })
  try {
    expect(state.checkpoint('phone')).toBe(3)
    await state.set('global', { taskDefaults: { setupCommand: 'new' } })
    expect(state.history('global')).toHaveLength(2)
    await state.receive(
      {
        protocol: 1,
        channel: 'shared-settings:v1',
        source: 'peer-new',
        after: 0,
        through: 0,
        more: false,
        changes: [],
      },
      'stable-peer',
    )
    expect(
      db
        .prepare('SELECT value FROM documents WHERE id=?')
        .pluck()
        .get('durable-state:shared-settings:v1'),
    ).toBe(legacy)
    expect(storage.readChanges?.(2)).toMatchObject({ journal: [], checkpoints: { phone: 3 } })
    await expect(async () =>
      storage.append?.(
        2,
        [
          { sequence: 3, version },
          { sequence: 5, version },
        ],
        { phone: 4 },
      ),
    ).rejects.toThrow('sequence')
    expect(storage.readChanges?.(2)).toMatchObject({ journal: [], checkpoints: { phone: 3 } })
    const reopened = await DurableState.open({
      channel: 'shared-settings:v1',
      replicaId: 'owner',
      storage: sharedStateJournal(db, 'owner', 'owner'),
      decode: (value) => decode(scopedSettingsValueSchema, value),
    })
    expect(reopened.get('global')?.taskDefaults?.setupCommand).toBe('new')
    expect(reopened.sourceFor('stable-peer')).toBe('peer-new')
    await reopened.close()
  } finally {
    await state.close()
    db.close()
  }
})

it('reads only shared settings versions beyond the durable outbox cursor', () => {
  const db = openDatabase(':memory:')
  try {
    const defaults = new RuntimeDefaults(db)
    defaults.mergeShared(
      [1, 2, 3].map((i) => ({ key: 'global', updatedAt: i, changeId: `edit:${i}`, value: {} })),
    )
    const first = defaults.sharedVersions(0)
    expect(first).toHaveLength(3)
    expect(defaults.sharedVersions(first[1].sequence).map(({ entry }) => entry.changeId)).toEqual([
      'edit:3',
    ])
    expect(defaults.sharedVersions(first[2].sequence)).toEqual([])
  } finally {
    db.close()
  }
})

it('migrates a restored legacy actor without changing its document or reusing old checkpoints', async () => {
  const db = openDatabase(':memory:')
  const legacy = JSON.stringify({
    protocol: 1,
    channel: 'shared-settings:v1',
    replicaId: 'owner',
    journal: [],
    checkpoints: { phone: 999 },
  })
  db.prepare('INSERT INTO documents VALUES (?,?)').run('durable-state:shared-settings:v1', legacy)
  const source = 'owner:restore:00000000-0000-0000-0000-000000000001'
  const state = await DurableState.open({
    channel: 'shared-settings:v1',
    replicaId: source,
    storage: sharedStateJournal(db, 'owner', source),
    decode: (value) => decode(scopedSettingsValueSchema, value),
  })
  try {
    expect(state.checkpoint('phone')).toBe(0)
    expect(
      db
        .prepare('SELECT value FROM documents WHERE id=?')
        .pluck()
        .get('durable-state:shared-settings:v1'),
    ).toBe(legacy)
  } finally {
    await state.close()
    db.close()
  }
})
