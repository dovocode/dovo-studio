import { X509Certificate } from 'node:crypto'
import type { BrowserCertificateDetails } from '../runtime/previews/previews.js'

/** Chromium returns the server certificate first, followed by any available issuers. */
export function parseBrowserCertificateChain(
  chain: readonly string[],
): BrowserCertificateDetails[] {
  if (!chain.length || chain.length > 32) throw new Error('The certificate chain is unavailable.')
  return chain.map((der) => {
    if (der.length > 256 * 1024) throw new Error('The certificate is too large to display.')
    const cert = new X509Certificate(Buffer.from(der, 'base64'))
    return {
      subject: cert.subject,
      issuer: cert.issuer,
      validFrom: cert.validFromDate.toISOString(),
      validTo: cert.validToDate.toISOString(),
      fingerprint256: cert.fingerprint256,
      serialNumber: cert.serialNumber,
      ...(cert.subjectAltName ? { subjectAltName: cert.subjectAltName } : {}),
    }
  })
}
