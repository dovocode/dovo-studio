import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { Effect, Schema } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import {
  appendUniqueRows,
  clientScopeKey,
  RequestScope,
  runClientEffect,
  startPolling,
} from '@dovo/client-runtime'
import { AppState } from 'react-native'
import { useEffect, useRef, useState } from 'react'
import { Linking, RefreshControl, ScrollView, View } from 'react-native'
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
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'
import { Action } from '../ui/action'
import { IconButton } from '../ui/icon-button'
import { ScreenHeader } from '../ui/screen-header'
import { Sheet } from '../ui/sheet'
import { Markdown } from '../ui/markdown'
import { WorkMenu, type WorkMenuAction } from './work-menu'
import { WorkTaskAction } from './work-task-action'
import { JiraIssueProject } from './jira-issue-project'
import { WorkForm } from './work-form'
import { assertWorkSource, workCacheKey } from './work-cache'
import { PipelineRunInfo, PipelineRunDetails, PipelineJobs } from './pipeline-details'
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
  loadedPages: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 500))),
})
const cachedPipelineSchema = mutableStruct({
  ...forgePipelineDetailSchema.fields,
  loadedPages: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 500))),
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
  const { read, connected, snapshot, profile, readCache, readEffect } = useRuntime()
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
  const [issue, setIssue, issueRef] = useApplicationState<ForgeIssueDetail | undefined>(undefined)
  const [pipeline, setPipeline, pipelineRef] = useApplicationState<ForgePipelineDetail | undefined>(
    undefined,
  )
  const [busy, setBusy] = useApplicationState(false)
  const [refreshing, setRefreshing] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [stale, setStale] = useApplicationState(false)
  const [message, setMessage] = useApplicationState('')
  const [form, setForm] = useApplicationState<'edit' | 'comment' | 'run' | 'transition' | null>(
    null,
  )
  const [confirm, setConfirm] = useApplicationState<RunAction | null>(null)
  const pending = useRef(false)
  const refreshInFlight = useRef(false)
  const hydrated = useRef(false)
  const loadedPages = useRef(1)
  const consumedRevision = useRef(0)
  const requests = useRef(new RequestScope())
  const [semaphore] = useState(() => Effect.runSync(Effect.makeSemaphore(1)))
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
            Effect.catchAll((cause) =>
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
            Effect.catchAll(() =>
              nativeEffect(() => {
                if (valid()) setError('Details loaded, but could not be saved for offline use.')
              }),
            ),
          )
        } else {
          let data = yield* readEffect(
            '/api/scm/work/pipelines/detail',
            { ...sourceInput, id: selected, refresh },
            forgePipelineDetailSchema,
          )
          if (!valid()) return
          assertWorkSource(mode, data.run.url, expectedURL)
          let pagesLoaded = 1
          for (let page = 1; data.next && page < loadedPages.current; page++) {
            const next = yield* readEffect(
              '/api/scm/work/pipelines/detail',
              { ...sourceInput, id: selected, cursor: data.next },
              forgePipelineDetailSchema,
            )
            if (!valid()) return
            assertWorkSource(mode, next.run.url, expectedURL ?? data.run.url)
            data = {
              ...next,
              jobs: appendUniqueRows(data.jobs, next.jobs),
              stale: data.stale || next.stale,
              refreshError: data.refreshError ?? next.refreshError,
            }
            pagesLoaded++
          }
          loadedPages.current = pagesLoaded
          setPipeline(data)
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
            Effect.catchAll(() =>
              nativeEffect(() => {
                if (valid()) setError('Details loaded, but could not be saved for offline use.')
              }),
            ),
          )
        }
      }).pipe(
        Effect.catchAll((cause) =>
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
        Effect.catchAll(() =>
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
              Effect.catchAll((_error) =>
                nativeEffect(() => {
                  if (current()) setError('Details loaded, but could not be saved for offline use.')
                }),
              ),
            )
          }
          if (pipeline?.next) {
            const data = yield* readEffect(
              '/api/scm/work/pipelines/detail',
              {
                ...(jiraSourceId
                  ? {
                      jiraSourceId,
                    }
                  : {
                      repositoryId,
                    }),
                id: selected,
                cursor: pipeline.next,
              },
              forgePipelineDetailSchema,
            )
            if (!current()) return
            assertWorkSource(mode, data.run.url, expectedURL ?? pipeline.run.url)
            const merged = {
              ...data,
              jobs: appendUniqueRows(pipeline.jobs, data.jobs),
              stale: pipeline.stale || data.stale,
              refreshError: pipeline.refreshError ?? data.refreshError,
            }
            setPipeline(merged)
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
              Effect.catchAll((_error) =>
                nativeEffect(() => {
                  if (current()) setError('Details loaded, but could not be saved for offline use.')
                }),
              ),
            )
          }
        }).pipe(
          Effect.catchAll((cause) =>
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
      nativeEffect(() => Linking.openURL(url)).pipe(
        Effect.catchAll((cause) => nativeEffect(() => setError(String(cause)))),
      ),
    )
  }
  const mutationDisabled = !focused || !connected || busy || refreshing || stale
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
            onPress: () => setForm('edit'),
          },
          {
            label: 'Comment',
            disabled: mutationDisabled,
            onPress: () => setForm('comment'),
          },
          ...(options?.provider === 'jira'
            ? [
                {
                  label: 'Change status',
                  disabled: mutationDisabled,
                  onPress: () => setForm('transition'),
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
                  onPress: () => setForm('run'),
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
        subtitle={[jiraSource?.name || jiraSource?.project || repository?.name, profile?.name]
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
                  },
                ]}
              >
                {issue.issue.state}
              </Text>
              <Text style={styles.muted}>· {issue.issue.type}</Text>
              {options?.provider === 'jira' && <Text style={styles.muted}>· Jira</Text>}
            </View>
            <View
              style={{
                gap: 8,
                paddingVertical: 12,
                borderTopWidth: 0.5,
                borderBottomWidth: 0.5,
                borderColor: colors.border,
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
                {issue.comments.length}
                {issue.next ? '+' : ''} comments loaded
              </Text>
              {!!issue.issue.labels.length && (
                <Text style={styles.muted}>
                  Labels <Text style={styles.text}>{issue.issue.labels.join(' · ')}</Text>
                </Text>
              )}
              {issue.issue.updatedAt && !Number.isNaN(Date.parse(issue.issue.updatedAt)) && (
                <Text style={styles.muted}>
                  Updated {new Date(issue.issue.updatedAt).toLocaleString()}
                </Text>
              )}
            </View>
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
            {!!issue.issue.bodyNotice && <Text style={styles.muted}>{issue.issue.bodyNotice}</Text>}
            <Markdown
              text={issue.issue.preview ?? issue.issue.body}
              baseURL={issue.issue.url}
              preserveLineBreaks
            />
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
              onPress={() => setForm('comment')}
            />
            {!issue.comments.length && !issue.discussionNotice && (
              <Text style={styles.muted}>No comments yet.</Text>
            )}
            {!!options?.issueNotice && <Text style={styles.muted}>{options.issueNotice}</Text>}
            {!!issue.discussionNotice && <Text style={styles.muted}>{issue.discussionNotice}</Text>}
            {issue.comments.map((comment) => (
              <View
                key={comment.id}
                style={{
                  borderTopWidth: 0.5,
                  borderTopColor: colors.border,
                  paddingTop: 16,
                  gap: 8,
                }}
              >
                <Text style={styles.muted}>
                  {comment.author} · {new Date(comment.createdAt).toLocaleString()}
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
                disabled={busy || !connected}
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
            <PipelineJobs jobs={pipeline.jobs} hasMore={!!pipeline.next} onOpen={open} />
            <PipelineRunDetails run={pipeline.run} />
            {!!options?.pipelineNotice && (
              <Text style={styles.muted}>{options.pipelineNotice}</Text>
            )}
            {pipeline.next && (
              <Action
                label="More jobs"
                secondary
                disabled={busy || !connected}
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
          issue={issue?.issue}
          options={options}
          initialDefinition={pipeline?.run.definition}
          initialRef={pipeline?.run.ref || repository?.branch}
          onClose={() => setForm(null)}
          onDone={done}
        />
      )}
      {confirm && pipeline && (
        <Sheet
          title={`${confirm[0]!.toUpperCase() + confirm.slice(1)} pipeline?`}
          onClose={() => setConfirm(null)}
          busy={busy}
        >
          <Text style={styles.muted}>
            {pipeline.run.title}. This changes the pipeline on its server.
          </Text>
          <Action
            label={`Confirm ${confirm}`}
            disabled={mutationDisabled || !confirmAllowed}
            onPress={() => {
              if (pending.current || mutationDisabled || !confirmAllowed) return
              pending.current = true
              setBusy(true)
              void runClientEffect(
                readEffect(
                  '/api/scm/work/pipelines/action',
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
                  .pipe(Effect.flatMap((result) => nativeEffect(() => done(result.message))))
                  .pipe(
                    Effect.catchAll((cause) =>
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
