import { useEffect, type ReactNode } from 'react'
import { MobileAccountContext } from './account-context'
export { useMobileAccount } from './account-context'
import { Linking } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { useRuntime } from './provider'
import { useAccount } from '@dovo/studio-core'
import type { AccountStorage } from '@dovo/protocol'
import { ACCOUNT_DIRECTORY_URL, connectServiceOrigin } from '@dovo/protocol'
import * as Crypto from 'expo-crypto'
import { useMobilePreferences } from '../preferences/app-preferences'
import { useAccountRecovery } from './use-account-recovery'
async function storageKey(origin = ACCOUNT_DIRECTORY_URL) {
  const normalized = connectServiceOrigin(origin)
  return normalized === ACCOUNT_DIRECTORY_URL
    ? 'dovo-account-session'
    : 'dovo-account-session-' +
        (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, normalized))
}
const storage: AccountStorage = {
  read: async (origin) => SecureStore.getItemAsync(await storageKey(origin)),
  write: async (token, origin) =>
    token === null
      ? SecureStore.deleteItemAsync(await storageKey(origin))
      : SecureStore.setItemAsync(await storageKey(origin), token, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
}
const open = (url: string) => Linking.openURL(url)

export function MobileAccountProvider({ children }: { children: ReactNode }) {
  const preferences = useMobilePreferences()
  const account = useAccount(storage, open, preferences)
  const runtime = useRuntime()
  const { syncAccountSession, registryLoaded, overviews } = runtime
  const recovery = useAccountRecovery(
    account,
    runtime,
    preferences.ready,
    preferences.computerRefresh,
  )
  const connections = overviews
    .map((source) =>
      [
        source.profile.connection.accountSession,
        source.profile.connection.internet?.session,
        runtime.mutationStatus(source.profile).pending,
      ].join(':'),
    )
    .join(',')
  const session = account.client.sessionId()
  useEffect(() => {
    if (preferences.ready && account.loaded && registryLoaded)
      void syncAccountSession(session).catch(() => {
        /* The runtime provider exposes persistence failures. */
      })
  }, [account.loaded, session, registryLoaded, syncAccountSession, connections, preferences.ready])
  return (
    <MobileAccountContext.Provider
      value={{ ...account, recovery: recovery.states, retryRecovery: recovery.retry }}
    >
      {children}
    </MobileAccountContext.Provider>
  )
}
