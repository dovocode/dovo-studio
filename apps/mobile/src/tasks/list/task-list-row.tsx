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
  MessageCircleQuestion,
  MessageCircleDashed,
  Pin,
  Network,
  SquareTerminal,
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
import { PullRequestIcon, usePullRequestColor } from '../../ui/content/pull-request-icon'
import { DeviceLabel } from './device-label'
import { TaskRowMenu } from './task-row-menu'
import { TaskSwipeActions } from './task-swipe-actions'
import { isSnoozed, taskIsWorking } from '@dovo/protocol'
import { chooseSnoozeDuration, useTaskLifecycle } from '../detail/use-task-lifecycle'
import { useTheme } from '../../ui/theme'
import { showTaskDone, taskRowStatus } from './task-row-status'
import { memo, useCallback, useMemo, useRef, useState, type ComponentRef } from 'react'
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
  hideStatusLabel = false,
}: {
  /** Which computer ran a task is noise when only one computer is saved. */
  showDevice?: boolean
  hideStatusLabel?: boolean
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
  const { colors, styles, highContrast } = useTheme()
  const { fontScale } = useWindowDimensions()
  const rowElement = useRef<ComponentRef<typeof View>>(null)
  const subthreadAnchorElement = useRef<ComponentRef<typeof View>>(null)
  const rowHeight = useRef(0)
  const [subthreadPosition, setSubthreadPosition] = useState<{
    left: number
    top: number
    offsetY: number
  } | null>(null)
  // Keep the independent 44-point control aligned with the inline metadata slot.
  const positionSubthreadControl = useCallback(() => {
    const row = rowElement.current
    if (!row) return
    subthreadAnchorElement.current?.measureLayout(row, (x, y) => {
      const top = Math.max(0, Math.min(y - 12, rowHeight.current - 44))
      const next = { left: Math.max(0, x - 12), top, offsetY: y + 10 - top - 22 }
      setSubthreadPosition((current) =>
        current?.left === next.left && current.top === next.top && current.offsetY === next.offsetY
          ? current
          : next,
      )
    })
  }, [])
  const [expanded, setExpanded] = useState(false)
  const open = !!searching || expanded
  const onOpen = useCallback(() => commands.open(row.key), [commands, row.key])
  const onDetails = useCallback(() => commands.details(row.key), [commands, row.key])
  const onSelect = useCallback(() => commands.select(row.key), [commands, row.key])

  const task = row.task,
    repository = owner.repository,
    agent = resolveTaskAgent(task, owner.agents)
  const pulls = taskPullLinks(task).sort(
    (a, b) => Number(b.url === task.pullStatus?.url) - Number(a.url === task.pullStatus?.url),
  )
  const pullStatus = pulls[0] ? taskPullStatusFor(task, pulls[0].url) : undefined
  const pullColor = usePullRequestColor(pullStatus?.state, pullStatus?.draft)
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
    displayProject?.kind === 'scratch' ? 'No Project' : row.projectName || 'No Project'
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
  const draft = task.status === 'draft' && !settled
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

  const titleHeight = Math.ceil((dense ? 18 : 20) * fontScale)
  const metadataHeight = Math.max(16, Math.ceil(16 * fontScale))
  const rowGap = dense ? 3 : 4
  const hasFooter = !general
  const contentHeight =
    metadataHeight + titleHeight + (hasFooter ? metadataHeight : 0) + rowGap * (hasFooter ? 2 : 1)
  const openRowHeight = (dense ? 16 : 20) + contentHeight
  const headerTop = (openRowHeight - contentHeight) / 2
  const badgeSize = 16
  const contextSize = dense ? 11 : 12
  const contextText = { fontSize: contextSize, lineHeight: dense ? 14 : 16 }
  const metadataText = { ...contextText, opacity: highContrast ? 1 : 0.94 }
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
        <MessageCircleDashed size={dense ? 12 : 14} color={colors.muted} />
      </View>
    ) : (
      <View
        style={{
          width: badgeSize,
          height: badgeSize,
          borderRadius: 4,
          overflow: 'hidden',
          backgroundColor: icon ? 'transparent' : projectIconColor(displayProject),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon ? (
          <Image source={{ uri: icon }} style={{ width: badgeSize, height: badgeSize }} />
        ) : (
          <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700' }}>
            {projectIconInitials(displayProject, row.projectName || 'P')}
          </Text>
        )}
      </View>
    )
  const subthreadControl = childCount > 0 && (
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
        left: subthreadPosition?.left ?? 0,
        top: subthreadPosition?.top ?? 0,
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: subthreadPosition ? 1 : 0,
      }}
    >
      <Network
        style={{ transform: [{ translateY: subthreadPosition?.offsetY ?? 0 }] }}
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
  )
  const subthreadAnchor = childCount > 0 && (
    <View
      ref={subthreadAnchorElement}
      testID="Subthread anchor"
      collapsable={false}
      onLayout={positionSubthreadControl}
      style={{ width: 20, height: 20 }}
    />
  )
  const pullIndicators = (
    <>
      {pulls.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <PullRequestIcon state={pullStatus?.state} draft={pullStatus?.draft} size={12} />
          <Text numberOfLines={1} style={{ color: pullColor, ...contextText }}>
            {pulls.length > 1 ? `${pulls.length} PRs` : `#${pulls[0].number}`}
          </Text>
        </View>
      )}
      {pulls.length <= 1 && task.pullStatus?.stack && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Icon name="stack" size={12} color={pullColor} />
          <Text numberOfLines={1} style={{ color: pullColor, ...contextText }}>
            {pullStackLabel(task.pullStatus.stack)}
          </Text>
        </View>
      )}
    </>
  )
  const terminalIndicator = owner.activeTerminals > 0 && (
    <SquareTerminal
      size={12}
      color={colors.muted}
      accessibilityLabel={`${owner.activeTerminals} active terminal${owner.activeTerminals === 1 ? '' : 's'}`}
    />
  )
  const executionIcons = (
    <View
      testID="thread-execution"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '40%' }}
    >
      {terminalIndicator}
      {pullIndicators}
      {subthreadAnchor}
      {showDevice && (
        <DeviceLabel
          runtimeIcon={owner.runtimeIcon}
          task={task}
          runtimeHost={row.runtimeName}
          size={contextSize}
        />
      )}
      {!!agent && <HarnessIcon provider={agent.provider} size={12} />}
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

  const groupedStatus =
    hideStatusLabel && row.online && (state === 'Working' || state === 'Waiting')
  const statusIndicator = (
    <View
      testID="Thread status"
      accessibilityLabel={groupedStatus ? status : undefined}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
        maxWidth: '45%',
      }}
    >
      {StatusIcon && <StatusIcon size={12} color={stateColor} />}
      <Text
        numberOfLines={1}
        style={{
          color: stateColor,
          flexShrink: 1,
          ...contextText,
          opacity: stateColor === colors.muted ? metadataText.opacity : 1,
        }}
      >
        {groupedStatus
          ? age
          : working || state === 'Waiting' || needsInput || done || failed
            ? `${state}${age ? ` ${age}` : ''}`
            : age || state}
      </Text>
    </View>
  )

  const content = (
    <View
      style={{
        marginVertical: dense ? 2 : 3,
        borderRadius: 12,
        backgroundColor: selected || current ? colors.selection : colors.background,
      }}
    >
      {(selected || current) && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            borderRadius: 12,
            borderWidth: highContrast ? 2 : 1,
            borderColor: colors.accent,
          }}
        />
      )}
      {draft && (
        <View
          pointerEvents="none"
          testID="Draft highlight"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            borderRadius: 12,
            backgroundColor: colors.warning,
            opacity: 0.06,
          }}
        />
      )}
      <View
        ref={rowElement}
        collapsable={false}
        onLayout={(event) => {
          rowHeight.current = event.nativeEvent.layout.height
          positionSubthreadControl()
        }}
        style={{ flexDirection: 'row', alignItems: settled ? 'center' : 'flex-start' }}
      >
        {settled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Task details for ${task.title}`}
            disabled={disabled}
            onPress={onDetails}
            style={{
              width: 44,
              height: Math.max(44, titleHeight + 12),
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
            height: settled ? Math.max(44, titleHeight + 12) : openRowHeight,
            alignItems: 'center',
            paddingVertical: 6,
            paddingLeft: settled ? 0 : 12,
            paddingRight: 12,
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
              {general ? (
                executionIcons
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {terminalIndicator}
                  {pullIndicators}
                  {subthreadAnchor}
                </View>
              )}
              {statusIndicator}
            </View>
          ) : (
            <View style={{ flex: 1, minWidth: 0, gap: rowGap }}>
              <View
                testID="Thread project"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  height: metadataHeight,
                  gap: 6,
                  paddingRight: car ? 0 : 32,
                }}
              >
                {draft && (
                  <FilePenLine accessibilityLabel="Draft" size={12} color={colors.warning} />
                )}
                <View testID="Thread project icon" style={{ width: badgeSize, flexShrink: 0 }}>
                  {projectBadge}
                </View>
                <Text numberOfLines={1} style={[styles.muted, { flex: 1, ...metadataText }]}>
                  {projectName}
                </Text>
                {task.pinned && <Pin size={12} color={colors.muted} />}
                {statusIndicator}
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  height: titleHeight,
                  gap: 6,
                  paddingRight: !car && general && childCount > 0 ? 44 : 0,
                }}
              >
                {title}
                {general && executionIcons}
                {general && row.reachability === 'offline' && (
                  <CloudOff size={12} color={colors.muted} accessibilityLabel="Offline" />
                )}
              </View>
              {hasFooter && (
                <View
                  testID="Thread metadata"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    height: metadataHeight,
                    gap: 6,
                    paddingRight: !car && childCount > 0 ? (!showDevice && !agent ? 44 : 32) : 0,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      minWidth: 0,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <GitBranch size={12} color={colors.muted} />
                    <Text
                      numberOfLines={1}
                      style={[styles.muted, { flexShrink: 1, ...metadataText }]}
                    >
                      {branch}
                    </Text>
                  </View>
                  {terminalIndicator}
                  {pullIndicators}
                  {subthreadAnchor}
                  {showDevice && !car && (
                    <DeviceLabel
                      runtimeIcon={owner.runtimeIcon}
                      task={task}
                      runtimeHost={row.runtimeName}
                      size={contextSize}
                    />
                  )}
                  {!!agent && <HarnessIcon provider={agent.provider} size={12} />}
                  {row.reachability === 'offline' && (
                    <CloudOff size={12} color={colors.muted} accessibilityLabel="Offline" />
                  )}
                </View>
              )}
            </View>
          )}
        </Pressable>
        {subthreadControl}
        {!car && !settled && (
          <View style={{ position: 'absolute', right: 0, top: 0 }}>
            <TaskRowMenu
              testID={`${testID} actions`}
              contentOffsetY={headerTop + metadataHeight / 2 - 22}
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
