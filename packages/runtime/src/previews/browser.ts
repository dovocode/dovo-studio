import { Schema } from 'effect'
import {
  createBrowserFaviconLoader,
  fetchRemoteFavicon,
  observeBrowserFavicons,
} from './browser-favicon.js'
import {
  selectedBrowserText,
  STUDIO_BROWSER_SCOPE,
  isPrivateBrowserProfile,
  type BrowserProfile,
  browserWebsiteCustomizationScript,
} from '@dovo/protocol'
import { redact } from '../storage/activity.js'
import { browserScript } from './browser-script.js'
import { browserInteraction } from './browser-interaction.js'
import { decode, decodeResult } from '@dovo/protocol'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { AgentBrowserCommand } from './agent-browser.js'
import type { Browser, BrowserContext, Dialog, Page, CDPSession } from 'playwright'
import {
  previewUrl,
  remoteBrowserDialogSchema,
  artifactPreviewHtml,
  artifactPrintDocument,
  artifactPdfDefaults,
  ARTIFACT_PNG_DEFAULT_WIDTH,
  type ArtifactPdfOptions,
  type Artifact,
  remoteBrowserInputSchema,
  remoteBrowserInteractionSchema,
  type RemoteBrowserInput,
  type RemoteBrowserMessage,
} from '@dovo/protocol'
import { ChromiumInstallation } from './chromium-installation.js'
import { HttpError, errorMessage } from '../errors.js'
// Keep Playwright out of the synchronous startup module graph; browser preparation
// and browser requests load it asynchronously.
let chromiumModule: typeof import('playwright').chromium | undefined
async function loadChromium() {
  chromiumModule ??= (await import('playwright')).chromium
  return chromiumModule
}
export type BrowserFrame = {
  type: 'frame'
  data: Uint8Array
  width: number
  height: number
  detail?: boolean
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
const dialogMessage = (dialog: Dialog) =>
  decode(remoteBrowserDialogSchema, {
    type: 'dialog',
    kind: dialog.type(),
    message: dialog.message(),
    defaultValue: dialog.defaultValue(),
  })
const unrestrictedInput = () => {}
type QueuedInput = {
  input: RemoteBrowserInput
  authorize: () => void
  operation?: Promise<void>
}
type Session = {
  logs: { time: string; kind: string; message: string }[]
  release: () => Promise<void>
  page: Page
  closing?: boolean
  cdp: CDPSession
  pendingInput?: QueuedInput
  statePending: boolean
  favicon?: string | null
  state: Extract<
    RemoteBrowserMessage,
    {
      type: 'state'
    }
  >
  touching: boolean
  sharpTimer?: ReturnType<typeof setTimeout>
  sharpVersion: number
  capturingSharpFrame?: boolean
  interaction?: Extract<RemoteBrowserMessage, { type: 'interaction' }>
  interactionTimer?: ReturnType<typeof setTimeout>
  mouseButtons: number
  stateTimer?: ReturnType<typeof setTimeout>
  listeners: Set<Listener>
  visibleListeners: Set<Listener>
  queue: Promise<void>
  queued: number
  loading: boolean
  streaming: boolean
  stream: Promise<void>
  idle?: ReturnType<typeof setTimeout>
  frame?: BrowserFrame
  liveFrame?: Uint8Array
  dialog?: Dialog
  failedNavigation?: string
}
// Dots cannot appear in a legacy profile ID, keeping daily-browsing cookies separate.
const WORKSPACE_PROFILES = 'browser-workspace.profiles'
const idleMs = 5 * 60 * 1000
export class RemoteBrowsers {
  async activeMedia(resourceId: string) {
    const pending = this.sessions.get(resourceId)
    if (!pending) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        pending.then((session) =>
          session.page.evaluate(() =>
            Array.from(document.querySelectorAll('audio,video')).some(
              (element) => element instanceof HTMLMediaElement && !element.paused && !element.ended,
            ),
          ),
        ),
        new Promise<true>((resolve) => {
          timer = setTimeout(() => resolve(true), 2000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  private artifactQueue: Promise<unknown> = Promise.resolve()
  private pendingArtifactRenders = 0
  private browser?: Promise<Browser>
  private sessions = new Map<string, Promise<Session>>()
  private owners = new Map<string, string>()
  private profiles = new Map<string, { context: Promise<BrowserContext>; users: number }>()
  private closingProfiles = new Map<string, Promise<void>>()
  private disposed = false
  private installation = new ChromiumInstallation()
  constructor(
    private profileDirectory?: string,
    private browserProfiles: () => readonly BrowserProfile[] = () => [],
  ) {}
  prepare() {
    void this.installation.ensure().catch((error) => {
      if (!this.disposed) console.error('Could not install Playwright Chromium', error)
    })
  }
  private async executable() {
    const chromium = await loadChromium()
    let executablePath: string
    try {
      executablePath = await this.installation.ensure()
    } catch (error) {
      throw new HttpError(
        503,
        `Chromium installation failed: ${errorMessage(error)}. Check the runtime logs and reconnect to retry.`,
      )
    }
    return { chromium, executablePath }
  }
  private launch(): Promise<Browser> {
    if (this.disposed) return Promise.reject(new HttpError(503, 'Runtime is shutting down'))
    if (!this.browser) {
      const pending = this.executable()
        .then(({ chromium, executablePath }) => {
          if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
          return chromium.launch({
            executablePath,
            headless: true,
            chromiumSandbox: true,
          })
        })
        .then(async (browser) => {
          if (this.disposed) {
            await browser.close()
            throw new HttpError(503, 'Runtime is shutting down')
          }
          browser.once('disconnected', () => {
            if (this.browser === pending) this.browser = undefined
          })
          return browser
        })
        .catch((error) => {
          if (this.browser === pending) this.browser = undefined
          throw error
        })
      this.browser = pending
    }
    return this.browser
  }
  /** Exports and snapshots share a bounded queue and never use a signed-in profile. */
  private async renderArtifact<T>(render: (page: Page) => Promise<T>): Promise<T> {
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    if (this.pendingArtifactRenders >= 32)
      throw new HttpError(503, 'Artifact previews are busy. Try again.')
    this.pendingArtifactRenders++
    const pending = this.artifactQueue.then(async () => {
      if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
      const browser = await this.launch()
      const context = await browser.newContext({
        viewport: { width: 640, height: 360 },
        serviceWorkers: 'block',
      })
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await context.route('**/*', (route) => route.abort())
        const page = await context.newPage()
        page.setDefaultTimeout(10_000)
        return await Promise.race([
          render(page),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(new HttpError(504, 'Artifact rendering timed out. Try a smaller artifact.')),
              30_000,
            )
          }),
        ])
      } finally {
        clearTimeout(timeout)
        await context.close()
      }
    })
    this.artifactQueue = pending.catch(() => {})
    try {
      return await pending
    } finally {
      this.pendingArtifactRenders--
    }
  }
  /** Rasterize in a fresh, networkless guest; never use a signed-in browser profile. */
  artifactSnapshot(content: string) {
    return this.renderArtifact(async (page) => {
      await page.setContent(artifactPreviewHtml(content), { waitUntil: 'load', timeout: 5000 })
      const image = await page.screenshot({
        type: 'jpeg',
        quality: 65,
        timeout: 5000,
        animations: 'disabled',
      })
      return `data:image/jpeg;base64,${image.toString('base64')}`
    })
  }
  /** Standalone exports retain the preview's opaque origin and network restrictions. */
  private async loadArtifact(
    page: Page,
    artifact: Artifact,
    media: 'print' | 'screen',
    width: number,
    height: number,
  ) {
    const { artifactPrintContent } = await import('../artifacts/artifact-print.js')
    const exportDocument = artifactPrintDocument(artifactPrintContent(artifact))
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ media, colorScheme: 'light', reducedMotion: 'reduce' })
    const url = 'http://artifact.dovo.invalid/export'
    await page.route(
      url,
      (route) =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          headers: { 'Content-Security-Policy': exportDocument.policy },
          body: exportDocument.html,
        }),
      { times: 1 },
    )
    await page.goto(url, { waitUntil: 'load', timeout: 10_000 })
    await page.evaluate(async (title) => {
      if (!document.title) document.title = title
      await document.fonts.ready
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    }, artifact.title)
  }
  /** Freeze the rendered initial state so guest scripts cannot interfere with editing. */
  artifactExportPreview(artifact: Artifact) {
    return this.renderArtifact(async (page) => {
      await this.loadArtifact(page, artifact, 'screen', 1280, 800)
      return page.evaluate(() => {
        const clone = document.documentElement.cloneNode(true)
        if (!(clone instanceof HTMLElement)) throw new Error('Export document is unavailable')
        const canvases = document.querySelectorAll('canvas')
        clone.querySelectorAll('canvas').forEach((node, index) => {
          const canvas = canvases[index]
          const image = document.createElement('img')
          for (const attribute of [...node.attributes])
            image.setAttribute(attribute.name, attribute.value)
          image.src = canvas.toDataURL('image/png')
          image.width = canvas.width
          image.height = canvas.height
          image.style.maxWidth = '100%'
          image.style.height = 'auto'
          node.replaceWith(image)
        })
        clone
          .querySelectorAll('script,iframe,object,embed,base,meta[http-equiv="refresh"]')
          .forEach((node) => node.remove())
        for (const node of [clone, ...clone.querySelectorAll('*')]) {
          for (const attribute of [...node.attributes]) {
            if (/^on/i.test(attribute.name) || attribute.name === 'contenteditable')
              node.removeAttribute(attribute.name)
          }
        }
        return '<!doctype html>' + clone.outerHTML
      })
    })
  }
  private async omitNonPrintable(page: Page) {
    await page.evaluate(() =>
      document.querySelectorAll('.no-print,[data-no-print]').forEach((node) => node.remove()),
    )
    // Covers elements that are later recreated by beforeprint handlers or reactive scripts.
    await page.addStyleTag({ content: '.no-print,[data-no-print]{display:none!important}' })
  }
  artifactPdf(artifact: Artifact, options?: ArtifactPdfOptions) {
    const settings = { ...artifactPdfDefaults, ...options }
    return this.renderArtifact(async (page) => {
      const sizes = {
        auto: [794, 1123],
        A4: [794, 1123],
        A3: [1123, 1587],
        Letter: [816, 1056],
        Legal: [816, 1344],
      }
      const [width, height] = sizes[settings.paperSize]
      await this.loadArtifact(
        page,
        artifact,
        'print',
        settings.landscape ? height : width,
        settings.landscape ? width : height,
      )
      await this.omitNonPrintable(page)
      const margin = `${settings.marginMm}mm`
      // User-selected paper and margins must win over authored @page rules.
      if (options?.marginMm !== undefined || settings.paperSize !== 'auto') {
        const size =
          settings.paperSize === 'auto'
            ? ''
            : `size:${settings.paperSize} ${settings.landscape ? 'landscape' : 'portrait'};`
        await page.addStyleTag({
          content: `@page{${size}${options?.marginMm !== undefined ? `margin:${margin};` : ''}}`,
        })
      }
      return page.pdf({
        format: settings.paperSize === 'auto' ? 'A4' : settings.paperSize,
        landscape: settings.landscape,
        scale: settings.scale / 100,
        printBackground: settings.background,
        preferCSSPageSize: settings.paperSize === 'auto',
        margin: { top: margin, right: margin, bottom: margin, left: margin },
        tagged: true,
      })
    })
  }
  /** Export the entire page at exactly the requested viewport width, at one pixel per CSS pixel. */
  artifactPng(artifact: Artifact, width = ARTIFACT_PNG_DEFAULT_WIDTH) {
    return this.renderArtifact(async (page) => {
      await this.loadArtifact(page, artifact, 'screen', width, 800)
      const height = await page.evaluate(() =>
        Math.ceil(
          Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
        ),
      )
      // Bound decoded image memory and Chromium's screenshot dimensions; never silently crop a tall page.
      if (height > 32_768 || width * height > 64_000_000)
        throw new HttpError(
          400,
          'This page is too tall for PNG export. Use a smaller width or export PDF instead.',
        )
      return page.screenshot({
        type: 'png',
        fullPage: true,
        clip: { x: 0, y: 0, width, height },
        animations: 'disabled',
        timeout: 10_000,
      })
    })
  }
  /** MHTML is a rendered offline snapshot. Chromium deliberately removes executable scripts. */
  artifactMhtml(artifact: Artifact) {
    return this.renderArtifact(async (page) => {
      await this.loadArtifact(page, artifact, 'screen', 1280, 800)
      await this.omitNonPrintable(page)
      const cdp = await page.context().newCDPSession(page)
      try {
        const { data } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' })
        return Buffer.from(data, 'utf8')
      } finally {
        await cdp.detach()
      }
    })
  }
  async open(
    taskId: string,
    owner = taskId,
    profileId = 'default',
    initialUrl?: string,
    isolated = false,
  ): Promise<void> {
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    let pending = this.sessions.get(taskId)
    if (!pending) {
      if (this.sessions.size >= 8)
        throw new HttpError(409, 'Close an unused host browser before opening another (maximum 8).')
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(profileId))
        throw new HttpError(400, 'Invalid browser profile')
      const target = initialUrl ? previewUrl(initialUrl) : undefined
      pending = this.create(taskId, profileId, target, isolated, owner === STUDIO_BROWSER_SCOPE)
      this.sessions.set(taskId, pending)
      this.owners.set(taskId, owner)
      void pending.catch(() => {
        if (this.sessions.get(taskId) === pending) {
          this.sessions.delete(taskId)
          this.owners.delete(taskId)
        }
      })
    }
    const session = await pending
    if (!session.listeners.size) this.scheduleClose(taskId, session)
  }
  private async profile(profileId: string, isolated = false, workspace = false) {
    const key = isolated
      ? `isolated:${profileId}`
      : workspace
        ? `workspace:${profileId}`
        : profileId
    await this.closingProfiles.get(key)
    let entry = this.profiles.get(key)
    if (!entry) {
      const create = async () => {
        const options = {
          locale:
            this.browserProfiles().find((profile) => profile.id === profileId)?.language ?? 'en-US',
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 2,
          acceptDownloads: false,
          serviceWorkers: 'block' as const,
          hasTouch: true,
        }
        let context: BrowserContext
        if (this.profileDirectory && !isolated && !isPrivateBrowserProfile(profileId)) {
          const { chromium, executablePath } = await this.executable()
          context = await chromium.launchPersistentContext(
            workspace
              ? join(this.profileDirectory, WORKSPACE_PROFILES, profileId)
              : join(this.profileDirectory, profileId),
            {
              ...options,
              executablePath,
              headless: true,
              chromiumSandbox: true,
            },
          )
        } else context = await (await this.launch()).newContext(options)
        try {
          if (this.profileDirectory && !isolated)
            for (const page of context.pages()) await page.close()
          // No runtime credentials, personal browser profile, file access or native permissions
          // are exposed to the preview. Local HTTP services are intentionally reachable.
          await context.route('**/*', (route) => {
            if (!/^https?:\/\//i.test(route.request().url())) return route.abort('blockedbyclient')
            return route.continue()
          })
          return context
        } catch (error) {
          await context.close()
          throw error
        }
      }
      entry = { context: create(), users: 0 }
      this.profiles.set(key, entry)
    }
    const current = entry
    current.users++
    let released: Promise<void> | undefined
    const release = () =>
      (released ??= (async () => {
        if (--current.users) return
        if (this.profiles.get(key) === current) this.profiles.delete(key)
        const closing = current.context.then((context) => context.close())
        this.closingProfiles.set(key, closing)
        try {
          await closing
        } finally {
          if (this.closingProfiles.get(key) === closing) this.closingProfiles.delete(key)
        }
      })())
    try {
      return { context: await current.context, release }
    } catch (error) {
      if (!--current.users && this.profiles.get(key) === current) this.profiles.delete(key)
      throw error
    }
  }
  private async create(
    taskId: string,
    profileId: string,
    initialUrl?: string,
    isolated = false,
    workspace = false,
    existingPage?: Page,
  ) {
    const { context, release } = await this.profile(profileId, isolated, workspace)
    let createdPage: Page | undefined
    try {
      const page = existingPage ?? (await context.newPage())
      createdPage = page
      page.setDefaultTimeout(10000)
      page.setDefaultNavigationTimeout(20000)
      const session: Session = {
        logs: [],
        release,
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
          primaryModifier: process.platform === 'darwin' ? 'Meta' : 'Control',
        },
        touching: false,
        sharpVersion: 0,
        mouseButtons: 0,
        listeners: new Set(),
        visibleListeners: new Set(),
        queue: Promise.resolve(),
        queued: 0,
        loading: false,
        streaming: false,
        stream: Promise.resolve(),
      }
      const faviconLoader = createBrowserFaviconLoader(
        (url, signal) => fetchRemoteFavicon(session.cdp, url, signal),
        (favicon) => {
          session.favicon = favicon
          this.scheduleState(session)
        },
      )
      let faviconDocument = ''
      await session.cdp.send('Page.enable')
      session.cdp.on('Page.frameNavigated', ({ frame }) => {
        if (frame.parentId) return
        faviconLoader.reset()
        faviconDocument = ''
        session.favicon = undefined
      })
      const faviconUpdateSchema = Schema.Struct({
        documentId: Schema.String.pipe(Schema.check(Schema.isMaxLength(100))),
        url: Schema.String.pipe(Schema.check(Schema.isMaxLength(8192))),
        icons: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMaxLength(1500000)))).pipe(
          Schema.check(Schema.isMaxLength(8)),
        ),
      })
      await page.exposeBinding('__dovoBrowserFavicon', (source, value: unknown) => {
        if (source.frame !== page.mainFrame()) return
        const parsed = decodeResult(faviconUpdateSchema, value)
        if (!parsed.success || parsed.data.url !== page.url()) return
        if (faviconDocument !== parsed.data.documentId) {
          faviconDocument = parsed.data.documentId
          faviconLoader.reset()
          session.favicon = undefined
        }
        void faviconLoader.load(parsed.data.url, parsed.data.icons)
      })
      page.once('close', () => faviconLoader.reset())
      await page.addInitScript(observeBrowserFavicons)
      if (existingPage) await page.evaluate(observeBrowserFavicons)
      await page.exposeBinding('__dovoBrowserInteraction', (_source, value: unknown) => {
        const result = decodeResult(remoteBrowserInteractionSchema, value)
        if (!result.success) return
        if (JSON.stringify(result.data) === JSON.stringify(session.interaction)) return
        session.interaction = result.data
        if (!session.interactionTimer)
          session.interactionTimer = setTimeout(() => {
            session.interactionTimer = undefined
            if (session.interaction) this.emit(session, session.interaction)
          }, 16)
      })
      await page.addInitScript(browserInteraction)
      if (!existingPage) await page.evaluate(browserInteraction)
      let customizationReady = Promise.resolve()
      const applyWebsiteCustomization = async () => {
        if (!/^https?:\/\//i.test(page.url()) || isolated) return
        const origin = new URL(page.url()).origin
        const sites =
          this.browserProfiles()
            .find((profile) => profile.id === profileId)
            ?.websites?.filter((site) => site.origin === origin) ?? []
        if (sites.length) {
          const { frameTree } = await session.cdp.send('Page.getFrameTree')
          const { executionContextId } = await session.cdp.send('Page.createIsolatedWorld', {
            frameId: frameTree.frame.id,
            worldName: 'dovo-website-customization',
          })
          await session.cdp.send('Runtime.evaluate', {
            contextId: executionContextId,
            timeout: 10000,
            expression: browserWebsiteCustomizationScript(sites),
          })
        }
      }
      page.on('domcontentloaded', () => {
        customizationReady = applyWebsiteCustomization().catch((error: unknown) =>
          this.report(session, error),
        )
      })
      if (existingPage) await applyWebsiteCustomization()
      const log = (kind: string, message: string) => {
        session.logs.push({
          time: new Date().toISOString(),
          kind,
          message: String(redact(message)).slice(0, 2000),
        })
        if (session.logs.length > 100) session.logs.shift()
      }
      page.on('console', (message) => log('console:' + message.type(), message.text()))
      page.on('pageerror', (error) => log('pageerror', error.message))
      page.on('requestfailed', (request) =>
        log('network', request.method() + ' ' + request.url() + ' ' + request.failure()?.errorText),
      )
      page.on('response', (response) => {
        const request = response.request()
        if (request.isNavigationRequest() && request.frame() === page.mainFrame())
          session.failedNavigation = undefined
        if (response.status() >= 400) log('http', response.status() + ' ' + response.url())
      })

      page.on('dialog', (dialog) => {
        session.dialog = dialog
        this.emit(session, dialogMessage(dialog))
        if (!session.listeners.size) {
          session.dialog = undefined
          void dialog.dismiss().catch((error) => this.report(session, error))
        }
      })
      const children = new Map<string, Page>()
      page.on('popup', (popup) => {
        if (!workspace) {
          const target = popup.url()
          void popup
            .close()
            .then(async () => {
              if (/^https?:\/\//i.test(target))
                await this.input(taskId, { type: 'navigate', url: target })
              else
                this.emit(session, {
                  type: 'error',
                  message: 'This popup cannot be opened in the preview.',
                })
            })
            .catch((error) => this.report(session, error))
          return
        }
        if (this.sessions.size >= 8) {
          void popup.close().catch((error) => this.report(session, error))
          this.emit(session, {
            type: 'error',
            message: 'Close an unused browser tab before opening another window.',
          })
          return
        }
        const id = randomUUID()
        const resource = JSON.stringify(
          profileId === 'default'
            ? [STUDIO_BROWSER_SCOPE, id]
            : [STUDIO_BROWSER_SCOPE, id, profileId],
        )
        const pending = this.create(resource, profileId, undefined, isolated, workspace, popup)
        this.sessions.set(resource, pending)
        this.owners.set(resource, STUDIO_BROWSER_SCOPE)
        children.set(id, popup)
        const publish = () => {
          session.state.createdTabs = [...children].map(([id, child]) => ({
            id,
            url: /^https?:\/\//i.test(child.url()) ? child.url() : '',
          }))
          this.scheduleState(session)
        }
        popup.once('close', () => {
          children.delete(id)
          publish()
        })
        void pending.then(publish).catch((error) => {
          this.sessions.delete(resource)
          this.owners.delete(resource)
          children.delete(id)
          this.report(session, error)
        })
      })
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) this.scheduleState(session)
      })
      page.on('domcontentloaded', () => {
        this.scheduleSharpFrame(session)
        session.loading = false
        this.scheduleState(session)
      })
      page.on('load', () => {
        this.scheduleSharpFrame(session)
        this.scheduleState(session)
      })
      page.on('crash', () => {
        this.emit(session, {
          type: 'error',
          message: 'The host browser crashed. Reconnect to start again.',
        })
        void this.close(taskId).catch((error) => this.report(session, error))
      })
      page.once('close', () => {
        void release().catch((error) => this.report(session, error))
        clearTimeout(session.sharpTimer)
        clearTimeout(session.idle)
        clearTimeout(session.stateTimer)
        clearTimeout(session.interactionTimer)
        this.sessions.delete(taskId)
        this.owners.delete(taskId)
        this.emit(session, {
          type: 'closed',
          byPage: !session.closing,
          message: 'Host browser session closed. Reconnect to start again.',
        })
        session.listeners.clear()
      })
      if (initialUrl) {
        session.state.url = initialUrl
        try {
          await page.goto(initialUrl, { waitUntil: 'domcontentloaded' })
          await customizationReady
        } catch (error) {
          if (page.isClosed()) throw error
          session.loading = false
          session.failedNavigation = initialUrl
          log('navigation:error', errorMessage(error))
        }
      }
      this.scheduleClose(taskId, session)
      return session
    } catch (error) {
      try {
        await createdPage?.close()
      } finally {
        await release()
      }
      throw error
    }
  }
  private emit(session: Session, message: BrowserOutput) {
    for (const listener of session.listeners) {
      if (message.type === 'frame' && !session.visibleListeners.has(listener)) continue
      try {
        listener(message)
      } catch (error) {
        // One disconnected controller must not stop capture or the other controllers.
        console.error('Browser client failed', error)
      }
    }
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
    if (session.dialog) {
      this.emit(session, session.state)
      return
    }
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
          (document.activeElement instanceof HTMLInputElement &&
            !document.activeElement.disabled &&
            !document.activeElement.readOnly &&
            ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].includes(
              document.activeElement.type,
            )) ||
          (document.activeElement instanceof HTMLTextAreaElement &&
            !document.activeElement.disabled &&
            !document.activeElement.readOnly) ||
          (document.activeElement instanceof HTMLElement &&
            document.activeElement.isContentEditable),
      }))
      session.state = {
        type: 'state',
        createdTabs: session.state.createdTabs,
        url:
          session.failedNavigation ??
          (session.page.url().startsWith('chrome-error:') ? session.state.url : session.page.url()),
        title: info.title,
        favicon: session.favicon,
        editable: info.editable,
        back: history.currentIndex > 0,
        forward: history.currentIndex < history.entries.length - 1,
        loading: session.loading,
        touch: true,
        primaryModifier: process.platform === 'darwin' ? 'Meta' : 'Control',
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
  private async sharpFrame(session: Session) {
    // Capture the current surface without Playwright's screenshot emulation /
    // viewport restoration, so live frames continue throughout detail capture.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        (async () => {
          const { cssVisualViewport } = await session.cdp.send('Page.getLayoutMetrics')
          return session.cdp.send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: 90,
            fromSurface: true,
            captureBeyondViewport: false,
            clip: {
              x: cssVisualViewport.pageX,
              y: cssVisualViewport.pageY,
              width: cssVisualViewport.clientWidth,
              height: cssVisualViewport.clientHeight,
              scale: 2,
            },
          })
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Browser detail capture timed out')), 3000)
        }),
      ])
      return Buffer.from(result.data, 'base64')
    } finally {
      clearTimeout(timer)
    }
  }
  private scheduleSharpFrame(session: Session, delay = 150) {
    clearTimeout(session.sharpTimer)
    const version = ++session.sharpVersion
    if (!session.visibleListeners.size || session.page.isClosed()) return
    session.sharpTimer = setTimeout(() => {
      session.sharpTimer = undefined
      const size = session.page.viewportSize()
      if (!size || session.queued || !session.visibleListeners.size || session.capturingSharpFrame)
        return
      session.capturingSharpFrame = true
      void this.sharpFrame(session)
        .then((data) => {
          const current = session.page.viewportSize()
          if (
            version !== session.sharpVersion ||
            !session.visibleListeners.size ||
            current?.width !== size.width ||
            current.height !== size.height
          )
            return
          session.frame = { type: 'frame', data, ...size, detail: true }
          this.emit(session, session.frame)
        })
        .catch((error) => {
          // The live stream remains usable if an optional detail capture times out.
          session.logs.push({
            time: new Date().toISOString(),
            kind: 'capture:warning',
            message: String(redact(errorMessage(error))).slice(0, 2000),
          })
          if (session.logs.length > 100) session.logs.shift()
        })
        .finally(() => {
          session.capturingSharpFrame = false
          if (version !== session.sharpVersion) this.scheduleSharpFrame(session)
        })
    }, delay)
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
    session.visibleListeners.add(listener)
    if (session.frame) listener(session.frame)
    if (session.interaction) listener(session.interaction)
    try {
      // Activate the host tab when a human viewer opens it, including retained
      // Chromium pages whose compositor was inactive after switching away.
      if (session.dialog) {
        listener(session.state)
        listener(dialogMessage(session.dialog))
      } else {
        await session.page.bringToFront()
        await this.syncStream(session)
        this.scheduleSharpFrame(session)
        await this.state(session)
      }
    } catch (error) {
      session.listeners.delete(listener)
      session.visibleListeners.delete(listener)
      if (!session.listeners.size) this.scheduleClose(taskId, session)
      throw error
    }
    return () => {
      session.listeners.delete(listener)
      session.visibleListeners.delete(listener)
      void this.syncStream(session).catch((error) => this.report(session, error))
      if (!session.listeners.size) {
        // Keep the page and its login state briefly for reconnects, but stop streaming.
        session.queue = session.queue
          .then(async () => {
            if (session.mouseButtons && !session.page.isClosed()) {
              session.mouseButtons = 0
              for (const button of ['left', 'middle', 'right'] as const)
                await session.cdp.send('Input.dispatchMouseEvent', {
                  type: 'mouseReleased',
                  x: 0,
                  y: 0,
                  button,
                  buttons: 0,
                })
            }
            if (!session.touching || session.page.isClosed()) return
            session.touching = false
            await session.cdp.send('Input.dispatchTouchEvent', {
              type: 'touchCancel',
              touchPoints: [],
            })
          })
          .catch((error) => this.report(session, error))
        const dialog = session.dialog
        session.dialog = undefined
        if (dialog) void dialog.dismiss().catch((error) => this.report(session, error))
        this.scheduleClose(taskId, session)
      }
    }
  }
  async visibility(taskId: string, listener: Listener, visible: boolean) {
    const session = await this.sessions.get(taskId)
    if (!session || !session.listeners.has(listener)) return
    if (visible) {
      session.visibleListeners.add(listener)
      await session.page.bringToFront()
    } else session.visibleListeners.delete(listener)
    await this.syncStream(session)
    this.scheduleSharpFrame(session)
    if (visible && session.frame) listener(session.frame)
  }
  private syncStream(session: Session, restart = false) {
    const operation = session.stream.then(async () => {
      if (session.page.isClosed()) return
      if (session.streaming && (restart || !session.visibleListeners.size)) {
        await session.page.screencast.stop()
        session.streaming = false
        session.liveFrame = undefined
      }
      if (session.visibleListeners.size && !session.streaming) {
        await session.page.screencast.start({
          // Use lighter frames during motion, then restore device-resolution
          // detail with a quality-90 still when input settles.
          quality: 70,
          fps: 60,
          size: {
            width: 1920,
            height: 1920,
          },
          onFrame: (frame) => {
            const viewport = session.page.viewportSize()
            if (
              !viewport ||
              frame.viewportWidth !== viewport.width ||
              frame.viewportHeight !== viewport.height
            )
              return
            const previous = session.liveFrame
            if (
              previous &&
              Buffer.from(previous.buffer, previous.byteOffset, previous.byteLength).equals(
                Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength),
              )
            )
              return
            session.liveFrame = frame.data
            session.frame = {
              type: 'frame',
              data: frame.data,
              width: viewport.width,
              height: viewport.height,
            }
            this.emit(session, session.frame)
            if (!session.capturingSharpFrame) this.scheduleSharpFrame(session)
          },
        })
        session.streaming = true
      }
    })
    session.stream = operation.catch((error) => this.report(session, error))
    return operation
  }
  async selection(resourceId: string) {
    const session = await this.sessions.get(resourceId)
    if (!session || session.page.isClosed()) throw new HttpError(404, 'Browser tab is unavailable.')
    // Page scripts can stall evaluations or forge their return values. Bound the whole read,
    // including the title, and keep literal selection data separate from executable code.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const read = async () => {
        const frames = session.page.frames()
        const focused: typeof frames = []
        for (const frame of frames)
          if (await frame.evaluate(() => document.hasFocus()).catch(() => false))
            focused.push(frame)
        let text = ''
        for (const frame of focused.length ? focused : [session.page.mainFrame()]) {
          const value: unknown = await frame.evaluate(selectedBrowserText).catch((error) => {
            // Navigating child frames can detach between the focus probe and the read.
            if (frame.isDetached()) return ''
            throw error
          })
          text = typeof value === 'string' ? value.slice(0, 32000) : ''
          if (text) break
        }
        const title: unknown = await session.page.title()
        return {
          text,
          url: session.page.url(),
          title: typeof title === 'string' ? title.slice(0, 2000) : '',
        }
      }
      return await Promise.race([
        read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new HttpError(504, 'Reading the page selection timed out.')),
            3000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
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
      await this.syncStream(session)
      this.scheduleState(session)
      this.scheduleSharpFrame(session)
      return
    }
    clearTimeout(session.sharpTimer)
    session.sharpVersion++
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
              waitUntil: 'commit',
            })
          if (input.type === 'back')
            await page.goBack({
              waitUntil: 'commit',
            })
          if (input.type === 'forward')
            await page.goForward({
              waitUntil: 'commit',
            })
          if (input.type === 'reload')
            if (session.failedNavigation || page.url().startsWith('chrome-error:'))
              await page.goto(session.failedNavigation ?? session.state.url, {
                waitUntil: 'commit',
              })
            else await page.reload({ waitUntil: 'commit' })
          session.failedNavigation = undefined
        } catch (error) {
          session.loading = false
          session.failedNavigation = url ?? session.state.url
          throw error
        } finally {
          this.scheduleState(session)
        }
      } else if (input.type === 'resize') {
        const size = page.viewportSize()
        if (size?.width === input.width && size.height === input.height) return
        await page.setViewportSize({
          width: input.width,
          height: input.height,
        })
        // Chromium can stop delivering screencast frames after changing device
        // metrics. Re-arm capture for the new surface rather than leaving the
        // viewer dependent on still screenshots after each input.
        await this.syncStream(session, true)
        // The optional detail capture must not block clicks/typing behind resize.
        // A zero-delay sharp frame also covers identical screencast pixels, which
        // Chromium may suppress after resizing a blank or scrolled page.
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
        const bit = input.button === 'left' ? 1 : input.button === 'right' ? 2 : 4
        if (input.phase === 'down') session.mouseButtons |= bit
        if (input.phase === 'up') session.mouseButtons &= ~bit
        await session.cdp.send('Input.dispatchMouseEvent', {
          type:
            input.phase === 'move'
              ? 'mouseMoved'
              : input.phase === 'down'
                ? 'mousePressed'
                : 'mouseReleased',
          x: input.x,
          y: input.y,
          button: input.phase === 'move' ? 'none' : input.button,
          buttons: session.mouseButtons,
          clickCount: input.phase === 'move' ? 0 : (input.clickCount ?? 1),
          modifiers: (input.modifiers ?? []).reduce(
            (mask, modifier) => mask | { Alt: 1, Control: 2, Meta: 4, Shift: 8 }[modifier],
            0,
          ),
        })
      } else if (input.type === 'scroll') {
        await session.cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: input.x,
          y: input.y,
          deltaX: input.deltaX,
          deltaY: input.deltaY,
        })
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
        this.scheduleSharpFrame(session, command.input.type === 'resize' ? 0 : 150)
      })
    await operation
  }
  /** Default task sessions are isolated. Studio Tools may explicitly attach to an existing tab. */
  async agentCommand(
    taskId: string,
    command: AgentBrowserCommand,
    authorize: () => void,
    resourceId?: string,
  ) {
    authorize()
    const resource = resourceId ?? `agent-browser:${taskId}`
    if (this.owners.get(resource) === STUDIO_BROWSER_SCOPE)
      throw new HttpError(403, 'Shared Browser tabs are not available to agents.')
    if (resourceId && !this.sessions.has(resourceId))
      throw new HttpError(404, 'Browser session not found')
    if (command.action === 'close') {
      await this.close(resource)
      return { ok: true as const }
    }
    const profile = `agent-${createHash('sha256').update(taskId).digest('hex')}`
    if (!resourceId) await this.open(resource, taskId, profile, undefined, true)
    const session = await this.sessions.get(resource)
    if (!session) throw new HttpError(404, 'Agent browser session expired. Retry the command.')
    if (session.queued >= 100)
      throw new HttpError(429, 'Agent browser is busy. Wait for the page to respond.')
    session.queued++
    const operation = session.queue.then(async () => {
      authorize()
      const page = session.page
      let scriptResult: unknown
      switch (command.action) {
        case 'evaluate':
          scriptResult = await browserScript(session.cdp, command.script)
          break
        case 'navigate': {
          const url = previewUrl(command.url)
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded' })
            session.failedNavigation = undefined
          } catch (error) {
            session.failedNavigation = url
            throw error
          }
          break
        }
        case 'back':
          await page.goBack({ waitUntil: 'domcontentloaded' })
          break
        case 'forward':
          await page.goForward({ waitUntil: 'domcontentloaded' })
          break
        case 'reload':
          if (session.failedNavigation || page.url().startsWith('chrome-error:'))
            await page.goto(session.failedNavigation ?? session.state.url, {
              waitUntil: 'domcontentloaded',
            })
          else await page.reload({ waitUntil: 'domcontentloaded' })
          session.failedNavigation = undefined
          break
        case 'click':
          await page.locator(command.selector).click()
          break
        case 'fill':
          await page.locator(command.selector).fill(command.text)
          break
        case 'key':
          decode(remoteBrowserInputSchema, { type: 'key', key: command.key })
          await page.keyboard.press(command.key)
          break
        case 'scroll':
          await page.mouse.wheel(0, command.deltaY)
          break
        case 'snapshot':
          break
      }
      if (!session.listeners.size) this.scheduleClose(resource, session)
      return {
        ok: true as const,
        ...(command.action === 'evaluate' ? { result: scriptResult } : {}),
        url: page.url(),
        title: await page.title(),
        snapshot: (await page.locator('body').ariaSnapshot()).slice(0, 32000),
        image: (await page.screenshot({ type: 'png', timeout: 10000 })).toString('base64'),
      }
    })
    session.queue = operation
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        session.queued--
        this.scheduleSharpFrame(session)
      })
    return operation
  }
  async studioList() {
    return Promise.all(
      [...this.sessions]
        .filter(([id]) => this.owners.get(id) !== STUDIO_BROWSER_SCOPE)
        .map(async ([id, pending]) => {
          const session = await pending
          return {
            id,
            taskId: this.owners.get(id),
            url: session.page.url(),
            title: await session.page.title(),
          }
        }),
    )
  }
  async studioLogs(id: string) {
    if (this.owners.get(id) === STUDIO_BROWSER_SCOPE)
      throw new HttpError(403, 'Shared Browser tabs are not available to agents.')
    const pending = this.sessions.get(id)
    if (!pending) throw new HttpError(404, 'Browser session not found')
    return { entries: [...(await pending).logs] }
  }
  async closeTask(taskId: string) {
    await Promise.all(
      [...this.owners].filter(([, owner]) => owner === taskId).map(([id]) => this.close(id)),
    )
  }
  async close(taskId: string) {
    const pending = this.sessions.get(taskId)
    if (!pending) return
    const session = await pending
    clearTimeout(session.idle)
    session.closing = true
    try {
      await session.page.close()
    } finally {
      await session.release()
    }
  }
  async dispose() {
    this.disposed = true
    await this.installation.dispose()
    const results = await Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)))
    for (const result of results)
      if (result.status === 'rejected')
        console.error('Could not close browser context', result.reason)
    await Promise.allSettled([...this.closingProfiles.values()])
    // A startup failure is already reported to its caller and must not fail shutdown.
    const browser = await this.browser?.catch(() => undefined)
    if (browser) await browser.close()
    this.sessions.clear()
    this.owners.clear()
  }
}
