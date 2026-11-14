import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useConfirmSettingsNavigation } from '../runtime/preferences/settings-target'
import { SettingsScrollView } from './settings-search'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { runtimeComputerName } from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import {
  RuntimePreferences,
  type RuntimePreferencesSection,
} from '../runtime/connection/runtime-preferences'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { SettingsChoice } from './settings-controls'
import { SettingsPage, useSettingsTheme } from './settings-theme'

function ComputerSettingsPage({
  title,
  section,
}: {
  title: string
  section: RuntimePreferencesSection
}) {
  const uiText = useInterfaceText()

  const { styles } = useSettingsTheme()
  const confirmNavigation = useConfirmSettingsNavigation()
  const { overviews, activeId } = useRuntime()
  const { runtimeId } = useLocalSearchParams<{ runtimeId?: string }>()
  const [selected, setComputer] = useApplicationState(runtimeId ?? activeId ?? '')
  const entry =
    overviews.find((item) => item.profile.id === selected) ??
    (overviews.length === 1 ? overviews[0] : undefined)
  return (
    <SettingsPage>
      <ScreenHeader title={title} />
      <SettingsScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 10 }}>
          {overviews.length > 1 && (
            <SettingsChoice
              label={uiText('Computer')}
              value={selected ?? ''}
              items={overviews.map((item) => ({
                id: item.profile.id,
                name: `${runtimeComputerName(item)}${item.connected ? '' : ' · Offline'}`,
              }))}
              onChange={(value) => confirmNavigation(() => setComputer(value))}
            />
          )}
          <Text style={[styles.muted, { paddingHorizontal: 16 }]}>
            {entry
              ? uiText('Saved on {value0}. Changes are shared with its paired devices.', {
                  value0: runtimeComputerName(entry),
                })
              : overviews.length
                ? uiText('This computer is unavailable. Choose another computer above.')
                : uiText('Connect a computer to configure its settings.')}
          </Text>
        </View>
        {entry && (
          <RuntimeScope key={entry.profile.id} runtimeId={entry.profile.id}>
            <RuntimePreferences section={section} />
          </RuntimeScope>
        )}
      </SettingsScrollView>
    </SettingsPage>
  )
}

export function TaskBehaviorSettingsScreen() {
  const uiText = useInterfaceText()

  return <ComputerSettingsPage title={uiText('Running tasks')} section="tasks" />
}
export function PullSettingsScreen() {
  const uiText = useInterfaceText()

  return <ComputerSettingsPage title={uiText('Pull requests & pipelines')} section="pulls" />
}
export function RuntimeToolsSettingsScreen() {
  const uiText = useInterfaceText()

  return <ComputerSettingsPage title={uiText('Runtime tools')} section="tools" />
}
export function ArtifactSettingsScreen() {
  const uiText = useInterfaceText()

  return <ComputerSettingsPage title={uiText('Artifacts')} section="artifacts" />
}
export function MemorySettingsScreen() {
  const uiText = useInterfaceText()

  return <ComputerSettingsPage title={uiText('Memory')} section="memory" />
}
export function WorktreeSettingsScreen() {
  const uiText = useInterfaceText()

  return <ComputerSettingsPage title={uiText('Worktrees')} section="worktrees" />
}
export function ActivitySettingsScreen() {
  const uiText = useInterfaceText()

  return <ComputerSettingsPage title={uiText('Activity retention')} section="activity" />
}
