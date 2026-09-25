import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { resolveTaskAgent, type RuntimeOverview, type RuntimeTask } from '@dovo/protocol'
import { DeviceLabel } from './device-label'
import { TaskRowMenu } from './task-row-menu'
import { useTaskLifecycle } from './use-task-lifecycle'
import { colors, styles } from '../ui/theme'
import { showTaskDone, taskRowStatus } from './task-row-status'

export function TaskListRow({
  row,
  runtime,
  now,
  testID,
  disabled,
  onOpen,
  onDetails,
  showDevice = true,
}: {
  /** Which computer ran a task is noise when only one computer is saved. */
  showDevice?: boolean
  row: RuntimeTask
  runtime?: RuntimeOverview
  now: number
  testID: string
  disabled: boolean
  onOpen: () => void
  onDetails: () => void
}) {
  const task = row.task,
    repository = runtime?.snapshot?.workspace.repositories.find(
      (repo) => repo.id === task.repositoryId,
    ),
    agent = resolveTaskAgent(task, runtime?.snapshot?.workspace.agents ?? []),
    turn = task.turns?.at(-1)
  const executionDevice = turn ? (turn.runtimeHost ?? 'Unknown device') : row.runtimeName
  const actions = useTaskLifecycle(task, row.runtimeId)
  const status = taskRowStatus(task, row.needsInput, row.online, now)
  const done = showTaskDone(task, row.needsInput, now)
  const failed = !row.needsInput && !done && status.startsWith('Failed')
  const worktree = task.execution === 'worktree'
  // "Review · 23m" → state "Review" and a right-aligned age "23m".
  const [state, age] = /^(.*) · (now|\d+[mhd])$/.exec(status)?.slice(1) ?? [status, '']
  const working = task.status === 'running' && !row.needsInput
  // Finished work waiting for review is something to act on, like an unread result.
  const reviewable = !row.needsInput && !failed && !done && state === 'Review'
  const dot = row.needsInput
    ? colors.accent
    : failed
      ? colors.error
      : done || reviewable
        ? colors.success
        : working
          ? colors.warning
          : undefined
  const stateColor = row.needsInput
    ? colors.accent
    : failed
      ? colors.error
      : done
        ? colors.success
        : colors.muted
  const branch =
    task.checkoutBranch ??
    (task.execution === 'worktree' ? 'Worktree' : repository?.branch) ??
    'Project checkout'
  return (
    <View
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      {/* Top-aligned so every row's menu sits on its title's first line, whatever the height. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${task.pinned ? 'Pinned, ' : ''}${row.projectName}, ${task.title}, ${status}, ${worktree ? 'Worktree' : 'Local checkout'}, ${executionDevice}${row.online ? '' : ', Offline'}${agent ? `, ${agent.provider}${agent.model ? ` · ${agent.model}` : ''}` : ''}`}
          accessibilityHint="Open conversation. Touch and hold for task actions."
          disabled={disabled}
          onPress={onOpen}
          onLongPress={onDetails}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            gap: 12,
            paddingVertical: 14,
            paddingLeft: 4,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          {/* State at a glance: filled for something to act on, hollow when idle. */}
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 4.5,
              marginTop: 7,
              backgroundColor: dot ?? 'transparent',
              borderWidth: dot ? 0 : 1.5,
              borderColor: colors.muted,
              opacity: dot ? 1 : 0.6,
            }}
          />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Text
                numberOfLines={2}
                style={{
                  flex: 1,
                  color: colors.text,
                  fontSize: 17,
                  lineHeight: 22,
                  fontWeight: '600',
                }}
              >
                {task.title}
              </Text>
              {!!age && <Text style={[styles.muted, { fontSize: 14, lineHeight: 22 }]}>{age}</Text>}
            </View>
            <Text numberOfLines={1} style={[styles.muted, { fontSize: 14 }]}>
              {task.pinned ? 'Pinned · ' : ''}
              {row.projectName || 'No project'} · {branch} ·{' '}
              <Text style={{ color: stateColor }}>{state}</Text>
            </Text>
            {showDevice && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <DeviceLabel task={task} runtimeHost={row.runtimeName} compact />
                {row.reachability === 'offline' && (
                  <Text style={[styles.muted, { fontSize: 13 }]}>· Offline</Text>
                )}
              </View>
            )}
          </View>
        </Pressable>
        <View style={{ marginTop: 3 }}>
          <TaskRowMenu
            testID={`${testID} actions`}
            task={task}
            actions={actions}
            disabled={disabled}
            onOpen={onOpen}
            onDetails={onDetails}
          />
        </View>
      </View>
      {!!actions.error && (
        <Text accessibilityRole="alert" style={[styles.error, { paddingBottom: 8 }]}>
          {actions.error}
        </Text>
      )}
    </View>
  )
}
