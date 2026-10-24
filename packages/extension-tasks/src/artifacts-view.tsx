import { SearchField } from '@dovo/studio-ui/search-field'
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
import { useWorkspace, useStudioHost, WorkspaceScope } from '@dovo/studio-core'
import {
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  ChoicePicker,
  SidebarHeader,
  cn,
  useLeftSidebar,
} from '@dovo/studio-ui'
import {
  ArrowLeft,
  ArrowUpRight,
  Layers,
  LayoutGrid,
  List,
  LoaderCircle,
  RotateCw,
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
type Sort = 'updated' | 'oldest' | 'title'
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
  sort: Sort
  layout: 'preview' | 'list'
  selection: Selection | null
} = { search: '', state: 'all', format: 'all', sort: 'updated', layout: 'preview', selection: null }
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
  const [sort, setSort] = useState(remembered.sort)
  const [layout, setLayout] = useState(remembered.layout)
  const [selection, setSelection] = useState(remembered.selection)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    Object.assign(remembered, { search, state, format, sort, layout, selection })
  }, [search, state, format, sort, layout, selection])
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
    .sort((a, b) =>
      sort === 'title'
        ? a.artifact.title.localeCompare(b.artifact.title, undefined, { numeric: true })
        : (Date.parse(b.artifact.updatedAt) - Date.parse(a.artifact.updatedAt)) *
          (sort === 'oldest' ? -1 : 1),
    )
  const filtered = !!query || state !== 'all' || format !== 'all'
  const clearFilters = () => {
    setSearch('')
    setFormat('all')
    setState('all')
  }
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
                <SearchField
                  containerClassName="min-w-0 flex-1 basis-48"
                  aria-label="Search artifacts"
                  placeholder="Search artifacts, threads or computers…"
                  value={search}
                  onValueChange={setSearch}
                  className="bg-card"
                />
                <ChoicePicker
                  aria-label="Artifact thread state"
                  className="w-auto max-w-full bg-card"
                  value={state}
                  onValueChange={(value) =>
                    setState(threadStates.find((item) => item.value === value)?.value ?? 'all')
                  }
                >
                  {threadStates.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </ChoicePicker>
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
                      'studio-filter-chip',
                      format === value ? 'text-foreground' : 'text-muted-foreground',
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
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    )
                  }
                />
              )}
              {!!visible.length && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <p role="status" aria-live="polite">
                    {visible.length} {visible.length === 1 ? 'artifact' : 'artifacts'}
                    {filtered && ` of ${entries.length}`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <ChoicePicker
                      aria-label="Sort artifacts"
                      className="w-auto max-w-full bg-card"
                      value={sort}
                      onValueChange={(value) =>
                        setSort(
                          value === 'title' ? 'title' : value === 'oldest' ? 'oldest' : 'updated',
                        )
                      }
                    >
                      <option value="updated">Recently updated</option>
                      <option value="oldest">Oldest updated</option>
                      <option value="title">Title A–Z</option>
                    </ChoicePicker>
                    {!selection && (
                      <div
                        role="group"
                        aria-label="Artifact layout"
                        className="flex rounded-lg bg-muted/40 p-0.5"
                      >
                        <IconButton
                          label="Preview view"
                          aria-pressed={layout === 'preview'}
                          onClick={() => setLayout('preview')}
                          className={cn(
                            'size-8 rounded-md',
                            layout === 'preview' && 'bg-card shadow-sm',
                          )}
                        >
                          <LayoutGrid className="size-4" />
                        </IconButton>
                        <IconButton
                          label="List view"
                          aria-pressed={layout === 'list'}
                          onClick={() => setLayout('list')}
                          className={cn(
                            'size-8 rounded-md',
                            layout === 'list' && 'bg-card shadow-sm',
                          )}
                        >
                          <List className="size-4" />
                        </IconButton>
                      </div>
                    )}
                    {filtered && (
                      <Button variant="ghost" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    )}
                  </div>
                </div>
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
                <div
                  className={cn(
                    'grid',
                    layout === 'preview'
                      ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4'
                      : 'grid-cols-1 gap-2',
                  )}
                >
                  {visible.map((entry) => {
                    const { source, artifact } = entry
                    return (
                      <div
                        key={`${source.owner}:${artifact.taskId}:${artifact.id}`}
                        className={cn(
                          'min-w-0 overflow-hidden rounded-xl border border-border/50 bg-card',
                          layout === 'list' && 'flex flex-wrap items-center',
                        )}
                      >
                        <button
                          type="button"
                          aria-label={`Open artifact ${artifact.title}`}
                          onClick={() => open(entry)}
                          className={cn(
                            'group flex w-full min-w-0 overflow-hidden text-left transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                            layout === 'preview' ? 'flex-col' : 'flex-1 items-center gap-3 p-3',
                          )}
                        >
                          {layout === 'list' ? (
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/40">
                              <ArtifactIcon format={artifact.format} className="size-5" />
                            </span>
                          ) : (
                            <ArtifactSnapshot
                              profile={source.profile}
                              artifact={artifact}
                              connected={source.connected}
                              refreshKey={reload}
                            />
                          )}
                          <div
                            className={cn(
                              'flex min-w-0 flex-1 flex-col',
                              layout === 'preview' ? 'gap-2.5 p-4' : 'gap-1',
                            )}
                          >
                            <div className="flex items-start gap-2">
                              <h2
                                className="min-w-0 flex-1 line-clamp-2 break-words text-sm font-semibold leading-5"
                                title={artifact.title}
                              >
                                {artifact.title}
                              </h2>
                              {layout === 'preview' && (
                                <ArrowUpRight
                                  aria-hidden="true"
                                  className="size-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground"
                                />
                              )}
                            </div>
                            <ArtifactSharedBadge artifact={artifact} />
                            <p
                              className="truncate text-xs text-muted-foreground"
                              title={artifact.threadTitle}
                            >
                              {artifact.threadTitle}
                            </p>
                            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                {layout === 'preview' && (
                                  <ArtifactIcon format={artifact.format} className="size-3.5" />
                                )}
                                {artifactLabel(artifact)} · v{artifact.revision}
                              </span>
                              <time className="shrink-0" dateTime={artifact.updatedAt}>
                                {shortDate(artifact.updatedAt)}
                              </time>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[0.6875rem] text-muted-foreground">
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
                              <span className="shrink-0 capitalize">{artifact.threadState}</span>
                            </div>
                            {artifact.deleteAt && (
                              <p className="text-[0.6875rem] text-destructive">
                                Scheduled deletion: {new Date(artifact.deleteAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </button>
                        <ArtifactLibraryActions
                          profile={source.profile}
                          artifact={artifact}
                          compact={layout === 'list'}
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
                key={JSON.stringify([
                  selected.source.owner,
                  selected.artifact.taskId,
                  selected.artifact.id,
                ])}
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
  const { switchRuntime } = useWorkspace()
  const host = useStudioHost()
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const sourceKey = `${source.owner}:${artifact.taskId}:${artifact.id}`
  const activeSource = useRef(sourceKey)
  activeSource.current = sourceKey
  const attempt = useRef(0)
  useEffect(
    () => () => {
      attempt.current++
    },
    [],
  )
  const openSource = async () => {
    const openingAttempt = ++attempt.current
    const navigationCurrent = host.taskNavigationGuard?.() ?? (() => true)
    const current = () =>
      openingAttempt === attempt.current &&
      activeSource.current === sourceKey &&
      navigationCurrent()
    setOpening(true)
    setError('')
    try {
      await switchRuntime(source.profile.id)
      if (current()) host.navigate({ viewId: 'tasks', entityId: artifact.taskId })
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (openingAttempt === attempt.current) setOpening(false)
    }
  }
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
      >
        <Button variant="outline" size="sm" disabled={opening} onClick={() => void openSource()}>
          Open source thread
        </Button>
      </PageHeader>
      {error && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
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
