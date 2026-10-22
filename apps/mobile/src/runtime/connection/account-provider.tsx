import { useEffect, type ReactNode } from 'react'
import { MobileAccountContext } from './account-context'
export { useMobileAccount } from './account-context'
import { Linking } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { useRuntime } from './provider'
import { useAccount } from '@dovo/studio-core'
import type { AccountStorage } from '@dovo/protocol'
const storage: AccountStorage = {
  read: () => SecureStore.getItemAsync('dovo-account-session'),
  write: (token) =>
    token === null
      ? SecureStore.deleteItemAsync('dovo-account-session')
      : SecureStore.setItemAsync('dovo-account-session', token, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
}
const open = (url: string) => Linking.openURL(url)

export function MobileAccountProvider({ children }: { children: ReactNode }) {
  const account = useAccount(storage, open)
  const { syncAccountSession, registryLoaded, overviews } = useRuntime()
  const connections = overviews
    .map((source) =>
      [source.profile.connection.accountSession, source.profile.connection.internet?.session].join(
        ':',
      ),
    )
    .join(',')
  const session = account.client.sessionId()
  useEffect(() => {
    if (account.loaded && registryLoaded)
      void syncAccountSession(session).catch(() => {
        /* The runtime provider exposes persistence failures. */
      })
  }, [account.loaded, session, registryLoaded, syncAccountSession, connections])
  return <MobileAccountContext.Provider value={account}>{children}</MobileAccountContext.Provider>
}
