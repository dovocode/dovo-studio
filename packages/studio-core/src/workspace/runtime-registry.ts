import { z } from 'zod'
import {
  connectionSchema,
  runtimeProfile,
  runtimeRegistrySchema,
  upsertRuntime,
  type RuntimeRegistry,
} from '@dovo/protocol'
const registryKey = 'dovo.runtimes.v1'
const legacyConnectionKey = 'dovo.connection.v1'
export const emptyRegistry = (): RuntimeRegistry => ({ version: 1, activeId: null, profiles: [] })
export function decodeRuntimeRegistry(
  saved: string | null,
  legacy: string | null,
): RuntimeRegistry {
  if (saved) return runtimeRegistrySchema.parse(JSON.parse(saved))
  if (!legacy) return emptyRegistry()
  return upsertRuntime(emptyRegistry(), runtimeProfile(connectionSchema.parse(JSON.parse(legacy))))
}
const bridgeSchema = z.object({
  dovo: z.object({
    readRuntimeRegistry: z.function(),
    writeRuntimeRegistry: z.function({ input: [z.string()] }),
  }),
})
export async function readRuntimeRegistry(): Promise<RuntimeRegistry> {
  const bridge = bridgeSchema.safeParse(window)
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
  const encoded = JSON.stringify(runtimeRegistrySchema.parse(value))
  const bridge = bridgeSchema.safeParse(window)
  if (bridge.success) {
    await bridge.data.dovo.writeRuntimeRegistry(encoded)
    localStorage.removeItem(registryKey)
  } else localStorage.setItem(registryKey, encoded)
  localStorage.removeItem(legacyConnectionKey)
}
