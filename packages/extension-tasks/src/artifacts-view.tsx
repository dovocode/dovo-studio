import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import {
  artifactFormatLabels,
  artifactLabel,
  artifactLibrarySchema,
  runtimeComputerName,
  type ArtifactLibraryEntry,
  type RuntimeProfile,
  type RuntimeSnapshot,
} from '@dovo/protocol'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { useWorkspace, WorkspaceScope } from '@dovo/studio-core'
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  SidebarHeader,
  cn,
  useLeftSidebar,
} from '@dovo/studio-ui'
import {
  ArrowLeft,
  ArrowUpRight,
  Layers,
  LoaderCircle,
  RotateCw,
  Search,
  WifiOff,
} from 'lucide-react'
import { ArtifactSnapshot } from './chat/artifact-snapshot'
import { ArtifactLibraryActions } from './chat/artifact-library-actions'
import { ArtifactBrowser } from './chat/artifacts'
import { ArtifactIcon } from './chat/artifact-presentation'
import { ArtifactSharedBadge } from './chat/artifact-shared-badge'
import {
  artifactLibraryMemory,
  artifactOwnerKey,
  createRequestGuard,
  loadArtifactSource,
  saveArtifacts,
  type ArtifactOwnerKey,
  type ArtifactSourceState,
} from './artifact-library'

type Source = {
  profile: RuntimeProfile
  owner: ArtifactOwnerKey
  computerName: string
  icon: RuntimeSnapshot['runtimeIcon']
  connected: boolean
}
type Entry = { source: Source; artifact: ArtifactLibraryEntry }
type ThreadStateFilter = 'all' | ArtifactLibraryEntry['threadState']
type FormatFilter = 'all' | ArtifactLibraryEntry['format']
type Selection = { owner: ArtifactOwnerKey; taskId: string; artifactId: string }
const threadStates: ReadonlyArray<{ value: ThreadStateFilter; label: string }> = [
  { value: 'all', label: 'All threads' },
  { value: 'active', label: 'Active' },
  { value: 'settled', label: 'Settled' },
  { value: 'archived', label: 'Archived' },
]
const formats = ['all', 'markdown', 'html', 'svg', 'code'] as const satisfies FormatFilter[]
/** Section navigation unmounts this page; keep its small list position, not its views. */
const remembered: {
  search: string
  state: ThreadStateFilter
  format: FormatFilter
  selection: Selection | null
} = { search: '', state: 'all', format: 'all', selection: null }
const sameArtifact = (a: ArtifactLibraryEntry, b: Pick<ArtifactLibraryEntry, 'taskId' | 'id'>) =>
  a.taskId === b.taskId && a.id === b.id
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const savedTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export default function ArtifactsView() {
  const { runtimes, readRuntime, runtimeReadCache } = useWorkspace()
  const [sidebarVisible] = useLeftSidebar()
  const [search, setSearch] = useState(remembered.search)
  const [state, setState] = useState(remembered.state)
  const [format, setFormat] = useState(remembered.format)
  const [selection, setSelection] = useState(remembered.selection)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    Object.assign(remembered, { search, state, format, selection })
  }, [search, state, format, selection])
  const sources: Source[] = runtimes
    .filter((runtime) => runtime.snapshot?.artifactsEnabled)
    .map((runtime) => ({
      profile: runtime.profile,
      owner: artifactOwnerKey(runtime.profile),
      computerName: runtimeComputerName(runtime),
      icon: runtime.snapshot?.runtimeIcon,
      connected: runtime.connected,
    }))
  const [states, setStates] = useState<ReadonlyMap<ArtifactOwnerKey, ArtifactSourceState>>(
    () =>
      new Map(
        sources.flatMap((source) => {
          const saved = artifactLibraryMemory.recall(source.owner)
          return saved
            ? [[source.owner, { status: source.connected ? 'loading' : 'offline', saved }] as const]
            : []
        }),
      ),
  )
  const [guard] = useState(createRequestGuard)
  const started = useRef(new Map<ArtifactOwnerKey, string>())
  // Snapshot text updates must not refetch every artifact list while an agent is running.
  const identity = JSON.stringify(sources.map((source) => [source.owner, source.connected]))
  const start = useEffectEvent(() => {
    const owners = new Set(runtimes.map((runtime) => artifactOwnerKey(runtime.profile)))
    artifactLibraryMemory.retain(owners)
    guard.retain(owners)
    for (const owner of started.current.keys())
      if (!owners.has(owner)) started.current.delete(owner)
    // Each computer settles on its own, so one slow or offline host never holds back the others.
    for (const source of sources) {
      const signature = `${source.connected}:${reload}`
      if (started.current.get(source.owner) === signature) continue
      started.current.set(source.owner, signature)
      const current = guard.begin(source.owner)
      const publish = (next: ArtifactSourceState) =>
        setStates((previous) => new Map(previous).set(source.owner, next))
      setStates((previous) =>
        new Map(previous).set(source.owner, {
          status: source.connected ? 'loading' : 'offline',
          saved:
            previous.get(source.owner)?.saved ?? artifactLibraryMemory.recall(source.owner) ?? null,
        }),
      )
      void loadArtifactSource({
        owner: source.owner,
        connected: source.connected,
        read: () =>
          readRuntime(source.profile, '/api/artifacts/library', {}, artifactLibrarySchema),
        cache: () => runtimeReadCache(source.profile),
        current,
      }).then((next) => {
        if (current()) publish(next)
      })
    }
  })
  useEffect(() => start(), [identity, reload])
  useEffect(
    () => () => {
      guard.cancel()
      started.current.clear()
    },
    [guard],
  )
  const stateOf = (source: Source) => states.get(source.owner)
  const loading = sources.some((source) => (stateOf(source)?.status ?? 'loading') === 'loading')
  const offline = sources.flatMap((source) => {
    const current = stateOf(source)
    return current?.status === 'offline' ? [{ source, saved: current.saved }] : []
  })
  const failed = sources.flatMap((source) => {
    const current = stateOf(source)
    return current?.status === 'failed' ? [{ source, current }] : []
  })
  const entries: Entry[] = sources.flatMap((source) =>
    (stateOf(source)?.saved?.artifacts ?? []).map((artifact) => ({ source, artifact })),
  )
  const query = search.trim().toLowerCase()
  const matching = entries.filter(
    ({ source, artifact }) =>
      (state === 'all' || artifact.threadState === state) &&
      `${artifact.title} ${artifact.threadTitle} ${source.computerName} ${artifact.format} ${artifactLabel(artifact)} ${artifact.language ?? ''}`
        .toLowerCase()
        .includes(query),
  )
  const visible = matching
    .filter(({ artifact }) => format === 'all' || artifact.format === format)
    .sort((a, b) => Date.parse(b.artifact.updatedAt) - Date.parse(a.artifact.updatedAt))
  const filtered = !!query || state !== 'all' || format !== 'all'
  const selected =
    selection &&
    entries.find(
      ({ source, artifact }) =>
        source.owner === selection.owner &&
        sameArtifact(artifact, { taskId: selection.taskId, id: selection.artifactId }),
    )
  const selectedSource = selection && sources.find((source) => source.owner === selection.owner)
  const back = () => setSelection(null)
  const open = ({ source, artifact }: Entry) =>
    setSelection({ owner: source.owner, taskId: artifact.taskId, artifactId: artifact.id })
  const removed = ({ source, artifact }: Entry) => {
    const saved = stateOf(source)?.saved
    if (saved) {
      const artifacts = saved.artifacts.filter((item) => !sameArtifact(item, artifact))
      artifactLibraryMemory.remember(source.owner, { ...saved, artifacts })
      void saveArtifacts(() => runtimeReadCache(source.profile), artifacts)
    }
    setStates((previous) => {
      const current = previous.get(source.owner)
      return current?.saved
        ? new Map(previous).set(source.owner, {
            ...current,
            saved: {
              ...current.saved,
              artifacts: current.saved.artifacts.filter((item) => !sameArtifact(item, artifact)),
            },
          })
        : previous
    })
    if (
      selection?.owner === source.owner &&
      sameArtifact(artifact, { taskId: selection.taskId, id: selection.artifactId })
    )
      setSelection(null)
  }
  const backButton = (
    <IconButton label="Back to artifacts" className="size-8" onClick={back}>
      <ArrowLeft className="size-4" />
    </IconButton>
  )
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="All artifacts">
      {!selection && (
        <PageHeader
          title="Your artifacts"
          description="A home for the things you create with your agents."
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
          >
            <RotateCw className={cn('size-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </PageHeader>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <nav
          aria-label="Artifact library"
          style={selection && !sidebarVisible ? { display: 'none' } : undefined}
          className={cn(
            'studio-side-panel min-h-0 min-w-0 flex-col',
            selection ? 'hidden w-80 shrink-0 border-r lg:flex' : 'flex flex-1',
          )}
        >
          <SidebarHeader enabled={!!selection} />
          <div className="min-h-0 flex-1 overflow-auto">
            <div
              className={cn(
                'flex flex-col',
                selection ? 'p-3' : 'mx-auto min-h-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10',
              )}
            >
              <div className={cn('flex flex-wrap items-center gap-3', selection ? 'mb-3' : 'mb-5')}>
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
                  onChange={(event) =>
                    setState(
                      threadStates.find((item) => item.value === event.target.value)?.value ??
                        'all',
                    )
                  }
                >
                  {threadStates.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div
                className={cn('flex flex-wrap items-center gap-1.5', selection ? 'mb-3' : 'mb-6')}
                aria-label="Artifact formats"
              >
                {formats.map((value) => (
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
                        matching.filter(
                          ({ artifact }) => value === 'all' || artifact.format === value,
                        ).length
                      }
                    </span>
                  </Button>
                ))}
              </div>
              {failed.map(({ source, current }) => (
                <p
                  key={source.owner}
                  role="alert"
                  className="mb-3 break-words rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive"
                >
                  {source.computerName}: {current.error}
                  {current.saved && ` Showing artifacts saved ${savedTime(current.saved.savedAt)}.`}
                </p>
              ))}
              {offline.map(({ source, saved }) => (
                <p
                  key={source.owner}
                  role="status"
                  className="mb-3 flex items-start gap-2 rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground"
                >
                  <WifiOff aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  <span>
                    {source.computerName} is offline.{' '}
                    {saved
                      ? `Showing artifacts saved ${savedTime(saved.savedAt)}.`
                      : 'Its artifacts will appear when it reconnects.'}
                  </span>
                </p>
              ))}
              {loading && !entries.length && (
                <div
                  role="status"
                  className="flex flex-1 items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
                >
                  <LoaderCircle className="size-4 animate-spin" />
                  Loading artifacts…
                </div>
              )}
              {!(loading && !entries.length) && !visible.length && (
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
                  {visible.length} {visible.length === 1 ? 'artifact' : 'artifacts'} · Recently
                  updated
                </p>
              )}
              {selection ? (
                <div className="flex flex-col gap-0.5">
                  {visible.map((entry) => {
                    const { source, artifact } = entry
                    const current = selected === entry
                    return (
                      <button
                        key={`${source.owner}:${artifact.taskId}:${artifact.id}`}
                        type="button"
                        aria-label={`Open artifact ${artifact.title}`}
                        aria-current={current ? 'true' : undefined}
                        onClick={() => open(entry)}
                        className={cn(
                          'flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          current && 'bg-accent',
                        )}
                      >
                        <ArtifactIcon
                          format={artifact.format}
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {artifact.title}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {artifact.threadTitle} · {source.computerName}
                            {!source.connected && ' · Offline'}
                          </span>
                        </span>
                        <time
                          dateTime={artifact.updatedAt}
                          className="shrink-0 text-[0.6875rem] text-muted-foreground"
                        >
                          {shortDate(artifact.updatedAt)}
                        </time>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4">
                  {visible.map((entry) => {
                    const { source, artifact } = entry
                    return (
                      <div
                        key={`${source.owner}:${artifact.taskId}:${artifact.id}:${reload}`}
                        className="min-w-0 overflow-hidden rounded-xl border bg-card"
                      >
                        <button
                          type="button"
                          aria-label={`Open artifact ${artifact.title}`}
                          onClick={() => open(entry)}
                          className="group flex w-full min-w-0 flex-col overflow-hidden text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {source.connected ? (
                            <ArtifactSnapshot profile={source.profile} artifact={artifact} />
                          ) : (
                            <div
                              aria-hidden="true"
                              className="flex h-36 items-center justify-center border-b bg-muted/30 text-muted-foreground"
                            >
                              <ArtifactIcon format={artifact.format} className="size-6" />
                            </div>
                          )}
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
                                {artifactLabel(artifact)} · v{artifact.revision}
                              </span>
                              <time dateTime={artifact.updatedAt}>
                                {shortDate(artifact.updatedAt)}
                              </time>
                            </div>
                            <div className="flex items-center justify-between gap-2 border-t pt-3 text-[0.6875rem] text-muted-foreground">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <RuntimeIcon
                                  icon={source.icon}
                                  aria-hidden="true"
                                  className="size-3 shrink-0"
                                />
                                <span className="truncate">
                                  {source.computerName}
                                  {!source.connected && ' · Offline'}
                                </span>
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
                            <ArtifactSharedBadge artifact={artifact} />
                          </div>
                        </button>
                        <ArtifactLibraryActions
                          profile={source.profile}
                          artifact={artifact}
                          onDeleted={() => removed(entry)}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </nav>
        {selection && (
          <div className="min-h-0 min-w-0 flex-1">
            {selected ? (
              <ArtifactDetail
                entry={selected}
                back={backButton}
                onDeleted={() => removed(selected)}
              />
            ) : (
              <section className="flex h-full min-h-0 flex-col">
                <PageHeader
                  title={
                    selectedSource && stateOf(selectedSource)?.status === 'loading'
                      ? 'Opening artifact…'
                      : 'Artifact unavailable'
                  }
                  leading={backButton}
                />
                {selectedSource && stateOf(selectedSource)?.status === 'loading' ? (
                  <div
                    role="status"
                    className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
                  >
                    <LoaderCircle className="size-4 animate-spin" />
                    Loading artifacts…
                  </div>
                ) : (
                  <EmptyState
                    icon={<Layers />}
                    title="Artifact unavailable"
                    description="It may have been deleted, or its computer was removed or paired again."
                    action={<Button onClick={back}>Back to artifacts</Button>}
                  />
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** The library's detail reuses the thread viewer; its Expand control keeps the modal preview. */
function ArtifactDetail({
  entry: { source, artifact },
  back,
  onDeleted,
}: {
  entry: Entry
  back: ReactNode
  onDeleted: () => void
}) {
  return (
    <section aria-label="Artifact details" className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title={artifact.title}
        description={
          <>
            <RuntimeIcon icon={source.icon} aria-hidden="true" className="size-3 shrink-0" />
            {source.computerName} · {artifact.threadTitle}
            {!source.connected && ' · Offline'}
          </>
        }
        leading={back}
      />
      <div className="min-h-0 flex-1">
        {source.connected ? (
          <WorkspaceScope profile={source.profile}>
            <ArtifactBrowser
              key={`${source.owner}:${artifact.taskId}:${artifact.id}`}
              embedded
              taskId={artifact.taskId}
              initialId={artifact.id}
            />
          </WorkspaceScope>
        ) : (
          <EmptyState
            icon={<WifiOff />}
            title={`${source.computerName} is offline`}
            description={`Reconnect it to open this ${artifact.fileCount ? 'folder' : artifactFormatLabels[artifact.format].toLowerCase()}. Version ${artifact.revision} was last updated ${shortDate(artifact.updatedAt)}.`}
          />
        )}
      </div>
      <ArtifactLibraryActions profile={source.profile} artifact={artifact} onDeleted={onDeleted} />
    </section>
  )
}
