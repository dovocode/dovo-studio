import { mutableStruct } from '@dovo/protocol'
import { decode, decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'
import {
  connectionSchema,
  runtimeProfile,
  runtimeRegistrySchema,
  upsertRuntime,
  type RuntimeRegistry,
} from '@dovo/protocol'
const registryKey = 'dovo.runtimes.v1'
const legacyConnectionKey = 'dovo.connection.v1'
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
      Schema.filter(
        (value): value is (...args: unknown[]) => unknown => typeof value === 'function',
      ),
    ),
    writeRuntimeRegistry: Schema.Unknown.pipe(
      Schema.filter(
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
    encrypted ?? localStorage.getItem(registryKey),
    localStorage.getItem(legacyConnectionKey),
  )
  if (bridge.success) await writeRuntimeRegistry(value)
  return value
}
export async function writeRuntimeRegistry(value: RuntimeRegistry): Promise<void> {
  const encoded = JSON.stringify(decode(runtimeRegistrySchema, value))
  const bridge = decodeResult(bridgeSchema, window)
  if (bridge.success) {
    await bridge.data.dovo.writeRuntimeRegistry(encoded)
    localStorage.removeItem(registryKey)
  } else localStorage.setItem(registryKey, encoded)
  localStorage.removeItem(legacyConnectionKey)
}
