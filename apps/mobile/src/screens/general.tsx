import { SettingsScrollView } from './settings-search'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { requireOptionalNativeModule } from 'expo'
import type { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import { getAvailableVoicesAsync, type Voice } from 'expo-speech'
import { taskGroupOptions, taskSortOptions } from '@dovo/protocol'
import {
  updateMobilePreferences,
  useMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { useTaskListView } from '../tasks/list/task-list-view'
import { SettingsChoice as Choice } from './settings-controls'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Text } from '../ui/content/text'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from './settings-group'

const tabs = [
  { id: 'tasks', name: 'Tasks' },
  { id: 'issues', name: 'Issues' },
  { id: 'pulls', name: 'PRs' },
  { id: 'jobs', name: 'Automations' },
] as const
const speechRates = [1, 1.25, 1.5, 1.75, 2] as const

function LocalSettingsPage({ title, children }: { title: string; children: ReactNode }) {
  const { styles } = useTheme()
  return (
    <SettingsPage>
      <ScreenHeader title={title} />
      <SettingsScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: 4, gap: 20 }]}
      >
        <Text style={[styles.muted, { fontSize: 13 }]}>Saved automatically on this device.</Text>
        {children}
      </SettingsScrollView>
    </SettingsPage>
  )
}

export default function GeneralScreen() {
  const preferences = useMobilePreferences()
  return (
    <LocalSettingsPage title="General">
      <SettingsGroup title="Startup" footer="The page Dovo shows when it opens.">
        <Choice
          label="Open on launch"
          value={preferences.launchTab}
          items={tabs.map((tab) => ({ id: tab.id, name: tab.name }))}
          onChange={(launchTab) =>
            updateMobilePreferences({ launchTab: launchTab as typeof preferences.launchTab })
          }
        />
      </SettingsGroup>
      <SettingsGroup title="Date & time">
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
      </SettingsGroup>
      <SettingsGroup title="Conversation & speech">
        <SettingsRow
          title="Conversation"
          subtitle="Changed files, tool activity and keeping the screen on"
          icon="chat"
          onPress={() => router.push('/settings/conversation')}
        />
        <SettingsRow
          title="Speech & driving"
          subtitle="Dictation, read aloud, voices and car mode"
          icon="settings"
          onPress={() => router.push('/settings/speech')}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Experimental"
        footer="Browser tabs stay on this device. Remote tabs use their selected paired computer."
      >
        <SettingsSwitchRow
          label="Enable experimental Browser"
          value={preferences.browserWorkspaceEnabled}
          onValueChange={(browserWorkspaceEnabled) =>
            updateMobilePreferences({ browserWorkspaceEnabled })
          }
        />
      </SettingsGroup>
      <SettingsGroup title="Related settings">
        <SettingsRow
          title="Battery & background"
          subtitle="This device · computer refresh and widget updates"
          icon="settings"
          onPress={() => router.push('/settings/battery')}
        />
        <SettingsRow
          title="Task & PR preferences"
          subtitle="This device · task list, confirmations and merge preferences"
          icon="tasks"
          onPress={() => router.push('/settings/task-preferences')}
        />
        <SettingsRow
          title="Notifications"
          subtitle="Task alerts, computer subscriptions and Live Activities"
          icon="settings"
          onPress={() => router.push('/settings/notifications')}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}

export function BatterySettingsScreen() {
  const preferences = useMobilePreferences()
  return (
    <LocalSettingsPage title="Battery & background">
      <SettingsGroup
        title="Battery & background activity"
        footer="The open computer updates live. Less frequent checks of other computers reduce network activity. Connections pause while the app is in the background; notifications and Live Activities are managed in Notifications. Disabled widgets keep their last saved snapshot."
      >
        <Choice
          label="Other computer refresh"
          value={preferences.computerRefresh}
          items={[
            { id: 'normal', name: 'Every 30 seconds' },
            { id: 'reduced', name: 'Every 2 minutes' },
            { id: 'manual', name: 'When I refresh' },
          ]}
          onChange={(value) => {
            if (value === 'normal' || value === 'reduced' || value === 'manual')
              updateMobilePreferences({ computerRefresh: value })
          }}
        />

        <SettingsSwitchRow
          label="Update widgets"
          value={preferences.widgetUpdates}
          onValueChange={(widgetUpdates) => updateMobilePreferences({ widgetUpdates })}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}

export function TaskPreferencesScreen() {
  const preferences = useMobilePreferences()
  const { setView } = useTaskListView()
  return (
    <LocalSettingsPage title="Task & PR preferences">
      <SettingsGroup
        title="Task list"
        footer="Working groups running tasks in a collapsed section. They return to the main list when they need input or finish. Pinned tasks stay visible."
      >
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
        <Choice
          label="Group by"
          value={preferences.taskGrouping}
          items={[...taskGroupOptions]}
          onChange={(taskGrouping) =>
            updateMobilePreferences({
              taskGrouping: taskGrouping as typeof preferences.taskGrouping,
            })
          }
        />

        <SettingsSwitchRow
          label="Working section"
          value={preferences.workingSection}
          onValueChange={(workingSection) => updateMobilePreferences({ workingSection })}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Confirmations"
        footer="Archived tasks can always be restored from Settings → Archived tasks. Stopping pauses queued messages."
      >
        <SettingsSwitchRow
          first
          label="Confirm before archiving a task"
          value={preferences.confirmArchive}
          onValueChange={(confirmArchive) => updateMobilePreferences({ confirmArchive })}
        />
        <SettingsSwitchRow
          label="Confirm before stopping a running task"
          value={preferences.confirmStop}
          onValueChange={(confirmStop) => updateMobilePreferences({ confirmStop })}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Pull requests"
        footer="The merge method is preselected when merging and falls back to the forge’s default. Draft applies where the forge supports it."
      >
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

        <SettingsSwitchRow
          label="Create pull requests as drafts"
          value={preferences.pullDraft}
          onValueChange={(pullDraft) => updateMobilePreferences({ pullDraft })}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}

export function ConversationSettingsScreen() {
  const preferences = useMobilePreferences()
  return (
    <LocalSettingsPage title="Conversation">
      <SettingsGroup
        title="Conversation"
        footer="Whether commands, edits and searches in each turn start open or folded. Tool call details show output and full inputs only when enabled. The screen stays on only while you have a running task open."
      >
        <SettingsSwitchRow
          first
          label="Collapse changed files by default"
          value={preferences.collapseChangedFiles}
          onValueChange={(collapseChangedFiles) =>
            updateMobilePreferences({ collapseChangedFiles })
          }
        />
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

        <SettingsSwitchRow
          label="Show tool call details"
          value={preferences.showToolDetails}
          onValueChange={(showToolDetails) => updateMobilePreferences({ showToolDetails })}
        />
        <SettingsSwitchRow
          label="Keep the screen on while a task runs"
          value={preferences.keepScreenOn}
          onValueChange={(keepScreenOn) => updateMobilePreferences({ keepScreenOn })}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}

export function SpeechSettingsScreen() {
  const { styles } = useTheme()
  const preferences = useMobilePreferences()
  const [recognitionLanguages, setRecognitionLanguages] = useState<string[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [speechError, setSpeechError] = useState('')
  const [loadingSpeech, setLoadingSpeech] = useState(true)
  useEffect(() => {
    let active = true
    const recognition =
      requireOptionalNativeModule<typeof ExpoSpeechRecognitionModule>('ExpoSpeechRecognition')
    void recognition
      ?.getSupportedLocales({})
      .then((result) => {
        if (active) setRecognitionLanguages(result.locales)
      })
      .catch(() => {
        if (active)
          setSpeechError(
            'Dictation languages could not be loaded. Automatic dictation is still available.',
          )
      })
    void getAvailableVoicesAsync()
      .then((result) => {
        if (active) setVoices(result)
      })
      .catch(() => {
        if (active)
          setSpeechError(
            'Speech voices could not be loaded. The system default is still available.',
          )
      })
      .finally(() => {
        if (active) setLoadingSpeech(false)
      })
    return () => {
      active = false
    }
  }, [])
  const speechLanguages = [...new Set(voices.map((voice) => voice.language))].sort()
  const matchingVoices = preferences.speechLanguage
    ? voices.filter((voice) => voice.language === preferences.speechLanguage)
    : voices
  const orderedVoices = [...matchingVoices].sort((a, b) => {
    const rank = (voice: Voice) =>
      /siri/i.test(`${voice.name} ${voice.identifier}`) ? 0 : voice.quality === 'Enhanced' ? 1 : 2
    return rank(a) - rank(b) || a.language.localeCompare(b.language) || a.name.localeCompare(b.name)
  })
  return (
    <LocalSettingsPage title="Speech & driving">
      <SettingsGroup
        title="Speech"
        footer="Saved on this phone. Siri voices appear when iOS makes them available to apps; additional voices can be downloaded in iPhone speech settings."
      >
        {loadingSpeech && <Text style={styles.muted}>Loading speech options…</Text>}
        {!!speechError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {speechError}
          </Text>
        )}
        <Choice
          label="Dictation language"
          value={preferences.dictationLanguage}
          items={[
            { id: '', name: 'Automatic' },
            ...[...recognitionLanguages]
              .sort()
              .map((language) => ({ id: language, name: language })),
          ]}
          onChange={(dictationLanguage) => updateMobilePreferences({ dictationLanguage })}
        />
        <Choice
          label="Read aloud language"
          value={preferences.speechLanguage}
          items={[
            { id: '', name: 'Automatic' },
            ...speechLanguages.map((language) => ({ id: language, name: language })),
          ]}
          onChange={(speechLanguage) =>
            updateMobilePreferences({ speechLanguage, speechVoice: '' })
          }
        />
        <Choice
          label="Voice"
          value={preferences.speechVoice}
          items={[
            { id: '', name: 'System default' },
            ...orderedVoices.map((voice) => ({
              id: voice.identifier,
              name: `${/siri/i.test(`${voice.name} ${voice.identifier}`) ? 'Siri · ' : ''}${voice.name} · ${voice.language}${voice.quality === 'Enhanced' ? ' · Enhanced' : ''}`,
            })),
          ]}
          onChange={(speechVoice) => updateMobilePreferences({ speechVoice })}
        />
        <Choice
          label="Speaking speed"
          value={String(preferences.speechRate)}
          items={speechRates.map((rate) => ({
            id: String(rate),
            name: rate === 1 ? 'Normal' : `${rate}×`,
          }))}
          onChange={(value) => {
            const speechRate = speechRates.find((rate) => String(rate) === value)
            if (speechRate) updateMobilePreferences({ speechRate })
          }}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Driving"
        footer="Bigger text, only Tasks and Settings, and chats without tool details. The screen stays on while a task runs. Also on the car button in Tasks. Use dictation and keep your eyes on the road."
      >
        <SettingsSwitchRow
          first
          label="Car mode"
          value={preferences.carMode}
          onValueChange={(carMode) => updateMobilePreferences({ carMode })}
        />
        <SettingsSwitchRow
          label="Read replies aloud"
          value={preferences.readRepliesAloud}
          onValueChange={(readRepliesAloud) => updateMobilePreferences({ readRepliesAloud })}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}
