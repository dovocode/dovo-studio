import type { BrowserTabState, DovoWebKitBrowserModule } from '../../modules/dovo-webkit-browser'
type TabBridge = Pick<
  DovoWebKitBrowserModule,
  'ensureProfile' | 'getStatus' | 'openTab' | 'closeTab'
>
let operations = Promise.resolve()
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const operation = operations.then(work)
  operations = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}
/** Reuse native instances of live tabs without reloading navigation or forms. */
export function prepareNativeTab(
  module: TabBridge,
  options: { tabId: string; profileId: string; url: string },
): Promise<BrowserTabState> {
  return serialize(async () => {
    await module.ensureProfile(options.profileId)
    const status = await module.getStatus()
    const existing = status.tabs.find((tab) => tab.tabId === options.tabId)
    if (existing) {
      if (existing.profileId !== options.profileId)
        throw new Error(
          'This native tab belongs to a different profile. Close it before changing profiles.',
        )
      return existing
    }
    return module.openTab(options)
  })
}
/** Saved inactive tabs may never have launched; closing those must still work. */
export function closeNativeTab(module: TabBridge, tabId: string): Promise<boolean> {
  return serialize(async () => {
    const status = await module.getStatus()
    if (!status.tabs.some((tab) => tab.tabId === tabId)) return false
    await module.closeTab(tabId)
    return true
  })
}
