import { createContext, useContext } from 'react'
import type { AccountClient, AccountState } from '@dovo/protocol'
export type AccountRecoveryState = { pending: boolean; error?: string }
export const MobileAccountContext = createContext<
  | (AccountState & {
      client: AccountClient
      recovery?: Readonly<Record<string, AccountRecoveryState>>
      retryRecovery?: () => void
    })
  | null
>(null)
export const useOptionalMobileAccount = () => useContext(MobileAccountContext)
export function useMobileAccount() {
  const account = useContext(MobileAccountContext)
  if (!account) throw new Error('MobileAccountProvider is missing')
  return account
}
