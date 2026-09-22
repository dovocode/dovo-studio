import { appendUniqueRows, clientScopeKey, RequestScope } from '@dovo/client-runtime'
import { useEffect, useRef, useState } from 'react'
import { Linking, RefreshControl, ScrollView, View } from 'react-native'
import {
  forgeWorkOptionsSchema,
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
        workCacheKey(repository, props.mode, 'detail', { id: props.itemId }),
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
  const { read, connected, snapshot, profile, readCache } = useRuntime()
  const { focused } = useNavigation()
  const repository = snapshot?.workspace.repositories.find((item) => item.id === repositoryId)
  const jiraSource = snapshot?.workspace.jiraSources?.find((source) => source.id === jiraSourceId)
  const sourceInput = jiraSourceId ? { jiraSourceId } : { repositoryId }
  const cacheSource = jiraSourceId ? jiraSource : repository
  const linkedProjectId = jiraSourceId
    ? snapshot?.workspace.jiraIssueLinks?.find(
        (link) => link.sourceId === jiraSourceId && link.issueId === selected,
      )?.repositoryId
    : repositoryId
  const optionsKey = workCacheKey(cacheSource, mode, 'options')
  const detailKey = workCacheKey(cacheSource, mode, 'detail', { id: selected })
  const [options, setOptions] = useState<ForgeWorkOptions>()
  const [revision, reload] = useState(0)
  const [issue, setIssue] = useState<ForgeIssueDetail>()
  const [pipeline, setPipeline] = useState<ForgePipelineDetail>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<'edit' | 'comment' | 'run' | 'transition' | null>(null)
  const [confirm, setConfirm] = useState<RunAction | null>(null)
  const pending = useRef(false)
  const requests = useRef(new RequestScope())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const current = requests.current.begin()
    pending.current = false
    setBusy(false)
    if (!focused) return () => requests.current.cancel()
    setError('')
    setBusy(connected)
    setStale(true)
    void (async () => {
      try {
        const cachedOptions = await readCache?.read(optionsKey, forgeWorkOptionsSchema)
        if (!current()) return
        if (cachedOptions) setOptions(cachedOptions.value)
        if (mode === 'issues') {
          const cached = await readCache?.read(detailKey, forgeIssueDetailSchema)
          if (!current()) return
          if (cached) {
            assertWorkSource(mode, cached.value.issue.url, expectedURL)
            setIssue(cached.value)
          }
        } else {
          const cached = await readCache?.read(detailKey, forgePipelineDetailSchema)
          if (!current()) return
          if (cached) {
            assertWorkSource(mode, cached.value.run.url, expectedURL)
            setPipeline(cached.value)
          }
        }
      } catch (cause) {
        if (current())
          setError(
            cause instanceof Error
              ? cause.message
              : 'Saved details could not be read from this device.',
          )
      }
      if (!connected || !current()) return
      const opts = await read(
        '/api/scm/work/options',
        { ...(jiraSourceId ? { jiraSourceId } : { repositoryId }), area: mode },
        forgeWorkOptionsSchema,
      )
      if (!current()) return
      setOptions(opts)
      if (!(mode === 'issues' ? opts.issues : opts.pipelines)) return
      if (mode === 'issues') {
        const data = await read(
          '/api/scm/work/issues/detail',
          {
            ...(jiraSourceId ? { jiraSourceId } : { repositoryId }),
            id: selected,
            refresh: revision > 0,
          },
          forgeIssueDetailSchema,
        )
        if (!current()) return
        assertWorkSource(mode, data.issue.url, expectedURL)
        setIssue(data)
        setStale(!!data.stale || !!data.refreshError)
        setError(data.refreshError ?? '')
        try {
          await readCache?.write(optionsKey, opts)
          await readCache?.write(detailKey, data)
        } catch {
          if (current()) setError('Details loaded, but could not be saved for offline use.')
        }
      } else {
        const data = await read(
          '/api/scm/work/pipelines/detail',
          {
            ...(jiraSourceId ? { jiraSourceId } : { repositoryId }),
            id: selected,
            refresh: revision > 0,
          },
          forgePipelineDetailSchema,
        )
        if (!current()) return
        assertWorkSource(mode, data.run.url, expectedURL)
        setPipeline(data)
        setStale(!!data.stale || !!data.refreshError)
        setError(data.refreshError ?? '')
        try {
          await readCache?.write(optionsKey, opts)
          await readCache?.write(detailKey, data)
        } catch {
          if (current()) setError('Details loaded, but could not be saved for offline use.')
        }
      }
    })()
      .catch((cause) => {
        if (current()) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (current()) setBusy(false)
      })
    return () => requests.current.cancel()
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
  ])
  const done = (message: string) => {
    if (!alive.current) return
    setForm(null)
    setConfirm(null)
    setMessage(message)
    reload((value) => value + 1)
  }
  const more = async () => {
    if (pending.current || busy || !connected || !focused) return
    const current = requests.current.begin()
    setError('')
    pending.current = true
    setBusy(true)
    try {
      if (issue?.next) {
        const data = await read(
          '/api/scm/work/issues/detail',
          {
            ...(jiraSourceId ? { jiraSourceId } : { repositoryId }),
            id: selected,
            cursor: issue.next,
          },
          forgeIssueDetailSchema,
        )
        if (!current()) return
        assertWorkSource(mode, data.issue.url, expectedURL ?? issue.issue.url)
        const merged = { ...data, comments: appendUniqueRows(issue.comments, data.comments) }
        setIssue(merged)
        setStale(stale || !!data.stale || !!data.refreshError)
        setError(data.refreshError ?? '')
        try {
          await readCache?.write(detailKey, merged)
        } catch {
          if (current()) setError('Details loaded, but could not be saved for offline use.')
        }
      }
      if (pipeline?.next) {
        const data = await read(
          '/api/scm/work/pipelines/detail',
          {
            ...(jiraSourceId ? { jiraSourceId } : { repositoryId }),
            id: selected,
            cursor: pipeline.next,
          },
          forgePipelineDetailSchema,
        )
        if (!current()) return
        assertWorkSource(mode, data.run.url, expectedURL ?? pipeline.run.url)
        const merged = { ...data, jobs: appendUniqueRows(pipeline.jobs, data.jobs) }
        setPipeline(merged)
        setStale(stale || !!data.stale || !!data.refreshError)
        setError(data.refreshError ?? '')
        try {
          await readCache?.write(detailKey, merged)
        } catch {
          if (current()) setError('Details loaded, but could not be saved for offline use.')
        }
      }
    } catch (cause) {
      if (current()) {
        setStale(true)
        setError(String(cause))
      }
    } finally {
      if (current()) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const open = (url: string) => {
    void Linking.openURL(url).catch((cause) => setError(String(cause)))
  }
  const mutationDisabled = !focused || !connected || busy || stale
  const confirmAllowed = !!(
    confirm &&
    pipeline &&
    options?.pipelineActions.includes(confirm) &&
    pipelineActionAllowed(confirm, pipeline.run.status)
  )
  const actions: WorkMenuAction[] = [
    ...(issue
      ? [
          { label: 'Edit issue', disabled: mutationDisabled, onPress: () => setForm('edit') },
          { label: 'Comment', disabled: mutationDisabled, onPress: () => setForm('comment') },
          ...(options?.provider === 'jira'
            ? [
                {
                  label: 'Change status',
                  disabled: mutationDisabled,
                  onPress: () => setForm('transition'),
                },
              ]
            : []),
          { label: 'Open on server', onPress: () => open(issue.issue.url) },
        ]
      : []),
    ...(pipeline
      ? [
          { label: 'Open run and logs', onPress: () => open(pipeline.run.url) },
          ...(options?.pipelineActions.includes('run')
            ? [{ label: 'Run pipeline', disabled: mutationDisabled, onPress: () => setForm('run') }]
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
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          { paddingTop: 0, paddingBottom: 40, gap: 12, flexGrow: 1 },
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
            <Text selectable style={[styles.title, { fontSize: 22, lineHeight: 28 }]}>
              {issue.issue.title}
            </Text>
            <View style={[styles.row, { gap: 8 }]}>
              <Text style={[styles.text, { fontSize: 14, fontWeight: '600' }]}>
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
              {!!issue.issue.author && (
                <Text style={styles.muted}>
                  Reported by <Text style={styles.text}>{issue.issue.author}</Text>
                </Text>
              )}
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
              style={[styles.text, { fontWeight: '600', paddingTop: 4 }]}
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
              source={{ kind: 'issue', item: issue.issue }}
              disabled={mutationDisabled}
            />
            <Text
              accessibilityRole="header"
              style={[styles.text, { fontWeight: '600', paddingTop: 8 }]}
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
              source={{ kind: 'pipeline', item: pipeline.run }}
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
              void read(
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
                .then((result) => done(result.message))
                .catch((cause) => {
                  if (alive.current) setError(String(cause))
                })
                .finally(() => {
                  pending.current = false
                  if (alive.current) setBusy(false)
                })
            }}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
        </Sheet>
      )}
    </View>
  )
}
