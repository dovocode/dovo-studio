import { v4 as uuid } from 'uuid'

import type { RemoteBrowserDownload } from './runtime/previews/remote-browser'

type Download = RemoteBrowserDownload
type Entry = {
  download: Download
  row: HTMLDivElement
  status: HTMLSpanElement
  save: HTMLButtonElement
  cancel: HTMLButtonElement
  request?: string
  timer?: ReturnType<typeof setTimeout>
}

export function createBrowserDownloads(options: {
  send: (message: object) => boolean
  native: () => boolean
  handoff: (message: object) => void
}) {
  const list = document.getElementById('downloads')
  if (!(list instanceof HTMLDivElement)) throw new Error('Browser download list is missing.')
  const entries = new Map<string, Entry>()
  let origin = ''
  const render = () => {
    list.hidden = entries.size === 0
  }
  const reset = (entry: Entry, text: string) => {
    clearTimeout(entry.timer)
    entry.request = undefined
    entry.save.hidden = entry.download.status !== 'ready'
    entry.save.disabled = entry.download.status !== 'ready'
    const action = entry.download.status === 'ready' ? 'Remove' : 'Cancel'
    entry.cancel.textContent = action
    entry.cancel.setAttribute('aria-label', `${action} ${entry.download.name}`)
    entry.status.textContent = text
  }
  return {
    connect(url: string) {
      const target = new URL(url)
      target.protocol = target.protocol === 'wss:' ? 'https:' : 'http:'
      origin = target.origin
    },
    offer(download: Download) {
      const existing = entries.get(download.id)
      if (existing) {
        existing.download = download
        if (!existing.request)
          reset(
            existing,
            download.status === 'ready'
              ? `${download.size.toLocaleString()} bytes`
              : `Downloading · ${download.size.toLocaleString()} bytes`,
          )
        return
      }
      const row = document.createElement('div')
      const label = document.createElement('span')
      label.textContent = download.name
      const status = document.createElement('span')
      status.textContent =
        download.status === 'ready'
          ? `${download.size.toLocaleString()} bytes`
          : `Downloading · ${download.size.toLocaleString()} bytes`
      const save = document.createElement('button')
      save.type = 'button'
      save.hidden = download.status !== 'ready'
      save.disabled = download.status !== 'ready'
      save.textContent = 'Save'
      save.setAttribute('aria-label', `Save ${download.name}`)
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.textContent = download.status === 'ready' ? 'Remove' : 'Cancel'
      cancel.setAttribute('aria-label', `${cancel.textContent} ${download.name}`)
      const entry: Entry = {
        download,
        row,
        status,
        save,
        cancel,
      }
      save.onclick = () => {
        const requestId = uuid()
        entry.request = requestId
        save.disabled = true
        status.textContent = 'Preparing…'
        if (!options.send({ type: 'downloadRequest', id: download.id, requestId })) {
          reset(entry, 'Disconnected. Reconnect to save.')
          return
        }
        entry.timer = setTimeout(() => reset(entry, 'Save timed out. Try again.'), 30_000)
      }
      cancel.onclick = () => {
        if (!options.send({ type: 'downloadCancel', id: download.id }))
          status.textContent = 'Disconnected. Reconnect to try again.'
      }
      row.append(label, status, save, cancel)
      list.append(row)
      entries.set(download.id, entry)
      render()
    },
    ready(message: { id: string; name: string; size: number; requestId: string; url: string }) {
      const entry = entries.get(message.id)
      if (!entry || entry.request !== message.requestId) return
      if (
        message.name !== entry.download.name ||
        message.size !== entry.download.size ||
        !/^\/api\/previews\/browser\/download\/[A-Za-z0-9_-]+$/.test(message.url)
      ) {
        reset(entry, 'Invalid download response.')
        return
      }
      const url = new URL(message.url, origin)
      if (url.origin !== origin) {
        reset(entry, 'Invalid download address.')
        return
      }
      if (options.native()) {
        clearTimeout(entry.timer)
        entry.status.textContent = 'Saving…'
        options.handoff({
          type: 'downloadSave',
          id: message.id,
          requestId: message.requestId,
          url: url.href,
          name: message.name,
          size: message.size,
        })
      } else {
        const link = document.createElement('a')
        link.href = url.href
        link.download = message.name
        link.rel = 'noreferrer'
        document.body.append(link)
        link.click()
        link.remove()
        reset(entry, 'Download started.')
      }
    },
    error(message: { id: string; requestId: string; message: string }) {
      const entry = entries.get(message.id)
      if (entry?.request === message.requestId) reset(entry, message.message)
    },
    result(message: { id: string; requestId: string; message: string }) {
      const entry = entries.get(message.id)
      if (entry?.request === message.requestId) reset(entry, message.message)
    },
    removed(id: string) {
      const entry = entries.get(id)
      if (!entry) return
      clearTimeout(entry.timer)
      entry.row.remove()
      entries.delete(id)
      options.handoff({ type: 'downloadStop', id })
      render()
    },
    disconnect() {
      for (const entry of entries.values()) {
        clearTimeout(entry.timer)
        entry.row.remove()
      }
      entries.clear()
      origin = ''
      options.handoff({ type: 'downloadStop' })
      render()
    },
  }
}
