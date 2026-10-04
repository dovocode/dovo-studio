import { githubPullTarget, type PullSummary } from '@dovo/protocol'
import { AddPullsToThread } from './add-to-thread'
import { PageHeader } from '@dovo/studio-ui'
import { useApplicationState } from '@dovo/studio-core/state'
import { ChoicePicker } from '@dovo/studio-ui'
import { useEffect, useRef } from 'react'
import {
  comparePulls,
  matchesPull,
  pullNeedsAttention,
  useWorkspace,
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
} from '@dovo/studio-ui'
import { usePulls } from './use-pulls'
import { PullRow } from './row'
import { PullDetail } from '../detail/detail'
import { CreatePull } from './create'
import { ForgeConnections } from '../../connections/forge-connections'
import { SourcePicker } from '../../connections/source-picker'
export default function PullRequestsView({ entityId }: { entityId?: string }) {
  const { activeRuntimeId, switchRuntime } = useWorkspace()
  const [repositoryId, setRepository] = useApplicationState(
      entityId && !githubPullTarget(entityId)
        ? repositorySourceKey(activeRuntimeId ?? '', entityId)
        : '',
    ),
    [state, setState] = useApplicationState('open'),
    [search, setSearch] = useApplicationState(''),
    [draft, setDraft] = useApplicationState('all'),
    [attention, setAttention] = useApplicationState(false),
    [sort, setSort] = useApplicationState('updated'),
    [filtersOpen, setFiltersOpen] = useApplicationState(false),
    [personal, setPersonal] = useApplicationState<
      'all' | 'authored' | 'assigned' | 'involved' | 'review'
    >('all'),
    [picking, setPicking] = useApplicationState<'create' | 'connections' | null>(null),
    [connections, setConnections] = useApplicationState<RepositorySource | null>(null),
    [creating, setCreating] = useApplicationState<RepositorySource | null>(null),
    [openError, setOpenError] = useApplicationState(''),
    [opening, setOpening] = useApplicationState(false),
    [selected, setSelected] = useApplicationState<{
      source: RepositorySource
      number: number
    } | null>(null)
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
    }
  }, [entityId, activeRuntimeId])
  const { sources, pages: allPages, busy, connected, more, refresh } = usePulls(state)
  const pages = allPages.filter((page) => !repositoryId || page.source.key === repositoryId)
  const openingRef = useRef(false)
  const open = async (source: RepositorySource, number: number) => {
    if (openingRef.current) return
    openingRef.current = true
    setOpening(true)
    setOpenError('')
    try {
      if (source.runtimeId !== activeRuntimeId) await switchRuntime(source.runtimeId)
      setSelected({
        source,
        number,
      })
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
  const pulls = pages
    .flatMap((page) =>
      page.pulls.map((pull) => ({
        ...pull,
        source: page.source,
        repositoryName: page.source.repository.name,
      })),
    )
    .filter(
      (p) =>
        (state === 'all' || p.state === state) &&
        (personal !== 'authored' || p.viewerIsAuthor === true) &&
        (personal !== 'review' || p.viewerReviewRequested === true) &&
        (personal !== 'assigned' || p.viewerIsAssigned === true) &&
        (personal !== 'involved' || p.viewerIsInvolved === true) &&
        (draft === 'all' || p.draft === (draft === 'draft')) &&
        (!attention || pullNeedsAttention(p)) &&
        matchesPull(p, `${p.repositoryName} ${p.source.runtimeName}`, search),
    )
    .sort((a, b) => comparePulls(a, b, sort === 'attention'))
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
  useEffect(() => {
    if (!entityId || handledLink.current === entityId) return
    const target = githubPullTarget(entityId)
    if (!target) return
    const source = sources.find(
      (source) =>
        source.runtimeId === activeRuntimeId && source.repository.gitIdentity === target.identity,
    )
    if (!source) return
    handledLink.current = entityId
    setOpenError('')
    setSelected({ source, number: target.number })
  }, [entityId, sources, activeRuntimeId])
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
  return (
    <section className="flex min-h-0 flex-1 flex-col">
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
      <div className="flex min-h-0 min-w-0 flex-1">
        <nav
          aria-label="Pull request sidebar"
          className={`${selected ? 'hidden md:block' : 'block'} w-full shrink-0 overflow-y-auto border-r md:w-[22rem] lg:w-[26rem]`}
        >
          <>
            <PageHeader title="Pull requests">
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
            </PageHeader>
            <div
              className="flex flex-wrap gap-1 border-b px-3 pb-3"
              aria-label="Personal pull request filters"
            >
              {(
                [
                  { id: 'all', label: 'All PRs' },
                  { id: 'authored', label: 'Authored by me' },
                  { id: 'assigned', label: 'Assigned to me' },
                  { id: 'involved', label: 'Involves me' },
                  { id: 'review', label: 'Review requests' },
                ] as const
              ).map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={personal === item.id ? 'secondary' : 'ghost'}
                  aria-pressed={personal === item.id}
                  onClick={() => {
                    setPersonal(item.id)
                    setMarked([])
                  }}
                >
                  {item.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((value) => !value)}
              >
                Filters
              </Button>
            </div>
            <div hidden={!filtersOpen} className="shrink-0 space-y-3 border-b p-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!connected || busy} onClick={refresh}>
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!sources.some((source) => source.connected)}
                  onClick={() => setPicking('connections')}
                >
                  Connections
                </Button>
                <Button
                  size="sm"
                  disabled={!sources.some((source) => source.connected)}
                  onClick={() => setPicking('create')}
                >
                  Create
                </Button>
              </div>
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
                <span className="text-xs text-muted-foreground">
                  {connected
                    ? `${pulls.length} across devices${pages.some((page) => page.hasMore) ? ' · more available' : ''}`
                    : 'Offline'}
                </span>
                <Input
                  aria-label="Search pull requests"
                  className="ml-auto h-9 min-w-40 max-w-full flex-1 text-sm sm:max-w-72"
                  placeholder="Search PRs, branches, people…"
                  value={search}
                  onChange={(e) => {
                    setMarked([])
                    setSearch(e.target.value)
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                  {['open', 'closed', 'merged', 'all'].map((s) => (
                    <option key={s} value={s}>
                      {s === 'all' ? 'All states' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </ChoicePicker>
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
              </div>
            </div>
          </>
          <div className="p-2">
            {filtersOpen && personal !== 'all' && (
              <p className="mb-3 px-2 text-xs text-muted-foreground">
                Personal filters use each computer’s connected forge account. Involves me includes
                authorship, assignment and review participation where reported. Bitbucket and Azure
                DevOps use reviewers rather than PR assignees.
              </p>
            )}
            {!!unknownRelationships && (
              <p role="status" className="mb-3 px-2 text-xs text-amber-400">
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
            {!selected && !!pulls.length && (
              <div className="mb-2 hidden items-center gap-3 px-10 py-2 text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground lg:flex">
                <span className="flex-1">Pull request</span>
                <span className="w-44">Checks & review</span>
                <span className="w-24 text-right">Updated</span>
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
              className="space-y-1"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setMarked([])
              }}
            >
              {pulls.map((p) => (
                <PullRow
                  key={JSON.stringify([p.source.key, p.number])}
                  pull={p}
                  compact
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
                  <p role="alert" className="text-xs text-destructive">
                    {page.source.repository.name} · {page.source.runtimeName}: {page.error}
                  </p>
                )}
                {(page.hasMore || page.error) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !page.source.connected}
                    onClick={() => void more(page.source.key)}
                  >
                    {page.error ? 'Retry' : 'Load more'} · {page.source.repository.name} ·{' '}
                    {page.source.runtimeName}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </nav>
        {selected && selectedSource && activeRuntimeId === selectedSource.runtimeId ? (
          <PullDetail
            key={JSON.stringify([
              selectedSource.scope,
              selectedSource.repository.id,
              selected.number,
            ])}
            repositoryId={selectedSource.repository.id}
            number={selected.number}
            onBack={() => setSelected(null)}
            onChanged={refresh}
            onSelect={(next) => void open(selectedSource, next)}
          />
        ) : selected ? (
          <div className="p-5 text-sm">
            <p>This project connection changed. Open the PR again from the list.</p>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Back to PRs
            </Button>
          </div>
        ) : (
          <div className="hidden min-w-0 flex-1 items-center justify-center p-8 text-sm text-muted-foreground md:flex">
            Select a pull request to view its conversation and changes.
          </div>
        )}
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
        activeRuntimeId === connections.runtimeId &&
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
              <DialogHeader>
                <DialogTitle>Source control · {connections.runtimeName}</DialogTitle>
                <DialogDescription>
                  {connections.repository.name} · Accounts on this computer.
                </DialogDescription>
              </DialogHeader>
              <ForgeConnections repositoryId={connections.repository.id} onChange={refresh} />
            </DialogContent>
          </Dialog>
        )}
      {creatingSource && activeRuntimeId === creatingSource.runtimeId && (
        <CreatePull
          key={creatingSource.scope}
          initialRepositoryId={creatingSource.repository.id}
          onClose={() => setCreating(null)}
          onCreated={(repositoryId, number) => {
            const source = sources.find(
              (source) =>
                source.runtimeId === activeRuntimeId && source.repository.id === repositoryId,
            )
            if (source)
              setSelected({
                source,
                number,
              })
            setState('open')
            refresh()
          }}
        />
      )}
    </section>
  )
}
