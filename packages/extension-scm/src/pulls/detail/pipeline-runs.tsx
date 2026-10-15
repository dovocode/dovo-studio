import { useVerifiedRead } from '../../connections/verified-read'
import { useApplicationState } from '@dovo/studio-core/state'
import { useCallback, useEffect, useRef } from 'react'
import { ChevronRight, ExternalLink, RefreshCw } from 'lucide-react'
import {
  forgePipelinePageSchema,
  forgeWorkOptionsSchema,
  useWorkspace,
  type ForgePipeline,
  formatDateTime,
} from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { PipelineState } from '../../work/pipeline-detail'
import { WorkContent } from '../../work/content'
import { createPullStateCache, useRetainedPullState, usePullStateKey } from '../retained-state'
const selectedRunCache = createPullStateCache<Pick<ForgePipeline, 'id' | 'url'> | null>(30)
export function PullPipelineRuns({
  repositoryId,
  sha,
  active = true,
}: {
  repositoryId: string
  sha: string
  active?: boolean
}) {
  const { connected, request, workspace, readCache } = useWorkspace()
  const readRequest = useVerifiedRead({ repositoryId })
  const repository = workspace.repositories.find((repo) => repo.id === repositoryId)
  const ownerKey = usePullStateKey(repositoryId, 0)
  const cacheKey = JSON.stringify([
    'pull-pipelines',
    ownerKey,
    repositoryId,
    repository?.path,
    repository?.forge,
    sha,
  ])
  const [runs, setRuns] = useApplicationState<ForgePipeline[]>([])
  const [next, setNext] = useApplicationState<string | undefined>(undefined)
  const [selected, setSelected] = useRetainedPullState(selectedRunCache, cacheKey, null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [notice, setNotice] = useApplicationState('')
  const [stale, setStale] = useApplicationState(false)
  const generation = useRef(0)
  const pending = useRef(false)
  const stored = useRef<ForgePipeline[]>([])
  const load = useCallback(
    async (cursor?: string, refresh = false) => {
      if (
        !active ||
        !connected ||
        document.visibilityState !== 'visible' ||
        pending.current ||
        !sha
      )
        return
      pending.current = true
      const current = generation.current
      setBusy(true)
      setError('')
      try {
        const options = await readRequest(
          '/api/scm/work/options',
          {
            repositoryId,
            area: 'pipelines',
          },
          forgeWorkOptionsSchema,
        )
        if (current !== generation.current) return
        setNotice(options.pipelineNotice ?? '')
        if (!options.pipelines) {
          stored.current = []
          setRuns([])
          setNext(undefined)
          setNotice(
            options.pipelineNotice ||
              'This provider does not expose pipeline runs. Open a check below to view its logs.',
          )
          return
        }
        const page = await readRequest(
          '/api/scm/work/pipelines/list',
          {
            repositoryId,
            cursor,
            refresh,
          },
          forgePipelinePageSchema,
        )
        if (current !== generation.current) return
        const matches = page.items.filter((run) => run.sha.toLowerCase() === sha.toLowerCase())
        const items = [
          ...new Map(
            [...(cursor ? stored.current : []), ...matches].map((run) => [run.id, run]),
          ).values(),
        ]
        stored.current = items
        setRuns(items)
        setNext(page.next)
        setStale(!!page.stale)
        setError(page.refreshError ?? '')
        try {
          await readCache?.write(cacheKey, {
            ...page,
            items,
          })
        } catch {
          if (current === generation.current)
            setError('Runs loaded, but could not be saved for offline use.')
        }
      } catch (cause) {
        if (current === generation.current) {
          setError(cause instanceof Error ? cause.message : String(cause))
          setStale(true)
        }
      } finally {
        if (current === generation.current) {
          pending.current = false
          setBusy(false)
        }
      }
    },
    [active, connected, readRequest, repositoryId, sha, readCache, cacheKey],
  )
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    const current = ++generation.current
    pending.current = false
    setBusy(false)
    stored.current = []
    setRuns([])
    setNext(undefined)
    setError('')
    setNotice('')
    void (async () => {
      try {
        const cached = await readCache?.read(cacheKey, forgePipelinePageSchema)
        if (current !== generation.current) return
        if (cached) {
          stored.current = cached.value.items
          setRuns(cached.value.items)
          setNext(cached.value.next)
          setStale(true)
        }
      } catch {
        if (current === generation.current) setError('Saved pipeline runs could not be read.')
      }
      if (current === generation.current) await loadRef.current()
    })()
    return () => {
      generation.current++
    }
  }, [cacheKey, readCache])
  useEffect(() => {
    if (!active || !connected) return
    const refresh = () => void loadRef.current()
    refresh()
    const timer = setInterval(refresh, 10000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [active, connected, cacheKey])
  if (selected)
    return (
      <div className="mb-5 min-w-0 rounded-xl border">
        <WorkContent
          key={selected.id}
          repositoryId={repositoryId}
          repositoryName={repository?.name ?? 'Project'}
          branch={repository?.branch ?? ''}
          collectionHeader={null}
          mode="pipelines"
          preview
          initialSelected={selected.id}
          initialSourceURL={selected.url}
          connected={connected && active}
          request={request}
          onBack={() => setSelected(null)}
        />
      </div>
    )
  return (
    <section aria-label="Pull request pipeline runs" className="mb-5 min-w-0 rounded-xl border">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="mr-auto">
          <h3 className="text-sm font-medium">Pipeline runs</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            For commit <code>{sha.slice(0, 8)}</code>
            {stale || !connected ? ' · Cached' : ''}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected || busy}
          onClick={() => void load(undefined, true)}
        >
          <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh runs
        </Button>
      </div>
      {error && (
        <p role="alert" className="px-4 pt-3 text-xs text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      {notice && <p className="px-4 pt-3 text-xs text-muted-foreground">{notice}</p>}
      {!runs.length && (
        <p role="status" className="p-4 text-xs text-muted-foreground">
          {busy
            ? 'Looking for runs for this commit…'
            : !connected
              ? 'Connect to load pipeline runs.'
              : next
                ? 'No matching runs on the loaded pages. Check older runs below.'
                : 'No pipeline runs found for this commit.'}
        </p>
      )}
      <div className="divide-y">
        {runs.map((run) => (
          <div key={run.id} className="flex min-w-0 items-center gap-2 px-2">
            <button
              type="button"
              className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => setSelected({ id: run.id, url: run.url })}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <PipelineState status={run.status} />
                  <span className="text-xs text-muted-foreground">#{run.number || run.id}</span>
                </div>
                <p className="mt-1 truncate text-sm font-medium">{run.title}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {run.workflow || run.ref} · {formatDateTime(run.updatedAt)}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
            <a
              className="rounded p-2 text-muted-foreground hover:text-foreground"
              href={run.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${run.title} on provider`}
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        ))}
      </div>
      {next && (
        <div className="border-t px-4 py-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !connected}
            onClick={() => void load(next)}
          >
            Check older runs
          </Button>
        </div>
      )}
    </section>
  )
}
