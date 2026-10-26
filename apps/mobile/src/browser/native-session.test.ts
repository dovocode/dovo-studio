import { expect, it } from 'vite-plus/test'
import { closeNativeTab, prepareNativeTab } from './native-session'
import type { BrowserStatus } from '../../modules/dovo-webkit-browser'
it('serializes live tab reuse and ignores closing unlaunched saved tabs', async () => {
  const status: BrowserStatus = {
    enabled: true,
    browsingAvailable: true,
    websiteTabCaptureAvailable: false,
    websiteTabCaptureUnavailableReason: 'Unsupported on iOS',
    systemVersion: 'mock',
    maxTabs: 100,
    profiles: [],
    tabs: [],
  }
  let opens = 0,
    closes = 0
  const module = {
    getStatus: async () => status,
    ensureProfile: async (profileId: string) => ({ profileId, dataStoreIdentifier: 'mock' }),
    openTab: async (options: { tabId: string; profileId: string; url: string }) => {
      opens++
      const tab = {
        ...options,
        instanceId: 'instance-one',
        title: 'Live',
        openerTabId: null,
        loadState: 'loaded' as const,
        progress: 1,
        canGoBack: false,
        canGoForward: false,
        secure: false,
        error: null,
      }
      status.tabs.push(tab)
      return tab
    },
    closeTab: async (tabId: string) => {
      closes++
      status.tabs = status.tabs.filter((tab) => tab.tabId !== tabId)
    },
  }
  const options = { tabId: 'one', profileId: 'work', url: 'http://localhost:3000' }
  const [first, second] = await Promise.all([
    prepareNativeTab(module, options),
    prepareNativeTab(module, { ...options, url: 'http://ignored' }),
  ])
  expect(opens).toBe(1)
  expect(second).toBe(first)
  expect(second.url).toBe(options.url)
  await expect(prepareNativeTab(module, { ...options, profileId: 'personal' })).rejects.toThrow(
    /different profile/,
  )
  await closeNativeTab(module, 'unlaunched')
  expect(closes).toBe(0)
  await closeNativeTab(module, 'one')
  expect(closes).toBe(1)
})
