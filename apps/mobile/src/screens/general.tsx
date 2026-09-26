import { ScrollView, StyleSheet, View } from 'react-native'
import { Switch } from '../ui/switch'
import { taskSortOptions } from '@dovo/protocol'
import { updateMobilePreferences, useMobilePreferences } from '../runtime/app-preferences'
import { useTaskListView } from '../tasks/task-list-view'
import { Choice } from '../ui/choice'
import { ScreenHeader } from '../ui/screen-header'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'
import { SettingsGroup } from './settings-group'

const tabs = [
  { id: 'tasks', name: 'Tasks' },
  { id: 'issues', name: 'Issues' },
  { id: 'pulls', name: 'PRs' },
  { id: 'jobs', name: 'Automations' },
] as const

export default function GeneralScreen() {
  const preferences = useMobilePreferences()
  const { setView } = useTaskListView()
  return (
    <View style={styles.screen}>
      <ScreenHeader title="General" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: 8, gap: 24 }]}>
        <SettingsGroup
          title="Driving"
          footer="Bigger text, only Tasks and Settings, and chats without tool details. The screen stays on while a task runs. Also on the car button in Tasks. Use dictation and keep your eyes on the road."
        >
          <SwitchRow
            first
            label="Car mode"
            value={preferences.carMode}
            onValueChange={(carMode) => updateMobilePreferences({ carMode })}
          />
        </SettingsGroup>
        <SettingsGroup title="Startup" footer="The tab Dovo shows when it opens.">
          <View style={{ padding: 12 }}>
            <Choice
              label="Open on launch"
              value={preferences.launchTab}
              items={tabs.map((tab) => ({ id: tab.id, name: tab.name }))}
              onChange={(launchTab) =>
                updateMobilePreferences({ launchTab: launchTab as typeof preferences.launchTab })
              }
            />
          </View>
        </SettingsGroup>
        <SettingsGroup
          title="Task list"
          footer="Used when Dovo opens. You can still change the sort in the task filters."
        >
          <View style={{ padding: 12 }}>
            <Choice
              label="Default sort"
              value={preferences.taskSort}
              items={taskSortOptions.map((option) => ({ id: option.id, name: option.name }))}
              onChange={(value) => {
                const taskSort = value as typeof preferences.taskSort
                updateMobilePreferences({ taskSort })
                setView((current) => ({ ...current, sort: taskSort }))
              }}
            />
          </View>
        </SettingsGroup>
        <SettingsGroup title="Date & time">
          <View style={{ padding: 12 }}>
            <Choice
              label="Time format"
              value={preferences.timeFormat}
              items={[
                { id: 'auto', name: 'Automatic' },
                { id: '12h', name: '12-hour' },
                { id: '24h', name: '24-hour' },
              ]}
              onChange={(timeFormat) =>
                updateMobilePreferences({ timeFormat: timeFormat as typeof preferences.timeFormat })
              }
            />
          </View>
        </SettingsGroup>
        <SettingsGroup
          title="Conversation"
          footer="Whether commands, edits and searches in each turn start open or folded. The screen stays on only while you have a running task open."
        >
          <View style={{ padding: 12 }}>
            <Choice
              label="Tool activity"
              value={preferences.toolActivity}
              items={[
                { id: 'collapsed', name: 'Collapsed' },
                { id: 'expanded', name: 'Expanded' },
              ]}
              onChange={(toolActivity) =>
                updateMobilePreferences({
                  toolActivity: toolActivity as typeof preferences.toolActivity,
                })
              }
            />
          </View>
          <SwitchRow
            label="Keep the screen on while a task runs"
            value={preferences.keepScreenOn}
            onValueChange={(keepScreenOn) => updateMobilePreferences({ keepScreenOn })}
          />
        </SettingsGroup>
        <SettingsGroup
          title="Pull requests"
          footer="The merge method is preselected when merging and falls back to the forge’s default. Draft applies where the forge supports it."
        >
          <View style={{ padding: 12 }}>
            <Choice
              label="Merge method"
              value={preferences.mergeMethod}
              items={[
                { id: 'auto', name: 'Forge default' },
                { id: 'merge', name: 'Merge' },
                { id: 'squash', name: 'Squash' },
                { id: 'rebase', name: 'Rebase' },
              ]}
              onChange={(mergeMethod) =>
                updateMobilePreferences({
                  mergeMethod: mergeMethod as typeof preferences.mergeMethod,
                })
              }
            />
          </View>
          <SwitchRow
            label="Create pull requests as drafts"
            value={preferences.pullDraft}
            onValueChange={(pullDraft) => updateMobilePreferences({ pullDraft })}
          />
        </SettingsGroup>
        <SettingsGroup
          title="Confirmations"
          footer="Archived tasks can always be restored from Settings → Archived tasks. Stopping pauses queued messages."
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 14,
              minHeight: 52,
            }}
          >
            <Text style={[styles.text, { flex: 1 }]}>Confirm before archiving a task</Text>
            <Switch
              accessibilityLabel="Confirm before archiving a task"
              value={preferences.confirmArchive}
              onValueChange={(confirmArchive) => updateMobilePreferences({ confirmArchive })}
            />
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 14,
              minHeight: 52,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            }}
          >
            <Text style={[styles.text, { flex: 1 }]}>Confirm before stopping a running task</Text>
            <Switch
              accessibilityLabel="Confirm before stopping a running task"
              value={preferences.confirmStop}
              onValueChange={(confirmStop) => updateMobilePreferences({ confirmStop })}
            />
          </View>
        </SettingsGroup>
      </ScrollView>
    </View>
  )
}

/** One on/off row inside a settings group; rows after the first get a hairline above. */
function SwitchRow({
  label,
  value,
  onValueChange,
  first = false,
}: {
  first?: boolean
  label: string
  value: boolean
  onValueChange: (value: boolean) => void
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        minHeight: 52,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      }}
    >
      <Text style={[styles.text, { flex: 1 }]}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} />
    </View>
  )
}
