import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, open, rm, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { FileChooser } from 'playwright'
import {
  BROWSER_UPLOAD_CHUNK_BYTES,
  BROWSER_UPLOAD_MAX_BYTES,
  BROWSER_UPLOAD_MAX_FILES,
  type RemoteBrowserFileChooser,
  type RemoteBrowserMessage,
  type RemoteBrowserUpload,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'

type File = { name: string; path: string; size: number; written: number; handle: FileHandle }
type Offered = {
  message: RemoteBrowserFileChooser
  chooser: FileChooser
  owner?: () => void
  directory?: string
  files: Map<string, File>
  retained?: boolean
  timer?: ReturnType<typeof setTimeout>
}
/** Each session owns one chooser. Bytes are bounded and private; no caller supplies host paths. */
export class BrowserUploads {
  private offered?: Offered
  // Chromium reads input files lazily. Keep committed paths until their document is replaced.
  private delivered: Offered[] = []
  private version = 0
  private pending = 0
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private publish: (message: Exclude<RemoteBrowserMessage, { type: 'frame' }>) => void,
    private report: (error: unknown) => void,
    // Runtimes pass BrowserTransferStorage so an abrupt exit is reclaimed by a later run.
    private allocate: () => Promise<string> = () => mkdtemp(join(tmpdir(), 'dovo-browser-upload-')),
  ) {}
  message() {
    return this.offered?.message
  }
  private enqueue<T>(operation: () => Promise<T>) {
    const pending = this.queue.then(operation)
    // Preserve scheduling after a rejected command; the returned promise reports that rejection.
    this.queue = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }
  private async documentCurrent(offer: Offered) {
    try {
      const current = await offer.chooser
        .element()
        .evaluate((element) => element.ownerDocument === document)
      return current
    } catch {
      // A replaced frame destroys the element's execution context.
      return false
    }
  }
  private async current(offer: Offered) {
    return this.offered === offer && (await this.documentCurrent(offer)) && this.offered === offer
  }
  private async prune() {
    for (const offer of [...this.delivered]) {
      if (await this.documentCurrent(offer)) continue
      this.delivered = this.delivered.filter((entry) => entry !== offer)
      offer.retained = false
      await this.cleanup(offer)
    }
  }
  private async cleanup(offer: Offered) {
    if (offer.retained) return
    const closed = await Promise.allSettled(
      [...offer.files.values()].map((file) => file.handle.close()),
    )
    if (offer.directory) await rm(offer.directory, { recursive: true, force: true })
    for (const result of closed) if (result.status === 'rejected') throw result.reason
  }
  close() {
    this.version++
    const offer = this.offered
    this.offered = undefined
    if (!offer) return this.queue.then(() => undefined)
    clearTimeout(offer.timer)
    this.publish({ type: 'fileChooserClosed', id: offer.message.id })
    return this.enqueue(() => this.cleanup(offer))
  }
  async offer(chooser: FileChooser) {
    const closed = this.close()
    const version = this.version
    await closed
    if (version !== this.version) return
    const offer: Offered = {
      chooser,
      files: new Map(),
      message: {
        type: 'fileChooser',
        id: randomUUID(),
        multiple: chooser.isMultiple(),
        accept: '',
      },
    }
    this.offered = offer
    if (!(await this.current(offer))) {
      if (this.offered === offer) await this.close()
      return
    }
    try {
      offer.message.accept = ((await chooser.element().getAttribute('accept')) ?? '').slice(0, 1024)
    } catch (error) {
      if (this.offered === offer) await this.close()
      throw error
    }
    if (this.offered !== offer) return
    offer.timer = setTimeout(() => void this.close().catch(this.report), 10 * 60 * 1000)
    offer.timer.unref()
    this.publish(offer.message)
  }
  async navigation() {
    const offer = this.offered
    if (offer && !(await this.current(offer)) && this.offered === offer) await this.close()
    await this.enqueue(() => this.prune())
  }
  release() {
    const closed = this.close()
    return this.enqueue(async () => {
      await closed
      const delivered = this.delivered.splice(0)
      const results = await Promise.allSettled(
        delivered.map((offer) => {
          offer.retained = false
          return this.cleanup(offer)
        }),
      )
      for (const result of results) if (result.status === 'rejected') throw result.reason
    })
  }
  disconnect(owner: () => void) {
    if (this.offered?.owner === owner) return this.close()
    return Promise.resolve()
  }
  private checkAuthorization(authorize: () => void) {
    try {
      authorize()
    } catch (error) {
      if (this.offered?.owner === authorize) void this.close().catch(this.report)
      throw error
    }
  }
  async execute(command: RemoteBrowserUpload, authorize: () => void) {
    if (command.type === 'fileUploadCancel') {
      this.checkAuthorization(authorize)
      const offer = this.offered
      if (!offer || offer.message.id !== command.chooserId)
        throw new HttpError(409, 'This file picker expired.')
      if (offer.owner && offer.owner !== authorize)
        throw new HttpError(409, 'This file picker is being answered by another viewer.')
      // Cancel admission invalidates queued commits immediately, before waiting for disk IO.
      return this.close()
    }
    if (this.pending >= 8)
      return Promise.reject(new HttpError(429, 'Wait for the current file transfer.'))
    this.pending++
    return this.enqueue(async () => {
      this.checkAuthorization(authorize)
      const offer = this.offered
      if (!offer || offer.message.id !== command.chooserId || !(await this.current(offer)))
        throw new HttpError(
          409,
          'This file picker expired. Open the website’s upload control again.',
        )
      if (offer.owner && offer.owner !== authorize)
        throw new HttpError(409, 'This file picker is being answered by another viewer.')
      this.checkAuthorization(authorize)
      offer.owner = authorize
      try {
        if (command.type === 'fileUploadStart') {
          await this.prune()
          this.checkAuthorization(authorize)
          if (this.offered !== offer) throw new HttpError(409, 'This file picker expired.')
          if (offer.files.has(command.requestId))
            throw new HttpError(409, 'This file is already staged.')
          if (offer.files.size >= (offer.message.multiple ? BROWSER_UPLOAD_MAX_FILES : 1))
            throw new HttpError(400, 'Too many files for this upload control.')
          const retained = this.delivered.flatMap((entry) => [...entry.files.values()])
          if (
            retained.length + offer.files.size >= 50 ||
            [...retained, ...offer.files.values()].reduce(
              (sum, file) => sum + file.size,
              command.size,
            ) > BROWSER_UPLOAD_MAX_BYTES
          )
            throw new HttpError(
              413,
              'Browser files can use up to 50 MB per tab. Reload the page to release previous selections.',
            )
          const name = basename(command.name.replaceAll('\\', '/')).replace(/\p{Cc}/gu, '_')
          if (!name || name === '.' || name === '..')
            throw new HttpError(400, 'Choose a named file.')
          offer.directory ??= await this.allocate()
          const directory = join(offer.directory, command.requestId)
          await mkdir(directory, { mode: 0o700 })
          const path = join(directory, name)
          const handle = await open(path, 'wx', 0o600)
          offer.files.set(command.requestId, { name, path, size: command.size, written: 0, handle })
          this.checkAuthorization(authorize)
          if (this.offered !== offer) throw new HttpError(409, 'This file picker expired.')
        } else if (command.type === 'fileUploadChunk') {
          const file = offer.files.get(command.fileId)
          if (!file) throw new HttpError(409, 'Start the selected file again.')
          const bytes = Buffer.from(command.data, 'base64')
          if (
            !bytes.length ||
            bytes.length > BROWSER_UPLOAD_CHUNK_BYTES ||
            bytes.toString('base64') !== command.data
          )
            throw new HttpError(400, 'Invalid browser upload chunk.')
          if (command.offset !== file.written || file.written + bytes.length > file.size)
            throw new HttpError(409, 'This file changed during upload. Select it again.')
          let written = 0
          while (written < bytes.length) {
            const result = await file.handle.write(bytes, written, bytes.length - written)
            if (!result.bytesWritten) throw new Error('Could not write the selected file.')
            written += result.bytesWritten
          }
          file.written += written
          this.checkAuthorization(authorize)
          if (this.offered !== offer) throw new HttpError(409, 'This file picker expired.')
        } else {
          const files = [...offer.files.values()]
          if (!files.length || files.some((file) => file.written !== file.size))
            throw new HttpError(409, 'Wait for every selected file to finish uploading.')
          this.checkAuthorization(authorize)
          if (!(await this.current(offer))) throw new HttpError(409, 'This file picker expired.')
          this.checkAuthorization(authorize)
          await offer.chooser.setFiles(
            files.map((file) => file.path),
            { timeout: 10_000 },
          )
          // setFiles can trigger navigation or a replacement picker in the website's change handler.
          // Paths must survive a successful selection even if close() was queued meanwhile.
          offer.retained = true
          this.delivered.push(offer)
          await Promise.all(files.map((file) => file.handle.close()))
          clearTimeout(offer.timer)
          if (this.offered === offer) {
            this.offered = undefined
            this.version++
            this.publish({ type: 'fileChooserClosed', id: offer.message.id })
          }
          this.checkAuthorization(authorize)
          await this.prune()
        }
      } catch (error) {
        if (this.offered === offer) void this.close().catch(this.report)
        throw error
      }
    }).finally(() => {
      this.pending--
    })
  }
}
