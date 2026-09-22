import { createRuntimeReadCache, type CacheStorage, type RuntimeConnection } from '@dovo/protocol'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { workspaceOutboxSchema, type WorkspaceOutbox } from '../runtime/synchronization'

let database: Promise<IDBDatabase> | undefined
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dovo-read-cache', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('entries')
    request.onsuccess = () => resolve(request.result)
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
    const keys = (await transaction('readonly', (store) => store.getAllKeys())).filter(
      (key): key is string => typeof key === 'string',
    )
    for (const key of keys) if (key.startsWith(prefix)) await storage.removeItem(key)
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
  try {
    return workspaceOutboxSchema.parse(JSON.parse(raw))
  } catch (error) {
    throw new Error(
      'Saved pending changes could not be read. They have been preserved; recover this workspace outbox before reconnecting.',
      { cause: error },
    )
  }
}
export async function writeWorkspaceOutbox(
  connection: RuntimeConnection,
  value: WorkspaceOutbox | null,
) {
  const key = outboxKey(connection)
  if (value) await storage.setItem(key, JSON.stringify(value))
  else await storage.removeItem(key)
}
export const browserReadCache = (connection: RuntimeConnection) =>
  createRuntimeReadCache(connection, storage, async (value) => {
    // WebCrypto is unavailable on ordinary HTTP LAN origins used by the web client.
    return bytesToHex(sha256(utf8ToBytes(value)))
  })
