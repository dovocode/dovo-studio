import { mutableStruct } from '@dovo/protocol'
import { decode, decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'
import { readWorkspaceDocument, updateWorkspaceDocument } from './read-cache'
import {
  connectionSchema,
  runtimeProfile,
  runtimeRegistrySchema,
  upsertRuntime,
  type RuntimeRegistry,
} from '@dovo/protocol'
const registryKey = 'dovo.runtimes.v1'
const legacyConnectionKey = 'dovo.connection.v1'
let observed: RuntimeRegistry | undefined
const eventKey = 'dovo.runtimes.changed'
export function subscribeRuntimeRegistry(listener: () => void) {
  const receive = (event: StorageEvent) => {
    if (event.key === eventKey) listener()
  }
  window.addEventListener('storage', receive)
  return () => window.removeEventListener('storage', receive)
}
/** Apply only this writer's changes; reject competing edits to the same profile. */
export function mergeRuntimeRegistry(
  current: RuntimeRegistry,
  before: RuntimeRegistry,
  next: RuntimeRegistry,
): RuntimeRegistry {
  const profiles = new Map(current.profiles.map((profile) => [profile.id, profile]))
  for (const id of new Set([...before.profiles, ...next.profiles].map((profile) => profile.id))) {
    const old = before.profiles.find((profile) => profile.id === id)
    const incoming = next.profiles.find((profile) => profile.id === id)
    if (JSON.stringify(old) === JSON.stringify(incoming)) continue
    const actual = profiles.get(id)
    if (
      JSON.stringify(actual) !== JSON.stringify(old) &&
      JSON.stringify(actual) !== JSON.stringify(incoming)
    )
      throw new Error('Saved computer changed in another window. Reload before editing it.')
    if (incoming) profiles.set(id, incoming)
    else profiles.delete(id)
  }
  const pendingChanged =
    JSON.stringify(before.pendingPairings) !== JSON.stringify(next.pendingPairings)
  if (
    pendingChanged &&
    JSON.stringify(current.pendingPairings) !== JSON.stringify(before.pendingPairings) &&
    JSON.stringify(current.pendingPairings) !== JSON.stringify(next.pendingPairings)
  )
    throw new Error('Pairing changed in another window. Reload before editing connections.')
  const activeId = next.activeId !== before.activeId ? next.activeId : current.activeId
  return {
    ...current,
    profiles: [...profiles.values()],
    activeId: profiles.has(activeId ?? '') ? activeId : null,
    ...(pendingChanged ? { pendingPairings: next.pendingPairings } : {}),
  }
}
export const emptyRegistry = (): RuntimeRegistry => ({
  version: 1,
  activeId: null,
  profiles: [],
})
export function decodeRuntimeRegistry(
  saved: string | null,
  legacy: string | null,
): RuntimeRegistry {
  if (saved) return decode(runtimeRegistrySchema, JSON.parse(saved))
  if (!legacy) return emptyRegistry()
  return upsertRuntime(
    emptyRegistry(),
    runtimeProfile(decode(connectionSchema, JSON.parse(legacy))),
  )
}
const bridgeSchema = mutableStruct({
  dovo: mutableStruct({
    readRuntimeRegistry: Schema.Unknown.pipe(
      Schema.refine(
        (value): value is (...args: unknown[]) => unknown => typeof value === 'function',
      ),
    ),
    writeRuntimeRegistry: Schema.Unknown.pipe(
      Schema.refine(
        (value): value is (...args: unknown[]) => unknown => typeof value === 'function',
      ),
    ),
  }),
})
export async function readRuntimeRegistry(): Promise<RuntimeRegistry> {
  const bridge = decodeResult(bridgeSchema, window)
  const encrypted: unknown = bridge.success ? await bridge.data.dovo.readRuntimeRegistry() : null
  if (encrypted !== null && typeof encrypted !== 'string')
    throw new Error('Invalid saved runtime registry')
  const value = decodeRuntimeRegistry(
    encrypted ??
      (bridge.success
        ? localStorage.getItem(registryKey)
        : await readWorkspaceDocument(registryKey)),
    localStorage.getItem(legacyConnectionKey),
  )
  if (bridge.success) await writeRuntimeRegistry(value)
  observed = value
  return value
}
export async function writeRuntimeRegistry(value: RuntimeRegistry): Promise<RuntimeRegistry> {
  const encoded = JSON.stringify(decode(runtimeRegistrySchema, value))
  const bridge = decodeResult(bridgeSchema, window)
  if (bridge.success) {
    await bridge.data.dovo.writeRuntimeRegistry(encoded)
    localStorage.removeItem(registryKey)
  } else {
    const before = observed ?? emptyRegistry()
    const saved = await updateWorkspaceDocument(registryKey, (raw) =>
      JSON.stringify(
        mergeRuntimeRegistry(
          decodeRuntimeRegistry(raw, localStorage.getItem(legacyConnectionKey)),
          before,
          value,
        ),
      ),
    )
    value = decode(runtimeRegistrySchema, JSON.parse(saved))
    localStorage.setItem(eventKey, String(Date.now()) + Math.random())
  }
  localStorage.removeItem(legacyConnectionKey)
  observed = value
  return value
}
