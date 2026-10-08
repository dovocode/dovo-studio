import { HarnessIcon } from '../../agents/harness-icon'
import { useCachedModelCatalog } from '../../agents/use-model-catalog'
import { harnessNames } from '../creation/harness-choices'
import { pullStackLabel, subagentMetadata, type Subagent } from '@dovo/protocol'
import {
  Archive,
  CircleCheck,
  CircleDashed,
  CircleStop,
  CircleX,
  AlarmClock,
  CloudOff,
  FilePenLine,
  GitBranch,
  GitFork,
  MessageCircleQuestion,
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
  projectIconInitials,
  acpHarnessName,
  resolveTaskAgent,
  type RuntimeOverview,
  type RuntimeTask,
} from '@dovo/protocol'
import { DeviceLabel } from './device-label'
import { TaskRowMenu } from './task-row-menu'
import { TaskSwipeActions } from './task-swipe-actions'
import { isSnoozed } from '@dovo/protocol'
import { chooseSnoozeDuration, useTaskLifecycle } from '../detail/use-task-lifecycle'
import { useTheme } from '../../ui/theme'
import { showTaskDone, taskRowStatus } from './task-row-status'
import { useCarMode } from '../../runtime/preferences/app-preferences'

const statusIcons: Record<string, LucideIcon> = {
  Working: CircleDashed,
  'Was working': CloudOff,
  Done: CircleCheck,
  Finished: CircleCheck,
  Failed: CircleX,
  Stopped: CircleStop,
  Snoozed: AlarmClock,
  Settled: CircleCheck,
  Archived: Archive,
  Draft: FilePenLine,
  'Needs input': MessageCircleQuestion,
  'Saving changes': Save,
}
export function TaskListRow({
  row,
  subagents,
  runtime,
  now,
  testID,
  disabled,
  onOpen,
  onDetails,
  onSelect,
  onOpenSubagent,
  selectionActive = false,
  selected = false,
  showDevice = true,
}: {
  /** Which computer ran a task is noise when only one computer is saved. */
  showDevice?: boolean
  row: RuntimeTask
  subagents: readonly Subagent[]
  runtime?: RuntimeOverview
  now: number
  testID: string
  disabled: boolean
  onOpen: () => void
  onDetails: () => void
  onSelect: () => void
  onOpenSubagent: (id: string) => void
  selectionActive?: boolean
  selected?: boolean
}) {
  const { colors, styles } = useTheme()

  const task = row.task,
    repository = runtime?.snapshot?.workspace.repositories.find(
      (repo) => repo.id === task.repositoryId,
    ),
    agent = resolveTaskAgent(task, runtime?.snapshot?.workspace.agents ?? [])
  const executionDevice = row.runtimeName
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

  const content = (
    <View style={{ marginVertical: 3, borderRadius: 12, backgroundColor: colors.surface }}>
      {/* The menu shares the metadata line, leaving the title its full width. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${task.pinned ? 'Pinned, ' : ''}${row.projectName}, ${task.title}, ${status}, ${worktree ? 'Worktree' : 'Local checkout'}, ${executionDevice}${row.online ? '' : ', Offline'}${agent ? `, ${providerName}${agent.model ? ` · ${modelName}` : ''}` : ''}`}
          accessibilityHint={
            car
              ? 'Open conversation.'
              : selectionActive
                ? 'Tap to toggle selection.'
                : 'Open conversation. Touch and hold to select. Task details are in the actions menu.'
          }
          accessibilityState={{ disabled, selected }}
          accessibilityActions={
            car ? [] : [{ name: 'select', label: selected ? 'Deselect task' : 'Select task' }]
          }
          onAccessibilityAction={({ nativeEvent }) => {
            if (!disabled && !car && nativeEvent.actionName === 'select') onSelect()
          }}
          disabled={disabled}
          onPress={onOpen}
          onLongPress={car ? undefined : onSelect}
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
          {selectionActive && (
            <View style={{ width: 28, alignItems: 'center', paddingTop: 7 }}>
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.muted,
                  backgroundColor: selected ? colors.accent : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected && <Icon name="check" size={14} color={colors.background} />}
              </View>
            </View>
          )}
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
                    {projectIconInitials(repository, row.projectName || 'P')}
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
                  color: colors.text,
                  opacity: actions.unread ? 1 : 0.4,
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
      {!!subagents.length && (
        <View
          accessibilityLabel="Working subagents"
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            paddingHorizontal: 12,
            paddingBottom: 10,
          }}
        >
          {subagents.map((agent, index) => {
            const childId = agent.source === 'dovo' ? (agent.taskId ?? agent.id) : undefined
            const label = `${agent.name} · ${agent.provider}`
            const detail = [
              label,
              row.online ? 'Working' : 'Last seen working',
              subagentMetadata(agent),
              agent.activity,
            ]
              .filter(Boolean)
              .join(' · ')
            const pillStyle = {
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 8,
              paddingVertical: 4,
              maxWidth: '100%' as const,
            }
            return childId ? (
              <Pressable
                key={`${agent.provider}:${agent.id}:${index}`}
                accessibilityRole="button"
                accessibilityLabel={`Open subagent ${detail}`}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => onOpenSubagent(childId)}
                onLongPress={car ? undefined : onSelect}
                style={pillStyle}
              >
                <Text numberOfLines={1} style={{ fontSize: 11, color: colors.accent }}>
                  {label}
                </Text>
              </Pressable>
            ) : (
              <View
                key={`${agent.provider}:${agent.id}:${index}`}
                accessibilityLabel={detail}
                style={pillStyle}
              >
                <Text numberOfLines={1} style={{ fontSize: 11, color: colors.muted }}>
                  {label}
                </Text>
              </View>
            )
          })}
        </View>
      )}
      {!!actions.error && (
        <Text accessibilityRole="alert" style={[styles.error, { paddingBottom: 8 }]}>
          {actions.error}
        </Text>
      )}
    </View>
  )
  if (car || task.archivedAt) return content
  return (
    <TaskSwipeActions
      enabled={!disabled && !selectionActive && actions.enabled && !actions.busy}
      primary={{
        label: task.archived ? 'Unsettle' : 'Settle',
        icon: task.archived ? 'reopen' : 'check',
        disabled: task.status === 'running',
        run: actions.toggleSettled,
      }}
      secondary={
        task.archived
          ? undefined
          : {
              label: isSnoozed(task, now) ? 'Unsnooze' : 'Snooze',
              icon: 'snooze',
              run: () =>
                isSnoozed(task, Date.now())
                  ? actions.snooze(null)
                  : chooseSnoozeDuration('Snooze thread', (hours) =>
                      actions.snooze(new Date(Date.now() + hours * 3600000).toISOString()),
                    ),
            }
      }
    >
      {content}
    </TaskSwipeActions>
  )
}
