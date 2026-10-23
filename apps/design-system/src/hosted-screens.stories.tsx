import type { Meta, StoryObj } from '@storybook/react-vite'
import { accountPage, authStatusViews, page, signInPage, styles } from '../../auth-server/src/pages'
import { connectConsent, connectPage, connectSuccess } from '../../connect-server/src/pages'
import { artifactPage } from '../../artifact-server/src/pages'
import generated from './hosted-screens.generated.json'

const meta = {
  title: 'Dovo/Screens/Hosted',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Production page templates and website components inside isolated frames. All identities, publications and responses are synthetic. Network requests, external navigation, popups, forms and clipboard are blocked; no real account or publication can be changed.',
      },
    },
  },
} satisfies Meta
export default meta

const safeScript = (script: string) => script.replace(/<\/script/gi, '<\\/script')
function Frame({
  html,
  theme,
  scripts = false,
  title,
}: {
  html: string
  theme: string
  scripts?: boolean
  title: string
}) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src about:; form-action 'none'; base-uri 'none'">`
  const inertHtml = scripts
    ? html
    : html.replace(
        /<a\b([^>]*?)\shref="([^"]*)"/gi,
        '<a$1 aria-disabled="true" tabindex="-1" data-preview-href="$2"',
      )
  const content = inertHtml
    .replace('<head>', `<head>${policy}`)
    .replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`)
  return (
    <>
      <p style={{ margin: 16 }}>
        Synthetic isolated preview · {title} · service actions cannot change real data.
      </p>
      <iframe
        title={title}
        sandbox="allow-scripts"
        srcDoc={content}
        style={{ display: 'block', width: '100%', height: 1100, border: 0 }}
      />
    </>
  )
}
const theme = (context: { globals: Record<string, unknown> }) =>
  context.globals.theme === 'light' ? 'light' : 'dark'
const authDocument = (html: string) =>
  html.replace(/<link rel="stylesheet" href="\/styles.css"\s*\/?>/, `<style>${styles}</style>`)
const authStory = (title: string, html: string): StoryObj => ({
  render: (_, context) => <Frame title={title} theme={theme(context)} html={authDocument(html)} />,
})
export const AuthSignIn = authStory('Auth /sign-in', signInPage(''))
export const AuthAppContinuation = authStory(
  'Auth /sign-in · app continuation',
  signInPage('client_id=synthetic-client&state=synthetic-state'),
)
export const AuthAccount = authStory(
  'Auth /account · profile and sessions',
  page(
    'Your account',
    accountPage({
      name: 'Alex Morgan',
      email: 'alex@example.test',
      sessions: [
        {
          id: 'synthetic-current',
          label: 'Safari on macOS',
          lastActive: '21 Oct 2026, 10:00 UTC',
          expiresAt: '28 Oct 2026, 10:00 UTC',
          current: true,
        },
        {
          id: 'synthetic-other',
          label: 'Safari on iOS',
          lastActive: '20 Oct 2026, 18:00 UTC',
          expiresAt: '27 Oct 2026, 18:00 UTC',
          current: false,
        },
      ],
    }),
    true,
  ),
)
export const AuthAccountEmpty = authStory(
  'Auth /account · empty sessions',
  page(
    'Your account',
    accountPage({
      name: 'Alexandra Morgan Example',
      email: 'alexandra@example.test',
      sessions: [],
    }),
    true,
  ),
)
export const AuthAccountSaved = authStory(
  'Auth /account · saved',
  page(
    'Your account',
    accountPage({
      name: 'Alex Morgan',
      email: 'alex@example.test',
      sessions: [],
      notice: 'Your profile has been updated.',
    }),
    true,
  ),
)

export const AuthInterrupted = authStory(
  'Auth /error · cancelled or interrupted',
  page('Sign-in interrupted', authStatusViews.interrupted),
)
export const AuthExpired = authStory(
  'Auth /sign-in · expired',
  page('Sign-in expired', authStatusViews.expired),
)
export const AuthBlocked = authStory(
  'Auth · blocked request',
  page('Request blocked', authStatusViews.blocked, true),
)
export const AuthNotFound = authStory(
  'Auth · not found',
  page('Not found', authStatusViews.notFound, true),
)
export const AuthUnavailable = authStory(
  'Auth · service unavailable',
  page('Try again', authStatusViews.unavailable),
)

export const AuthSessionEnded = authStory(
  'Auth · sessionEnded',
  page('Account status', authStatusViews.sessionEnded),
)
export const AuthTooLarge = authStory(
  'Auth · tooLarge',
  page('Account status', authStatusViews.tooLarge, true),
)
export const AuthInvalidName = authStory(
  'Auth · invalidName',
  page('Account status', authStatusViews.invalidName, true),
)
export const AuthSessionInactive = authStory(
  'Auth · sessionInactive',
  page('Account status', authStatusViews.sessionInactive, true),
)
export const AuthSignInExpired = authStory(
  'Auth · signInExpired',
  page('Account status', authStatusViews.signInExpired),
)
export const AuthSignInBlocked = authStory(
  'Auth · signInBlocked',
  page('Account status', authStatusViews.signInBlocked),
)
export const AuthPublicNotFound = authStory(
  'Auth · publicNotFound',
  page('Account status', authStatusViews.publicNotFound),
)

const connectStory = (title: string, body: string): StoryObj => ({
  render: (_, context) => <Frame title={title} theme={theme(context)} html={connectPage(body)} />,
})
export const ConnectDeviceConsent = connectStory(
  'Connect /auth/start · device consent',
  connectConsent({ code: 'ABC-123' }, []),
)
export const ConnectOrganizationConsent = connectStory(
  'Connect /auth/start · organization choices',
  connectConsent({ code: 'ABC-123' }, [
    { id: 'example', name: 'Example Organization' },
    { id: 'research', name: 'Research and Development' },
  ]),
)
export const ConnectArtifactConsent = connectStory(
  'Connect /auth/start · artifact scope',
  connectConsent({ code: 'DEF-456', artifactsOrigin: 'https://artifacts.example.test' }, [
    { id: 'example', name: 'Example Organization' },
  ]),
)
export const ConnectDeviceSuccess = connectStory(
  'Connect /auth/callback · device success',
  connectSuccess(),
)
export const ConnectArtifactSuccess = connectStory(
  'Connect /auth/callback · artifact success',
  connectSuccess('https://artifacts.example.test'),
)

// Runs the real imperative viewer against an in-frame synthetic transport. CSP blocks real fetches.
type ArtifactState =
  | 'anonymous'
  | 'signin'
  | 'empty'
  | 'library'
  | 'viewer'
  | 'shared'
  | 'manage'
  | 'feed'
  | 'stale'
  | 'loading'
  | 'unavailable'
  | 'error'
function artifactDocument(state: ArtifactState) {
  const publication = {
    id: 'd7673b21-ddd7-45cc-8ed1-ec809118401b',
    title: 'Connection health overview',
    format: 'html',
    revision: 4,
    createdAt: '2026-10-21T09:30:00.000Z',
  }
  const detail = !['anonymous', 'signin', 'empty', 'library'].includes(state)
  const bootstrap = `
const __dovoCatalogLocation = {pathname:${JSON.stringify(detail ? `${state === 'manage' ? '/manage/' : '/s/'}${publication.id}` : '/')}, hash:'', origin:'https://artifacts.example.test',assign(){throw Error('Navigation disabled in catalog')}};
const fixtureState=${JSON.stringify(state)}, publication=${JSON.stringify(publication)};
window.fetch=async function(path, options={}) {
 if(fixtureState==='loading')return new Promise(()=>{});
 if(fixtureState==='error')return new Response('{}',{status:503});
 if(path==='/auth/start')return Response.json({code:'ABC-123',url:'https://connect.example.test/auth/start?id=synthetic',expiresAt:Date.now()+300000});
 if(path==='/auth/status')return Response.json({ready:false});
 if(options.method && options.method!=='GET')return new Response('{}',{status:403});
 if(path==='/v1/me')return ['anonymous','signin','shared'].includes(fixtureState)?new Response('{}',{status:401}):Response.json({audience:'https://artifacts.example.test',user:{id:'synthetic-sharing-account',name:'Alex Morgan'},expiresAt:Date.now()+3600000});
 if(path==='/v1/publications')return Response.json({publications:fixtureState==='empty'?[]:[publication,{...publication,id:'bcabbb1c-5c1a-4505-bca1-f87b4e3ed0fa',title:'Project launch notes',revision:1}]});
 if(fixtureState==='unavailable')return new Response('{}',{status:404});
 if(path.endsWith('/access'))return Response.json({invites:[{userId:'synthetic-invited-reviewer'}],links:[{id:'synthetic-link',expiresAt:Date.now()+86400000}],feed:{generation:publication.id,seconds:60,expiresAt:Date.now()+3600000}});
 if(path.endsWith('/feed'))return Response.json({enabled:['feed','stale','manage'].includes(fixtureState),data:{summary:{online:3,total:4}},updatedAt:['feed','manage'].includes(fixtureState)?Date.now():fixtureState==='stale'?Date.now()-3600000:null,expiresAt:Date.now()+3600000,seconds:60});
 return Response.json({publication,owner:fixtureState!=='shared',content:'<!doctype html><html lang="en"><body style="font:16px system-ui;padding:24px"><h1>Connection health</h1><p>3 runtimes online</p><p>Synthetic publication. No tools or credentials.</p></body></html>'});
};
document.addEventListener('click',event=>{if(event.target instanceof Element && event.target.closest('a'))event.preventDefault()},true);
`
  return artifactPage.replace(
    '<script src="/viewer.js" defer></script>',
    () =>
      `<script>${safeScript(bootstrap + generated.viewer + (state === 'signin' ? `;setTimeout(()=>{Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Sign in')?.click()},0)` : ''))}</script>`,
  )
}
const artifactStory = (state: ArtifactState): StoryObj => ({
  render: (_, context) => (
    <Frame
      title={`Artifacts · ${state}`}
      theme={theme(context)}
      scripts
      html={artifactDocument(state)}
    />
  ),
})
export const ArtifactsSignIn = artifactStory('anonymous')
export const ArtifactsSignInPending = artifactStory('signin')
export const ArtifactsEmpty = artifactStory('empty')
export const ArtifactsLibrary = artifactStory('library')
export const ArtifactsViewer = artifactStory('viewer')
export const ArtifactsPublicShare = artifactStory('shared')
export const ArtifactsSharingManagement = artifactStory('manage')
export const ArtifactsLiveFeed = artifactStory('feed')
export const ArtifactsStaleFeed = artifactStory('stale')
export const ArtifactsLoading = artifactStory('loading')
export const ArtifactsUnavailable = artifactStory('unavailable')
export const ArtifactsServerError = artifactStory('error')

function websiteDocument(
  route: string,
  release: 'ready' | 'loading' | 'unavailable' = 'ready',
  nightly = false,
) {
  const bootstrap = `document.documentElement.dataset.catalogRoute=${JSON.stringify(route)};document.addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('a'))event.preventDefault()},true);window.fetch=async()=>${release === 'loading' ? 'new Promise(()=>{})' : `Response.json(${JSON.stringify(release === 'ready' ? [{ draft: false, prerelease: true, tag_name: 'v0.0.9-nightly.999', html_url: 'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.9-nightly.999', published_at: '2026-10-21T09:00:00.000Z' }] : [])})`};${nightly ? `new MutationObserver((_,observer)=>{const button=Array.from(document.querySelectorAll('button')).find(button=>button.querySelector('strong')?.textContent==='Nightly');if(button){observer.disconnect();button.click()}}).observe(document,{subtree:true,childList:true});` : ''}`
  return `<!doctype html><html lang="en"><head><style>${generated.css}</style></head><body><script>${safeScript(bootstrap + generated.website)}</script></body></html>`
}
const websiteStory = (
  route: string,
  release: 'ready' | 'loading' | 'unavailable' = 'ready',
  nightly = false,
): StoryObj => ({
  render: (_, context) => (
    <Frame
      title={`Website /${route === 'home' ? '' : route}`}
      theme={theme(context)}
      scripts
      html={websiteDocument(route, release, nightly)}
    />
  ),
})
export const WebsiteHome = websiteStory('home')
export const WebsiteDocs = websiteStory('docs')
export const WebsiteDownload = websiteStory('download')
export const WebsitePrivacy = websiteStory('privacy')
export const WebsiteNotFound = websiteStory('not-found')

export const WebsiteDownloadNightly = websiteStory('download', 'ready', true)
export const WebsiteDownloadLoading = websiteStory('download', 'loading', true)
export const WebsiteDownloadUnavailable = websiteStory('download', 'unavailable', true)
