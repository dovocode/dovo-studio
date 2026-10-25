import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Schema } from 'effect'
import { marked } from 'marked'
import {
  decode,
  mutableStruct,
  sharingKeySchema,
  shareReaderSchema,
  sharingReaderKeysSchema,
  decryptSharing,
  decryptSharedContent,
  encryptSuggestion,
  artifactPrintDocument,
  artifactSourceMarkdown,
  type SharedContent,
  artifactFeedGuestScript,
  parseSharedMarkdown,
  type SharedMarkdownNode,
} from '@dovo/protocol'
import { Button, Input, Textarea, Badge } from '@dovo/web-ui'

const id = location.pathname.split('/')[2] ?? ''
const fragment = new URLSearchParams(location.hash.slice(1))
const access = fragment.get('access') ?? '',
  key = fragment.get('key') ?? '',
  token = fragment.get('share')
// Decryption material stays in the fragment; never send it to the server.
const path = '/v2/shares/' + id
class AccessError extends Error {}
async function request(endpoint: string, method = 'GET', value?: unknown) {
  const response = await fetch(endpoint, {
    method,
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: {
      ...(token ? { Authorization: 'DovoShare ' + token } : {}),
      ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
  })
  if ([401, 404].includes(response.status))
    throw new AccessError(
      'This link has expired, was revoked, or needs an invited account. Sign in to check private access.',
    )
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Too many requests. Please try again later.'
        : 'Could not reach Dovo Share. Try again.',
    )
  return (await response.json()) as unknown
}
function Artifact({ content }: { content: Extract<SharedContent, { kind: 'artifact' }> }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const artifact = content.artifact
  const html =
    artifact.format === 'html' || artifact.format === 'svg'
      ? artifact.content
      : marked.parse(
          artifact.format === 'code' ? artifactSourceMarkdown(artifact) : artifact.content,
          { async: false, gfm: true },
        )
  const send = () =>
    frame.current?.contentWindow?.postMessage(
      {
        type: 'dovo:artifact-data',
        payload: {
          data: content.feed?.data ?? null,
          updatedAt: content.feed?.updatedAt ?? null,
          enabled: !!content.feed,
          stale:
            !!content.feed && Date.now() - content.feed.updatedAt > content.feed.seconds * 2000,
        },
      },
      '*',
    )
  useEffect(send, [content.feed])
  return (
    <iframe
      ref={frame}
      onLoad={send}
      title={artifact.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={artifactPrintDocument(artifactFeedGuestScript + html).html}
      style={{ width: '100%', height: 'calc(100dvh - 160px)', border: 0 }}
    />
  )
}
function MarkdownNode({ node }: { node: SharedMarkdownNode }) {
  const children =
    'children' in node
      ? node.children.map((child, index) => <MarkdownNode key={index} node={child} />)
      : null
  switch (node.type) {
    case 'root':
      return <>{children}</>
    case 'paragraph':
      return <p>{children}</p>
    case 'text':
      return <>{node.value}</>
    case 'html':
      return <code>{node.value}</code>
    case 'heading':
      return node.depth <= 2 ? <h2>{children}</h2> : <h3>{children}</h3>
    case 'strong':
      return <strong>{children}</strong>
    case 'emphasis':
      return <em>{children}</em>
    case 'delete':
      return <del>{children}</del>
    case 'code':
      return (
        <pre>
          <code>{node.value}</code>
        </pre>
      )
    case 'inlineCode':
      return <code>{node.value}</code>
    case 'break':
      return <br />
    case 'thematicBreak':
      return <hr />
    case 'blockquote':
      return <blockquote>{children}</blockquote>
    case 'list':
      return node.ordered ? <ol start={node.start ?? 1}>{children}</ol> : <ul>{children}</ul>
    case 'listItem':
      return (
        <li>
          {node.checked !== null && node.checked !== undefined
            ? `${node.checked ? '☑' : '☐'} `
            : ''}
          {children}
        </li>
      )
    case 'link':
      return /^https?:\/\//i.test(node.url) ? (
        <a href={node.url} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : (
        <>{children}</>
      )
    case 'image':
      return <span>{node.alt ? `[Image: ${node.alt}]` : '[Image excluded]'}</span>
    case 'table':
      return (
        <div className="sharing-table">
          <table>
            <tbody>{children}</tbody>
          </table>
        </div>
      )
    case 'tableRow':
      return <tr>{children}</tr>
    case 'tableCell':
      return <td>{children}</td>
    default:
      return <>{children}</>
  }
}
function Markdown({ text }: { text: string }) {
  const node = useMemo(() => parseSharedMarkdown(text), [text])
  return <MarkdownNode node={node} />
}
function App() {
  const [content, setContent] = useState<SharedContent | null>(null),
    [view, setView] = useState<typeof shareReaderSchema.Type | null>(null)
  const [keys, setKeys] = useState<typeof sharingReaderKeysSchema.Type | null>(null)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const [name, setName] = useState(''),
    [text, setText] = useState('')
  const [login, setLogin] = useState<{ code: string; url: string; expiresAt: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  useEffect(() => {
    if (!id) return
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        decode(sharingKeySchema, key)
        const next = decode(
          shareReaderSchema,
          await request(path + '/read?access=' + encodeURIComponent(access)),
        )
        if (stopped) return
        if (next.version < latest.current)
          throw new Error('An older shared version was received. Refresh to retry.')
        if (next.version !== latest.current) {
          const reader = decode(sharingReaderKeysSchema, decryptSharing(next.box, key))
          const value = decryptSharedContent(id, next.packet, reader)
          if (value.kind !== next.kind) throw new Error('The shared content type does not match')
          setKeys(reader)
          setContent(value)
          setView(next)
          latest.current = next.version
        }
        setError('')
      } catch (cause) {
        if (stopped) return
        if (cause instanceof AccessError) {
          setContent(null)
          setView(null)
          setKeys(null)
          latest.current = 0
        }
        setError(cause instanceof Error ? cause.message : 'Could not read this encrypted share')
      } finally {
        if (!stopped) timer = setTimeout(() => void refresh(), 5000)
      }
    }
    void refresh()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [attempt])
  const act = async (run: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await run()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }
  const checkLogin = async () => {
    const status = decode(mutableStruct({ ready: Schema.Boolean }), await request('/auth/status'))
    if (status.ready) {
      setLogin(null)
      setAttempt((value) => value + 1)
    } else setNotice('Complete sign-in, then check again.')
  }
  useEffect(() => {
    const resume = () => {
      if (login) void act(checkLogin)
    }
    window.addEventListener('focus', resume)
    return () => window.removeEventListener('focus', resume)
  })
  const title = content?.kind === 'thread' ? content.title : content?.artifact.title
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="https://dovo.studio" rel="noreferrer">
          dovo<span className="brand-divider">/</span>
          <span className="brand-product">Share</span>
        </a>
        <div className="artifact-title">
          <h1>{title ?? 'Encrypted sharing'}</h1>
          <Badge>End-to-end encrypted</Badge>
        </div>
      </header>
      <main className={content?.kind === 'artifact' ? 'artifact-workspace' : 'shared-conversation'}>
        {error && (
          <p role="alert" className="status-message error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="status-message">
            {notice}
          </p>
        )}
        {!content && (
          <section className="sharing-empty">
            <h1>Shared with you</h1>
            <p>
              Open the complete invitation link to decrypt the content. Private invitations also
              require the invited account.
            </p>
            {!id && <p>Publish and manage encrypted threads and artifacts in Dovo Studio.</p>}
            {!!id && (
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const value = decode(
                      mutableStruct({
                        code: Schema.String,
                        url: Schema.String,
                        expiresAt: Schema.Number,
                      }),
                      await request('/auth/start', 'POST', {}),
                    )
                    const destination = new URL(value.url)
                    if (!['http:', 'https:'].includes(destination.protocol))
                      throw new Error('Invalid sign-in destination')
                    setLogin(value)
                  })
                }
              >
                Sign in for private access
              </Button>
            )}
            {login && (
              <>
                <p>
                  Compare sign-in code: <code>{login.code}</code>
                </p>
                <a href={login.url} target="_blank" rel="noreferrer">
                  Continue sign-in
                </a>
                <Button disabled={busy} onClick={() => void act(checkLogin)}>
                  Check sign-in
                </Button>
              </>
            )}
          </section>
        )}
        {content && view && (
          <p className="sharing-meta">
            {view.paused ? 'Updates paused' : 'Automatic updates enabled'} · Last published{' '}
            {new Date(view.updatedAt).toLocaleString()}
          </p>
        )}
        {content?.kind === 'artifact' && <Artifact content={content} />}
        {content?.kind === 'thread' && (
          <>
            <div className="sharing-messages">
              {content.messages.map((message) => (
                <article className="sharing-message" key={message.id}>
                  <p className="sharing-speaker">{message.role === 'user' ? 'User' : 'Agent'}</p>
                  <div className="sharing-message-text">
                    <Markdown text={message.text} />
                  </div>
                </article>
              ))}
            </div>
            <section className="sharing-suggestion">
              <h2>Suggest a next prompt</h2>
              <p>
                Only the thread owner can read your suggestion. They choose whether to send it to
                the agent.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void act(async () => {
                    if (!keys || !view)
                      throw new Error('Reload this thread before suggesting a prompt')
                    await request(
                      path + '/suggestions?access=' + encodeURIComponent(access),
                      'POST',
                      encryptSuggestion(
                        {
                          shareId: id,
                          revision: view.packet.revision,
                          name: name.trim(),
                          text: text.trim(),
                        },
                        keys.suggestionKey,
                      ),
                    )
                    setText('')
                    setNotice('Suggestion sent to the owner.')
                  })
                }}
              >
                <label>
                  Your name (optional)
                  <Input
                    value={name}
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label>
                  Suggested prompt
                  <Textarea
                    required
                    maxLength={12000}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={5}
                  />
                </label>
                <Button type="submit" disabled={busy || !text.trim()}>
                  {busy ? 'Sending…' : 'Send suggestion'}
                </Button>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
const root = document.getElementById('app')
if (!root) throw new Error('Page unavailable')
createRoot(root).render(<App />)
