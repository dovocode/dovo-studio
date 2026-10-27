import { useIssueDiscussion } from './use-issue-discussion'
import { usePipelineSections } from './use-pipeline-sections'
import { PipelineSectionStatus } from './pipeline-section-status'
import {
  useDetailReader,
  verifySourceReader,
  sourceIdentityInput,
} from '../connections/source-readers'
import { useIssueSources, workRemoteKey } from './work-sources'
import { integrationMutationError } from '../connections/mutation-error'
import { readWorkDetailCache, workDetailCacheKeys } from './work-detail-cache'
import { useApplicationState } from '@dovo/studio-core/state'
import { WorkForm } from './work-form'
import { IssueDetail } from './issue-detail'
import { formatDate } from './format-date'
import { PipelineDetail as PipelineDetailView } from './pipeline-detail'
import { PipelineState } from './pipeline-state'
import { ArrowLeft, GitBranch, Search, CircleDot, MoreHorizontal, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Effect, Schema } from 'effect'
import {
  useWorkspace,
  startPolling,
  issueLabel,
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
  type ForgeWorkOptions,
  type ForgeIssueDetail,
  type ForgePipelineSection,
} from '@dovo/studio-core'
import {
  Button,
  PageHeader,
  ChoicePicker,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  active = true,
  onBack,
  preview = false,
  onChanged,
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
  active?: boolean
  onBack?: () => void
  preview?: boolean
  onChanged?: () => void
}) {
  const [options, setOptions] = useApplicationState<ForgeWorkOptions | undefined>(undefined)
  const [rows, setRows] = useApplicationState<Array<ForgeIssue | ForgePipeline>>([])
  const [search, setSearch] = useApplicationState(initialSearch ?? '')
  const [next, setNext] = useApplicationState<string | undefined>(undefined)
  const [cursor, setCursor] = useApplicationState<string | undefined>(undefined)
  const [state, setState] = useApplicationState('all')
  const [selected, setSelected] = useApplicationState(initialSelected ?? '')
  const [issueOverview, setIssue] = useApplicationState<ForgeIssueDetail | undefined>(undefined)
  const [pipelineOverview, setPipeline] = useApplicationState<PipelineDetail | undefined>(undefined)
  const [revision, reload] = useApplicationState(0)
  const [error, setError] = useApplicationState('')
  const [message, setMessage] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [stale, setStale] = useApplicationState(false)
  const [form, setForm] = useApplicationState<
    'create' | 'edit' | 'comment' | 'run' | 'transition' | null
  >(null)
  const [confirm, updateConfirm] = useApplicationState<
    'rerun' | 'cancel' | 'enable' | 'disable' | null
  >(null)
  const loadedDetailPages = useRef(1)
  const confirmationDestination = useRef<string | undefined>(undefined)
  const setConfirm = (action: typeof confirm) => {
    confirmationDestination.current = action
      ? (pipeline?.destination ?? pipeline?.run.destination ?? options?.destination)
      : undefined
    updateConfirm(action)
  }
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
  const { workspace, readCache, activeRuntimeId } = useWorkspace()
  const sources = useIssueSources(true, false)
  const origin = sources.find(
    (source) =>
      source.runtimeId === activeRuntimeId &&
      (jiraSourceId ? source.jira?.id === jiraSourceId : source.repository?.id === repositoryId),
  )
  const { reader, destination } = useDetailReader(
    origin,
    sources,
    JSON.stringify([mode, selected]),
    workRemoteKey,
    true,
    active,
  )
  const readConnected = active && (reader?.connected ?? (!origin && connected))
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
  const loadPipelineSection = useCallback(
    async (
      section: ForgePipelineSection,
      cursor: string | undefined,
      refresh: boolean,
      revision: string,
    ) => {
      const guard = reader ? await Effect.runPromise(verifySourceReader(reader)) : undefined
      const value = await (reader?.request ?? request)(
        '/api/scm/work/pipelines/detail',
        {
          ...(reader ? sourceIdentityInput(reader) : target),
          ...guard,
          id: selected,
          section,
          cursor,
          refresh,
          revision,
        },
        forgePipelineDetailSchema,
      )
      if (selected === initialSelected && initialSourceURL && value.run.url !== initialSourceURL)
        throw new Error('This pipeline source changed. Open the original source below.')
      return reader && reader.key !== origin?.key
        ? { ...value, destination, run: { ...value.run, destination } }
        : value
    },
    [
      reader,
      request,
      target,
      selected,
      initialSelected,
      initialSourceURL,
      destination,
      origin?.key,
    ],
  )
  const pipelineSections = usePipelineSections({
    overview:
      mode === 'pipelines' && pipelineOverview?.run.id === selected ? pipelineOverview : undefined,
    cacheKey: detailKey,
    readCache,
    enabled: mode === 'pipelines' && !!selected && readConnected,
    refreshToken: revision,
    load: loadPipelineSection,
    refreshOverview: () => reload((value) => value + 1),
  })
  const pipeline = pipelineSections.detail
  const loadIssueDiscussion = useCallback(
    async (
      section: 'discussion',
      cursor: string | undefined,
      refresh: boolean,
      revision: string,
    ) => {
      const guard = reader ? await Effect.runPromise(verifySourceReader(reader)) : undefined
      const value = await (reader?.request ?? request)(
        '/api/scm/work/issues/detail',
        {
          ...(reader ? sourceIdentityInput(reader) : target),
          ...guard,
          id: selected,
          section,
          cursor,
          refresh,
          revision,
        },
        forgeIssueDetailSchema,
      )
      if (selected === initialSelected && initialSourceURL && value.issue.url !== initialSourceURL)
        throw new Error('This issue source changed. Open the original source below.')
      return reader && reader.key !== origin?.key
        ? { ...value, destination, issue: { ...value.issue, destination } }
        : value
    },
    [
      reader,
      request,
      target,
      selected,
      initialSelected,
      initialSourceURL,
      destination,
      origin?.key,
    ],
  )
  const discussion = useIssueDiscussion({
    overview: jiraSourceId && issueOverview?.issue.id === selected ? issueOverview : undefined,
    cacheKey: detailKey,
    readCache,
    enabled: !!jiraSourceId && mode === 'issues' && !!selected && readConnected,
    refreshToken: revision,
    load: loadIssueDiscussion,
    refreshOverview: () => reload((value) => value + 1),
  })
  const issue = jiraSourceId ? discussion.issue : issueOverview
  const [workOptionsError, setWorkOptionsError] = useApplicationState('')
  const [optionsRevision, reloadOptions] = useApplicationState(0)
  useEffect(() => {
    if (
      (!jiraSourceId && mode !== 'pipelines') ||
      !selected ||
      !readConnected ||
      (jiraSourceId && !issueOverview)
    )
      return
    let stopped = false
    const polling = startPolling(
      Effect.tryPromise({
        try: async () => {
          if (document.visibilityState !== 'visible') return
          const guard = reader ? await Effect.runPromise(verifySourceReader(reader)) : undefined
          const value = await (reader?.request ?? request)(
            '/api/scm/work/options',
            { ...(reader ? sourceIdentityInput(reader) : target), ...guard, area: mode },
            forgeWorkOptionsSchema,
          )
          if (stopped) return
          const options = reader && reader.key !== origin?.key ? { ...value, destination } : value
          setOptions(options)
          setWorkOptionsError('')
          await readCache?.write(optionsKey, options)
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      {
        interval: 30000,
        onError: (error) => {
          if (!stopped) setWorkOptionsError(error.message)
        },
      },
    )
    document.addEventListener('visibilitychange', polling.refresh)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', polling.refresh)
      void polling.stop()
    }
  }, [
    mode,
    selected,
    readConnected,
    reader,
    request,
    target,
    destination,
    origin?.key,
    readCache,
    optionsKey,
    revision,
    optionsRevision,
    jiraSourceId,
    !!issueOverview,
  ])
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
      setWorkOptionsError('')
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
        if (!current() || !readConnected || document.visibilityState !== 'visible') return
        const readGuard = reader ? await Effect.runPromise(verifySourceReader(reader)) : undefined
        if (!current()) return
        const readRequest = reader?.request ?? request
        const readTarget = {
          ...(reader ? sourceIdentityInput(reader) : target),
          ...readGuard,
        }
        const refresh = force
        force = false
        if (mode === 'pipelines' && selected) {
          let data = await readRequest(
            base + 'pipelines/detail',
            { ...readTarget, id: selected, refresh, section: 'overview' },
            forgePipelineDetailSchema,
          )
          if (!current()) return
          if (
            selected === initialSelected &&
            initialSourceURL &&
            data.run.url !== initialSourceURL
          ) {
            setPipeline(undefined)
            throw new Error('This pipeline source changed. Open the original source below.')
          }
          if (reader && reader.key !== origin?.key)
            data = { ...data, destination, run: { ...data.run, destination } }
          setPipeline(data)
          setStale(!!data.stale || !!data.refreshError)
          setError(data.refreshError ?? '')
          await save(detailKey, { ...data, overviewOnly: true })
          return
        }
        if (jiraSourceId && mode === 'issues' && selected) {
          let data = await readRequest(
            base + 'issues/detail',
            { ...readTarget, id: selected, refresh, section: 'overview' },
            forgeIssueDetailSchema,
          )
          if (!current()) return
          if (
            selected === initialSelected &&
            initialSourceURL &&
            data.issue.url !== initialSourceURL
          ) {
            setIssue(undefined)
            throw new Error('This issue source changed. Open the original source below.')
          }
          if (reader && reader.key !== origin?.key)
            data = { ...data, destination, issue: { ...data.issue, destination } }
          setIssue(data)
          setStale(!!data.stale || !!data.refreshError)
          setError(data.refreshError ?? '')
          await save(detailKey, { ...data, overviewOnly: true })
          return
        }
        const loadedOptions = await readRequest(
          base + 'options',
          {
            ...readTarget,
            area: mode,
          },
          forgeWorkOptionsSchema,
        )
        if (!current()) return
        const opts =
          reader && reader.key !== origin?.key ? { ...loadedOptions, destination } : loadedOptions
        setOptions(opts)
        if (!(mode === 'issues' ? opts.issues : opts.pipelines)) {
          setRows([])
          return
        }
        if (selected) {
          if (mode === 'issues') {
            let data = await readRequest(
              base + 'issues/detail',
              {
                ...readTarget,
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
                const next = await readRequest(
                  base + 'issues/detail',
                  {
                    ...readTarget,
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
              if (reader && reader.key !== origin?.key)
                data = { ...data, destination, issue: { ...data.issue, destination } }
              setIssue(data)
              setStale(!!data.stale || !!data.refreshError)
              setError(data.refreshError ?? '')
              await save(detailKey, { ...data, loadedPages: loadedDetailPages.current })
            }
          }
        } else {
          const data =
            mode === 'issues'
              ? await readRequest(
                  base + 'issues/list',
                  {
                    ...readTarget,
                    state,
                    cursor,
                    refresh,
                  },
                  forgeIssuePageSchema,
                )
              : await readRequest(
                  base + 'pipelines/list',
                  {
                    ...readTarget,
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
    readConnected,
    reader,
    destination,
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
    onChanged?.()
  }
  const moreDetail = async () => {
    if (mode === 'pipelines') {
      pipelineSections.jobs.more()
      return
    }
    if (jiraSourceId) {
      discussion.more()
      return
    }
    if (pending.current || busy || !readConnected) return
    const current = requests.current.begin()
    setError('')
    pending.current = true
    setBusy(true)
    try {
      const readGuard = reader ? await Effect.runPromise(verifySourceReader(reader)) : undefined
      if (!current()) return
      const readRequest = reader?.request ?? request
      const readTarget = {
        ...(reader ? sourceIdentityInput(reader) : target),
        ...readGuard,
      }
      if (issue?.next) {
        const data = await readRequest(
          base + 'issues/detail',
          {
            ...readTarget,
            id: selected,
            cursor: issue.next,
          },
          forgeIssueDetailSchema,
        )
        if (!current()) return
        if (data.issue.url !== issue.issue.url) throw new Error('This issue source changed.')
        const merged = {
          ...data,
          ...(reader && reader.key !== origin?.key
            ? { destination, issue: { ...data.issue, destination } }
            : {}),
          comments: appendUniqueRows(issue.comments, data.comments),
        }
        setIssue(merged)
        loadedDetailPages.current++
        setStale(stale || !!data.stale)
        setError(data.refreshError ?? '')
        if (readCache)
          await readCache.write(detailKey, { ...merged, loadedPages: loadedDetailPages.current })
      }
    } catch (e) {
      if (current()) setError(integrationMutationError(e))
    } finally {
      if (current()) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {selected && (
        <PageHeader
          embedded={preview}
          title={
            <>
              <span className="studio-titlebar-project">{repositoryName}</span>
              <span className="studio-titlebar-divider"> / </span>
              <span className="studio-titlebar-task">
                {issue?.issue.title ?? pipeline?.run.title ?? selected}
              </span>
            </>
          }
          leading={
            <Button
              size="icon"
              variant="ghost"
              aria-label={preview && mode === 'pipelines' ? 'Back to runs' : `Back to ${mode}`}
              onClick={() => (onBack ? onBack() : setSelected(''))}
            >
              <ArrowLeft className="size-4" />
            </Button>
          }
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={!readConnected || busy}
            onClick={() => reload((v) => v + 1)}
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </PageHeader>
      )}
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

            {!selected && mode === 'issues' && (
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
            )}
            {!selected && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!readConnected || busy}
                onClick={() => reload((v) => v + 1)}
              >
                <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            )}

            {!selected && mode === 'issues' && options?.issues && (
              <Button
                size="sm"
                disabled={!connected || busy || stale || !options || !!workOptionsError}
                onClick={() => setForm('create')}
              >
                New issue
              </Button>
            )}
            {!selected && mode === 'pipelines' && options?.pipelineActions.includes('run') && (
              <Button
                size="sm"
                disabled={!connected || busy || stale || !options || !!workOptionsError}
                onClick={() => setForm('run')}
              >
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
                    disabled={!connected || busy || stale || !options || !!workOptionsError}
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
              {readConnected
                ? 'Original computer offline · reading through an available source. Changes remain unavailable.'
                : `Offline · showing loaded ${mode}. Connect to refresh or make changes.`}
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
          {jiraSourceId && workOptionsError && (
            <div role="alert" className="my-3 flex items-center gap-3 text-sm text-destructive">
              <span>Issue actions: {workOptionsError}</span>
              <Button size="sm" variant="outline" onClick={() => reloadOptions((v) => v + 1)}>
                Retry actions
              </Button>
            </div>
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
                  disabled={busy || !readConnected}
                  variant="outline"
                  onClick={() => setCursor(undefined)}
                >
                  First page
                </Button>
              )}
              {next && (
                <Button
                  disabled={busy || !readConnected}
                  variant="outline"
                  onClick={() => setCursor(next)}
                >
                  Next page
                </Button>
              )}
            </div>
          )}
          {issue && selected === issue.issue.id && (
            <IssueDetail
              detail={issue}
              discussionState={jiraSourceId ? discussion : undefined}
              actionsReady={!!options && !workOptionsError}
              preview={preview}
              provider={jiraSourceId ? 'jira' : options?.provider}
              repositoryId={repositoryId}
              jiraSourceId={jiraSourceId}
              connected={connected}
              readConnected={readConnected}
              busy={busy}
              stale={stale}
              notice={options?.issueNotice}
              onEdit={() => setForm('edit')}
              onTransition={() => setForm('transition')}
              onComment={() => setForm('comment')}
              onMore={() => void moreDetail()}
            />
          )}
          {pipeline && repositoryId && selected === pipeline.run.id && (
            <PipelineDetailView
              key={pipeline.run.url}
              detail={pipeline}
              notice={workOptionsError || options?.pipelineNotice}
              repositoryId={repositoryId}
              disabled={busy || stale}
              loading={pipelineSections.jobs.busy || !readConnected}
              jobsReady={pipelineSections.jobs.ready}
              graphReady={pipelineSections.graph.ready}
              jobsStatus={
                <PipelineSectionStatus
                  label="Jobs"
                  state={pipelineSections.jobs}
                  connected={readConnected}
                />
              }
              graphStatus={
                <PipelineSectionStatus
                  label="Workflow"
                  state={pipelineSections.graph}
                  connected={readConnected}
                />
              }
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
                      expectedDestination: confirmationDestination.current,
                      id:
                        confirm === 'enable' || confirm === 'disable'
                          ? pipeline.run.definition
                          : pipeline.run.id,
                    },
                    forgeWorkResultSchema,
                  )
                    .then((r) => changed(r.message))
                    .catch((e) => setError(integrationMutationError(e)))
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
    </div>
  )
}
