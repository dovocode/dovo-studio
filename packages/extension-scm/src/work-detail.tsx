import { readWorkDetailCache, workDetailCacheKeys } from './work-detail-cache'
import { useApplicationState } from '@dovo/studio-core/state'
import { decode } from '@dovo/protocol'
import { issueEditInput } from '@dovo/studio-core'
import { WorkTaskLinks } from './work-task-links'
import { PipelineDetail as PipelineDetailView, PipelineState } from './pipeline-detail'
import {
  ArrowLeft,
  GitBranch,
  Search,
  CircleDot,
  MoreHorizontal,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Effect, Schema } from 'effect'
import {
  useWorkspace,
  startPolling,
  issueLabel,
  forgeLabels,
  matchesWorkItem,
  pipelineActionAllowed,
  type ForgeIssue,
  type ForgePipeline,
  appendUniqueRows,
  RequestScope,
  forgeWorkOptionsSchema,
  forgeIssuePageSchema,
  forgeIssueDetailSchema,
  forgePipelinePageSchema,
  forgePipelineDetailSchema,
  forgeWorkResultSchema,
  forgeIssueCreateSchema,
  forgeIssueActionSchema,
  forgePipelineActionSchema,
  forgeDefinitionsSchema,
  type ForgeWorkOptions,
  type ForgeIssueDetail,
  type ForgeWorkResult,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  Input,
  Textarea,
  FormField,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  MessageResponse,
  DropdownMenu,
} from '@dovo/studio-ui'
type Mode = 'issues' | 'pipelines'
type PipelineDetail = Schema.Schema.Type<typeof forgePipelineDetailSchema>
export function WorkContent({
  repositoryId,
  jiraSourceId,
  repositoryName,
  collectionHeader,
  branch = '',
  initialSelected,
  initialSearch,
  initialSourceURL,
  mode,
  request,
  connected,
  onBack,
}: {
  repositoryId?: string
  jiraSourceId?: string
  repositoryName: string
  collectionHeader: ReactNode
  branch?: string
  initialSelected?: string
  initialSearch?: string
  initialSourceURL?: string
  mode: Mode
  request: ReturnType<typeof useWorkspace>['request']
  connected: boolean
  onBack?: () => void
}) {
  const [options, setOptions] = useApplicationState<ForgeWorkOptions | undefined>(undefined)
  const [rows, setRows] = useApplicationState<Array<ForgeIssue | ForgePipeline>>([])
  const [search, setSearch] = useApplicationState(initialSearch ?? '')
  const [next, setNext] = useApplicationState<string | undefined>(undefined)
  const [cursor, setCursor] = useApplicationState<string | undefined>(undefined)
  const [state, setState] = useApplicationState('all')
  const [selected, setSelected] = useApplicationState(initialSelected ?? '')
  const [issue, setIssue] = useApplicationState<ForgeIssueDetail | undefined>(undefined)
  const [pipeline, setPipeline] = useApplicationState<PipelineDetail | undefined>(undefined)
  const [revision, reload] = useApplicationState(0)
  const [error, setError] = useApplicationState('')
  const [message, setMessage] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [stale, setStale] = useApplicationState(false)
  const [form, setForm] = useApplicationState<
    'create' | 'edit' | 'comment' | 'run' | 'transition' | null
  >(null)
  const [confirm, setConfirm] = useApplicationState<
    'rerun' | 'cancel' | 'enable' | 'disable' | null
  >(null)
  const loadedDetailPages = useRef(1)
  const pending = useRef(false)
  const requests = useRef(new RequestScope())
  const target = useMemo(
    () =>
      jiraSourceId
        ? {
            jiraSourceId,
          }
        : {
            repositoryId,
          },
    [jiraSourceId, repositoryId],
  )
  const { workspace, readCache } = useWorkspace()
  const keys = workDetailCacheKeys(
    {
      repository: workspace.repositories.find((repo) => repo.id === repositoryId),
      jira: workspace.jiraSources?.find((source) => source.id === jiraSourceId),
    },
    mode,
    selected,
  )
  const optionsKey = keys.options
  const detailKey = keys.detail
  const cacheScope = useRef({ detailKey, readCache })
  const base = '/api/scm/work/'
  useEffect(() => {
    let stopped = false
    let hydrated = false
    let force = revision > 0
    pending.current = false
    setStale(true)
    setBusy(true)
    setError('')
    const sameSource =
      cacheScope.current.detailKey === detailKey && cacheScope.current.readCache === readCache
    cacheScope.current = { detailKey, readCache }
    setIssue((value) => (sameSource && value?.issue.id === selected ? value : undefined))
    setPipeline((value) => (sameSource && value?.run.id === selected ? value : undefined))
    if (!sameSource) {
      setOptions(undefined)
      loadedDetailPages.current = 1
    }
    const load = async () => {
      if (stopped || pending.current) return
      const valid = requests.current.begin()
      const current = () => !stopped && valid()
      const save = async (key: string, value: unknown) => {
        if (!readCache || !current()) return
        try {
          await readCache.write(key, value)
        } catch {
          if (current()) setError('Details loaded, but could not be saved for offline use.')
        }
      }
      try {
        if (!hydrated && selected && readCache && (revision === 0 || !sameSource)) {
          hydrated = true
          try {
            const saved = await readWorkDetailCache(
              readCache,
              { options: optionsKey, detail: detailKey },
              mode,
              selected === initialSelected ? initialSourceURL : undefined,
            )
            if (!current()) return
            if (saved.options) setOptions(saved.options)
            if (saved.issue) setIssue(saved.issue)
            if (saved.pipeline) setPipeline(saved.pipeline)
            loadedDetailPages.current = saved.issue?.loadedPages ?? saved.pipeline?.loadedPages ?? 1
          } catch (error) {
            if (current())
              setError(error instanceof Error ? error.message : 'Saved details could not be read.')
          }
        }
        if (!current() || !connected || document.visibilityState !== 'visible') return
        const refresh = force
        force = false
        const opts = await request(
          base + 'options',
          {
            ...target,
            area: mode,
          },
          forgeWorkOptionsSchema,
        )
        if (!current()) return
        setOptions(opts)
        if (!(mode === 'issues' ? opts.issues : opts.pipelines)) {
          setRows([])
          return
        }
        if (selected) {
          if (mode === 'issues') {
            let data = await request(
              base + 'issues/detail',
              {
                ...target,
                id: selected,
                refresh,
              },
              forgeIssueDetailSchema,
            )
            if (current()) {
              if (
                selected === initialSelected &&
                initialSourceURL &&
                data.issue.url !== initialSourceURL
              ) {
                setIssue(undefined)
                throw new Error('This issue source changed. Open the original source below.')
              }
              let pages = 1
              const wanted = refresh ? 1 : loadedDetailPages.current
              while (data.next && pages < wanted) {
                const next = await request(
                  base + 'issues/detail',
                  {
                    ...target,
                    id: selected,
                    cursor: data.next,
                    refresh,
                  },
                  forgeIssueDetailSchema,
                )
                if (!current()) return
                if (next.issue.url !== data.issue.url) throw new Error('This issue source changed.')
                data = {
                  ...next,
                  comments: appendUniqueRows(data.comments, next.comments),
                  stale: data.stale || next.stale,
                  refreshError: data.refreshError || next.refreshError,
                }
                pages++
              }
              loadedDetailPages.current = pages
              setIssue(data)
              setStale(!!data.stale || !!data.refreshError)
              setError(data.refreshError ?? '')
              await save(detailKey, { ...data, loadedPages: loadedDetailPages.current })
            }
          } else {
            let data = await request(
              base + 'pipelines/detail',
              {
                ...target,
                id: selected,
                refresh,
              },
              forgePipelineDetailSchema,
            )
            if (current()) {
              if (
                selected === initialSelected &&
                initialSourceURL &&
                data.run.url !== initialSourceURL
              ) {
                setPipeline(undefined)
                throw new Error(
                  'This project now uses a different pipeline source. Open the original source below.',
                )
              }
              let pages = 1
              const wanted = refresh ? 1 : loadedDetailPages.current
              while (data.next && pages < wanted) {
                const next = await request(
                  base + 'pipelines/detail',
                  {
                    ...target,
                    id: selected,
                    cursor: data.next,
                    refresh,
                  },
                  forgePipelineDetailSchema,
                )
                if (!current()) return
                if (next.run.url !== data.run.url) throw new Error('This pipeline source changed.')
                data = {
                  ...next,
                  jobs: appendUniqueRows(data.jobs, next.jobs),
                  stale: data.stale || next.stale,
                  refreshError: data.refreshError || next.refreshError,
                }
                pages++
              }
              loadedDetailPages.current = pages
              setPipeline(data)
              setStale(!!data.stale || !!data.refreshError)
              setError(data.refreshError ?? '')
              await save(detailKey, { ...data, loadedPages: loadedDetailPages.current })
            }
          }
        } else {
          const data =
            mode === 'issues'
              ? await request(
                  base + 'issues/list',
                  {
                    ...target,
                    state,
                    cursor,
                    refresh,
                  },
                  forgeIssuePageSchema,
                )
              : await request(
                  base + 'pipelines/list',
                  {
                    ...target,
                    cursor,
                    refresh,
                  },
                  forgePipelinePageSchema,
                )
          if (current()) {
            setRows(data.items)
            setNext(data.next)
            setStale(!!data.stale || !!data.refreshError)
            setError(data.refreshError ?? '')
          }
        }
        if (selected) await save(optionsKey, opts)
      } catch (error) {
        if (current()) {
          setStale(true)
          setError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (current()) setBusy(false)
      }
    }
    const polling = startPolling(
      Effect.tryPromise({
        try: load,
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      {
        interval: 30000,
        onError: (error) => {
          if (!stopped) setError(error.message)
        },
      },
    )
    document.addEventListener('visibilitychange', polling.refresh)
    return () => {
      stopped = true
      requests.current.cancel()
      document.removeEventListener('visibilitychange', polling.refresh)
      void polling.stop()
    }
  }, [
    connected,
    request,
    target,
    mode,
    selected,
    state,
    cursor,
    revision,
    initialSelected,
    initialSourceURL,
    readCache,
    optionsKey,
    detailKey,
  ])
  const visibleRows = rows.filter((row) => matchesWorkItem(row, search))
  const changed = async (message: string) => {
    requests.current.cancel()
    setMessage(message)
    setForm(null)
    setConfirm(null)
    // The mutation committed; never hydrate the pre-edit detail on a later visit.
    try {
      if (readCache && selected) await readCache.remove(detailKey)
    } catch {
      setMessage(message + ' Offline details could not be cleared.')
    }
    reload((v) => v + 1)
  }
  const moreDetail = async () => {
    if (pending.current || busy || !connected) return
    const current = requests.current.begin()
    setError('')
    pending.current = true
    setBusy(true)
    try {
      if (issue?.next) {
        const data = await request(
          base + 'issues/detail',
          {
            ...target,
            id: selected,
            cursor: issue.next,
          },
          forgeIssueDetailSchema,
        )
        if (!current()) return
        if (data.issue.url !== issue.issue.url) throw new Error('This issue source changed.')
        const merged = { ...data, comments: appendUniqueRows(issue.comments, data.comments) }
        setIssue(merged)
        loadedDetailPages.current++
        setStale(stale || !!data.stale)
        setError(data.refreshError ?? '')
        if (readCache)
          await readCache.write(detailKey, { ...merged, loadedPages: loadedDetailPages.current })
      } else if (pipeline?.next) {
        const data = await request(
          base + 'pipelines/detail',
          {
            ...target,
            id: selected,
            cursor: pipeline.next,
          },
          forgePipelineDetailSchema,
        )
        if (!current()) return
        if (data.run.url !== pipeline.run.url) throw new Error('This pipeline source changed.')
        const merged = { ...data, jobs: appendUniqueRows(pipeline.jobs, data.jobs) }
        setPipeline(merged)
        loadedDetailPages.current++
        setStale(stale || !!data.stale)
        setError(data.refreshError ?? '')
        if (readCache)
          await readCache.write(detailKey, { ...merged, loadedPages: loadedDetailPages.current })
      }
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (current()) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {!selected && collectionHeader}
      <div className="px-5 py-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {!selected && (
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label={`Search ${mode}`}
                className="h-9 pl-9 text-sm"
                placeholder={
                  mode === 'issues'
                    ? 'Search issues, people, labels…'
                    : 'Search runs, branches, commits…'
                }
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          )}

          {selected ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (onBack ? onBack() : setSelected(''))}
              >
                <ArrowLeft className="size-4" /> Back to {mode}
              </Button>
              <span className="mr-auto min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {repositoryName}
                {options?.provider
                  ? ` · ${options.provider === 'jira' ? 'Jira' : forgeLabels[options.provider]}`
                  : ''}
              </span>
            </>
          ) : (
            mode === 'issues' && (
              <ChoicePicker
                className="h-8 w-auto min-w-36"
                aria-label="Issue state"
                value={state}
                onValueChange={(v) => {
                  setState(v)
                  setCursor(undefined)
                }}
              >
                <option value="all">All states</option>
                {options?.issueStates.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </ChoicePicker>
            )
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!connected || busy}
            onClick={() => reload((v) => v + 1)}
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          {!selected && mode === 'issues' && options?.issues && (
            <Button
              size="sm"
              disabled={!connected || busy || stale}
              onClick={() => setForm('create')}
            >
              New issue
            </Button>
          )}
          {!selected && mode === 'pipelines' && options?.pipelineActions.includes('run') && (
            <Button size="sm" disabled={!connected || busy || stale} onClick={() => setForm('run')}>
              Run pipeline
            </Button>
          )}
          {selected && (issue || pipeline) && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  size="icon"
                  className="size-8"
                  variant="ghost"
                  aria-label={issue ? 'Issue actions' : 'Pipeline actions'}
                  disabled={!connected || busy || stale}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 min-w-44 rounded-lg border bg-popover p-1 shadow-xl"
                >
                  {issue && (
                    <>
                      <DropdownMenu.Item
                        className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent"
                        onSelect={() => setForm('edit')}
                      >
                        Edit issue
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent"
                        onSelect={() => setForm('comment')}
                      >
                        Comment
                      </DropdownMenu.Item>
                      {options?.provider === 'jira' && (
                        <DropdownMenu.Item
                          className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent"
                          onSelect={() => setForm('transition')}
                        >
                          Change status
                        </DropdownMenu.Item>
                      )}
                    </>
                  )}
                  {pipeline && options?.pipelineActions.includes('run') && (
                    <DropdownMenu.Item
                      className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent"
                      onSelect={() => setForm('run')}
                    >
                      Run pipeline
                    </DropdownMenu.Item>
                  )}
                  {pipeline &&
                    options?.pipelineActions
                      .filter((action) => action !== 'run')
                      .filter((action) => pipelineActionAllowed(action, pipeline.run.status))
                      .map((action) => (
                        <DropdownMenu.Item
                          key={action}
                          className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40"
                          disabled={
                            (action === 'enable' || action === 'disable') &&
                            !pipeline.run.definition
                          }
                          onSelect={() => {
                            setError('')
                            setConfirm(action)
                          }}
                        >
                          {action[0]!.toUpperCase() + action.slice(1)}
                        </DropdownMenu.Item>
                      ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
        {!selected && (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {visibleRows.length}
              {search ? ` of ${rows.length}` : ''} on this page
            </span>
            {search && (
              <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                Clear search
              </Button>
            )}
          </div>
        )}
        {!connected && (
          <p role="status" className="mb-3 text-sm text-muted-foreground">
            Offline · showing loaded {mode}. Connect to refresh or make changes.
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {error && (
          <p role="alert" className="my-3 break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {error && selected === initialSelected && initialSourceURL && (
          <a
            href={initialSourceURL}
            target="_blank"
            rel="noreferrer"
            className="my-3 inline-block text-sm underline"
          >
            Open original source
          </a>
        )}
        {stale && !!(issue || pipeline || rows.length) && (
          <p className="text-sm text-muted-foreground">
            {connected
              ? 'Showing cached results while checking for updates.'
              : 'Showing saved results. Reconnect for live updates.'}
          </p>
        )}
        {message && (
          <p role="status" className="my-3 text-sm">
            {message}
          </p>
        )}
        {!selected && (mode === 'issues' ? options?.issueNotice : options?.pipelineNotice) && (
          <p role="status" className="mb-3 text-xs text-muted-foreground">
            {mode === 'issues' ? options?.issueNotice : options?.pipelineNotice}
          </p>
        )}
        {!selected && (
          <div className="divide-y">
            {visibleRows.map((row) => (
              <button
                type="button"
                key={row.id}
                className="block w-full min-w-0 p-3 text-left hover:bg-muted/50"
                onClick={() => setSelected(row.id)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {'status' in row ? (
                    <PipelineState status={row.status} />
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <CircleDot className="size-3.5" />
                      {row.state}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {'status' in row ? `Run ${row.number || row.id}` : issueLabel(row.id)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(row.updatedAt)}
                  </span>
                </div>
                <span className="my-1.5 block break-words text-sm font-medium leading-relaxed">
                  {row.title}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {'status' in row ? (
                    <>
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <GitBranch className="size-3 shrink-0" />
                        <span className="truncate">{row.ref}</span>
                      </span>
                      <span className="font-mono">{row.sha.slice(0, 8)}</span>
                      <span>{row.actor}</span>
                    </>
                  ) : (
                    <>
                      <span>{row.author}</span>
                      {row.priority && (
                        <span className="rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-foreground">
                          Priority: {row.priority}
                        </span>
                      )}
                      <span className="text-foreground/80">
                        {(row.assigneeNames ?? row.assignees).length
                          ? `Assigned to ${(row.assigneeNames ?? row.assignees).join(', ')}`
                          : 'Unassigned'}
                      </span>
                      {row.labels.slice(0, 3).map((label) => (
                        <span className="rounded bg-muted px-1.5 py-0.5" key={label}>
                          {label}
                        </span>
                      ))}
                      {row.labels.length > 3 && (
                        <span title={row.labels.slice(3).join(', ')}>
                          +{row.labels.length - 3} labels
                        </span>
                      )}
                    </>
                  )}
                </span>
              </button>
            ))}
            {!busy && !error && visibleRows.length === 0 && (
              <p className="py-8 text-muted-foreground">
                {search
                  ? 'No matches on this page. Clear the search or load the next page.'
                  : `No ${mode} to show.`}
              </p>
            )}
          </div>
        )}
        {!selected && (
          <div className="mt-4 flex gap-2">
            {cursor && (
              <Button
                disabled={busy || !connected}
                variant="outline"
                onClick={() => setCursor(undefined)}
              >
                First page
              </Button>
            )}
            {next && (
              <Button
                disabled={busy || !connected}
                variant="outline"
                onClick={() => setCursor(next)}
              >
                Next page
              </Button>
            )}
          </div>
        )}
        {issue && selected === issue.issue.id && (
          <article className="mx-auto max-w-4xl space-y-5" aria-label="Issue details">
            <header className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-foreground">
                  <CircleDot className="size-3.5" />
                  {issue.issue.state}
                </span>
                <span>
                  {[issueLabel(issue.issue.id), issue.issue.author].filter(Boolean).join(' · ')}
                </span>
                <a
                  href={issue.issue.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1.5 hover:text-foreground"
                >
                  Open on{' '}
                  {options?.provider
                    ? options.provider === 'jira'
                      ? 'Jira'
                      : forgeLabels[options.provider]
                    : 'server'}{' '}
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
              <h2 className="break-words text-xl font-semibold leading-snug">
                {issue.issue.title}
              </h2>
              <dl className="grid grid-cols-2 gap-3 rounded-md border bg-card p-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Assigned to</dt>
                  <dd className="mt-1 break-words">
                    {(issue.issue.assigneeNames ?? issue.issue.assignees).join(', ') ||
                      'Unassigned'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="mt-1">{issue.issue.type}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd className="mt-1">{formatDate(issue.issue.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Discussion</dt>
                  <dd className="mt-1">
                    {issue.comments.length}
                    {issue.next ? '+' : ''} comments loaded
                  </dd>
                </div>
              </dl>
              {issue.issue.priority && (
                <p className="text-xs">
                  <span className="text-muted-foreground">Priority</span>{' '}
                  <span className="ml-2 font-medium">{issue.issue.priority}</span>
                </p>
              )}
              {!!issue.issue.labels.length && (
                <div className="flex flex-wrap gap-1" aria-label="Labels">
                  {issue.issue.labels.map((label) => (
                    <span
                      key={label}
                      className="max-w-full break-words rounded bg-muted px-2 py-1 text-xs"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!connected || busy || stale}
                  onClick={() => setForm(options?.provider === 'jira' ? 'transition' : 'edit')}
                >
                  {options?.provider === 'jira' ? 'Change status' : 'Edit issue'}
                </Button>
                {options?.provider === 'jira' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!connected || busy || stale}
                    onClick={() => setForm('edit')}
                  >
                    Edit details
                  </Button>
                )}
              </div>
              <WorkTaskLinks
                key={JSON.stringify([jiraSourceId, repositoryId, issue.issue.url])}
                repositoryId={repositoryId}
                jiraSourceId={jiraSourceId}
                source={issue.issue}
                disabled={busy || stale}
              />
            </header>
            {options?.issueNotice && (
              <p role="status" className="text-xs text-muted-foreground">
                {options.issueNotice}
              </p>
            )}
            {issue.issue.bodyNotice && (
              <p role="status" className="text-xs text-muted-foreground">
                {issue.issue.bodyNotice}
              </p>
            )}
            <section
              aria-label="Issue description"
              className="min-w-0 max-w-prose border-t pt-5 text-sm leading-7"
            >
              <h3 className="mb-3 font-medium">Description</h3>
              <MessageResponse baseURL={issue.issue.url}>
                {(issue.issue.preview ?? issue.issue.body) || 'No description provided.'}
              </MessageResponse>
            </section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">
                Discussion
                {issue.comments.length ? ` · ${issue.comments.length}${issue.next ? '+' : ''}` : ''}
              </h3>
              <Button
                size="sm"
                variant="outline"
                disabled={!connected || busy || stale}
                onClick={() => setForm('comment')}
              >
                Comment
              </Button>
            </div>
            {issue.discussionNotice && (
              <p role="status" className="text-xs text-muted-foreground">
                {issue.discussionNotice}
              </p>
            )}
            {!issue.comments.length && (
              <p className="text-sm text-muted-foreground">
                No comments yet. Add context or start a linked task.
              </p>
            )}
            <div className="divide-y">
              {issue.comments.map((c) => (
                <section key={c.id} className="py-4">
                  <p className="mb-2 text-xs text-muted-foreground">
                    {c.author} · {formatDate(c.createdAt)}
                  </p>
                  <MessageResponse baseURL={c.url ?? issue.issue.url}>{c.body}</MessageResponse>
                </section>
              ))}
            </div>
            {issue.next && (
              <Button disabled={busy || !connected} onClick={() => void moreDetail()}>
                More comments
              </Button>
            )}
          </article>
        )}
        {pipeline && repositoryId && selected === pipeline.run.id && (
          <PipelineDetailView
            key={pipeline.run.url}
            detail={pipeline}
            notice={options?.pipelineNotice}
            repositoryId={repositoryId}
            disabled={busy || stale}
            loading={busy || !connected}
            onMore={() => void moreDetail()}
          />
        )}
        {form && options && (
          <WorkForm
            kind={form}
            repositoryId={repositoryId}
            jiraSourceId={jiraSourceId}
            issue={issue?.issue}
            initialRef={pipeline?.run.ref || branch}
            initialDefinition={pipeline?.run.definition}
            options={options}
            onClose={() => setForm(null)}
            onDone={changed}
          />
        )}
        <Dialog
          open={!!confirm}
          onOpenChange={(open) => {
            if (!open && !pending.current) setConfirm(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirm} pipeline?</DialogTitle>
              <DialogDescription>
                {pipeline?.run.title}. This changes the pipeline on its server.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="break-words text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              disabled={!connected || busy}
              onClick={() => {
                if (!confirm || !pipeline || pending.current) return
                pending.current = true
                setBusy(true)
                void request(
                  base + 'pipelines/action',
                  {
                    repositoryId,
                    action: confirm,
                    id:
                      confirm === 'enable' || confirm === 'disable'
                        ? pipeline.run.definition
                        : pipeline.run.id,
                  },
                  forgeWorkResultSchema,
                )
                  .then((r) => changed(r.message))
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => {
                    pending.current = false
                    setBusy(false)
                  })
              }}
            >
              Confirm {confirm}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
export function WorkForm({
  kind,
  repositoryId,
  jiraSourceId,
  issue: initialIssue,
  initialRef = '',
  initialDefinition,
  options,
  onClose,
  onDone,
}: {
  kind: 'create' | 'edit' | 'comment' | 'run' | 'transition'
  repositoryId?: string
  jiraSourceId?: string
  issue?: ForgeIssueDetail['issue']
  initialRef?: string
  initialDefinition?: string
  options: ForgeWorkOptions
  onClose: () => void
  onDone: (message: string, result?: ForgeWorkResult) => void
}) {
  const { request, connected } = useWorkspace()
  const target = useMemo(
    () =>
      jiraSourceId
        ? {
            jiraSourceId,
          }
        : {
            repositoryId,
          },
    [jiraSourceId, repositoryId],
  )
  const [issue] = useApplicationState(initialIssue)
  const [title, setTitle] = useApplicationState(kind === 'edit' ? (issue?.title ?? '') : '')
  const [body, setBody] = useApplicationState(kind === 'edit' ? (issue?.body ?? '') : '')
  const [type, setType] = useApplicationState(
    options.issueTypes[0] ?? (options.provider === 'jira' ? 'Task' : 'Issue'),
  )
  const [state, setState] = useApplicationState(issue?.state ?? '')
  const [assignees, setAssignees] = useApplicationState(issue?.assignees.join(', ') ?? '')
  const [labels, setLabels] = useApplicationState(issue?.labels.join(', ') ?? '')
  const [definition, setDefinition] = useApplicationState(initialDefinition ?? ''),
    [ref, setRef] = useApplicationState(initialRef),
    [inputs, setInputs] = useApplicationState('{}')
  const [definitions, setDefinitions] = useApplicationState<
    Schema.Schema.Type<typeof forgeDefinitionsSchema> | undefined
  >(undefined)
  const [definitionsLoading, setDefinitionsLoading] = useApplicationState(kind === 'run')
  const [definitionsRevision, retryDefinitions] = useApplicationState(0)
  const definitionRequests = useRef(new RequestScope())
  const definitionPending = useRef(false)
  const [issueStates, setIssueStates] = useApplicationState(options.issueStates)
  useEffect(() => {
    if (kind !== 'edit' || options.provider !== 'azure-devops' || !issue) return
    let current = true
    void request(
      '/api/scm/work/options',
      {
        ...target,
        type: issue.type,
        area: 'issues',
      },
      forgeWorkOptionsSchema,
    )
      .then((v) => {
        if (current) setIssueStates(v.issueStates)
      })
      .catch((e) => {
        if (current) setError(String(e))
      })
    return () => {
      current = false
    }
  }, [kind, options.provider, issue, target, request])
  const [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const pending = useRef(false)
  useEffect(() => {
    if (kind !== 'run') return
    const current = definitionRequests.current.begin()
    definitionPending.current = true
    setDefinitionsLoading(true)
    setError('')
    void request(
      '/api/scm/work/pipelines/definitions',
      {
        repositoryId,
      },
      forgeDefinitionsSchema,
    )
      .then((value) => {
        if (current()) {
          setDefinitions(value)
          setDefinition((chosen) => chosen || value.items[0]?.id || '')
        }
      })
      .catch((error) => {
        if (current()) setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (current()) {
          definitionPending.current = false
          setDefinitionsLoading(false)
        }
      })
    return () => definitionRequests.current.cancel()
  }, [kind, repositoryId, request, definitionsRevision])
  const moreDefinitions = async () => {
    if (!definitions?.next || definitionPending.current || busy || !connected) return
    definitionPending.current = true
    const current = definitionRequests.current.begin()
    setDefinitionsLoading(true)
    setError('')
    try {
      const value = await request(
        '/api/scm/work/pipelines/definitions',
        {
          repositoryId,
          cursor: definitions.next,
        },
        forgeDefinitionsSchema,
      )
      if (current())
        setDefinitions({
          ...value,
          items: appendUniqueRows(definitions.items, value.items),
        })
    } catch (error) {
      if (current()) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (current()) {
        definitionPending.current = false
        setDefinitionsLoading(false)
      }
    }
  }
  const split = (v: string) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const submit = async () => {
    if (
      pending.current ||
      !connected ||
      (kind === 'run' && (!definitions || definitionPending.current))
    )
      return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const data =
        kind === 'transition'
          ? {
              action: 'edit',
              id: issue?.id,
              revision: issue?.revision,
              state,
            }
          : kind === 'run'
            ? {
                action: 'run',
                definition,
                ref,
                inputs: decode(
                  Schema.mutable(
                    Schema.Record({
                      key: Schema.String,
                      value: Schema.String,
                    }),
                  ),
                  JSON.parse(inputs),
                ),
              }
            : kind === 'comment'
              ? {
                  action: 'comment',
                  id: issue?.id,
                  revision: issue?.revision,
                  body,
                }
              : kind === 'edit' && issue
                ? issueEditInput(issue, {
                    title,
                    body,
                    state,
                    ...(options.assignees
                      ? {
                          assignees: split(assignees),
                        }
                      : {}),
                    ...(options.labels
                      ? {
                          labels: split(labels),
                        }
                      : {}),
                  })
                : {
                    title,
                    body,
                    type,
                    assignees: split(assignees),
                    labels: split(labels),
                  }
      const result = await request(
        '/api/scm/work/' +
          (kind === 'run'
            ? 'pipelines/action'
            : kind === 'create'
              ? 'issues/create'
              : 'issues/action'),
        {
          ...target,
          ...(kind === 'run'
            ? decode(forgePipelineActionSchema, data)
            : kind === 'create'
              ? decode(forgeIssueCreateSchema, data)
              : decode(forgeIssueActionSchema, data)),
        },
        forgeWorkResultSchema,
      )
      onDone(result.message, result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {kind === 'transition'
              ? 'Change Jira status'
              : kind === 'run'
                ? 'Run pipeline'
                : kind === 'comment'
                  ? 'Add comment'
                  : kind === 'edit'
                    ? 'Edit issue'
                    : 'New issue'}
          </DialogTitle>
          <DialogDescription>
            {issue
              ? `${issueLabel(issue.id)} · ${issue.title}`
              : kind === 'run'
                ? 'Run a pipeline on the selected project’s server.'
                : options.provider === 'jira'
                  ? 'Create an issue in this Jira source. Linking it to a Dovo project is optional.'
                  : 'Create an issue in the selected project.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <fieldset className="grid gap-4" disabled={busy || !connected}>
            {kind === 'transition' ? (
              <FormField label="New Jira status">
                <Input
                  required
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="In Progress"
                />
                <p className="text-xs text-muted-foreground">
                  Current status: {issue?.state}. Enter a status allowed by this issue's Jira
                  workflow; Jira validates the transition.
                </p>
              </FormField>
            ) : kind === 'run' ? (
              <>
                <FormField label="Pipeline">
                  {definitions?.manual ? (
                    <Input
                      required
                      value={definition}
                      onChange={(e) => setDefinition(e.target.value)}
                    />
                  ) : (
                    <ChoicePicker
                      aria-label="Pipeline"
                      value={definition}
                      onValueChange={setDefinition}
                    >
                      {definition && !definitions?.items.some((item) => item.id === definition) && (
                        <option value={definition}>{definition} · Selected run</option>
                      )}
                      {definitions?.items.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </ChoicePicker>
                  )}
                </FormField>
                <p className="text-xs text-muted-foreground">{definitions?.hint}</p>
                {definitions?.next && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={definitionsLoading}
                    onClick={() => void moreDefinitions()}
                  >
                    More pipelines
                  </Button>
                )}
                {!definitions && !definitionsLoading && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => retryDefinitions((value) => value + 1)}
                  >
                    Retry pipelines
                  </Button>
                )}
                <FormField label="Branch or ref">
                  <Input required value={ref} onChange={(e) => setRef(e.target.value)} />
                </FormField>
                <FormField label="Inputs (JSON string values)">
                  <Textarea value={inputs} onChange={(e) => setInputs(e.target.value)} />
                </FormField>
              </>
            ) : (
              <>
                {kind !== 'comment' && (
                  <FormField label="Title">
                    <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
                  </FormField>
                )}
                <FormField
                  label={
                    kind === 'edit' && issue?.bodyFormat === 'html'
                      ? 'Description (original HTML)'
                      : 'Description'
                  }
                >
                  <Textarea
                    required={kind === 'comment'}
                    rows={6}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </FormField>
                {kind === 'create' &&
                  options.provider === 'jira' &&
                  options.issueTypes.length === 0 && (
                    <FormField label="Issue type">
                      <Input
                        required
                        value={type}
                        onChange={(e) => setType(e.target.value)}
                        placeholder="Task"
                      />
                    </FormField>
                  )}
                {kind === 'create' && options.issueTypes.length > 1 && (
                  <FormField label="Type">
                    <ChoicePicker aria-label="Issue type" value={type} onValueChange={setType}>
                      {options.issueTypes.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </ChoicePicker>
                  </FormField>
                )}
                {kind === 'edit' && issueStates.length > 0 && (
                  <FormField label="State">
                    <ChoicePicker aria-label="Issue state" value={state} onValueChange={setState}>
                      {issueStates.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </ChoicePicker>
                  </FormField>
                )}
                {kind !== 'comment' && options.assignees && (
                  <FormField
                    label={
                      options.provider === 'jira'
                        ? 'Assignee account ID'
                        : 'Assignees (comma separated)'
                    }
                  >
                    <Input value={assignees} onChange={(e) => setAssignees(e.target.value)} />
                    {options.provider === 'jira' && (
                      <p className="text-xs text-muted-foreground">
                        {issue?.assigneeNames?.length
                          ? `Currently ${issue.assigneeNames.join(', ')}. `
                          : ''}
                        Jira uses account IDs. Leave empty to unassign.
                      </p>
                    )}
                  </FormField>
                )}
                {kind !== 'comment' && options.labels && (
                  <FormField label="Labels (comma separated)">
                    <Input value={labels} onChange={(e) => setLabels(e.target.value)} />
                  </FormField>
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={kind === 'run' && (!definitions || definitionsLoading)}
              >
                {busy
                  ? 'Saving…'
                  : kind === 'create'
                    ? 'Create issue'
                    : kind === 'comment'
                      ? 'Post comment'
                      : kind === 'transition'
                        ? 'Change status'
                        : kind === 'run'
                          ? 'Run pipeline'
                          : 'Save changes'}
              </Button>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
function formatDate(value: string) {
  if (!value) return 'Not reported'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}
