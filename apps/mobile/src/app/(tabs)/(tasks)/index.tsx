import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { router } from 'expo-router'
import { View } from 'react-native'
import { WorkbenchScene } from '../../../shell/workbench'
import { useTaskPanes } from '../../../shell/task-panes'
import { useRuntime } from '../../../runtime/connection/provider'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { ScreenHeader } from '../../../ui/layout/screen-header'
import { useTheme } from '../../../ui/theme'
export default function Screen() {
  const uiText = useInterfaceText()

  const { expanded } = useTaskPanes()
  const { styles } = useTheme()
  const { overviews } = useRuntime()
  if (!expanded) return <WorkbenchScene tab="tasks" />
  return (
    <View
      style={[
        styles.screen,
        { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
      ]}
    >
      <ScreenHeader title={uiText('Threads')} hidden />
      <Text style={styles.title}>
        <InterfaceText>{'Select a thread'}</InterfaceText>
      </Text>
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        <InterfaceText>{'Open a thread from the list, or start something new.'}</InterfaceText>
      </Text>
      <Action
        label={uiText('New thread')}
        disabled={!overviews.some((entry) => entry.connected)}
        onPress={() => router.push('/new', { withAnchor: true })}
      />
    </View>
  )
}
