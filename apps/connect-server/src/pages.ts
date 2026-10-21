import { hostedStyles } from '@dovo/design'

export const connectPageStyles = `${hostedStyles}\nmain{width:min(100% - 32px, 560px);margin:0 auto;padding:clamp(24px,6vw,64px) 0}header{margin-bottom:28px}h1{font-size:1.4rem;margin:0}h2{font-size:1.15rem}p{line-height:1.6}form{margin:12px 0}button{min-height:44px;width:100%;text-align:left}code{display:inline-block;padding:12px 16px;font-size:1.25rem;letter-spacing:.12em;overflow-wrap:anywhere}a{overflow-wrap:anywhere}`

export function connectPage(content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Dovo Studio sign-in</title><style>${connectPageStyles}</style></head><body><main><header><h1>Dovo Studio</h1></header>${content}</main></body></html>`
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

/** Shared browser consent view; only display data is accepted. */
export function connectConsent(
  login: { code: string; artifactsOrigin?: string },
  organizations: readonly { id: string; name: string }[],
) {
  return `<h2>${login.artifactsOrigin ? 'Sign in to Dovo Artifacts' : 'Sign in to connect your devices'}</h2><p>Only continue if you started sign-in in ${login.artifactsOrigin ? escape(login.artifactsOrigin) : 'Dovo Studio'} and see this code there:</p><h2><code>${escape(login.code)}</code></h2><p>${login.artifactsOrigin ? 'This sign-in is limited to hosted artifact sharing. It does not authorize access to your computers.' : 'Signing in grants access to computers where you enable Dovo Connect on this account. LAN / VPN access still requires separate device pairing.'}</p><form method="post" action="/auth/authorize"><button type="submit">Continue to Dovo sign-in</button></form>${organizations.map((organization) => `<form method="post" action="/auth/authorize?organization=${encodeURIComponent(organization.id)}"><button class="secondary" type="submit">Sign in with ${escape(organization.name)} SSO</button></form>`).join('')}`
}

export function connectSuccess(artifacts: boolean) {
  return artifacts
    ? '<h2>You are signed in</h2><p>Return to Dovo Artifacts and check sign-in.</p>'
    : '<h2>You are signed in</h2><p>Return to Dovo Studio. Your computers will appear there.</p>'
}
