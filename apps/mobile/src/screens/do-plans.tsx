import { useEffect, useMemo, useRef } from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { Effect } from 'effect'
import { clientTaskScope } from '@dovo/client-runtime'
import {
  DO_LIMITS,
  doDiscoverReplySchema,
  doListReplySchema,
  doRunReplySchema,
  runtimeComputerName,
  type DoDiscoverReply,
  type DoRun,
  type DoRunSummary,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useApplicationState } from '../runtime/state/application-state'
import { useNavigation } from '../shell/navigation'
import { taskHref } from '../shell/task-route'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { useAction } from '../ui/controls/use-action'
import { SettingsPage, SettingsSheet, useSettingsTheme } from './settings-theme'
import {
  SettingsAction as Action,
  SettingsChoice as Choice,
  SettingsField as Field,
} from './settings-controls'
import { DoPlanEditor } from '../do/plan-editor'
import { doThreadOwner, itemStatusLabels, runStatusLabels } from '../do/presentation'

export default function DoPlansScreen({
  runtimeId,
  runId,
}: {
  runtimeId?: string
  runId?: string
}) {
  const { styles } = useSettingsTheme()
  const { overviews } = useRuntime()
  const { focused } = useNavigation()
  const enabled = overviews.filter((entry) => entry.snapshot?.doEnabled)
  const [selected, setSelected] = useApplicationState(
    () => runtimeId ?? enabled[0]?.profile.id ?? '',
  )
  const currentId = enabled.some((entry) => entry.profile.id === selected)
    ? selected
    : runtimeId
      ? ''
      : (enabled[0]?.profile.id ?? '')
  return (
    <SettingsPage>
      <ScreenHeader title="Review plans" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.muted}>
          Plan bounded work across your computers, follow each agent’s thread, then review the
          results yourself.
        </Text>
        {!!runtimeId && !currentId && (
          <Text accessibilityRole="alert" style={styles.muted}>
            This plan’s computer is no longer paired here or has Do disabled. Choose an available
            computer to review its plans.
          </Text>
        )}
        {!enabled.length ? (
          <View style={styles.card}>
            <Text style={styles.text}>Enable Do on a computer to get started.</Text>
            <Action
              label="Open computer preferences"
              onPress={() => router.push('/settings/devices')}
            />
          </View>
        ) : (
          <Choice
            label="Plan’s home computer"
            value={currentId}
            items={enabled.map((entry) => ({
              id: entry.profile.id,
              name: `${runtimeComputerName(entry)}${entry.connected ? '' : ' · Offline'}`,
            }))}
            onChange={setSelected}
          />
        )}
        {enabled.map((entry) => (
          <View
            key={entry.profile.id}
            style={{ display: entry.profile.id === currentId ? 'flex' : 'none' }}
          >
            <RuntimeScope runtimeId={entry.profile.id}>
              <DoComputer
                active={focused && entry.profile.id === currentId}
                initialRunId={entry.profile.id === runtimeId ? runId : undefined}
              />
            </RuntimeScope>
          </View>
        ))}
      </ScrollView>
    </SettingsPage>
  )
}

function DoComputer({ active, initialRunId }: { active: boolean; initialRunId?: string }) {
  const { styles } = useSettingsTheme()
  const { connected, snapshot, readEffect, callEffect, profile, overviews } = useRuntime()
  const { busy, error, act } = useAction()
  const [runs, setRuns] = useApplicationState<DoRunSummary[]>([])
  const [run, setRun] = useApplicationState<DoRun | null>(null)
  const [selectedId, setSelectedId] = useApplicationState(initialRunId ?? '')
  const [loadError, setLoadError] = useApplicationState('')
  const [loaded, setLoaded] = useApplicationState(false)
  const [refresh, setRefresh] = useApplicationState(0)
  const [editing, setEditing] = useApplicationState(false)
  const [confirmation, setConfirmation] = useApplicationState<{
    kind: 'start' | 'cancel' | 'review'
    run: DoRun
  } | null>(null)
  const [decision, setDecision] = useApplicationState<'accepted' | 'rejected'>('accepted')
  const [note, setNote] = useApplicationState('')
  const [discoveryError, setDiscoveryError] = useApplicationState('')
  const [catalogs, setCatalogs] = useApplicationState<Record<string, DoDiscoverReply>>({})
  const generation = useRef(0)
  const alive = useRef(true)
  const writable = useRef(false)
  writable.current = active && connected && snapshot?.doEnabled === true
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (!active || !connected || busy) return
    let current = true
    let reading = false
    const scope = clientTaskScope()
    const load = () => {
      if (reading) return
      reading = true
      const requestGeneration = generation.current
      void scope.run(
        Effect.gen(function* () {
          const list = yield* readEffect('/api/do/list', {}, doListReplySchema)
          const detail = selectedId
            ? yield* readEffect('/api/do/read', { id: selectedId }, doRunReplySchema)
            : null
          if (!current || requestGeneration !== generation.current) return
          setRuns(list.runs)
          if (detail) setRun(detail.run)
          setLoaded(true)
          setLoadError('')
        }).pipe(
          Effect.catch((cause) =>
            Effect.sync(() => {
              if (current) setLoadError(cause.message)
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              reading = false
            }),
          ),
        ),
      )
    }
    load()
    const interval = setInterval(load, 3000)
    return () => {
      current = false
      clearInterval(interval)
      void scope.stop()
    }
  }, [active, connected, busy, readEffect, selectedId, refresh])
  // A plan revision changes only when its assignments change, not on status updates.
  const assignments = useMemo(
    () => [
      ...new Map(
        (run?.items ?? []).map((item) => [
          JSON.stringify([item.target.runtimeId, item.target.repositoryId]),
          { runtimeId: item.target.runtimeId, repositoryId: item.target.repositoryId },
        ]),
      ).entries(),
    ],
    [run?.id, run?.revision],
  )
  useEffect(() => {
    if (!active || !connected) return
    let current = true
    const scope = clientTaskScope()
    setDiscoveryError('')
    const requests = [
      { key: 'local', input: {} },
      ...assignments.map(([key, input]) => ({ key, input })),
    ]
    void scope.run(
      Effect.forEach(requests, ({ key, input }) =>
        readEffect('/api/do/discover', input, doDiscoverReplySchema).pipe(
          Effect.tap((reply) =>
            Effect.sync(() => {
              if (current) setCatalogs((previous) => ({ ...previous, [key]: reply }))
            }),
          ),
          Effect.catch((cause) =>
            Effect.sync(() => {
              if (current) setDiscoveryError(cause.message)
            }),
          ),
        ),
      ).pipe(Effect.asVoid),
    )
    return () => {
      current = false
      void scope.stop()
    }
  }, [active, connected, readEffect, assignments, refresh])
  const disabled = !active || !connected || busy || !snapshot?.doEnabled
  const apply = (next: DoRun) => {
    if (!alive.current) return
    generation.current += 1
    setRun(next)
    setSelectedId(next.id)
    setConfirmation(null)
    setRefresh((value) => value + 1)
  }
  const mutate = (path: string, input: object) =>
    act(() =>
      Effect.suspend(() => {
        if (!writable.current || !alive.current) return Effect.void
        generation.current += 1
        return callEffect(path, input, doRunReplySchema).pipe(
          Effect.tap(({ run }) => Effect.sync(() => apply(run))),
        )
      }),
    )
  const confirmationStale =
    !!confirmation &&
    (confirmation.run.revision !== run?.revision || confirmation.run.status !== run?.status)
  return (
    <View style={{ gap: 20 }}>
      {!connected && (
        <Text accessibilityRole="alert" style={styles.muted}>
          This computer is offline. Reconnect to refresh or change its plans. Saved results below
          may be out of date.
        </Text>
      )}
      {!!loadError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {loadError}
        </Text>
      )}
      {!!discoveryError && (
        <Text accessibilityRole="alert" style={styles.muted}>
          Computer and assignment names could not refresh: {discoveryError}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <View style={styles.row}>
        <Action
          label="New plan"
          disabled={disabled}
          onPress={() => {
            setRun(null)
            setSelectedId('')
            setEditing(true)
          }}
        />
        <Action
          secondary
          label="Refresh plans"
          disabled={disabled}
          onPress={() => setRefresh((value) => value + 1)}
        />
      </View>
      {!loaded && connected && !loadError && <Text style={styles.muted}>Loading plans…</Text>}
      {loaded && !runs.length && (
        <Text style={styles.muted}>
          No saved plans yet. Start with a goal and a small set of work items.
        </Text>
      )}
      {runs.length > 0 && (
        <Choice
          label="Saved plan"
          value={selectedId}
          selectedLabel={run?.title ?? 'Choose a plan'}
          items={runs.map((item) => ({
            id: item.id,
            name: `${item.title} · ${runStatusLabels[item.status]}`,
          }))}
          onChange={(id) => {
            setRun(null)
            setSelectedId(id)
            setConfirmation(null)
          }}
        />
      )}
      {selectedId && !run && <Text style={styles.muted}>Loading saved plan…</Text>}
      {run && (
        <>
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
              {run.title}
            </Text>
            <Text style={styles.text}>{runStatusLabels[run.status]}</Text>
            <Text selectable style={styles.text}>
              {run.goal}
            </Text>
            <Text style={styles.muted}>
              Up to {run.maxConcurrency} work items at once · {run.items.length} work items
            </Text>
            {!!run.error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {run.error}
              </Text>
            )}
            {run.status === 'draft' && (
              <>
                <Action
                  secondary
                  label="Edit saved plan"
                  disabled={disabled}
                  onPress={() => setEditing(true)}
                />
                <Action
                  label="Start plan"
                  disabled={disabled}
                  onPress={() => setConfirmation({ kind: 'start', run })}
                />
              </>
            )}
            {['running', 'attention', 'cancelling'].includes(run.status) && (
              <Action
                secondary
                label={run.status === 'cancelling' ? 'Retry stopping work' : 'Cancel run'}
                disabled={disabled}
                onPress={() => setConfirmation({ kind: 'cancel', run })}
              />
            )}
            {run.items.some((item) =>
              ['failed', 'blocked', 'cancelled'].includes(item.state.status),
            ) &&
              run.status !== 'cancelling' &&
              run.status !== 'completed' && (
                <Action
                  label="Retry unfinished work"
                  disabled={disabled}
                  onPress={() => mutate('/api/do/retry', { id: run.id })}
                />
              )}
            {run.status === 'review' && (
              <Action
                label="Review results"
                disabled={disabled}
                onPress={() => {
                  setNote('')
                  setDecision('accepted')
                  setConfirmation({ kind: 'review', run })
                }}
              />
            )}
            {run.review && (
              <>
                <Text style={styles.text}>
                  Your review: {run.review.decision === 'accepted' ? 'Accepted' : 'Rejected'}
                </Text>
                {!!run.review.note && (
                  <Text selectable style={styles.text}>
                    {run.review.note}
                  </Text>
                )}
              </>
            )}
          </View>
          {run.items.map((item, index) => {
            const catalog =
              catalogs[JSON.stringify([item.target.runtimeId, item.target.repositoryId])]
            const computer = catalogs.local?.computers?.find(
              (computer) => computer.id === item.target.runtimeId,
            )
            const project = catalog?.projects.find(
              (project) => project.id === item.target.repositoryId,
            )
            const owner = profile && doThreadOwner(overviews, profile.id, item.target.runtimeId)
            const dependencies = item.dependsOn.map(
              (id) =>
                run.items.find((candidate) => candidate.id === id)?.title ??
                'Unavailable work item',
            )
            return (
              <View key={item.id} style={styles.card}>
                <Text accessibilityRole="header" style={styles.title}>
                  {index + 1}. {item.title}
                </Text>
                <Text style={styles.text}>{itemStatusLabels[item.state.status]}</Text>
                <Text style={styles.muted}>
                  {computer?.name ??
                    (item.target.runtimeId === 'local' ? 'This computer' : 'Paired computer')}{' '}
                  · {project?.name ?? 'Assigned project'}
                </Text>
                <Text style={styles.muted}>
                  {item.target.agentId
                    ? (catalog?.agents.find((agent) => agent.id === item.target.agentId)?.name ??
                      'Assigned agent')
                    : 'Project default agent'}{' '}
                  · {item.target.execution === 'worktree' ? 'New worktree' : 'Local checkout'}
                </Text>
                {!!item.target.linkedCheckouts?.length && (
                  <View style={{ gap: 4 }}>
                    <Text style={styles.text}>Linked checkouts</Text>
                    {item.target.linkedCheckouts.map((checkout) => (
                      <Text key={checkout.id} selectable style={styles.muted}>
                        {checkout.repositoryId} ·{' '}
                        {checkout.access === 'edit' ? 'Can edit' : 'Read only'} ·{' '}
                        {checkout.execution === 'worktree' ? 'Worktree' : 'Local checkout'}
                        {checkout.existingWorktreePath ? ` · ${checkout.existingWorktreePath}` : ''}
                        {checkout.baseBranch ? ` · Base: ${checkout.baseBranch}` : ''}
                        {checkout.branch ? ` · Branch: ${checkout.branch}` : ''}
                      </Text>
                    ))}
                  </View>
                )}
                <Text selectable style={styles.text}>
                  {item.instructions}
                </Text>
                {!!dependencies.length && (
                  <Text style={styles.muted}>After: {dependencies.join(', ')}</Text>
                )}
                {!!item.state.attempt && (
                  <Text style={styles.muted}>Attempt {item.state.attempt}</Text>
                )}
                {!!item.state.attention && (
                  <Text style={styles.text}>
                    {item.state.attention === 'approval'
                      ? 'An approval needs your decision.'
                      : item.state.attention === 'question'
                        ? 'The agent has a question for you.'
                        : 'The thread’s queue is paused.'}{' '}
                    Open the thread to respond.
                  </Text>
                )}
                {!!item.state.blockedReason && (
                  <Text accessibilityRole="alert" style={styles.muted}>
                    {item.state.blockedReason}
                  </Text>
                )}
                {!!item.state.error && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {item.state.error}
                  </Text>
                )}
                {item.state.result && (
                  <>
                    <Text style={styles.muted}>
                      Agent’s result · verify before accepting
                      {item.state.result.truncated ? ' · Excerpt' : ''}
                    </Text>
                    <Text selectable style={styles.text}>
                      {item.state.result.summary || 'No result summary. Review the thread.'}
                    </Text>
                    {!!item.state.result.branch && (
                      <Text selectable style={styles.muted}>
                        Branch: {item.state.result.branch}
                      </Text>
                    )}
                  </>
                )}
                {item.state.taskId && (
                  <>
                    <Action
                      secondary
                      label={item.state.attention ? 'Respond in thread' : 'Open work thread'}
                      disabled={!active || !owner}
                      onPress={() => {
                        if (owner && item.state.taskId)
                          router.push(taskHref(owner.profile.id, item.state.taskId))
                      }}
                    />
                    {!owner && (
                      <Text style={styles.muted}>
                        Pair this work item’s computer in Devices & runtime to open its thread here.
                      </Text>
                    )}
                  </>
                )}
                {['failed', 'blocked', 'cancelled'].includes(item.state.status) &&
                  run.status !== 'cancelling' &&
                  run.status !== 'completed' && (
                    <Action
                      secondary
                      label={`Retry ${item.title}`}
                      disabled={disabled}
                      onPress={() => mutate('/api/do/retry', { id: run.id, itemIds: [item.id] })}
                    />
                  )}
              </View>
            )
          })}
        </>
      )}
      {editing && (
        <DoPlanEditor
          run={selectedId ? (run ?? undefined) : undefined}
          visible={active}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            apply(saved)
            setEditing(false)
          }}
        />
      )}
      {confirmation && run && active && (
        <SettingsSheet
          title={
            confirmation.kind === 'start'
              ? 'Start this saved plan?'
              : confirmation.kind === 'cancel'
                ? 'Stop this run?'
                : 'Final review'
          }
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          {confirmationStale && (
            <Text accessibilityRole="alert" style={styles.error}>
              This plan changed. Close this sheet and review the current saved plan.
            </Text>
          )}
          {confirmation.kind === 'start' ? (
            <>
              <Text style={styles.text}>{run.title}</Text>
              <Text style={styles.muted}>
                Start the {run.items.length} work items in the saved plan above, with up to{' '}
                {run.maxConcurrency} at once. Keep Studio open on this computer for paired remote
                work. Agents keep their normal approval rules.
              </Text>
              <Text style={styles.muted}>
                Nothing is merged or published automatically. Review the results when all work
                finishes.
              </Text>
              <Action
                label="Start saved plan"
                disabled={disabled || confirmationStale || run.status !== 'draft'}
                onPress={() =>
                  mutate('/api/do/start', {
                    id: confirmation.run.id,
                    expectedRevision: confirmation.run.revision,
                  })
                }
              />
            </>
          ) : confirmation.kind === 'cancel' ? (
            <>
              <Text style={styles.muted}>
                Stop this run’s work threads and cancel work that has not started. Files and
                completed results are kept. Offline computers may need to reconnect before stopping
                is confirmed.
              </Text>
              <Action
                label="Stop run"
                disabled={disabled || confirmationStale}
                onPress={() => mutate('/api/do/cancel', { id: run.id })}
              />
            </>
          ) : (
            <>
              <Text style={styles.muted}>
                Review each result and its thread before deciding. This records your decision; it
                does not merge or publish changes.
              </Text>
              <Choice
                label="Decision"
                value={decision}
                items={[
                  { id: 'accepted', name: 'Accept results' },
                  { id: 'rejected', name: 'Reject results' },
                ]}
                disabled={busy}
                onChange={(value) => {
                  if (value === 'accepted' || value === 'rejected') setDecision(value)
                }}
              />
              <Field
                label="Review note (optional)"
                value={note}
                multiline
                maxLength={DO_LIMITS.note}
                editable={!busy}
                onChangeText={setNote}
              />
              <Action
                label="Record final review"
                disabled={disabled || confirmationStale || run.status !== 'review'}
                onPress={() => mutate('/api/do/complete', { id: run.id, decision, note })}
              />
            </>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </SettingsSheet>
      )}
    </View>
  )
}
