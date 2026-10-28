import { browserSearchUrl, type BrowserSearchEngine } from '@dovo/protocol'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  mutableArray,
  previewUrl,
  isPrivateBrowserProfile,
  browserTabLifecycleFields,
  wakeBrowserTab,
  settleBrowserTab,
  snoozeBrowserTab,
  browserTabCategory,
} from '@dovo/protocol'

const short = Schema.String.pipe(Schema.check(Schema.isMaxLength(200)))
const url = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(4096)),
  Schema.check(Schema.isPattern(/^(?:https?:\/\/[^\s]+)?$/)),
)
const common = {
  ...browserTabLifecycleFields,
  id: short,
  url,
  title: Schema.String.pipe(Schema.check(Schema.isMaxLength(500))),
  visitedAt: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  pinned: Schema.optional(Schema.Boolean),
  previewOf: Schema.optional(short),
  thread: Schema.optional(mutableStruct({ id: short, runtimeId: short })),
}
const tabSchema = Schema.Union([
  mutableStruct({
    ...common,
    kind: Schema.Literal('local'),
    profileId: Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/))),
  }),
  mutableStruct({ ...common, kind: Schema.Literal('remote'), profileId: short, runtimeId: short }),
])
export type BrowserTab = Schema.Schema.Type<typeof tabSchema>
const bounded = (limit: number) =>
  mutableArray(tabSchema).pipe(Schema.check(Schema.isMaxLength(limit)))
export const browserStateSchema = mutableStruct({
  version: Schema.Literal(1),
  active: short,
  tabs: bounded(100),
  bookmarks: bounded(100),
  history: bounded(200),
  closed: bounded(20),
})
export type BrowserState = Schema.Schema.Type<typeof browserStateSchema>
export const BROWSER_STORAGE_KEY = 'dovo.mobile-browser.v1'
export function parseBrowserState(raw: string): BrowserState {
  const value = decode(browserStateSchema, JSON.parse(raw))
  if (
    !value.tabs.length ||
    !value.tabs.some((tab) => tab.id === value.active) ||
    new Set(value.tabs.map((tab) => tab.id)).size !== value.tabs.length
  )
    throw new Error('Saved browser tabs are invalid.')
  for (const tab of [...value.tabs, ...value.bookmarks, ...value.history, ...value.closed]) {
    if (
      !tab.id ||
      (tab.kind === 'remote' && (!tab.runtimeId || !/^[\w-]{1,100}$/.test(tab.profileId)))
    )
      throw new Error('Saved browser source is invalid.')
    if (tab.url) previewUrl(tab.url)
  }
  return value
}
export function initialBrowserState(id: string): BrowserState {
  return {
    version: 1,
    active: id,
    tabs: [{ id, kind: 'local', profileId: 'device', url: '', title: '', visitedAt: Date.now() }],
    bookmarks: [],
    history: [],
    closed: [],
  }
}
export function persistableBrowserState(state: BrowserState, replacementId: string): BrowserState {
  const keep = (tab: BrowserTab) => !tab.previewOf && !isPrivateBrowserProfile(tab.profileId)
  const tabs = state.tabs.filter(keep)
  const fallback = initialBrowserState(replacementId)
  let selected = state.tabs.find((tab) => tab.id === state.active)
  const seen = new Set<string>()
  while (selected?.previewOf && !seen.has(selected.id)) {
    seen.add(selected.id)
    selected = state.tabs.find((tab) => tab.id === selected?.previewOf)
  }
  return {
    ...state,
    tabs: tabs.length ? tabs : fallback.tabs,
    active: tabs.some((tab) => tab.id === state.active)
      ? state.active
      : (tabs.find((tab) => tab.id === selected?.id)?.id ?? tabs[0]?.id ?? fallback.active),
    bookmarks: state.bookmarks.filter(keep),
    history: state.history.filter(keep),
    closed: state.closed.filter(keep),
  }
}
export const pageKey = (tab: BrowserTab) =>
  JSON.stringify([tab.url, tab.kind, tab.kind === 'remote' ? tab.runtimeId : '', tab.profileId])
export const recentTabs = (tabs: BrowserTab[]) =>
  tabs
    .filter((tab) => !tab.previewOf)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.visitedAt - a.visitedAt)
export function promoteTab(state: BrowserState, id: string): BrowserState {
  const tab = state.tabs.find((tab) => tab.id === id)
  if (!tab?.previewOf) return state
  const next = { ...tab, previewOf: undefined }
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? next : tab)),
    history:
      next.url && !isPrivateBrowserProfile(next.profileId)
        ? [next, ...state.history.filter((item) => pageKey(item) !== pageKey(next))].slice(0, 200)
        : state.history,
  }
}
export function togglePinnedTab(state: BrowserState, id: string): BrowserState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === id
        ? { ...(tab.pinned ? tab : wakeBrowserTab(tab)), pinned: !tab.pinned, previewOf: undefined }
        : tab,
    ),
  }
}
export function recordPage(
  state: BrowserState,
  id: string,
  page: { url: string; title: string },
): BrowserState {
  const tab = state.tabs.find((tab) => tab.id === id)
  if (!tab || !page.url || !/^https?:\/\//i.test(page.url)) return state
  const url = previewUrl(page.url)
  const next = {
    ...tab,
    url,
    title: page.title.slice(0, 500),
    ...(tab.url !== url
      ? { visitedAt: Math.max(Date.now(), ...state.tabs.map((item) => item.visitedAt + 1)) }
      : {}),
  }
  if (next.url.length > 4096) throw new Error('Page address is too long.')
  if (tab.url === next.url && tab.title === next.title) return state
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? next : tab)),
    history:
      tab.previewOf || isPrivateBrowserProfile(tab.profileId)
        ? state.history
        : [next, ...state.history.filter((item) => pageKey(item) !== pageKey(next))].slice(0, 200),
  }
}
export function visitTab(state: BrowserState, id: string, now = Date.now()): BrowserState {
  if (!state.tabs.some((tab) => tab.id === id)) return state
  return {
    ...state,
    active: id,
    tabs: state.tabs.map((tab) =>
      tab.id === id
        ? wakeBrowserTab(tab, now)
        : tab.id === state.active
          ? { ...tab, lastActiveAt: now }
          : tab,
    ),
  }
}
export function addTab(state: BrowserState, tab: BrowserTab): BrowserState {
  if (state.tabs.length >= 100) throw new Error('Close a tab before opening more than 100 tabs.')
  return visitTab({ ...state, tabs: [...state.tabs, tab] }, tab.id)
}
export function moveBrowserTab(
  state: BrowserState,
  id: string,
  replacementId: string,
  until?: number,
  now = Date.now(),
): BrowserState {
  const source = state.tabs.find((tab) => tab.id === id)
  if (!source) return state
  const tabs = state.tabs.map((tab) =>
    tab.id === id ? (until ? snoozeBrowserTab(tab, until, now) : settleBrowserTab(tab, now)) : tab,
  )
  const moved = { ...state, tabs }
  if (state.active !== id) return moved
  const other = recentTabs(tabs).filter((tab) => tab.id !== id)
  const next = other.find((tab) => browserTabCategory(tab, now) === 'active') ?? other[0]
  if (next) return visitTab(moved, next.id, now)
  const fallback: BrowserTab = {
    ...wakeBrowserTab(source, now),
    id: replacementId,
    url: '',
    title: '',
    pinned: false,
    previewOf: undefined,
    visitedAt: now,
    profileId: isPrivateBrowserProfile(source.profileId)
      ? source.kind === 'local'
        ? 'device'
        : 'default'
      : source.profileId,
  }
  return addTab(moved, fallback)
}
export function closeTab(state: BrowserState, id: string, replacementId: string): BrowserState {
  const closed = state.tabs.find((tab) => tab.id === id)
  if (!closed || closed.pinned) return state
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  const fallback = initialBrowserState(replacementId).tabs[0]
  const next = {
    ...state,
    tabs: tabs.length ? tabs : [fallback],
    active:
      state.active === id
        ? (tabs.find((tab) => tab.id === closed.previewOf)?.id ??
          recentTabs(tabs)[0]?.id ??
          fallback.id)
        : state.active,
    closed:
      closed.previewOf || isPrivateBrowserProfile(closed.profileId)
        ? state.closed
        : [closed, ...state.closed].slice(0, 20),
  }
  return next.active === state.active ? next : visitTab(next, next.active)
}
export function toggleBookmark(state: BrowserState, tab: BrowserTab): BrowserState {
  if (tab.previewOf || isPrivateBrowserProfile(tab.profileId)) return state
  const exists = state.bookmarks.some((item) => pageKey(item) === pageKey(tab))
  if (!exists && state.bookmarks.length >= 100)
    throw new Error('Remove a bookmark before saving more than 100 pages.')
  return {
    ...state,
    bookmarks: exists
      ? state.bookmarks.filter((item) => pageKey(item) !== pageKey(tab))
      : [...state.bookmarks, tab],
  }
}
/** Explicit HTTP and localhost retain their meaning on the selected computer. */
export function browserAddress(input: string, search?: BrowserSearchEngine): string {
  const value = input.trim()
  if (!value) throw new Error('Enter an address or search terms.')
  if (value.length > 4096) throw new Error('Address or search is too long.')
  const hostPort =
    /^[^\s/:]+:\d+(?:[/?#]|$)/.test(value) &&
    !/^(?:javascript|data|file|vbscript|about|blob|intent|ftp):/i.test(value)
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !hostPort) return previewUrl(value)
  const host = value.split(/[/?#]/, 1)[0] ?? ''
  if (
    !/\s/.test(value) &&
    (host.includes('.') ||
      host === 'localhost' ||
      host.startsWith('localhost:') ||
      host.startsWith('[') ||
      hostPort)
  ) {
    const local =
      /^(?:localhost|[^.]+\.local|[^.]+\.lan)(?::|$)/i.test(host) ||
      /^\d{1,3}(?:\.\d{1,3}){3}(?::|$)/.test(host) ||
      host.startsWith('[') ||
      hostPort
    return previewUrl(`${local ? 'http' : 'https'}://${value}`)
  }
  return browserSearchUrl(value, search)
}
export type BrowserSelection = { text: string; url: string; title: string }
export function appendBrowserDraft(draft: string, selection: BrowserSelection) {
  const source = `${selection.title || 'Browser page'}\n${selection.url}`
  const quote = selection.text
    ? `\n\n${selection.text
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join('\n')}`
    : ''
  return [draft, source + quote].filter(Boolean).join('\n\n')
}

/** Page-created tabs retain the native page and open as a temporary preview of their opener. */
export function adoptNativeTab(
  state: BrowserState,
  page: {
    tabId: string
    profileId: string
    url: string | null
    title: string
    openerTabId?: string | null
  },
  now = Date.now(),
): BrowserState {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(page.tabId) || !/^[A-Za-z0-9_-]{1,64}$/.test(page.profileId))
    throw new Error('Invalid native tab identity.')
  const existing = state.tabs.find((tab) => tab.id === page.tabId)
  if (existing) return state
  if (state.tabs.length >= 100) throw new Error('Close a tab before opening more than 100 tabs.')
  const tab: BrowserTab = {
    id: page.tabId,
    kind: 'local',
    profileId: page.profileId,
    url: page.url && /^https?:\/\//i.test(page.url) ? previewUrl(page.url) : '',
    title: page.title.slice(0, 500),
    visitedAt: now,
    previewOf:
      page.openerTabId && state.tabs.some((tab) => tab.id === page.openerTabId)
        ? page.openerTabId
        : undefined,
  }
  if (tab.url.length > 4096) throw new Error('Page address is too long.')
  return { ...state, tabs: [...state.tabs, tab], active: tab.previewOf ? tab.id : state.active }
}
