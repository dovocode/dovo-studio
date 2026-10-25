import { useEffect, useEffectEvent, useState } from 'react'
import { AddPullsToThread } from '../list/add-to-thread'
import type { PullSummary } from '@dovo/protocol'
import { View } from 'react-native'
import { pullLinkedTasks, runtimeComputerName, watchRuntimeSettled } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useNavigation } from '../../../shell/navigation'
import { useSheetNavigation } from '../../../ui/layout/sheet'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'

export function PullLinkedThreads({ pull }: { pull: PullSummary }) {
  const [linking, setLinking] = useState(false)
  const { overviews } = useRuntime()
  const { navigate } = useNavigation()
  const navigateAfterSheet = useSheetNavigation()
  const { styles } = useTheme()
  const connections = JSON.stringify(overviews.map((runtime) => runtime.profile.connection))
  const subscribe = useEffectEvent(() =>
    overviews.map((runtime) => watchRuntimeSettled(runtime.profile.connection)),
  )
  useEffect(() => {
    const stops = subscribe()
    return () => stops.forEach((stop) => stop())
  }, [connections])
  const threads = overviews.flatMap((runtime) =>
    pullLinkedTasks(runtime.snapshot?.workspace.tasks ?? [], pull.url).map((task) => ({
      task,
      runtime,
    })),
  )
  return (
    <View accessibilityLabel="Linked Studio threads" style={{ gap: 8 }}>
      <Text style={styles.muted}>Linked threads · {threads.length}</Text>
      <Action secondary label="Link thread" onPress={() => setLinking(true)} />
      {linking && <AddPullsToThread pulls={[pull]} onClose={() => setLinking(false)} />}
      {threads.map(({ task, runtime }) => (
        <Action
          key={JSON.stringify([runtime.profile.id, task.id])}
          secondary
          label={`${task.title} · ${runtimeComputerName(runtime)}${runtime.connected ? '' : ' · Offline'}`}
          onPress={() => navigateAfterSheet(() => navigate('tasks', task.id, runtime.profile.id))}
        />
      ))}
    </View>
  )
}
