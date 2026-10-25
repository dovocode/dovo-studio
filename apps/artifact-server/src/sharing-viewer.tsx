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
import {
  Button,
  Input,
  Textarea,
  Badge,
  Message,
  MessageContent,
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@dovo/web-ui'

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
      return <code data-streamdown="inline-code">{node.value}</code>
    case 'heading':
      switch (node.depth) {
        case 1:
          return <h1>{children}</h1>
        case 2:
          return <h2>{children}</h2>
        case 3:
          return <h3>{children}</h3>
        case 4:
          return <h4>{children}</h4>
        case 5:
          return <h5>{children}</h5>
        case 6:
          return <h6>{children}</h6>
      }
    case 'strong':
      return <strong>{children}</strong>
    case 'emphasis':
      return <em>{children}</em>
    case 'delete':
      return <del>{children}</del>
    case 'code':
      return (
        <div data-streamdown="code-block">
          <div data-streamdown="code-block-header">{node.lang ?? 'text'}</div>
          <div data-streamdown="code-block-body">
            <pre tabIndex={0} aria-label="Code block">
              <code>{node.value}</code>
            </pre>
          </div>
        </div>
      )
    case 'inlineCode':
      return <code data-streamdown="inline-code">{node.value}</code>
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
        <div className="sharing-table" data-streamdown="table-wrapper">
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
  const threadTurns = useMemo(() => {
    const turns: Extract<SharedContent, { kind: 'thread' }>['messages'][] = []
    if (content?.kind !== 'thread') return turns
    for (const message of content.messages) {
      if (message.role === 'user' || !turns.length) turns.push([])
      turns[turns.length - 1]!.push(message)
    }
    return turns
  }, [content])
  const title = content?.kind === 'thread' ? content.title : content?.artifact.title
  return (
    <div className={content?.kind === 'thread' ? 'app-shell shared-thread-shell' : 'app-shell'}>
      <header className="site-header">
        <a className="brand" href="https://dovo.studio" rel="noreferrer">
          dovo<span className="brand-divider">/</span>
          <span className="brand-product">Share</span>
        </a>
        <div className="artifact-title">
          <h1>{title ?? 'Encrypted sharing'}</h1>
          <Badge variant="outline" className="sharing-encryption">
            End-to-end encrypted
          </Badge>
        </div>
      </header>
      <main
        className={
          content?.kind === 'artifact'
            ? 'artifact-workspace'
            : content?.kind === 'thread'
              ? 'shared-thread-workspace'
              : 'shared-conversation'
        }
      >
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
        {content?.kind === 'artifact' && view && (
          <p className="sharing-meta">
            {view.paused ? 'Updates paused' : 'Automatic updates enabled'} · Last published{' '}
            {new Date(view.updatedAt).toLocaleString()}
          </p>
        )}
        {content?.kind === 'artifact' && <Artifact content={content} />}
        {content?.kind === 'thread' && (
          <>
            <Conversation className="min-h-0" aria-label="Shared thread messages" aria-live="off">
              <ConversationContent className="sharing-messages mx-auto w-full max-w-[48rem] gap-5 px-4 py-4 md:pl-16 md:pr-5">
                {threadTurns.map((messages) => (
                  <div
                    className="studio-chat-turn flex min-w-0 flex-col gap-3"
                    key={messages[0]!.id}
                  >
                    {messages.map((message) => (
                      <Message
                        from={message.role}
                        key={message.id}
                        data-message-id={message.id}
                        aria-label={message.role === 'user' ? 'User message' : 'Agent message'}
                      >
                        <div className="group/message flex min-w-0 flex-col gap-2">
                          <MessageContent>
                            <div className="studio-markdown sharing-message-text min-w-0 max-w-full">
                              <Markdown text={message.text} />
                            </div>
                          </MessageContent>
                          {message.createdAt && (
                            <time
                              dateTime={message.createdAt}
                              className="sharing-message-time text-[0.625rem] text-muted-foreground group-[.is-user]:ml-auto"
                            >
                              {new Date(message.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </time>
                          )}
                        </div>
                      </Message>
                    ))}
                  </div>
                ))}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
            <section className="sharing-suggestion" aria-labelledby="suggestion-heading">
              <div className="sharing-composer">
                <h2 id="suggestion-heading">Suggest a next prompt</h2>
                <p className="sharing-composer-hint" id="suggestion-hint">
                  Only the owner can read and send your suggestion to the agent.
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
                    <span className="sr-only">Suggested prompt</span>
                    <Textarea
                      aria-label="Suggested prompt"
                      required
                      maxLength={12000}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      rows={2}
                      placeholder="Suggest a next prompt…"
                      aria-describedby="suggestion-hint"
                    />
                  </label>
                  <div className="sharing-composer-actions">
                    <label className="sharing-name">
                      <span className="sr-only">Your name (optional)</span>
                      <Input
                        aria-label="Your name (optional)"
                        placeholder="Your name (optional)"
                        value={name}
                        maxLength={100}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <Button type="submit" disabled={busy || !text.trim()}>
                      {busy ? 'Sending…' : 'Send suggestion'}
                    </Button>
                  </div>
                </form>
                {view && (
                  <p className="sharing-meta" role="status">
                    {view.paused ? 'Updates paused' : 'Automatic updates enabled'} · Last published{' '}
                    {new Date(view.updatedAt).toLocaleString()}
                  </p>
                )}
              </div>
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
