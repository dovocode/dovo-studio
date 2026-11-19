import { X509Certificate } from 'node:crypto'
import { isIP } from 'node:net'
import type { WebContents } from 'electron'
import { Schema } from 'effect'
import { parseBrowserCertificateChain } from '@dovo/protocol/browser-certificate'
import type { BrowserPageCertificate } from '@dovo/protocol'
import { retainBrowserDebugger } from './browser-cdp.js'

const securitySchema = Schema.Struct({
  protocol: Schema.String,
  cipher: Schema.String,
  subjectName: Schema.String,
  issuer: Schema.String,
  validFrom: Schema.Number,
  validTo: Schema.Number,
  sanList: Schema.Array(Schema.String),
})
const responseSchema = Schema.Struct({
  type: Schema.String,
  frameId: Schema.optional(Schema.String),
  loaderId: Schema.String,
  response: Schema.Struct({
    url: Schema.String,
    connectionId: Schema.Number,
    securityDetails: Schema.optional(securitySchema),
  }),
})
const treeSchema = Schema.Struct({
  frameTree: Schema.Struct({
    frame: Schema.Struct({
      id: Schema.String,
      loaderId: Schema.String,
      url: Schema.String,
      unreachableUrl: Schema.optional(Schema.String),
    }),
  }),
})
const chainSchema = Schema.Struct({ tableNames: Schema.Array(Schema.String) })
const targetSchema = Schema.Struct({ targetInfo: Schema.Struct({ targetId: Schema.String }) })
const sessionSchema = Schema.Struct({ sessionId: Schema.String })

/** Capture only during navigation. Electron has no API to request the page's chain after the fact. */
export function observeBrowserCertificate(contents: WebContents) {
  const api = contents.debugger
  let certificate: BrowserPageCertificate | undefined
  let unavailable = 'Chromium has no certificate details for this page.'
  let revision = 0
  let capture: { read(): Promise<void>; stop(): void } | undefined

  const reset = () => {
    revision++
    capture?.stop()
    certificate = undefined
    unavailable = 'Chromium has no certificate details for this page.'
  }
  const start = () => {
    const document = revision
    let release: () => void
    let shared: boolean
    try {
      shared = api.isAttached()
      release = retainBrowserDebugger(api)
    } catch {
      unavailable = 'Chromium could not inspect this connection while loading the page.'
      return
    }
    const documents = new Map<
      string,
      { frame: string; origin: string; connection: number; tls: typeof securitySchema.Type }
    >()
    let ownSession: string | undefined
    const detach = async (sessionId: string) => {
      await api.sendCommand('Target.detachFromTarget', { sessionId }).catch(() => {
        // Closing the tab or the debugger also releases its child sessions.
      })
    }
    // getCertificate searches resources by origin. A second TLS connection can have a different leaf.
    const connections = new Map<string, number | null>()
    const observe = (
      _event: Electron.Event,
      method: string,
      params: unknown,
      sessionId?: string,
    ) => {
      if (
        (shared && !ownSession) ||
        (sessionId || undefined) !== ownSession ||
        method !== 'Network.responseReceived' ||
        !Schema.is(responseSchema)(params)
      )
        return
      const { response } = params
      if (!response.url.startsWith('https://')) return
      const origin = new URL(response.url).origin
      const previous = connections.get(origin)
      connections.set(
        origin,
        previous === undefined || previous === response.connectionId ? response.connectionId : null,
      )
      if (params.type === 'Document' && params.frameId && response.securityDetails)
        documents.set(params.loaderId, {
          frame: params.frameId,
          origin,
          connection: response.connectionId,
          tls: response.securityDetails,
        })
    }
    const stop = () => {
      if (capture !== current) return
      api.removeListener('message', observe)
      api.removeListener('detach', stop)
      capture = undefined
      if (ownSession) void detach(ownSession).finally(release)
      else release()
    }
    const read = async () => {
      if (shared && !ownSession) return
      const tree: unknown = await api.sendCommand('Page.getFrameTree', {}, ownSession)
      if (!Schema.is(treeSchema)(tree) || capture !== current || document !== revision) return
      const root = tree.frameTree.frame
      if (root.unreachableUrl || !root.url.startsWith('https://')) return
      const event = documents.get(root.loaderId)
      const origin = new URL(root.url).origin
      if (!event || event.frame !== root.id || event.origin !== origin) return
      const { tls } = event
      const connection = { origin, protocol: tls.protocol, cipher: tls.cipher }
      const validFrom = new Date(tls.validFrom * 1000).toISOString()
      const validTo = new Date(tls.validTo * 1000).toISOString()
      certificate = {
        ...connection,
        chain: [],
        leaf: {
          subject: tls.subjectName,
          issuer: tls.issuer,
          validFrom,
          validTo,
          subjectAltName: tls.sanList.join(', '),
        },
      }
      const exactConnection = () =>
        event.connection > 0 && connections.get(origin) === event.connection
      if (!exactConnection()) return
      const chain: unknown = await api.sendCommand('Network.getCertificate', { origin }, ownSession)
      if (
        capture !== current ||
        document !== revision ||
        !exactConnection() ||
        !Schema.is(chainSchema)(chain) ||
        !chain.tableNames.length
      )
        return
      const parsed = parseBrowserCertificateChain(chain.tableNames)
      const der = new X509Certificate(Buffer.from(chain.tableNames[0], 'base64'))
      const leaf = der.toLegacyObject()
      if (
        (leaf.subject.CN ?? '') === tls.subjectName &&
        (leaf.issuer.CN ?? '') === tls.issuer &&
        parsed[0].validFrom === validFrom &&
        parsed[0].validTo === validTo &&
        tls.sanList.every((name) =>
          isIP(name)
            ? !!der.checkIP(name)
            : !!der.checkHost(name, { subject: 'never', wildcards: false }),
        )
      )
        certificate = { ...connection, chain: parsed }
    }
    let reading: Promise<void> | undefined
    const current = {
      read: () =>
        (reading ??= read()
          .catch(() => {
            if (capture === current)
              unavailable = 'Chromium could not read the certificate for this document.'
          })
          .finally(() => {
            reading = undefined
          })),
      stop,
    }
    capture = current
    api.on('message', observe)
    api.once('detach', stop)
    const enable = async () => {
      // Preserve any current agent's Network domain and response-body buffer limits.
      if (shared) {
        const target: unknown = await api.sendCommand('Target.getTargetInfo')
        if (capture !== current || !Schema.is(targetSchema)(target)) return
        const session: unknown = await api.sendCommand('Target.attachToTarget', {
          targetId: target.targetInfo.targetId,
          flatten: true,
        })
        if (!Schema.is(sessionSchema)(session)) return
        if (capture !== current) {
          await detach(session.sessionId)
          return
        }
        ownSession = session.sessionId
      }
      await api.sendCommand('Network.enable', {}, ownSession)
    }
    void enable().catch(() => {
      if (capture === current) {
        unavailable = 'Chromium could not inspect this connection while loading the page.'
        stop()
      }
    })
  }
  contents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    reset()
    if (/^https?:\/\//i.test(details.url)) start()
  })
  const finish = (loadingEnded: boolean) => {
    const current = capture
    if (!current) return
    void current.read().then(() => {
      if (capture === current && (loadingEnded || certificate?.chain.length)) current.stop()
    })
  }
  contents.on('dom-ready', () => finish(false))
  contents.on('did-stop-loading', () => finish(true))
  contents.on('render-process-gone', reset)
  contents.once('destroyed', reset)
  return async (origin: string) => {
    const document = revision
    if (!certificate?.chain.length) await capture?.read()
    if (
      document !== revision ||
      contents.isDestroyed() ||
      new URL(contents.getURL()).origin !== origin
    )
      throw new Error('The page changed. Open its certificate again.')
    if (!certificate || certificate.origin !== origin) throw new Error(unavailable)
    return certificate
  }
}
