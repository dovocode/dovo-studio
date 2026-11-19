import { threadInputLabel, useInterfaceText } from '@dovo/studio-core/interface-language'
import { BotAvatar } from '../../bots/bot-avatar'
import { router } from 'expo-router'
import { WorkspaceTypeBadge } from '../../workspace/type-badge'
import type { NestedThread } from '@dovo/protocol'
import { HarnessIcon } from '../../agents/harness-icon'
import { useCachedModelCatalog } from '../../agents/use-model-catalog'
import { harnessNames } from '../creation/harness-choices'
import {
  hasUnreadTaskActivity,
  forgePullTarget,
  pullRepositoryIdentity,
  pullStackLabel,
  taskPullLinks,
  taskPullStatusFor,
  threadChildCount,
  threadInputSummary,
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
  MessageCircleQuestion,
  MessageCircleDashed,
  Network,
  Pin,
  Pause,
  SquareTerminal,
  Save,
  type LucideIcon,
} from 'lucide-react-native'
import { Icon } from '../../ui/controls/icon'
import { Surface } from '../../ui/layout/surface'
import { Image, Linking, View, useWindowDimensions } from 'react-native'
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
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { pullHref } from '../../shell/source-route'
import { TaskSwipeActions } from './task-swipe-actions'
import { isSnoozed, taskIsWorking } from '@dovo/protocol'
import { chooseSnoozeDuration, useTaskLifecycle } from '../detail/use-task-lifecycle'
import { useTheme } from '../../ui/theme'
import { taskRowPresentation } from './task-row-status'
import { memo, useCallback, useRef, useState, type ComponentRef } from 'react'
import type { TaskListOwner } from './task-list-projection'
import type { MobilePreferences } from '../../runtime/preferences/app-preferences'
import { useCarMode } from '../../runtime/preferences/app-preferences'
import { useTaskListUndo } from './task-list-undo'
import { taskListActionHandlers } from './task-list-action'

const statusIcons: Record<string, LucideIcon> = {
  Paused: Pause,
  Draft: FilePenLine,
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
  showTypeIndicator = false,
}: {
  /** Which computer ran a task is noise when only one computer is saved. */
  showDevice?: boolean
  showTypeIndicator?: boolean
  density: MobilePreferences['threadDensity']
  row: RuntimeTask
  /** Includes attention from spawned work without replacing the stable row projection. */
  needsInput?: boolean
  thread?: NestedThread
  owner: TaskListOwner
  now: number
  testID: string
  disabled: boolean
  commands: TaskListRowActions
  selectionActive?: boolean
  selected?: boolean
  current?: boolean
}) {
  const uiText = useInterfaceText()

  const { colors, styles, highContrast } = useTheme()
  const { fontScale } = useWindowDimensions()
  const rowElement = useRef<ComponentRef<typeof View>>(null)
  const pullAnchorElement = useRef<ComponentRef<typeof View>>(null)
  const rowHeight = useRef(0)
  const [pullPosition, setPullPosition] = useState<{
    left: number
    top: number
    width: number
    offsetY: number
  } | null>(null)
  // Keep the independent 44-point control aligned with the inline metadata slot.
  const positionPullShortcut = useCallback(() => {
    const row = rowElement.current
    if (!row) return
    pullAnchorElement.current?.measureLayout(row, (left, y, width, height) => {
      const middle = y + height / 2
      const top = Math.max(0, Math.min(middle - 22, rowHeight.current - 44))
      const offsetY = middle - top - 22
      setPullPosition((previous) =>
        previous?.left === left &&
        previous.top === top &&
        previous.width === width &&
        previous.offsetY === offsetY
          ? previous
          : { left, top, width, offsetY },
      )
    })
  }, [])
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
  const [pullsOpen, setPullsOpen] = useState(false)
  const [pullError, setPullError] = useState('')
  const pullSheet = useRef<SheetHandle>(null)
  const openPull = (url: string) => {
    setPullError('')
    const identity = repository && pullRepositoryIdentity(repository)
    const target = forgePullTarget(url, identity ? [{ identity }] : [])
    if (target) {
      router.push(
        pullHref(
          owner.profile.id,
          repository && identity === target.identity ? repository.id : target.url,
          target.number,
          target,
        ),
      )
    } else {
      void Linking.openURL(url).catch((error: unknown) =>
        setPullError(error instanceof Error ? error.message : String(error)),
      )
    }
  }
  const viewPulls = () => {
    if (pulls.length === 1) openPull(pulls[0]!.url)
    else if (pulls.length > 1) setPullsOpen(true)
  }
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
  const {
    state,
    age,
    label: status,
  } = task.bot?.state === 'paused' &&
  !task.archived &&
  !task.archivedAt &&
  row.online &&
  !needsInput &&
  !taskIsWorking(task)
    ? { state: 'Paused', age: '', label: 'Paused' }
    : taskRowPresentation(task, needsInput, row.online, now)
  const inputLabel =
    row.online && !task.archived && !task.archivedAt
      ? threadInputLabel(thread && threadInputSummary(thread), uiText) ||
        (needsInput ? uiText('Needs input') : '')
      : ''
  const done = state === 'Done'
  const failed = !needsInput && !done && status.startsWith('Failed')
  const displayProject = owner.displayProject ?? repository
  const general = !!task.bot || repository?.kind === 'scratch'
  const projectName = task.bot
    ? task.bot.role
    : displayProject?.kind === 'scratch'
      ? 'No Project'
      : row.projectName || 'No Project'
  const worktree = !general && task.execution === 'worktree'
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
  const StatusIcon = !row.online
    ? CloudOff
    : inputLabel
      ? MessageCircleQuestion
      : state
        ? (statusIcons[state] ?? CircleDashed)
        : undefined
  const settled = task.archived || !!task.archivedAt
  const draft = task.status === 'draft' && !settled
  const unread = hasUnreadTaskActivity(task)

  // If the last metadata item also opens a menu, stack two independent 44pt targets.
  const stackedActions = !car && !settled && !agent && !showDevice && pulls.length > 0
  const minLineHeight = stackedActions ? 44 : 0
  const titleHeight = Math.max(minLineHeight, Math.ceil((dense ? 18 : 20) * fontScale))
  const metadataHeight = Math.max(minLineHeight, 16, Math.ceil(16 * fontScale))
  const rowGap = dense ? 3 : 4
  const contentHeight = metadataHeight + titleHeight + rowGap
  const openRowHeight = (dense ? 16 : 20) + contentHeight
  const headerTop = (openRowHeight - contentHeight) / 2
  const badgeSize = settled ? 16 : 24
  const contextSize = dense ? 11 : 12
  const trailingIconSize = showDevice ? contextSize : 12
  const menuRight = stackedActions && pullPosition ? (pullPosition.width - 44) / 2 : 0
  const contextText = { fontSize: contextSize, lineHeight: dense ? 14 : 16 }
  const metadataText = { ...contextText, opacity: highContrast ? 1 : 0.94 }
  const projectImage =
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
          <Text style={{ color: '#fff', fontSize: settled ? 8 : 11, fontWeight: '700' }}>
            {projectIconInitials(displayProject, row.projectName || 'P')}
          </Text>
        )}
      </View>
    )
  const projectBadge = task.bot ? (
    <BotAvatar avatar={task.bot.avatar} name={task.title} size={badgeSize} />
  ) : (
    projectImage
  )
  const leadingBadge = (
    <View style={{ width: badgeSize, height: badgeSize, flexShrink: 0, position: 'relative' }}>
      {projectBadge}
      {showTypeIndicator && <WorkspaceTypeBadge kind="thread" />}
    </View>
  )
  const pullIndicators = (
    <>
      {pulls.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <PullRequestIcon state={pullStatus?.state} draft={pullStatus?.draft} size={12} />
          <Text numberOfLines={1} style={{ color: pullColor, ...contextText }}>
            {pulls.length > 1
              ? uiText('{value0} PRs', { value0: pulls.length })
              : `#${pulls[0].number}`}
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
  const pullShortcut = !settled && !car && pulls.length > 0 && pullPosition && (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        pulls.length === 1
          ? uiText('Open PR #{value0}: {value1}', {
              value0: pulls[0]!.number,
              value1: pulls[0]!.title,
            })
          : uiText('Linked pull requests')
      }
      disabled={disabled || selectionActive}
      onPress={viewPulls}
      style={{
        position: 'absolute',
        left: pullPosition.left,
        top: pullPosition.top,
        width: pullPosition.width,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
          transform: [{ translateY: pullPosition.offsetY }],
        }}
      >
        {pullIndicators}
      </View>
    </Pressable>
  )
  const terminalIndicator = owner.activeTerminals > 0 && (
    <SquareTerminal
      size={12}
      color={colors.muted}
      accessibilityLabel={uiText('{value0} active terminal{value1}', {
        value0: owner.activeTerminals,
        value1: owner.activeTerminals === 1 ? '' : 's',
      })}
    />
  )
  const subthreadCount = thread ? threadChildCount(thread) : 0
  const subthreadLabel = subthreadCount
    ? `${uiText('Subthreads for {value0}', { value0: task.title })}, ${subthreadCount}`
    : ''
  const subthreadIndicator = subthreadCount > 0 && (
    <View
      testID="Subthread count"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
    >
      <Network size={10} color={colors.muted} />
      <Text style={{ color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] }}>
        {subthreadCount}
      </Text>
    </View>
  )
  const titleText = (
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
  const title = titleText

  const statusIndicator = (StatusIcon || !!age) && (
    <View
      testID="Thread status"
      accessibilityLabel={row.online ? inputLabel || status : `${uiText('Offline')} · ${status}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
        maxWidth: '45%',
      }}
    >
      {!!age && (
        <Text
          numberOfLines={1}
          style={{
            color: stateColor,
            flexShrink: 1,
            ...contextText,
            opacity: stateColor === colors.muted ? metadataText.opacity : 1,
          }}
        >
          {age}
        </Text>
      )}
      {StatusIcon && <StatusIcon size={12} color={stateColor} />}
    </View>
  )

  const content = (
    <View
      style={{
        marginVertical: dense ? 2 : 3,
        borderRadius: 12,
        backgroundColor: selected || current ? 'transparent' : colors.background,
      }}
    >
      {(selected || current) && (
        <Surface
          pointerEvents="none"
          tinted
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 12 }}
        >
          {null}
        </Surface>
      )}
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
          positionPullShortcut()
        }}
        style={{ flexDirection: 'row', alignItems: settled ? 'center' : 'flex-start' }}
      >
        {settled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText('Task details for {value0}', { value0: task.title })}
            disabled={disabled}
            onPress={onDetails}
            style={{
              width: 44,
              height: Math.max(44, titleHeight + 12),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {leadingBadge}
          </Pressable>
        )}
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${task.bot ? uiText('Bot, ') : ''}${task.pinned ? uiText('Pinned, ') : ''}${projectName}, ${task.title}, ${inputLabel || status}${unread ? `, ${uiText('Unread')}` : ''}, ${task.bot ? uiText('Bot') : general ? uiText('Conversation') : `${worktree ? uiText('Worktree') : uiText('Local checkout')}, ${branch}`}, ${executionDevice}${row.online ? '' : uiText(', Offline')}${agent ? `, ${providerName}${agent.model ? ` · ${modelName}` : ''}` : ''}${subthreadLabel ? `, ${subthreadLabel}` : ''}`}
          accessibilityHint={
            car
              ? uiText('Open conversation.')
              : selectionActive
                ? uiText('Tap to toggle selection.')
                : settled
                  ? task.bot
                    ? uiText(
                        'Open Bot conversation. Touch and hold to select. Tap the Bot icon for actions.',
                      )
                    : uiText(
                        'Open conversation. Touch and hold to select. Tap the project icon for task details.',
                      )
                  : uiText(
                      'Open conversation. Touch and hold to select. Task details are in the actions menu.',
                    )
          }
          accessibilityState={{ disabled, selected: selectionActive ? selected : current }}
          accessibilityActions={
            car
              ? []
              : [
                  {
                    name: 'select',
                    label: selected ? uiText('Deselect task') : uiText('Select task'),
                  },
                  ...(pulls.length && !settled && !selectionActive
                    ? [{ name: 'linked-pulls', label: uiText('Linked pull requests') }]
                    : []),
                ]
          }
          onAccessibilityAction={({ nativeEvent }) => {
            if (!disabled && !car && nativeEvent.actionName === 'select') onSelect()
            if (!disabled && !car && nativeEvent.actionName === 'linked-pulls') viewPulls()
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
            gap: settled ? 0 : 8,
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {terminalIndicator}
                {subthreadIndicator}
                {pullIndicators}
                {general && agent && <HarnessIcon provider={agent.provider} size={12} />}
                {general && showDevice && (
                  <DeviceLabel
                    runtimeIcon={owner.runtimeIcon}
                    task={task}
                    runtimeHost={row.runtimeName}
                  />
                )}
              </View>
              {statusIndicator}
            </View>
          ) : (
            <>
              <View testID={task.bot ? 'Bot identity icon' : 'Thread project icon'}>
                {leadingBadge}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: rowGap }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    height: titleHeight,
                    gap: 6,
                    paddingRight: car ? 0 : 32 + menuRight,
                  }}
                >
                  {title}
                  {statusIndicator}
                </View>
                <View
                  testID="Thread metadata"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    height: metadataHeight,
                    gap: 5,
                    marginRight: car ? 0 : -12,
                    paddingRight: car || stackedActions ? 0 : 22 - trailingIconSize / 2,
                  }}
                >
                  <View
                    testID={task.bot ? 'Bot identity' : 'Thread project'}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      flex: 1,
                      minWidth: 0,
                      gap: 4,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.muted,
                        { flexShrink: 1, maxWidth: general ? '100%' : '42%', ...metadataText },
                      ]}
                    >
                      {projectName}
                    </Text>
                    {!general && (
                      <>
                        <Text style={[styles.muted, metadataText]}>·</Text>
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          style={[styles.muted, { flex: 1, minWidth: 0, ...metadataText }]}
                        >
                          {branch}
                        </Text>
                      </>
                    )}
                  </View>
                  {task.pinned && <Pin size={12} color={colors.muted} />}
                  {terminalIndicator}
                  {subthreadIndicator}
                  {!car && pulls.length > 0 ? (
                    <View
                      ref={pullAnchorElement}
                      collapsable={false}
                      onLayout={positionPullShortcut}
                      style={{
                        minWidth: 44,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 3,
                        opacity: pullPosition ? 0 : 1,
                      }}
                      importantForAccessibility="no-hide-descendants"
                    >
                      {pullIndicators}
                    </View>
                  ) : (
                    pullIndicators
                  )}
                  {(agent || (showDevice && !car)) && (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 5,
                        // Leave the 44pt menu column clear of adjacent shortcut hit targets.
                        minWidth: !car && pulls.length ? 28 : undefined,
                      }}
                    >
                      {!!agent && <HarnessIcon provider={agent.provider} size={12} />}
                      {showDevice && !car && (
                        <DeviceLabel
                          runtimeIcon={owner.runtimeIcon}
                          task={task}
                          runtimeHost={row.runtimeName}
                          size={contextSize}
                        />
                      )}
                    </View>
                  )}
                </View>
              </View>
            </>
          )}
        </Pressable>
        {pullShortcut}
        {!car && !settled && (
          <View style={{ position: 'absolute', right: menuRight, top: 0 }}>
            <TaskRowMenu
              testID={`${testID} actions`}
              contentOffsetY={headerTop + titleHeight / 2 - 22}
              task={task}
              actions={actions}
              disabled={disabled}
              onOpen={onOpen}
              onDetails={onDetails}
            />
          </View>
        )}
      </View>
      {(actions.error || pullError) && (
        <Text accessibilityRole="alert" style={[styles.error, { paddingBottom: 8 }]}>
          {actions.error || pullError}
        </Text>
      )}
      {pullsOpen && (
        <Sheet
          ref={pullSheet}
          title={uiText('Linked pull requests')}
          onClose={() => setPullsOpen(false)}
        >
          {pulls.map((pull) => (
            <Pressable
              key={pull.url}
              accessibilityRole="button"
              accessibilityLabel={uiText('Open PR #{value0}: {value1}', {
                value0: pull.number,
                value1: pull.title,
              })}
              onPress={() => pullSheet.current?.dismiss(() => openPull(pull.url))}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text>
                #{pull.number} · {pull.title}
              </Text>
            </Pressable>
          ))}
        </Sheet>
      )}
    </View>
  )
  if (car || task.archivedAt || task.bot) return content
  return (
    <TaskSwipeActions
      enabled={!disabled && !selectionActive && actions.enabled && !actions.busy}
      primary={{
        label: task.archived ? uiText('Unsettle') : uiText('Settle'),
        icon: task.archived ? 'reopen' : 'check',
        disabled: task.status === 'running',
        run: actions.toggleSettled,
      }}
      secondary={
        task.archived
          ? undefined
          : {
              label: isSnoozed(task, now) ? uiText('Unsnooze') : uiText('Snooze'),
              icon: 'snooze',
              run: () =>
                isSnoozed(task, Date.now())
                  ? actions.snooze(null)
                  : chooseSnoozeDuration('Snooze thread', (until) => actions.snooze(until)),
            }
      }
    >
      {content}
    </TaskSwipeActions>
  )
}

/** Streaming another task leaves this row and its owner subscriptions unchanged. */
export const TaskListRow = memo(TaskListRowView)
