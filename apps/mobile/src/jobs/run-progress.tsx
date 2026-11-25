import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useForegroundInterval } from '../runtime/state/app-active'
import { useApplicationState } from '../runtime/state/application-state'
import { Pressable, View } from 'react-native'
import { useEffect, useRef } from 'react'
import { clientScopeKey, runClientEffect } from '@dovo/client-runtime'
import { Text } from '../ui/content/text'
import {
  automationReviewLink,
  automationRunNeedsReview,
  explainAutomationDraftSchema,
  randomUUID,
  responses,
  type JobRun,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { useNavigation } from '../shell/navigation'
import { SettingsAction as Action } from '../screens/settings-controls'
import { SettingsField as Field } from '../screens/settings-controls'
import { openAppLink } from '../ui/content/open-link'
import { Icon } from '../ui/controls/icon'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
import { formatDateTime } from '../ui/content/format-date'
import { automationRunSummary } from './automation-summary'
import { RestoreDefinition } from './restore-definition'
import { RunAudit } from './run-audit'
import { RunRoutineSource } from './routine-provenance'
export function RunProgress({
  run,
  anotherActive = false,
}: {
  run: JobRun
  anotherActive?: boolean
}) {
  const uiText = useInterfaceText()
  const subject = run.subject

  const { colors, styles } = useTheme()

  const { snapshot, connected, callEffect, profile } = useRuntime()
  const { navigate, focused } = useNavigation()
  const { busy, error, act } = useAction()
  const attemptRequests = useRef(new Map<string, string>())
  const pairing = clientScopeKey(profile?.connection)
  const explainScope = useRef(0)
  useEffect(
    () => () => {
      explainScope.current++
    },
    [focused, pairing, run.id],
  )
  const [expanded, setExpanded] = useApplicationState(
    run.status === 'running' || run.status === 'waiting' || run.status === 'failed',
  )
  const taskNeedsInput = (id?: string) =>
    !!id &&
    (snapshot?.questions.some((question) => question.taskId === id) ||
      snapshot?.approvals.some((approval) => approval.taskId === id))
  const { steps, current, needsInput, status, active, progress } = automationRunSummary(
    run,
    new Set(
      [...(snapshot?.questions ?? []), ...(snapshot?.approvals ?? [])].map(
        (request) => request.taskId,
      ),
    ),
  )
  const reviewStep = steps?.find(({ nodeId }) => nodeId === run.waitingNodeId)
  const reviewKey = JSON.stringify([pairing, run.id, reviewStep?.nodeId, reviewStep?.attempt])
  const [reviewInput, setReviewInput] = useApplicationState<
    { key: string; text: string } | undefined
  >(undefined)
  const reason = reviewInput?.key === reviewKey ? reviewInput.text : ''
  const prompt = reviewStep?.reviewPrompt
  const link = automationReviewLink(prompt?.link)
  const reviewDisabled =
    !focused || !connected || busy || (!!prompt?.requireReason && !reason.trim())
  const [now, setNow] = useApplicationState(Date.now())
  useForegroundInterval(() => setNow(Date.now()), active && focused ? 15000 : null)
  const seconds = Math.max(
    0,
    Math.floor(
      ((run.finishedAt
        ? Date.parse(run.finishedAt)
        : active
          ? now
          : Date.parse(run.updatedAt ?? run.createdAt)) -
        Date.parse(run.createdAt)) /
        1000,
    ),
  )
  const elapsed =
    seconds >= 3600
      ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
      : seconds >= 60
        ? `${Math.floor(seconds / 60)}m`
        : `${seconds}s`
  const color =
    needsInput || run.status === 'waiting'
      ? colors.accent
      : run.status === 'failed'
        ? colors.error
        : colors.muted
  const explain = (attempt: number) => {
    if (!profile) return
    const key = JSON.stringify([pairing, run.id, attempt])
    const taskId = attemptRequests.current.get(key) ?? randomUUID()
    attemptRequests.current.set(key, taskId)
    const scope = explainScope.current
    act(async () => {
      const result = await runClientEffect(
        callEffect(
          '/api/jobs/explain',
          { id: run.id, attempt, taskId },
          explainAutomationDraftSchema,
        ),
      )
      if (scope === explainScope.current) navigate('tasks', result.taskId, profile.id)
    })
  }
  return (
    <View
      testID={`Job run ${run.id}`}
      style={{
        gap: 6,
      }}
    >
      {expanded && (
        <RestoreDefinition
          key={`${profile?.id}:${run.id}`}
          runId={run.id}
          automationId={run.automationId}
        />
      )}
      {expanded && snapshot?.routineProvenanceSupported && (
        <RunRoutineSource
          key={`${profile?.id}:${run.id}`}
          automationId={run.automationId}
          runCreatedAt={run.createdAt}
        />
      )}
      {expanded && snapshot?.runAuditSupported && (
        <RunAudit key={`${profile?.id}:${run.id}`} runId={run.id} />
      )}
      {expanded && subject && (
        <Action
          label={uiText(subject.kind === 'thread' ? 'Open subject thread' : 'Open subject link')}
          onPress={() => {
            if (subject.kind === 'thread') navigate('tasks', subject.threadId, profile?.id)
            else act(() => openAppLink(subject.url, true))
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${status} · ${progress}`}
        accessibilityState={{
          expanded,
        }}
        disabled={!focused}
        testID={`Run details ${run.id}`}
        onPress={() => setExpanded((value) => !value)}
        style={[
          styles.row,
          {
            flexWrap: 'nowrap',
            minHeight: 52,
          },
        ]}
      >
        <Icon
          name={run.status === 'completed' ? 'check' : active ? 'jobs' : 'refresh'}
          color={color}
          size={17}
        />
        <View
          style={{
            flex: 1,
            minWidth: 0,
            gap: 2,
          }}
        >
          <Text
            style={[
              styles.text,
              {
                fontSize: 15,
                fontWeight: '600',
                color,
              },
            ]}
          >
            {status}
          </Text>
          <Text numberOfLines={2} style={styles.muted}>
            {current?.label ? `${current.label} · ` : ''}
            {progress}
          </Text>
        </View>
        <Text
          style={[
            styles.muted,
            {
              flexShrink: 0,
            },
          ]}
        >
          {elapsed}
        </Text>
        <Icon name={expanded ? 'down' : 'next'} size={12} color={colors.muted} />
      </Pressable>
      {!!current?.taskId &&
        snapshot?.workspace.tasks.some((task) => task.id === current.taskId) && (
          <Action
            secondary
            label={needsInput ? uiText('Respond in task') : uiText('Open current task')}
            disabled={!focused}
            onPress={() => navigate('tasks', current.taskId, profile?.id)}
          />
        )}
      {run.retryAt && run.pause?.phase !== 'paused' && (
        <Text style={styles.muted}>
          {uiText(
            'Waiting for provider. Startup retry {count}/3 at {time}. Cancel stops this retry.',
            { count: run.startupRetryCount, time: formatDateTime(run.retryAt) },
          )}
        </Text>
      )}
      {run.pipelineWait && run.pause?.phase !== 'paused' && (
        <Text style={styles.muted} selectable>
          {uiText('Waiting for CI until {value0}', {
            value0: formatDateTime(run.pipelineWait.until),
          })}
          {'\n'}
          {run.pipelineWait.url}
        </Text>
      )}
      {automationRunNeedsReview(run) && (
        <View
          style={{
            gap: 6,
          }}
        >
          <Text style={styles.muted}>
            {prompt?.instructions?.trim() ||
              uiText('Automation review gate · Approve to continue the remaining steps.')}
          </Text>
          {link && (
            <Action
              secondary
              label={uiText('Open review link')}
              onPress={() => act(() => openAppLink(link, true))}
            />
          )}
          {prompt && (
            <Field
              label={uiText(prompt.requireReason ? 'Reason (required)' : 'Reason (optional)')}
              maxLength={4000}
              multiline
              value={reason}
              editable={focused && connected && !busy}
              onChangeText={(text) => setReviewInput({ key: reviewKey, text })}
            />
          )}
          <View style={styles.row}>
            <Action
              label={uiText('Approve review')}
              disabled={reviewDisabled}
              onPress={() =>
                act(() =>
                  callEffect(
                    '/api/jobs/review',
                    {
                      id: run.id,
                      allow: true,
                      reason: reason.trim() || undefined,
                      nodeId: run.waitingNodeId,
                      attempt:
                        run.steps?.find((step) => step.nodeId === run.waitingNodeId)?.attempt ?? 1,
                    },
                    responses.ok,
                  ),
                )
              }
            />
            <Action
              secondary
              label={uiText('Reject review')}
              disabled={reviewDisabled}
              onPress={() =>
                act(() =>
                  callEffect(
                    '/api/jobs/review',
                    {
                      id: run.id,
                      allow: false,
                      reason: reason.trim() || undefined,
                      nodeId: run.waitingNodeId,
                      attempt:
                        run.steps?.find((step) => step.nodeId === run.waitingNodeId)?.attempt ?? 1,
                    },
                    responses.ok,
                  ),
                )
              }
            />
          </View>
        </View>
      )}
      {run.reviewDecisions?.map(
        (decision) =>
          decision.answeredAt && (
            <View key={`${decision.nodeId}:${decision.attempt}`}>
              <Text style={styles.muted}>
                {steps?.find(({ nodeId }) => nodeId === decision.nodeId)?.label} ·{' '}
                {uiText(decision.allow ? 'Approved' : 'Rejected')} ·{' '}
                {decision.answeredBy ?? uiText('Reviewer')} · {formatDateTime(decision.answeredAt)}
              </Text>
              {decision.reason && <Text style={styles.muted}>{decision.reason}</Text>}
            </View>
          ),
      )}
      {(run.status === 'failed' || run.status === 'cancelled') && (
        <View
          style={{
            gap: 4,
          }}
        >
          <Action
            label={uiText('Retry run')}
            disabled={!focused || !connected || busy || anotherActive}
            onPress={() =>
              act(() =>
                callEffect(
                  '/api/jobs/retry',
                  {
                    id: run.id,
                  },
                  responses.job,
                ),
              )
            }
          />
          {expanded && (
            <Text style={styles.muted}>
              <InterfaceText>
                {'Continues from the unfinished step. Completed steps are kept.'}
              </InterfaceText>
            </Text>
          )}
        </View>
      )}
      {!!run.failures?.length && snapshot?.automationExplainSupported && (
        <View style={{ gap: 6 }}>
          <Text style={styles.muted}>{uiText('Failed attempts')}</Text>
          {run.failures.map(({ attempt, failedAt }) => (
            <Action
              key={attempt}
              secondary
              label={uiText('Explain attempt {value0} · {value1}', {
                value0: attempt,
                value1: formatDateTime(failedAt),
              })}
              disabled={!connected || !focused || busy}
              onPress={() => explain(attempt)}
            />
          ))}
        </View>
      )}
      {!!run.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {run.error}
        </Text>
      )}
      {expanded && (
        <View
          style={{
            gap: 4,
            borderLeftWidth: 1,
            borderColor: colors.border,
            paddingLeft: 12,
            marginLeft: 8,
          }}
        >
          <Text style={styles.muted}>
            {formatDateTime(run.createdAt)}
            {(run.attempt ?? 1) > 1 ? uiText(' · Attempt {value0}', { value0: run.attempt }) : ''}
          </Text>
          {run.mcpEvent && (
            <Text style={styles.muted}>
              <InterfaceText values={{ value0: run.mcpEvent.name, value1: run.mcpEvent.server }}>
                {'MCP event · {value0} · {value1}'}
              </InterfaceText>
            </Text>
          )}
          {run.scheduledFor && (
            <Text style={styles.muted}>
              <InterfaceText
                values={{
                  value0: formatDateTime(run.scheduledFor),
                  value1: run.scheduleTimezone ?? uiText('UTC'),
                  value2: Math.max(
                    0,
                    Math.floor((Date.parse(run.createdAt) - Date.parse(run.scheduledFor)) / 1000),
                  ),
                }}
              >
                {'Due {value0} · {value1} · {value2}s late'}
              </InterfaceText>
            </Text>
          )}
          {steps
            ? steps.map((step, index) => {
                const task = snapshot?.workspace.tasks.find((item) => item.id === step.taskId)
                const content = (
                  <>
                    <Text
                      style={[
                        styles.muted,
                        {
                          width: 18,
                        },
                      ]}
                    >
                      {index + 1}
                    </Text>
                    <View
                      style={{
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.text,
                          {
                            fontSize: 15,
                          },
                        ]}
                      >
                        {step.label}
                      </Text>
                      <Text style={step.status === 'failed' ? styles.error : styles.muted}>
                        {task?.bot ? uiText('Bot job · {value0} · ', { value0: task.title }) : ''}
                        {taskNeedsInput(step.taskId)
                          ? uiText('Needs input')
                          : step.status === 'waiting'
                            ? uiText(
                                step.waitsForCi
                                  ? 'Waiting for CI'
                                  : run.retryAt
                                    ? 'Waiting for provider'
                                    : 'Awaiting approval',
                              )
                            : step.status === 'running' && step.queuedAt && !step.workStartedAt
                              ? uiText('Waiting for worker')
                              : step.status}
                        {step.queuedAt
                          ? ` · Queue ${Math.max(0, Math.floor((Date.parse(step.workStartedAt ?? step.finishedAt ?? new Date(now).toISOString()) - Date.parse(step.queuedAt)) / 1000))}s`
                          : ''}
                        {step.workStartedAt
                          ? ` · Work ${Math.max(0, Math.floor((Date.parse(step.finishedAt ?? new Date(now).toISOString()) - Date.parse(step.workStartedAt)) / 1000))}s`
                          : ''}
                        {step.attempt > 1
                          ? uiText(' · Attempt {value0}', { value0: step.attempt })
                          : ''}
                      </Text>
                      {!!step.error && <Text style={styles.error}>{step.error}</Text>}
                    </View>
                    <Icon
                      name={task ? 'next' : step.status === 'completed' ? 'check' : 'jobs'}
                      size={13}
                      color={colors.muted}
                    />
                  </>
                )
                return task ? (
                  <Pressable
                    key={step.nodeId}
                    testID={`Job task ${task.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={uiText('Open {value0} {value1}', {
                      value0: task.bot ? 'Bot' : 'task',
                      value1: task.title,
                    })}
                    disabled={!focused}
                    onPress={() => navigate('tasks', task.id, profile?.id)}
                    style={[
                      styles.row,
                      {
                        minHeight: 52,
                        flexWrap: 'nowrap',
                      },
                    ]}
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View
                    key={step.nodeId}
                    style={[
                      styles.row,
                      {
                        minHeight: 52,
                        flexWrap: 'nowrap',
                      },
                    ]}
                  >
                    {content}
                  </View>
                )
              })
            : run.taskIds.map((id) => {
                const task = snapshot?.workspace.tasks.find((item) => item.id === id)
                return (
                  task && (
                    <Pressable
                      key={id}
                      accessibilityRole="button"
                      accessibilityLabel={uiText('Open task {value0}', { value0: task.title })}
                      disabled={!focused}
                      onPress={() => navigate('tasks', id, profile?.id)}
                      style={{
                        minHeight: 48,
                        justifyContent: 'center',
                      }}
                    >
                      <Text numberOfLines={2} style={styles.text}>
                        {task.title}
                      </Text>
                      <Text style={styles.muted}>{task.status}</Text>
                    </Pressable>
                  )
                )
              })}
          {active && snapshot?.automationPauseSupported && (
            <Action
              secondary
              label={uiText(
                run.pause?.phase === 'afterStep'
                  ? 'Keep running'
                  : run.pause
                    ? 'Resume run'
                    : 'Pause run',
              )}
              disabled={!focused || !connected || busy}
              onPress={() =>
                act(() =>
                  callEffect(
                    run.pause ? '/api/jobs/resume' : '/api/jobs/pause',
                    { id: run.id },
                    responses.ok,
                  ),
                )
              }
            />
          )}
          {active && (
            <Action
              secondary
              label={uiText('Cancel run')}
              disabled={!focused || !connected || busy}
              onPress={() =>
                act(() =>
                  callEffect(
                    '/api/jobs/cancel',
                    {
                      id: run.id,
                    },
                    responses.ok,
                  ),
                )
              }
            />
          )}
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
