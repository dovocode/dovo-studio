import { expect, it } from 'vite-plus/test'
import { Schema } from 'effect'
import { decodeResult } from '../../shared/schema.js'
import {
  browserTabCategory,
  browserDefaultKeepAwake,
  browserTabKeepsAwake,
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
it.each([
  'https://teams.microsoft.com/v2/',
  'https://teams.cloud.microsoft/',
  'https://teams.live.com/',
  'https://outlook.office.com/mail/',
  'https://outlook.office365.com/',
  'https://outlook.live.com/mail/0/',
  'https://outlook.cloud.microsoft/',
  'https://mail.google.com/mail/u/0/',
  'https://app.slack.com/client/T123/C123',
  'https://example-workspace.slack.com/',
  'https://EXAMPLE.slack.com/messages/general',
  'https://discord.com/channels/@me',
  'https://canary.discord.com/channels/@me',
  'https://ptb.discord.com/channels/@me',
  'https://web.whatsapp.com/',
  'https://chat.google.com/',
])('keeps communication app %s awake by default, with an explicit opt-out', (url) => {
  expect(browserDefaultKeepAwake(url)).toBe(true)
  expect(browserTabKeepsAwake({ url })).toBe(true)
  expect(browserTabKeepsAwake({ url, keepAwake: false })).toBe(false)
})
it.each([
  'https://example.com/',
  'https://teams.microsoft.com.example.com/',
  'https://example.com/?next=https://mail.google.com/',
  'https://notmail.google.com/',
  'https://slack.com/',
  'https://app.slack.com.example.com/',
  'https://notslack.com/',
  'https://discord.com.example.com/',
  'https://support.discord.com/',
  'https://www.whatsapp.com/',
  'https://web.whatsapp.com.example.com/',
  'https://chat.google.com.example.com/',
  'https://accounts.google.com/',
  'https://www.microsoft.com/',
  'http://192.168.1.2:3000/',
  'file://mail.google.com/mail/',
  'file://app.slack.com/client/',
  'not a URL',
])('allows other pages and look-alike hosts to sleep: %s', (url) => {
  expect(browserTabKeepsAwake({ url })).toBe(false)
  expect(browserTabKeepsAwake({ url, keepAwake: true })).toBe(true)
})
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
      { ...base, id: 'awake', keepAwake: true },
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
