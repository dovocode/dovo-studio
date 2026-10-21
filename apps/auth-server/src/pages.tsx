import { hostedStyles } from '@dovo/design'
import { Button, Input, Badge, Card } from '@dovo/web-ui'
import { renderHtml } from '@dovo/web-ui/server'
import { webUiStyles } from '@dovo/web-ui/styles'

export const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

export const styles = `${hostedStyles}
${webUiStyles}
header,main,footer{max-width:1040px;margin:auto;padding:24px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);gap:20px}
.brand{font-size:21px;font-weight:700;text-decoration:none;letter-spacing:-1px;color:var(--text)}
.brand span{color:var(--dovo-primary)}
.brand:hover{text-decoration:none}
nav{display:flex;gap:20px;font-size:14px}
.layout{display:grid;grid-template-columns:1fr 1.1fr;gap:64px;align-items:start;padding:64px 0}
.eyebrow{color:var(--dovo-primary);font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase}
h1{font-size:clamp(32px,5vw,48px);margin:16px 0 24px}
h2{font-size:20px;margin:0 0 16px}
p{margin:12px 0}
.auth-card{margin-bottom:20px}
form{margin:0}
label{display:block;margin:14px 0 8px}
form button{margin-top:16px}
.notice{border-left:3px solid var(--dovo-primary);padding:12px 16px;margin-bottom:24px;background:var(--panel)}
.row{display:flex;justify-content:space-between;gap:16px;align-items:center;border-top:1px solid var(--line);padding:18px 0;overflow-wrap:anywhere}
.row:first-of-type{border:0}
.row form{flex-shrink:0}
.row button{margin:0}

footer{border-top:1px solid var(--line);font-size:12px;color:var(--dovo-muted-foreground);display:flex;justify-content:space-between;gap:16px}
@media(max-width:700px){header,main,footer{padding:20px}.layout{grid-template-columns:1fr;gap:24px;padding:32px 0}nav{gap:12px}.row{align-items:flex-start;flex-wrap:wrap}footer{flex-wrap:wrap}}
@media(prefers-reduced-motion:no-preference){a{transition:color .15s}}
`

export function page(title: string, body: string, signedIn = false) {
  return (
    '<!doctype html>' +
    renderHtml(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <meta name="color-scheme" content="dark" />
          <title>{`${title} · Dovo Auth`}</title>
          <link rel="stylesheet" href="/styles.css" />
        </head>
        <body>
          <header>
            <a className="brand" href="/">
              dovo<span> / auth</span>
            </a>
            <nav aria-label="Main navigation">
              <a href="/">Overview</a>
              <a href={signedIn ? '/account' : '/sign-in'}>
                {signedIn ? 'Your account' : 'Sign in'}
              </a>
            </nav>
          </header>
          <main dangerouslySetInnerHTML={{ __html: body }} />
          <footer>
            <span>Dovo Auth · Powered by Better Auth</span>
            <span>Your identity. Your computers. Your control.</span>
          </footer>
        </body>
      </html>,
    )
  )
}

export function signInPage(query: string) {
  return page(
    'Sign in',
    renderHtml(
      <div className="layout">
        <section>
          <div className="eyebrow">One Dovo account</div>
          <h1>
            Your workspace,
            <br />
            wherever you are.
          </h1>
          <p>Sign in to connect your computers and access shared artifacts.</p>
          <p>
            Private LAN and VPN connections remain available with device pairing, without an
            account.
          </p>
        </section>
        <Card className="auth-card">
          <h2>Welcome to Dovo</h2>
          <p>
            {query
              ? 'Continue the sign-in you started in Dovo. You’ll return there when you’re done.'
              : 'Continue with GitHub to manage your Dovo identity.'}
          </p>
          <form method="post" action={'/sign-in' + (query ? '?' + query : '')}>
            <Button size="touch" type="submit">
              Continue with GitHub
            </Button>
          </form>
          <p className="meta">
            Dovo never receives your GitHub password. Connecting a computer still requires explicit
            approval.
          </p>
          <hr />
          <p className="meta">
            Company SSO? Start sign-in in Dovo Studio and choose your organization.
          </p>
        </Card>
      </div>,
    ),
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

/** Safe display data only; no Auth session tokens enter the page. */
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
  return renderHtml(
    <div className="layout">
      <section>
        <div className="eyebrow">Your Dovo identity</div>
        <h1>Welcome, {name}.</h1>
        <p>Manage your profile and the browsers signed in to Dovo Auth.</p>
        <Button size="touch" asChild variant="outline">
          <a href="https://artifacts.dovo.studio">Open Dovo Artifacts</a>
        </Button>
        <p className="meta">
          To connect a computer, start in Dovo Studio. Account sign-in never replaces device
          consent.
        </p>
      </section>
      <section>
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        <Card className="auth-card">
          <h2>Profile</h2>
          <form method="post" action="/account/profile">
            <label htmlFor="name">Display name</label>
            <Input
              className="min-h-11"
              id="name"
              name="name"
              defaultValue={name}
              required
              maxLength={100}
              autoComplete="name"
            />
            <p>
              <strong>Email from GitHub</strong>
            </p>
            <p>{email}</p>
            <Button size="touch" type="submit">
              Save profile
            </Button>
          </form>
          <p className="meta">GitHub manages your sign-in and email address.</p>
        </Card>
        <Card className="auth-card">
          <h2>Active Auth sessions</h2>
          <p className="meta">
            Signing out here ends Auth browser sessions. Existing Dovo app sessions and paired
            computers are managed separately in Dovo Studio.
          </p>
          {sessions.length ? (
            sessions.map((item) => (
              <div className="row" key={item.id}>
                <div>
                  <strong>{item.label}</strong>{' '}
                  {item.current && <Badge variant="secondary">This browser</Badge>}
                  <div className="meta">
                    Last active {item.lastActive}
                    <br />
                    Expires {item.expiresAt}
                  </div>
                </div>
                {!item.current && (
                  <form method="post" action="/account/revoke-session">
                    <input type="hidden" name="id" value={item.id} />
                    <Button size="touch" type="submit" variant="outline">
                      Sign out session
                    </Button>
                  </form>
                )}
              </div>
            ))
          ) : (
            <p className="meta">No active Auth browser sessions are available.</p>
          )}
          <form method="post" action="/account/revoke-others">
            <Button size="touch" type="submit" variant="outline">
              Sign out other browsers
            </Button>
          </form>
        </Card>
        <Card className="auth-card">
          <h2>Account access</h2>
          <p>
            Use Dovo Studio’s account settings to revoke computer access or delete your Dovo account
            and its linked identity.
          </p>
          <form method="post" action="/account/sign-out">
            <Button size="touch" type="submit" variant="outline">
              Sign out of this browser
            </Button>
          </form>
        </Card>
      </section>
    </div>,
  )
}

const statusView = (title: string, description?: string, href?: string, label?: string) =>
  renderHtml(
    <>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {href && (
        <Button size="touch" asChild>
          <a href={href}>{label}</a>
        </Button>
      )}
    </>,
  )
export const authStatusViews = {
  sessionEnded: statusView(
    'Your session has ended.',
    'Sign in again to manage your account.',
    '/sign-in',
    'Sign in',
  ),
  tooLarge: statusView('Request too large.'),
  invalidName: statusView(
    'Enter a name between 1 and 100 characters.',
    undefined,
    '/account',
    'Back to your account',
  ),
  sessionInactive: statusView(
    'This session is no longer active.',
    undefined,
    '/account',
    'Back to your account',
  ),
  signInExpired: statusView(
    'This sign-in has expired.',
    'Start again from Dovo Studio, or sign in to manage your account.',
    '/sign-in',
    'Sign in',
  ),
  signInBlocked: statusView(
    'Request blocked.',
    'Start sign-in from Dovo Auth or Dovo Studio.',
    '/sign-in',
    'Sign in',
  ),
  publicNotFound: statusView(
    'Page not found.',
    'Return to Dovo Auth to continue.',
    '/',
    'Dovo Auth',
  ),
  interrupted: renderHtml(
    <div className="layout">
      <section>
        <div className="eyebrow">Dovo Auth</div>
        <h1>Let’s try that again.</h1>
        <p>
          Sign-in was cancelled, expired or could not be completed. Your existing computers and
          pairings are unchanged.
        </p>
      </section>
      <Card className="auth-card">
        <h2>Continue safely</h2>
        <p>
          If you started in Dovo Studio or Artifacts, return there and start sign-in again. To
          manage your identity here, continue below.
        </p>
        <Button size="touch" asChild>
          <a href="/sign-in">Back to sign-in</a>
        </Button>
      </Card>
    </div>,
  ),
  expired: statusView(
    'This sign-in has expired.',
    'Start again from Dovo Studio.',
    '/sign-in',
    'Sign in',
  ),
  blocked: statusView(
    'Request blocked.',
    'Return to your account and try again.',
    '/account',
    'Your account',
  ),
  notFound: statusView('Page not found.', undefined, '/account', 'Your account'),
  unavailable: statusView(
    'We couldn’t complete that request.',
    'Try again, or restart sign-in from Dovo Studio if your request expired.',
    '/',
    'Back to Dovo Auth',
  ),
} as const
