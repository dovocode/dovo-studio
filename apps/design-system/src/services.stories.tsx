import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import {
  accountPage,
  page as authPage,
  signInPage,
  styles as authStyles,
  type AccountPageSession,
} from '../../auth-server/src/pages'
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
        Presentation preview only. Forms, sign-in, session management and sharing actions are
        disabled here; test the actual service flows separately.
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

const demoSessions: AccountPageSession[] = [
  {
    id: 'story-session-current-01',
    label: 'Firefox on macOS',
    lastActive: '21 Oct 2026, 10:42 UTC',
    expiresAt: '28 Oct 2026, 10:42 UTC',
    current: true,
  },
  {
    id: 'story-session-mobile-02',
    label: 'Safari on iOS',
    lastActive: '20 Oct 2026, 18:09 UTC',
    expiresAt: '27 Oct 2026, 18:09 UTC',
    current: false,
  },
]

function AccountFrame({ body, mode }: { body: string; mode: 'dark' | 'light' }) {
  return (
    <Frame
      mode={mode}
      html={authPage('Your account', body, true).replace(
        '<link rel="stylesheet" href="/styles.css">',
        `<style>${authStyles}</style>`,
      )}
    />
  )
}
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
export const AuthAccount: StoryObj = {
  render: (_, context) => (
    <AccountFrame
      mode={mode(context)}
      body={accountPage({
        name: 'Dominic',
        email: 'dominic@example.test',
        notice: 'Your profile has been updated.',
        sessions: demoSessions,
      })}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Uses the same signed-in account HTML template as the auth server, with synthetic profile data, dates, and display-only session IDs. Session tokens and authorization data are never supplied. The sandbox disables forms and navigation.',
      },
    },
  },
}
export const AuthAccountEmptySessions: StoryObj = {
  render: (_, context) => (
    <AccountFrame
      mode={mode(context)}
      body={accountPage({
        name: 'Alexandra North West',
        email: 'alexandra.north.west@example.test',
        sessions: [],
      })}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Shows the signed-in account template with no active Auth browser sessions and a long display name. It uses a synthetic account and no live identity data.',
      },
    },
  },
}
export const ConnectConsent: StoryObj = {
  render: (_, context) => (
    <Frame
      mode={mode(context)}
      html={connectPage(
        '<section class="card"><h2>Sign in to connect your devices</h2><p>Only continue if you started sign-in in Dovo Studio and see this code there:</p><h2><code>ABC-123</code></h2><p>This approval links your Dovo account to Dovo Connect. It does not authorize artifact access or replace project and runtime scope in Dovo Studio.</p><p>Private LAN and VPN access still uses pairing codes and device tokens; account sign-in is not required for those connections.</p><form><button>Continue to Dovo sign-in</button></form><form><button class="secondary">Sign in with your organization</button></form></section>',
      )}
    />
  ),
}

function artifactShell(auth: string, content: string) {
  return artifactPage
    .replace('<div id="auth"></div>', `<div id="auth">${auth}</div>`)
    .replace('<div id="content"></div>', `<div id="content">${content}</div>`)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
}

const signedInArtifactsAuth =
  '<section><h2>Your sharing identity</h2><p>Send this sharing ID to an artifact owner so they can invite your account.</p><div class="row"><input readonly aria-label="Sharing ID" value="story-account-7f2a"><button type="button" disabled>Copy sharing ID</button></div></section>'
const anonymousArtifactsAuth =
  '<section><h2>Private artifact access</h2><p>Sign in with Dovo or your organization SSO to view invited artifacts and manage your publications.</p><button type="button" disabled>Sign in</button></section>'

function ArtifactLibraryExample({ mode }: { mode: 'dark' | 'light' }) {
  const [state, setState] = useState<'empty' | 'viewer' | 'sharing'>('empty')
  const content =
    state === 'empty'
      ? '<section><h2>Your published artifacts</h2><p>Publish a saved version using Share artifact in Dovo Studio.</p></section>'
      : state === 'viewer'
        ? '<section><h2>Connection health overview</h2><p>Saved version 4 · Published 21 Oct 2026, 09:30</p><iframe title="Artifact preview" sandbox="" srcdoc="&lt;main style=&quot;font:16px sans-serif;padding:24px&quot;&gt;&lt;h1&gt;Connection health&lt;/h1&gt;&lt;p&gt;3 runtimes online · Last checked 09:25 UTC&lt;/p&gt;&lt;/main&gt;"></iframe><p class="muted">No live feed configured</p><button type="button" disabled>Manage sharing</button></section>'
        : '<section><h2>Sharing settings</h2><p>Private by default. Only you and invited accounts can use the private link.</p><div class="row"><input readonly aria-label="Private artifact link" value="https://artifacts.example.test/s/story-publication-id"><button type="button" disabled>Copy private artifact link</button></div><p>Ask the recipient to copy their sharing ID. Names and email addresses are not sharing IDs.</p><div class="row"><input disabled aria-label="Recipient sharing ID" placeholder="Recipient sharing ID"><button type="button" disabled>Invite account</button></div></section><section><h2>Optional shareable links</h2><p>Anyone holding a shareable link can view this saved artifact without signing in. Revocation blocks future access; it cannot recall saved copies.</p><div class="row"><select disabled aria-label="Share link lifetime"><option>1 hour</option><option>1 day</option><option>7 days</option></select><button type="button" disabled>Create anyone-with-link access</button></div></section>'
  return (
    <section>
      <div className="mb-4 flex flex-wrap gap-2">
        {(['empty', 'viewer', 'sharing'] as const).map((option) => (
          <button
            type="button"
            key={option}
            aria-pressed={state === option}
            className="rounded-md border px-3 py-2 text-sm"
            onClick={() => setState(option)}
          >
            {option === 'empty'
              ? 'Empty library'
              : option === 'viewer'
                ? 'Artifact viewer'
                : 'Sharing sidebar'}
          </button>
        ))}
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => setState('empty')}
        >
          Reset
        </button>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        The actual Artifacts page shell hosts fixture content in the same identity, auth, status and
        content regions. The viewer script is omitted, so no API calls are made; service actions are
        disabled.
      </p>
      <Frame mode={mode} html={artifactShell(signedInArtifactsAuth, content)} />
    </section>
  )
}
export const Artifacts: StoryObj = {
  render: (_, context) => <ArtifactLibraryExample mode={mode(context)} />,
  parameters: {
    docs: {
      description: {
        story:
          'Switch between an empty published-artifact library, a saved artifact preview, and the sharing-management content. The actual Artifacts shell is used, with the viewer script omitted and synthetic fixture data so no request or mutation is made.',
      },
    },
  },
}
export const ArtifactsSignIn: StoryObj = {
  render: (_, context) => (
    <Frame
      mode={mode(context)}
      html={artifactShell(
        anonymousArtifactsAuth,
        '<section><h2>Private artifact</h2><p>Sign in or use an invitation to view this artifact.</p></section>',
      )}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Uses the real Artifacts page shell to show an unauthenticated private-artifact state. Artifact access follows the invitation or share link for the selected publication; it is separate from Dovo Studio runtime scope.',
      },
    },
  },
}
