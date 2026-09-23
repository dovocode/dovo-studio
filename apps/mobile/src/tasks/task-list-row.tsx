import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { resolveTaskAgent, type RuntimeOverview, type RuntimeTask } from '@dovo/protocol'
import { DeviceLabel } from './device-label'
import { TaskRowMenu } from './task-row-menu'
import { useTaskLifecycle } from './use-task-lifecycle'
import { Icon } from '../ui/icon'
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
}: {
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
  return (
    <View
      style={{
        paddingVertical: 3,
        paddingHorizontal: 2,
        marginBottom: 2,
        gap: 0,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${task.pinned ? 'Pinned, ' : ''}${row.projectName}, ${task.title}, ${status}, ${worktree ? 'Worktree' : 'Local checkout'}, ${executionDevice}${row.online ? '' : ', Offline'}`}
          accessibilityHint="Open conversation. Touch and hold for task actions."
          disabled={disabled}
          onPress={onOpen}
          onLongPress={onDetails}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            gap: 5,
            paddingVertical: 6,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View style={[styles.row, { flexWrap: 'nowrap', gap: 6 }]}>
            <Icon name="folder" size={14} color={colors.muted} />
            <Text numberOfLines={1} style={[styles.muted, { flex: 1, fontSize: 12 }]}>
              {task.pinned ? '• ' : ''}
              {row.projectName || 'No project'}
            </Text>
            {done && <Icon name="check" size={13} color={colors.success} />}
            {failed && <Icon name="error" size={13} color={colors.error} />}
            <Text
              numberOfLines={1}
              style={[
                styles.muted,
                {
                  maxWidth: '48%',
                  fontSize: 12,
                  color: row.needsInput
                    ? colors.accent
                    : failed
                      ? colors.error
                      : done
                        ? colors.success
                        : colors.muted,
                },
              ]}
            >
              {status}
            </Text>
          </View>
          <Text
            numberOfLines={2}
            style={[styles.text, { fontSize: 15, lineHeight: 20, fontWeight: '600' }]}
          >
            {task.title}
          </Text>
          <View style={[styles.row, { flexWrap: 'nowrap', gap: 6 }]}>
            <Icon name={worktree ? 'changes' : 'folder'} size={12} color={colors.muted} />
            <Text numberOfLines={1} style={[styles.muted, { flex: 1, fontSize: 12 }]}>
              {task.checkoutBranch ??
                (task.execution === 'worktree' ? 'Worktree' : repository?.branch) ??
                'Project checkout'}
            </Text>
            <View style={{ maxWidth: '48%', flexShrink: 1 }}>
              <DeviceLabel task={task} runtimeHost={row.runtimeName} compact />
            </View>
            {!row.online && <Text style={[styles.muted, { fontSize: 11 }]}>Offline</Text>}
            <Text
              accessibilityLabel={
                agent
                  ? `${agent.provider}${agent.model ? ` · ${agent.model}` : ''}`
                  : 'Unassigned agent'
              }
              style={styles.muted}
            >
              {agent?.provider === 'claude'
                ? '✳'
                : agent?.provider === 'codex'
                  ? '◎'
                  : agent?.provider === 'opencode'
                    ? '▣'
                    : '◇'}
            </Text>
          </View>
        </Pressable>
        <TaskRowMenu
          testID={`${testID} actions`}
          task={task}
          actions={actions}
          disabled={disabled}
          onOpen={onOpen}
          onDetails={onDetails}
        />
      </View>
      {!!actions.error && (
        <Text accessibilityRole="alert" style={[styles.error, { paddingBottom: 8 }]}>
          {actions.error}
        </Text>
      )}
    </View>
  )
}
