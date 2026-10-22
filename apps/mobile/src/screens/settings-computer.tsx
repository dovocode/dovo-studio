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
              label="Computer"
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
              ? `Saved on ${runtimeComputerName(entry)}. Changes are shared with its paired devices.`
              : overviews.length
                ? 'This computer is unavailable. Choose another computer above.'
                : 'Connect a computer to configure its settings.'}
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
  return <ComputerSettingsPage title="Running tasks" section="tasks" />
}
export function PullSettingsScreen() {
  return <ComputerSettingsPage title="Pull requests & pipelines" section="pulls" />
}
export function RuntimeToolsSettingsScreen() {
  return <ComputerSettingsPage title="Runtime tools" section="tools" />
}
export function ArtifactSettingsScreen() {
  return <ComputerSettingsPage title="Artifacts" section="artifacts" />
}
export function MemorySettingsScreen() {
  return <ComputerSettingsPage title="Memory" section="memory" />
}
export function WorktreeSettingsScreen() {
  return <ComputerSettingsPage title="Worktrees" section="worktrees" />
}
export function ActivitySettingsScreen() {
  return <ComputerSettingsPage title="Activity retention" section="activity" />
}
