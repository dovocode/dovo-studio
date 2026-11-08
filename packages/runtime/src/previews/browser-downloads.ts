import { constants } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type { CDPSession } from 'playwright'
import { BROWSER_DOWNLOAD_MAX_BYTES, type RemoteBrowserDownload } from '@dovo/protocol'
import { HttpError } from '../errors.js'

const maxFiles = 10
const maxRetainedBytes = 100 * 1024 * 1024
const transferTimeout = 10 * 60_000
const retention = 15 * 60_000
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Download = {
  message: RemoteBrowserDownload
  timer: ReturnType<typeof setTimeout>
  removed?: boolean
  published: number
}
/** Chromium writes opaque GUID files; only this page's download events grant access to them. */
export class BrowserDownloads {
  private entries = new Map<string, Download>()
  private closed = false
  private contextId?: string
  private lastNavigation?: { url: string; at: number }
  private work = new Set<Promise<unknown>>()
  private releasing?: Promise<void>
  constructor(
    private cdp: CDPSession,
    private directory: string,
    private publish: (
      message: RemoteBrowserDownload | { type: 'downloadRemoved'; id: string },
    ) => void,
    private failure: (message: string) => void,
    private report: (error: unknown) => void,
  ) {}
  async start() {
    const { targetInfo } = await this.cdp.send('Target.getTargetInfo')
    this.contextId = targetInfo.browserContextId
    this.cdp.on('Browser.downloadWillBegin', this.begin)
    this.cdp.on('Browser.downloadProgress', this.progress)
    await this.cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: this.directory,
      eventsEnabled: true,
      ...(this.contextId ? { browserContextId: this.contextId } : {}),
    })
  }
  private track(operation: Promise<unknown>) {
    this.work.add(operation)
    void operation.catch(this.report).finally(() => this.work.delete(operation))
  }
  private path(id: string) {
    return join(this.directory, id)
  }
  private async erase(id: string) {
    await Promise.all([
      rm(this.path(id), { force: true }),
      rm(`${this.path(id)}.crdownload`, { force: true }),
    ])
  }
  private cancel(id: string) {
    return this.cdp.send('Browser.cancelDownload', {
      guid: id,
      ...(this.contextId ? { browserContextId: this.contextId } : {}),
    })
  }
  private async cancelAndErase(id: string) {
    try {
      await this.cancel(id)
    } finally {
      await this.erase(id)
    }
  }
  private begin = (event: { guid: string; url: string; suggestedFilename: string }) => {
    if (!guidPattern.test(event.guid)) return
    this.lastNavigation = { url: event.url, at: Date.now() }
    if (
      this.closed ||
      [...this.entries.values()].filter((entry) => entry.message.status === 'downloading').length >=
        2
    ) {
      this.track(this.cancelAndErase(event.guid))
      if (!this.closed)
        this.failure('Wait for the current browser downloads to finish (maximum 2).')
      return
    }
    if (this.entries.size >= maxFiles) {
      const oldest = [...this.entries].find(([, entry]) => entry.message.status === 'ready')
      if (oldest) this.track(this.remove(oldest[0]))
      else {
        this.track(this.cancelAndErase(event.guid))
        return
      }
    }
    const name = Buffer.from(
      basename(event.suggestedFilename.replaceAll('\\', '/'))
        .replace(/[\p{Cc}\p{Cf}]/gu, '_')
        .slice(0, 255),
      'utf8',
    ).toString('utf8')
    const entry: Download = {
      message: {
        type: 'download',
        id: event.guid,
        name: !name || name === '.' || name === '..' ? 'download' : name,
        size: 0,
        status: 'downloading',
      },
      published: Date.now(),
      timer: setTimeout(() => {
        this.failure('Browser download timed out. Try the website’s download again.')
        this.track(this.remove(event.guid))
      }, transferTimeout),
    }
    entry.timer.unref()
    this.entries.set(event.guid, entry)
    this.publish(entry.message)
  }
  private progress = (event: {
    guid: string
    state: string
    receivedBytes: number
    totalBytes: number
  }) => {
    const entry = this.entries.get(event.guid)
    if (!entry) {
      // Cancellation can settle before Chromium's terminal event and file rename.
      if (
        guidPattern.test(event.guid) &&
        (event.state === 'completed' || event.state === 'canceled')
      )
        this.track(this.erase(event.guid))
      return
    }
    if (event.state === 'canceled') {
      if (!entry.removed && !this.closed)
        this.failure(`Could not download ${entry.message.name}. Try the website’s download again.`)
      this.drop(event.guid, entry)
      this.track(this.erase(event.guid))
      return
    }
    if (entry.removed || this.closed) {
      if (event.state === 'completed') this.track(this.erase(event.guid))
      return
    }
    const otherBytes = [...this.entries.values()].reduce(
      (sum, other) => sum + (other === entry ? 0 : other.message.size),
      0,
    )
    if (
      !Number.isSafeInteger(event.receivedBytes) ||
      event.receivedBytes < 0 ||
      Math.max(event.totalBytes, event.receivedBytes) > BROWSER_DOWNLOAD_MAX_BYTES ||
      otherBytes + event.receivedBytes > maxRetainedBytes
    ) {
      this.failure(
        'Browser downloads support files up to 50 MB and 100 MB per tab. Remove an earlier download and try again.',
      )
      this.track(this.remove(event.guid))
      return
    }
    entry.message = { ...entry.message, size: event.receivedBytes }
    if (event.state === 'completed') {
      this.track(
        this.complete(event.guid, entry).catch(async (error: unknown) => {
          this.drop(event.guid, entry)
          await this.erase(event.guid)
          if (!this.closed && !entry.removed) {
            this.failure(`Could not save ${entry.message.name}. Try the website’s download again.`)
            this.report(error)
          }
        }),
      )
    } else if (Date.now() - entry.published >= 250) {
      entry.published = Date.now()
      this.publish(entry.message)
    }
  }
  private async complete(id: string, entry: Download) {
    const handle = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      if (
        !info.isFile() ||
        info.size !== entry.message.size ||
        info.size > BROWSER_DOWNLOAD_MAX_BYTES
      )
        throw new Error('Browser download size changed.')
      await handle.chmod(0o600)
    } finally {
      await handle.close()
    }
    if (this.closed || entry.removed || this.entries.get(id) !== entry) {
      await this.erase(id)
      return
    }
    clearTimeout(entry.timer)
    entry.message = { ...entry.message, status: 'ready' }
    entry.timer = setTimeout(() => this.track(this.remove(id)), retention)
    entry.timer.unref()
    this.publish(entry.message)
  }
  private drop(id: string, entry: Download) {
    clearTimeout(entry.timer)
    if (this.entries.get(id) === entry) {
      this.entries.delete(id)
      if (!this.closed) this.publish({ type: 'downloadRemoved', id })
    }
  }
  messages() {
    return [...this.entries.values()]
      .filter((entry) => !entry.removed)
      .map((entry) => entry.message)
  }
  isNavigationDownload(error: unknown, since: number) {
    if (!(error instanceof Error)) return false
    // Playwright rejects navigation before CDP necessarily delivers downloadWillBegin.
    if (
      /^page\.(?:goto|goBack|goForward|reload): Download is starting$/.test(
        error.message.split('\n')[0],
      )
    )
      return true
    return (
      /^page\.(?:goto|goBack|goForward|reload): net::ERR_ABORTED(?: at |$)/.test(
        error.message.split('\n')[0],
      ) &&
      !!this.lastNavigation &&
      this.lastNavigation.at >= since
    )
  }
  async read(id: string) {
    const entry = this.entries.get(id)
    if (this.closed || !entry || entry.removed)
      throw new HttpError(404, 'This browser download expired. Download it from the website again.')
    if (entry.message.status !== 'ready')
      throw new HttpError(409, 'Wait for this browser download to finish.')
    const handle = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      if (this.closed || this.entries.get(id) !== entry || entry.removed)
        throw new HttpError(410, 'This browser download expired.')
      if (!info.isFile() || info.size !== entry.message.size)
        throw new HttpError(409, 'This browser download changed.')
      return {
        handle,
        name: entry.message.name,
        size: info.size,
        current: () => !this.closed && !entry.removed && this.entries.get(id) === entry,
      }
    } catch (error) {
      await handle.close()
      throw error
    }
  }
  async remove(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.removed = true
    this.drop(id, entry)
    if (entry.message.status === 'downloading') await this.cancelAndErase(id)
    else await this.erase(id)
  }
  release() {
    return (this.releasing ??= this.finishRelease())
  }
  private async finishRelease() {
    this.closed = true
    const results = await Promise.allSettled([...this.entries.keys()].map((id) => this.remove(id)))
    this.cdp.off('Browser.downloadWillBegin', this.begin)
    this.cdp.off('Browser.downloadProgress', this.progress)
    await Promise.allSettled([...this.work])
    for (const result of results) if (result.status === 'rejected') this.report(result.reason)
  }
}
