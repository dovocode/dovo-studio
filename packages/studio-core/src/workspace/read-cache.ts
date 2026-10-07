import { mutationOutboxSchema, type MutationStorage } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { createRuntimeReadCache, type CacheStorage, type RuntimeConnection } from '@dovo/protocol'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Schema } from 'effect'
import { workspaceSchema, type Workspace, type WorkspacePatch } from '@dovo/protocol'
import {
  workspaceOutboxSchema,
  type WorkspaceOutbox,
  type WorkspaceOutboxChange,
} from '../runtime/synchronization'
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
const storage: CacheStorage = {
  async getItem(key) {
    const value: unknown = await transaction('readonly', (store) => store.get(key))
    return typeof value === 'string' ? value : null
  },
  async setItem(key, value) {
    await transaction('readwrite', (store) => store.put(value, key))
  },
  async removeItem(key) {
    await transaction('readwrite', (store) => store.delete(key))
  },
  async removePrefix(prefix) {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const entries = tx.objectStore('entries')
      const keys = entries.getAllKeys()
      keys.onsuccess = () => {
        for (const key of keys.result)
          if (typeof key === 'string' && key.startsWith(prefix)) entries.delete(key)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  },
  async writeIndexedItem(prefix, key, value, limit) {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const entries = tx.objectStore('entries')
      const request = entries.get(prefix + '_index')
      request.onsuccess = () => {
        let previous: string[] = []
        try {
          const raw: unknown = request.result
          const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : '[]')
          if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string'))
            previous = parsed
        } catch {
          // This index is disposable; malformed indexes are replaced.
        }
        const keys = [...previous.filter((item) => item !== key), key]
        entries.put(value, prefix + key)
        for (const old of keys.slice(0, -limit)) entries.delete(prefix + old)
        entries.put(JSON.stringify(keys.slice(-limit)), prefix + '_index')
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  },
}
export async function readWorkspaceDocument(key: string) {
  const value = await storage.getItem(key)
  if (value !== null) return value
  const legacy = localStorage.getItem(key)
  if (legacy !== null) {
    await storage.setItem(key, legacy)
    localStorage.removeItem(key)
  }
  return legacy
}
export async function writeWorkspaceDocument(key: string, value: string) {
  await storage.setItem(key, value)
  localStorage.removeItem(key)
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
        current?.ids.forEach((id, index) => {
          if (!remove.has(id)) {
            ids.push(id)
            patches.push(current.patches[index])
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

export const browserMutationStorage: MutationStorage = {
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
