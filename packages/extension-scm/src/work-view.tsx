import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CircleDot,
  GitBranch,
  Monitor,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Plus,
  AlertCircle,
} from 'lucide-react'
import {
  useWorkspace,
  decodeWorkTarget,
  repositorySourceKey,
  issueLabel,
  forgeLabels,
  matchesWorkItem,
  type StudioViewProps,
} from '@dovo/studio-core'
import { Button, ChoicePicker, Input } from '@dovo/studio-ui'
import { JiraSourcesDialog } from './jira-binding'
import { jiraSourceKey, type WorkSource } from './work-sources'
import { PipelineState } from './pipeline-detail'
import { WorkContent, WorkForm } from './work-detail'
import { SourcePicker } from './source-picker'
import { useWorkSources } from './use-work-sources'

type Mode = 'issues' | 'pipelines'
export default function IssuesView({ entityId }: StudioViewProps) {
  return <WorkView mode="issues" entityId={entityId} />
}
export function PipelinesView({ entityId }: StudioViewProps) {
  return <WorkView mode="pipelines" entityId={entityId} />
}
function WorkView({ mode, entityId }: { mode: Mode; entityId?: string }) {
  const { activeRuntimeId, switchRuntime, connected, request } = useWorkspace()
  const [project, setProject] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(mode === 'issues' ? search.trim() : ''), 300)
    return () => clearTimeout(timer)
  }, [mode, search])
  const { sources, pages, busy, refresh, more } = useWorkSources(mode, query)
  const [state, setState] = useState('all')
  const [sort, setSort] = useState('updated')
  const [linked, setLinked] = useState('all')
  const [selected, setSelected] = useState<{
    source: WorkSource
    id: string
    url?: string
  } | null>(null)
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState<WorkSource | null>(null)
  const [settings, setSettings] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const lastTarget = useRef<string | undefined>(undefined)
  const selectedSource = sources.find(
    (source) => source.key === selected?.source.key && source.scope === selected.source.scope,
  )
  const createPage = pages.find(
    (page) => page.source.key === creating?.key && page.source.scope === creating.scope,
  )
  useEffect(() => {
    if (lastTarget.current === entityId) return
    const target = decodeWorkTarget(entityId)
    if (!target) {
      lastTarget.current = entityId
      return
    }
    const source = sources.find(
      (source) =>
        source.key ===
        (target.jiraSourceId
          ? jiraSourceKey(activeRuntimeId ?? '', target.jiraSourceId)
          : repositorySourceKey(activeRuntimeId ?? '', target.repositoryId ?? '')),
    )
    if (!source) return
    lastTarget.current = entityId
    setProject(source.key)
    setSearch(target.sha ?? '')
    setSelected(target.id ? { source, id: target.id, url: target.url } : null)
  }, [entityId, activeRuntimeId, sources])
  const open = async (source: WorkSource, id: string, url: string) => {
    if (pending.current) return
    pending.current = true
    setOpening(true)
    setError('')
    try {
      if (activeRuntimeId !== source.runtimeId) await switchRuntime(source.runtimeId)
      setSelected({ source, id, url })
    } catch (error) {
      setError(String(error))
    } finally {
      pending.current = false
      setOpening(false)
    }
  }
  const visiblePages = pages.filter((page) => !project || page.source.key === project)
  const rows = visiblePages
    .flatMap((page) =>
      page.items.map((item) => ({
        source: page.source,
        item,
        stale: page.stale,
        provider: page.options?.provider,
        serverMatched: !!page.query && page.query === search.trim(),
      })),
    )
    .filter(
      ({ source, item, serverMatched }) =>
        (state === 'all' || ('state' in item ? item.state : item.status) === state) &&
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
            b.item.updatedAt.localeCompare(a.item.updatedAt)
          : a.item.updatedAt && b.item.updatedAt
            ? b.item.updatedAt.localeCompare(a.item.updatedAt)
            : 0,
    )
  const states = [
    ...new Set(
      visiblePages.flatMap((page) =>
        page.items.map((item) => ('state' in item ? item.state : item.status)),
      ),
    ),
  ].sort()
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
      : canCreate.filter((source) => !project || source.key === project)
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
      if (source.runtimeId !== activeRuntimeId) await switchRuntime(source.runtimeId)
      setCreating(source)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setOpening(false)
    }
  }
  const visibleSources = sources.filter((source) => !project || source.key === project)
  const sourceProblems = visiblePages.filter(
    (page) =>
      page.error ||
      (mode === 'issues'
        ? !page.options?.issues && page.options?.issueNotice
        : !page.options?.pipelines && page.options?.pipelineNotice),
  )
  const hasFilters = !!search || state !== 'all' || linked !== 'all'
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!selected && (
        <header className="space-y-3 border-b px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="mr-2 text-lg font-semibold tracking-tight">
              {mode === 'issues' ? 'Issues' : 'Pipelines'}
            </h1>
            <span className="text-xs text-muted-foreground">
              {rows.length} loaded · {visibleSources.length}{' '}
              {visibleSources.length === 1 ? 'source' : 'sources'}
            </span>
            <div className="relative ml-auto min-w-40 max-w-full flex-1 sm:max-w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="h-9 w-full pl-9 text-sm"
                aria-label={`Search ${mode}`}
                placeholder={
                  mode === 'issues'
                    ? 'Search issue titles, keys, text…'
                    : 'Search runs, branches, projects…'
                }
                value={search}
                maxLength={300}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !sources.some((source) => source.connected)}
              onClick={refresh}
            >
              <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {mode === 'issues' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={opening}
                onClick={() => void chooseSource('settings')}
              >
                <SlidersHorizontal className="size-3.5" /> Sources
              </Button>
            )}
            <Button
              size="sm"
              disabled={
                opening ||
                !(project ? canCreate.some((source) => source.key === project) : canCreate.length)
              }
              onClick={() => void chooseSource('create')}
            >
              <Plus className="size-3.5" />
              {mode === 'issues' ? 'New issue' : 'Run pipeline'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <ChoicePicker
              aria-label="Issue source"
              className="h-8 w-auto max-w-72 text-xs"
              value={project}
              onValueChange={(value) => {
                setProject(value)
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
            <ChoicePicker
              aria-label={mode === 'issues' ? 'Issue state' : 'Pipeline status'}
              className="h-8 w-auto text-xs"
              value={state}
              onValueChange={setState}
            >
              <option value="all">All states</option>
              {states.map((state) => (
                <option key={state}>{state}</option>
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
              <option value="title">Title</option>
            </ChoicePicker>
            {mode === 'issues' && (
              <span className="self-center text-[11px] text-muted-foreground">
                Search your issue trackers · states filter loaded results
              </span>
            )}
            {hasFilters && (
              <Button
                className="h-8 text-xs"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setLinked('all')
                  setState('all')
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </header>
      )}
      {opening && (
        <p role="status" className="px-5 py-2 text-xs text-muted-foreground">
          Opening on its computer…
        </p>
      )}
      {error && (
        <p role="alert" className="px-5 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {selected ? (
        selectedSource && selectedSource.runtimeId === activeRuntimeId ? (
          <WorkContent
            key={JSON.stringify([selectedSource.scope, selected.id, mode])}
            repositoryId={selectedSource.repository?.id}
            jiraSourceId={selectedSource.jira?.id}
            repositoryName={`${selectedSource.name} · ${selectedSource.runtimeName}`}
            collectionHeader={null}
            branch={selectedSource.repository?.branch ?? ''}
            initialSelected={selected.id}
            initialSourceURL={selected.url}
            mode={mode}
            request={request}
            connected={connected}
            onBack={() => {
              setSelected(null)
              refresh()
            }}
          />
        ) : (
          <div className="p-5 text-sm">
            <p>This source connection changed. Open the item again from the list.</p>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              <ArrowLeft className="size-4" />
              Back to {mode}
            </Button>
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {busy && (
            <p role="status" className="py-2 text-xs text-muted-foreground">
              Refreshing {mode}…
            </p>
          )}
          {!sources.length && (
            <p className="py-8 text-sm text-muted-foreground">
              Connect Jira from Sources to browse issues. You can link them to a code project later.
            </p>
          )}
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
                      role={page.error ? 'alert' : 'status'}
                      className="mt-1 break-words text-muted-foreground"
                    >
                      {page.error ||
                        (mode === 'issues'
                          ? page.options?.issueNotice
                          : page.options?.pipelineNotice)}
                    </p>
                  </div>
                  {page.error && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !page.source.connected}
                      onClick={refresh}
                    >
                      Retry
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
                {hasFilters
                  ? `No matching ${mode}`
                  : mode === 'issues'
                    ? project
                      ? 'No issues found'
                      : 'Your issues, in one place'
                    : 'No pipeline runs yet'}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {hasFilters
                  ? 'Try another search or state, or check your issue sources.'
                  : mode === 'issues'
                    ? project
                      ? 'No issues are available for this source.'
                      : 'Browse Jira and code-host issues together. Link a Jira issue to a code project when you are ready to work on it.'
                    : 'Runs from your connected project will appear here.'}
              </p>
              {hasFilters ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setLinked('all')
                    setState('all')
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                mode === 'issues' && (
                  <Button size="sm" variant="outline" onClick={() => void chooseSource('settings')}>
                    Manage issue sources
                  </Button>
                )
              )}
            </div>
          )}
          <div className="divide-y">
            {rows.map(({ source, item, stale, provider }) => (
              <button
                type="button"
                key={JSON.stringify([source.key, item.id])}
                disabled={opening}
                className="block w-full min-w-0 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
                onClick={() => void open(source, item.id, item.url)}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {'status' in item ? (
                    <PipelineState status={item.status} />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded bg-muted/40 px-1.5 py-0.5">
                      <CircleDot className="size-3.5" />
                      {item.state}
                    </span>
                  )}
                  <span>
                    {'status' in item ? `Run ${item.number || item.id}` : issueLabel(item.id)} ·{' '}
                    {source.name}
                    {source.jira
                      ? ` · ${source.jira.project}`
                      : provider && provider !== 'jira'
                        ? ` · ${forgeLabels[provider]}`
                        : ''}
                  </span>
                  {'state' in item && <span>{item.type}</span>}
                  <time className="ml-auto" dateTime={item.updatedAt}>
                    {item.updatedAt && !Number.isNaN(Date.parse(item.updatedAt))
                      ? new Date(item.updatedAt).toLocaleDateString()
                      : ''}
                  </time>
                </div>
                <span className="my-1.5 block break-words text-sm font-medium">{item.title}</span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
                      {!!item.assignees.length && (
                        <span>Assigned to {(item.assigneeNames ?? item.assignees).join(', ')}</span>
                      )}
                      {item.labels.map((label) => (
                        <span className="rounded bg-muted px-1.5 py-0.5" key={label}>
                          {label}
                        </span>
                      ))}
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
          {visiblePages.map((page) => (
            <div key={page.source.key} className="mt-3 text-xs">
              {page.next && (
                <Button
                  className="mt-2"
                  variant="outline"
                  size="sm"
                  disabled={busy || !page.source.connected}
                  onClick={() => void more(page.source.key)}
                >
                  Load more · {page.source.name} · {page.source.runtimeName}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {picking && (
        <SourcePicker
          title={mode === 'issues' ? 'New issue' : 'Run pipeline'}
          sources={canCreate.filter((source) => !project || source.key === project)}
          onClose={() => setPicking(false)}
          onSelect={(source) => {
            setCreating(source)
            setPicking(false)
          }}
        />
      )}
      {settings && <JiraSourcesDialog onClose={() => setSettings(false)} onSaved={refresh} />}
      {createPage?.options && activeRuntimeId === createPage.source.runtimeId && (
        <WorkForm
          key={createPage.source.scope}
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
              setSelected({ source: createPage.source, id: result.id, url: result.url })
          }}
        />
      )}
    </section>
  )
}
