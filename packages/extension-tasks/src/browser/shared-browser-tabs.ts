import {
  decodeResult,
  isPrivateBrowserProfile,
  browserTabLifecycleFields,
  type BrowserTabLifecycle,
} from '@dovo/protocol'
import { Schema } from 'effect'
export type BrowserTab = BrowserTabLifecycle & {
  id: string
  url: string
  title: string
  kind: 'web' | 'remote'
  profileId: string
  runtimeId?: string
  favicon?: string
  visitedAt?: number
  pinned?: boolean
  /** Temporary page opened by a link; promotion keeps this exact page identity. */
  previewOf?: string
}
const tabSchema = Schema.Struct({
  ...browserTabLifecycleFields,
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(['web', 'remote']),
  profileId: Schema.String,
  runtimeId: Schema.optional(Schema.String),
  favicon: Schema.optional(Schema.String),
  visitedAt: Schema.optional(Schema.Number),
  pinned: Schema.optional(Schema.Boolean),
})
const schema = Schema.Struct({
  active: Schema.String,
  tabs: Schema.Array(tabSchema),
  bookmarks: Schema.optional(Schema.Array(tabSchema)),
  closed: Schema.optional(Schema.Array(tabSchema)),
  visits: Schema.optional(Schema.Array(tabSchema)),
})
export type BrowserTabs = {
  tabs: BrowserTab[]
  active: string
  bookmarks?: BrowserTab[]
  closed?: BrowserTab[]
  visits?: BrowserTab[]
}
const key = 'dovo.shared-browser-tabs.v1'
export const SHARED_BROWSER_LIBRARY_KEY = 'dovo.shared-browser-library.v1'
export type BrowserLibraryState = { bookmarks: BrowserTab[]; visits: BrowserTab[] }
const librarySchema = Schema.Struct({
  bookmarks: Schema.Array(tabSchema),
  visits: Schema.Array(tabSchema),
})
function windowKey(windowId: string) {
  if (windowId === 'main') return key
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(windowId))
    throw new Error('Invalid browser window ID.')
  return `${key}.window.${windowId.toLowerCase()}`
}
function validatedTabs(input: unknown): BrowserTabs {
  const result = decodeResult(schema, input)
  if (
    !result.success ||
    !result.data.tabs.length ||
    (result.data.bookmarks?.length ?? 0) > 100 ||
    (result.data.closed?.length ?? 0) > 20 ||
    (result.data.visits?.length ?? 0) > 200 ||
    result.data.tabs.length > 100 ||
    new Set(result.data.tabs.map((tab) => tab.id)).size !== result.data.tabs.length ||
    !result.data.tabs.some((tab) => tab.id === result.data.active)
  )
    throw new Error('Saved browser tabs could not be restored.')
  const state = result.data
  return {
    active: state.active,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    ...(state.closed ? { closed: state.closed.map((tab) => ({ ...tab })) } : {}),
    ...(state.bookmarks ? { bookmarks: state.bookmarks.map((tab) => ({ ...tab })) } : {}),
    ...(state.visits ? { visits: state.visits.map((tab) => ({ ...tab })) } : {}),
  }
}
function validatedLibrary(input: unknown): BrowserLibraryState {
  const result = decodeResult(librarySchema, input)
  if (!result.success || result.data.bookmarks.length > 100 || result.data.visits.length > 200)
    throw new Error('Saved browser library could not be restored.')
  return {
    bookmarks: result.data.bookmarks.map((tab) => ({ ...tab })),
    visits: result.data.visits.map((tab) => ({ ...tab })),
  }
}
export function readSharedBrowserLibrary(): BrowserLibraryState & { error?: string } {
  try {
    const raw = localStorage.getItem(SHARED_BROWSER_LIBRARY_KEY)
    if (raw !== null && raw !== undefined) return validatedLibrary(JSON.parse(raw))
    const legacy = localStorage.getItem(key)
    if (!legacy) return { bookmarks: [], visits: [] }
    const state = validatedTabs(JSON.parse(legacy))
    const library = { bookmarks: state.bookmarks ?? [], visits: state.visits ?? [] }
    if (state.bookmarks !== undefined || state.visits !== undefined)
      saveSharedBrowserLibrary(library)
    return library
  } catch {
    return { bookmarks: [], visits: [], error: 'Saved browser library could not be restored.' }
  }
}
export function saveSharedBrowserLibrary(state: BrowserLibraryState) {
  const library = validatedLibrary(state)
  localStorage.setItem(SHARED_BROWSER_LIBRARY_KEY, JSON.stringify(library))
}
// Extra windows survive reload only; restoring them after app quit is intentionally unsupported.
export function readSharedBrowserTabs(windowId = 'main'): { state?: BrowserTabs; error?: string } {
  try {
    const storageKey = windowKey(windowId)
    const storage = windowId === 'main' ? localStorage : sessionStorage
    const raw = storage.getItem(storageKey)
    if (!raw) return {}
    const saved = validatedTabs(JSON.parse(raw))
    const state: BrowserTabs = {
      active: saved.active,
      tabs: saved.tabs,
      ...(saved.closed ? { closed: saved.closed } : {}),
    }
    // Migrate before the next tab save removes legacy embedded library fields.
    if (windowId === 'main' && (saved.bookmarks !== undefined || saved.visits !== undefined)) {
      const library = readSharedBrowserLibrary()
      if (library.error) return { state, error: library.error }
    }
    return { state }
  } catch {
    return { error: 'Saved browser tabs could not be restored. Tabs will remain in this session.' }
  }
}
export function saveSharedBrowserTabs(state: BrowserTabs, windowId = 'main') {
  const storageKey = windowKey(windowId)
  // Explicitly project window state: stale library snapshots must never overwrite shared data.
  const saved = validatedTabs({ active: state.active, tabs: state.tabs, closed: state.closed })
  const storage = windowId === 'main' ? localStorage : sessionStorage
  storage.setItem(storageKey, JSON.stringify(saved))
}
export function recentBrowserTabs(tabs: readonly BrowserTab[]) {
  return tabs
    .filter((tab) => !tab.previewOf)
    .sort(
      (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.visitedAt ?? 0) - (a.visitedAt ?? 0),
    )
}

export function visitBrowserTab(tabs: BrowserTab[], id: string, now = Date.now()) {
  const visitedAt = Math.max(now, ...tabs.map((tab) => (tab.visitedAt ?? 0) + 1))
  return tabs.map((tab) => (tab.id === id ? { ...tab, visitedAt } : tab))
}
export function browserQuote(selection: { text: string; url: string; title: string }) {
  const source = `${selection.title || 'Browser selection'}\n${selection.url}`
  if (selection.text === '') return source
  const quote = selection.text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
  return `${source}\n\n${quote}`
}

/** Resolve address-bar input without upgrading explicitly supplied HTTP addresses. */
export function browserAddress(input: string): string {
  const value = input.trim()
  if (!value) return ''
  const checked = (url: URL) => {
    if (url.username || url.password)
      throw new Error('Use an HTTP or HTTPS address without credentials.')
    if (url.href.length > 4096)
      throw new Error('Browser addresses must be at most 4096 characters.')
    return url.href
  }
  if (value.length > 4096) throw new Error('Browser addresses must be at most 4096 characters.')
  const explicit = /^([a-z][a-z\d+.-]*):/i.exec(value)
  const hostPort =
    /^[^\s/:]+:\d+(?:[/?#]|$)/.test(value) &&
    !/^(?:javascript|data|file|vbscript|blob|about|ftp|intent|mailto|chrome|devtools):/i.test(value)
  if (explicit && !hostPort) {
    if (!/^https?:$/i.test(explicit[0]))
      throw new Error('Only HTTP and HTTPS addresses are supported.')
    return checked(new URL(value))
  }
  const host = value.split(/[/?#]/, 1)[0] ?? ''
  const address =
    !/\s/.test(value) &&
    (host === 'localhost' ||
      host.startsWith('localhost:') ||
      host.startsWith('[') ||
      hostPort ||
      host.includes('.'))
  if (address) {
    const local =
      /^(?:localhost|[^.]+\.local|[^.]+\.lan)(?::|$)/i.test(host) ||
      /^\d{1,3}(?:\.\d{1,3}){3}(?::|$)/.test(host) ||
      host.startsWith('[') ||
      hostPort
    let url: URL | undefined
    try {
      url = new URL(`${local ? 'http' : 'https'}://${value}`)
    } catch {
      /* Search malformed host input. */
    }
    if (url) return checked(url)
  }
  return checked(new URL(`https://www.google.com/search?q=${encodeURIComponent(value)}`))
}

export function browserPageKey(tab: BrowserTab): string {
  return JSON.stringify([
    tab.url,
    tab.kind,
    tab.kind === 'remote' ? (tab.runtimeId ?? '') : '',
    tab.profileId,
  ])
}

export function rememberBrowserVisit(
  previous: readonly BrowserTab[],
  tab: BrowserTab,
): BrowserTab[] {
  const seen = new Set<string>()
  return (
    tab.url.trim() && !tab.previewOf && !isPrivateBrowserProfile(tab.profileId)
      ? [{ ...tab }, ...previous]
      : [...previous]
  )
    .filter((entry) => {
      if (!entry.url.trim()) return false
      const key = browserPageKey(entry)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 200)
}
