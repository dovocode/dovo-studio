import { hostedStyles } from '@dovo/design'

export const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

export const styles = `${hostedStyles}
header,main,footer{max-width:1040px;margin:auto;padding:24px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);gap:20px}
.brand{font-size:21px;font-weight:700;text-decoration:none;letter-spacing:-1px;color:var(--text)}
.brand span{color:var(--accent)}
.brand:hover{text-decoration:none}
nav{display:flex;gap:20px;font-size:14px}
.layout{display:grid;grid-template-columns:1fr 1.1fr;gap:64px;align-items:start;padding:64px 0}
.eyebrow{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase}
h1{font-size:clamp(32px,5vw,48px);margin:16px 0 24px}
h2{font-size:20px;margin:0 0 16px}
p{margin:12px 0}
.card{margin-bottom:20px}
form{margin:0}
label{display:block;margin:14px 0 8px}
form button{margin-top:16px}
.notice{border-left:3px solid var(--accent);padding:12px 16px;margin-bottom:24px;background:var(--panel)}
.row{display:flex;justify-content:space-between;gap:16px;align-items:center;border-top:1px solid var(--line);padding:18px 0;overflow-wrap:anywhere}
.row:first-of-type{border:0}
.row form{flex-shrink:0}
.row button{margin:0}
.badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;background:var(--dovo-secondary);color:var(--accent)}
footer{border-top:1px solid var(--line);font-size:12px;color:var(--muted);display:flex;justify-content:space-between;gap:16px}
@media(max-width:700px){header,main,footer{padding:20px}.layout{grid-template-columns:1fr;gap:24px;padding:32px 0}nav{gap:12px}.row{align-items:flex-start;flex-wrap:wrap}footer{flex-wrap:wrap}}
@media(prefers-reduced-motion:no-preference){a{transition:color .15s}}
`

export function page(title: string, body: string, signedIn = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escape(title)} · Dovo Auth</title><link rel="stylesheet" href="/styles.css"></head><body><header><a class="brand" href="/">dovo<span> / auth</span></a><nav aria-label="Main navigation"><a href="/">Overview</a><a href="${signedIn ? '/account' : '/sign-in'}">${signedIn ? 'Your account' : 'Sign in'}</a></nav></header><main>${body}</main><footer><span>Dovo Auth · Powered by Better Auth</span><span>Your identity. Your computers. Your control.</span></footer></body></html>`
}

export function signInPage(query: string) {
  return page(
    'Sign in',
    `<div class="layout"><section><div class="eyebrow">One Dovo account</div><h1>Your workspace,<br>wherever you are.</h1><p>Sign in to connect your computers and access shared artifacts.</p><p>Private LAN and VPN connections remain available with device pairing, without an account.</p></section><section class="card"><h2>Welcome to Dovo</h2><p>${query ? 'Continue the sign-in you started in Dovo. You’ll return there when you’re done.' : 'Continue with GitHub to manage your Dovo identity.'}</p><form method="post" action="/sign-in${query ? '?' + escape(query) : ''}"><button type="submit">Continue with GitHub</button></form><p class="meta">Dovo never receives your GitHub password. Connecting a computer still requires explicit approval.</p><hr><p class="meta">Company SSO? Start sign-in in Dovo Studio and choose your organization.</p></section></div>`,
  )
}

export function sessionLabel(agent: string | null | undefined) {
  if (!agent) return 'Unknown browser'
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Browser'
  const device = /iPhone|iPad/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Macintosh|Mac OS/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'Unknown device'
  return `${browser} on ${device}`
}

export type AccountPageSession = {
  id: string
  label: string
  lastActive: string
  expiresAt: string
  current: boolean
}

/** Render the signed-in account view from safe display data, never Auth session tokens. */
export function accountPage({
  name,
  email,
  sessions,
  notice,
}: {
  name: string
  email: string
  sessions: readonly AccountPageSession[]
  notice?: string
}) {
  const sessionRows = sessions.length
    ? sessions
        .map(
          (item) =>
            `<div class="row"><div><strong>${escape(item.label)}</strong> ${item.current ? '<span class="badge">This browser</span>' : ''}<div class="meta">Last active ${escape(item.lastActive)}<br>Expires ${escape(item.expiresAt)}</div></div>${item.current ? '' : `<form method="post" action="/account/revoke-session"><input type="hidden" name="id" value="${escape(item.id)}"><button class="secondary">Sign out session</button></form>`}</div>`,
        )
        .join('')
    : '<p class="meta">No active Auth browser sessions are available.</p>'
  return `<div class="layout"><section><div class="eyebrow">Your Dovo identity</div><h1>Welcome, ${escape(name)}.</h1><p>Manage your profile and the browsers signed in to Dovo Auth.</p><a class="button secondary" href="https://artifacts.dovo.studio">Open Dovo Artifacts</a><p class="meta">To connect a computer, start in Dovo Studio. Account sign-in never replaces device consent.</p></section><section>${notice ? '<div class="notice" role="status">' + escape(notice) + '</div>' : ''}<div class="card"><h2>Profile</h2><form method="post" action="/account/profile"><label for="name">Display name</label><input id="name" name="name" value="${escape(name)}" required maxlength="100" autocomplete="name"><p><strong>Email from GitHub</strong></p><p>${escape(email)}</p><button>Save profile</button></form><p class="meta">GitHub manages your sign-in and email address.</p></div><div class="card"><h2>Active Auth sessions</h2><p class="meta">Signing out here ends Auth browser sessions. Existing Dovo app sessions and paired computers are managed separately in Dovo Studio.</p>${sessionRows}<form method="post" action="/account/revoke-others"><button class="secondary">Sign out other browsers</button></form></div><div class="card"><h2>Account access</h2><p>Use Dovo Studio’s account settings to revoke computer access or delete your Dovo account and its linked identity.</p><form method="post" action="/account/sign-out"><button class="secondary">Sign out of this browser</button></form></div></section></div>`
}
