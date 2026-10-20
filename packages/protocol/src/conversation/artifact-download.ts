import { Schema } from 'effect'
import { maxValue, mutableStruct, refine } from '../shared/schema.js'

export const ARTIFACT_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024
const maxEncoded = Math.ceil(ARTIFACT_DOWNLOAD_MAX_BYTES / 3) * 4
export const artifactDownloadMessageSchema = mutableStruct({
  type: Schema.Literal('artifact-download'),
  nonce: maxValue(Schema.String, 200),
  name: Schema.optional(maxValue(Schema.String, 200)),
  mime: Schema.optional(maxValue(Schema.String, 200)),
  data: Schema.optional(
    refine(
      maxValue(Schema.String, maxEncoded),
      (value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    ),
  ),
  error: Schema.optional(maxValue(Schema.String, 1000)),
})

export function artifactDownloadName(name: string) {
  const leaf = name.split(/[/\\]/).at(-1) ?? ''
  return (
    Array.from(leaf, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '_' : char))
      .join('')
      .replace(/[<>:"|?*]/g, '_')
      .replace(/^\.+|[. ]+$/g, '')
      .slice(0, 160) || 'download'
  )
}

// Serialized into the opaque guest. It can only read locally generated blob/data URLs.
function captureDownloads(nonce: string, limit: number) {
  let busy = false
  const send = (data: object) =>
    parent.postMessage({ type: 'artifact-download', nonce, ...data }, '*')
  const start = (anchor: HTMLAnchorElement) => {
    if (!anchor.hasAttribute('download')) return false
    const url = anchor.href
    if (!/^(blob:|data:)/i.test(url)) return false
    if (busy) return true
    busy = true
    // Start fetching synchronously: callers commonly revoke the blob immediately after click().
    void fetch(url)
      .then(async (response) => {
        const blob = await response.blob()
        if (blob.size > limit) throw new Error('Download exceeds the 20 MB mobile limit.')
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result.split(',')[1] ?? '')
            else reject(new Error('Could not read the generated file.'))
          }
          reader.onerror = () => reject(new Error('Could not read the generated file.'))
          reader.readAsDataURL(blob)
        })
        send({
          name: (anchor.download || 'download').slice(0, 200),
          mime: blob.type.slice(0, 200) || 'application/octet-stream',
          data,
        })
      })
      .catch((cause: unknown) =>
        send({
          error: cause instanceof Error ? cause.message : 'Could not download the generated file.',
        }),
      )
      .finally(() => {
        busy = false
      })
    return true
  }
  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[download]') : null
    if (!event.defaultPrevented && anchor instanceof HTMLAnchorElement && start(anchor))
      event.preventDefault()
  })
  // Detached anchors do not bubble to document, but are common in generated-file buttons.
  const click: unknown = Reflect.get(HTMLAnchorElement.prototype, 'click')
  if (typeof click !== 'function') return
  HTMLAnchorElement.prototype.click = function () {
    const intercept = (event: MouseEvent) => {
      if (!event.defaultPrevented && start(this)) event.preventDefault()
    }
    this.addEventListener('click', intercept, { once: true })
    try {
      Reflect.apply(click, this, [])
    } finally {
      this.removeEventListener('click', intercept)
    }
  }
}

// The native channel belongs to the trusted wrapper; guest messages only describe files.
function relayDownloads(nonce: string, limit: number) {
  window.addEventListener('message', (event) => {
    const frame = document.querySelector<HTMLIFrameElement>('#artifact-preview')
    if (event.source !== frame?.contentWindow) return
    const value: unknown = event.data
    if (
      !value ||
      typeof value !== 'object' ||
      !('type' in value) ||
      value.type !== 'artifact-download' ||
      !('nonce' in value) ||
      value.nonce !== nonce
    )
      return
    const payload =
      'error' in value && typeof value.error === 'string' && value.error.length <= 1000
        ? { error: value.error }
        : 'data' in value &&
            typeof value.data === 'string' &&
            value.data.length <= limit &&
            'name' in value &&
            typeof value.name === 'string' &&
            value.name.length <= 200 &&
            'mime' in value &&
            typeof value.mime === 'string' &&
            value.mime.length <= 200
          ? { data: value.data, name: value.name, mime: value.mime }
          : undefined
    if (!payload) return
    const bridge = (
      window as Window & { ReactNativeWebView?: { postMessage: (data: string) => void } }
    ).ReactNativeWebView
    bridge?.postMessage(JSON.stringify({ type: 'artifact-download', nonce, ...payload }))
  })
}

export function artifactDownloadScripts(nonce: string) {
  const key = JSON.stringify(nonce).replace(/</g, '\\u003c')
  return {
    guest: `<script>(${captureDownloads.toString()})(${key},${ARTIFACT_DOWNLOAD_MAX_BYTES})</script>`,
    wrapper: `<script>(${relayDownloads.toString()})(${key},${maxEncoded})</script>`,
  }
}
