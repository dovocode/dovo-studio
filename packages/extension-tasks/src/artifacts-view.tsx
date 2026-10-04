import { artifactFormatLabels, runtimeComputerName } from '@dovo/protocol'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import {
  artifactLibrarySchema,
  type ArtifactLibraryEntry,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useWorkspace, WorkspaceScope } from '@dovo/studio-core'
import { Button, EmptyState, Input, cn } from '@dovo/studio-ui'
import { ArrowUpRight, Layers, LoaderCircle, Monitor, RotateCw, Search } from 'lucide-react'
import { ArtifactBrowser } from './chat/artifacts'
import { ArtifactIcon, ArtifactThumbnail } from './chat/artifact-presentation'

type Entry = { profile: RuntimeProfile; computerName: string; artifact: ArtifactLibraryEntry }
export default function ArtifactsView() {
  const { runtimes, readRuntime } = useWorkspace()
  const [loaded, setLoaded] = useState<{ identity: string; entries: Entry[]; errors: string[] }>()
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const [format, setFormat] = useState<ArtifactLibraryEntry['format'] | 'all'>('all')
  const [selected, setSelected] = useState<Entry>()
  const [reload, setReload] = useState(0)
  const sources = useMemo(
    () => runtimes.filter((runtime) => runtime.snapshot?.artifactsEnabled),
    [runtimes],
  )
  // Snapshot text updates must not refetch every artifact list while an agent is running.
  const identity = JSON.stringify(
    sources.map((runtime) => [
      runtime.profile.id,
      runtimeComputerName(runtime),
      runtime.profile.connection.address,
      runtime.profile.connection.token,
      runtime.connected,
    ]),
  )
  const load = useEffectEvent(() =>
    Promise.allSettled(
      sources.map(async (runtime) => {
        if (!runtime.connected) throw new Error(`${runtimeComputerName(runtime)}: offline`)
        const result = await readRuntime(
          runtime.profile,
          '/api/artifacts/library',
          {},
          artifactLibrarySchema,
        )
        return result.artifacts.map((artifact): Entry => ({
          profile: runtime.profile,
          computerName: runtimeComputerName(runtime),
          artifact,
        }))
      }),
    ),
  )
  useEffect(() => {
    let disposed = false
    setLoading(true)
    void load().then((results) => {
      if (disposed) return
      setLoaded({
        identity,
        entries: results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
        errors: results.flatMap((result) =>
          result.status === 'rejected' ? [String(result.reason)] : [],
        ),
      })
      setLoading(false)
    })
    return () => {
      disposed = true
    }
  }, [identity, reload])
  const entries = loaded?.identity === identity ? loaded.entries : []
  const errors = loaded?.identity === identity ? loaded.errors : []
  const query = search.trim().toLowerCase()
  const matching = entries.filter(
    ({ computerName, artifact }) =>
      (state === 'all' || artifact.threadState === state) &&
      `${artifact.title} ${artifact.threadTitle} ${computerName} ${artifact.format} ${artifactFormatLabels[artifact.format]} ${artifact.language ?? ''}`
        .toLowerCase()
        .includes(query),
  )
  const visible = matching
    .filter(({ artifact }) => format === 'all' || artifact.format === format)
    .sort((a, b) => Date.parse(b.artifact.updatedAt) - Date.parse(a.artifact.updatedAt))
  const filtered = !!query || state !== 'all' || format !== 'all'
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="All artifacts">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex min-h-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-10">
          <header className="mb-7 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex size-11 items-center justify-center rounded-xl border bg-card">
                <Layers className="size-5 text-muted-foreground" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">Your artifacts</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                A home for the things you create with your agents.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReload((value) => value + 1)}
              disabled={loading}
            >
              <RotateCw className={cn('size-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
          </header>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-48 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search artifacts"
                placeholder="Search artifacts, threads or computers…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 rounded-lg bg-card pl-9"
              />
            </div>
            <select
              aria-label="Artifact thread state"
              className="h-10 rounded-lg border bg-card px-3 text-sm"
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="all">All threads</option>
              <option value="active">Active</option>
              <option value="settled">Settled</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="mb-6 flex flex-wrap items-center gap-1.5" aria-label="Artifact formats">
            {(['all', 'markdown', 'html', 'svg', 'code'] as const).map((value) => (
              <Button
                key={value}
                aria-label={value === 'all' ? 'All formats' : artifactFormatLabels[value]}
                variant="ghost"
                size="sm"
                aria-pressed={format === value}
                onClick={() => setFormat(value)}
                className={cn(
                  'rounded-full px-3',
                  format === value ? 'bg-accent text-foreground' : 'text-muted-foreground',
                )}
              >
                {value === 'all' ? 'All' : artifactFormatLabels[value]}
                <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                  {
                    matching.filter(({ artifact }) => value === 'all' || artifact.format === value)
                      .length
                  }
                </span>
              </Button>
            ))}
          </div>
          {errors.map((error, index) => (
            <p
              key={index}
              role="alert"
              className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive"
            >
              {error}
            </p>
          ))}
          {loading && !entries.length && (
            <div
              role="status"
              className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              Loading artifacts…
            </div>
          )}
          {!loading && !visible.length && (
            <EmptyState
              icon={<Layers />}
              title={filtered ? 'No matching artifacts' : 'Your next idea belongs here'}
              description={
                sources.length
                  ? filtered
                    ? 'Try another search or clear your filters.'
                    : 'Ask an agent to create a document, a graphic or an interactive tool. You’ll find it here, across all your threads.'
                  : 'Enable Dovo Artifacts in a computer’s settings to start your collection.'
              }
              action={
                filtered && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setState('all')
                      setFormat('all')
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          )}
          {!!visible.length && (
            <p className="mb-3 text-xs text-muted-foreground">
              {visible.length} {visible.length === 1 ? 'artifact' : 'artifacts'} · Recently updated
            </p>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4">
            {visible.map((entry) => {
              const { profile, computerName, artifact } = entry
              return (
                <button
                  type="button"
                  key={`${profile.id}:${artifact.id}`}
                  aria-label={`Open artifact ${artifact.title}`}
                  onClick={() => setSelected(entry)}
                  className="group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArtifactThumbnail format={artifact.format} />
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex items-start gap-2">
                      <h2
                        className="min-w-0 flex-1 truncate text-sm font-medium"
                        title={artifact.title}
                      >
                        {artifact.title}
                      </h2>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground"
                      />
                    </div>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={artifact.threadTitle}
                    >
                      {artifact.threadTitle}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-2 text-[0.6875rem] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <ArtifactIcon format={artifact.format} className="size-3.5" />
                        {artifactFormatLabels[artifact.format]} · v{artifact.revision}
                      </span>
                      <time dateTime={artifact.updatedAt}>
                        {new Date(artifact.updatedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </time>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t pt-3 text-[0.6875rem] text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Monitor aria-hidden="true" className="size-3 shrink-0" />
                        <span className="truncate">{computerName}</span>
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 capitalize">
                        {artifact.threadState}
                      </span>
                    </div>
                    {artifact.deleteAt && (
                      <p className="text-[0.6875rem] text-destructive">
                        Scheduled deletion: {new Date(artifact.deleteAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      {selected && sources.some((runtime) => runtime.profile.id === selected.profile.id) && (
        <WorkspaceScope profile={selected.profile}>
          <ArtifactBrowser
            key={`${selected.profile.id}:${selected.artifact.taskId}:${selected.artifact.id}`}
            taskId={selected.artifact.taskId}
            initialId={selected.artifact.id}
            onClose={() => setSelected(undefined)}
          />
        </WorkspaceScope>
      )}
    </section>
  )
}
