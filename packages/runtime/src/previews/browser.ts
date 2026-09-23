import { decode } from '@dovo/protocol'
import { existsSync } from 'node:fs'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Dialog,
  type Page,
  type CDPSession,
} from 'playwright'
import {
  previewUrl,
  remoteBrowserDialogSchema,
  type RemoteBrowserInput,
  type RemoteBrowserMessage,
} from '@dovo/protocol'
import { HttpError, errorMessage } from '../errors.js'
export type BrowserFrame = {
  type: 'frame'
  data: Uint8Array
  width: number
  height: number
}
export type BrowserOutput =
  | Exclude<
      RemoteBrowserMessage,
      {
        type: 'frame'
      }
    >
  | BrowserFrame
type Listener = (message: BrowserOutput) => void
const unrestrictedInput = () => {}
type QueuedInput = {
  input: RemoteBrowserInput
  authorize: () => void
  operation?: Promise<void>
}
type Session = {
  context: BrowserContext
  page: Page
  cdp: CDPSession
  pendingInput?: QueuedInput
  statePending: boolean
  state: Extract<
    RemoteBrowserMessage,
    {
      type: 'state'
    }
  >
  touching: boolean
  stateTimer?: ReturnType<typeof setTimeout>
  listeners: Set<Listener>
  queue: Promise<void>
  queued: number
  loading: boolean
  streaming: boolean
  stream: Promise<void>
  idle?: ReturnType<typeof setTimeout>
  frame?: BrowserFrame
  dialog?: Dialog
}
const idleMs = 5 * 60 * 1000
export class RemoteBrowsers {
  private browser?: Promise<Browser>
  private sessions = new Map<string, Promise<Session>>()
  private disposed = false
  private launch() {
    if (!this.browser) {
      const bundled = chromium.executablePath()
      const installed =
        process.platform === 'darwin'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : process.platform === 'win32'
            ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`
            : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(
                existsSync,
              )
      const executablePath =
        process.env.DOVO_BROWSER_EXECUTABLE ||
        (existsSync(bundled) ? bundled : installed && existsSync(installed) ? installed : undefined)
      if (!executablePath)
        throw new HttpError(
          503,
          'Install Chrome on the host, or run pnpm --filter @dovo/runtime exec playwright install chromium. Then reconnect the browser.',
        )
      this.browser = chromium
        .launch({
          executablePath,
          headless: true,
          chromiumSandbox: true,
        })
        .then((browser) => {
          browser.once('disconnected', () => {
            this.browser = undefined
          })
          return browser
        })
        .catch((error) => {
          this.browser = undefined
          throw error
        })
    }
    return this.browser
  }
  async open(taskId: string): Promise<void> {
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    let pending = this.sessions.get(taskId)
    if (!pending) {
      if (this.sessions.size >= 8)
        throw new HttpError(409, 'Close an unused host browser before opening another (maximum 8).')
      pending = this.create(taskId)
      this.sessions.set(taskId, pending)
      void pending.catch(() => {
        if (this.sessions.get(taskId) === pending) this.sessions.delete(taskId)
      })
    }
    const session = await pending
    if (!session.listeners.size) this.scheduleClose(taskId, session)
  }
  private async create(taskId: string) {
    const browser = await this.launch()
    const context = await browser.newContext({
      viewport: {
        width: 1280,
        height: 800,
      },
      deviceScaleFactor: 2,
      acceptDownloads: false,
      serviceWorkers: 'block',
      hasTouch: true,
    })
    try {
      // No runtime credentials, personal browser profile, file access or native permissions
      // are exposed to the preview. Local HTTP services are intentionally reachable.
      await context.route('**/*', (route) => {
        if (!/^https?:\/\//i.test(route.request().url())) return route.abort('blockedbyclient')
        return route.continue()
      })
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      page.setDefaultNavigationTimeout(20000)
      const session: Session = {
        context,
        page,
        cdp: await context.newCDPSession(page),
        statePending: false,
        state: {
          type: 'state',
          url: 'about:blank',
          title: '',
          editable: false,
          back: false,
          forward: false,
          loading: false,
          touch: true,
        },
        touching: false,
        listeners: new Set(),
        queue: Promise.resolve(),
        queued: 0,
        loading: false,
        streaming: false,
        stream: Promise.resolve(),
      }
      page.on('dialog', (dialog) => {
        session.dialog = dialog
        this.emit(
          session,
          decode(remoteBrowserDialogSchema, {
            type: 'dialog',
            kind: dialog.type(),
            message: dialog.message(),
            defaultValue: dialog.defaultValue(),
          }),
        )
        if (!session.listeners.size)
          void dialog.dismiss().catch((error) => this.report(session, error))
      })
      page.on('popup', (popup) => {
        const target = popup.url()
        void popup
          .close()
          .then(async () => {
            if (/^https?:\/\//i.test(target))
              await this.input(taskId, {
                type: 'navigate',
                url: target,
              })
            else
              this.emit(session, {
                type: 'error',
                message: 'This popup cannot be opened in the preview.',
              })
          })
          .catch((error) => this.report(session, error))
      })
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) this.scheduleState(session)
      })
      page.on('domcontentloaded', () => this.scheduleState(session))
      page.on('load', () => this.scheduleState(session))
      page.on('crash', () => {
        this.emit(session, {
          type: 'error',
          message: 'The host browser crashed. Close the session and reconnect.',
        })
      })
      context.once('close', () => {
        clearTimeout(session.idle)
        clearTimeout(session.stateTimer)
        this.sessions.delete(taskId)
        this.emit(session, {
          type: 'closed',
          message: 'Host browser session closed. Reconnect to start again.',
        })
        session.listeners.clear()
      })
      this.scheduleClose(taskId, session)
      return session
    } catch (error) {
      await context.close()
      throw error
    }
  }
  private emit(session: Session, message: BrowserOutput) {
    for (const listener of session.listeners) listener(message)
  }
  private report(session: Session, error: unknown) {
    if (!session.page.isClosed())
      this.emit(session, {
        type: 'error',
        message: errorMessage(error),
      })
  }
  private scheduleClose(taskId: string, session: Session) {
    clearTimeout(session.idle)
    session.idle = setTimeout(() => {
      void this.close(taskId).catch((error) => console.error('Could not close idle browser', error))
    }, idleMs)
    session.idle.unref()
  }
  private async state(session: Session) {
    if (session.page.isClosed()) return
    if (session.statePending) {
      this.scheduleState(session)
      return
    }
    session.statePending = true
    try {
      const history: {
        currentIndex: number
        entries: unknown[]
      } = await session.cdp.send('Page.getNavigationHistory')
      const info = await session.page.evaluate(() => ({
        title: document.title,
        editable:
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement ||
          (document.activeElement instanceof HTMLElement &&
            document.activeElement.isContentEditable),
      }))
      session.state = {
        type: 'state',
        url: session.page.url().startsWith('chrome-error:')
          ? session.state.url
          : session.page.url(),
        title: info.title,
        editable: info.editable,
        back: history.currentIndex > 0,
        forward: history.currentIndex < history.entries.length - 1,
        loading: session.loading,
        touch: true,
      }
      this.emit(session, session.state)
    } catch (error) {
      // Chromium temporarily has no active page while committing/replacing a document.
      // Keep the stream and its last known controls alive; DOMContentLoaded/load will
      // publish the new history. This is not a broken socket or a failed user command.
      const message = errorMessage(error)
      if (
        !message.includes('Not attached to an active page') &&
        !message.includes('Execution context was destroyed')
      )
        throw error
      this.emit(session, {
        ...session.state,
        loading: session.loading,
      })
    } finally {
      session.statePending = false
    }
  }
  private scheduleState(session: Session) {
    if (session.stateTimer) return
    session.stateTimer = setTimeout(() => {
      session.stateTimer = undefined
      void this.state(session).catch((error) => this.report(session, error))
    }, 50)
  }
  async attach(taskId: string, listener: Listener) {
    const pending = this.sessions.get(taskId)
    if (!pending)
      throw new HttpError(404, 'Host browser session expired. Reconnect to start again.')
    const session = await pending
    clearTimeout(session.idle)
    session.listeners.add(listener)
    if (session.frame) listener(session.frame)
    try {
      await this.syncStream(session)
      await this.state(session)
    } catch (error) {
      session.listeners.delete(listener)
      if (!session.listeners.size) this.scheduleClose(taskId, session)
      throw error
    }
    return () => {
      session.listeners.delete(listener)
      if (!session.listeners.size) {
        // Keep the page and its login state briefly for reconnects, but stop streaming.
        void this.syncStream(session).catch((error) => this.report(session, error))
        session.queue = session.queue
          .then(async () => {
            if (!session.touching || session.page.isClosed()) return
            session.touching = false
            await session.cdp.send('Input.dispatchTouchEvent', {
              type: 'touchCancel',
              touchPoints: [],
            })
          })
          .catch((error) => this.report(session, error))
        if (session.dialog)
          void session.dialog.dismiss().catch((error) => this.report(session, error))
        this.scheduleClose(taskId, session)
      }
    }
  }
  private syncStream(session: Session) {
    const operation = session.stream.then(async () => {
      if (session.page.isClosed()) return
      if (session.listeners.size && !session.streaming) {
        await session.page.screencast.start({
          quality: 85,
          size: {
            width: 1920,
            height: 1920,
          },
          onFrame: (frame) => {
            session.frame = {
              type: 'frame',
              data: frame.data,
              width: frame.viewportWidth,
              height: frame.viewportHeight,
            }
            this.emit(session, session.frame)
          },
        })
        session.streaming = true
      } else if (!session.listeners.size && session.streaming) {
        await session.page.screencast.stop()
        session.streaming = false
      }
    })
    session.stream = operation.catch((error) => this.report(session, error))
    return operation
  }
  async input(
    taskId: string,
    input: RemoteBrowserInput,
    authorize: () => void = unrestrictedInput,
  ) {
    const pending = this.sessions.get(taskId)
    if (!pending)
      throw new HttpError(404, 'Host browser session expired. Reconnect to start again.')
    const session = await pending
    // Dialog responses must bypass the navigation queue: navigation may be waiting on them.
    if (input.type === 'dialog') {
      authorize()
      const dialog = session.dialog
      session.dialog = undefined
      if (dialog) await (input.accept ? dialog.accept(input.text) : dialog.dismiss())
      return
    }
    const previous = session.pendingInput
    if (previous && previous.authorize === authorize) {
      if (input.type === 'scroll' && previous.input.type === 'scroll') {
        previous.input = {
          ...input,
          deltaX: Math.max(-4000, Math.min(4000, previous.input.deltaX + input.deltaX)),
          deltaY: Math.max(-4000, Math.min(4000, previous.input.deltaY + input.deltaY)),
        }
        return previous.operation
      }
      if (
        (input.type === 'resize' && previous.input.type === 'resize') ||
        (input.type === 'pointer' &&
          input.phase === 'move' &&
          previous.input.type === 'pointer' &&
          previous.input.phase === 'move')
      ) {
        previous.input = input
        return previous.operation
      }
    }
    const command: QueuedInput = {
      input,
      authorize,
    }
    if (session.queued >= 100)
      throw new HttpError(
        429,
        'Browser input is arriving too quickly. Wait for the page to respond.',
      )
    session.pendingInput = command
    session.queued++
    const operation = session.queue.then(async () => {
      if (session.pendingInput === command) session.pendingInput = undefined
      const input = command.input
      authorize()
      const page = session.page
      if (
        input.type === 'navigate' ||
        input.type === 'back' ||
        input.type === 'forward' ||
        input.type === 'reload'
      ) {
        const url = input.type === 'navigate' ? previewUrl(input.url) : undefined
        session.loading = true
        session.state = {
          ...session.state,
          url: url ?? session.state.url,
          loading: true,
        }
        this.emit(session, session.state)
        try {
          if (url)
            await page.goto(url, {
              waitUntil: 'domcontentloaded',
            })
          if (input.type === 'back')
            await page.goBack({
              waitUntil: 'domcontentloaded',
            })
          if (input.type === 'forward')
            await page.goForward({
              waitUntil: 'domcontentloaded',
            })
          if (input.type === 'reload')
            await page.reload({
              waitUntil: 'domcontentloaded',
            })
        } finally {
          session.loading = false
          this.scheduleState(session)
        }
      } else if (input.type === 'resize') {
        const size = page.viewportSize()
        if (size?.width === input.width && size.height === input.height) return
        await page.setViewportSize({
          width: input.width,
          height: input.height,
        })
        // Chromium may suppress identical screencast pixels (for example a scrolled
        // blank area). A resize must still publish its new geometry immediately.
        const data = await page.screenshot({
          type: 'jpeg',
          quality: 85,
          scale: Math.max(input.width, input.height) > 960 ? 'css' : 'device',
        })
        session.frame = {
          type: 'frame',
          data: data,
          width: input.width,
          height: input.height,
        }
        this.emit(session, session.frame)
      } else if (input.type === 'pointer' && input.pointerType === 'touch') {
        if (input.phase !== 'down' && !session.touching) return
        await session.cdp.send('Input.dispatchTouchEvent', {
          type:
            input.phase === 'down' ? 'touchStart' : input.phase === 'up' ? 'touchEnd' : 'touchMove',
          touchPoints:
            input.phase === 'up'
              ? []
              : [
                  {
                    x: input.x,
                    y: input.y,
                    id: 0,
                  },
                ],
        })
        session.touching = input.phase !== 'up'
      } else if (input.type === 'pointer') {
        await page.mouse.move(input.x, input.y)
        if (input.phase === 'down')
          await page.mouse.down({
            button: input.button,
          })
        if (input.phase === 'up')
          await page.mouse.up({
            button: input.button,
          })
      } else if (input.type === 'scroll') {
        await page.mouse.move(input.x, input.y)
        await page.mouse.wheel(input.deltaX, input.deltaY)
      } else if (input.type === 'text') await page.keyboard.insertText(input.text)
      else if (input.type === 'key') await page.keyboard.press(input.key)
      if (input.type !== 'scroll' && !(input.type === 'pointer' && input.phase !== 'up'))
        this.scheduleState(session)
    })
    command.operation = operation
    session.queue = operation
      .catch((error) => this.report(session, error))
      .finally(() => {
        session.queued--
      })
    await operation
  }
  async close(taskId: string) {
    const pending = this.sessions.get(taskId)
    if (!pending) return
    const session = await pending
    clearTimeout(session.idle)
    await session.context.close()
  }
  async dispose() {
    this.disposed = true
    const results = await Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)))
    for (const result of results)
      if (result.status === 'rejected')
        console.error('Could not close browser context', result.reason)
    if (this.browser) await (await this.browser).close()
    this.sessions.clear()
  }
}
