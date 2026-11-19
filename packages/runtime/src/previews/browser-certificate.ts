import type { Page } from 'playwright'
import { parseBrowserCertificateChain } from '@dovo/protocol/browser-certificate'
import { HttpError } from '../errors.js'

/** Read Chromium's visible page certificate on demand. No connection to the website is needed. */
export async function readBrowserCertificate(page: Page, documentId: string) {
  const cdp = await page.context().newCDPSession(page)
  try {
    let certificate: { certificate: string[]; protocol: string; cipher: string } | undefined
    cdp.on('Security.visibleSecurityStateChanged', ({ visibleSecurityState }) => {
      certificate = visibleSecurityState.certificateSecurityState
    })
    const readFrame = async () => {
      const {
        frameTree: { frame },
      } = await cdp.send('Page.getFrameTree')
      if (frame.loaderId !== documentId)
        throw new HttpError(409, 'The page changed. Open site information again.')
      if (frame.unreachableUrl || !frame.url.startsWith('https://'))
        throw new HttpError(404, 'This page has no website certificate.')
      return frame
    }
    await readFrame()
    // A new Security subscription sends the current state before subsequent page events.
    await cdp.send('Security.enable')
    const frame = await readFrame()
    if (!certificate?.certificate.length)
      throw new HttpError(404, 'Chromium did not provide a certificate for this page.')
    return {
      origin: new URL(frame.url).origin,
      protocol: certificate.protocol,
      cipher: certificate.cipher,
      chain: parseBrowserCertificateChain(certificate.certificate),
    }
  } finally {
    await cdp.detach().catch((error: unknown) => {
      if (!page.isClosed()) throw error
    })
  }
}
