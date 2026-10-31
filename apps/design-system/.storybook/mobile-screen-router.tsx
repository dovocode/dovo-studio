import { useContext, useEffect, type ReactNode } from 'react'
import { MobileScreenParamsContext } from '../../mobile/src/catalog/screens-params'

/** Browser navigation is observable locally and cannot leave the isolated catalog. */
function navigate(target: unknown) {
  window.dispatchEvent(new CustomEvent('dovo-catalog-navigation', { detail: target }))
}
export const router = {
  push: navigate,
  replace: navigate,
  navigate,
  back: () => navigate('back'),
  canGoBack: () => false,
  dismiss: () => navigate('dismiss'),
  dismissTo: navigate,
  dismissAll: () => navigate('dismissAll'),
  setParams: navigate,
}
export const useRouter = () => router
// Catalog screens are mounted in a ready browser shell; navigation remains local to this adapter.
const rootNavigationState = { key: 'catalog-root' }
export const useRootNavigationState = () => rootNavigationState
export const useIsFocused = () => true
export const useLocalSearchParams = () => useContext(MobileScreenParamsContext)
export const useGlobalSearchParams = useLocalSearchParams
export const usePathname = () => '/catalog'
export const useSegments = () => ['catalog']
export const useNavigation = () => ({ setOptions: () => undefined, goBack: router.back })
function Screen() {
  return null
}
export const Stack = Object.assign(({ children }: { children?: ReactNode }) => children, { Screen })
export const Tabs = Stack
export const Slot = () => null
export const Link = ({ children, href }: { children: ReactNode; href: string }) => (
  <button type="button" onClick={() => navigate(href)}>
    {children}
  </button>
)

export function Redirect({ href }: { href: string }) {
  useEffect(() => navigate(href), [href])
  return <p role="status">Navigation preview: {href}</p>
}
