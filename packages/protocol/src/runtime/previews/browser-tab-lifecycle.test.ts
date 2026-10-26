import { expect, it } from 'vite-plus/test'
import { Schema } from 'effect'
import { decodeResult } from '../../shared/schema.js'
import {
  browserTabCategory,
  browserTabCleanupSettingsFields,
  cleanBrowserTabs,
  settleBrowserTab,
  snoozeBrowserTab,
  wakeBrowserTab,
  tomorrowBrowserTabWake,
} from './browser-tab-lifecycle'

const minute = 60000
const off = { browserAutoSettleMinutes: 0, browserCloseSettledMinutes: 0 }
const tab = {
  id: 'work',
  url: 'http://lan.local/',
  profileId: 'work',
  runtimeId: 'mac',
  visitedAt: minute,
  lastActiveAt: 2 * minute,
}
it('does no automatic settling or closing with both timers off', () => {
  const settled = settleBrowserTab({ ...tab, id: 'settled' }, minute)
  expect(cleanBrowserTabs([tab, settled], off, 'current', 100 * minute)).toEqual({
    tabs: [tab, settled],
    closeIds: [],
  })
})
it('settles unused background tabs at the exact deadline and starts the close clock then', () => {
  const settings = { browserAutoSettleMinutes: 10, browserCloseSettledMinutes: 5 }
  expect(cleanBrowserTabs([tab], settings, 'current', 12 * minute - 1).tabs[0]).toBe(tab)
  const result = cleanBrowserTabs([tab], settings, 'current', 12 * minute)
  expect(result.tabs[0]).toEqual({
    ...tab,
    settledAt: 12 * minute,
    snoozedUntil: undefined,
    previewOf: undefined,
  })
  expect(result.closeIds).toEqual([])
  expect(cleanBrowserTabs(result.tabs, settings, 'current', 17 * minute).closeIds).toEqual(['work'])
})
it('never closes an old unused tab immediately when first settling it after restart', () => {
  const result = cleanBrowserTabs(
    [tab],
    { browserAutoSettleMinutes: 1, browserCloseSettledMinutes: 1 },
    'current',
    10000 * minute,
  )
  expect(result.tabs[0]).toMatchObject({ settledAt: 10000 * minute })
  expect(result.closeIds).toEqual([])
})
it('closes manually settled tabs independently of the auto-settle setting', () => {
  const settled = settleBrowserTab(tab, 3 * minute)
  const settings = { ...off, browserCloseSettledMinutes: 5 }
  expect(cleanBrowserTabs([settled], settings, 'current', 8 * minute - 1).closeIds).toEqual([])
  expect(cleanBrowserTabs([settled], settings, 'current', 8 * minute)).toEqual({
    tabs: [],
    closeIds: ['work'],
  })
})
it.each(['unused', 'settled'] as const)(
  'protects current, pinned, preview and active media tabs when %s',
  (state) => {
    const base = state === 'settled' ? settleBrowserTab(tab, 0) : tab
    const tabs = [
      { ...base, id: 'current' },
      { ...base, id: 'pinned', pinned: true },
      { ...base, id: 'preview', previewOf: 'source' },
      { ...base, id: 'media' },
    ]
    const result = cleanBrowserTabs(
      tabs,
      { browserAutoSettleMinutes: 1, browserCloseSettledMinutes: 1 },
      'current',
      100 * minute,
      new Set(['media']),
    )
    expect(result.tabs).toEqual(tabs)
    expect(result.closeIds).toEqual([])
  },
)
it('snoozes until the selected time, wakes without stealing selection, and resets the inactivity clock', () => {
  const snoozed = snoozeBrowserTab(settleBrowserTab(tab, minute), 10 * minute, 3 * minute)
  const settings = { browserAutoSettleMinutes: 1, browserCloseSettledMinutes: 1 }
  expect(browserTabCategory(snoozed, 9 * minute)).toBe('snoozed')
  expect(cleanBrowserTabs([snoozed], settings, 'current', 10 * minute - 1).tabs[0]).toBe(snoozed)
  const result = cleanBrowserTabs([snoozed], settings, 'current', 10 * minute)
  expect(result.tabs[0]).toEqual({
    ...snoozed,
    snoozedUntil: undefined,
    settledAt: undefined,
    lastActiveAt: 10 * minute,
  })
  expect(browserTabCategory(result.tabs[0]!, 10 * minute)).toBe('active')
  expect(result.closeIds).toEqual([])
})
it('wakes expired snoozes with timers off and retains URL, profile and owning computer', () => {
  const result = cleanBrowserTabs(
    [snoozeBrowserTab(tab, 10 * minute, minute)],
    off,
    'other',
    11 * minute,
  )
  expect(result.tabs[0]).toEqual(wakeBrowserTab(tab, 11 * minute))
})
it('starts a missing legacy inactivity timestamp on the first check and ignores blank tabs', () => {
  const legacy = { id: 'legacy', url: 'http://localhost/' }
  const result = cleanBrowserTabs(
    [legacy, { ...legacy, id: 'blank', url: '' }],
    { ...off, browserAutoSettleMinutes: 5 },
    'other',
    100 * minute,
  )
  expect(result.closeIds).toEqual([])
  expect(result.tabs[0]).toEqual({ ...legacy, lastActiveAt: 100 * minute })
  expect(browserTabCategory(result.tabs[1]!, 100 * minute)).toBe('active')
})
it('validates configurable timers and rejects past or non-finite snooze dates', () => {
  const schema = Schema.Struct(browserTabCleanupSettingsFields)
  for (const value of [-1, 0.5, NaN, Infinity, 525601])
    expect(decodeResult(schema, { ...off, browserAutoSettleMinutes: value }).success).toBe(false)
  expect(
    decodeResult(schema, { browserAutoSettleMinutes: 0, browserCloseSettledMinutes: 123 }).success,
  ).toBe(true)
  for (const until of [0, minute, Infinity, NaN])
    expect(() => snoozeBrowserTab(tab, until, minute)).toThrow(/future time/)
})
it('uses nine in the morning on the next local calendar day for Tomorrow', () => {
  const date = new Date(2026, 9, 26, 15)
  expect(new Date(tomorrowBrowserTabWake(date.getTime()))).toEqual(new Date(2026, 9, 27, 9))
})
