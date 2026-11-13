import { runtimeComputerName, type RuntimeProfile } from '@dovo/protocol'
import type { WorkspaceContextValue } from '@dovo/studio-core'
import { botScope } from './bot-scope'

export const botPairing = (profile: RuntimeProfile) => botScope(profile.id, profile.connection)

/** Only use facts from the saved pairing, never a cached snapshot for replaced credentials. */
export function botCreateHosts(store: WorkspaceContextValue) {
  return store.runtimeRegistry.profiles.map((profile) => {
    const pairing = botPairing(profile)
    const overview = store.runtimes.find(
      (entry) => entry.profile.id === profile.id && botPairing(entry.profile) === pairing,
    )
    const active =
      store.activeRuntimeId === profile.id && botScope(profile.id, store.connection) === pairing
    const snapshot = active ? store.snapshot : (overview?.snapshot ?? null)
    return {
      profile,
      pairing,
      name: runtimeComputerName({ profile, snapshot }),
      snapshot,
      workspace: active ? store.workspace : snapshot?.workspace,
      online: active ? store.connected : (overview?.connected ?? false),
      local: profile.id === store.localRuntimeId,
      supported: snapshot?.botsSupported === true,
    }
  })
}
export type BotCreateHost = ReturnType<typeof botCreateHosts>[number]
