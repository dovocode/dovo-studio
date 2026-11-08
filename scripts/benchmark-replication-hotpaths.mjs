// Build @dovo/runtime and dependencies first. Isolated in-memory SQLite/CPU measurements.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { DurableState, jsonStateStorage } from '../packages/durable-connections/dist/index.js'
import {
  decodeThreadRecord,
  validateThreadVersion,
  threadRecordKey,
  threadReplicationChannel,
  decode,
  scopedSettingsValueSchema,
} from '../packages/protocol/dist/index.js'
import { openDatabase } from '../packages/runtime/dist/storage/database.js'
import { WorkspaceStore } from '../packages/runtime/dist/storage/workspace.js'
import { ThreadReplicationJournal } from '../packages/runtime/dist/storage/thread-replication-journal.js'
import { RuntimeDefaults } from '../packages/runtime/dist/storage/runtime-defaults.js'
import { sharedStateJournal } from '../packages/runtime/dist/storage/shared-state-journal.js'

async function median(run) {
  await run()
  const samples = []
  for (let i = 0; i < 7; i++) {
    const start = performance.now()
    await run()
    samples.push(performance.now() - start)
  }
  return Number(samples.sort((a, b) => a - b)[3].toFixed(3))
}
for (const count of [1000, 3000]) {
  const db = openDatabase(':memory:')
  let state
  try {
    const defaults = new RuntimeDefaults(db)
    defaults.mergeShared(
      Array.from({ length: count }, (_, i) => ({
        key: 'global',
        updatedAt: i + 1,
        changeId: `edit:${i}`,
        value: { taskDefaults: { setupCommand: 'x'.repeat(8192) } },
      })),
    )
    state = await DurableState.open({
      channel: 'shared-settings:v1',
      replicaId: 'owner',
      storage: sharedStateJournal(db, 'owner', 'owner'),
      decode: (value) => decode(scopedSettingsValueSchema, value),
    })
    let through = 0
    const capture = async () => {
      const pending = defaults.sharedVersions(through)
      await state.importVersions(
        [
          ...pending.map(({ entry }) => entry),
          ...(defaults.get().scopedSettings?.shared ?? []),
        ].map((entry) => ({ ...entry, deleted: false })),
      )
      through = pending.at(-1)?.sequence ?? through
    }
    await capture()
    const sharedSettingsIdleRefreshMs = await median(async () => {
      await state.refresh()
      await capture()
    })
    assert.equal(state.revision, count)
    console.log(
      JSON.stringify({
        sharedSettingsVersions: count,
        textMiB: (count * 8192) / 1048576,
        sharedSettingsIdleRefreshMs,
      }),
    )
  } finally {
    await state?.close()
    db.close()
  }
}
for (const count of [1000, 5000]) {
  const db = openDatabase(':memory:')
  let state, app
  try {
    const journal = new ThreadReplicationJournal(db, 'replica')
    const store = new WorkspaceStore(db)
    const identity = { ownerRuntimeId: 'owner', threadId: 'thread' }
    const values = [
      {
        ...identity,
        kind: 'thread',
        ownerName: 'Owner',
        projectName: 'Project',
        createdAt: '2026-01-01',
        status: 'done',
        archived: true,
        historyRevision: 0,
        removed: false,
      },
      { ...identity, kind: 'title', value: 'Thread' },
      ...Array.from({ length: count }, (_, position) => ({
        ...identity,
        kind: 'message',
        messageId: `message-${position}`,
        position,
        message: { id: `message-${position}`, role: 'assistant', text: 'x'.repeat(2048) },
      })),
    ]
    const versions = values.map((value, i) => ({
      key: threadRecordKey(value),
      updatedAt: i + 1,
      changeId: `owner:${i}`,
      deleted: false,
      value,
    }))
    const options = {
      channel: threadReplicationChannel,
      decode: decodeThreadRecord,
      validateVersion: validateThreadVersion,
    }
    state = await DurableState.open({
      ...options,
      replicaId: 'replica',
      storage: journal.storage(store),
    })
    await state.importVersions(versions)
    const runtimeIdleRefreshMs = await median(() => state.refresh())
    const runtimeMetadataEditMs = await median(() =>
      state.set(threadRecordKey(values[1]), { ...values[1], value: `Renamed ${state.revision}` }),
    )
    const historyPageMs = await median(() => {
      const page = journal.page('owner', 'thread')
      assert.equal(page.messages.length, 40)
      assert.equal(page.messages[0].id, `message-${count - 40}`)
      assert.equal(page.historyBefore, `message-${count - 40}`)
    })
    const summaryMs = await median(() => {
      const summaries = journal.replicas([])
      assert.equal(summaries.length, 1)
      assert.equal(summaries[0].messages.length, 0)
    })
    let raw = null
    const storage = jsonStateStorage({
      read: () => raw,
      write: (value) => {
        raw = value
      },
      update: async (change) => {
        raw = change(raw)
        return raw
      },
    })
    app = await DurableState.openPersisted({ ...options, storage, createReplicaId: () => 'app' })
    await app.importVersions(versions)
    const appIdleRefreshMs = await median(() => app.refresh())
    const appMetadataEditMs = await median(() =>
      app.set(threadRecordKey(values[1]), { ...values[1], value: `Renamed ${app.revision}` }),
    )
    console.log(
      JSON.stringify({
        messages: count,
        textMiB: Number(((count * 2048) / 1048576).toFixed(2)),
        runtimeIdleRefreshMs,
        runtimeMetadataEditMs,
        historyPageMs,
        summaryMs,
        appIdleRefreshMs,
        appMetadataEditMs,
      }),
    )
  } finally {
    await state?.close()
    await app?.close()
    db.close()
  }
}
