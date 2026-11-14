import { useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

  const { snapshot, connected } = useRuntime()
  const work = botWorkSummary(
    task,
    snapshot?.workspace.tasks ?? [],
    snapshot?.workspace.automations ?? [],
    snapshot?.runs ?? [],
  )
  return (
    <View
      accessibilityLabel={uiText('Bot work overview')}
      style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}
    >
      <Text>{connected ? uiText('Bot work') : uiText('Bot work · Last saved state')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Action
          secondary
          label={uiText('Routines · {value0}{value1}{value2}{value3}', {
            value0: work.routines,
            value1: work.running ? ` · ${work.running} working` : '',
            value2: work.review ? ` · ${work.review} need review` : '',
            value3: work.failed ? ` · ${work.failed} failed` : '',
          })}
          onPress={onRoutines}
        />
        <Action
          secondary
          label={uiText('Workers · {value0} active{value1}', {
            value0: work.workers,
            value1: work.offlineWorkers ? ` · ${work.offlineWorkers} offline` : '',
          })}
          onPress={onWorkers}
        />
      </View>
    </View>
  )
}
