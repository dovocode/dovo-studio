import { View } from 'react-native'
import { botWorkSummary, type TaskMetadata } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'

export function BotWorkSummary({
  task,
  onRoutines,
  onWorkers,
}: {
  task: TaskMetadata
  onRoutines: () => void
  onWorkers: () => void
}) {
  const { snapshot, connected } = useRuntime()
  const work = botWorkSummary(
    task,
    snapshot?.workspace.tasks ?? [],
    snapshot?.workspace.automations ?? [],
    snapshot?.runs ?? [],
  )
  return (
    <View
      accessibilityLabel="Bot work overview"
      style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}
    >
      <Text>{connected ? 'Bot work' : 'Bot work · Last saved state'}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Action
          secondary
          label={`Routines · ${work.routines}${work.running ? ` · ${work.running} working` : ''}${work.review ? ` · ${work.review} need review` : ''}${work.failed ? ` · ${work.failed} failed` : ''}`}
          onPress={onRoutines}
        />
        <Action
          secondary
          label={`Workers · ${work.workers} active${work.offlineWorkers ? ` · ${work.offlineWorkers} offline` : ''}`}
          onPress={onWorkers}
        />
      </View>
    </View>
  )
}
