import { v4 as uuid } from 'uuid'
import {
  BROWSER_UPLOAD_CHUNK_BYTES,
  BROWSER_UPLOAD_MAX_BYTES,
  BROWSER_UPLOAD_MAX_FILES,
  type RemoteBrowserFileChooser,
  type RemoteBrowserUpload,
} from './runtime/previews/remote-browser'

function element<T extends HTMLElement>(id: string, constructor: { new (): T }) {
  const found = document.getElementById(id)
  if (!(found instanceof constructor)) throw new Error(`Missing upload control: ${id}`)
  return found
}
/** A shared HTML picker uses native WebView file selection on phones, without sharing host paths. */
export function createBrowserUploadPicker(options: {
  send: (command: RemoteBrowserUpload) => boolean
  notice: (text: string, error?: boolean) => void
  picking: (active: boolean, id: string) => void
  native: () => boolean
}) {
  const dialog = element('uploadDialog', HTMLDialogElement)
  const input = element('uploadFiles', HTMLInputElement)
  const choose = element('uploadChoose', HTMLButtonElement)
  const cancel = element('uploadCancel', HTMLButtonElement)
  const progress = element('uploadProgress', HTMLParagraphElement)
  let offered: RemoteBrowserFileChooser | undefined
  let version = 0
  let busy = false
  let selecting:
    | {
        id: string
        offer: RemoteBrowserFileChooser
        version: number
        opened: boolean
        timer?: ReturnType<typeof setTimeout>
      }
    | undefined
  const stopPicking = () => {
    if (!selecting) return
    clearTimeout(selecting.timer)
    options.picking(false, selecting.id)
    selecting = undefined
    if (!busy) choose.disabled = false
  }
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  const request = (command: RemoteBrowserUpload) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('File transfer timed out. Open the upload control again.')),
        30_000,
      )
      const finish = (error?: Error) => {
        clearTimeout(timer)
        pending.delete(command.requestId)
        if (error) reject(error)
        else resolve()
      }
      pending.set(command.requestId, { resolve: () => finish(), reject: finish })
      if (!options.send(command))
        finish(new Error('The browser disconnected. Select the files again after reconnecting.'))
    })
  const hide = () => {
    version++
    offered = undefined
    input.value = ''
    if (selecting && !selecting.opened) stopPicking()
    else if (selecting) options.picking(false, selecting.id)
    if (dialog.open) dialog.close()
  }
  const cancelSelection = () => {
    const previous = offered
    hide()
    const cancelledVersion = version
    if (previous)
      void request({ type: 'fileUploadCancel', requestId: uuid(), chooserId: previous.id }).catch(
        (error: unknown) => {
          if (!offered && version === cancelledVersion)
            options.notice(error instanceof Error ? error.message : String(error), true)
        },
      )
  }
  const openPicker = (id: string) => {
    if (!selecting || selecting.id !== id || selecting.opened) return
    if (selecting.offer !== offered || selecting.version !== version) {
      stopPicking()
      return
    }
    clearTimeout(selecting.timer)
    selecting.opened = true
    input.click()
  }
  choose.onclick = () => {
    if (!offered || selecting || busy) return
    selecting = { id: uuid(), offer: offered, version, opened: false }
    choose.disabled = true
    if (options.native()) {
      // The native host commits the keep-alive state before acknowledging this handoff.
      selecting.timer = setTimeout(() => {
        stopPicking()
        progress.textContent = 'Could not open the device file picker. Choose files again.'
      }, 5000)
      options.picking(true, selecting.id)
    } else openPicker(selecting.id)
  }
  input.addEventListener('cancel', stopPicking)
  cancel.onclick = cancelSelection
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    if (!cancel.disabled) cancelSelection()
  })
  input.onchange = () => {
    const selection = selecting
    stopPicking()
    const files = Array.from(input.files ?? [])
    const offer = selection?.offer
    if (!offer || offer !== offered || selection.version !== version || !files.length || busy) {
      input.value = ''
      return
    }
    if (
      files.length > (offer.multiple ? BROWSER_UPLOAD_MAX_FILES : 1) ||
      files.reduce((total, file) => total + file.size, 0) > BROWSER_UPLOAD_MAX_BYTES
    ) {
      progress.textContent = `Select up to ${offer.multiple ? BROWSER_UPLOAD_MAX_FILES : 1} files, totaling at most 50 MB.`
      input.value = ''
      return
    }
    const current = version
    busy = true
    choose.disabled = true
    const check = () => {
      if (offered !== offer || version !== current)
        throw new Error('The file picker expired. Open the website’s upload control again.')
    }
    void (async () => {
      for (const file of files) {
        check()
        const fileId = uuid()
        await request({
          type: 'fileUploadStart',
          requestId: fileId,
          chooserId: offer.id,
          name: file.name,
          size: file.size,
          mimeType: file.type,
        })
        let sent = 0
        while (sent < file.size) {
          check()
          // Four bounded chunks per round trip, rather than one full-file/base64 allocation.
          const batch: { fileId: string; offset: number; data: string }[] = []
          for (let count = 0; count < 4 && sent < file.size; count++) {
            const offset = sent
            const blob = file.slice(sent, sent + BROWSER_UPLOAD_CHUNK_BYTES)
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () =>
                typeof reader.result === 'string'
                  ? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
                  : reject(new Error('Could not read the selected file.'))
              reader.onerror = () => reject(new Error('Could not read the selected file.'))
              reader.onabort = () => reject(new Error('Reading the selected file was cancelled.'))
              reader.readAsDataURL(blob)
            })
            check()
            batch.push({ fileId, offset, data })
            sent += blob.size
          }
          await Promise.all(
            batch.map((chunk) =>
              request({
                type: 'fileUploadChunk',
                requestId: uuid(),
                chooserId: offer.id,
                ...chunk,
              }),
            ),
          )
          if (offered === offer)
            progress.textContent = `${file.name}: ${Math.round((sent / file.size) * 100)}% transferred`
        }
      }
      check()
      progress.textContent = 'Finishing file selection…'
      cancel.disabled = true
      await request({ type: 'fileUploadCommit', requestId: uuid(), chooserId: offer.id })
      if (offered === offer) hide()
      if (!offered && version === current + 1) options.notice('Files selected for this website.')
    })()
      .catch(async (error: unknown) => {
        const failedVersion = version
        if (offered === offer && version === current) {
          hide()
          try {
            await request({ type: 'fileUploadCancel', requestId: uuid(), chooserId: offer.id })
          } catch (cleanupError) {
            if (!offered && version === current + 1)
              options.notice(
                `${error instanceof Error ? error.message : String(error)} Cleanup was not confirmed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
                true,
              )
            return
          }
        }
        if (
          (offered === offer && version === current) ||
          (!offered && failedVersion <= current + 1 && version === current + 1)
        )
          options.notice(error instanceof Error ? error.message : String(error), true)
      })
      .finally(() => {
        if ((offered === offer && version === current) || (!offered && version === current + 1)) {
          busy = false
          choose.disabled = false
          cancel.disabled = false
        }
      })
  }
  return {
    get open() {
      return dialog.open
    },
    offer(message: RemoteBrowserFileChooser) {
      if (offered?.id === message.id) return
      hide()
      offered = message
      busy = false
      choose.disabled = !!selecting
      cancel.disabled = false
      input.multiple = message.multiple
      input.accept = message.accept
      progress.textContent = `Choose up to ${message.multiple ? BROWSER_UPLOAD_MAX_FILES : 1} files from this device. Maximum 50 MB in total.`
      dialog.showModal()
    },
    ready: openPicker,
    closed(id: string) {
      if (offered?.id === id) hide()
    },
    acknowledge(id: string, error?: string) {
      const waiter = pending.get(id)
      if (error) waiter?.reject(new Error(error))
      else waiter?.resolve()
    },
    disconnect() {
      hide()
      stopPicking()
      for (const waiter of pending.values())
        waiter.reject(
          new Error('The browser disconnected. Select the files again after reconnecting.'),
        )
    },
  }
}
