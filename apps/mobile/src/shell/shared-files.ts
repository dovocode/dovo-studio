import { requireOptionalNativeModule } from 'expo'
import { Directory, File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import {
  decode,
  mutableStruct,
  mutableArray,
  maxValue,
  uuidSchema,
  decodeResult,
} from '@dovo/protocol'
import { Schema } from 'effect'
import type { SharedHandoff, SharedFile } from './shared-inbox'
import { SHARED_DRAFT_BUDGET } from './shared-inbox'

const bridge = requireOptionalNativeModule<{
  pending: () => Promise<string>
  acknowledge: (id: string) => Promise<void>
}>('DovoShareInbox')
const root = () => new Directory(Paths.document, 'shared-drafts')
const handoffSchema = mutableStruct({
  id: uuidSchema,
  payloads: mutableArray(
    mutableStruct({
      shareType: Schema.Literals(['text', 'url', 'image', 'audio', 'video', 'file']),
      value: Schema.String,
      name: Schema.optional(Schema.String),
      mimeType: Schema.optional(Schema.String),
    }),
  ),
  error: Schema.optional(Schema.String),
})
export const sharedFileSchema = mutableStruct({
  id: uuidSchema,
  uri: Schema.String,
  name: Schema.String,
  mimeType: Schema.optional(Schema.String),
})
export const sharedFilesSchema = maxValue(mutableArray(sharedFileSchema), 5)
const nativeHandoffSchema = mutableStruct({
  id: uuidSchema,
  manifest: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})
export async function pendingSharedHandoffs(): Promise<SharedHandoff[]> {
  if (!bridge) return []
  const envelopes = decode(mutableArray(nativeHandoffSchema), JSON.parse(await bridge.pending()))
  return envelopes.map((envelope) => {
    const damaged = {
      id: envelope.id,
      payloads: [],
      error: 'This saved share is damaged. Discard it and share the content again.',
    }
    if (envelope.error || envelope.manifest === undefined) return damaged
    let value: unknown
    try {
      value = JSON.parse(envelope.manifest)
    } catch {
      return damaged
    }
    const result = decodeResult(handoffSchema, value)
    // A manifest cannot choose which native directory acknowledgment removes.
    if (!result.success || result.data.id !== envelope.id) return damaged
    return result.data
  })
}
export async function acknowledgeSharedHandoff(id: string) {
  if (!bridge) throw new Error('Rebuild Dovo to receive shared files.')
  await bridge.acknowledge(id)
}
function bytes(directory: Directory): number {
  return directory.exists
    ? directory
        .list()
        .reduce(
          (total, entry) => total + (entry instanceof Directory ? bytes(entry) : entry.size),
          0,
        )
    : 0
}
/** Copies into Documents, never caches or provider URIs, before the native manifest can be cleared. */
export async function ownSharedFiles(handoff: SharedHandoff): Promise<SharedFile[]> {
  const files = handoff.payloads.filter((payload) => !['text', 'url'].includes(payload.shareType))
  if (files.length > 5) throw new Error('Attach up to 5 files per message.')
  const directory = new Directory(root(), handoff.id)
  if (directory.exists) directory.delete() // An interrupted copy has no durable draft yet.
  directory.create({ intermediates: true })
  let remaining = SHARED_DRAFT_BUDGET - bytes(root())
  const owned: SharedFile[] = []
  try {
    for (const [index, payload] of files.entries()) {
      if (!payload.value.startsWith('file://'))
        throw new Error('Shared file is not stored locally.')
      const source = new File(payload.value)
      if (!source.exists) throw new Error('The shared file is no longer available.')
      remaining -= source.size
      if (remaining < 0)
        throw new Error('Shared drafts can use up to 50 MB. Open or discard a saved share first.')
      const name = payload.name || source.name || 'attachment'
      const extension = /\.[a-z0-9]{1,12}$/i.exec(name)?.[0] ?? ''
      const destination = new File(directory, `${index}${extension}`)
      await source.copy(destination)
      owned.push({ id: randomUUID(), uri: destination.uri, name, mimeType: payload.mimeType })
    }
    return owned
  } catch (error) {
    directory.delete()
    throw error
  }
}
export function releaseSharedFiles(id: string) {
  // IDs are decoded UUIDs; validate again at the filesystem boundary.
  decode(uuidSchema, id)
  const directory = new Directory(root(), id)
  if (directory.exists) directory.delete()
}
export function cleanupSharedFiles(ids: string[]) {
  if (!bridge) return
  if (!root().exists) return
  for (const entry of root().list()) {
    if (entry instanceof Directory && !ids.includes(entry.name)) entry.delete()
  }
}
