import { HarnessIcon } from '../../agents/harness-icon'
import { useCachedModelCatalog } from '../../agents/use-model-catalog'
import { harnessNames } from '../creation/harness-choices'
import { pullStackLabel } from '@dovo/protocol'
import {
  Archive,
  CircleCheck,
  CircleDashed,
  CircleStop,
  CircleX,
  Clock,
  CloudOff,
  FilePenLine,
  GitBranch,
  GitFork,
  MessageCircleQuestion,
  Moon,
  Pin,
  Save,
  type LucideIcon,
} from 'lucide-react-native'
import { Icon } from '../../ui/controls/icon'
import { Image, Pressable, View } from 'react-native'
import { Text } from '../../ui/content/text'
import {
  projectIcon,
  projectIconColor,
  acpHarnessName,
  resolveTaskAgent,
  type RuntimeOverview,
  type RuntimeTask,
} from '@dovo/protocol'
import { DeviceLabel } from './device-label'
import { TaskRowMenu } from './task-row-menu'
import { useTaskLifecycle } from '../detail/use-task-lifecycle'
import { colors, styles } from '../../ui/theme'
import { showTaskDone, taskRowStatus } from './task-row-status'
import { useCarMode } from '../../runtime/preferences/app-preferences'

const statusIcons: Record<string, LucideIcon> = {
  Working: CircleDashed,
  'Was working': CloudOff,
  Done: CircleCheck,
  Finished: CircleCheck,
  Failed: CircleX,
  Stopped: CircleStop,
  Snoozed: Moon,
  Settled: CircleCheck,
  Archived: Archive,
  Draft: FilePenLine,
  'Needs input': MessageCircleQuestion,
  'Saving changes': Save,
}
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
  const { modelName, catalog } = useCachedModelCatalog(agent, runtime?.profile)
  const providerName = agent
    ? ((task.harness
        ? acpHarnessName(agent, runtime?.snapshot?.acpInstallations ?? [])
        : undefined) ??
      catalog?.harness?.name ??
      harnessNames[agent.provider])
    : ''
  const actions = useTaskLifecycle(task, row.runtimeId)
  const car = useCarMode()
  const status = taskRowStatus(task, row.needsInput, row.online, now)
  const done = showTaskDone(task, row.needsInput, now)
  const failed = !row.needsInput && !done && status.startsWith('Failed')
  const worktree = task.execution === 'worktree'
  // "Review · 23m" → state "Review" and a right-aligned age "23m".
  const [state, age] = /^(.*) · (now|\d+[mhd])$/.exec(status)?.slice(1) ?? [status, '']
  const working = task.status === 'running' && !row.needsInput
  const stateColor = row.needsInput
    ? colors.accent
    : failed
      ? colors.error
      : done
        ? colors.success
        : working
          ? colors.accent
          : colors.muted
  const branch =
    task.checkoutBranch ??
    (task.execution === 'worktree' ? 'Worktree' : repository?.branch) ??
    'Project checkout'
  const icon = projectIcon(repository)
  const StatusIcon = statusIcons[state]
  const showingTime = !!age && !working

  return (
    <View style={{ marginVertical: 3, borderRadius: 12, backgroundColor: colors.surface }}>
      {/* The menu shares the metadata line, leaving the title its full width. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${task.pinned ? 'Pinned, ' : ''}${row.projectName}, ${task.title}, ${status}, ${worktree ? 'Worktree' : 'Local checkout'}, ${executionDevice}${row.online ? '' : ', Offline'}${agent ? `, ${providerName}${agent.model ? ` · ${modelName}` : ''}` : ''}`}
          accessibilityHint="Open conversation. Touch and hold for task actions."
          disabled={disabled}
          onPress={onOpen}
          onLongPress={onDetails}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            paddingVertical: 12,
            paddingLeft: 12,
            paddingRight: 12,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                minHeight: 32,
                paddingRight: car ? 0 : 32,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  overflow: 'hidden',
                  backgroundColor: icon ? colors.accent : projectIconColor(repository),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {icon ? (
                  <Image source={{ uri: icon }} style={{ width: 22, height: 22 }} />
                ) : (
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                    {(row.projectName || 'P').slice(0, 2).toUpperCase()}
                  </Text>
                )}
              </View>
              <Text numberOfLines={1} style={[styles.muted, { flex: 1, fontSize: 13 }]}>
                {row.projectName || 'No project'}
              </Text>
              {task.pinned && <Pin size={12} color={colors.muted} />}
              {worktree && <GitFork size={12} color={colors.muted} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {StatusIcon && <StatusIcon size={14} color={stateColor} />}
                {showingTime && <Clock size={12} color={stateColor} />}
                <Text style={{ color: stateColor, fontSize: 13 }}>
                  {working || row.needsInput || done || failed
                    ? `${state}${age ? ` ${age}` : ''}`
                    : age || state}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  color: actions.unread ? colors.text : '#b8bac2',
                  fontSize: 17,
                  lineHeight: 22,
                  fontWeight: '500',
                }}
              >
                {task.title}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <GitBranch size={12} color={colors.muted} />
              <Text numberOfLines={1} style={[styles.muted, { flex: 1, fontSize: 13 }]}>
                {branch}
              </Text>
              {showDevice && !car && (
                <DeviceLabel task={task} runtimeHost={row.runtimeName} compact />
              )}
              {row.reachability === 'offline' && (
                <Text style={[styles.muted, { fontSize: 13 }]}>Offline</Text>
              )}
              {task.pullStatus?.stack && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Icon name="stack" size={12} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 12 }}>
                    {pullStackLabel(task.pullStatus.stack)}
                  </Text>
                </View>
              )}
              {!!agent && (
                <>
                  <HarnessIcon provider={agent.provider} />
                  <Text style={[styles.muted, { fontSize: 12 }]}>{providerName}</Text>
                </>
              )}
            </View>
          </View>
        </Pressable>
        {!car && (
          <View style={{ position: 'absolute', right: 0, top: 6 }}>
            <TaskRowMenu
              testID={`${testID} actions`}
              task={task}
              actions={actions}
              disabled={disabled}
              onOpen={onOpen}
              onDetails={onDetails}
            />
          </View>
        )}
      </View>
      {!!actions.error && (
        <Text accessibilityRole="alert" style={[styles.error, { paddingBottom: 8 }]}>
          {actions.error}
        </Text>
      )}
    </View>
  )
}
