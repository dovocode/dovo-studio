import { useIssueDiscussion } from './use-issue-discussion'
import { usePipelineSections } from './use-pipeline-sections'
import { PipelineSectionStatus } from './pipeline-section-status'
import { runtimeComputerName } from '@dovo/protocol'
import { useSourceReader } from '../source-reader'
import { useLinkOrigin } from '../../ui/content/link-origin'
import { openAppLink } from '../../ui/content/open-link'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { Effect, Schema, Semaphore } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import {
  appendUniqueRows,
  clientScopeKey,
  RequestScope,
  runClientEffect,
  startPolling,
} from '@dovo/client-runtime'
import { AppState } from 'react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import {
  forgeWorkOptionsSchema,
  mutableStruct,
  forgeIssueDetailSchema,
  forgePipelineDetailSchema,
  forgeWorkResultSchema,
  issueLabel,
  pipelineActionAllowed,
  type ForgeIssueDetail,
  type ForgePipelineDetail,
  type ForgeWorkOptions,
  type ForgePipelineSection,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { Action } from '../../ui/controls/action'
import { IconButton } from '../../ui/controls/icon-button'
import { ScreenHeader } from '../../ui/layout/screen-header'
import { Sheet } from '../../ui/layout/sheet'
import { Markdown } from '../../ui/content/markdown'
import { WorkMenu, type WorkMenuAction } from './work-menu'
import { WorkTaskAction } from './work-task-action'
import { JiraIssueProject } from './jira-issue-project'
import { WorkForm } from './work-form'
import { assertWorkSource, workCacheKey } from './work-cache'
import { formatDateTime } from '../../ui/content/format-date'
import { PipelineRunInfo, PipelineRunDetails, PipelineJobs } from '../pulls/detail/pipeline-details'
type WorkItemProps = {
  mode: 'issues' | 'pipelines'
  repositoryId?: string
  jiraSourceId?: string
  itemId: string
  expectedURL?: string
  onBack: () => void
}
type RunAction = 'rerun' | 'cancel' | 'enable' | 'disable'
const cachedIssueSchema = mutableStruct({
  ...forgeIssueDetailSchema.fields,
  loadedPages: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
    ),
  ),
})
const cachedPipelineSchema = mutableStruct({
  ...forgePipelineDetailSchema.fields,
  loadedPages: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
    ),
  ),
})

/** The route owns item identity; the collection remains mounted underneath. */
export function WorkItemScreen(props: WorkItemProps) {
  const { connection, snapshot } = useRuntime()
  const repository = props.jiraSourceId
    ? snapshot?.workspace.jiraSources?.find((item) => item.id === props.jiraSourceId)
    : snapshot?.workspace.repositories.find((item) => item.id === props.repositoryId)
  return (
    <WorkItemContent
      key={JSON.stringify([
        clientScopeKey(connection),
        workCacheKey(repository, props.mode, 'detail', {
          id: props.itemId,
        }),
        props.expectedURL,
        props.jiraSourceId,
      ])}
      {...props}
    />
  )
}
function WorkItemContent({
  repositoryId,
  jiraSourceId,
  mode,
  itemId: selected,
  expectedURL,
  onBack,
}: WorkItemProps) {
  const { colors, styles } = useTheme()

  const { read, connected, snapshot, profile, readCache, readEffect: mutationEffect } = useRuntime()
  const { readEffect, acceptCurrentAccount } = useSourceReader(repositoryId, jiraSourceId)
  const origin = useLinkOrigin(undefined, repositoryId, jiraSourceId)
  const { focused } = useNavigation()
  const repository = snapshot?.workspace.repositories.find((item) => item.id === repositoryId)
  const jiraSource = snapshot?.workspace.jiraSources?.find((source) => source.id === jiraSourceId)
  const sourceInput = jiraSourceId
    ? {
        jiraSourceId,
      }
    : {
        repositoryId,
      }
  const cacheSource = jiraSourceId ? jiraSource : repository
  const linkedProjectId = jiraSourceId
    ? snapshot?.workspace.jiraIssueLinks?.find(
        (link) => link.sourceId === jiraSourceId && link.issueId === selected,
      )?.repositoryId
    : repositoryId
  const optionsKey = workCacheKey(cacheSource, mode, 'options')
  const detailKey = workCacheKey(cacheSource, mode, 'detail', {
    id: selected,
  })
  const [options, setOptions] = useApplicationState<ForgeWorkOptions | undefined>(undefined)
  const [revision, reload] = useApplicationState(0)
  const [issueOverview, setIssue, issueRef] = useApplicationState<ForgeIssueDetail | undefined>(
    undefined,
  )
  const [pipelineOverview, setPipeline, pipelineRef] = useApplicationState<
    ForgePipelineDetail | undefined
  >(undefined)
  const loadPipelineSection = useCallback(
    async (
      section: ForgePipelineSection,
      cursor: string | undefined,
      refresh: boolean,
      revision: string,
    ) => {
      const value = await runClientEffect(
        readEffect(
          '/api/scm/work/pipelines/detail',
          { repositoryId, id: selected, section, cursor, refresh, revision },
          forgePipelineDetailSchema,
        ),
      )
      assertWorkSource('pipelines', value.run.url, expectedURL)
      return value
    },
    [readEffect, repositoryId, selected, expectedURL],
  )
  const pipelineSections = usePipelineSections({
    overview: mode === 'pipelines' ? pipelineOverview : undefined,
    cacheKey: detailKey,
    readCache,
    enabled: mode === 'pipelines' && connected && focused,
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
      const value = await runClientEffect(
        readEffect(
          '/api/scm/work/issues/detail',
          { repositoryId, jiraSourceId, id: selected, section, cursor, refresh, revision },
          forgeIssueDetailSchema,
        ),
      )
      assertWorkSource('issues', value.issue.url, expectedURL)
      return value
    },
    [readEffect, repositoryId, jiraSourceId, selected, expectedURL],
  )
  const discussion = useIssueDiscussion({
    overview: jiraSourceId ? issueOverview : undefined,
    cacheKey: detailKey,
    readCache,
    enabled: !!jiraSourceId && mode === 'issues' && connected && focused,
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
      !connected ||
      !focused ||
      (jiraSourceId && !issueOverview)
    )
      return
    let stopped = false
    const polling = startPolling(
      Effect.suspend(() =>
        AppState.currentState === 'active'
          ? readEffect(
              '/api/scm/work/options',
              { repositoryId, jiraSourceId, area: mode },
              forgeWorkOptionsSchema,
            ).pipe(
              Effect.tap((value) =>
                nativeEffect(() => {
                  if (!stopped) {
                    setOptions(value)
                    setWorkOptionsError('')
                  }
                }),
              ),
              Effect.flatMap((value) =>
                !stopped && readCache ? readCache.writeEffect(optionsKey, value) : Effect.void,
              ),
            )
          : Effect.void,
      ),
      {
        interval: 30000,
        onError: (error) => {
          if (!stopped) setWorkOptionsError(error.message)
        },
      },
    )
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.refresh()
    })
    return () => {
      stopped = true
      subscription.remove()
      void polling.stop()
    }
  }, [
    mode,
    connected,
    focused,
    readEffect,
    repositoryId,
    jiraSourceId,
    !!issueOverview,
    readCache,
    optionsKey,
    revision,
    optionsRevision,
  ])
  const [busy, setBusy] = useApplicationState(false)
  const [refreshing, setRefreshing] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [stale, setStale] = useApplicationState(false)
  const [message, setMessage] = useApplicationState('')
  const [form, setForm] = useApplicationState<'edit' | 'comment' | 'run' | 'transition' | null>(
    null,
  )
  const [confirm, setConfirm] = useApplicationState<RunAction | null>(null)
  const formOrigin = useRef<{
    issue?: ForgeIssueDetail['issue']
    options?: ForgeWorkOptions
    pipeline?: ForgePipelineDetail
  }>({})
  const confirmOrigin = useRef<ForgePipelineDetail | undefined>(undefined)
  const pending = useRef(false)
  const refreshInFlight = useRef(false)
  const hydrated = useRef(false)
  const loadedPages = useRef(1)
  const consumedRevision = useRef(0)
  const requests = useRef(new RequestScope())
  const [semaphore] = useState(() => Effect.runSync(Semaphore.make(1)))
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (!focused) return
    let stopped = false
    let force = revision > consumedRevision.current
    const load = Effect.suspend(() => {
      if (
        pending.current ||
        refreshInFlight.current ||
        form ||
        confirm ||
        AppState.currentState !== 'active'
      )
        return Effect.void
      return Effect.gen(function* () {
        const current = requests.current.begin()
        const valid = () => !stopped && current()
        refreshInFlight.current = true
        setRefreshing(true)
        const showBusy = force || (!issueRef.current && !pipelineRef.current)
        if (showBusy) setBusy(true)
        if (!hydrated.current) {
          hydrated.current = true
          yield* mobileWorkflow(function* () {
            const cachedOptions = yield* (
              readCache?.readEffect(optionsKey, forgeWorkOptionsSchema) ?? Effect.succeed(undefined)
            )
            if (!valid()) return
            if (cachedOptions) setOptions(cachedOptions.value)
            if (mode === 'issues') {
              const cached = yield* (
                readCache?.readEffect(detailKey, cachedIssueSchema) ?? Effect.succeed(undefined)
              )
              if (!valid()) return
              if (cached) {
                assertWorkSource(mode, cached.value.issue.url, expectedURL)
                setIssue(cached.value)
                loadedPages.current = cached.value.loadedPages ?? 1
                setStale(true)
              }
            } else {
              const cached = yield* (
                readCache?.readEffect(detailKey, cachedPipelineSchema) ?? Effect.succeed(undefined)
              )
              if (!valid()) return
              if (cached) {
                assertWorkSource(mode, cached.value.run.url, expectedURL)
                setPipeline(cached.value)
                loadedPages.current = cached.value.loadedPages ?? 1
                setStale(true)
              }
            }
          }).pipe(
            Effect.catch((cause) =>
              nativeEffect(() => {
                if (valid())
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Saved details could not be read from this device.',
                  )
              }),
            ),
          )
        }
        if (!connected || !valid()) {
          if (showBusy) setBusy(false)
          return
        }
        const refresh = force
        force = false
        consumedRevision.current = revision
        if (showBusy) setStale(true)
        if (mode === 'pipelines') {
          const data = yield* readEffect(
            '/api/scm/work/pipelines/detail',
            { ...sourceInput, id: selected, refresh, section: 'overview' },
            forgePipelineDetailSchema,
          )
          if (!valid()) return
          assertWorkSource(mode, data.run.url, expectedURL)
          setPipeline(data)
          setStale(!!data.stale || !!data.refreshError)
          setError(data.refreshError ?? '')
          yield* readCache?.writeEffect(detailKey, { ...data, overviewOnly: true }) ?? Effect.void
          return
        }
        if (jiraSourceId && mode === 'issues') {
          const data = yield* readEffect(
            '/api/scm/work/issues/detail',
            { ...sourceInput, id: selected, refresh, section: 'overview' },
            forgeIssueDetailSchema,
          )
          if (!valid()) return
          assertWorkSource(mode, data.issue.url, expectedURL)
          setIssue(data)
          setStale(!!data.stale || !!data.refreshError)
          setError(data.refreshError ?? '')
          yield* (
            readCache?.writeEffect(detailKey, { ...data, overviewOnly: true }) ?? Effect.void
          ).pipe(
            Effect.catch(() =>
              nativeEffect(() => {
                if (valid()) setError('Details loaded, but could not be saved for offline use.')
              }),
            ),
          )
          return
        }
        const opts = yield* readEffect(
          '/api/scm/work/options',
          { ...sourceInput, area: mode },
          forgeWorkOptionsSchema,
        )
        if (!valid()) return
        setOptions(opts)
        if (!(mode === 'issues' ? opts.issues : opts.pipelines)) {
          setStale(false)
          setError('')
          return
        }
        if (mode === 'issues') {
          let data = yield* readEffect(
            '/api/scm/work/issues/detail',
            { ...sourceInput, id: selected, refresh },
            forgeIssueDetailSchema,
          )
          if (!valid()) return
          assertWorkSource(mode, data.issue.url, expectedURL)
          let pagesLoaded = 1
          for (let page = 1; data.next && page < loadedPages.current; page++) {
            const next = yield* readEffect(
              '/api/scm/work/issues/detail',
              { ...sourceInput, id: selected, cursor: data.next },
              forgeIssueDetailSchema,
            )
            if (!valid()) return
            assertWorkSource(mode, next.issue.url, expectedURL ?? data.issue.url)
            data = {
              ...next,
              comments: appendUniqueRows(data.comments, next.comments),
              stale: data.stale || next.stale,
              refreshError: data.refreshError ?? next.refreshError,
            }
            pagesLoaded++
          }
          loadedPages.current = pagesLoaded
          setIssue(data)
          setStale(!!data.stale || !!data.refreshError)
          setError(data.refreshError ?? '')
          yield* mobileWorkflow(function* () {
            yield* readCache?.writeEffect(optionsKey, opts) ?? Effect.succeed(undefined)
            yield* (
              readCache?.writeEffect(detailKey, {
                ...data,
                loadedPages: loadedPages.current,
              }) ?? Effect.succeed(undefined)
            )
          }).pipe(
            Effect.catch(() =>
              nativeEffect(() => {
                if (valid()) setError('Details loaded, but could not be saved for offline use.')
              }),
            ),
          )
        }
      }).pipe(
        Effect.catch((cause) =>
          nativeEffect(() => {
            if (!stopped) {
              setStale(true)
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          }),
        ),
        Effect.ensuring(
          nativeEffect(() => {
            refreshInFlight.current = false
            setRefreshing(false)
            if (!stopped) setBusy(false)
          }).pipe(Effect.orDie),
        ),
      )
    })
    const polling = startPolling(semaphore.withPermits(1)(load), {
      interval: 30000,
      onError: () => {},
    })
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.refresh()
    })
    return () => {
      stopped = true
      requests.current.cancel()
      setBusy(false)
      subscription.remove()
      void polling.stop()
    }
  }, [
    read,
    readEffect,
    connected,
    repositoryId,
    jiraSourceId,
    mode,
    selected,
    revision,
    focused,
    expectedURL,
    readCache,
    optionsKey,
    detailKey,
    form,
    confirm,
    issueRef,
    pipelineRef,
  ])
  const done = (message: string) => {
    if (!alive.current) return
    setForm(null)
    setConfirm(null)
    setMessage(message)
    setStale(true)
    pending.current = true
    void runClientEffect(
      mobileWorkflow(function* () {
        yield* readCache?.removeEffect(detailKey) ?? Effect.succeed(undefined)
      }).pipe(
        Effect.catch(() =>
          nativeEffect(() =>
            setError('Updated details could not be cleared from offline storage.'),
          ),
        ),
        Effect.ensuring(
          nativeEffect(() => {
            pending.current = false
            reload((value) => value + 1)
          }).pipe(Effect.orDie),
        ),
      ),
    )
  }
  const more = () => {
    if (mode === 'pipelines') {
      pipelineSections.jobs.more()
      return Promise.resolve()
    }
    if (jiraSourceId) {
      discussion.more()
      return Promise.resolve()
    }
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current || refreshInFlight.current || busy || !connected || !focused) return
        const current = requests.current.begin()
        setError('')
        pending.current = true
        setBusy(true)
        return yield* mobileWorkflow(function* () {
          if (issue?.next) {
            const data = yield* readEffect(
              '/api/scm/work/issues/detail',
              {
                ...(jiraSourceId
                  ? {
                      jiraSourceId,
                    }
                  : {
                      repositoryId,
                    }),
                id: selected,
                cursor: issue.next,
              },
              forgeIssueDetailSchema,
            )
            if (!current()) return
            assertWorkSource(mode, data.issue.url, expectedURL ?? issue.issue.url)
            const merged = {
              ...data,
              comments: appendUniqueRows(issue.comments, data.comments),
              stale: issue.stale || data.stale,
              refreshError: issue.refreshError ?? data.refreshError,
            }
            setIssue(merged)
            loadedPages.current = Math.min(500, loadedPages.current + 1)
            setStale(stale || !!data.stale || !!data.refreshError)
            setError(data.refreshError ?? '')
            yield* mobileWorkflow(function* () {
              yield* (
                readCache?.writeEffect(detailKey, {
                  ...merged,
                  loadedPages: loadedPages.current,
                }) ?? Effect.succeed(undefined)
              )
            }).pipe(
              Effect.catch((_error) =>
                nativeEffect(() => {
                  if (current()) setError('Details loaded, but could not be saved for offline use.')
                }),
              ),
            )
          }
        }).pipe(
          Effect.catch((cause) =>
            nativeEffect(() => {
              if (current()) {
                setStale(true)
                setError(String(cause))
              }
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              if (current()) {
                pending.current = false
                setBusy(false)
              }
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  const open = (url: string) => {
    void runClientEffect(
      nativeEffect(() => openAppLink(url, false, origin)).pipe(
        Effect.catch((cause) => nativeEffect(() => setError(String(cause)))),
      ),
    )
  }
  const openForm = (kind: 'edit' | 'comment' | 'run' | 'transition') => {
    formOrigin.current = { issue: issue?.issue, options, pipeline }
    setForm(kind)
  }
  const confirmed = confirmOrigin.current ?? pipeline
  const mutationDisabled =
    !focused || !connected || busy || refreshing || stale || !options || !!workOptionsError
  const confirmAllowed = !!(
    confirm &&
    pipeline &&
    options?.pipelineActions.includes(confirm) &&
    pipelineActionAllowed(confirm, pipeline.run.status)
  )
  const actions: WorkMenuAction[] = [
    ...(issue
      ? [
          {
            label: 'Edit issue',
            disabled: mutationDisabled,
            onPress: () => openForm('edit'),
          },
          {
            label: 'Comment',
            disabled: mutationDisabled,
            onPress: () => openForm('comment'),
          },
          ...(options?.provider === 'jira'
            ? [
                {
                  label: 'Change status',
                  disabled: mutationDisabled,
                  onPress: () => openForm('transition'),
                },
              ]
            : []),
          {
            label: 'Open on server',
            onPress: () => open(issue.issue.url),
          },
        ]
      : []),
    ...(pipeline
      ? [
          {
            label: 'Open run and logs',
            onPress: () => open(pipeline.run.url),
          },
          ...(options?.pipelineActions.includes('run')
            ? [
                {
                  label: 'Run pipeline',
                  disabled: mutationDisabled,
                  onPress: () => openForm('run'),
                },
              ]
            : []),
          ...(options?.pipelineActions ?? [])
            .filter((action): action is RunAction => action !== 'run')
            .filter((action) => pipelineActionAllowed(action, pipeline.run.status))
            .map((action) => ({
              label: action[0]!.toUpperCase() + action.slice(1),
              disabled:
                mutationDisabled ||
                ((action === 'enable' || action === 'disable') && !pipeline.run.definition),
              onPress: () => {
                setError('')
                confirmOrigin.current = pipeline
                setConfirm(action)
              },
            })),
        ]
      : []),
    {
      label: 'Refresh details',
      disabled: !connected || busy,
      onPress: () => reload((value) => value + 1),
    },
  ]
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={
          mode === 'issues'
            ? `Issue ${issueLabel(selected)}`
            : `Run #${pipeline?.run.number ?? selected}`
        }
        subtitle={[
          jiraSource?.name || jiraSource?.project || repository?.name,
          runtimeComputerName({ profile, snapshot }),
        ]
          .filter(Boolean)
          .join(' · ')}
        leading={
          <IconButton
            icon="back"
            variant="glass"
            label={mode === 'issues' ? 'Back to issues' : 'Back to PR runs'}
            onPress={onBack}
          />
        }
        actions={<WorkMenu actions={actions} />}
      />
      <ScrollView
        testID="Work detail content"
        style={{
          flex: 1,
        }}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: 0,
            paddingBottom: 40,
            gap: 12,
            flexGrow: 1,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => reload((value) => value + 1)}
            enabled={connected}
            tintColor={colors.muted}
          />
        }
      >
        {!connected && <Text style={styles.muted}>Offline · showing last loaded {mode}.</Text>}
        {/different account/.test(error) && (
          <Action
            label="Use current account"
            secondary
            disabled={!connected || busy}
            onPress={() => {
              void runClientEffect(
                Effect.all([
                  readCache?.removeEffect(detailKey) ?? Effect.void,
                  readCache?.removeEffect(optionsKey) ?? Effect.void,
                ]).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      acceptCurrentAccount()
                      hydrated.current = true
                      setIssue(undefined)
                      setPipeline(undefined)
                      setOptions(undefined)
                      reload((value) => value + 1)
                    }),
                  ),
                  Effect.catch((error) => Effect.sync(() => setError(error.message))),
                ),
              )
            }}
          />
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {!issue && !pipeline && expectedURL && (
          <Action
            secondary
            label="Open original source on server"
            onPress={() => open(expectedURL)}
          />
        )}
        {stale && connected && !!(issue || pipeline) && (
          <Text style={styles.muted}>
            {busy ? 'Updating…' : 'Cached results. Refresh before making changes.'}
          </Text>
        )}
        {!!message && <Text style={styles.muted}>{message}</Text>}
        {!issue && !pipeline && !busy && (
          <Text style={styles.muted}>
            {(mode === 'issues' ? options?.issueNotice : options?.pipelineNotice) ??
              'Details are not available. Reconnect or refresh to try again.'}
          </Text>
        )}
        {!issue && !pipeline && busy && <Text style={styles.muted}>Loading details…</Text>}
        {issue && (
          <>
            <Text
              selectable
              style={[
                styles.title,
                {
                  fontSize: 22,
                  lineHeight: 28,
                },
              ]}
            >
              {issue.issue.title}
            </Text>
            <View
              style={[
                styles.row,
                {
                  gap: 8,
                },
              ]}
            >
              <Text
                style={[
                  styles.text,
                  {
                    fontSize: 14,
                    fontWeight: '600',
                    backgroundColor: colors.elevated,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  },
                ]}
              >
                {issue.issue.state}
              </Text>
              <Text style={styles.muted}>· {issue.issue.type}</Text>
              {jiraSourceId && <Text style={styles.muted}>· Jira</Text>}
            </View>
            <View
              style={{
                gap: 8,
                padding: 16,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              }}
            >
              <Text style={styles.muted}>
                Assigned to{' '}
                <Text style={styles.text}>
                  {(issue.issue.assigneeNames ?? issue.issue.assignees).join(', ') || 'Unassigned'}
                </Text>
              </Text>
              {issue.issue.priority && (
                <Text style={styles.muted}>
                  Priority <Text style={styles.text}>{issue.issue.priority}</Text>
                </Text>
              )}
              {!!issue.issue.author && (
                <Text style={styles.muted}>
                  Reported by <Text style={styles.text}>{issue.issue.author}</Text>
                </Text>
              )}
              <Text style={styles.muted}>
                {jiraSourceId && !discussion.ready
                  ? 'Loading discussion…'
                  : `${issue.comments.length}${issue.next ? '+' : ''} comments loaded`}
              </Text>
              {!!issue.issue.labels.length && (
                <Text style={styles.muted}>
                  Labels <Text style={styles.text}>{issue.issue.labels.join(' · ')}</Text>
                </Text>
              )}
              {issue.issue.updatedAt && !Number.isNaN(Date.parse(issue.issue.updatedAt)) && (
                <Text style={styles.muted}>Updated {formatDateTime(issue.issue.updatedAt)}</Text>
              )}
            </View>
            <View style={[styles.card, { padding: 16, borderRadius: 14, gap: 12 }]}>
              <Text
                accessibilityRole="header"
                style={[
                  styles.text,
                  {
                    fontWeight: '600',
                    paddingTop: 4,
                  },
                ]}
              >
                Description
              </Text>
              {!issue.issue.body && !issue.issue.preview && (
                <Text style={styles.muted}>No description provided.</Text>
              )}
              {!!issue.issue.bodyNotice && (
                <Text style={styles.muted}>{issue.issue.bodyNotice}</Text>
              )}
              <Markdown
                text={issue.issue.preview ?? issue.issue.body}
                baseURL={issue.issue.url}
                preserveLineBreaks
              />
            </View>
            {jiraSourceId && (
              <JiraIssueProject
                sourceId={jiraSourceId}
                issueId={issue.issue.id}
                disabled={mutationDisabled}
              />
            )}
            <WorkTaskAction
              key={`${issue.issue.url}:${issue.issue.revision}`}
              repositoryId={linkedProjectId}
              jiraSourceId={jiraSourceId}
              source={{
                kind: 'issue',
                item: issue.issue,
              }}
              disabled={mutationDisabled}
            />
            <Text
              accessibilityRole="header"
              style={[
                styles.text,
                {
                  fontWeight: '600',
                  paddingTop: 8,
                },
              ]}
            >
              Discussion · {issue.comments.length}
              {issue.next ? '+' : ''}
            </Text>
            <Action
              secondary
              label="Add comment"
              disabled={mutationDisabled}
              onPress={() => openForm('comment')}
            />
            {jiraSourceId && (
              <PipelineSectionStatus label="Discussion" state={discussion} connected={connected} />
            )}
            {jiraSourceId && workOptionsError && (
              <View style={styles.card}>
                <Text style={styles.error}>Issue actions: {workOptionsError}</Text>
                <Action
                  secondary
                  label="Retry actions"
                  onPress={() => reloadOptions((value) => value + 1)}
                />
              </View>
            )}
            {!issue.comments.length &&
              !issue.discussionNotice &&
              (!jiraSourceId || (discussion.ready && !discussion.error)) && (
                <Text style={styles.muted}>No comments yet.</Text>
              )}
            {!!options?.issueNotice && <Text style={styles.muted}>{options.issueNotice}</Text>}
            {!!issue.discussionNotice && <Text style={styles.muted}>{issue.discussionNotice}</Text>}
            {issue.comments.map((comment) => (
              <View
                key={comment.id}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  padding: 16,
                  gap: 8,
                }}
              >
                <Text style={styles.muted}>
                  {comment.author} · {formatDateTime(comment.createdAt)}
                </Text>
                <Markdown
                  text={comment.body}
                  baseURL={comment.url ?? issue.issue.url}
                  preserveLineBreaks
                />
              </View>
            ))}
            {issue.next && (
              <Action
                label="More comments"
                secondary
                disabled={(jiraSourceId ? discussion.busy : busy) || !connected}
                onPress={() => void more()}
              />
            )}
          </>
        )}
        {pipeline && (
          <>
            <PipelineRunInfo key={pipeline.run.id} run={pipeline.run} />
            <WorkTaskAction
              key={`${pipeline.run.url}:${pipeline.run.sha}`}
              repositoryId={repositoryId}
              source={{
                kind: 'pipeline',
                item: pipeline.run,
              }}
              disabled={mutationDisabled}
            />
            <PipelineSectionStatus
              label="Jobs"
              state={pipelineSections.jobs}
              connected={connected}
            />
            <PipelineSectionStatus
              label="Workflow"
              state={pipelineSections.graph}
              connected={connected}
            />
            {workOptionsError && <Text style={styles.error}>{workOptionsError}</Text>}
            <PipelineJobs
              ready={pipelineSections.jobs.ready}
              graph={pipeline.graph}
              graphNotice={pipeline.graphNotice}
              jobs={pipeline.jobs}
              hasMore={!!pipeline.next}
              onOpen={open}
            />
            <PipelineRunDetails run={pipeline.run} />
            {!!options?.pipelineNotice && (
              <Text style={styles.muted}>{options.pipelineNotice}</Text>
            )}
            {pipeline.next && (
              <Action
                label="More jobs"
                secondary
                disabled={pipelineSections.jobs.busy || !connected}
                onPress={() => void more()}
              />
            )}
          </>
        )}
      </ScrollView>
      {form && options && (
        <WorkForm
          kind={form}
          disabled={mutationDisabled}
          {...sourceInput}
          issue={formOrigin.current.issue}
          options={formOrigin.current.options ?? options}
          initialDefinition={formOrigin.current.pipeline?.run.definition}
          initialRef={formOrigin.current.pipeline?.run.ref || repository?.branch}
          onClose={() => setForm(null)}
          onDone={done}
        />
      )}
      {confirm && confirmed && (
        <Sheet
          title={`${confirm[0]!.toUpperCase() + confirm.slice(1)} pipeline?`}
          onClose={() => setConfirm(null)}
          busy={busy}
        >
          <Text style={styles.muted}>
            {confirmed.run.title}. This changes the pipeline on its server.
          </Text>
          <Action
            label={`Confirm ${confirm}`}
            disabled={mutationDisabled || !confirmAllowed}
            onPress={() => {
              if (pending.current || mutationDisabled || !confirmAllowed) return
              pending.current = true
              setBusy(true)
              void runClientEffect(
                mutationEffect(
                  '/api/scm/work/pipelines/action',
                  {
                    repositoryId,
                    action: confirm,
                    expectedDestination: confirmed.destination ?? confirmed.run.destination,
                    id:
                      confirm === 'enable' || confirm === 'disable'
                        ? confirmed.run.definition
                        : confirmed.run.id,
                  },
                  forgeWorkResultSchema,
                )
                  .pipe(Effect.flatMap((result) => nativeEffect(() => done(result.message))))
                  .pipe(
                    Effect.catch((cause) =>
                      nativeEffect(() => {
                        if (alive.current) setError(String(cause))
                      }),
                    ),
                  )
                  .pipe(
                    Effect.ensuring(
                      nativeEffect(() => {
                        pending.current = false
                        if (alive.current) setBusy(false)
                      }).pipe(Effect.orDie),
                    ),
                  ),
              )
            }}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
        </Sheet>
      )}
    </View>
  )
}
