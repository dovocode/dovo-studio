import { createContext, useContext } from 'react'
import type { AccountClient, AccountState } from '@dovo/protocol'
export const MobileAccountContext = createContext<
  (AccountState & { client: AccountClient }) | null
>(null)
export function useMobileAccount() {
  const account = useContext(MobileAccountContext)
  if (!account) throw new Error('MobileAccountProvider is missing')
  return account
}
