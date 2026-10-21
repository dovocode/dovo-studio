import { View } from 'react-native'
import { ConversationProvider } from '../tasks/conversation/state/provider'
import { Composer } from '../tasks/composer/composer'
import { MessageQueue } from '../tasks/composer/message-queue'
import { StartupThread } from '../tasks/creation/startup-thread'
import { TaskDetail } from '../tasks/detail/task-detail'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { catalogScreenTask } from './screens-runtime'

/** Actual conversation controller and entire composer; offline commands cannot leave this app. */
export function MobileComposerScreen() {
  const { colors } = useTheme()
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', minHeight: 560 }}>
      <Text style={{ color: colors.muted, padding: 16 }}>
        Full native composer · disconnected synthetic computer. Local drafts are saved only in the
        catalog app.
      </Text>
      <ConversationProvider
        task={catalogScreenTask}
        temporary
        visible={false}
        openCheckpoint={() => undefined}
        openTerminal={() => undefined}
      >
        <Composer
          task={catalogScreenTask}
          queuedMessages={<MessageQueue task={catalogScreenTask} />}
        />
      </ConversationProvider>
    </View>
  )
}
export function MobileThreadScreen() {
  return <TaskDetail task={catalogScreenTask} onBack={() => undefined} />
}

export function MobileNewThreadScreen() {
  return (
    <StartupThread
      taskId="catalog-task-3"
      runtimeId="catalog-computer"
      onCommit={() => undefined}
      onBrowse={() => undefined}
      onNewThread={() => undefined}
    />
  )
}
