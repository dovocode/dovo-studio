// MCP Apps sandbox proxy: isolated guest frame with source-checked bidirectional relay.
import { csp, protectHtml } from './security'
let guest: HTMLIFrameElement | undefined
window.addEventListener('message', (event) => {
  if (event.source === parent) {
    if (event.data?.method === 'ui/notifications/sandbox-resource-ready') {
      if (guest) return
      const params = event.data.params
      if (typeof params?.html !== 'string') return
      guest = document.createElement('iframe')
      guest.setAttribute('sandbox', 'allow-scripts allow-forms')
      guest.setAttribute(
        'allow',
        "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'",
      )
      guest.style.cssText = 'width:100%;height:100%;border:0;display:block'
      guest.srcdoc = protectHtml(params.html, csp(params.csp))
      document.body.append(guest)
    } else guest?.contentWindow?.postMessage(event.data, '*')
  } else if (guest && event.source === guest.contentWindow) {
    // Guests cannot manufacture proxy readiness or replace the HTML/CSP envelope.
    if (event.data?.method?.startsWith('ui/notifications/sandbox-')) return
    parent.postMessage(event.data, '*')
  }
})
parent.postMessage(
  { jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} },
  '*',
)
