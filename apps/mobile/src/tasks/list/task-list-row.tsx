import { NestedThreads } from './nested-threads'
import type { NestedThread } from '@dovo/protocol'
import { HarnessIcon } from '../../agents/harness-icon'
import { useCachedModelCatalog } from '../../agents/use-model-catalog'
import { harnessNames } from '../creation/harness-choices'
import {
  hasUnreadTaskActivity,
  pullStackLabel,
  taskPullLinks,
  taskPullStatusFor,
  threadChildRows,
  threadTreeSummary,
} from '@dovo/protocol'
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
  MessageCircle,
  Pin,
  Network,
  Save,
  type LucideIcon,
} from 'lucide-react-native'
import { Icon } from '../../ui/controls/icon'
import { Image, View, useWindowDimensions } from 'react-native'
// Keep row presses in the pan recognizer's native gesture system so swipes cancel taps.
import { Pressable } from 'react-native-gesture-handler'
import { Text } from '../../ui/content/text'
import {
  projectIcon,
  projectIconColor,
  projectIconInitials,
  acpHarnessName,
  resolveTaskAgent,
  type RuntimeTask,
} from '@dovo/protocol'
import { PullRequestIcon } from '../../ui/content/pull-request-icon'
import { DeviceLabel } from './device-label'
import { TaskRowMenu } from './task-row-menu'
import { TaskSwipeActions } from './task-swipe-actions'
import { isSnoozed, taskIsWorking } from '@dovo/protocol'
import { chooseSnoozeDuration, useTaskLifecycle } from '../detail/use-task-lifecycle'
import { useTheme } from '../../ui/theme'
import { showTaskDone, taskRowStatus } from './task-row-status'
import { memo, useCallback, useMemo, useState } from 'react'
import type { TaskListOwner } from './task-list-projection'
import type { MobilePreferences } from '../../runtime/preferences/app-preferences'
import { useCarMode } from '../../runtime/preferences/app-preferences'
import { useTaskListUndo } from './task-list-undo'
import { taskListActionHandlers } from './task-list-action'

const statusIcons: Record<string, LucideIcon> = {
  Working: CircleDashed,
  'Was working': CloudOff,
  Done: CircleCheck,
  Failed: CircleX,
  Stopped: CircleStop,
  Snoozed: AlarmClock,
  Waiting: AlarmClock,
  Settled: CircleCheck,
  Archived: Archive,
  Draft: FilePenLine,
  'Needs input': MessageCircleQuestion,
  'Saving changes': Save,
}
export type TaskListRowActions = {
  open: (key: string) => void
  details: (key: string) => void
  select: (key: string) => void
}
function TaskListRowView({
  row,
  needsInput = row.needsInput,
  thread,
  searching,
  owner,
  now,
  testID,
  disabled,
  commands,
  selectionActive = false,
  selected = false,
  current = false,
  showDevice = true,
  density,
}: {
  /** Which computer ran a task is noise when only one computer is saved. */
  showDevice?: boolean
  density: MobilePreferences['threadDensity']
  row: RuntimeTask
  /** Includes attention from spawned work without replacing the stable row projection. */
  needsInput?: boolean
  thread?: NestedThread
  searching?: boolean
  owner: TaskListOwner
  now: number
  testID: string
  disabled: boolean
  commands: TaskListRowActions
  selectionActive?: boolean
  selected?: boolean
  current?: boolean
}) {
  const { colors, styles } = useTheme()
  const { fontScale } = useWindowDimensions()
  const [expanded, setExpanded] = useState(false)
  const open = !!searching || expanded
  const onOpen = useCallback(() => commands.open(row.key), [commands, row.key])
  const onDetails = useCallback(() => commands.details(row.key), [commands, row.key])
  const onSelect = useCallback(() => commands.select(row.key), [commands, row.key])

  const task = row.task,
    repository = owner.repository,
    agent = resolveTaskAgent(task, owner.agents)
  const pulls = taskPullLinks(task)
  const pullStatus =
    task.pullStatus ?? (pulls[0] ? taskPullStatusFor(task, pulls[0].url) : undefined)
  const executionDevice = row.runtimeName
  const { modelName, catalog } = useCachedModelCatalog(agent, owner.profile)
  const providerName = agent
    ? ((task.harness ? acpHarnessName(agent, owner.acpInstallations) : undefined) ??
      catalog?.harness?.name ??
      harnessNames[agent.provider])
    : ''
  const lifecycle = useTaskLifecycle(task, row.runtimeId)
  const undo = useTaskListUndo()
  const actions = {
    ...lifecycle,
    busy: lifecycle.busy || undo.busy,
    ...taskListActionHandlers(
      task,
      owner.profile,
      owner.taskListUndoSupported,
      lifecycle,
      undo.run,
    ),
  }
  const car = useCarMode()
  const dense = !car && density === 'compact'
  const status = taskRowStatus(task, needsInput, row.online, now)
  const done = showTaskDone(task, needsInput, now)
  const failed = !needsInput && !done && status.startsWith('Failed')
  const displayProject = owner.displayProject ?? repository
  const general = repository?.kind === 'scratch'
  const projectName =
    displayProject?.kind === 'scratch' ? 'General' : row.projectName || 'No project'
  const worktree = !general && task.execution === 'worktree'
  // "Review · 23m" → state "Review" and a right-aligned age "23m".
  const [state, age] = /^(.*) · (now|\d+[mhd])$/.exec(status)?.slice(1) ?? [status, '']
  const working = taskIsWorking(task) && !needsInput
  const stateColor = needsInput
    ? colors.warning
    : failed
      ? colors.error
      : done || state === 'Settled'
        ? colors.success
        : working
          ? colors.accent
          : colors.muted
  const branch =
    task.checkoutBranch ??
    (task.execution === 'worktree' ? 'Worktree' : repository?.branch) ??
    'Project checkout'
  const icon = projectIcon(displayProject)
  const StatusIcon = statusIcons[state]
  const settled = task.archived || !!task.archivedAt
  const childRows = useMemo(() => (thread ? threadChildRows(thread) : []), [thread])
  const summary = useMemo(
    () => threadTreeSummary(childRows, task.acknowledgedSubagentFailures),
    [childRows, task.acknowledgedSubagentFailures],
  )
  const childCount = task.archivedAt ? 0 : summary.total
  const childrenDetail = [
    `${childCount} subthread${childCount === 1 ? '' : 's'}`,
    summary.attention ? `${summary.attention} needs input` : '',
    summary.running ? `${summary.running} running` : '',
    summary.waiting ? `${summary.waiting} waiting` : '',
    summary.failed ? `${summary.failed} failed` : '',
    summary.offline ? `${summary.offline} offline` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const unread = hasUnreadTaskActivity(task)

  const compactTitleHeight = Math.ceil(18 * fontScale)
  const compactContextHeight = Math.max(16, Math.ceil(16 * fontScale))
  const headerHeight = dense ? compactContextHeight : Math.max(26, Math.ceil(16 * fontScale))
  const compactRowHeight = 12 + compactTitleHeight + 6 + compactContextHeight * 2
  const badgeSize = dense ? Math.max(16, Math.ceil(12 * fontScale)) : 20
  const contextSize = dense ? 11 : 12
  const contextText = { fontSize: contextSize, lineHeight: dense ? 14 : 16 }
  const projectBadge =
    displayProject?.kind === 'scratch' ? (
      <View
        style={{
          width: badgeSize,
          height: badgeSize,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MessageCircle size={dense ? 14 : 16} color={colors.muted} />
      </View>
    ) : (
      <View
        style={{
          width: badgeSize,
          height: badgeSize,
          borderRadius: 5,
          overflow: 'hidden',
          backgroundColor: icon ? 'transparent' : projectIconColor(displayProject),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon ? (
          <Image source={{ uri: icon }} style={{ width: badgeSize, height: badgeSize }} />
        ) : (
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
            {projectIconInitials(displayProject, row.projectName || 'P')}
          </Text>
        )}
      </View>
    )
  const title = (
    <Text
      numberOfLines={1}
      style={{
        flex: 1,
        color: selected || current || unread ? colors.text : colors.muted,
        fontSize: dense ? 15 : 16,
        lineHeight: dense ? 18 : 20,
        fontWeight: unread ? '600' : '500',
      }}
    >
      {task.title}
    </Text>
  )

  const statusIndicator = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
        maxWidth: dense ? '45%' : undefined,
      }}
    >
      {StatusIcon && <StatusIcon size={12} color={stateColor} />}
      <Text numberOfLines={1} style={{ color: stateColor, flexShrink: 1, ...contextText }}>
        {working || needsInput || done || failed ? `${state}${age ? ` ${age}` : ''}` : age || state}
      </Text>
    </View>
  )

  const content = (
    <View
      style={{
        marginVertical: dense ? 1 : 2,
        borderRadius: 12,
        backgroundColor: selected || current ? colors.selection : colors.background,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: settled ? 'center' : 'flex-start' }}>
        {settled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Task details for ${task.title}`}
            disabled={disabled}
            onPress={onDetails}
            style={{
              width: 44,
              height: Math.max(44, compactTitleHeight + 12),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {projectBadge}
          </Pressable>
        )}
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${task.pinned ? 'Pinned, ' : ''}${projectName}, ${task.title}, ${status}, ${general ? 'Conversation' : `${worktree ? 'Worktree' : 'Local checkout'}, ${branch}`}, ${executionDevice}${row.online ? '' : ', Offline'}${agent ? `, ${providerName}${agent.model ? ` · ${modelName}` : ''}` : ''}`}
          accessibilityHint={
            car
              ? 'Open conversation.'
              : selectionActive
                ? 'Tap to toggle selection.'
                : settled
                  ? 'Open conversation. Touch and hold to select. Tap the project icon for task details.'
                  : 'Open conversation. Touch and hold to select. Task details are in the actions menu.'
          }
          accessibilityState={{ disabled, selected: selectionActive ? selected : current }}
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
            minHeight: settled ? 44 : undefined,
            height: settled
              ? Math.max(44, compactTitleHeight + 12)
              : dense
                ? compactRowHeight
                : undefined,
            alignItems: settled || dense ? 'center' : undefined,
            paddingVertical: 6,
            paddingLeft: settled ? 0 : 12,
            paddingRight: (dense && !settled) || (settled && childCount > 0) ? 44 : 12,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          {selectionActive && (
            <View style={{ width: 28, alignItems: 'center', paddingTop: settled ? 1 : 7 }}>
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
          {settled ? (
            <View
              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              {title}
              {statusIndicator}
            </View>
          ) : (
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: headerHeight,
                  height: dense ? compactContextHeight : undefined,
                  paddingRight:
                    (car || dense || settled ? 0 : 32) + (!settled && childCount > 0 ? 44 : 0),
                }}
              >
                {!settled && projectBadge}
                <Text numberOfLines={1} style={[styles.muted, { flex: 1, ...contextText }]}>
                  {projectName}
                </Text>
                {task.pinned && <Pin size={12} color={colors.muted} />}
                {worktree && <GitFork size={12} color={colors.muted} />}
                {statusIndicator}
                {!!agent && (!showDevice || car) && (
                  <HarnessIcon provider={agent.provider} size={12} />
                )}
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: dense ? compactTitleHeight : undefined,
                  // Comfortable titles start within the menu’s 44-point target.
                  paddingRight:
                    (!car && !dense && !settled ? 32 : 0) + (!settled && childCount > 0 ? 44 : 0),
                }}
              >
                {title}
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  flexWrap: 'nowrap',
                  height: dense ? compactContextHeight : undefined,
                  overflow: dense ? 'hidden' : undefined,
                  gap: 6,
                }}
              >
                {!general && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: dense ? 4 : 6,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <GitBranch size={12} color={colors.muted} />
                    <Text
                      numberOfLines={1}
                      style={[styles.muted, { flexShrink: 1, ...contextText }]}
                    >
                      {branch}
                    </Text>
                  </View>
                )}
                {general && !dense && <View style={{ flex: 1 }} />}
                {showDevice && !car && (
                  <DeviceLabel
                    runtimeIcon={owner.runtimeIcon}
                    task={task}
                    runtimeHost={row.runtimeName}
                    compact
                    fontSize={contextSize}
                    flexible={dense}
                  />
                )}
                {showDevice && !car && !!agent && (
                  <HarnessIcon provider={agent.provider} size={12} />
                )}
                {row.reachability === 'offline' &&
                  (dense ? (
                    <CloudOff size={12} color={colors.muted} accessibilityLabel="Offline" />
                  ) : (
                    <Text style={[styles.muted, contextText]}>Offline</Text>
                  ))}
                {pulls.length > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <PullRequestIcon
                      state={pullStatus?.state}
                      draft={pullStatus?.draft}
                      size={12}
                    />
                    <Text numberOfLines={1} style={{ color: colors.muted, ...contextText }}>
                      {pulls.length > 1 ? `${pulls.length} PRs` : `#${pulls[0].number}`}
                    </Text>
                  </View>
                )}
                {pulls.length <= 1 && task.pullStatus?.stack && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Icon name="stack" size={12} color={colors.accent} />
                    <Text numberOfLines={1} style={{ color: colors.accent, ...contextText }}>
                      {pullStackLabel(task.pullStatus.stack)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </Pressable>
        {childCount > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Subthreads for ${task.title}`}
            accessibilityHint={childrenDetail}
            accessibilityState={{
              expanded: open,
              disabled: disabled || selectionActive || !!searching,
            }}
            disabled={disabled || selectionActive || !!searching}
            onPress={() => setExpanded(!open)}
            style={{
              position: 'absolute',
              right: !car && !settled ? 44 : 0,
              top: 0,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              // Align the glyph with the header while keeping its touch target 44 points high.
              paddingTop: Math.max(0, 12 + headerHeight - 44),
              paddingBottom: Math.max(0, 44 - 12 - headerHeight),
            }}
          >
            <Network
              size={16}
              color={
                summary.failed
                  ? colors.error
                  : summary.attention
                    ? colors.warning
                    : open
                      ? colors.accent
                      : colors.muted
              }
            />
          </Pressable>
        )}
        {!car && !settled && (
          <View style={{ position: 'absolute', right: 0, top: 0 }}>
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
      {open && thread && !task.archivedAt && (
        <NestedThreads
          hideSummary
          thread={{ ...thread, children: childRows, nativeAgents: undefined }}
          acknowledgedFailures={task.acknowledgedSubagentFailures}
          disabled={disabled || selectionActive}
          searching={searching}
        />
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

/** Streaming another task leaves this row and its owner subscriptions unchanged. */
export const TaskListRow = memo(TaskListRowView)
