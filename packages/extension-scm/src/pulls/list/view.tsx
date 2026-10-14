import { uniquePulls, githubPullTarget, type PullSummary } from '@dovo/protocol'
import { AddPullsToThread } from './add-to-thread'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { Plug, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import {
  comparePulls,
  matchesPull,
  pullNeedsAttention,
  useWorkspace,
  useStudioHost,
  WorkspaceRuntimeScope,
  repositorySourceKey,
  type RepositorySource,
} from '@dovo/studio-core'
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  PageHeader,
  SidebarHeader,
  useLeftSidebar,
  ChoicePicker,
} from '@dovo/studio-ui'
import { usePulls } from './use-pulls'
import { PullRow } from './row'
import { PullDetail } from '../detail/detail'
import { CreatePull } from './create'
import { ForgeConnections } from '../../connections/forge-connections'
import { SourcePicker } from '../../connections/source-picker'
import { createPullStateCache, useRetainedPullState } from '../retained-state'
type SavedSelection = { source: Pick<RepositorySource, 'key' | 'scope'>; number: number } | null
const filterCache = createPullStateCache<string>(100)
const flagCache = createPullStateCache<boolean>(40)
const selectionCache = createPullStateCache<SavedSelection>(20)
const urlCache = createPullStateCache<string | null>(60)
const personalCache = createPullStateCache<'all' | 'authored' | 'assigned' | 'involved' | 'review'>(
  20,
)
export default function PullRequestsView({
  entityId,
  navigationKey,
}: {
  entityId?: string
  navigationKey?: number
}) {
  const [sidebarVisible] = useLeftSidebar()
  const host = useStudioHost()
  const { activeRuntimeId, runtimes, connection } = useWorkspace()
  const listKey = JSON.stringify([activeRuntimeId, connection?.address])
  const [repositoryId, setRepository] = useRetainedPullState(
      filterCache,
      listKey + ':repository',
      entityId && !githubPullTarget(entityId)
        ? repositorySourceKey(activeRuntimeId ?? '', entityId)
        : '',
    ),
    [state, setState] = useRetainedPullState(filterCache, listKey + ':state', 'open'),
    [search, setSearch] = useRetainedPullState(filterCache, listKey + ':search', ''),
    [draft, setDraft] = useRetainedPullState(filterCache, listKey + ':draft', 'all'),
    [attention, setAttention] = useRetainedPullState(flagCache, listKey + ':attention', false),
    [sort, setSort] = useRetainedPullState(filterCache, listKey + ':sort', 'updated'),
    [filtersOpen, setFiltersOpen] = useRetainedPullState(
      flagCache,
      listKey + ':filtersOpen',
      false,
    ),
    [personal, setPersonal] = useRetainedPullState(personalCache, listKey, 'all'),
    [picking, setPicking] = useApplicationState<'create' | 'connections' | null>(null),
    [connections, setConnections] = useApplicationState<RepositorySource | null>(null),
    [creating, setCreating] = useApplicationState<RepositorySource | null>(null),
    [openError, setOpenError] = useApplicationState(''),
    [opening, setOpening] = useApplicationState(false),
    [selected, setSelected] = useRetainedPullState(selectionCache, listKey, null)
  const [urlSelection, setUrlSelection] = useRetainedPullState(urlCache, listKey + ':url', null)
  const [urlOwnerId, setUrlOwnerId] = useRetainedPullState(urlCache, listKey + ':owner', null)
  const [selectedNavigation, setSelectedNavigation] = useRetainedPullState(
    urlCache,
    listKey + ':navigation',
    null,
  )
  const detailTarget = githubPullTarget(selectedNavigation ?? urlSelection ?? '')
  const [marked, setMarked] = useApplicationState<string[]>([])
  const [adding, setAdding] = useApplicationState<PullSummary[] | null>(null)
  const selectionAnchor = useRef<string | null>(null)
  const lastTarget = useRef(entityId)
  useEffect(() => {
    if (lastTarget.current === entityId) return
    lastTarget.current = entityId
    if (entityId && !githubPullTarget(entityId)) {
      setRepository(repositorySourceKey(activeRuntimeId ?? '', entityId))
      setSelected(null)
      setUrlSelection(null)
      setSelectedNavigation(null)
      setUrlOwnerId(null)
    }
  }, [entityId, activeRuntimeId])
  const { sources, pages: allPages, busy, connected, more, refresh } = usePulls(state, repositoryId)
  const pages = allPages.filter((page) => !repositoryId || page.source.key === repositoryId)
  const openingRef = useRef(false)
  const localNavigation = useRef<string | null>(null)
  const open = async (source: RepositorySource, number: number) => {
    if (openingRef.current) return
    openingRef.current = true
    setOpening(true)
    setOpenError('')
    try {
      setUrlSelection(null)
      setSelectedNavigation(null)
      setSelected({ source: { key: source.key, scope: source.scope }, number })
      const pull = pages
        .find((page) => page.source.key === source.key)
        ?.pulls.find((pull) => pull.number === number)
      const identity = source.repository.pullIdentity || source.repository.gitIdentity
      const target =
        pull?.url ??
        (identity?.startsWith('github.com/') ? `https://${identity}/pull/${number}` : '')
      const entity = githubPullTarget(target)?.url
      localNavigation.current = entity ?? ''
      handledLink.current = JSON.stringify([entity, navigationKey])
      host.navigate({ viewId: 'pulls', ...(entity ? { entityId: entity } : {}) })
    } catch (error) {
      setOpenError(String(error))
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }
  const selectedSource = sources.find(
    (source) => source.key === selected?.source.key && source.scope === selected.source.scope,
  )
  const creatingSource = sources.find(
    (source) => source.key === creating?.key && source.scope === creating.scope,
  )
  const filteredPulls = uniquePulls(
    pages.flatMap((page) =>
      page.pulls.map((pull) => ({
        ...pull,
        source: page.source,
        repositoryName: page.source.repository.name,
      })),
    ),
  )
    .filter(
      (p) =>
        (state === 'all' || p.state === state) &&
        (draft === 'all' || p.draft === (draft === 'draft')) &&
        (!attention || pullNeedsAttention(p)) &&
        matchesPull(p, `${p.repositoryName} ${p.source.runtimeName}`, search),
    )
    .sort((a, b) => comparePulls(a, b, sort === 'attention'))
  const pulls = filteredPulls.filter(
    (pull) =>
      (personal !== 'authored' || pull.viewerIsAuthor === true) &&
      (personal !== 'review' || pull.viewerReviewRequested === true) &&
      (personal !== 'assigned' || pull.viewerIsAssigned === true) &&
      (personal !== 'involved' || pull.viewerIsInvolved === true),
  )
  const personalField =
    personal === 'authored'
      ? 'viewerIsAuthor'
      : personal === 'assigned'
        ? 'viewerIsAssigned'
        : personal === 'review'
          ? 'viewerReviewRequested'
          : 'viewerIsInvolved'
  const unknownRelationships =
    personal === 'all'
      ? 0
      : pages.flatMap((page) => page.pulls).filter((pull) => pull[personalField] === undefined)
          .length
  const handledLink = useRef('')
  const previousEntity = useRef(entityId)
  useEffect(() => {
    const previous = previousEntity.current
    previousEntity.current = entityId
    if (!entityId) {
      // Shell history can return to the list without using the detail's Back callback.
      if (previous && localNavigation.current !== '') {
        setSelected(null)
        setUrlSelection(null)
        setSelectedNavigation(null)
        setUrlOwnerId(null)
      }
      localNavigation.current = null
      handledLink.current = ''
      return
    }
    const navigation = JSON.stringify([entityId, navigationKey])
    if (localNavigation.current === entityId) {
      localNavigation.current = null
      handledLink.current = navigation
      return
    }
    if (handledLink.current === navigation) return
    const target = githubPullTarget(entityId)
    if (!target) return
    const source = [...sources]
      .sort(
        (a, b) =>
          Number(b.connected) - Number(a.connected) ||
          Number(b.runtimeId === activeRuntimeId) - Number(a.runtimeId === activeRuntimeId),
      )
      .find(
        (source) =>
          (!source.repository.gitIdentityError &&
            source.repository.gitIdentity === target.identity) ||
          source.repository.pullIdentity === target.identity,
      )
    if (!source) {
      handledLink.current = navigation
      setSelected(null)
      setSelectedNavigation(null)
      setUrlSelection(target.navigationUrl)
      setUrlOwnerId(activeRuntimeId ?? runtimes[0]?.profile.id ?? null)
      return
    }
    setUrlSelection(null)
    handledLink.current = navigation
    setOpenError('')
    setSelectedNavigation(target.navigationUrl)
    setSelected({ source: { key: source.key, scope: source.scope }, number: target.number })
  }, [entityId, navigationKey, sources, activeRuntimeId])
  const back = () => {
    handledLink.current = ''
    localNavigation.current = null
    setSelected(null)
    setUrlSelection(null)
    setSelectedNavigation(null)
    setUrlOwnerId(null)
    if (entityId && host.goBack?.()) return
    host.navigate({ viewId: 'pulls' })
  }
  const hasDetail = !!selected || !!urlSelection
  const urlRuntimeId = urlOwnerId ?? activeRuntimeId ?? runtimes[0]?.profile.id
  useEffect(() => {
    if (urlSelection && !urlOwnerId && urlRuntimeId) setUrlOwnerId(urlRuntimeId)
  }, [urlSelection, urlOwnerId, urlRuntimeId])
  const rowKey = (pull: (typeof pulls)[number]) => JSON.stringify([pull.source.key, pull.number])
  const selectRow = (pull: (typeof pulls)[number], event: React.MouseEvent<HTMLButtonElement>) => {
    const key = rowKey(pull)
    if (event.metaKey || event.ctrlKey) {
      setMarked((current) =>
        current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
      )
      selectionAnchor.current = key
    } else if (event.shiftKey && selectionAnchor.current) {
      const start = pulls.findIndex((item) => rowKey(item) === selectionAnchor.current)
      const end = pulls.indexOf(pull)
      if (start >= 0)
        setMarked(pulls.slice(Math.min(start, end), Math.max(start, end) + 1).map(rowKey))
    } else {
      setMarked([])
      selectionAnchor.current = key
      void open(pull.source, pull.number)
    }
  }
  const addSelection = (pull: (typeof pulls)[number]) => {
    const key = rowKey(pull)
    const chosen = marked.includes(key)
      ? pulls.filter((item) => marked.includes(rowKey(item)))
      : [pull]
    setAdding([...new Map(chosen.map((item) => [item.url, item])).values()])
  }
  const selectStyle = 'h-8 w-auto max-w-52 rounded-md border bg-background px-2 text-xs'
  const activeFilters = Number(draft !== 'all') + Number(attention)
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {opening && (
        <p role="status" className="px-5 py-2 text-xs text-muted-foreground">
          Opening on its computer…
        </p>
      )}
      {openError && (
        <p role="alert" className="px-5 py-2 text-xs text-destructive">
          {openError}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <nav
          style={sidebarVisible || (!selected && !urlSelection) ? undefined : { display: 'none' }}
          aria-label="Pull request sidebar"
          className={`@container/pr-list min-h-0 min-w-0 flex-col overflow-hidden ${hasDetail ? 'hidden w-full shrink-0 border-r md:flex md:w-[22rem] lg:w-[26rem]' : 'flex flex-1'}`}
        >
          <SidebarHeader enabled={hasDetail} />
          <PageHeader title="Pull requests" embedded={hasDetail}>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label="Refresh pull requests"
              title="Refresh pull requests"
              disabled={!connected || busy}
              onClick={refresh}
            >
              <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Connections"
              title="Source control connections"
              disabled={!sources.some((source) => source.connected)}
              onClick={() => setPicking('connections')}
            >
              <Plug className="size-3.5" />
              <span className="hidden @xl/pr-list:inline">Connections</span>
            </Button>
            <Button
              size="sm"
              aria-label="Create pull request"
              disabled={!sources.some((source) => source.connected)}
              onClick={() => setPicking('create')}
            >
              <Plus className="size-3.5" /> Create
            </Button>
          </PageHeader>
          <div
            className="min-h-0 max-h-[calc(50%-var(--studio-header-height,52px))] shrink-0 overflow-y-auto overscroll-contain"
            aria-label="Pull request filters"
          >
            <div
              className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 [scrollbar-width:none]"
              aria-label="Personal pull request filters"
            >
              {(
                [
                  { id: 'all', label: 'All PRs', count: filteredPulls.length },
                  {
                    id: 'authored',
                    label: 'Authored by me',
                    count: filteredPulls.filter((pull) => pull.viewerIsAuthor).length,
                  },
                  {
                    id: 'review',
                    label: 'Review requests',
                    count: filteredPulls.filter((pull) => pull.viewerReviewRequested).length,
                  },
                  {
                    id: 'assigned',
                    label: 'Assigned to me',
                    count: filteredPulls.filter((pull) => pull.viewerIsAssigned).length,
                  },
                  {
                    id: 'involved',
                    label: 'Involves me',
                    count: filteredPulls.filter((pull) => pull.viewerIsInvolved).length,
                  },
                ] as const
              ).map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant="ghost"
                  aria-label={item.label}
                  aria-pressed={personal === item.id}
                  title={`${item.count} in loaded, filtered results`}
                  className={`h-10 shrink-0 rounded-none border-b-2 px-2.5 text-xs hover:bg-transparent ${personal === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                  onClick={() => {
                    setPersonal(item.id)
                    setMarked([])
                  }}
                >
                  {item.label}
                  <span
                    aria-hidden
                    className="rounded bg-muted px-1.5 text-[0.625rem] tabular-nums text-muted-foreground"
                  >
                    {item.count}
                  </span>
                </Button>
              ))}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
              <div className="relative min-w-40 flex-1 basis-full @xl/pr-list:basis-40">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
                />
                <Input
                  aria-label="Search pull requests"
                  className="h-8 pl-8 text-xs"
                  placeholder="Search PRs, branches, people…"
                  value={search}
                  onChange={(event) => {
                    setMarked([])
                    setSearch(event.target.value)
                  }}
                />
              </div>
              <ChoicePicker
                aria-label="PR repository"
                className={selectStyle}
                value={repositoryId}
                onValueChange={(selection) => {
                  setMarked([])
                  setRepository(selection)
                  setSelected(null)
                }}
              >
                <option value="">All repositories</option>
                {sources.map((source) => (
                  <option key={source.key} value={source.key}>
                    {source.repository.name} · {source.runtimeName}
                  </option>
                ))}
              </ChoicePicker>
              <ChoicePicker
                aria-label="PR state"
                className={selectStyle}
                value={state}
                onValueChange={(selection) => {
                  setMarked([])
                  setState(selection)
                  setSelected(null)
                }}
              >
                {['open', 'closed', 'merged', 'all'].map((value) => (
                  <option key={value} value={value}>
                    {value === 'all'
                      ? 'All states'
                      : value.charAt(0).toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </ChoicePicker>
              <ChoicePicker
                aria-label="PR sort"
                className={selectStyle}
                value={sort}
                onValueChange={setSort}
              >
                <option value="attention">Attention first</option>
                <option value="updated">Recently updated</option>
              </ChoicePicker>
              <Button
                size="sm"
                variant={activeFilters ? 'secondary' : 'outline'}
                aria-label="Filters"
                aria-expanded={filtersOpen}
                aria-controls="pr-list-filters"
                onClick={() => setFiltersOpen((value) => !value)}
              >
                <SlidersHorizontal className="size-3.5" />
                Filters
                {!!activeFilters && <span className="tabular-nums">{activeFilters}</span>}
              </Button>
            </div>
            <div
              id="pr-list-filters"
              hidden={!filtersOpen}
              className="shrink-0 space-y-3 border-b p-3"
            >
              {!!pulls.length && (
                <div
                  className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
                  aria-label="Visible pull request summary"
                >
                  <span>
                    <strong className="font-medium text-foreground">
                      {pulls.filter(pullNeedsAttention).length}
                    </strong>{' '}
                    need attention
                  </span>
                  <span>
                    <strong className="font-medium text-foreground">
                      {pulls.filter((pull) => pull.state === 'open' && pull.draft).length}
                    </strong>{' '}
                    drafts
                  </span>
                  <span>
                    <strong className="font-medium text-foreground">
                      {
                        pulls.filter((pull) => pull.state === 'open' && pull.viewerReviewRequested)
                          .length
                      }
                    </strong>{' '}
                    awaiting your review
                  </span>
                  <span>In loaded, filtered results</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <ChoicePicker
                  aria-label="PR draft status"
                  className={selectStyle}
                  value={draft}
                  onValueChange={(selection) => {
                    setMarked([])
                    setDraft(selection)
                  }}
                >
                  <option value="all">Draft + ready</option>
                  <option value="draft">Drafts</option>
                  <option value="ready">Ready</option>
                </ChoicePicker>
                <Button
                  size="sm"
                  variant={attention ? 'secondary' : 'ghost'}
                  aria-pressed={attention}
                  title="Your review requests, blocked PRs, and your approved PRs with passing checks"
                  onClick={() => {
                    setMarked([])
                    setAttention((value) => !value)
                  }}
                >
                  Needs attention
                </Button>
                {!!activeFilters && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMarked([])
                      setDraft('all')
                      setAttention(false)
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div
            aria-label="Pull request rows"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
          >
            <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
              {pulls.length} loaded pull request{pulls.length === 1 ? '' : 's'}
              {pages.some((page) => page.hasMore) ? ' · more available' : ''}
            </p>
            {filtersOpen && personal !== 'all' && (
              <p className="mb-3 px-2 text-xs text-muted-foreground">
                Personal filters use each computer’s connected forge account. Involves me includes
                authorship, assignment and review participation where reported. Bitbucket and Azure
                DevOps use reviewers rather than PR assignees.
              </p>
            )}
            {!!unknownRelationships && (
              <p role="status" className="mb-3 px-2 text-xs text-amber-700 dark:text-amber-400">
                Personal relationship data is unavailable for {unknownRelationships} loaded PRs.
                Refresh or update their computer to include them in personal views.
              </p>
            )}
            {!connected && (
              <p className="text-xs text-muted-foreground">
                {pulls.length
                  ? 'Offline · showing saved pull requests.'
                  : 'Connect to the runtime to load pull requests.'}
              </p>
            )}
            {connected && pages.some((page) => page.stale) && (
              <p role="status" className="mb-3 text-xs text-muted-foreground">
                Showing saved results where fresh data is unavailable.
              </p>
            )}
            {busy && (
              <p role="status" className="mb-3 text-xs text-muted-foreground">
                Loading pull requests…
              </p>
            )}
            {!busy && connected && !pulls.length && (
              <p className="text-xs text-muted-foreground">
                No matching PRs in loaded results.
                {!sources.length ? ' Add a project from the Projects menu in Tasks.' : ''}
              </p>
            )}
            {!hasDetail && !!pulls.length && (
              <div className="hidden items-center gap-3 border-b py-2 pl-10 pr-12 text-[0.625rem] font-medium text-muted-foreground @4xl/pr-list:flex">
                <span className="flex-1">Pull request</span>
                <span className="w-44">Checks & review</span>
                <span className="w-22 text-right">Updated</span>
              </div>
            )}
            {!!marked.length && (
              <div className="sticky top-0 z-10 flex items-center justify-between bg-background px-3 py-2 text-xs">
                <span>{marked.length} PRs selected</span>
                <Button size="sm" variant="ghost" onClick={() => setMarked([])}>
                  Clear selection
                </Button>
              </div>
            )}
            <div
              className="divide-y divide-border/50"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setMarked([])
              }}
            >
              {pulls.map((p) => (
                <PullRow
                  key={JSON.stringify([p.source.key, p.number])}
                  pull={p}
                  compact={hasDetail}
                  repository={`${p.repositoryName} · ${p.source.runtimeName}${p.source.connected ? '' : ' · Offline'}`}
                  selected={
                    marked.includes(rowKey(p)) ||
                    (selected?.source.key === p.source.key && selected.number === p.number)
                  }
                  onAddToThread={() => addSelection(p)}
                  selectionCount={marked.includes(rowKey(p)) ? marked.length : 1}
                  onClick={(event) => selectRow(p, event)}
                  onSelect={() => void open(p.source, p.number)}
                />
              ))}
            </div>
            {pages.map((page) => (
              <div key={page.source.key} className="mt-3">
                {page.error && (
                  <p
                    role="alert"
                    className="break-words text-xs text-destructive [overflow-wrap:anywhere]"
                  >
                    {page.source.repository.name} · {page.source.runtimeName}: {page.error}
                  </p>
                )}
                {(page.hasMore || page.error) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="max-w-full"
                    disabled={busy || !page.source.connected}
                    onClick={() => void more(page.source.key)}
                  >
                    <span className="min-w-0 truncate">
                      {page.error ? 'Retry' : 'Load more'} · {page.source.repository.name} ·{' '}
                      {page.source.runtimeName}
                    </span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </nav>
        {urlSelection && githubPullTarget(urlSelection) && urlRuntimeId ? (
          <WorkspaceRuntimeScope runtimeId={urlRuntimeId}>
            <PullDetail
              key={JSON.stringify([urlRuntimeId, urlSelection, navigationKey])}
              repositoryId={githubPullTarget(urlSelection)?.url ?? urlSelection}
              number={githubPullTarget(urlSelection)?.number ?? 0}
              initialTab={detailTarget?.tab}
              initialFragment={detailTarget?.fragment}
              onBack={back}
              onChanged={() => {}}
            />
          </WorkspaceRuntimeScope>
        ) : selected && selectedSource ? (
          <WorkspaceRuntimeScope runtimeId={selectedSource.runtimeId}>
            <PullDetail
              key={JSON.stringify([
                selectedSource.scope,
                selectedSource.repository.id,
                selected.number,
                navigationKey,
              ])}
              repositoryId={selectedSource.repository.id}
              number={selected.number}
              initialTab={detailTarget?.tab}
              initialFragment={detailTarget?.fragment}
              onBack={back}
              onChanged={refresh}
              onSelect={(next) => void open(selectedSource, next)}
            />
          </WorkspaceRuntimeScope>
        ) : selected ? (
          <div className="p-5 text-sm">
            <p>This project connection changed. Open the PR again from the list.</p>
            <Button variant="ghost" onClick={back}>
              Back to PRs
            </Button>
          </div>
        ) : null}
      </div>
      {adding && <AddPullsToThread pulls={adding} onClose={() => setAdding(null)} />}
      {picking && (
        <SourcePicker
          title={picking === 'create' ? 'Create pull request' : 'Source control connections'}
          sources={sources}
          onClose={() => setPicking(null)}
          onSelect={(source) => {
            if (picking === 'create') setCreating(source)
            else setConnections(source)
            setPicking(null)
          }}
        />
      )}
      {connections &&
        sources.some(
          (source) => source.key === connections.key && source.scope === connections.scope,
        ) && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setConnections(null)
            }}
          >
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
              <WorkspaceRuntimeScope runtimeId={connections.runtimeId}>
                <DialogHeader>
                  <DialogTitle>Source control · {connections.runtimeName}</DialogTitle>
                  <DialogDescription>
                    {connections.repository.name} · Accounts on this computer.
                  </DialogDescription>
                </DialogHeader>
                <ForgeConnections repositoryId={connections.repository.id} onChange={refresh} />
              </WorkspaceRuntimeScope>
            </DialogContent>
          </Dialog>
        )}
      {creatingSource && (
        <WorkspaceRuntimeScope runtimeId={creatingSource.runtimeId}>
          <CreatePull
            key={creatingSource.scope}
            initialRepositoryId={creatingSource.repository.id}
            onClose={() => setCreating(null)}
            onCreated={(repositoryId, number) => {
              const source = sources.find(
                (source) =>
                  source.runtimeId === creatingSource.runtimeId &&
                  source.repository.id === repositoryId,
              )
              if (source) void open(source, number)
              setState('open')
              refresh()
            }}
          />
        </WorkspaceRuntimeScope>
      )}
    </section>
  )
}
