import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import { randomUUID } from 'expo-crypto'
import { useEffect, useRef, useState } from 'react'
import { View, ScrollView, Pressable } from 'react-native'
import { WebView } from 'react-native-webview'
import {
  browserProfilesResultSchema,
  browserSelectionSchema,
  decodeResult,
  responses,
  selectedBrowserText,
  STUDIO_BROWSER_SCOPE,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useNavigation } from '../shell/navigation'
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
import { NativeExtensions } from './native-extensions'
import { Action } from '../ui/controls/action'
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
  browserAddress,
  recordPage,
  recentTabs,
  visitTab,
  addTab,
  adoptNativeTab,
  closeTab,
  toggleBookmark,
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
  const [profiles, setProfiles] = useState([{ id: 'default', name: 'Default' }])
  const [library, setLibrary] = useState<'tabs' | 'library' | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<BrowserSelection | null>(null)
  const consumedSelection = useRef<BrowserSelection | null>(null)
  const draftSheet = useRef<SheetHandle>(null)
  const librarySheet = useRef<SheetHandle>(null)
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
    const raw = JSON.stringify(state)
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
  }, [nativeAvailable, loaded, focused, active.id, active.profileId, active.kind, nativeAttempt])
  const localProfile = async (id: string) => {
    const module = DovoWebKitBrowser
    if (!module || !nativeAvailable || active.kind !== 'local')
      throw new Error('Separate local profiles require the native WebKit browser.')
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
      throw new Error('Profile ID must be 1–64 letters, digits, underscores or hyphens.')
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
  const newTab = (saved?: BrowserTab) => {
    const tab: BrowserTab = saved
      ? { ...saved, id: randomUUID(), visitedAt: Date.now() }
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
    change((state) => addTab(state, tab))
    librarySheet.current?.dismiss()
  }
  const close = async (tab: BrowserTab) => {
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
    change((state) => closeTab(state, tab.id, randomUUID()))
  }
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
    tab.kind === 'local'
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
            label={`Close ${tab.title || 'tab'}`}
            onPress={() => void act(() => close(tab))}
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
    <View style={styles.screen}>
      <ScreenHeader title="Browser" />
      <View style={{ padding: 8, gap: 4, borderBottomWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <Action secondary label="Browser options" onPress={() => setOptionsOpen(true)} />
          <Action
            secondary
            label={`Tabs (${state.tabs.length})`}
            onPress={() => {
              setQuery('')
              setLibrary('tabs')
            }}
          />
          <Action
            secondary
            label="Bookmarks and history"
            onPress={() => {
              setQuery('')
              setLibrary('library')
            }}
          />
          <Action
            secondary
            label={
              state.bookmarks.some((tab) => pageKey(tab) === pageKey(active))
                ? 'Remove star'
                : 'Star page'
            }
            disabled={!active.url || busy}
            onPress={() => void act(async () => change((state) => toggleBookmark(state, active)))}
          />
        </View>
        {active.kind === 'local' ? (
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
                ].map((id) => ({ id, name: id }))}
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
                    tab.id === active.id && tab.kind === 'remote' ? { ...tab, profileId: id } : tab,
                  ),
                }))
              })
            }
          />
        )}
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
                onState={(page) => pageState(active.id, page)}
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
            key={active.id}
            ref={web}
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
                newTab({ ...active, url: browserAddress(event.nativeEvent.targetUrl) }),
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
      {active.kind === 'local' && (
        <View style={{ padding: 8, gap: 4 }}>
          <Field
            label="Search or enter address"
            value={address}
            onChangeText={setAddress}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => {
              editing.current = true
            }}
            onBlur={() => {
              editing.current = false
            }}
            returnKeyType="go"
            onSubmitEditing={navigateLocal}
          />
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Action
              secondary
              label="Back"
              disabled={!navigation.back}
              onPress={() =>
                void act(async () => {
                  if (nativeAvailable && DovoWebKitBrowser)
                    await DovoWebKitBrowser.goBack(active.id)
                  else web.current?.goBack()
                })
              }
            />
            <Action
              secondary
              label="Forward"
              disabled={!navigation.forward}
              onPress={() =>
                void act(async () => {
                  if (nativeAvailable && DovoWebKitBrowser)
                    await DovoWebKitBrowser.goForward(active.id)
                  else web.current?.goForward()
                })
              }
            />
            <Action
              secondary
              label="Reload"
              disabled={!active.url}
              onPress={() =>
                void act(async () => {
                  if (nativeAvailable && DovoWebKitBrowser)
                    await DovoWebKitBrowser.reload(active.id)
                  else web.current?.reload()
                })
              }
            />
            <Action label="Go" disabled={nativeOpening} onPress={navigateLocal} />
          </View>
        </View>
      )}
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 8, gap: 16 }}
      >
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
              setSelection(await selected())
              setQuery('')
            })
          }
        />
        <Action
          secondary
          label="Add page to thread"
          disabled={busy || !active.url || nativeOpening}
          onPress={() => {
            setSelection({ text: '', url: active.url, title: active.title })
            setQuery('')
          }}
        />
      </ScrollView>
      {nativeAvailable && native.status?.extensionsAvailable && (
        <NativeExtensions
          profileId={active.kind === 'local' ? active.profileId : 'device'}
          tabId={active.kind === 'local' ? active.id : null}
          visible={active.kind === 'local'}
          onError={setError}
        />
      )}
      {optionsOpen && (
        <Sheet title="Browser options" onClose={() => setOptionsOpen(false)}>
          <Text style={styles.title}>Engine limitations</Text>
          {active.kind === 'remote' ? (
            <Text style={styles.muted}>
              Website camera, microphone and screen sharing depend on the paired browser engine.
              Dovo's remote stream is separate from a website call's media access.
            </Text>
          ) : (
            <>
              <Text style={styles.muted}>
                Website calls can request camera and microphone access with separate approval. On
                iOS, sharing an arbitrary browser tab and its audio is unsupported; no capture
                polyfill is provided.
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
          title={library === 'tabs' ? 'Browser tabs' : 'Bookmarks and history'}
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
          <SearchField label="Search browser pages" value={query} onChangeText={setQuery} />
          {library === 'tabs' ? (
            list(recentTabs(state.tabs), 'tabs')
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
              <Text style={styles.title}>Bookmarks</Text>
              {list(state.bookmarks, 'bookmarks')}
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
    </View>
  )
}
