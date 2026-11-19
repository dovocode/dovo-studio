import { v4 as uuid } from 'uuid'
import {
  browserCertificateEntries,
  type BrowserPageCertificate,
} from './runtime/previews/previews.js'
import type { RemoteBrowserMessage } from './runtime/previews/remote-browser.js'

export function createBrowserCertificateViewer(
  button: HTMLButtonElement,
  dialog: HTMLDialogElement,
  body: HTMLElement,
  request: (id: string, documentId: string) => void,
) {
  let state: Extract<RemoteBrowserMessage, { type: 'state' }> | undefined
  let pending: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const reset = () => {
    clearTimeout(timer)
    pending = undefined
    if (dialog.open) dialog.close()
  }
  function open() {
    if (!state || !/^https?:\/\//i.test(state.url)) return
    const url = new URL(state.url)
    reset()
    body.textContent = url.origin
    const status = document.createElement('p')
    body.append(status)
    dialog.showModal()
    if (url.protocol === 'http:') status.textContent = 'This HTTP page has no website certificate.'
    else if (state.loading) status.textContent = 'Wait for the page to finish loading.'
    else if (!state.certificateDocumentId)
      status.textContent = 'Update the paired computer to inspect website certificates.'
    else {
      status.textContent = 'Reading the certificate…'
      pending = uuid()
      timer = setTimeout(() => {
        pending = undefined
        status.textContent =
          'The paired computer did not return a certificate. Open site information again.'
      }, 10000)
      request(pending, state.certificateDocumentId)
    }
  }
  button.onclick = open
  button.disabled = true
  return {
    open,
    update(next: typeof state) {
      if (
        next?.url !== state?.url ||
        next?.certificateDocumentId !== state?.certificateDocumentId ||
        next?.loading
      )
        reset()
      state = next
      button.disabled = !next || !/^https?:\/\//i.test(next.url)
    },
    show(id: string, result: BrowserPageCertificate | { error: string }) {
      if (pending !== id || !dialog.open) return
      clearTimeout(timer)
      pending = undefined
      if ('error' in result) {
        body.textContent = result.error
        return
      }
      if (!state || result.origin !== new URL(state.url).origin) {
        reset()
        return
      }
      body.textContent = [result.origin, result.protocol, result.cipher].filter(Boolean).join(' · ')
      if ('leaf' in result) {
        const note = document.createElement('p')
        note.textContent = 'Chromium did not provide the certificate chain for this page.'
        body.append(note)
      }
      for (const [index, cert] of browserCertificateEntries(result).entries()) {
        const details = document.createElement('details')
        details.open = index === 0
        const summary = document.createElement('summary')
        summary.textContent = index === 0 ? 'Website certificate' : 'Issuer certificate ' + index
        const fields = document.createElement('dl')
        for (const [label, value] of [
          ['Subject', cert.subject],
          ['Issuer', cert.issuer],
          ['Valid from', cert.validFrom],
          ['Valid until', cert.validTo],
          ['Serial number', cert.serialNumber],
          ['SHA-256 fingerprint', cert.fingerprint256],
          ['Subject alternative names', cert.subjectAltName],
        ]) {
          if (!value) continue
          const term = document.createElement('dt')
          term.textContent = label || ''
          const description = document.createElement('dd')
          description.textContent = value
          fields.append(term, description)
        }
        details.append(summary, fields)
        body.append(details)
      }
    },
  }
}
