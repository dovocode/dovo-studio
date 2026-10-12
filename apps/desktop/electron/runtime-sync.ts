import { ipcMain, type WebContents } from 'electron'
import {
  decode,
  desktopSyncSubscriptionSchema,
  type DesktopSyncEvent,
  type RuntimeConnection,
} from '@dovo/protocol'
import { requireTrustedRenderer } from './renderer-trust.js'
import { RuntimeConnections } from './runtime-connections.js'
export function registerRuntimeSync(
  rendererPath: string,
  recover?: (connection: RuntimeConnection) => Promise<RuntimeConnection | null>,
) {
  const connections = new RuntimeConnections(undefined, undefined, recover)
  const listening = new WeakSet<WebContents>()
  const owners = new Map<WebContents, Set<string>>()
  ipcMain.handle('runtime:sync-watch', (event, value: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    const input = decode(desktopSyncSubscriptionSchema, value)
    const sender = event.sender
    let ids = owners.get(sender)
    if (!ids) {
      ids = new Set()
      owners.set(sender, ids)
      const clear = () => {
        for (const id of owners.get(sender) ?? []) connections.unsubscribe(`${sender.id}:${id}`)
        owners.delete(sender)
      }
      if (!listening.has(sender)) {
        listening.add(sender)
        sender.once('destroyed', clear)
        sender.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
          if (mainFrame) clear()
        })
      }
    }
    connections.subscribe(`${sender.id}:${input.id}`, input, (update: DesktopSyncEvent) => {
      if (!sender.isDestroyed()) sender.send('runtime:sync-event', input.id, update)
    })
    ids.add(input.id)
  })
  ipcMain.handle('runtime:sync-unwatch', (event, id: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    if (typeof id !== 'string') throw new Error('Invalid runtime subscription')
    connections.unsubscribe(`${event.sender.id}:${id}`)
    owners.get(event.sender)?.delete(id)
  })
  ipcMain.handle('runtime:sync-refresh', (event, id: unknown, retry: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    if (typeof id !== 'string' || typeof retry !== 'boolean')
      throw new Error('Invalid runtime refresh')
    connections.refresh(`${event.sender.id}:${id}`, retry)
  })
  return {
    dispose: () => {
      connections.dispose()
      owners.clear()
    },
  }
}
