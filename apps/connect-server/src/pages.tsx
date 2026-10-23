import { hostedStyles } from '@dovo/design'
import { Button, Card } from '@dovo/web-ui'
import { renderHtml } from '@dovo/web-ui/server'
import { webUiStyles } from '@dovo/web-ui/styles'

export const connectPageStyles = `${hostedStyles}\n${webUiStyles}\n*{box-sizing:border-box}header{height:64px;display:flex;align-items:center;border-bottom:1px solid var(--line);padding:0 24px}.brand{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:700;letter-spacing:-1px;color:var(--text)!important;text-decoration:none!important}.brand span{font-size:12px;font-weight:500;letter-spacing:0;color:var(--dovo-muted-foreground)}main{width:min(100% - 40px,480px);margin:0 auto;padding:clamp(32px,8vh,80px) 0}h1{font-size:1.5rem;margin:0}h2{font-size:1.35rem;line-height:1.3;margin:0 0 20px}p{font-size:14px;margin:16px 0;line-height:1.65}form{margin:12px 0}form button{width:100%}code{display:block;padding:18px 16px;font-size:1.5rem;letter-spacing:.16em;text-align:center;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}a{overflow-wrap:anywhere}.consent-note{font-size:12px;border-top:1px solid var(--line);padding-top:16px}`

/** Content is trusted server-rendered markup, never publisher HTML. */
export function connectPage(content: string) {
  return (
    '<!doctype html>' +
    renderHtml(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="dark" />
          <title>Dovo Studio sign-in</title>
          <style>{connectPageStyles}</style>
        </head>
        <body>
          <header>
            <a className="brand" href="https://dovo.studio">
              dovo <span>/ Connect</span>
            </a>
          </header>
          <main>
            <Card dangerouslySetInnerHTML={{ __html: content }} />
          </main>
        </body>
      </html>,
    )
  )
}

export function connectConsent(
  login: { code: string; artifactsOrigin?: string },
  organizations: readonly { id: string; name: string }[],
) {
  return renderHtml(
    <>
      <h2>
        {login.artifactsOrigin ? 'Sign in to Dovo Artifacts' : 'Sign in to connect your devices'}
      </h2>
      <p>
        Only continue if you started sign-in in {login.artifactsOrigin ?? 'Dovo Studio'} and see
        this code there:
      </p>
      <p>
        <code>{login.code}</code>
      </p>
      <p className="consent-note">
        {login.artifactsOrigin
          ? 'Your Dovo account works across Studio and Artifacts. This sign-in is limited to hosted artifact sharing. It does not authorize access to your computers.'
          : 'Signing in grants access to computers where you enable Dovo Connect on this account. LAN / VPN access still requires separate device pairing.'}
      </p>
      <form method="post" action="/auth/authorize">
        <Button size="touch" type="submit">
          Continue to Dovo sign-in
        </Button>
      </form>
      {organizations.map((organization) => (
        <form
          key={organization.id}
          method="post"
          action={'/auth/authorize?organization=' + encodeURIComponent(organization.id)}
        >
          <Button size="touch" variant="outline" type="submit">
            Sign in with {organization.name} SSO
          </Button>
        </form>
      ))}
    </>,
  )
}
export function connectSuccess(artifactsOrigin?: string) {
  return renderHtml(
    <>
      <h2>You are signed in</h2>
      <p>
        Return to{' '}
        {artifactsOrigin
          ? 'Dovo Artifacts. Your sign-in will finish automatically.'
          : 'Dovo Studio. Your computers will appear there.'}
      </p>
      {artifactsOrigin && (
        <Button size="touch" variant="outline" asChild>
          <a href={artifactsOrigin}>Open Dovo Artifacts</a>
        </Button>
      )}
    </>,
  )
}
