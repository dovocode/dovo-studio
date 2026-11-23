import { parseStudioReference } from '../../runtime/studio-reference.js'

/** Shared link destinations. Links only navigate; they never change a setting or start work. */
export const settingsLinkPages = [
  ['general', '/settings/general', 'General'],
  ['appearance', '/settings/appearance', 'Appearance'],
  ['conversation-settings', '/settings/conversation', 'Conversation'],
  ['speech', '/settings/speech', 'Speech'],
  ['notifications', '/settings/notifications', 'Notifications'],
  ['task-list-settings', '/settings/task-preferences', 'Thread list'],
  ['agents', '/settings/agents', 'Agents'],
  ['runtime', '/settings/devices', 'Computers'],
] as const
export type StudioLink =
  | { kind: 'settings'; viewId: string; mobilePath: string; label: string; field?: string }
  | { kind: 'thread'; runtimeId: string; threadId: string }

function navigationUrl(value: string) {
  const reference = parseStudioReference(value)
  return new URL(
    reference?.kind === 'thread' ? threadReferenceLink(reference.runtimeId, reference.id) : value,
  )
}

export function parseStudioLink(value: string): StudioLink | undefined {
  try {
    let url = navigationUrl(value)
    if (
      url.origin === 'https://dovo-navigation.invalid' &&
      url.pathname === '/' &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      url = navigationUrl(url.searchParams.get('link') ?? '')
    if (url.protocol !== 'dovo:' || url.username || url.password || url.port || url.hash) return
    if (url.hostname === 'settings') {
      const page = settingsLinkPages.find(([id]) => url.pathname === `/${id}`)
      const field = url.searchParams.get('field') || undefined
      if (!page || (field && (field.length > 200 || /[\p{C}]/u.test(field)))) return
      return {
        kind: 'settings',
        viewId: page[0] === 'speech' ? 'conversation-settings' : page[0],
        mobilePath: page[1],
        label: page[2],
        ...(field ? { field } : {}),
      }
    }
    if (url.hostname === 'thread' && (!url.pathname || url.pathname === '/')) {
      const runtimeId = url.searchParams.get('runtimeId')
      const threadId = url.searchParams.get('threadId')
      if (
        runtimeId &&
        /^[A-Za-z0-9._-]{1,200}$/.test(runtimeId) &&
        threadId &&
        threadId.length <= 200 &&
        !/[\p{C}]/u.test(threadId)
      )
        return { kind: 'thread', runtimeId, threadId }
    }
  } catch {
    return
  }
}
export function threadReferenceLink(runtimeId: string, threadId: string) {
  return `dovo://thread?${new URLSearchParams({ runtimeId, threadId })}`
}

/** A safe render URL keeps internal navigation intact through Markdown sanitization. */
export function studioNavigationURL(value: string) {
  return parseStudioLink(value)
    ? `https://dovo-navigation.invalid/?${new URLSearchParams({ link: value })}`
    : undefined
}
