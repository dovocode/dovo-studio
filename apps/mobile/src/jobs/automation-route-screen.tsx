import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { runtimeComputerName } from '@dovo/protocol'
import { useAutomationRun } from '@dovo/studio-core'
import { useApplicationState } from '../runtime/state/application-state'
import { useLocalSearchParams } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useRuntime } from '../runtime/connection/provider'
import { RuntimeRoute } from '../shell/runtime-route'
import { backToCollection } from '../shell/source-route'
import { IconButton } from '../ui/controls/icon-button'
import { Action } from '../ui/controls/action'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { useSettingsTheme as useTheme, SettingsPage } from '../screens/settings-theme'
import { AutomationCard } from './automation-card'
import { AutomationEditor } from './automation-editor'
import { RunProgress } from './run-progress'
export function AutomationRouteScreen() {
  const uiText = useInterfaceText()

  const { runtimeId, automationId, runId } = useLocalSearchParams<{
    runtimeId: string
    automationId: string
    runId?: string
  }>()
  return (
    <RuntimeRoute runtimeId={runtimeId} title={uiText('Automation')} backTo="/settings/automations">
      <AutomationDetail
        key={`${runtimeId}:${automationId}:${runId ?? ''}`}
        automationId={automationId}
        runId={runId || undefined}
      />
    </RuntimeRoute>
  )
}
function RequestedRun({ automationId, runId }: { automationId: string; runId: string }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const { snapshot, profile, connected, read } = useRuntime()
  const { run, error, loading, retry } = useAutomationRun({
    automationId,
    runId,
    summary: snapshot?.runs.find((item) => item.id === runId && item.automationId === automationId),
    connection: profile?.connection,
    connected,
    supported: snapshot?.automationRunLookupSupported,
    request: read,
  })
  return (
    <View testID="Requested automation run" style={{ gap: 8 }}>
      <Text style={{ fontWeight: '600' }}>
        <InterfaceText>{'Requested run'}</InterfaceText>
      </Text>
      {run ? (
        <RunProgress key={run.id} run={run} />
      ) : (
        <Text style={styles.muted}>
          {error ??
            (loading || !snapshot
              ? uiText('Loading the requested run…')
              : snapshot.automationRunLookupSupported && !connected
                ? uiText('Reconnect to load the requested run.')
                : uiText('This run is not in the recent run history on this computer.'))}
        </Text>
      )}
      {error && connected && <Action label={uiText('Retry')} onPress={retry} />}
    </View>
  )
}
function AutomationDetail({ automationId, runId }: { automationId: string; runId?: string }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { snapshot, profile } = useRuntime()
  const [editing, setEditing] = useApplicationState(false)
  const flow = snapshot?.workspace.automations.find((flow) => flow.id === automationId)
  return (
    <SettingsPage>
      <ScreenHeader
        title={flow?.name ?? (runId ? uiText('Automation run') : uiText('Automation unavailable'))}
        subtitle={runtimeComputerName({ profile, snapshot })}
        leading={
          <IconButton
            label={uiText('Back to automations')}
            icon="back"
            variant="plain"
            onPress={() => backToCollection('/settings/automations')}
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
          {runId && <RequestedRun automationId={automationId} runId={runId} />}
          <AutomationCard
            flow={flow}
            onEdit={() => setEditing(true)}
            onDeleted={() => backToCollection('/settings/automations')}
          />
        </ScrollView>
      ) : (
        <View style={[styles.content, { gap: 16 }]}>
          {runId && <RequestedRun automationId={automationId} runId={runId} />}
          <Text style={styles.muted}>
            <InterfaceText>
              {'This automation may have been removed. Return to Automations to choose another.'}
            </InterfaceText>
          </Text>
        </View>
      )}
      {flow && editing && <AutomationEditor flow={flow} onClose={() => setEditing(false)} />}
    </SettingsPage>
  )
}
