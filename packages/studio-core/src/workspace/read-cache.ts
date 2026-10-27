import { workspaceRecoveriesSchema } from '@dovo/protocol'
import { mutationOutboxSchema, type MutationStorage } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import {
  createRuntimeReadCache,
  readCacheIndex,
  readCacheBytes,
  boundReadCacheIndex,
  type CacheStorage,
  type ReadCacheGeneration,
  type RuntimeRegistry,
  runtimeRegistrySchema,
  type RuntimeConnection,
} from '@dovo/protocol'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Schema } from 'effect'
import { workspaceSchema, type Workspace, type WorkspacePatch } from '@dovo/protocol'
import {
  workspaceOutboxSchema,
  type WorkspaceOutbox,
  type WorkspaceOutboxChange,
} from '../runtime/synchronization'
import { restoreWorkspaceEntity } from '../runtime/workspace-conflicts'
let database: Promise<IDBDatabase> | undefined
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dovo-read-cache', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('entries')
    request.onsuccess = () => {
      const db = request.result
      // The browser can close the connection (site data cleared, another tab upgrading);
      // forget it so the next transaction reopens instead of failing until reload.
      db.onclose = db.onversionchange = () => {
        database = undefined
        db.close()
      }
      resolve(db)
    }
    request.onerror = () => {
      database = undefined
      reject(request.error)
    }
  }))
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('entries', mode)
    const request = action(tx.objectStore('entries'))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Cache write was interrupted'))
  })
}
const generationSchema = Schema.Struct({
  generation: Schema.String,
  credentials: Schema.Array(Schema.String),
})
const digest = (value: string) => bytesToHex(sha256(utf8ToBytes(value)))
const hostKey = (origin: string) => `dovo.read-cache-generation.v1.${digest(origin)}`
function generationRecord(raw: unknown) {
  if (raw === undefined) return null
  if (typeof raw !== 'string') throw new Error('Invalid offline cache generation')
  return decode(generationSchema, JSON.parse(raw))
}
function validGeneration(
  entries: IDBObjectStore,
  generation: ReadCacheGeneration | undefined,
  action: () => void,
) {
  if (!generation) return action()
  if (!generation.valid) return
  const request = entries.get(generation.key)
  request.onsuccess = () => {
    const current = generationRecord(request.result)
    if (
      (current?.generation ?? null) !== generation.generation ||
      (current && !current.credentials.includes(generation.credential))
    ) {
      generation.valid = false
      return
    }
    action()
  }
}
function notifyGenerations(changes: Map<string, string>) {
  for (const [key, generation] of changes) localStorage.setItem(key, generation)
}
async function cacheTransaction(
  mode: IDBTransactionMode,
  generation: ReadCacheGeneration | undefined,
  action: (entries: IDBObjectStore, changed: Map<string, string>) => void,
) {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('entries', mode)
    const entries = tx.objectStore('entries')
    const changed = new Map<string, string>()
    validGeneration(entries, generation, () => action(entries, changed))
    tx.oncomplete = () => {
      try {
        notifyGenerations(changed)
        resolve()
      } catch (error) {
        reject(error)
      }
    }
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Cache write was interrupted'))
  })
}
function deleteCacheHost(entries: IDBObjectStore, host: string) {
  const prefix = `dovo.read-cache.v1.${host}.`
  const keys = entries.getAllKeys(IDBKeyRange.bound(prefix, prefix + '\uffff'))
  keys.onsuccess = () => {
    for (const key of keys.result) entries.delete(key)
  }
}
function rotateGeneration(
  entries: IDBObjectStore,
  key: string,
  credentials: readonly string[],
  changed: Map<string, string>,
  discard = true,
) {
  const generation = bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
  entries.put(JSON.stringify({ generation, credentials }), key)
  changed.set(key, generation)
  if (discard) deleteCacheHost(entries, key.slice('dovo.read-cache-generation.v1.'.length))
}
type RegistryCacheChange = {
  key: string
  credentials: string[]
  revoke: boolean
  reconciled?: boolean
  generation?: string | null
}
function registryCacheChanges(
  before: RuntimeRegistry,
  next: RuntimeRegistry,
): RegistryCacheChange[] {
  const hosts = (registry: RuntimeRegistry) => {
    const result = new Map<string, string[]>()
    for (const profile of registry.profiles) {
      const key = hostKey(new URL(profile.connection.address).origin)
      result.set(key, [...(result.get(key) ?? []), digest(profile.connection.token)])
    }
    return result
  }
  const old = hosts(before),
    incoming = hosts(next)
  return [...new Set([...old.keys(), ...incoming.keys()])].flatMap((key) => {
    const previous = [...(old.get(key) ?? [])].sort(),
      credentials = [...(incoming.get(key) ?? [])].sort()
    return JSON.stringify(previous) === JSON.stringify(credentials)
      ? []
      : [{ key, credentials, revoke: previous.length > 0 }]
  })
}
function changeRegistryCache(
  entries: IDBObjectStore,
  changes: RegistryCacheChange[],
  changed: Map<string, string>,
  conflicts?: RegistryCacheChange[],
) {
  for (const change of changes) {
    const request = entries.get(change.key)
    request.onsuccess = () => {
      const current = generationRecord(request.result)
      if (change.generation !== undefined && (current?.generation ?? null) !== change.generation) {
        conflicts?.push(change)
        return
      }
      // A winning pairing already installed this current registry. Reconciliation
      // must preserve its live handles and newly cached data, not rotate it again.
      if (
        change.reconciled &&
        current &&
        JSON.stringify([...current.credentials].sort()) === JSON.stringify(change.credentials)
      )
        return
      // Initial registration must preserve existing offline replicas during migration.
      // Once forgotten, only a changed, committed registry may reactivate its tombstone.
      rotateGeneration(
        entries,
        change.key,
        change.credentials,
        changed,
        current !== null || change.revoke,
      )
    }
  }
}
/** Capture before an encrypted main-process registry write. A newer forget fences its
 * delayed acknowledgement, including remove/re-add with the same credential. */
async function captureRegistryCacheGenerations(changes: RegistryCacheChange[]) {
  await cacheTransaction('readonly', undefined, (entries) => {
    for (const change of changes) {
      const request = entries.get(change.key)
      request.onsuccess = () => {
        change.generation = generationRecord(request.result)?.generation ?? null
      }
    }
  })
  return changes
}
export async function captureRegistryCacheChange(before: RuntimeRegistry, next: RuntimeRegistry) {
  return captureRegistryCacheGenerations(registryCacheChanges(before, next))
}
/** The encrypted registry is owned by Electron's main process. If another window
 * wins the cache CAS, read that authoritative registry again behind the new fence.
 * Retrying only the old desired value would revive a removed credential or let a
 * delayed removal erase a subsequent pairing. */
export async function commitRegistryCacheChange(
  changes: RegistryCacheChange[],
  readRegistry: () => Promise<RuntimeRegistry>,
) {
  let pending = changes
  while (pending.length) {
    const registry = await readRegistry()
    const allowed = new Map(
      registryCacheChanges({ version: 1, profiles: [], activeId: null }, registry).map((change) => [
        change.key,
        change.credentials,
      ]),
    )
    const conflicts: RegistryCacheChange[] = []
    await cacheTransaction('readwrite', undefined, (entries, changed) =>
      changeRegistryCache(
        entries,
        pending.map((change) => ({ ...change, credentials: allowed.get(change.key) ?? [] })),
        changed,
        conflicts,
      ),
    )
    pending = conflicts.length
      ? await captureRegistryCacheGenerations(
          conflicts.map((change) => ({ ...change, reconciled: true })),
        )
      : []
  }
}
const storage: CacheStorage = {
  captureGeneration(connection) {
    const key = hostKey(new URL(connection.address).origin)
    return {
      key,
      credential: digest(connection.token),
      generation: localStorage.getItem(key),
      valid: true,
    }
  },
  generationCurrent(generation) {
    return generation.valid && localStorage.getItem(generation.key) === generation.generation
  },
  async getItem(key, generation) {
    let value: unknown
    await cacheTransaction('readonly', generation, (entries) => {
      const request = entries.get(key)
      request.onsuccess = () => {
        value = request.result
      }
    })
    return typeof value === 'string' ? value : null
  },
  async setItem(key, value, generation) {
    await cacheTransaction('readwrite', generation, (entries) => {
      entries.put(value, key)
    })
  },
  async removeItem(key, generation) {
    await cacheTransaction('readwrite', generation, (entries) => {
      entries.delete(key)
    })
  },
  async removePrefix(prefix, generation) {
    const match = /^dovo\.read-cache\.v1\.([a-f0-9]{64})\.$/.exec(prefix)
    if (!match) throw new Error('Invalid offline cache namespace')
    await cacheTransaction('readwrite', generation, (entries, changed) =>
      rotateGeneration(entries, `dovo.read-cache-generation.v1.${match[1]}`, [], changed),
    )
  },
  async writeIndexedItem(prefix, key, value, limit, maxBytes, generation) {
    await cacheTransaction('readwrite', generation, (entries) => {
      const request = entries.get(prefix + '_index')
      request.onsuccess = () => {
        const raw: unknown = request.result
        const previous = readCacheIndex(typeof raw === 'string' ? raw : null)
        const migrated: Array<{ key: string; bytes: number }> = []
        let remaining = previous.length
        const commit = () => {
          const next = [
            ...migrated.filter((item) => item.key !== key),
            { key, bytes: readCacheBytes(value) },
          ]
          const kept = boundReadCacheIndex(next, limit, maxBytes)
          entries.put(value, prefix + key)
          for (const old of next.slice(0, next.length - kept.length))
            entries.delete(prefix + old.key)
          entries.put(JSON.stringify(kept), prefix + '_index')
        }
        if (!remaining) commit()
        previous.forEach((item, index) => {
          if (typeof item !== 'string') {
            migrated[index] = item
            if (!--remaining) commit()
            return
          }
          const stored = entries.get(prefix + item)
          stored.onsuccess = () => {
            const content: unknown = stored.result
            migrated[index] = {
              key: item,
              bytes: typeof content === 'string' ? readCacheBytes(content) : 0,
            }
            if (!--remaining) commit()
          }
        })
      }
    })
  },
}
export async function readWorkspaceDocument(key: string) {
  const value = await storage.getItem(key)
  if (value !== null) return value
  const legacy = localStorage.getItem(key)
  // Another tab can commit a newer document between the read and migration.
  if (legacy !== null) return updateWorkspaceDocument(key, (current) => current ?? legacy)
  return null
}
export async function writeWorkspaceDocument(key: string, value: string) {
  await storage.setItem(key, value)
  localStorage.removeItem(key)
}
/** Serializable browser document update; the callback runs inside the write transaction. */
export async function updateWorkspaceDocument(
  key: string,
  change: (current: string | null) => string,
) {
  const db = await open()
  return new Promise<string>((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    const entries = tx.objectStore('entries')
    const request = entries.get(key)
    let encoded = ''
    let failure: unknown
    const changed = new Map<string, string>()
    request.onsuccess = () => {
      try {
        const raw: unknown = request.result
        if (raw !== undefined && typeof raw !== 'string') throw new Error('Invalid saved document')
        const previous = raw === undefined ? localStorage.getItem(key) : raw
        encoded = change(previous)
        entries.put(encoded, key)
        if (key === 'dovo.runtimes.v1') {
          const before = previous
            ? decode(runtimeRegistrySchema, JSON.parse(previous))
            : { version: 1 as const, profiles: [], activeId: null }
          const next = decode(runtimeRegistrySchema, JSON.parse(encoded))
          changeRegistryCache(entries, registryCacheChanges(before, next), changed)
        }
      } catch (error) {
        failure = error
        tx.abort()
      }
    }
    tx.oncomplete = () => {
      try {
        notifyGenerations(changed)
        localStorage.removeItem(key)
        resolve(encoded)
      } catch (error) {
        reject(error)
      }
    }
    tx.onerror = tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error('Document write interrupted'))
  })
}
function outboxKey(connection: RuntimeConnection) {
  const host = bytesToHex(sha256(utf8ToBytes(new URL(connection.address).origin)))
  const credential = bytesToHex(sha256(utf8ToBytes(connection.token)))
  return `dovo.workspace-outbox.v1.${host}.${credential}`
}
export async function readWorkspaceOutbox(connection: RuntimeConnection) {
  const raw = await storage.getItem(outboxKey(connection))
  if (raw === null) return null
  return parseWorkspaceOutbox(raw)
}
function parseWorkspaceOutbox(raw: string) {
  try {
    const value = decode(workspaceOutboxSchema, JSON.parse(raw))
    const legacyPrefix = value.ids ? '' : `legacy:${bytesToHex(sha256(utf8ToBytes(raw)))}`
    // Old journals have no IDs. Derive stable ones so readers in separate tabs
    // acknowledge the same records without a read/write migration race.
    return {
      ...value,
      ids: value.ids ?? value.patches.map((_, index) => `${legacyPrefix}:${index}`),
    }
  } catch (error) {
    throw new Error(
      'Saved pending changes could not be read. They have been preserved; recover this workspace outbox before reconnecting.',
      {
        cause: error,
      },
    )
  }
}
function previewPatch(workspace: Workspace, patch: WorkspacePatch): Workspace {
  const collection = workspace[patch.collection]
  const previous = collection.find((entity) => entity.id === patch.id)
  if (!previous && !patch.create)
    throw new Error('Saved patch has no workspace entity; the pending edits were preserved')
  const record = decode(
    Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
    previous ?? patch.create,
  )
  for (const [key, change] of Object.entries(patch.changes)) {
    if (change.after === null) delete record[key]
    else record[key] = change.after
  }
  return decode(workspaceSchema, {
    ...workspace,
    [patch.collection]: previous
      ? collection.map((entity) => (entity.id === patch.id ? record : entity))
      : [...collection, record],
  })
}
export async function writeWorkspaceOutbox(
  connection: RuntimeConnection,
  value: WorkspaceOutbox | null,
  change?: WorkspaceOutboxChange,
) {
  const key = outboxKey(connection)
  const incoming = value ? parseWorkspaceOutbox(JSON.stringify(value)) : null
  if (!incoming && !change)
    throw new Error('Clearing saved edits requires the IDs of the edits being discarded')
  const append = new Set(change?.append ?? incoming?.ids ?? [])
  const remove = new Set(change?.remove ?? [])
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    const entries = tx.objectStore('entries')
    const request = entries.get(key)
    let failure: unknown
    request.onsuccess = () => {
      try {
        const raw: unknown = request.result
        if (raw !== undefined && typeof raw !== 'string')
          throw new Error('Saved pending changes have an invalid storage format')
        const current = raw === undefined ? null : parseWorkspaceOutbox(raw)
        const ids: string[] = []
        const patches: WorkspacePatch[] = []
        const replacements = new Map(change?.replace?.map((item) => [item.id, item.withId]))
        for (const id of replacements.keys())
          if (!current?.ids.includes(id))
            throw new Error('Saved edits changed in another window. Review the current conflicts.')
        current?.ids.forEach((id, index) => {
          if (!remove.has(id)) {
            const withId = replacements.get(id)
            const incomingIndex = withId ? (incoming?.ids.indexOf(withId) ?? -1) : -1
            if (withId && (!incoming || incomingIndex < 0))
              throw new Error('A conflict resolution is missing its replacement edit')
            ids.push(withId ?? id)
            patches.push(
              incoming && withId ? incoming.patches[incomingIndex] : current.patches[index],
            )
          }
        })
        let workspace = current?.workspace ?? incoming?.workspace
        for (const id of append) {
          const index = incoming?.ids.indexOf(id) ?? -1
          if (!incoming || index < 0 || remove.has(id))
            throw new Error('Saved patch IDs do not match the pending changes')
          const existing = ids.indexOf(id)
          if (existing >= 0) {
            if (JSON.stringify(patches[existing]) !== JSON.stringify(incoming.patches[index]))
              throw new Error('A saved patch ID belongs to different changes')
            continue
          }
          const patch = incoming.patches[index]
          if (current && workspace) workspace = previewPatch(workspace, patch)
          ids.push(id)
          patches.push(patch)
        }
        if (change?.restore && workspace)
          workspace = restoreWorkspaceEntity(workspace, change.restore, patches)
        if (patches.length && workspace)
          entries.put(JSON.stringify({ version: 1, workspace, patches, ids }), key)
        else entries.delete(key)
      } catch (error) {
        failure = error
        tx.abort()
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error('Saved workspace write was interrupted'))
  })
}
export const browserReadCache = (connection: RuntimeConnection) =>
  createRuntimeReadCache(connection, storage, async (value) => {
    // WebCrypto is unavailable on ordinary HTTP LAN origins used by the web client.
    return bytesToHex(sha256(utf8ToBytes(value)))
  })

/** Recovery records are independent rows: appending one edit never rewrites old edits. */
async function migrateRecoveryEntries(
  connection: RuntimeConnection,
  edit?: import('@dovo/protocol').WorkspaceRecovery,
) {
  const key = outboxKey(connection).replace('workspace-outbox', 'workspace-recoveries')
  const prefix = key + '.edit.'
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    const entries = tx.objectStore('entries')
    let failure: unknown
    const legacy = entries.get(key)
    legacy.onsuccess = () => {
      try {
        const raw: unknown = legacy.result
        if (raw !== undefined) {
          if (typeof raw !== 'string') throw new Error('Invalid recovery document')
          for (const item of decode(workspaceRecoveriesSchema, JSON.parse(raw)).edits)
            entries.put(JSON.stringify(item), prefix + item.id)
          entries.delete(key)
        }
        if (edit) {
          const previous = entries.get(prefix + edit.id)
          previous.onsuccess = () => {
            if (previous.result === undefined) entries.put(JSON.stringify(edit), prefix + edit.id)
          }
        }
      } catch (error) {
        failure = error
        tx.abort()
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error('Recovery write interrupted'))
  })
  return prefix
}
export const browserMutationStorage: MutationStorage = {
  async recoverWorkspaceEdit(connection, edit) {
    await migrateRecoveryEntries(connection, edit)
  },
  async workspaceRecoveries(connection) {
    const prefix = await migrateRecoveryEntries(connection)
    const rows = await transaction('readonly', (entries) =>
      entries.getAll(IDBKeyRange.bound(prefix, prefix + '\uffff')),
    )
    return decode(workspaceRecoveriesSchema, {
      edits: rows.map((row: unknown) => {
        if (typeof row !== 'string') throw new Error('Invalid recovered edit')
        return JSON.parse(row)
      }),
    }).edits
  },
  id: () => bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
  async read(connection) {
    const raw = await storage.getItem(
      outboxKey(connection).replace('workspace-outbox', 'mutation-outbox'),
    )
    return raw === null ? [] : decode(mutationOutboxSchema, JSON.parse(raw))
  },
  async clear(connection) {
    await storage.removeItem(outboxKey(connection).replace('workspace-outbox', 'mutation-outbox'))
  },
  async update(connection, change) {
    const key = outboxKey(connection).replace('workspace-outbox', 'mutation-outbox')
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const entries = tx.objectStore('entries')
      const request = entries.get(key)
      let pending: ReturnType<typeof change>
      let failure: unknown
      request.onsuccess = () => {
        try {
          const raw: unknown = request.result
          if (raw !== undefined && typeof raw !== 'string')
            throw new Error('Saved actions have an invalid storage format')
          pending = change(raw === undefined ? [] : decode(mutationOutboxSchema, JSON.parse(raw)))
          if (pending.length) entries.put(JSON.stringify(pending), key)
          else entries.delete(key)
        } catch (error) {
          failure = error
          tx.abort()
        }
      }
      tx.oncomplete = () => resolve(pending)
      tx.onerror = tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error('Saved action write was interrupted'))
    })
  },
}
