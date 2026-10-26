import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  DovoWebKitBrowser,
  DovoWebKitBrowserView,
  type BrowserStatus,
  type BrowserTabState,
} from '../../modules/dovo-webkit-browser'

export { DovoWebKitBrowser, DovoWebKitBrowserView }
export type { BrowserTabState, DovoWebKitBrowserModule } from '../../modules/dovo-webkit-browser'

type ClosedTab = { tabId: string; profileId: string; instanceId: string }
type Capability = { status: BrowserStatus | null; error: string; closedTabs: ClosedTab[] }
const NativeBrowserContext = createContext<Capability>({ status: null, error: '', closedTabs: [] })
// Serialize feature toggles so an old cleanup cannot disable a newer enabled screen.
let lifecycle = Promise.resolve()
export function setNativeBrowserEnabled(enabled: boolean) {
  const module = DovoWebKitBrowser
  if (!module) return Promise.resolve(null)
  const operation = lifecycle.then(async () => {
    if (enabled) {
      const status = await module.getStatus()
      if (!status.browsingAvailable) return status
    }
    return module.setEnabled(enabled)
  })
  lifecycle = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}
export function NativeBrowserProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const [capability, setCapability] = useState<Capability>({
    status: null,
    error: '',
    closedTabs: [],
  })
  useEffect(() => {
    let alive = true
    setCapability({ status: null, error: '', closedTabs: [] })
    if (!enabled) return
    // Keep native events while the Browser route is detached; the screen reconciles on return.
    const module = DovoWebKitBrowser
    const updated = (page: BrowserTabState) =>
      setCapability((previous) =>
        previous.status &&
        !previous.status.tabs.some(
          (tab) => tab.tabId === page.tabId && tab.instanceId !== page.instanceId,
        )
          ? {
              ...previous,
              status: {
                ...previous.status,
                tabs: [
                  ...previous.status.tabs.filter((tab) => tab.tabId !== page.tabId),
                  page,
                ].slice(-100),
              },
            }
          : previous,
      )
    const subscriptions = module
      ? [
          module.addListener('onTabCreated', (page) => {
            setCapability((previous) =>
              previous.status
                ? {
                    ...previous,
                    status: {
                      ...previous.status,
                      tabs: [
                        ...previous.status.tabs.filter((tab) => tab.tabId !== page.tabId),
                        page,
                      ].slice(-100),
                    },
                  }
                : previous,
            )
            setCapability((previous) => ({
              ...previous,
              closedTabs: previous.closedTabs.filter(
                (tab) => tab.tabId !== page.tabId || tab.profileId !== page.profileId,
              ),
            }))
          }),
          module.addListener('onTabUpdated', updated),
          module.addListener('onTabClosed', (page) =>
            setCapability((previous) =>
              previous.status?.tabs.some(
                (tab) => tab.tabId === page.tabId && tab.instanceId !== page.instanceId,
              )
                ? previous
                : {
                    ...previous,
                    status: previous.status
                      ? {
                          ...previous.status,
                          tabs: previous.status.tabs.filter(
                            (tab) => tab.tabId !== page.tabId || tab.instanceId !== page.instanceId,
                          ),
                        }
                      : null,
                    closedTabs: [
                      ...previous.closedTabs.filter(
                        (tab) => tab.tabId !== page.tabId || tab.profileId !== page.profileId,
                      ),
                      page,
                    ].slice(-100),
                  },
            ),
          ),
        ]
      : []
    void setNativeBrowserEnabled(true).then(
      (status) => {
        if (alive) setCapability({ status, error: '', closedTabs: [] })
      },
      (cause) => {
        if (alive)
          setCapability({
            status: null,
            closedTabs: [],
            error: `Native browser could not ${enabled ? 'start' : 'stop'}: ${String(cause)}`,
          })
      },
    )
    return () => {
      alive = false
      subscriptions.forEach((subscription) => subscription.remove())
      if (enabled)
        void setNativeBrowserEnabled(false).catch((cause) =>
          setCapability({
            status: null,
            error: `Native browser could not stop: ${String(cause)}`,
            closedTabs: [],
          }),
        )
    }
  }, [enabled])
  return (
    <NativeBrowserContext.Provider value={capability}>{children}</NativeBrowserContext.Provider>
  )
}
export const useNativeBrowser = () => useContext(NativeBrowserContext)
