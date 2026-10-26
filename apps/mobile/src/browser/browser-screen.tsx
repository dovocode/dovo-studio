import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import { randomUUID } from 'expo-crypto'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  TextInput,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { WebsiteCustomizationEditor } from './website-customization-editor'
import { BrowserThreadPanel } from './browser-thread-panel'
import {
  browserProfilesResultSchema,
  browserSelectionSchema,
  decodeResult,
  responses,
  selectedBrowserText,
  STUDIO_BROWSER_SCOPE,
  isPrivateBrowserProfile,
  browserTabCategory,
  tomorrowBrowserTabWake,
  cleanBrowserTabs,
  browserTabActivitySchema,
  type BrowserTabCategory,
  type BrowserProfile,
  type BrowserWebsiteCustomization,
  browserWebsiteCustomizationScript,
  websiteCustomizationPrompt,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useNavigation } from '../shell/navigation'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { appendRuntimeDraft } from '../tasks/draft/use-draft'
import { usePreviewActive } from '../tasks/preview/use-preview-active'
import { RemoteBrowser } from '../tasks/preview/remote-browser'
import {
  DovoWebKitBrowser,
  DovoWebKitBrowserView,
  useNativeBrowser,
  type BrowserTabState,
} from './native-browser'
import { prepareNativeTab, closeNativeTab } from './native-session'
import { Action } from '../ui/controls/action'
import { Icon } from '../ui/controls/icon'
import { IconButton } from '../ui/controls/icon-button'
import { Choice } from '../ui/controls/choice'
import { Field, SearchField } from '../ui/controls/field'
import { Text } from '../ui/content/text'
import { Sheet, type SheetHandle } from '../ui/layout/sheet'
import { useTheme } from '../ui/theme'
import { ScreenHeader } from '../ui/layout/screen-header'
import {
  BROWSER_STORAGE_KEY,
  initialBrowserState,
  parseBrowserState,
  persistableBrowserState,
  promoteTab,
  moveBrowserTab,
  browserAddress,
  recordPage,
  recentTabs,
  visitTab,
  addTab,
  adoptNativeTab,
  closeTab,
  toggleBookmark,
  togglePinnedTab,
  pageKey,
  appendBrowserDraft,
  type BrowserSelection,
  type BrowserState,
  type BrowserTab,
} from './browser-state'

/** Parent owns the experimental route/menu gate. Local WebView has one device cookie session. */
export function BrowserScreen() {
  const { styles, colors } = useTheme()
  const runtime = useRuntime()
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  const preferences = useMobilePreferences()
  const native = useNativeBrowser()
  const nativeAvailable = !!(
    native.status?.enabled &&
    native.status.browsingAvailable &&
    DovoWebKitBrowserView
  )
  const [nativeReady, setNativeReady] = useState('')
  const [nativeOpenError, setNativeOpenError] = useState('')
  const [nativeAttempt, setNativeAttempt] = useState(0)
  const [nativeProfileId, setNativeProfileId] = useState('')
  const [localProfiles, setLocalProfiles] = useState<string[]>(['device'])
  const switchingProfiles = useRef(new Set<string>())
  const nativeInstances = useRef(new Map<string, { instanceId: string; profileId: string }>())
  const adoptedRemoteTabs = useRef(new Set<string>())
  const { navigate } = useNavigation()
  const focused = usePreviewActive()
  const [state, setState] = useState<BrowserState>(() => initialBrowserState(randomUUID()))
  const current = useRef(state)
  const [loaded, setLoaded] = useState(false)
  const [writable, setWritable] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [address, setAddress] = useState('')
  const editing = useRef(false)
  const [navigation, setNavigation] = useState({ back: false, forward: false })
  const [source, setSource] = useState('device')
  const [clock, setClock] = useState(() => Date.now())
  const [tabCategory, setTabCategory] = useState<BrowserTabCategory>('active')
  const [profiles, setProfiles] = useState<BrowserProfile[]>([{ id: 'default', name: 'Default' }])
  const [customization, setCustomization] = useState<BrowserWebsiteCustomization | null>(null)
  const [threadOpen, setThreadOpen] = useState(false)
  const [customizationRequest, setCustomizationRequest] = useState<{
    tabId: string
    text: string
  } | null>(null)
  const [websiteReload, setWebsiteReload] = useState(0)
  const [library, setLibrary] = useState<'tabs' | 'bookmarks' | 'history' | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [pageActionsOpen, setPageActionsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<BrowserSelection | null>(null)
  const consumedSelection = useRef<BrowserSelection | null>(null)
  const draftSheet = useRef<SheetHandle>(null)
  const pageActionsSheet = useRef<SheetHandle>(null)
  const librarySheet = useRef<SheetHandle>(null)
  const optionsSheet = useRef<SheetHandle>(null)
  const web = useRef<WebView>(null)
  const pending = useRef<{
    id: string
    resolve: (value: BrowserSelection) => void
    reject: (cause: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const saves = useRef(Promise.resolve())
  const active = state.tabs.find((tab) => tab.id === state.active) ?? state.tabs[0]
  const nativeOpening =
    nativeAvailable && active.kind === 'local' && nativeReady !== `${active.id}:${active.profileId}`
  const owner =
    active.kind === 'remote'
      ? runtime.overviews.find((entry) => entry.profile.id === active.runtimeId)
      : undefined
  useEffect(() => {
    setCustomization(null)
    setThreadOpen(false)
  }, [active.id, active.profileId])
  const websiteOrigin = (() => {
    try {
      const url = new URL(active.url)
      return /^https?:$/.test(url.protocol) ? url.origin : undefined
    } catch {
      return undefined
    }
  })()
  useEffect(() => setCustomization(null), [websiteOrigin])
  const websiteProfiles = active.kind === 'local' ? preferences.browserProfiles : profiles
  const websiteProfile = websiteProfiles.find((profile) => profile.id === active.profileId)
  const websiteScripts = useMemo(
    () => (websiteProfile?.websites ?? []).map((site) => browserWebsiteCustomizationScript([site])),
    [websiteProfile?.websites],
  )
  const customizationSupported =
    active.kind === 'remote'
      ? !!owner?.connected
      : !nativeAvailable || !!DovoWebKitBrowser?.setWebsiteCustomizationScripts
  const openWebsiteEditor = () => {
    if (!websiteOrigin) return
    setCustomization(
      websiteProfile?.websites?.find((site) => site.origin === websiteOrigin) ?? {
        origin: websiteOrigin,
        enabled: true,
        css: '',
        script: '',
      },
    )
  }
  const saveWebsite = async (website: BrowserWebsiteCustomization | null) => {
    if (!customization) return
    const profile = websiteProfile ?? { id: active.profileId, name: active.profileId }
    const websites = [
      ...(profile.websites ?? []).filter((site) => site.origin !== customization.origin),
      ...(website ? [website] : []),
    ]
    const next = websiteProfiles.some((item) => item.id === profile.id)
      ? websiteProfiles.map((item) => (item.id === profile.id ? { ...item, websites } : item))
      : [...websiteProfiles, { ...profile, websites }]
    if (active.kind === 'remote') {
      if (!owner?.connected) throw new Error('This computer is offline.')
      const result = await runtime.readRuntime(
        owner.profile,
        '/api/previews/browser/profiles/save',
        { profiles: next },
        browserProfilesResultSchema,
      )
      setProfiles(result.profiles)
      setWebsiteReload((previous) => previous + 1)
    } else {
      if (nativeAvailable) {
        if (!DovoWebKitBrowser?.setWebsiteCustomizationScripts)
          throw new Error('Update the iPhone app to use website customizations.')
        await DovoWebKitBrowser.setWebsiteCustomizationScripts(
          active.profileId,
          websites.map((site) => browserWebsiteCustomizationScript([site])),
        )
      }
      updateMobilePreferences({ browserProfiles: next })
      if (nativeAvailable && DovoWebKitBrowser) await DovoWebKitBrowser.reload(active.id)
      else setWebsiteReload((previous) => previous + 1)
    }
  }
  const change = (update: (previous: BrowserState) => BrowserState) => {
    const next = update(current.current)
    if (next === current.current) return
    current.current = next
    setState(next)
  }
  useEffect(() => {
    let alive = true
    void AsyncStorage.getItem(BROWSER_STORAGE_KEY).then(
      (raw) => {
        if (!alive) return
        try {
          if (raw) {
            const restored = parseBrowserState(raw)
            current.current = restored
            setState(restored)
          }
          setWritable(true)
        } catch {
          setError(
            'Saved browser data could not be restored. Reset saved browser data to save new tabs.',
          )
        }
        setLoaded(true)
      },
      (cause) => {
        if (alive) {
          setError(`Could not load browser data: ${String(cause)}`)
          setLoaded(true)
        }
      },
    )
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (!loaded || !writable) return
    const raw = JSON.stringify(persistableBrowserState(state, randomUUID()))
    saves.current = saves.current
      .then(() => AsyncStorage.setItem(BROWSER_STORAGE_KEY, raw))
      .catch((cause) => setError(`Browser data could not be saved: ${String(cause)}`))
  }, [state, loaded, writable])
  useEffect(() => {
    setAddress(active.url)
    setNavigation({ back: false, forward: false })
    return () => {
      const request = pending.current
      if (request) {
        clearTimeout(request.timer)
        request.reject(new Error('Browser tab changed. Select text again.'))
        pending.current = null
      }
    }
  }, [active.id, active.profileId])
  useEffect(() => {
    let alive = true
    setProfiles([{ id: 'default', name: 'Default' }])
    if (owner?.connected)
      void runtime
        .readRuntime(
          owner.profile,
          '/api/previews/browser/profiles/read',
          {},
          browserProfilesResultSchema,
        )
        .then(
          (result) => {
            if (alive) setProfiles(result.profiles)
          },
          (cause) => {
            if (alive) setError(`Could not load browser profiles: ${String(cause)}`)
          },
        )
    return () => {
      alive = false
    }
  }, [owner?.profile.id, owner?.connected, runtime.readRuntime])
  useEffect(() => {
    const module = DovoWebKitBrowser
    if (!nativeAvailable || !module || !loaded) return
    let alive = true
    const updated = (page: BrowserTabState) => {
      if (!alive) return
      const instance = nativeInstances.current.get(page.tabId)
      if (instance && instance.instanceId !== page.instanceId) return
      const tab = current.current.tabs.find((tab) => tab.id === page.tabId)
      if (!tab || tab.kind !== 'local' || tab.profileId !== page.profileId) return
      nativeInstances.current.set(page.tabId, {
        instanceId: page.instanceId,
        profileId: page.profileId,
      })
      if (page.url)
        pageState(page.tabId, {
          url: page.url,
          title: page.title,
          back: page.canGoBack,
          forward: page.canGoForward,
        })
      if (page.error) setError(page.error)
    }
    const created = (page: BrowserTabState) => {
      if (!alive) return
      const existing = nativeInstances.current.get(page.tabId)
      if (
        existing &&
        existing.profileId === page.profileId &&
        existing.instanceId !== page.instanceId
      )
        return
      nativeInstances.current.set(page.tabId, {
        instanceId: page.instanceId,
        profileId: page.profileId,
      })
      try {
        change((state) => adoptNativeTab(state, page))
        updated(page)
      } catch (cause) {
        setError(String(cause))
        void module
          .closeTab(page.tabId)
          .catch((error) => setError(`Could not close rejected native tab: ${String(error)}`))
      }
    }
    const subscriptions = [
      module.addListener('onTabCreated', created),
      module.addListener('onTabUpdated', updated),
      module.addListener('onTabClosed', (page) => {
        if (!alive) return
        if (switchingProfiles.current.delete(page.instanceId)) return
        const instance = nativeInstances.current.get(page.tabId)
        if (instance && instance.instanceId !== page.instanceId) return
        nativeInstances.current.delete(page.tabId)
        const tab = current.current.tabs.find((tab) => tab.id === page.tabId)
        if (tab?.kind === 'local' && tab.profileId === page.profileId)
          change((state) => closeTab(state, page.tabId, randomUUID()))
      }),
      module.addListener('onExternalUrlBlocked', (page) => {
        if (alive) setError(`This page requested an unsupported external address: ${page.url}`)
      }),
    ]
    for (const closed of native.closedTabs) {
      const tab = current.current.tabs.find((tab) => tab.id === closed.tabId)
      const live = native.status?.tabs.some(
        (tab) => tab.tabId === closed.tabId && tab.profileId === closed.profileId,
      )
      if (!live && tab?.kind === 'local' && tab.profileId === closed.profileId)
        change((state) => closeTab(state, closed.tabId, randomUUID()))
    }
    for (const page of native.status?.tabs ?? []) created(page)
    return () => {
      alive = false
      subscriptions.forEach((subscription) => subscription.remove())
    }
  }, [nativeAvailable, loaded])
  useEffect(() => {
    const module = DovoWebKitBrowser
    setNativeReady('')
    setNativeOpenError('')
    if (!module || !nativeAvailable || !loaded || !focused || active.kind !== 'local') return
    let alive = true
    const key = `${active.id}:${active.profileId}`
    void (async () => {
      if (module.setWebsiteCustomizationScripts)
        await module.setWebsiteCustomizationScripts(active.profileId, websiteScripts)
      else if (websiteScripts.length)
        throw new Error('Update the iPhone app to use website customizations.')
      const page = await prepareNativeTab(module, {
        tabId: active.id,
        profileId: active.profileId,
        url: active.url || 'about:blank',
      })
      if (!alive) return
      nativeInstances.current.set(active.id, {
        instanceId: page.instanceId,
        profileId: page.profileId,
      })
      await module.activateTab(active.id)
      if (!alive) return
      if (page.url)
        pageState(active.id, {
          url: page.url,
          title: page.title,
          back: page.canGoBack,
          forward: page.canGoForward,
        })
      setNativeReady(key)
    })().catch((cause) => {
      if (alive) {
        const message = `Could not open native tab: ${String(cause)}`
        setError(message)
        setNativeOpenError(message)
      }
    })
    return () => {
      alive = false
    }
  }, [
    nativeAvailable,
    loaded,
    focused,
    active.id,
    active.profileId,
    active.kind,
    nativeAttempt,
    JSON.stringify(websiteScripts),
  ])
  const localProfile = async (id: string) => {
    const module = DovoWebKitBrowser
    if (!module || !nativeAvailable || active.kind !== 'local')
      throw new Error('Separate local profiles require the native WebKit browser.')
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
      throw new Error('Profile ID must be 1–64 letters, digits, underscores or hyphens.')
    if (isPrivateBrowserProfile(active.profileId) || isPrivateBrowserProfile(id))
      throw new Error('Private tabs keep their temporary profile until closed.')
    if (id === active.profileId) return
    await module.ensureProfile(id)
    const closingInstance = nativeInstances.current.get(active.id)?.instanceId
    if (closingInstance) switchingProfiles.current.add(closingInstance)
    try {
      const closed = await closeNativeTab(module, active.id)
      if (!closed && closingInstance) switchingProfiles.current.delete(closingInstance)
    } catch (cause) {
      if (closingInstance) switchingProfiles.current.delete(closingInstance)
      throw cause
    }
    change((state) => ({
      ...state,
      tabs: state.tabs.map((tab) => (tab.id === active.id ? { ...tab, profileId: id } : tab)),
    }))
    setLocalProfiles((ids) => [...new Set([...ids, id])])
    setNativeProfileId('')
  }
  const act = async (work: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const open = (tab: BrowserTab) => {
    change((state) => visitTab(state, tab.id))
    librarySheet.current?.dismiss()
  }
  const newTab = (saved?: BrowserTab, incognito = false) => {
    const tab: BrowserTab = saved
      ? {
          ...saved,
          id: randomUUID(),
          visitedAt: Date.now(),
          settledAt: undefined,
          snoozedUntil: undefined,
        }
      : source === 'device'
        ? {
            id: randomUUID(),
            kind: 'local',
            profileId: 'device',
            url: '',
            title: '',
            visitedAt: Date.now(),
          }
        : {
            id: randomUUID(),
            kind: 'remote',
            profileId: 'default',
            runtimeId: source,
            url: '',
            title: '',
            visitedAt: Date.now(),
          }
    if (incognito) tab.profileId = `private-${randomUUID()}`
    change((state) => addTab(state, tab))
    librarySheet.current?.dismiss()
  }
  const disposeTab = async (tab: BrowserTab) => {
    if (tab.kind === 'local' && nativeAvailable && DovoWebKitBrowser)
      await closeNativeTab(DovoWebKitBrowser, tab.id)
    if (tab.kind === 'remote') {
      const profile = runtime.profiles.find((profile) => profile.id === tab.runtimeId)
      const online = runtime.overviews.some(
        (entry) => entry.profile.id === tab.runtimeId && entry.connected,
      )
      if (profile && online)
        await runtime.readRuntime(
          profile,
          '/api/previews/browser/close',
          { taskId: STUDIO_BROWSER_SCOPE, tabId: tab.id, profileId: tab.profileId },
          responses.ok,
        )
    }
  }
  const close = async (tab: BrowserTab) => {
    if (tab.pinned) return
    await disposeTab(tab)
    change((state) => closeTab(state, tab.id, randomUUID()))
  }
  useEffect(() => {
    const retained = new Set<string>()
    let tab = state.tabs.find((tab) => tab.id === state.active)
    while (tab && !retained.has(tab.id)) {
      retained.add(tab.id)
      tab = state.tabs.find((item) => item.id === tab?.previewOf)
    }
    const discarded = state.tabs.filter((tab) => tab.previewOf && !retained.has(tab.id))
    if (!discarded.length) return
    const ids = new Set(discarded.map((tab) => tab.id))
    change((state) => ({ ...state, tabs: state.tabs.filter((tab) => !ids.has(tab.id)) }))
    for (const tab of discarded)
      void disposeTab(tab).catch((cause) => setError(`Could not close preview: ${String(cause)}`))
  }, [state.tabs, state.active])
  useEffect(() => {
    if (!loaded || !focused) return
    let stopped = false,
      running = false
    const settings = {
      browserAutoSettleMinutes: preferences.browserAutoSettleMinutes ?? 0,
      browserCloseSettledMinutes: preferences.browserCloseSettledMinutes ?? 0,
    }
    const sweep = async () => {
      if (running) return
      running = true
      try {
        const now = Date.now()
        setClock(now)
        const before = current.current
        const plan = cleanBrowserTabs(before.tabs, settings, before.active, now)
        const candidates = before.tabs.filter(
          (tab) =>
            plan.closeIds.includes(tab.id) ||
            plan.tabs.find((item) => item.id === tab.id)?.settledAt !== tab.settledAt,
        )
        const protectedIds = new Set<string>()
        if (candidates.length) {
          const local = candidates.filter((tab) => tab.kind === 'local')
          if (nativeAvailable && local.length) {
            try {
              if (DovoWebKitBrowser?.getActiveMediaTabIds) {
                for (const id of await DovoWebKitBrowser.getActiveMediaTabIds())
                  protectedIds.add(id)
              } else for (const tab of local) protectedIds.add(tab.id)
            } catch {
              for (const tab of local) protectedIds.add(tab.id)
            }
          }
          await Promise.all(
            candidates
              .filter((tab) => tab.kind === 'remote')
              .map(async (tab) => {
                const runtime = runtimeRef.current
                const owner = runtime.overviews.find((entry) => entry.profile.id === tab.runtimeId)
                if (!owner?.connected) {
                  protectedIds.add(tab.id)
                  return
                }
                try {
                  const status = await runtime.readRuntime(
                    owner.profile,
                    '/api/previews/browser/activity',
                    { taskId: STUDIO_BROWSER_SCOPE, tabId: tab.id, profileId: tab.profileId },
                    browserTabActivitySchema,
                  )
                  if (status.active) protectedIds.add(tab.id)
                } catch {
                  protectedIds.add(tab.id)
                }
              }),
          )
          for (const tab of current.current.tabs)
            if (!candidates.includes(tab)) protectedIds.add(tab.id)
        }
        if (stopped) return
        const currentState = current.current
        const result = cleanBrowserTabs(
          currentState.tabs,
          settings,
          currentState.active,
          now,
          protectedIds,
        )
        if (
          result.tabs.length === currentState.tabs.length &&
          result.tabs.every((tab, index) => tab === currentState.tabs[index])
        )
          return
        const closing = currentState.tabs.filter((tab) => result.closeIds.includes(tab.id))
        const restorable = closing.filter((tab) => !isPrivateBrowserProfile(tab.profileId))
        change((state) => ({
          ...state,
          tabs: result.tabs,
          closed: [...restorable, ...state.closed].slice(0, 20),
        }))
        for (const tab of closing)
          void disposeTab(tab).catch((cause) =>
            setError(`Could not close settled tab: ${String(cause)}`),
          )
      } catch (cause) {
        if (!stopped) setError(`Tab cleanup failed: ${String(cause)}`)
      } finally {
        running = false
      }
    }
    void sweep()
    const timer = setInterval(() => void sweep(), 30000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [
    loaded,
    focused,
    nativeAvailable,
    preferences.browserAutoSettleMinutes,
    preferences.browserCloseSettledMinutes,
  ])
  const move = (until?: number) =>
    optionsSheet.current?.dismiss(() =>
      change((state) => moveBrowserTab(state, active.id, randomUUID(), until)),
    )
  const pageState = (
    id: string,
    page: { url: string; title?: string; back?: boolean; forward?: boolean },
  ) => {
    try {
      change((state) => recordPage(state, id, { url: page.url, title: page.title ?? '' }))
      if (current.current.active === id) {
        if (!editing.current) setAddress(page.url === 'about:blank' ? '' : page.url)
        setNavigation({ back: page.back ?? false, forward: page.forward ?? false })
      }
    } catch (cause) {
      setError(String(cause))
    }
  }
  const navigateLocal = () =>
    void act(async () => {
      if (active.kind === 'local' && !nativeAvailable && active.profileId !== 'device')
        throw new Error('This tab requires its native WebKit profile.')
      if (DovoWebKitBrowser && !native.status)
        throw new Error(native.error || 'Native browser is still starting.')
      const url = browserAddress(address)
      if (nativeAvailable && DovoWebKitBrowser) {
        if (url === active.url) await DovoWebKitBrowser.reload(active.id)
        else await DovoWebKitBrowser.navigate(active.id, url)
        change((state) => recordPage(state, active.id, { url, title: '' }))
      } else if (url === active.url) web.current?.reload()
      else change((state) => recordPage(state, active.id, { url, title: '' }))
      setAddress(url)
      Keyboard.dismiss()
    })
  const capture = async (): Promise<BrowserSelection> => {
    if (active.kind === 'remote') {
      if (!owner?.connected) throw new Error('This tab’s computer is offline or no longer paired.')
      return runtime.readRuntime(
        owner.profile,
        '/api/previews/browser/selection',
        { taskId: STUDIO_BROWSER_SCOPE, tabId: active.id, profileId: active.profileId },
        browserSelectionSchema,
      )
    }
    if (nativeAvailable && DovoWebKitBrowser) {
      const result = await DovoWebKitBrowser.getSelection(active.id)
      return { text: result.text.slice(0, 32000), url: active.url, title: active.title }
    }
    if (!web.current || !active.url) throw new Error('Open a page first.')
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        pending.current = null
        reject(new Error('Could not read selection. Select text on the page and try again.'))
      }, 5000)
      pending.current = { id, resolve, reject, timer }
      web.current?.injectJavaScript(
        `(()=>{const text=(${selectedBrowserText.toString()})();window.ReactNativeWebView.postMessage(JSON.stringify({channel:'dovo-browser-selection',id:${JSON.stringify(id)},text,url:location.href,title:document.title}));})();true;`,
      )
    })
  }
  const selected = async () => {
    const value = await capture()
    if (!value.text.trim()) throw new Error('Select text on the page first.')
    return { ...value, text: value.text.slice(0, 32000) }
  }
  const saveDraft = async (runtimeId: string, taskId: string) => {
    if (!selection || consumedSelection.current === selection) return
    const entry = runtime.overviews.find((entry) => entry.profile.id === runtimeId)
    const task = entry?.snapshot?.workspace.tasks.find((task) => task.id === taskId)
    if (!entry?.connected || !task)
      throw new Error('This thread’s computer is offline or the thread is unavailable.')
    const captured = selection
    consumedSelection.current = captured
    const sheet = draftSheet.current
    let dismissed = !sheet
    let saved = false
    let navigated = false
    const openSavedDraft = () => {
      if (!saved || !dismissed || navigated) return
      navigated = true
      navigate('tasks', task.id, entry.profile.id)
    }
    // Consume before appending: the composer can receive text even when disk persistence fails.
    if (sheet)
      sheet.dismiss(() => {
        dismissed = true
        openSavedDraft()
      })
    else setSelection(null)
    try {
      await appendRuntimeDraft(
        entry.profile.id,
        task.id,
        appendBrowserDraft('', captured),
        task.draft,
      )
    } catch (cause) {
      setError(
        `The phone draft could not be saved: ${String(cause)}. The quote may already be in the composer. Open the thread to review it before adding again.`,
      )
      return
    }
    setNotice('Added to the thread draft. Review before sending.')
    saved = true
    openSavedDraft()
  }
  const describe = (tab: BrowserTab) =>
    isPrivateBrowserProfile(tab.profileId)
      ? 'Private · temporary profile'
      : tab.kind === 'local'
        ? !nativeAvailable && tab.profileId === 'device'
          ? 'This device · shared device session'
          : `This device · ${tab.profileId} profile${!nativeAvailable ? ' (native required)' : ''}`
        : `${runtime.profiles.find((profile) => profile.id === tab.runtimeId)?.name ?? 'Unavailable computer'} · ${tab.profileId}`
  const matches = (tab: BrowserTab) =>
    `${tab.title} ${tab.url} ${describe(tab)}`.toLowerCase().includes(query.trim().toLowerCase())
  const list = (tabs: BrowserTab[], kind: 'tabs' | 'saved' | 'bookmarks') =>
    tabs.filter(matches).map((tab) => (
      <View
        key={tab.id + pageKey(tab)}
        style={{ gap: 4, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 8 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${tab.title || tab.url || 'New tab'}`}
          onPress={() =>
            void act(async () => {
              const existing = current.current.tabs.find((item) =>
                kind === 'tabs' ? item.id === tab.id : pageKey(item) === pageKey(tab),
              )
              if (existing) open(existing)
              else newTab(tab)
            })
          }
        >
          <Text style={styles.text}>{tab.title || tab.url || 'New tab'}</Text>
          <Text style={styles.muted}>{describe(tab)}</Text>
          {!!tab.title && (
            <Text numberOfLines={1} style={styles.muted}>
              {tab.url}
            </Text>
          )}
        </Pressable>
        {kind === 'tabs' ? (
          <Action
            secondary
            label={`${tab.pinned ? 'Unpin' : 'Close'} ${tab.title || 'tab'}`}
            onPress={() =>
              tab.pinned
                ? change((state) => togglePinnedTab(state, tab.id))
                : void act(() => close(tab))
            }
          />
        ) : kind === 'bookmarks' ? (
          <Action
            secondary
            label="Remove bookmark"
            onPress={() =>
              change((state) => ({
                ...state,
                bookmarks: state.bookmarks.filter((item) => pageKey(item) !== pageKey(tab)),
              }))
            }
          />
        ) : null}
      </View>
    ))
  if (!loaded)
    return (
      <View style={styles.content}>
        <Text style={styles.muted}>Restoring browser…</Text>
      </View>
    )
  return (
    <KeyboardAvoidingView
      style={[
        styles.screen,
        active.previewOf
          ? {
              margin: 10,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
            }
          : undefined,
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title={active.previewOf ? 'Link preview' : 'Browser'}
        onBack={() => (active.previewOf ? void act(() => close(active)) : navigate('tasks'))}
      />
      {active.previewOf && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 12,
            paddingBottom: 8,
          }}
        >
          <Action
            secondary
            label="Close preview"
            disabled={busy}
            onPress={() => void act(() => close(active))}
          />
          <Action
            label="Keep as tab"
            onPress={() => change((state) => promoteTab(state, active.id))}
          />
        </View>
      )}
      <View style={{ paddingHorizontal: 12 }}>
        {native.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {native.error}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {notice ? <Text style={styles.muted}>{notice}</Text> : null}
        {!writable && (
          <Action
            label="Reset saved browser data"
            onPress={() =>
              void act(async () => {
                await AsyncStorage.removeItem(BROWSER_STORAGE_KEY)
                setWritable(true)
              })
            }
          />
        )}
      </View>
      <View style={{ flex: 1 }}>
        {!focused ? null : active.kind === 'remote' ? (
          owner?.connected ? (
            <RuntimeScope runtimeId={active.runtimeId}>
              <RemoteBrowser
                key={`${active.id}:${active.profileId}`}
                taskId={STUDIO_BROWSER_SCOPE}
                tabId={active.id}
                profileId={active.profileId}
                initialUrl={active.url}
                reloadToken={websiteReload}
                onClosed={() => change((state) => closeTab(state, active.id, randomUUID()))}
                onState={(page) => {
                  pageState(active.id, page)
                  const additions = (page.createdTabs ?? []).filter((child) => {
                    const key = JSON.stringify([active.runtimeId, child.id])
                    if (adoptedRemoteTabs.current.has(key)) return false
                    adoptedRemoteTabs.current.add(key)
                    return !current.current.tabs.some((tab) => tab.id === child.id)
                  })
                  const capacity = Math.max(0, 100 - current.current.tabs.length)
                  for (const child of additions.slice(capacity)) {
                    if (owner?.connected)
                      void runtime
                        .readRuntime(
                          owner.profile,
                          '/api/previews/browser/close',
                          {
                            taskId: STUDIO_BROWSER_SCOPE,
                            tabId: child.id,
                            profileId: active.profileId,
                          },
                          responses.ok,
                        )
                        .catch((error) => setError(String(error)))
                  }
                  if (additions.length > capacity)
                    setError('Close a tab before opening more browser tabs.')
                  if (additions.length)
                    change((state) => {
                      const tabs = additions
                        .slice(0, capacity)
                        .filter((child) => !state.tabs.some((tab) => tab.id === child.id))
                        .map((child) => ({
                          ...active,
                          id: child.id,
                          url: child.url,
                          title: '',
                          pinned: false,
                          visitedAt: Date.now(),
                          previewOf: active.id,
                        }))
                      return {
                        ...state,
                        tabs: [...state.tabs, ...tabs],
                        active: tabs[tabs.length - 1]?.id ?? state.active,
                      }
                    })
                }}
              />
            </RuntimeScope>
          ) : (
            <View style={styles.content}>
              <Text style={styles.muted}>
                This tab’s computer is offline or no longer paired. Its computer and profile are
                retained.
              </Text>
            </View>
          )
        ) : nativeAvailable && DovoWebKitBrowserView ? (
          nativeReady === `${active.id}:${active.profileId}` ? (
            <DovoWebKitBrowserView key={nativeReady} tabId={active.id} style={{ flex: 1 }} />
          ) : (
            <View style={styles.content}>
              <Text style={styles.muted}>{nativeOpenError || 'Opening native browser…'}</Text>
              {!!nativeOpenError && (
                <Action
                  label="Retry native tab"
                  onPress={() => setNativeAttempt((attempt) => attempt + 1)}
                />
              )}
            </View>
          )
        ) : DovoWebKitBrowser && !native.status ? (
          <Text style={styles.muted}>
            {native.error ? 'Native browser could not start.' : 'Native browser is starting.'}
          </Text>
        ) : active.profileId !== 'device' ? (
          <Text style={styles.error}>
            This tab requires its native WebKit profile. It will not be opened in the shared device
            session.
          </Text>
        ) : active.url ? (
          <WebView
            key={`${active.id}:${websiteReload}`}
            ref={web}
            injectedJavaScript={websiteScripts.join(';\n') + ';true;'}
            style={{ flex: 1 }}
            source={{ uri: active.url }}
            originWhitelist={['http://*', 'https://*']}
            mixedContentMode="always"
            allowFileAccess={false}
            sharedCookiesEnabled
            allowsBackForwardNavigationGestures
            setSupportMultipleWindows
            onOpenWindow={(event) =>
              void act(async () =>
                newTab({
                  ...active,
                  pinned: false,
                  previewOf: active.id,
                  url: browserAddress(event.nativeEvent.targetUrl),
                }),
              )
            }
            onShouldStartLoadWithRequest={(request) => {
              try {
                return (
                  request.url === 'about:blank' ||
                  (!!browserAddress(request.url) && /^https?:\/\//i.test(request.url))
                )
              } catch {
                return false
              }
            }}
            onNavigationStateChange={(page) =>
              pageState(active.id, {
                url: page.url,
                title: page.title,
                back: page.canGoBack,
                forward: page.canGoForward,
              })
            }
            onError={(event) => setError(event.nativeEvent.description)}
            onMessage={(event) => {
              try {
                const value: unknown = JSON.parse(event.nativeEvent.data)
                if (
                  !value ||
                  typeof value !== 'object' ||
                  !('channel' in value) ||
                  value.channel !== 'dovo-browser-selection' ||
                  !('id' in value) ||
                  value.id !== pending.current?.id
                )
                  return
                const decoded = decodeResult(browserSelectionSchema, value)
                if (!decoded.success) return
                const request = pending.current
                if (request) {
                  clearTimeout(request.timer)
                  pending.current = null
                  request.resolve({
                    ...decoded.data,
                    text: decoded.data.text.slice(0, 32000),
                    title: decoded.data.title.slice(0, 500),
                  })
                }
              } catch {
                setError('Could not read browser selection.')
              }
            }}
          />
        ) : (
          <View style={styles.content}>
            <Text style={styles.muted}>
              Enter an address or search below. Localhost refers to this phone; choose a paired
              computer to browse its services.
            </Text>
          </View>
        )}
      </View>
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 12,
          paddingTop: 10,
          paddingBottom: 4,
          gap: 4,
        }}
      >
        {active.kind === 'local' && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.elevated,
              borderRadius: 24,
              minHeight: 48,
            }}
          >
            <IconButton label="Browser options" icon="more" onPress={() => setOptionsOpen(true)} />
            <TextInput
              accessibilityLabel="Search or enter address"
              testID="Search or enter address"
              placeholder="Search or enter address"
              placeholderTextColor={colors.muted}
              selectionColor={colors.accent}
              value={address}
              onChangeText={setAddress}
              autoCapitalize="none"
              autoCorrect={false}
              selectTextOnFocus
              keyboardType="web-search"
              onFocus={() => {
                editing.current = true
              }}
              onBlur={() => {
                editing.current = false
              }}
              returnKeyType="go"
              onSubmitEditing={navigateLocal}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 48,
                color: colors.text,
                fontSize: 16,
                textAlign: 'center',
                paddingVertical: 8,
              }}
            />
            <IconButton
              label={address !== active.url || !active.url ? 'Go' : 'Reload'}
              icon={address !== active.url || !active.url ? 'next' : 'refresh'}
              disabled={busy || nativeOpening || !address.trim()}
              onPress={navigateLocal}
            />
          </View>
        )}
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          {active.kind === 'local' ? (
            <>
              <IconButton
                label="Back"
                icon="back"
                disabled={!navigation.back || busy || nativeOpening}
                onPress={() =>
                  void act(async () => {
                    if (nativeAvailable && DovoWebKitBrowser)
                      await DovoWebKitBrowser.goBack(active.id)
                    else web.current?.goBack()
                  })
                }
              />
              <IconButton
                label="Forward"
                icon="next"
                disabled={!navigation.forward || busy || nativeOpening}
                onPress={() =>
                  void act(async () => {
                    if (nativeAvailable && DovoWebKitBrowser)
                      await DovoWebKitBrowser.goForward(active.id)
                    else web.current?.goForward()
                  })
                }
              />
            </>
          ) : (
            <IconButton label="Browser options" icon="more" onPress={() => setOptionsOpen(true)} />
          )}
          <IconButton
            label="Page actions"
            icon="share"
            disabled={!active.url || nativeOpening}
            onPress={() => setPageActionsOpen(true)}
          />
          <IconButton
            label="Bookmarks"
            icon="history"
            onPress={() => {
              setQuery('')
              setLibrary('bookmarks')
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Tabs (${recentTabs(state.tabs).length})`}
            onPress={() => {
              setQuery('')
              setLibrary('tabs')
            }}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <View
              style={{
                borderWidth: 1.5,
                borderColor: colors.text,
                borderRadius: 6,
                minWidth: 23,
                height: 25,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
                {recentTabs(state.tabs).length}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
      {customization && (
        <WebsiteCustomizationEditor
          key={`${active.id}:${active.profileId}:${customization.origin}:${customization.css}:${customization.script}`}
          website={customization}
          profileName={websiteProfile?.name ?? active.profileId}
          onClose={() => setCustomization(null)}
          onSave={saveWebsite}
          onAgent={(website) => {
            setCustomization(null)
            setCustomizationRequest({
              tabId: active.id,
              text: websiteCustomizationPrompt(active.profileId, website, active.url),
            })
            setThreadOpen(true)
          }}
        />
      )}
      {threadOpen && (
        <BrowserThreadPanel
          thread={customizationRequest?.tabId === active.id ? undefined : active.thread}
          origin={
            !isPrivateBrowserProfile(active.profileId) && customizationSupported
              ? websiteOrigin
              : undefined
          }
          onClose={() => setThreadOpen(false)}
          onThread={async (thread) => {
            if (customizationRequest?.tabId === active.id) {
              const entry = runtime.overviews.find((item) => item.profile.id === thread.runtimeId)
              const task = entry?.snapshot?.workspace.tasks.find((item) => item.id === thread.id)
              if (!entry?.connected || !task) throw new Error('This thread is unavailable.')
              const request = customizationRequest
              // Consume before appending: a disk failure can still leave the draft in the composer.
              setCustomizationRequest(null)
              await appendRuntimeDraft(thread.runtimeId, thread.id, request.text, task.draft)
            }
            change((state) => ({
              ...state,
              tabs: state.tabs.map((tab) => (tab.id === active.id ? { ...tab, thread } : tab)),
            }))
          }}
          onProposal={(proposal) => {
            setThreadOpen(false)
            setCustomization(proposal)
          }}
        />
      )}
      {pageActionsOpen && (
        <Sheet
          ref={pageActionsSheet}
          title="Page actions"
          onClose={() => setPageActionsOpen(false)}
        >
          <Text numberOfLines={2} style={styles.title}>
            {active.title || active.url}
          </Text>
          <Action
            secondary
            label="Thread for this tab"
            onPress={() => pageActionsSheet.current?.dismiss(() => setThreadOpen(true))}
          />
          <Action
            secondary
            label="Customize website"
            disabled={
              !websiteOrigin || !customizationSupported || isPrivateBrowserProfile(active.profileId)
            }
            onPress={() => pageActionsSheet.current?.dismiss(openWebsiteEditor)}
          />
          <Action
            secondary
            label="Share page"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                await Share.share(
                  Platform.OS === 'ios'
                    ? { url: active.url, title: active.title }
                    : { message: active.url, title: active.title },
                )
              })
            }
          />
          <Action
            secondary
            label="Copy page address"
            onPress={() =>
              void act(async () => {
                await Clipboard.setStringAsync(active.url)
                setNotice('Page address copied.')
              })
            }
          />
          <Action
            secondary
            label={
              state.bookmarks.some((tab) => pageKey(tab) === pageKey(active))
                ? 'Remove bookmark'
                : 'Bookmark page'
            }
            disabled={busy || !!active.previewOf || isPrivateBrowserProfile(active.profileId)}
            onPress={() => change((state) => toggleBookmark(state, active))}
          />
          <Action
            secondary
            label="Copy selection"
            disabled={busy || !active.url || nativeOpening}
            onPress={() =>
              void act(async () => {
                const value = await selected()
                await Clipboard.setStringAsync(value.text)
                setNotice('Selection copied.')
              })
            }
          />
          <Action
            secondary
            label="Add selection to thread"
            disabled={busy || !active.url || nativeOpening}
            onPress={() =>
              void act(async () => {
                const value = await selected()
                pageActionsSheet.current?.dismiss(() => setSelection(value))
                setQuery('')
              })
            }
          />
          <Action
            secondary
            label="Add page to thread"
            disabled={busy || !active.url || nativeOpening}
            onPress={() => {
              pageActionsSheet.current?.dismiss(() =>
                setSelection({ text: '', url: active.url, title: active.title }),
              )
              setQuery('')
            }}
          />
        </Sheet>
      )}
      {optionsOpen && (
        <Sheet ref={optionsSheet} title="Browser options" onClose={() => setOptionsOpen(false)}>
          <Action secondary label="Settle tab" disabled={busy} onPress={() => move()} />
          <Action
            secondary
            label="Snooze for 1 hour"
            disabled={busy}
            onPress={() => move(Date.now() + 3600000)}
          />
          <Action
            secondary
            label="Snooze for 4 hours"
            disabled={busy}
            onPress={() => move(Date.now() + 14400000)}
          />
          <Action
            secondary
            label="Snooze until tomorrow"
            disabled={busy}
            onPress={() => move(tomorrowBrowserTabWake())}
          />
          <Action
            secondary
            label={active.pinned ? 'Unpin tab' : 'Pin tab'}
            onPress={() => change((state) => togglePinnedTab(state, active.id))}
          />
          <Action
            secondary
            label="History"
            onPress={() => {
              optionsSheet.current?.dismiss(() => {
                setQuery('')
                setLibrary('history')
              })
            }}
          />
          <Text style={styles.title}>Tab profile</Text>
          {isPrivateBrowserProfile(active.profileId) ? (
            <Text style={styles.muted}>
              Private · temporary profile. Website data is discarded when this tab closes.
            </Text>
          ) : active.kind === 'local' ? (
            nativeAvailable ? (
              <>
                <Choice
                  label="Local profile for this tab"
                  value={active.profileId}
                  items={[
                    ...new Set([
                      ...localProfiles,
                      ...[...state.tabs, ...state.bookmarks, ...state.history, ...state.closed]
                        .filter((tab) => tab.kind === 'local')
                        .map((tab) => tab.profileId),
                      active.profileId,
                      ...(native.status?.profiles.map((profile) => profile.profileId) ?? []),
                    ]),
                  ]
                    .filter((id) => !isPrivateBrowserProfile(id))
                    .map((id) => ({ id, name: id }))}
                  disabled={busy || nativeOpening}
                  onChange={(id) => void act(() => localProfile(id))}
                />
                <Field
                  label="New local profile ID"
                  value={nativeProfileId}
                  onChangeText={setNativeProfileId}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Action
                  label="Use new local profile"
                  disabled={busy || nativeOpening || !nativeProfileId}
                  onPress={() => void act(() => localProfile(nativeProfileId))}
                />
                <Text style={styles.muted}>Native WebKit · separate website data per profile</Text>
              </>
            ) : (
              <Text style={styles.muted}>
                {active.profileId === 'device'
                  ? 'This device · one shared device session (no separate local profiles)'
                  : `Native WebKit profile ${active.profileId} is required for this tab.`}
              </Text>
            )
          ) : (
            <Choice
              label="Profile for this tab"
              value={active.profileId}
              items={profiles}
              disabled={busy || !owner?.connected}
              onChange={(id) =>
                void act(async () => {
                  if (!owner?.connected) throw new Error('This computer is offline.')
                  await runtime.readRuntime(
                    owner.profile,
                    '/api/previews/browser/close',
                    { taskId: STUDIO_BROWSER_SCOPE, tabId: active.id, profileId: active.profileId },
                    responses.ok,
                  )
                  change((state) => ({
                    ...state,
                    tabs: state.tabs.map((tab) =>
                      tab.id === active.id && tab.kind === 'remote'
                        ? { ...tab, profileId: id }
                        : tab,
                    ),
                  }))
                })
              }
            />
          )}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Text style={styles.title}>Engine limitations</Text>
          {active.kind === 'remote' ? (
            <Text style={styles.muted}>
              Website camera, microphone and screen sharing depend on the paired browser engine.
              Dovo's remote stream is separate from a website call's media access.
            </Text>
          ) : (
            <>
              <Text style={styles.muted}>
                Website calls can request camera and microphone access with separate approval.
                Sharing another browser tab and its audio is unavailable in this mobile browser.
              </Text>
              {native.status &&
                'websiteTabCaptureAvailable' in native.status &&
                native.status.websiteTabCaptureAvailable === false &&
                'websiteTabCaptureUnavailableReason' in native.status &&
                typeof native.status.websiteTabCaptureUnavailableReason === 'string' && (
                  <Text style={styles.muted}>
                    {native.status.websiteTabCaptureUnavailableReason}
                  </Text>
                )}
            </>
          )}
        </Sheet>
      )}
      {library && (
        <Sheet
          ref={librarySheet}
          title={
            library === 'tabs' ? 'Browser tabs' : library === 'bookmarks' ? 'Bookmarks' : 'History'
          }
          onClose={() => setLibrary(null)}
        >
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Choice
            label="Computer for new tab"
            value={source}
            items={[
              { id: 'device', name: 'This device' },
              ...runtime.overviews.map((entry) => ({
                id: entry.profile.id,
                name: entry.profile.name,
                disabled: !entry.connected,
              })),
            ]}
            onChange={setSource}
          />
          <Action
            label="New tab"
            disabled={busy || state.tabs.length >= 100}
            onPress={() => void act(async () => newTab())}
          />
          <Action
            secondary
            label="New private tab"
            disabled={busy || state.tabs.length >= 100 || (source === 'device' && !nativeAvailable)}
            onPress={() => void act(async () => newTab(undefined, true))}
          />
          <SearchField label="Search browser pages" value={query} onChangeText={setQuery} />
          {library === 'tabs' ? (
            <>
              <Choice
                label="Tab category"
                value={tabCategory}
                items={(['active', 'snoozed', 'settled'] as const).map((id) => ({
                  id,
                  name: `${id === 'active' ? 'Active' : id === 'snoozed' ? 'Snoozed' : 'Settled'} (${recentTabs(state.tabs).filter((tab) => browserTabCategory(tab, clock) === id).length})`,
                }))}
                onChange={(value) => {
                  if (value === 'active' || value === 'snoozed' || value === 'settled')
                    setTabCategory(value)
                }}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {recentTabs(state.tabs)
                  .filter((tab) => browserTabCategory(tab, clock) === tabCategory)
                  .filter(matches)
                  .map((tab) => (
                    <View
                      key={tab.id}
                      style={{
                        width: '47%',
                        borderRadius: 18,
                        borderWidth: tab.id === active.id ? 2 : 1,
                        borderColor: tab.id === active.id ? colors.accent : colors.border,
                        backgroundColor: colors.surface,
                        overflow: 'hidden',
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingLeft: 12,
                        }}
                      >
                        <Icon
                          name={tab.pinned ? 'pin' : 'web'}
                          size={18}
                          color={tab.pinned ? colors.accent : colors.muted}
                        />
                        <IconButton
                          label={`${tab.pinned ? 'Unpin' : 'Close'} ${tab.title || 'tab'}`}
                          icon={tab.pinned ? 'unpin' : 'close'}
                          disabled={busy}
                          onPress={() =>
                            tab.pinned
                              ? change((state) => togglePinnedTab(state, tab.id))
                              : void act(() => close(tab))
                          }
                        />
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${tab.title || tab.url || 'New tab'}`}
                        accessibilityState={{ selected: tab.id === active.id }}
                        onPress={() => open(tab)}
                        style={{ minHeight: 116, padding: 12, gap: 8 }}
                      >
                        <Text numberOfLines={2} style={styles.text}>
                          {tab.title || 'New tab'}
                        </Text>
                        <Text numberOfLines={2} style={styles.muted}>
                          {tab.url || 'Search or enter address'}
                        </Text>
                        <Text numberOfLines={1} style={[styles.muted, { fontSize: 11 }]}>
                          {describe(tab)}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
              </View>
            </>
          ) : library === 'bookmarks' ? (
            <>
              <Text style={styles.title}>Bookmarks</Text>
              {list(state.bookmarks, 'bookmarks')}
              {!state.bookmarks.length && <Text style={styles.muted}>No bookmarks yet.</Text>}
            </>
          ) : (
            <>
              <Action
                secondary
                label="Reopen last closed tab"
                disabled={!state.closed.length || state.tabs.length >= 100}
                onPress={() =>
                  void act(async () => {
                    const tab = current.current.closed[0]
                    if (tab) {
                      newTab(tab)
                      change((state) => ({ ...state, closed: state.closed.slice(1) }))
                    }
                  })
                }
              />
              <Text style={styles.title}>History</Text>
              <Action
                secondary
                label="Clear history"
                onPress={() => change((state) => ({ ...state, history: [] }))}
              />
              {list(state.history, 'saved')}
              <Text style={styles.title}>Recently closed</Text>
              {list(state.closed, 'saved')}
            </>
          )}
        </Sheet>
      )}
      {selection && (
        <Sheet
          ref={draftSheet}
          title="Add to a thread draft"
          busy={busy}
          onClose={() => setSelection(null)}
        >
          <Text style={styles.muted}>
            Append the page source and selected text to this phone’s draft. Review before sending.
          </Text>
          <SearchField label="Find a thread" value={query} onChangeText={setQuery} />
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          {runtime.overviews.flatMap((entry) =>
            (entry.snapshot?.workspace.tasks ?? [])
              .filter(
                (task) =>
                  !task.archived &&
                  !task.example &&
                  `${task.title} ${entry.profile.name}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((task) => (
                <Action
                  key={entry.profile.id + task.id}
                  secondary
                  label={`${task.title || 'Untitled thread'} · ${entry.profile.name}`}
                  disabled={busy || !entry.connected}
                  onPress={() => void act(() => saveDraft(entry.profile.id, task.id))}
                />
              )),
          )}
        </Sheet>
      )}
    </KeyboardAvoidingView>
  )
}
