import { responses } from '@dovo/protocol'
import { useAction } from '../ui/use-action'
import { useApplicationState } from '../runtime/application-state'
import { TaskAgents } from './task-agents'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BrowserPane } from './browser-pane'
import { Conversation } from './conversation/view'
import { ConversationProvider } from './conversation/provider'
import { useNavigation } from '../shell/navigation'
import { MessageQueue } from './message-queue'
import { TaskQuestions } from './task-questions'
import { TaskSettings } from './task-settings'
import { ActivityIndicator, Keyboard, Pressable, View, useWindowDimensions } from 'react-native'
import { Text } from '../ui/text'
import { type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Sheet } from '../ui/sheet'
import { colors, styles } from '../ui/theme'
import { ScreenHeader } from '../ui/screen-header'
import { Composer } from './composer'
import { TaskReview } from './task-review'
import { TerminalPane } from '../terminal/terminal-pane'
import { TaskSource } from './task-source'
import { useTaskViewed } from './use-task-viewed'
export function TaskDetail({ task, onBack }: { task: Task; onBack: () => void }) {
  const { focused } = useNavigation()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { snapshot, connected, profiles, callEffect } = useRuntime()
  const resume = useAction()
  const needsInput =
    snapshot?.questions.some((q) => q.taskId === task.id) ||
    snapshot?.approvals.some((a) => a.taskId === task.id)
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const latestTurn = task.turns?.at(-1)
  const runtimeHost =
    (latestTurn ? latestTurn.runtimeHost : snapshot?.runtimeHost) ?? 'Unknown device'
  // Name the computer only when there is more than one to tell apart.
  const subtitle = [repository?.name, profiles.length > 1 ? runtimeHost : undefined]
    .filter(Boolean)
    .join(' · ')
  const status = task.archivedAt
    ? 'Archived'
    : task.archived
      ? 'Settled'
      : needsInput
        ? 'Needs input'
        : task.status === 'running'
          ? 'Working'
          : task.status === 'failed'
            ? 'Failed'
            : task.status === 'review'
              ? 'Ready for review'
              : task.status === 'done'
                ? 'Finished'
                : task.status === 'cancelled'
                  ? 'Stopped'
                  : 'Draft'
  const [checkpoint, setCheckpoint] = useApplicationState('')
  const [terminalId, setTerminalId] = useApplicationState('')
  const [pane, setPane] = useApplicationState<'chat' | 'diff' | 'terminal' | 'browser' | 'agents'>(
    'chat',
  )
  const [expandedPreview, setExpandedPreview] = useApplicationState(false)
  const [settings, setSettings] = useApplicationState(false)
  const [settingsBusy, setSettingsBusy] = useApplicationState(false)
  const viewed = useTaskViewed(task, pane === 'chat' && !settings)
  return (
    <View
      style={[
        styles.screen,
        pane === 'browser' &&
          expandedPreview && {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
      ]}
    >
      <ScreenHeader
        title={task.title}
        titleContent={
          <Pressable
            testID="Task settings"
            accessibilityRole="button"
            accessibilityLabel={[task.title, subtitle, status].join('. ')}
            accessibilityHint="Open task settings."
            onPress={() => setSettings(true)}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              width: Math.max(80, width - 244),
              minWidth: 0,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
              {task.title}
            </Text>
            <Text
              testID="Task device subtitle"
              accessibilityLabel={subtitle}
              numberOfLines={1}
              style={{ color: colors.muted, fontSize: 11, lineHeight: 15 }}
            >
              {subtitle} · {status}
            </Text>
          </Pressable>
        }
        hidden={pane === 'browser' && expandedPreview}
        gestureEnabled={pane !== 'browser'}
        onBack={pane === 'browser' ? onBack : undefined}
        leading={<Action secondary label="Back" onPress={onBack} />}
        buttons={(['chat', 'diff', 'terminal', 'browser', 'agents'] as const).map((tab) => ({
          label:
            tab === 'chat'
              ? 'Chat'
              : tab === 'diff'
                ? `Changes (${task.files.length})`
                : tab === 'terminal'
                  ? 'Terminal'
                  : tab === 'agents'
                    ? 'Agents'
                    : 'Browser',
          icon: tab === 'diff' ? 'changes' : tab === 'browser' ? 'web' : tab,
          selected: pane === tab,
          overflow: tab === 'chat' || tab === 'browser' || tab === 'agents',
          onPress: () => {
            Keyboard.dismiss()
            setCheckpoint('')
            setPane(tab)
          },
        }))}
      />
      {task.workItem && (
        <View
          style={{
            paddingHorizontal: 16,
          }}
        >
          <TaskSource task={task} />
        </View>
      )}
      {/* Offline and reconnect state lives in the floating pill above the composer. */}
      {viewed.error && (
        <View
          style={[
            styles.row,
            {
              paddingHorizontal: 16,
              gap: 8,
              flexWrap: 'nowrap',
            },
          ]}
        >
          <Text
            style={[
              styles.muted,
              {
                flex: 1,
                fontSize: 12,
              },
            ]}
          >
            Couldn’t save read status.
          </Text>
          <Action secondary label="Retry" disabled={viewed.busy} onPress={viewed.retry} />
        </View>
      )}
      <ConversationProvider
        key={task.id}
        task={task}
        visible={focused && pane === 'chat' && !settings}
        openCheckpoint={(id) => {
          setCheckpoint(id)
          setPane('diff')
        }}
      >
        <View
          style={{
            flex: 1,
            display: pane === 'chat' ? 'flex' : 'none',
          }}
        >
          <Conversation />
          {task.status === 'running' && task.runPhase === 'preparing' && (
            <View
              accessibilityRole="text"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <ActivityIndicator size="small" color={colors.muted} />
              <Text style={[styles.muted, { flex: 1 }]}>
                {task.execution === 'worktree' ? 'Preparing worktree' : 'Preparing checkout'}
                {task.setupCommand ? ' and running setup' : ''}…
              </Text>
            </View>
          )}
          <TaskQuestions taskId={task.id} />
          {task.restartRecovery &&
            task.status !== 'running' &&
            !task.archived &&
            !snapshot?.runs.some((run) => run.taskIds.includes(task.id)) && (
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                <Action
                  label={task.runPhase === 'finalizing' ? 'Retry saving changes' : 'Resume task'}
                  disabled={!connected || resume.busy}
                  onPress={() =>
                    resume.act(() => callEffect('/api/tasks/run', { id: task.id }, responses.ok))
                  }
                />
                {!!resume.error && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {resume.error}
                  </Text>
                )}
              </View>
            )}
          <MessageQueue task={task} />
          <Composer key={task.id} task={task} />
        </View>
        {pane === 'agents' && <TaskAgents task={task} />}
        {pane === 'browser' && (
          <BrowserPane taskId={task.id} expanded={expandedPreview} onExpand={setExpandedPreview} />
        )}
        {pane === 'diff' && <TaskReview task={task} initialCheckpoint={checkpoint} />}
        {pane === 'terminal' && (
          <TerminalPane task={task} selected={terminalId} onSelect={setTerminalId} />
        )}
      </ConversationProvider>
      {settings && (
        <Sheet title="Task settings" busy={settingsBusy} onClose={() => setSettings(false)}>
          <TaskSettings
            key={task.id}
            task={task}
            onBack={() => setSettings(false)}
            onDeleted={onBack}
            onBusyChange={setSettingsBusy}
          />
        </Sheet>
      )}
    </View>
  )
}
