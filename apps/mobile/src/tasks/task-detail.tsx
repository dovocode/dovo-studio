import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BrowserPane } from './browser-pane'
import { Conversation } from './conversation'
import { ConversationProvider } from './conversation-provider'
import { useNavigation } from '../shell/navigation'
import { MessageQueue } from './message-queue'
import { TaskQuestions } from './task-questions'
import { TaskSettings } from './task-settings'
import { useState } from 'react'
import { Keyboard, Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Sheet } from '../ui/sheet'
import { colors, styles } from '../ui/theme'
import { ScreenHeader } from '../ui/screen-header'
import { Icon } from '../ui/icon'
import { Composer } from './composer'
import { TaskReview } from './task-review'
import { TerminalPane } from '../terminal/terminal-pane'
import { TaskSource } from './task-source'
import { useTaskViewed } from './use-task-viewed'
export function TaskDetail({ task, onBack }: { task: Task; onBack: () => void }) {
  const { focused } = useNavigation()
  const insets = useSafeAreaInsets()
  const { snapshot, connected, profile, refresh } = useRuntime()
  const needsInput =
    snapshot?.questions.some((q) => q.taskId === task.id) ||
    snapshot?.approvals.some((a) => a.taskId === task.id)
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const latestTurn = task.turns?.at(-1)
  const runtimeHost =
    (latestTurn ? latestTurn.runtimeHost : snapshot?.runtimeHost) ?? 'Unknown device'
  const subtitle = [repository?.name, runtimeHost].filter(Boolean).join(' · ')
  const status = needsInput
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
  const [checkpoint, setCheckpoint] = useState('')
  const [terminalId, setTerminalId] = useState('')
  const [pane, setPane] = useState<'chat' | 'diff' | 'terminal' | 'browser'>('chat')
  const [expandedPreview, setExpandedPreview] = useState(false)
  const [settings, setSettings] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const viewed = useTaskViewed(task, pane === 'chat' && !settings)
  return (
    <View
      style={[
        styles.screen,
        pane === 'browser' &&
          expandedPreview && { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <ScreenHeader
        title={task.title}
        hidden={pane === 'browser' && expandedPreview}
        gestureEnabled={pane !== 'browser'}
        onBack={pane === 'browser' ? onBack : undefined}
        leading={<Action secondary label="Back" onPress={onBack} />}
        buttons={(['chat', 'diff', 'terminal', 'browser'] as const).map((tab) => ({
          label:
            tab === 'chat'
              ? 'Chat'
              : tab === 'diff'
                ? `Changes (${task.files.length})`
                : tab === 'terminal'
                  ? 'Terminal'
                  : 'Browser',
          icon: tab === 'diff' ? 'changes' : tab === 'browser' ? 'web' : tab,
          selected: pane === tab,
          onPress: () => {
            Keyboard.dismiss()
            setCheckpoint('')
            setPane(tab)
          },
        }))}
      />
      <Pressable
        testID="Task settings"
        accessibilityRole="button"
        accessibilityLabel={[task.title, subtitle, status].join('. ')}
        accessibilityHint="Open task settings."
        onPress={() => setSettings(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 4,
          minHeight: 44,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon name="device" size={14} color={colors.muted} />
        <View
          testID="Task device subtitle"
          accessibilityLabel={subtitle}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }}
        >
          {!!repository && (
            <>
              <Text numberOfLines={1} style={[styles.muted, { maxWidth: '45%', flexShrink: 1 }]}>
                {repository.name}
              </Text>
              <Text style={styles.muted}> · </Text>
            </>
          )}
          <Text numberOfLines={1} style={[styles.muted, { flex: 1, minWidth: 0 }]}>
            {runtimeHost}
          </Text>
        </View>
        <Text
          numberOfLines={2}
          style={[
            styles.muted,
            {
              maxWidth: '35%',
              color: needsInput
                ? colors.accent
                : task.status === 'failed'
                  ? colors.error
                  : colors.muted,
            },
          ]}
        >
          {status}
        </Text>
        <Icon name="down" size={10} color={colors.muted} />
      </Pressable>
      {task.workItem && (
        <View style={{ paddingHorizontal: 16 }}>
          <TaskSource task={task} />
        </View>
      )}
      {!connected && (
        <View
          style={[styles.row, { paddingHorizontal: 16, paddingVertical: 4, flexWrap: 'nowrap' }]}
        >
          <Text style={[styles.muted, { flex: 1 }]}>
            {profile?.name ?? 'Computer'} offline · Saved conversation
          </Text>
          <Action
            secondary
            label="Reconnect"
            onPress={() => {
              void refresh().catch(() => undefined)
            }}
          />
        </View>
      )}
      {viewed.error && (
        <View style={[styles.row, { paddingHorizontal: 16, gap: 8, flexWrap: 'nowrap' }]}>
          <Text style={[styles.muted, { flex: 1, fontSize: 12 }]}>Couldn’t save read status.</Text>
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
        <View style={{ flex: 1, display: pane === 'chat' ? 'flex' : 'none' }}>
          <Conversation />
          <TaskQuestions taskId={task.id} />
          <MessageQueue task={task} />
          <Composer key={task.id} task={task} />
        </View>
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
            onBusyChange={setSettingsBusy}
          />
        </Sheet>
      )}
    </View>
  )
}
