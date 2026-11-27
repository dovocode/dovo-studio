import {
  createRuntimeClient,
  isBrowserLoopbackAddress,
  mutableStruct,
  remoteBrowserTicketSchema,
  responses,
  type RuntimeProfile,
} from '@dovo/protocol'
import { Schema } from 'effect'
import type { useRuntime } from '../../runtime/connection/provider'

const ticketSchema = mutableStruct({ ticket: Schema.String })

export function threadLocalPreviewOrigin(page: string) {
  if (!isBrowserLoopbackAddress(page)) return undefined
  const url = new URL(page)
  if (url.protocol !== 'http:' || url.username || url.password) return undefined
  return url.origin
}

export async function prepareThreadLocalPreview(
  read: ReturnType<typeof useRuntime>['readRuntime'],
  profile: RuntimeProfile,
  taskId: string,
  tabId: string,
  page: string,
  signal: AbortSignal,
) {
  const origin = threadLocalPreviewOrigin(page)
  if (!origin) throw new Error('Local previews require an HTTP localhost page.')
  signal.throwIfAborted()
  const target = { taskId, tabId }
  const close = () => {
    void read(profile, '/api/previews/browser/close', target, responses.ok).catch(() => {
      // An unreachable computer expires unused browser tabs.
    })
  }
  try {
    const opened = await read(
      profile,
      '/api/previews/browser/open',
      { ...target, url: page },
      remoteBrowserTicketSchema,
    )
    signal.throwIfAborted()
    if (opened.tabId !== tabId) throw new Error('Update this computer to open thread previews.')
  } catch (error) {
    close()
    throw error
  }
  signal.addEventListener('abort', close, { once: true })
  return async () => {
    signal.throwIfAborted()
    const { ticket } = await read(
      profile,
      '/api/previews/browser/local-preview/ticket',
      { ...target, origin },
      ticketSchema,
    )
    signal.throwIfAborted()
    return createRuntimeClient(profile.connection).socketUrl('/ws/local-preview', ticket)
  }
}
