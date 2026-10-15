import {
  uniquePulls,
  forgePullTarget,
  pullRepositoryIdentity,
  type PullSummary,
} from '@dovo/protocol'
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
  type StudioViewProps,
  type StudioPullTarget,
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
import { ForgeConnections, useForgeConnections } from '../../connections/forge-connections'
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
export default function PullRequestsView({ entityId, pullTarget, navigationKey }: StudioViewProps) {
  const [sidebarVisible] = useLeftSidebar()
  const host = useStudioHost()
  const { activeRuntimeId, runtimes } = useWorkspace()
  // This is a merged collection, independent of the computer selected for task execution.
  const listKey = 'merged-pulls'
  const [repositoryId, setRepository] = useRetainedPullState(
      filterCache,
      listKey + ':repository',
      '',
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
    [selected, setSelected] = useRetainedPullState(selectionCache, listKey, null)
  const [urlSelection, setUrlSelection] = useRetainedPullState(urlCache, listKey + ':url', null)
  const [urlOwnerId, setUrlOwnerId] = useRetainedPullState(urlCache, listKey + ':owner', null)
  const [selectedNavigation, setSelectedNavigation] = useRetainedPullState(
    urlCache,
    listKey + ':navigation',
    null,
  )
  const [linkChoices, setLinkChoices] = useApplicationState<RepositorySource[] | null>(null)
  const [chooseRuntime, setChooseRuntime] = useApplicationState(false)
  const [marked, setMarked] = useApplicationState<string[]>([])
  const [adding, setAdding] = useApplicationState<PullSummary[] | null>(null)
  const selectionAnchor = useRef<string | null>(null)
  const {
    sources,
    pages: allPages,
    busy,
    connected,
    more,
    refresh,
    chooseReader,
  } = usePulls(state, repositoryId)
  const repositoryFilter = sources.find((source) => source.key === repositoryId)
  const filterIdentity = repositoryFilter && pullRepositoryIdentity(repositoryFilter.repository)
  const pages = allPages.filter(
    (page) =>
      !repositoryId ||
      page.source.key === repositoryId ||
      (filterIdentity && filterIdentity === pullRepositoryIdentity(page.source.repository)),
  )
  const bindings = sources.map((source) => ({
    identity: pullRepositoryIdentity(source.repository),
  }))
  const parseTarget = (url: string) => forgePullTarget(url, bindings)
  const detailTarget = parseTarget(selectedNavigation ?? urlSelection ?? '')
  const open = (source: RepositorySource, number: number, url?: string, replace = false) => {
    const pull = pages
      .find((page) => page.source.key === source.key)
      ?.pulls.find((pull) => pull.number === number)
    const target = parseTarget(url ?? pull?.url ?? '')
    const navigationUrl = target?.navigationUrl ?? url ?? pull?.url
    setUrlSelection(null)
    setSelectedNavigation(navigationUrl ?? null)
    setSelected({ source: { key: source.key, scope: source.scope }, number })
    setLinkChoices(null)
    setOpenError('')
    host.navigate(
      {
        viewId: 'pulls',
        entityId: navigationUrl,
        pullTarget: {
          runtimeId: source.runtimeId,
          repositoryId: source.repository.id,
          number,
          url: navigationUrl,
          tab: target && (target.tab !== 'overview' || target.fragment) ? target.tab : undefined,
          fragment: target?.fragment,
        },
      },
      { replace },
    )
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
  const previousTarget = useRef({ entityId, pullTarget })
  useEffect(() => {
    const previous = previousTarget.current
    previousTarget.current = { entityId, pullTarget }
    const navigation = JSON.stringify([entityId, pullTarget, navigationKey])
    if (handledLink.current === navigation) return
    if (pullTarget?.repositoryId) {
      const source = sources.find(
        (source) =>
          source.runtimeId === pullTarget.runtimeId &&
          source.repository.id === pullTarget.repositoryId,
      )
      setUrlSelection(null)
      setSelectedNavigation(pullTarget.url ?? entityId ?? null)
      const identity = source && pullRepositoryIdentity(source.repository)
      const url = pullTarget.url ?? entityId
      if (source && identity && url && forgePullTarget(url, bindings)?.identity !== identity) {
        setSelected(null)
        setOpenError('This project now targets another PR repository. Open the original PR source.')
      } else if (source) {
        handledLink.current = navigation
        setOpenError('')
        setSelected({ source: { key: source.key, scope: source.scope }, number: pullTarget.number })
      } else {
        setSelected(null)
        setOpenError('The original computer or project is no longer saved.')
      }
      return
    }
    if (!entityId && !pullTarget) {
      handledLink.current = navigation
      if (previous.entityId || previous.pullTarget) {
        setSelected(null)
        setUrlSelection(null)
        setSelectedNavigation(null)
        setUrlOwnerId(null)
      }
      setLinkChoices(null)
      setChooseRuntime(false)
      return
    }
    const target = parseTarget(pullTarget?.url ?? entityId ?? '')
    if (!target) {
      if (entityId && !entityId.startsWith('http')) {
        handledLink.current = navigation
        setRepository(repositorySourceKey(activeRuntimeId ?? '', entityId))
        setSelected(null)
        setUrlSelection(null)
      }
      return
    }
    const matches = sources.filter(
      (source) => pullRepositoryIdentity(source.repository) === target.identity,
    )
    handledLink.current = navigation
    setSelected(null)
    setSelectedNavigation(target.navigationUrl)
    setOpenError('')
    if (!pullTarget && matches.length > 1) {
      setUrlSelection(null)
      setLinkChoices(matches)
      return
    }
    const source = matches.length === 1 && !pullTarget ? matches[0] : undefined
    if (source) {
      // Qualify legacy URL entry points immediately so history cannot resolve them again
      // against another computer/account when the user returns.
      open(source, target.number, target.navigationUrl, true)
      return
    }
    setUrlSelection(target.navigationUrl)
    const owner =
      pullTarget?.runtimeId ?? (runtimes.length === 1 ? runtimes[0]?.profile.id : undefined)
    setUrlOwnerId(owner ?? null)
    setChooseRuntime(!owner)
  }, [entityId, pullTarget, navigationKey, sources])
  const back = () => {
    setSelected(null)
    setUrlSelection(null)
    setSelectedNavigation(null)
    setUrlOwnerId(null)
    setLinkChoices(null)
    setChooseRuntime(false)
    if ((entityId || pullTarget) && host.goBack?.()) return
    host.navigate({ viewId: 'pulls' })
  }
  const hasDetail = !!selected || !!urlSelection
  const urlRuntimeId = urlOwnerId
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
      open(pull.source, pull.number)
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
                  void (chooseReader?.(selection) ?? Promise.resolve())
                    .then(() => {
                      setRepository(selection)
                      setSelected(null)
                    })
                    .catch((cause: unknown) =>
                      setOpenError(cause instanceof Error ? cause.message : String(cause)),
                    )
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
                  onSelect={() => open(p.source, p.number)}
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
                    disabled={busy || !page.reader.connected}
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
        {urlSelection && detailTarget && urlRuntimeId ? (
          <WorkspaceRuntimeScope runtimeId={urlRuntimeId}>
            <UrlPullDetail
              key={JSON.stringify([urlRuntimeId, detailTarget.url, pullTarget?.connectionId])}
              target={{
                runtimeId: urlRuntimeId,
                number: detailTarget.number,
                url: detailTarget.url,
                tab: pullTarget?.tab ?? detailTarget.tab,
                fragment: pullTarget?.fragment ?? detailTarget.fragment,
                connectionId: pullTarget?.connectionId,
              }}
              onBack={back}
            />
          </WorkspaceRuntimeScope>
        ) : selected && selectedSource ? (
          <WorkspaceRuntimeScope runtimeId={selectedSource.runtimeId}>
            <PullDetail
              key={JSON.stringify([
                selectedSource.scope,
                selectedSource.repository.id,
                selected.number,
              ])}
              repositoryId={selectedSource.repository.id}
              number={selected.number}
              initialTab={
                pullTarget?.tab ??
                (detailTarget && (detailTarget.tab !== 'overview' || detailTarget.fragment)
                  ? detailTarget.tab
                  : undefined)
              }
              initialFragment={pullTarget?.fragment ?? detailTarget?.fragment}
              onBack={back}
              onChanged={refresh}
              onTabChange={(tab) =>
                host.navigate(
                  {
                    viewId: 'pulls',
                    entityId: selectedNavigation ?? undefined,
                    pullTarget: {
                      runtimeId: selectedSource.runtimeId,
                      repositoryId: selectedSource.repository.id,
                      number: selected.number,
                      url: selectedNavigation ?? undefined,
                      tab,
                      fragment: detailTarget?.fragment,
                    },
                  },
                  { replace: true },
                )
              }
              onSelect={(next) => open(selectedSource, next)}
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
      {linkChoices && (
        <SourcePicker
          title="Choose the PR account and computer"
          sources={linkChoices}
          onClose={back}
          onSelect={(source) => {
            const target = parseTarget(entityId ?? '')
            if (target) open(source, target.number, target.navigationUrl, true)
          }}
        />
      )}
      {chooseRuntime && (
        <SourcePicker
          title="Choose the PR computer"
          sources={runtimes.map((entry) => ({
            key: entry.profile.id,
            runtimeId: entry.profile.id,
            runtimeName: entry.profile.name,
            name: 'Pull request',
            connected: entry.connected,
          }))}
          onClose={back}
          onSelect={(source) => {
            const target = parseTarget(urlSelection ?? '')
            if (!target) return
            setChooseRuntime(false)
            host.navigate({
              viewId: 'pulls',
              entityId: target.navigationUrl,
              pullTarget: {
                runtimeId: source.runtimeId,
                number: target.number,
                url: target.navigationUrl,
                tab: target.tab,
                fragment: target.fragment,
              },
            })
          }}
        />
      )}
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
              if (source) open(source, number)
              setState('open')
              refresh()
            }}
          />
        </WorkspaceRuntimeScope>
      )}
    </section>
  )
}

function UrlPullDetail({ target, onBack }: { target: StudioPullTarget; onBack: () => void }) {
  const { connections } = useForgeConnections()
  const host = useStudioHost()
  const url = target.url ?? ''
  const matching = connections.filter((connection) => {
    try {
      return new URL(connection.baseUrl).host === new URL(url).host
    } catch {
      return false
    }
  })
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {matching.length > 1 && (
        <div className="border-b p-3">
          <ChoicePicker
            aria-label="PR account"
            value={target.connectionId ?? ''}
            onValueChange={(connectionId) =>
              host.navigate({
                viewId: 'pulls',
                entityId: url,
                pullTarget: { ...target, connectionId: connectionId || undefined },
              })
            }
          >
            <option value="">Choose an account…</option>
            {matching.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </ChoicePicker>
        </div>
      )}
      <PullDetail
        repositoryId={url}
        number={target.number}
        connectionId={target.connectionId}
        initialTab={target.tab}
        initialFragment={target.fragment}
        onBack={onBack}
        onChanged={() => {}}
        onTabChange={(tab) =>
          host.navigate(
            { viewId: 'pulls', entityId: url, pullTarget: { ...target, tab } },
            { replace: true },
          )
        }
      />
    </div>
  )
}
