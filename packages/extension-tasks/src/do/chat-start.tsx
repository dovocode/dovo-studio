import { useEffect, useRef, useState } from 'react'
import {
  DO_CHAT_LIMITS,
  doChatCreateReplySchema,
  doDiscoverReplySchema,
  type DoChatCreateRequest,
  type DoDiscoverReply,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import {
  Button,
  ComposerSurface,
  ComposerTextarea,
  ComposerSubmit,
  PageHeader,
} from '@dovo/studio-ui'
import { MessageCircle } from 'lucide-react'
import { doChatRequest } from './chat-request'

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
const select =
  'max-w-56 min-w-0 rounded-md border-0 bg-transparent px-2 py-1.5 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

export function DoChat({ profile, onPlans }: { profile: RuntimeProfile; onPlans: () => void }) {
  const { readRuntime, refreshRuntime } = useWorkspace()
  const host = useStudioHost()
  const [text, setText] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [catalog, setCatalog] = useState<DoDiscoverReply | null>(null)
  const [loading, setLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const locked = useRef(false)
  const attempt = useRef<DoChatCreateRequest | null>(null)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    let current = true
    setLoading(true)
    setCatalogError('')
    void readRuntime(
      profile,
      '/api/do/discover',
      repositoryId ? { repositoryId } : {},
      doDiscoverReplySchema,
    )
      .then((reply) => {
        if (current) setCatalog(reply)
      })
      .catch((cause: unknown) => {
        if (current) setCatalogError(message(cause))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [profile, repositoryId, readRuntime, reload])

  const unavailableProject =
    !!repositoryId && !catalog?.projects.some((item) => item.id === repositoryId)
  const unavailableAgent = !!agentId && !catalog?.agents.some((item) => item.id === agentId)
  const canSend =
    !!text.trim() &&
    !loading &&
    !!catalog &&
    !catalogError &&
    !unavailableProject &&
    !unavailableAgent
  const send = async () => {
    if (locked.current || !canSend) return
    locked.current = true
    setBusy(true)
    setError('')
    const current = host.taskNavigationGuard?.() ?? (() => alive.current)
    const input = doChatRequest(attempt.current, {
      text: text.trim(),
      ...(repositoryId ? { repositoryId } : {}),
      ...(agentId ? { agentId } : {}),
    })
    attempt.current = input
    try {
      const reply = await readRuntime(
        profile,
        '/api/do/chat/create',
        input,
        doChatCreateReplySchema,
        'POST',
      )
      if (!alive.current || !current()) return
      // Tasks selects from the owning runtime's snapshot. Install the persisted thread first.
      await refreshRuntime(profile)
      if (alive.current && current()) host.navigate({ viewId: 'tasks', entityId: reply.taskId })
    } catch (cause) {
      if (alive.current) setError(message(cause))
    } finally {
      if (alive.current) {
        locked.current = false
        setBusy(false)
      }
    }
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Do workspace">
      <PageHeader title="Do" description="Experimental · Start with a conversation.">
        <Button variant="outline" size="sm" disabled={busy} onClick={onPlans}>
          Review plans
        </Button>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-8">
        <div className="mx-auto my-auto w-full max-w-3xl space-y-7 py-8">
          <div className="space-y-3 text-center">
            <MessageCircle className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              What would you like to do?
            </h2>
            <p className="mx-auto max-w-lg text-sm leading-6 text-muted-foreground">
              Talk through a goal, ask questions, and review proposals before starting a plan.
            </p>
          </div>
          <ComposerSurface
            aria-label="Start a Do conversation"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
            error={error}
            controls={
              <>
                <label className="min-w-0">
                  <span className="sr-only">Project context</span>
                  <select
                    className={select}
                    value={repositoryId}
                    disabled={busy || loading || !catalog}
                    onChange={(event) => {
                      setRepositoryId(event.target.value)
                      setAgentId('')
                      setError('')
                    }}
                  >
                    <option value="">
                      {loading && !catalog ? 'Loading projects…' : 'No project'}
                    </option>
                    {repositoryId && unavailableProject && (
                      <option value={repositoryId}>{repositoryId} (unavailable)</option>
                    )}
                    {catalog?.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0">
                  <span className="sr-only">Agent</span>
                  <select
                    className={select}
                    value={agentId}
                    disabled={busy || loading || !catalog || !!catalogError}
                    onChange={(event) => {
                      setAgentId(event.target.value)
                      setError('')
                    }}
                  >
                    <option value="">{loading ? 'Loading agents…' : 'Default agent'}</option>
                    {agentId && unavailableAgent && (
                      <option value={agentId}>{agentId} (unavailable)</option>
                    )}
                    {catalog?.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} · {agent.provider}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            }
            actions={
              <ComposerSubmit aria-label="Send message" busy={busy} disabled={busy || !canSend} />
            }
          >
            <ComposerTextarea
              aria-label="Message Do"
              placeholder="Describe your goal or ask a question…"
              maxLength={DO_CHAT_LIMITS.message}
              value={text}
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value)
                setError('')
              }}
            />
          </ComposerSurface>
          {catalogError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-center gap-2 text-sm text-destructive"
            >
              <span>Could not load projects and agents: {catalogError}</span>
              <Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>
                Retry
              </Button>
            </div>
          )}
          {!loading && !catalogError && (unavailableProject || unavailableAgent) && (
            <p role="alert" className="text-center text-sm text-destructive">
              Choose an available project and agent to continue.
            </p>
          )}
          <p className="text-center text-xs leading-5 text-muted-foreground">
            Continues in Tasks on {profile.name || 'this computer'}. Saved proposals are available
            in Review plans.
          </p>
        </div>
      </div>
    </section>
  )
}
