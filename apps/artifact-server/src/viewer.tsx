import { Schema } from 'effect'
import {
  decode,
  artifactSessionSchema,
  artifactViewSchema,
  artifactAccessSchema,
  artifactPublicationsSchema,
  accountLoginSchema,
  mutableStruct,
  artifactFeedDataSchema,
} from '@dovo/protocol'
import {
  Button,
  Input,
  Card,
  Badge,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@dovo/web-ui'
import { createRoot } from 'react-dom/client'
import { useState, useRef, useEffect, useEffectEvent, useCallback, type ReactNode } from 'react'

const parts = location.pathname.split('/'),
  id = parts.length === 3 ? parts[2] : undefined
const fragment = new URLSearchParams(location.hash.slice(1)),
  linkToken = fragment.get('share'),
  appSession = fragment.get('session')
if (appSession) history.replaceState(null, '', location.pathname)
type Session = typeof artifactSessionSchema.Type
type Publication = typeof artifactViewSchema.Type
type Access = typeof artifactAccessSchema.Type
type Login = { code: string; url: string; expiresAt: number }
class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
async function request(path: string, method = 'GET', data?: unknown, share = false) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(share && linkToken && /^[A-Za-z0-9_-]{43}$/.test(linkToken)
        ? { Authorization: 'DovoShare ' + linkToken }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  if (!response.ok) {
    throw new RequestError(
      response.status,
      response.status === 401
        ? 'Sign in to continue'
        : response.status === 404
          ? 'Artifact unavailable or access not granted'
          : 'Request failed. Try again later',
    )
  }
  return (await response.json()) as unknown
}

function CopyLink({
  url,
  label,
  action,
}: {
  url: string
  label: string
  action: (work: () => Promise<void>) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false),
    [fallback, setFallback] = useState(false)
  return (
    <div className="row">
      <Input
        ref={input}
        readOnly
        value={url}
        aria-label={label}
        className="min-h-11 min-w-0 flex-1"
      />
      <Button
        size="touch"
        variant="outline"
        onClick={() =>
          action(async () => {
            try {
              await navigator.clipboard.writeText(url)
              setCopied(true)
            } catch {
              input.current?.select()
              setFallback(true)
            }
          })
        }
      >
        Copy {label.toLowerCase()}
      </Button>
      {copied && <span role="status">Copied</span>}
      {fallback && <span role="status">Select and copy the value above</span>}
    </div>
  )
}

function Preview({ value, onAccessLost }: { value: Publication; onAccessLost: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [feedStatus, setFeedStatus] = useState('')
  const push = useRef<() => void>(() => {})
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      lastFeed: typeof artifactFeedDataSchema.Type | undefined
    const send = (unavailable = false) => {
      if (!lastFeed || stopped) return
      const stale =
        unavailable ||
        !lastFeed.enabled ||
        lastFeed.updatedAt === null ||
        Date.now() - lastFeed.updatedAt > lastFeed.seconds * 2000
      setFeedStatus(
        lastFeed.updatedAt === null
          ? 'Saved snapshot'
          : `Last data received ${new Date(lastFeed.updatedAt).toLocaleString()}${stale ? ' · Stale' : ''}${unavailable ? ' · Refresh unavailable' : ''}`,
      )
      frame.current?.contentWindow?.postMessage(
        {
          type: 'dovo:artifact-data',
          payload: {
            data: lastFeed.data,
            updatedAt: lastFeed.updatedAt,
            stale,
            enabled: lastFeed.enabled,
          },
        },
        '*',
      )
    }
    push.current = () => send()
    const refresh = async () => {
      try {
        if (document.visibilityState === 'hidden') return
        const next = decode(
          artifactFeedDataSchema,
          await request(
            '/v1/publications/' + value.publication.id + '/feed',
            'GET',
            undefined,
            true,
          ),
        )
        if (stopped) return
        lastFeed = next
        send()
      } catch (error) {
        if (stopped) return
        if (error instanceof RequestError && [401, 404].includes(error.status)) {
          stopped = true
          onAccessLost()
        } else {
          setFeedStatus('Live data refresh unavailable')
          send(true)
        }
      } finally {
        if (!stopped)
          timer = setTimeout(() => {
            void refresh()
          }, 15000)
      }
    }
    void refresh()
    return () => {
      stopped = true
      clearTimeout(timer)
      push.current = () => {}
    }
  }, [value, onAccessLost])
  return (
    <section className="artifact-stage" aria-label="Published artifact">
      <iframe
        ref={frame}
        title="Artifact preview"
        sandbox="allow-scripts allow-downloads"
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'"
        srcDoc={value.content}
        onLoad={() => push.current()}
      />
      <footer className="preview-footer">
        <span>
          Published{' '}
          {new Date(value.publication.createdAt).toLocaleDateString(undefined, {
            dateStyle: 'medium',
          })}
        </span>
        <span aria-label="Live data status">{feedStatus || 'Saved snapshot'}</span>
      </footer>
    </section>
  )
}

function App() {
  const [sharingOpen, setSharingOpen] = useState(parts[1] === 'manage')
  const [accountOpen, setAccountOpen] = useState(false)
  const [session, setSession] = useState<Session>(),
    [login, setLogin] = useState<Login>(),
    [publication, setPublication] = useState<Publication>(),
    [publications, setPublications] = useState<typeof artifactPublicationsSchema.Type>(),
    [access, setAccess] = useState<Access>(),
    [createdLink, setCreatedLink] = useState<string>(),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState({ text: 'Loading…', error: false }),
    [recipient, setRecipient] = useState(''),
    [seconds, setSeconds] = useState(3600)
  const busyRef = useRef(false)
  const shareButton = useRef<HTMLButtonElement>(null)
  const accountButton = useRef<HTMLButtonElement>(null)
  const message = (text: string, error = false) => setStatus({ text, error })
  const onAccessLost = useCallback(() => {
    setPublication(undefined)
    setAccess(undefined)
    setSharingOpen(false)
    setCreatedLink(undefined)
    document.title = 'Dovo Artifacts'
    setStatus({ text: 'Artifact unavailable or access not granted', error: true })
  }, [])
  async function load() {
    message('Loading…')
    let current: Session | undefined
    try {
      current = decode(artifactSessionSchema, await request('/v1/me'))
    } catch (error) {
      if (!(error instanceof RequestError) || error.status !== 401) throw error
    }
    setSession(current)
    setLogin(undefined)
    if (!id) {
      setPublications(
        current ? decode(artifactPublicationsSchema, await request('/v1/publications')) : undefined,
      )
      message('')
      return
    }
    try {
      const value = decode(
        artifactViewSchema,
        await request('/v1/publications/' + id, 'GET', undefined, true),
      )
      document.title = value.publication.title + ' · Dovo Artifacts'
      setPublication(value)
      setAccess(
        value.owner
          ? decode(artifactAccessSchema, await request('/v1/publications/' + id + '/access'))
          : undefined,
      )
    } catch (error) {
      if (error instanceof RequestError && [401, 404].includes(error.status)) {
        setPublication(undefined)
        setAccess(undefined)
        setCreatedLink(undefined)
        setSharingOpen(false)
      }
      throw error
    }
    message('')
  }
  async function run(work: () => Promise<void>, quiet = false) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    if (!quiet) message('Working…')
    try {
      await work()
    } catch (error) {
      message(error instanceof Error ? error.message : 'Request failed', true)
    } finally {
      busyRef.current = false
      setBusy(false)
      setStatus((current) => (current.text === 'Working…' ? { text: '', error: false } : current))
    }
  }
  async function checkSignIn(quiet = false) {
    try {
      const state = decode(mutableStruct({ ready: Schema.Boolean }), await request('/auth/status'))
      if (!state.ready) {
        if (!quiet) message('Sign-in is still pending')
        return
      }
    } catch (error) {
      if (!(error instanceof RequestError) || error.status !== 401) throw error
      setLogin(undefined)
      message('Sign-in expired. Start again', true)
      return
    }
    await load()
    setAccountOpen(false)
  }
  const resumeSignIn = useEffectEvent(() => {
    if (document.visibilityState === 'hidden' || busyRef.current) return
    if (login && login.expiresAt <= Date.now()) {
      setLogin(undefined)
      message('Sign-in expired. Start again', true)
      return
    }
    void run(() => checkSignIn(true), true)
  })
  useEffect(() => {
    if (!login) return
    const resume = () => resumeSignIn()
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    const timer = setInterval(resume, 5000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [login])
  const bootstrap = useEffectEvent(() =>
    run(async () => {
      if (appSession) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(appSession)) throw new Error('Invalid sharing session')
        try {
          await request('/auth/session', 'POST', { token: appSession })
        } catch (error) {
          if (!(error instanceof RequestError) || error.status !== 401) throw error
        }
      }
      await load()
    }),
  )
  useEffect(() => {
    void bootstrap()
  }, [])
  const action = (work: () => Promise<void>) => {
    void run(work)
  }
  const control = (label: string, work: () => Promise<void>, destructive = false): ReactNode => (
    <Button
      size="touch"
      disabled={busy}
      variant={destructive ? 'destructive' : 'default'}
      onClick={() => action(work)}
    >
      {label}
    </Button>
  )
  const path = '/v1/publications/' + id
  const statusMessage = (
    <p
      id="status"
      role="status"
      aria-live="polite"
      hidden={!status.text}
      className={status.error ? 'status-message error' : 'status-message'}
    >
      {status.text}
    </p>
  )
  const accountControls = (
    <div id="auth">
      {session ? (
        <Card>
          <h2>Your sharing identity</h2>
          <p>Send this sharing ID to an artifact owner so they can invite your account.</p>
          <p className="account-name">{session.user.name}</p>
          <CopyLink url={session.user.id} label="Sharing ID" action={action} />
          {control('Sign out', async () => {
            await request('/auth/logout', 'POST', {})
            setSession(undefined)
            setCreatedLink(undefined)
            setAccess(undefined)
            setPublication(undefined)
            setSharingOpen(false)
            await load()
          })}
        </Card>
      ) : login ? (
        <Card>
          <h2>Compare your sign-in code</h2>
          <code>{login.code}</code>
          <p>Check that the sign-in page shows this code. Return here after signing in.</p>
          <Button size="touch" asChild>
            <a href={login.url} target="_blank" rel="noopener noreferrer">
              Continue to sign-in
            </a>
          </Button>
          {control('Check sign-in', () => checkSignIn())}
          {control('Cancel sign-in', async () => {
            await request('/auth/logout', 'POST', {})
            await load()
          })}
        </Card>
      ) : (
        <Card>
          <h2>Private artifact access</h2>
          <p>
            Use your Dovo account or organization SSO to view invited artifacts and manage your
            publications.
          </p>
          {control('Sign in', async () => {
            setLogin(
              decode(
                mutableStruct({
                  code: accountLoginSchema.fields.code,
                  url: accountLoginSchema.fields.url,
                  expiresAt: accountLoginSchema.fields.expiresAt,
                }),
                await request('/auth/start', 'POST', {}),
              ),
            )
            message('Sign-in expires in five minutes')
          })}
        </Card>
      )}
    </div>
  )
  const sharingControls = access && (
    <>
      <Card>
        <h2>Sharing settings</h2>
        <p>Private by default. Only you and the accounts listed below can use the private link.</p>
        <CopyLink
          url={location.origin + '/s/' + id}
          label="Private artifact link"
          action={action}
        />
        <p>
          Ask the recipient to sign in here and copy their sharing ID. Names and email addresses are
          not sharing IDs.
        </p>
        <div className="row">
          <Input
            placeholder="Recipient sharing ID"
            aria-label="Recipient sharing ID"
            maxLength={500}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="min-h-11 min-w-0 flex-1"
          />
          {control('Invite account', async () => {
            if (!recipient.trim()) {
              message('Enter the recipient’s sharing ID', true)
              return
            }
            await request(path + '/invites', 'POST', { userId: recipient.trim() })
            await load()
            message('Account invited')
          })}
        </div>
        {access.invites.map((member) => (
          <div className="row" key={member.userId}>
            <code>{member.userId}</code>
            {control(
              'Remove access',
              async () => {
                await request(path + '/invites', 'DELETE', member)
                await load()
                message('Invitation revoked')
              },
              true,
            )}
          </div>
        ))}
      </Card>
      <Card>
        <h2>Optional shareable links</h2>
        <p>
          Anyone holding a shareable link can view this saved artifact without signing in. They may
          save a copy. Revocation blocks future access; it cannot recall saved copies.
        </p>
        <div className="row">
          <Select
            value={String(seconds)}
            onValueChange={(value) => setSeconds(Number(value))}
            disabled={busy}
          >
            <SelectTrigger aria-label="Share link lifetime" className="min-h-11 w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                [3600, '1 hour'],
                [86400, '1 day'],
                [604800, '7 days'],
                [2592000, '30 days'],
              ].map(([value, label]) => (
                <SelectItem key={value} value={String(value)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {control('Create anyone-with-link access', async () => {
            const value = decode(
              mutableStruct({ url: Schema.String }),
              await request(path + '/links', 'POST', { seconds }),
            )
            setCreatedLink(value.url)
            await load()
            message('Shareable link created. Copy it now; it is shown only in this session')
          })}
        </div>
        {createdLink && (
          <CopyLink url={createdLink} label="Shareable artifact link" action={action} />
        )}{' '}
        {access.links.map((share) => (
          <div className="row" key={share.id}>
            <span>Expires {new Date(share.expiresAt).toLocaleString()}</span>
            {control(
              'Revoke link',
              async () => {
                await request(path + '/links/' + share.id, 'DELETE')
                setCreatedLink(undefined)
                await load()
                message('Share link revoked')
              },
              true,
            )}
          </div>
        ))}
      </Card>
      {access.feed && (
        <Card>
          <h2>Live data feed</h2>
          <p>
            Publisher-approved query, configured every {access.feed.seconds / 60} minute(s).
            Permission expires {new Date(access.feed.expiresAt).toLocaleString()}. Cached data
            follows the same invitation and share-link access as this artifact.
          </p>
          {control(
            'Stop and clear live feed',
            async () => {
              await request(path + '/feed', 'DELETE', {
                generation: access.feed?.generation,
              })
              await load()
              message('Live feed stopped and cached data cleared')
            },
            true,
          )}
        </Card>
      )}
      <details className="advanced-settings">
        <summary>Advanced · remove hosted copy</summary>
        <p>
          Remove this publication and revoke its invitations and links. Your local artifact stays
          available.
        </p>
        {control(
          'Delete hosted artifact',
          async () => {
            if (
              !confirm(
                'Delete this hosted copy and revoke all its invitations and links? Your local artifact is kept.',
              )
            ) {
              message('Deletion cancelled')
              return
            }
            await request(path, 'DELETE')
            location.assign('/')
          },
          true,
        )}
      </details>
    </>
  )
  return (
    <div className={publication ? 'app-shell app-shell--viewer' : 'app-shell'}>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Dovo Artifacts home">
          dovo<span className="brand-divider">/</span>
          <span className="brand-product">Artifacts</span>
        </a>
        {publication && (
          <div className="artifact-title">
            <h1 title={publication.publication.title}>{publication.publication.title}</h1>
            <Badge variant="outline">v{publication.publication.revision}</Badge>
          </div>
        )}
        <nav className="header-actions" aria-label="Artifact actions">
          <Button
            ref={accountButton}
            variant="ghost"
            size="sm"
            onClick={() => {
              setSharingOpen(false)
              setAccountOpen(true)
            }}
          >
            {session || !publication ? 'Account' : 'Sign in'}
          </Button>
          {publication && (
            <Button
              ref={shareButton}
              size="sm"
              onClick={() => {
                setAccountOpen(false)
                setSharingOpen(true)
              }}
            >
              Share
            </Button>
          )}
        </nav>
      </header>
      {!(accountOpen || (sharingOpen && publication)) && statusMessage}
      <main className={publication ? 'artifact-workspace' : 'library'}>
        {publication ? (
          <Preview value={publication} onAccessLost={onAccessLost} />
        ) : (
          <>
            <div className="library-heading">
              <span className="eyebrow">Dovo Artifacts</span>
              <h1>{id ? 'This artifact is private' : 'Your published artifacts'}</h1>
              <p>
                {id
                  ? 'Sign in with the account that was invited, or ask the owner to share access.'
                  : 'A dedicated space for the reports, prototypes and ideas you share.'}
              </p>
            </div>
            {!accountOpen && (!session || id) && (
              <fieldset disabled={busy} className="account-panel min-w-0 border-0 p-0 m-0">
                <legend className="sr-only">Artifact account</legend>
                {accountControls}
              </fieldset>
            )}
            {publications && (
              <section aria-label="Published artifacts" className="publication-grid">
                {publications.publications.length ? (
                  publications.publications.map((item) => (
                    <a className="publication-card" key={item.id} href={'/s/' + item.id}>
                      <Card>
                        <div className="publication-meta">
                          <Badge variant="secondary">{item.format}</Badge>
                          <span>Version {item.revision}</span>
                        </div>
                        <h2>{item.title}</h2>
                        <p>
                          {new Date(item.createdAt).toLocaleDateString(undefined, {
                            dateStyle: 'medium',
                          })}
                        </p>
                        <span className="publication-open">
                          Open artifact <span aria-hidden="true">↗</span>
                        </span>
                      </Card>
                    </a>
                  ))
                ) : (
                  <Card className="empty-state">
                    <h2>Ready when you are</h2>
                    <p>
                      Publish a saved version using Share artifact in Dovo Studio. It will appear
                      here, with access you control.
                    </p>
                  </Card>
                )}
              </section>
            )}
          </>
        )}
      </main>
      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            accountButton.current?.focus()
          }}
        >
          <DialogTitle>{session ? 'Your Dovo account' : 'Sign in to Dovo'}</DialogTitle>
          <DialogDescription>
            One account for Dovo Studio, Connect and hosted artifacts. Sharing permissions stay
            specific to each artifact.
          </DialogDescription>
          {accountOpen && statusMessage}
          <fieldset disabled={busy} className="dialog-controls min-w-0 border-0 p-0 m-0">
            <legend className="sr-only">Artifact account</legend>
            {accountControls}
          </fieldset>
        </DialogContent>
      </Dialog>
      <Dialog open={sharingOpen && !!publication} onOpenChange={setSharingOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            shareButton.current?.focus()
          }}
        >
          <DialogTitle>Share artifact</DialogTitle>
          <DialogDescription>
            {publication?.publication.title} · Saved version {publication?.publication.revision}
          </DialogDescription>
          {sharingOpen && statusMessage}
          <fieldset disabled={busy} className="dialog-controls min-w-0 border-0 p-0 m-0">
            <legend className="sr-only">Artifact sharing controls</legend>
            {publication?.owner ? (
              sharingControls
            ) : (
              <Card>
                <h2>Share this saved version</h2>
                <p>
                  {linkToken
                    ? 'Anyone with this link can view until it expires or the owner revokes it.'
                    : 'Only accounts invited by the owner can open this private link. Forwarding it does not grant access.'}
                </p>
                <CopyLink
                  url={
                    location.origin +
                    location.pathname +
                    (linkToken ? '#share=' + encodeURIComponent(linkToken) : '')
                  }
                  label="Artifact link"
                  action={action}
                />
              </Card>
            )}
          </fieldset>
        </DialogContent>
      </Dialog>
    </div>
  )
}
const root = document.getElementById('app')
if (!root) throw new Error('Page unavailable')
createRoot(root).render(<App />)
