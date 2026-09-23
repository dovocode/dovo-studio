import { useApplicationState } from '../runtime/application-state'
import { useLocalSearchParams } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useRuntime } from '../runtime/provider'
import { RuntimeRoute } from '../shell/runtime-route'
import { backToCollection } from '../shell/source-route'
import { IconButton } from '../ui/icon-button'
import { ScreenHeader } from '../ui/screen-header'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
import { AutomationCard } from './automation-card'
import { AutomationEditor } from './automation-editor'
export function AutomationRouteScreen() {
  const { runtimeId, automationId } = useLocalSearchParams<{
    runtimeId: string
    automationId: string
  }>()
  return (
    <RuntimeRoute runtimeId={runtimeId} title="Automation" backTo="/jobs">
      <AutomationDetail key={`${runtimeId}:${automationId}`} automationId={automationId} />
    </RuntimeRoute>
  )
}
function AutomationDetail({ automationId }: { automationId: string }) {
  const { snapshot, profile } = useRuntime()
  const [editing, setEditing] = useApplicationState(false)
  const flow = snapshot?.workspace.automations.find((flow) => flow.id === automationId)
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={flow?.name ?? 'Automation unavailable'}
        subtitle={profile?.name}
        leading={
          <IconButton
            label="Back to automations"
            icon="back"
            variant="glass"
            onPress={() => backToCollection('/jobs')}
          />
        }
      />
      {flow ? (
        <ScrollView
          testID="Automation detail"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: 0,
            },
          ]}
        >
          <AutomationCard flow={flow} onEdit={() => setEditing(true)} />
        </ScrollView>
      ) : (
        <View style={styles.content}>
          <Text style={styles.muted}>
            This automation may have been removed. Return to Automations to choose another.
          </Text>
        </View>
      )}
      {flow && editing && <AutomationEditor flow={flow} onClose={() => setEditing(false)} />}
    </View>
  )
}
