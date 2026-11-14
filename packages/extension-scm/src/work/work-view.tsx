import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useDetailTransition } from '@dovo/studio-ui/detail-transition'
import { SearchField } from '@dovo/studio-ui/search-field'
import {
  pipelineSignal,
  pipelineStatusSummary,
  hasJiraIssueFilters,
  jiraIssueOrder,
  type ForgeWorkOptions,
  type JiraIssueFilters,
} from '@dovo/protocol'
import { JiraToolbar } from './jira-toolbar'
import { EmptyState, PageHeader, SidebarHeader, useLeftSidebar } from '@dovo/studio-ui'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  ArrowLeft,
  CircleDot,
  CircleCheck,
  GitBranch,
  Monitor,
  Plug,
  RefreshCw,
  SlidersHorizontal,
  Plus,
  AlertCircle,
} from 'lucide-react'
import {
  useWorkspace,
  useStudioHost,
  WorkspaceRuntimeScope,
  decodeWorkTarget,
  repositorySourceKey,
  issueLabel,
  forgeLabels,
  formatDateTime,
  matchesWorkItem,
  type StudioViewProps,
} from '@dovo/studio-core'
import { Button, ChoicePicker, useCompactLayout } from '@dovo/studio-ui'
import { JiraSourcesDialog } from '../connections/jira-binding'
import {
  useIssueSources,
  jiraSourceKey,
  matchesWorkSource,
  workRemoteKey,
  type WorkSource,
} from './work-sources'
import { PipelineState } from './pipeline-state'
import { WorkContent } from './content'
import { WorkForm } from './work-form'
import { SourcePicker } from '../connections/source-picker'
import { useWorkSources } from './use-work-sources'
import { JiraIssueList, jiraIssueRowKey } from './jira-issue-list'
type WorkPreferences = {
  project: string
  search: string
  state: string
  jiraFilters: JiraIssueFilters
  jiraLayout: 'list' | 'board'
  sort: string
  linked: string
  selection?: { key: string; scope: string; id: string; url?: string }
}
const retained = new Map<string, WorkPreferences>()

type Mode = 'issues' | 'pipelines'
export default function IssuesView({ entityId }: StudioViewProps) {
  return <WorkView mode="issues" sourceKind="issues" entityId={entityId} />
}
export function JiraView({ entityId }: StudioViewProps) {
  return <WorkView mode="issues" sourceKind="jira" entityId={entityId} />
}
export function PipelinesView({ entityId }: StudioViewProps) {
  return <WorkView mode="pipelines" entityId={entityId} />
}
function WorkView({
  mode,
  sourceKind = 'issues',
  entityId,
}: {
  mode: Mode
  sourceKind?: 'issues' | 'jira'
  entityId?: string
}) {
  const uiText = useInterfaceText()

  const { activeRuntimeId, runtimes } = useWorkspace()
  const host = useStudioHost()
  const { transition, style: detailStyle } = useDetailTransition()
  const [sidebarVisible] = useLeftSidebar()

  const isJira = mode === 'issues' && sourceKind === 'jira'
  const compact = useCompactLayout()
  const preferenceKey = JSON.stringify([
    mode,
    sourceKind,
    runtimes.map(({ profile }) => [profile.id, profile.connection]),
  ])
  const [preferences, setPreferences] = useApplicationState<WorkPreferences>(
    () =>
      retained.get(preferenceKey) ?? {
        project: '',
        search: '',
        state: isJira ? 'open' : 'all',
        jiraFilters: {},
        jiraLayout: 'list',
        sort: 'updated',
        linked: 'all',
      },
  )
  const { project, search, state, jiraFilters, jiraLayout, sort, linked } = preferences
  const setProject = (project: string) =>
    setPreferences((value) => ({
      ...value,
      project,
      jiraFilters:
        value.project === project
          ? value.jiraFilters
          : {
              ...value.jiraFilters,
              board: undefined,
              sprint: undefined,
              team: undefined,
              component: undefined,
              release: undefined,
            },
    }))
  const setSearch = (search: string) => setPreferences((value) => ({ ...value, search }))
  const setState = (state: string) => setPreferences((value) => ({ ...value, state }))
  const setJiraFilters = (jiraFilters: JiraIssueFilters) =>
    setPreferences((value) => ({ ...value, jiraFilters }))
  const setJiraLayout = (jiraLayout: 'list' | 'board') =>
    setPreferences((value) => ({ ...value, jiraLayout }))
  const setSort = (sort: string) => setPreferences((value) => ({ ...value, sort }))
  const setLinked = (linked: string) => setPreferences((value) => ({ ...value, linked }))
  const [filtersOpen, setFiltersOpen] = useApplicationState(false)
  const [query, setQuery] = useApplicationState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(mode === 'issues' ? search.trim() : ''), 300)
    return () => clearTimeout(timer)
  }, [mode, search])
  const readFilters = useMemo(
    () => ({ ...jiraFilters, orderBy: jiraIssueOrder(jiraLayout, sort) }),
    [jiraFilters, jiraLayout, sort],
  )
  const { sources, pages, busy, refresh, more, chooseReader } = useWorkSources(
    mode,
    query,
    sourceKind,
    project,
    isJira ? state : 'all',
    isJira ? readFilters : undefined,
  )
  const allSources = useIssueSources(mode === 'issues', false)
  const [selected, setSelected] = useApplicationState<{
    source: WorkSource
    id: string
    url?: string
  } | null>(() => {
    const saved = preferences.selection
    const source = allSources.find(
      (source) => source.key === saved?.key && source.scope === saved.scope,
    )
    return saved && source ? { source, id: saved.id, url: saved.url } : null
  })
  useEffect(() => {
    retained.delete(preferenceKey)
    retained.set(preferenceKey, {
      ...preferences,
      selection: selected
        ? {
            key: selected.source.key,
            scope: selected.source.scope,
            id: selected.id,
            url: selected.url,
          }
        : undefined,
    })
    while (retained.size > 16) {
      const oldest = retained.keys().next().value
      if (oldest === undefined) break
      retained.delete(oldest)
    }
  }, [preferenceKey, preferences, selected])
  const [picking, setPicking] = useApplicationState(false)
  const [creating, setCreating] = useApplicationState<{
    source: WorkSource
    options: ForgeWorkOptions
  } | null>(null)
  const [settings, setSettings] = useApplicationState(false)
  const [opening, setOpening] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const pending = useRef(false)
  const list = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLElement>(null)
  const focusAfterClose = useRef<string | null>(null)
  const returnScroll = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (selected || !focusAfterClose.current) return
    const key = focusAfterClose.current
    focusAfterClose.current = null
    // The full-height narrow preview can clamp the hidden list's scroll position.
    if (compact && list.current && returnScroll.current !== null)
      list.current.scrollTop = returnScroll.current
    returnScroll.current = null
    const row = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>('[data-work-item]') ?? []),
    ].find((button) => button.dataset.workItem === key)
    ;(row ?? list.current)?.focus({ preventScroll: true })
  }, [selected, compact])
  useEffect(() => {
    if (compact && selected) preview.current?.focus()
  }, [isJira, compact, selected?.source.scope, selected?.id])
  useEffect(() => {
    if (isJira && list.current) list.current.scrollTop = 0
  }, [isJira, project, query, state, linked, sort, jiraFilters, jiraLayout])
  const lastTarget = useRef<string | undefined>(undefined)
  const selectedSource = allSources.find(
    (source) => source.key === selected?.source.key && source.scope === selected.source.scope,
  )
  const createPage = creating
  useEffect(() => {
    if (lastTarget.current === entityId) return
    const target = decodeWorkTarget(entityId)
    if (!target) {
      lastTarget.current = entityId
      return
    }
    const source = allSources.find(
      (source) =>
        source.key ===
        (target.jiraSourceId
          ? jiraSourceKey(target.runtimeId ?? activeRuntimeId ?? '', target.jiraSourceId)
          : repositorySourceKey(
              target.runtimeId ?? activeRuntimeId ?? '',
              target.repositoryId ?? '',
            )),
    )
    if (!source) {
      setSelected(null)
      setError('This item belongs to a computer or source that is no longer saved.')
      return
    }
    setError('')
    lastTarget.current = entityId
    setProject(source.key)
    setSearch(target.sha ?? '')
    setSelected(
      target.id
        ? {
            source,
            id: target.id,
            url: target.url,
          }
        : null,
    )
  }, [entityId, activeRuntimeId, allSources])
  const openContext = useRef('')
  openContext.current = JSON.stringify([entityId, project, search, state, linked, jiraFilters])
  const open = async (source: WorkSource, id: string, url: string) => {
    if (pending.current) return
    pending.current = true
    setOpening(true)
    setError('')
    const context = openContext.current
    returnScroll.current = compact ? (list.current?.scrollTop ?? null) : null
    try {
      if (context !== openContext.current) return
      transition(() => setSelected({ source, id, url }))
    } catch (error) {
      setError(String(error))
    } finally {
      pending.current = false
      setOpening(false)
    }
  }
  const projectSource = sources.find((source) => source.key === project)
  const projectRemote = projectSource ? workRemoteKey(projectSource) : project
  const visiblePages = pages.filter((page) => matchesWorkSource(page.source, projectRemote))
  const matchingRows = visiblePages
    .flatMap((page) =>
      page.items.map((item) => ({
        source: page.source,
        item,
        stale: page.stale,
        cachedAt: page.cachedAt,
        provider: page.options?.provider,
        serverMatched: !!page.query && page.query === search.trim(),
      })),
    )
    .filter(
      ({ source, item, serverMatched }) =>
        (mode === 'pipelines' ||
          isJira ||
          state === 'all' ||
          ('state' in item && item.state === state)) &&
        (linked === 'all' ||
          (linked === 'unlinked'
            ? source.jira && !source.projectLinks?.[item.id]
            : source.repository || source.projectLinks?.[item.id])) &&
        (serverMatched ||
          matchesWorkItem(item, search) ||
          `${source.name} ${source.runtimeName}`.toLowerCase().includes(search.toLowerCase())),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.item.title.localeCompare(b.item.title)
        : sort === 'project'
          ? a.source.name.localeCompare(b.source.name) ||
            (isJira ? 0 : b.item.updatedAt.localeCompare(a.item.updatedAt))
          : !isJira && a.item.updatedAt && b.item.updatedAt
            ? b.item.updatedAt.localeCompare(a.item.updatedAt)
            : 0,
    )
  const rows =
    mode === 'pipelines' && state !== 'all'
      ? matchingRows.filter(
          ({ item }) =>
            'status' in item && pipelineSignal(item.status).label === pipelineSignal(state).label,
        )
      : matchingRows
  const pipelineStatuses = pipelineStatusSummary(
    matchingRows.flatMap(({ item }) => ('status' in item ? [item.status] : [])),
    state,
  )
  const observedStates = [
    ...new Set([
      ...visiblePages.flatMap((page) =>
        page.items.map((item) => ('state' in item ? item.state : item.status)),
      ),
      ...(state !== 'all' ? [state] : []),
    ]),
  ].sort()
  const states =
    mode === 'issues'
      ? [
          'open',
          'closed',
          ...observedStates.filter((value) => value !== 'open' && value !== 'closed'),
        ]
      : observedStates
  const canCreate = pages
    .filter(
      (page) =>
        page.source.connected &&
        !page.stale &&
        (mode === 'issues' ? page.options?.issues : page.options?.pipelineActions.includes('run')),
    )
    .map((page) => page.source)
  const chooseSource = async (action: 'create' | 'settings', target?: WorkSource) => {
    if (action === 'settings') {
      setSettings(true)
      return
    }
    const candidates = target
      ? [target]
      : canCreate.filter((source) => matchesWorkSource(source, projectRemote))
    if (candidates.length !== 1 || !candidates[0]?.connected) {
      setPicking(true)
      return
    }
    const source = candidates[0]
    if (pending.current) return
    pending.current = true
    setOpening(true)
    setError('')
    try {
      const page = pages.find(
        (page) => page.source.key === source.key && page.source.scope === source.scope,
      )
      if (page?.options && !page.optionsError) setCreating({ source, options: page.options })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setOpening(false)
    }
  }
  const visibleSources = sources.filter((source) => matchesWorkSource(source, projectRemote))
  const sourceProblems = visiblePages.filter(
    (page) =>
      page.error ||
      page.optionsError ||
      (mode === 'issues'
        ? !page.options?.issues && page.options?.issueNotice
        : !page.options?.pipelines && page.options?.pipelineNotice),
  )
  const defaultState = isJira ? 'open' : 'all'
  const hasFilters =
    !!search ||
    state !== defaultState ||
    linked !== 'all' ||
    !!project ||
    (isJira && hasJiraIssueFilters(jiraFilters))
  const secondaryFilters = Number(!!project) + Number(linked !== 'all') + Number(sort !== 'updated')
  const canCreateSelected = canCreate.some((source) => matchesWorkSource(source, projectRemote))
  const pipelineRunNotice =
    mode === 'pipelines' &&
    !canCreateSelected &&
    (!busy || visiblePages.some((page) => page.options))
      ? !visibleSources.length
        ? 'Connect a code project to run pipelines.'
        : !visibleSources.some((source) => source.connected)
          ? 'Reconnect a project’s computer to run pipelines.'
          : visiblePages.some((page) => page.error || page.optionsError || page.stale)
            ? 'Refresh the source connection to make pipeline actions available.'
            : 'These sources support viewing pipeline runs only.'
      : null
  const closePreview = async () => {
    if (entityId && (await host.goBack?.())) return
    transition(() => {
      if (selected) focusAfterClose.current = jiraIssueRowKey(selected.source, selected.id)
      setSelected(null)
      if (entityId) host.navigate({ viewId: isJira ? 'jira' : mode })
    }, 'close')
  }
  const detail = selected ? (
    selectedSource ? (
      <WorkspaceRuntimeScope runtimeId={selectedSource.runtimeId}>
        <ScopedWorkContent
          key={JSON.stringify([selectedSource.scope, selected.id, mode])}
          repositoryId={selectedSource.repository?.id}
          jiraSourceId={selectedSource.jira?.id}
          repositoryName={`${selectedSource.name} · ${selectedSource.runtimeName}`}
          collectionHeader={null}
          branch={selectedSource.repository?.branch ?? ''}
          initialSelected={selected.id}
          initialSourceURL={selected.url}
          mode={mode}
          connected={selectedSource.connected}
          onChanged={isJira ? refresh : undefined}
          onBack={closePreview}
        />
      </WorkspaceRuntimeScope>
    ) : (
      <div className="p-5 text-sm">
        <p>This source connection changed. Open the item again from the list.</p>
        <Button variant="ghost" onClick={closePreview}>
          <ArrowLeft className="size-4" />
          {isJira ? 'Close preview' : `Back to ${mode}`}
        </Button>
      </div>
    )
  ) : null
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1"
      onKeyDown={(event) => {
        if (!selected || event.key !== 'Escape' || event.defaultPrevented) return
        if (
          event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
          )
        )
          return
        event.preventDefault()
        void closePreview()
      }}
    >
      <nav
        aria-label={`${isJira ? 'Jira' : mode} list`}
        className={`studio-navigation-sidebar ${selected && (compact || !sidebarVisible) ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-col bg-background ${selected ? 'w-80 shrink-0' : 'flex-1'}`}
      >
        <SidebarHeader enabled={!!selected} />
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${selected ? 'studio-overview-pane bg-sidebar' : 'studio-page-surface bg-background'}`}
        >
          <div className="contents">
            <PageHeader
              embedded={!!selected}
              title={mode === 'issues' ? (sourceKind === 'jira' ? 'Jira' : 'Issues') : 'Pipelines'}
            >
              <Button
                size="icon"
                variant="ghost"
                aria-label={uiText('Refresh')}
                title={uiText('Refresh')}
                className="size-8"
                disabled={busy || !visiblePages.some((page) => page.reader.connected)}
                onClick={refresh}
              >
                <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
              </Button>
              {mode === 'issues' && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={uiText('Connections')}
                  disabled={opening}
                  onClick={() => void chooseSource('settings')}
                >
                  <Plug className="size-3.5" />
                  <span className="sr-only sm:not-sr-only">{uiText('Connections')}</span>
                </Button>
              )}
              <Button
                size="sm"
                disabled={opening || !canCreateSelected}
                title={pipelineRunNotice ?? undefined}
                aria-describedby={pipelineRunNotice ? 'pipeline-run-notice' : undefined}
                onClick={() => void chooseSource('create')}
              >
                <Plus className="size-3.5" />
                <span className={selected ? 'sr-only' : 'sr-only sm:not-sr-only'}>
                  {mode === 'issues' ? 'New issue' : 'Run pipeline'}
                </span>
              </Button>
            </PageHeader>
            <div className="shrink-0 border-b border-border/70 px-3 py-2">
              <SearchField
                containerClassName="w-full min-w-0"
                aria-label={`Search ${mode}`}
                placeholder={
                  mode === 'issues'
                    ? 'Search issue titles, keys, text…'
                    : 'Search runs, branches, projects…'
                }
                value={search}
                disabled={isJira && !sources.length}
                maxLength={300}
                onValueChange={setSearch}
              />
            </div>
            <div className="shrink-0 border-b border-border/70 px-3 py-1">
              <span className="sr-only">
                {rows.length === matchingRows.length
                  ? `${rows.length} loaded`
                  : `${rows.length} of ${matchingRows.length} loaded`}{' '}
                · {visibleSources.length} {visibleSources.length === 1 ? 'source' : 'sources'}
              </span>
              {isJira ? (
                <JiraToolbar
                  state={state}
                  onState={(value) => {
                    setState(value)
                    setSelected(null)
                  }}
                  filters={jiraFilters}
                  onFilters={(value) => {
                    setJiraFilters(value)
                    setSelected(null)
                  }}
                  view={jiraLayout}
                  onView={setJiraLayout}
                  issues={visiblePages.flatMap((page) =>
                    page.items.flatMap((item) => ('state' in item ? [item] : [])),
                  )}
                  sources={sources}
                  source={project}
                  onSource={(value) => {
                    void (chooseReader?.(value) ?? Promise.resolve())
                      .then(() => {
                        setProject(value)
                        setSelected(null)
                      })
                      .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : String(cause)),
                      )
                  }}
                  linked={linked}
                  onLinked={setLinked}
                  sort={sort}
                  onSort={setSort}
                  onClear={() => {
                    setSearch('')
                    setState(defaultState)
                    setJiraFilters({})
                    setProject('')
                    setLinked('all')
                    setSort('updated')
                    setSelected(null)
                  }}
                />
              ) : (
                <div className="min-w-0">
                  <div className="studio-list-toolbar">
                    {mode === 'issues' ? (
                      <div
                        role="group"
                        aria-label="Issue states"
                        className="studio-list-quick-views"
                      >
                        {['all', ...states.filter((value) => value !== 'all')].map((value) => (
                          <Button
                            key={value}
                            size="sm"
                            variant="ghost"
                            className="studio-list-quick-filter"
                            aria-pressed={state === value}
                            onClick={() => setState(value)}
                          >
                            {value === 'all'
                              ? 'All states'
                              : value.charAt(0).toUpperCase() + value.slice(1)}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <div
                        role="group"
                        aria-label="Filter loaded runs by status"
                        className="studio-list-quick-views"
                      >
                        <p className="sr-only">Counts in loaded, searched results</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-pressed={state === 'all'}
                          aria-label={`All runs: ${matchingRows.length}`}
                          onClick={() => setState('all')}
                          className="studio-list-quick-filter"
                        >
                          All runs{' '}
                          <span className="studio-list-filter-count">{matchingRows.length}</span>
                        </Button>
                        {pipelineStatuses.map(({ status, label, count }) => (
                          <Button
                            key={label}
                            size="sm"
                            variant="ghost"
                            aria-label={`Filter ${label}: ${count} runs`}
                            aria-pressed={state !== 'all' && pipelineSignal(state).label === label}
                            onClick={() =>
                              setState(
                                state !== 'all' && pipelineSignal(state).label === label
                                  ? 'all'
                                  : status,
                              )
                            }
                            className="studio-list-quick-filter"
                          >
                            <span className="truncate">{label}</span>
                            <span className="studio-list-filter-count">{count}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="studio-list-filter-trigger"
                      aria-label="Filters"
                      aria-expanded={filtersOpen}
                      aria-controls="work-list-filters"
                      data-active={secondaryFilters > 0 || undefined}
                      onClick={() => setFiltersOpen((value) => !value)}
                    >
                      <SlidersHorizontal className="size-3.5" />
                      Filters
                      {!!secondaryFilters && (
                        <span className="studio-list-filter-count">{secondaryFilters}</span>
                      )}
                    </Button>
                  </div>
                  <div id="work-list-filters" hidden={!filtersOpen}>
                    <div className="studio-list-filter-fields">
                      <ChoicePicker
                        aria-label={mode === 'issues' ? 'Issue source' : 'Pipeline source'}
                        className="h-8 w-auto max-w-72 text-xs"
                        value={project}
                        onValueChange={(value) => {
                          void (chooseReader?.(value) ?? Promise.resolve())
                            .then(() => setProject(value))
                            .catch((cause: unknown) =>
                              setError(cause instanceof Error ? cause.message : String(cause)),
                            )
                          setState('all')
                        }}
                      >
                        <option value="">All sources</option>
                        {sources.map((source) => (
                          <option key={source.key} value={source.key}>
                            {source.name} · {source.runtimeName}
                          </option>
                        ))}
                      </ChoicePicker>
                      {mode === 'issues' && (
                        <ChoicePicker
                          aria-label="Project links"
                          className="h-8 w-auto text-xs"
                          value={linked}
                          onValueChange={setLinked}
                        >
                          <option value="all">All project links</option>
                          <option value="unlinked">Not linked to a project</option>
                          <option value="linked">Linked to a project</option>
                        </ChoicePicker>
                      )}
                      <ChoicePicker
                        aria-label="Sort results"
                        className="h-8 w-auto text-xs"
                        value={sort}
                        onValueChange={setSort}
                      >
                        <option value="updated">Recently updated</option>
                        <option value="project">Source</option>
                        <option value="title">{uiText('Title')}</option>
                      </ChoicePicker>
                      {(hasFilters || sort !== 'updated') && (
                        <Button
                          className="h-8 text-xs"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSearch('')
                            setLinked('all')
                            setState(defaultState)
                            setProject('')
                            setSort('updated')
                          }}
                        >
                          Clear filters
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {pipelineRunNotice && (
            <p
              id="pipeline-run-notice"
              className="flex flex-wrap items-center gap-x-2 border-b border-border/70 px-3 py-1 text-xs text-muted-foreground"
            >
              <span>{pipelineRunNotice}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => host.navigate({ viewId: 'source-control' })}
              >
                Sources
              </Button>
            </p>
          )}
          {error && (
            <p role="alert" className="px-5 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <div
            ref={list}
            tabIndex={-1}
            className="relative min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3"
          >
            <p
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute bottom-3 left-5 z-10 rounded-md border bg-popover px-2 py-1 text-xs text-muted-foreground empty:hidden"
            >
              {opening
                ? 'Opening on its computer…'
                : busy
                  ? `${visiblePages.some((page) => page.items.length) ? 'Updating' : 'Loading'} ${mode}…`
                  : visiblePages.length && !visiblePages.some((page) => page.reader.connected)
                    ? visiblePages.some((page) => page.items.length)
                      ? 'Offline · showing saved results.'
                      : `Connect to load ${mode}.`
                    : ''}
            </p>
            {!sources.length &&
              (isJira ? (
                <EmptyState
                  icon={<CircleDot />}
                  title="Connect Jira"
                  description="Browse Jira issues and link them to code projects when you’re ready to work on them."
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={opening}
                      onClick={() => void chooseSource('settings')}
                    >
                      Connect Jira
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-3 py-8 text-sm text-muted-foreground">
                  <p>Connect a code project to browse its issues.</p>
                </div>
              ))}
            {!!sourceProblems.length && (
              <div
                className="mb-4 space-y-2 rounded-xl border bg-muted/15 p-3"
                aria-label="Issue source status"
              >
                {sourceProblems.map((page) => (
                  <div key={page.source.key} className="flex items-start gap-2 text-xs">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {page.source.name}
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          · {page.source.runtimeName}
                        </span>
                      </p>
                      <p
                        role={page.error || page.optionsError ? 'alert' : 'status'}
                        className="mt-1 break-words text-muted-foreground"
                      >
                        {page.error ||
                          page.optionsError ||
                          (mode === 'issues'
                            ? page.options?.issueNotice
                            : page.options?.pipelineNotice)}
                      </p>
                    </div>
                    {(page.error || page.optionsError) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !page.reader.connected}
                        onClick={refresh}
                      >
                        {uiText('Retry')}
                      </Button>
                    )}
                    {mode === 'issues' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={opening || !page.source.connected}
                        onClick={() => void chooseSource('settings', page.source)}
                      >
                        {page.source.jira ? 'Manage Jira' : 'Connect Jira'}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!busy && !!sources.length && !rows.length && (
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
                <CircleDot className="size-7 text-muted-foreground/60" />
                <p className="text-sm font-medium">
                  {isJira && !hasFilters
                    ? 'No open issues found'
                    : hasFilters
                      ? `No matching ${mode}`
                      : mode === 'issues'
                        ? project
                          ? 'No issues found'
                          : 'Your issues, in one place'
                        : 'No pipeline runs yet'}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {isJira && !hasFilters
                    ? 'Try all statuses to see completed work, or check your issue sources.'
                    : hasFilters
                      ? 'Try another search or state, or check your issue sources.'
                      : mode === 'issues'
                        ? project
                          ? 'No issues are available for this source.'
                          : sourceKind === 'jira'
                            ? 'Browse Jira issues and link them to code projects when you are ready to work on them.'
                            : 'Browse issues from your code projects.'
                        : 'Runs from your connected project will appear here.'}
                </p>
                {isJira && !hasFilters ? (
                  <Button size="sm" variant="outline" onClick={() => setState('all')}>
                    Show all issues
                  </Button>
                ) : hasFilters ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setLinked('all')
                      setState(defaultState)
                      setProject('')
                      if (isJira) setJiraFilters({})
                      if (isJira) setSelected(null)
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  mode === 'issues' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void chooseSource('settings')}
                    >
                      Manage issue sources
                    </Button>
                  )
                )}
              </div>
            )}
            {isJira ? (
              !!sources.length && (
                <JiraIssueList
                  layout={jiraLayout}
                  rows={rows.flatMap((row) =>
                    'state' in row.item ? [{ ...row, item: row.item }] : [],
                  )}
                  selected={selected}
                  opening={opening}
                  onOpen={open}
                />
              )
            ) : (
              <div className="studio-work-list">
                {rows.map(({ source, item, stale, provider }) => (
                  <button
                    type="button"
                    key={JSON.stringify([source.key, item.id])}
                    disabled={opening}
                    className="studio-collection-row w-full text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
                    onClick={() => void open(source, item.id, item.url)}
                  >
                    <div className="studio-collection-body">
                      <div className="studio-collection-meta">
                        {'status' in item ? (
                          <PipelineState status={item.status} plain />
                        ) : (
                          <span
                            className={`studio-collection-status ${item.state === 'closed' ? 'text-status-done' : 'text-status-success'}`}
                          >
                            {item.state === 'closed' ? (
                              <CircleCheck aria-hidden className="size-3.5" />
                            ) : (
                              <CircleDot aria-hidden className="size-3.5" />
                            )}
                            {item.state.charAt(0).toUpperCase() + item.state.slice(1)}
                          </span>
                        )}
                        <span className="min-w-0 truncate">
                          {'status' in item ? `Run ${item.number || item.id}` : issueLabel(item.id)}{' '}
                          · {source.name}
                          {source.jira
                            ? ` · ${source.jira.project}`
                            : provider && provider !== 'jira'
                              ? ` · ${forgeLabels[provider]}`
                              : ''}
                        </span>
                        {'state' in item && <span>{item.type}</span>}
                      </div>
                      <span className="studio-collection-title">{item.title}</span>
                      <div className="studio-collection-context">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <Monitor className="size-3 shrink-0" />
                          <span className="truncate">
                            {source.runtimeName}
                            {!source.connected ? ' · Offline' : stale ? ' · Cached' : ''}
                          </span>
                        </span>
                        {'status' in item ? (
                          <>
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <GitBranch className="size-3 shrink-0" />
                              <span className="truncate">{item.ref}</span>
                            </span>
                            <span>{item.actor}</span>
                          </>
                        ) : (
                          <>
                            {source.jira && (
                              <span>{source.projectLinks?.[item.id] ?? 'No project linked'}</span>
                            )}
                            <span>{item.author}</span>
                            {item.priority && (
                              <span className="studio-collection-label">
                                Priority: {item.priority}
                              </span>
                            )}
                            <span className="text-foreground/80">
                              {(item.assigneeNames ?? item.assignees).length
                                ? `Assigned to ${(item.assigneeNames ?? item.assignees).join(', ')}`
                                : 'Unassigned'}
                            </span>
                            {item.labels.slice(0, 3).map((label) => (
                              <span className="studio-collection-label" key={label} title={label}>
                                {label}
                              </span>
                            ))}
                            {item.labels.length > 3 && (
                              <span title={item.labels.slice(3).join(', ')}>
                                +{item.labels.length - 3} labels
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <time
                      className="studio-collection-date"
                      dateTime={item.updatedAt}
                      title={item.updatedAt ? formatDateTime(item.updatedAt) : undefined}
                    >
                      {item.updatedAt && !Number.isNaN(Date.parse(item.updatedAt))
                        ? formatDateTime(item.updatedAt, { dateStyle: 'medium' })
                        : ''}
                    </time>
                  </button>
                ))}
              </div>
            )}
            {visiblePages.map((page) => (
              <div key={page.source.key} className="mt-3 text-xs">
                {page.next && (
                  <Button
                    className="mt-2"
                    variant="outline"
                    size="sm"
                    disabled={busy || !page.reader.connected}
                    onClick={() => void more(page.source.key)}
                  >
                    Load more · {page.source.name} · {page.source.runtimeName}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </nav>
      {selected && (
        <aside
          ref={preview}
          style={detailStyle}
          tabIndex={-1}
          aria-label={isJira ? 'Jira issue preview' : `${mode} detail`}
          className="studio-page-surface studio-detail-transition flex min-h-0 min-w-0 flex-1 flex-col bg-background outline-none"
        >
          {detail}
        </aside>
      )}
      {picking && (
        <SourcePicker
          title={mode === 'issues' ? 'New issue' : 'Run pipeline'}
          sources={canCreate.filter((source) => matchesWorkSource(source, projectRemote))}
          onClose={() => setPicking(false)}
          onSelect={(source) => {
            const page = pages.find(
              (page) => page.source.key === source.key && page.source.scope === source.scope,
            )
            if (page?.options && !page.optionsError) setCreating({ source, options: page.options })
            setPicking(false)
          }}
        />
      )}
      {settings && <JiraSourcesDialog onClose={() => setSettings(false)} onSaved={refresh} />}
      {createPage?.options && (
        <WorkspaceRuntimeScope runtimeId={createPage.source.runtimeId}>
          <WorkForm
            key={createPage.source.scope}
            available={allSources.some(
              (source) =>
                source.key === createPage.source.key && source.scope === createPage.source.scope,
            )}
            kind={mode === 'issues' ? 'create' : 'run'}
            repositoryId={createPage.source.repository?.id}
            jiraSourceId={createPage.source.jira?.id}
            initialRef={createPage.source.repository?.branch ?? ''}
            options={createPage.options}
            onClose={() => setCreating(null)}
            onDone={(_message, result) => {
              setCreating(null)
              refresh()
              if (mode === 'issues' && result?.id)
                setSelected({
                  source: createPage.source,
                  id: result.id,
                  url: result.url,
                })
            }}
          />
        </WorkspaceRuntimeScope>
      )}
    </section>
  )
}

function ScopedWorkContent(props: Omit<Parameters<typeof WorkContent>[0], 'request'>) {
  const { request } = useWorkspace()
  return <WorkContent {...props} request={request} />
}
