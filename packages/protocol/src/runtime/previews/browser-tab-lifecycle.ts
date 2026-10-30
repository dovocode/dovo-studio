import { Schema } from 'effect'

const timestamp = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)
export const browserTabLifecycleFields = {
  keepAwake: Schema.optional(Schema.Boolean),
  lastActiveAt: Schema.optional(timestamp),
  settledAt: Schema.optional(timestamp),
  snoozedUntil: Schema.optional(timestamp),
}
export type BrowserTabLifecycle = {
  id: string
  url: string
  visitedAt?: number
  lastActiveAt?: number
  settledAt?: number
  snoozedUntil?: number
  pinned?: boolean
  keepAwake?: boolean
  previewOf?: string
}
export type BrowserTabCategory = 'active' | 'snoozed' | 'settled'
/** Communication apps need background execution for incoming messages and calls. */
export function browserDefaultKeepAwake(input: string) {
  try {
    const url = new URL(input)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ([
        'teams.microsoft.com',
        'teams.cloud.microsoft',
        'teams.live.com',
        'outlook.office.com',
        'outlook.office365.com',
        'outlook.live.com',
        'outlook.cloud.microsoft',
        'mail.google.com',
        'discord.com',
        'canary.discord.com',
        'ptb.discord.com',
        'web.whatsapp.com',
        'chat.google.com',
      ].includes(url.hostname) ||
        // Slack uses both app.slack.com and individual workspace subdomains.
        /^[a-z0-9-]+\.slack\.com$/.test(url.hostname))
    )
  } catch {
    return false
  }
}
/** Undefined follows the app default; false is a persisted, deliberate opt-out. */
export function browserTabKeepsAwake(tab: Pick<BrowserTabLifecycle, 'url' | 'keepAwake'>) {
  return tab.keepAwake ?? browserDefaultKeepAwake(tab.url)
}
export function browserTabCategory(tab: BrowserTabLifecycle, now = Date.now()): BrowserTabCategory {
  if (tab.snoozedUntil !== undefined && tab.snoozedUntil > now) return 'snoozed'
  return tab.settledAt !== undefined ? 'settled' : 'active'
}
export function wakeBrowserTab<T extends BrowserTabLifecycle>(tab: T, now = Date.now()): T {
  return { ...tab, settledAt: undefined, snoozedUntil: undefined, lastActiveAt: now }
}
export function settleBrowserTab<T extends BrowserTabLifecycle>(tab: T, now = Date.now()): T {
  return { ...tab, settledAt: now, snoozedUntil: undefined, previewOf: undefined }
}
export function snoozeBrowserTab<T extends BrowserTabLifecycle>(
  tab: T,
  until: number,
  now = Date.now(),
): T {
  if (!Number.isFinite(until) || until <= now) throw new Error('Choose a future time for this tab.')
  return { ...tab, settledAt: undefined, snoozedUntil: until, previewOf: undefined }
}
export function tomorrowBrowserTabWake(now = Date.now()) {
  const date = new Date(now)
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return date.getTime()
}
const minutes = Schema.Number.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 0, maximum: 525600 })),
)
export const browserTabCleanupSettingsFields = {
  browserAutoSettleMinutes: minutes,
  browserCloseSettledMinutes: minutes,
}
export type BrowserTabCleanupSettings = {
  browserAutoSettleMinutes: number
  browserCloseSettledMinutes: number
}
export const browserTabActivitySchema = Schema.Struct({ active: Schema.Boolean })

/** Decide transitions without closing pages; clients dispose the returned IDs on their owner. */
export function cleanBrowserTabs<T extends BrowserTabLifecycle>(
  tabs: readonly T[],
  settings: BrowserTabCleanupSettings,
  activeId: string,
  now = Date.now(),
  protectedIds: ReadonlySet<string> = new Set(),
): { tabs: T[]; closeIds: string[] } {
  const closeIds: string[] = []
  const next = tabs.flatMap((tab): T[] => {
    if (tab.snoozedUntil !== undefined && tab.snoozedUntil <= now) return [wakeBrowserTab(tab, now)]
    if (
      tab.id === activeId ||
      tab.pinned ||
      tab.keepAwake ||
      tab.previewOf ||
      protectedIds.has(tab.id)
    )
      return [tab]
    if (browserTabCategory(tab, now) === 'snoozed') return [tab]
    if (tab.settledAt !== undefined) {
      if (
        settings.browserCloseSettledMinutes > 0 &&
        now - tab.settledAt >= settings.browserCloseSettledMinutes * 60000
      ) {
        closeIds.push(tab.id)
        return []
      }
      return [tab]
    }
    if (settings.browserAutoSettleMinutes <= 0) return [tab]
    const lastActiveAt = tab.lastActiveAt ?? tab.visitedAt ?? now
    if (
      tab.url &&
      settings.browserAutoSettleMinutes > 0 &&
      now - lastActiveAt >= settings.browserAutoSettleMinutes * 60000
    )
      return [settleBrowserTab(tab, now)]
    return [tab.lastActiveAt === undefined ? { ...tab, lastActiveAt } : tab]
  })
  return { tabs: next, closeIds }
}
