import type { Meta, StoryObj } from '@storybook/react-vite'
import { signInPage, styles as authStyles } from '../../auth-server/src/pages'
import { connectPage } from '../../connect-server/src/pages'
import { artifactPage } from '../../artifact-server/src/pages'

const meta = { title: 'Dovo/Hosted services', tags: ['autodocs'] } satisfies Meta
export default meta
function Frame({ html, mode }: { html: string; mode: 'dark' | 'light' }) {
  const content = html
    .replace('<html lang="en">', `<html lang="en" data-theme="${mode}">`)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  return (
    <section>
      <p className="mb-4 text-muted-foreground">
        Presentation preview only. Sign-in and sharing actions are disabled here; test the actual
        service flows separately.
      </p>
      <iframe
        title="Hosted service preview"
        sandbox=""
        srcDoc={content}
        style={{ width: '100%', height: 900, border: '1px solid var(--border)', borderRadius: 12 }}
      />
    </section>
  )
}
const mode = (context: { globals: Record<string, unknown> }): 'dark' | 'light' =>
  context.globals.theme === 'light' ? 'light' : 'dark'
export const Auth: StoryObj = {
  render: (_, context) => (
    <Frame
      mode={mode(context)}
      html={signInPage('').replace(
        '<link rel="stylesheet" href="/styles.css">',
        `<style>${authStyles}</style>`,
      )}
    />
  ),
}
export const ConnectConsent: StoryObj = {
  render: (_, context) => (
    <Frame
      mode={mode(context)}
      html={connectPage(
        '<section class="card"><h2>Sign in to connect your devices</h2><p>Only continue if you started sign-in in Dovo Studio and see this code there:</p><h2><code>ABC-123</code></h2><p>Signing in grants access to computers where you enable Dovo Connect on this account. LAN / VPN access still requires separate device pairing.</p><form><button>Continue to Dovo sign-in</button></form><form><button class="secondary">Sign in with your organization</button></form></section>',
      )}
    />
  ),
}
export const Artifacts: StoryObj = {
  render: (_, context) => (
    <Frame
      mode={mode(context)}
      html={artifactPage.replace(
        '<div id="auth"></div>',
        '<div id="auth"><section><h2>Your shared artifacts</h2><p>Sign in to publish artifacts or view private invitations. Public links give access only to the selected publication.</p><button>Sign in to Dovo</button></section></div>',
      )}
    />
  ),
}
