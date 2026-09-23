import { useApplicationState } from '../runtime/application-state'
import { useEffect } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { responses, type JobRun } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import { Action } from '../ui/action'
import { Icon } from '../ui/icon'
import { colors, styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { automationRunSummary } from './automation-summary'
export function RunProgress({
  run,
  anotherActive = false,
}: {
  run: JobRun
  anotherActive?: boolean
}) {
  const { snapshot, connected, callEffect } = useRuntime()
  const { navigate, focused } = useNavigation()
  const { busy, error, act } = useAction()
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
  const [now, setNow] = useApplicationState(Date.now())
  useEffect(() => {
    if (!active || !focused) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [active, focused])
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
  return (
    <View
      testID={`Job run ${run.id}`}
      style={{
        gap: 6,
      }}
    >
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
            label={needsInput ? 'Respond in task' : 'Open current task'}
            disabled={!focused}
            onPress={() => navigate('tasks', current.taskId)}
          />
        )}
      {run.status === 'waiting' && (
        <View
          style={{
            gap: 6,
          }}
        >
          <Text style={styles.muted}>
            Automation review gate · Approve to continue the remaining steps.
          </Text>
          <View style={styles.row}>
            <Action
              label="Approve review"
              disabled={!focused || !connected || busy}
              onPress={() =>
                act(() =>
                  callEffect(
                    '/api/jobs/review',
                    {
                      id: run.id,
                      allow: true,
                    },
                    responses.ok,
                  ),
                )
              }
            />
            <Action
              secondary
              label="Reject review"
              disabled={!focused || !connected || busy}
              onPress={() =>
                act(() =>
                  callEffect(
                    '/api/jobs/review',
                    {
                      id: run.id,
                      allow: false,
                    },
                    responses.ok,
                  ),
                )
              }
            />
          </View>
        </View>
      )}
      {(run.status === 'failed' || run.status === 'cancelled') && (
        <View
          style={{
            gap: 4,
          }}
        >
          <Action
            label="Retry run"
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
              Continues from the unfinished step. Completed steps are kept.
            </Text>
          )}
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
            {new Date(run.createdAt).toLocaleString()}
            {(run.attempt ?? 1) > 1 ? ` · Attempt ${run.attempt}` : ''}
          </Text>
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
                        {taskNeedsInput(step.taskId)
                          ? 'Needs input'
                          : step.status === 'waiting'
                            ? 'Awaiting approval'
                            : step.status}
                        {step.attempt > 1 ? ` · Attempt ${step.attempt}` : ''}
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
                    accessibilityLabel={`Open task ${task.title}`}
                    disabled={!focused}
                    onPress={() => navigate('tasks', task.id)}
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
                      accessibilityLabel={`Open task ${task.title}`}
                      disabled={!focused}
                      onPress={() => navigate('tasks', id)}
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
          {active && (
            <Action
              secondary
              label="Cancel run"
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
