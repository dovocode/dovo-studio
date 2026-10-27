import type { CDPSession } from 'playwright'

const maxBytes = 1024 * 1024
export type FaviconFetch = (url: string, signal: AbortSignal) => Promise<Response>

/** Decode on the owner, including ICO/SVG, so viewers receive only small inert PNGs. */
async function thumbnail(bytes: Uint8Array) {
  let source = Buffer.from(bytes)
  if (source[0] === 0 && source[1] === 0 && source[2] === 1 && source[3] === 0) {
    const { decodeIco } = await import('icojs')
    const images = await decodeIco(source, 'image/png')
    const image = images.sort((a, b) => Math.abs(a.width - 32) - Math.abs(b.width - 32))[0]
    if (!image) throw new Error('Empty icon')
    source = Buffer.from(image.buffer)
  }
  const { default: sharp } = await import('sharp')
  const png = await sharp(source, { limitInputPixels: 4 * 1024 * 1024 })
    .resize(32, 32, { fit: 'contain', background: '#00000000' })
    .png()
    .toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

/** A document owns its requests; newer icon events and navigation cancel older results. */
export function createBrowserFaviconLoader(
  fetchIcon: FaviconFetch,
  publish: (icon: string | null) => void,
) {
  let current: AbortController | undefined
  let signature = ''
  return {
    reset() {
      current?.abort()
      current = undefined
      signature = ''
    },
    async load(page: string, icons: readonly string[]) {
      let origin: URL
      try {
        origin = new URL(page)
        if (!/^https?:$/.test(origin.protocol)) return
      } catch {
        return
      }
      const candidates = [
        ...new Set([...icons.slice(0, 8), new URL('/favicon.ico', origin).href]),
      ].flatMap((input) => {
        try {
          const url = new URL(input, page)
          return !url.username &&
            !url.password &&
            ((/^https?:$/.test(url.protocol) && url.href.length <= 8192) ||
              (url.protocol === 'data:' &&
                /^data:image\//i.test(input) &&
                input.length <= maxBytes * 1.4) ||
              (url.protocol === 'blob:' && url.origin === origin.origin))
            ? [url.href]
            : []
        } catch {
          return []
        }
      })
      const nextSignature = JSON.stringify([page, candidates])
      if (signature === nextSignature) return
      signature = nextSignature
      current?.abort()
      const controller = new AbortController()
      current = controller
      for (const url of candidates) {
        if (controller.signal.aborted) return
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])
        try {
          const response = await (url.startsWith('data:')
            ? fetch(url, { signal })
            : fetchIcon(url, signal))
          if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) {
            await response.body?.cancel()
            continue
          }
          const reader = response.body?.getReader()
          if (!reader) continue
          const chunks: Uint8Array[] = []
          let size = 0
          try {
            while (true) {
              signal.throwIfAborted()
              const { done, value } = await reader.read()
              if (done) break
              size += value.length
              if (size > maxBytes) throw new Error('Icon is too large')
              chunks.push(value)
            }
          } finally {
            await reader.cancel()
            reader.releaseLock()
          }
          const icon = await thumbnail(Buffer.concat(chunks))
          if (!controller.signal.aborted) publish(icon)
          return
        } catch {
          // A broken, unsupported or oversized declared icon must not hide another valid one.
        }
      }
      if (!controller.signal.aborted) publish(null)
    },
  }
}

/** Chromium fetches with the remote profile's cookies, cache and network access. */
export async function fetchRemoteFavicon(
  cdp: CDPSession,
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  if (url.startsWith('blob:')) {
    const { frameTree } = await cdp.send('Page.getFrameTree')
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: 'dovo-favicon',
    })
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      contextId: executionContextId,
      awaitPromise: true,
      returnByValue: true,
      timeout: 5000,
      expression: `(async () => {
        const response = await fetch(${JSON.stringify(url)}, {signal:AbortSignal.timeout(5000)});
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        try { while(true) {
          const {done,value}=await reader.read(); if(done)break;
          size += value.length; if(size > ${maxBytes})throw new Error('Icon is too large');
          chunks.push(value);
        }} finally {await reader.cancel()}
        return new Promise((resolve,reject)=>{
          const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject;
          reader.readAsDataURL(new Blob(chunks));
        });
      })()`,
    })
    signal.throwIfAborted()
    const value: unknown = result.value
    if (exceptionDetails || typeof value !== 'string' || value.length > maxBytes * 1.4)
      throw new Error('The blob icon could not be read')
    return fetch(value, { signal })
  }
  const { frameTree } = await cdp.send('Page.getFrameTree')
  signal.throwIfAborted()
  const loading = cdp
    .send('Network.loadNetworkResource', {
      frameId: frameTree.frame.id,
      url,
      options: { disableCache: false, includeCredentials: true },
    })
    .then(async (result) => {
      if (signal.aborted && result.resource.stream)
        await cdp.send('IO.close', { handle: result.resource.stream }).catch(() => {
          /* A late result can belong to an already closed document. */
        })
      signal.throwIfAborted()
      return result
    })
  let abortLoad: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abortLoad = () => reject(signal.reason)
    signal.addEventListener('abort', abortLoad, { once: true })
    if (signal.aborted) abortLoad()
  })
  const { resource } = await Promise.race([loading, cancelled]).finally(() => {
    if (abortLoad) signal.removeEventListener('abort', abortLoad)
  })
  const handle = resource.stream
  if (!handle) throw new Error('Icon could not be loaded')
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', abort)
    await cdp.send('IO.close', { handle }).catch(() => {
      /* Navigation may already have closed it. */
    })
  }
  const abort = () => {
    void close()
  }
  if (signal.aborted) {
    await close()
    signal.throwIfAborted()
  }
  signal.addEventListener('abort', abort, { once: true })
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal.throwIfAborted()
        const part = await cdp.send('IO.read', { handle, size: 65536 })
        signal.throwIfAborted()
        controller.enqueue(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'))
        if (part.eof) {
          await close()
          controller.close()
        }
      } catch (error) {
        await close()
        controller.error(error)
      }
    },
    cancel: close,
  })
  return new Response(body, {
    status:
      resource.success &&
      (!resource.httpStatusCode ||
        (resource.httpStatusCode >= 200 && resource.httpStatusCode < 300))
        ? 200
        : 404,
  })
}

/** Runs in each remote main document; observes SPA badge icons, base URLs and theme changes. */
export function observeBrowserFavicons() {
  const documentId = `${Date.now()}:${Math.random()}`
  let previous = ''
  let pending = false
  const publish = () => {
    pending = false
    const icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel]'))
      .filter(
        (link) =>
          /^(?:icon|shortcut icon|apple-touch-icon)$/i.test(link.rel.trim()) &&
          (!link.media || matchMedia(link.media).matches),
      )
      .sort((a, b) => Number(a.rel.startsWith('apple')) - Number(b.rel.startsWith('apple')))
      .map((link) => link.href)
      .filter(Boolean)
      .slice(0, 8)
    const value = JSON.stringify([location.href, icons])
    if (value === previous) return
    previous = value
    const binding: unknown = Reflect.get(window, '__dovoBrowserFavicon')
    if (typeof binding === 'function') void binding({ documentId, url: location.href, icons })
  }
  new MutationObserver(() => {
    if (!pending) {
      pending = true
      queueMicrotask(publish)
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['href', 'rel', 'sizes', 'type', 'media'],
  })
  addEventListener('DOMContentLoaded', publish)
  addEventListener('pageshow', publish)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', publish)
  publish()
}
