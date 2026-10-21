import { hostedStyles } from '@dovo/design'
import { Button, Card } from '@dovo/web-ui'
import { renderHtml } from '@dovo/web-ui/server'
import { webUiStyles } from '@dovo/web-ui/styles'

export const connectPageStyles = `${hostedStyles}\n${webUiStyles}\nmain{width:min(100% - 32px, 560px);margin:0 auto;padding:clamp(24px,6vw,64px) 0}header{margin-bottom:28px}h1{font-size:1.4rem;margin:0}h2{font-size:1.15rem}p{line-height:1.6}form{margin:12px 0}form button{width:100%}code{display:inline-block;padding:12px 16px;font-size:1.25rem;letter-spacing:.12em;overflow-wrap:anywhere}a{overflow-wrap:anywhere}`

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
          <main>
            <header>
              <h1>Dovo Studio</h1>
            </header>
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
      <p>
        {login.artifactsOrigin
          ? 'This sign-in is limited to hosted artifact sharing. It does not authorize access to your computers.'
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
export function connectSuccess(artifacts: boolean) {
  return renderHtml(
    <>
      <h2>You are signed in</h2>
      <p>
        Return to{' '}
        {artifacts
          ? 'Dovo Artifacts and check sign-in.'
          : 'Dovo Studio. Your computers will appear there.'}
      </p>
    </>,
  )
}
