import { pathToFileURL } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'

export function trustedRendererUrl(source: string, rendererPath: string, devUrl?: string) {
  try {
    const url = new URL(source)
    const expected = new URL(devUrl ?? pathToFileURL(rendererPath).href)
    return devUrl
      ? url.origin === expected.origin && ['http:', 'https:'].includes(url.protocol)
      : url.protocol === 'file:' && url.pathname === expected.pathname && !url.search
  } catch {
    return false
  }
}

export function requireTrustedRenderer(event: IpcMainInvokeEvent, rendererPath: string) {
  if (
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !trustedRendererUrl(event.senderFrame.url, rendererPath, process.env.VITE_DEV_SERVER_URL)
  )
    throw new Error('Untrusted desktop request')
}
