import { useEffect, useRef, useState } from 'react'
import { useAppPreferences } from '@dovo/studio-core'
import {
  browserTabCategory,
  browserTabKeepsAwake,
  isPrivateBrowserProfile,
  type BrowserBridge,
} from '@dovo/protocol'
import { readSharedBrowserTabs } from './shared-browser-tabs'

/** Main-window startup only. Reuse the pane's native keys so opening Browser adopts these pages. */
export async function restoreAwakeBrowserTabs(browser: BrowserBridge): Promise<string[]> {
  const saved = readSharedBrowserTabs()
  if (saved.error) return [saved.error]
  const tabs = (saved.state?.tabs ?? []).filter(
    (tab) =>
      tab.kind === 'web' &&
      !tab.detached &&
      !isPrivateBrowserProfile(tab.profileId) &&
      /^https?:\/\//i.test(tab.url) &&
      browserTabCategory(tab) === 'active' &&
      browserTabKeepsAwake(tab),
  )
  const results = await Promise.allSettled(
    tabs.map(async (tab) => {
      await browser({
        action: 'keep-awake',
        key: tab.nativeKey ?? `studio:browser:main:${tab.id}`,
        enabled: tab.keepAwake,
        url: tab.url,
        profileId: tab.profileId,
      })
    }),
  )
  return results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${tabs[index].title || tabs[index].url}: ${String(result.reason)}`]
      : [],
  )
}

/** Runs even when Studio starts in Threads. No page surface or navigation is mounted. */
export function BrowserStartup({ browser }: { browser?: BrowserBridge }) {
  const preferences = useAppPreferences()
  const enabled = preferences.browserWorkspaceEnabled || preferences.unifiedWorkspaceEnabled
  const started = useRef<{ browser: BrowserBridge; result: Promise<string[]> } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  useEffect(() => {
    if (!browser || !enabled) return
    if (started.current?.browser !== browser)
      started.current = { browser, result: restoreAwakeBrowserTabs(browser) }
    let active = true
    void started.current.result.then((result) => {
      if (active) setErrors(result)
    })
    return () => {
      active = false
    }
  }, [browser, enabled])
  if (!enabled || !errors.length) return null
  return (
    <aside
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border bg-card p-3 text-xs text-destructive shadow-md"
    >
      <p>Could not restore some Keep awake tabs. Open Browser to retry.</p>
      <p className="mt-1 break-words">{errors.join('\n')}</p>
      <button type="button" className="mt-2 underline" onClick={() => setErrors([])}>
        Dismiss
      </button>
    </aside>
  )
}
