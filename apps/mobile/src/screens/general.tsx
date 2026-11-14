import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { interfaceLanguages, decode, interfaceLanguageSchema } from '@dovo/protocol'
import { RuntimeSpeechSettings } from './runtime-speech'
import { SnoozeSchedule } from './snooze-schedule'
import { SettingsScrollView } from './settings-search'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import type { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import { getAvailableVoicesAsync, type Voice } from 'expo-speech'
import { dictationLanguages, taskGroupOptions, taskSortOptions } from '@dovo/protocol'
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
import { Field } from '../ui/controls/field'
import { SettingsAction as Action } from './settings-controls'
import {
  defaultTaskSnoozeMinutes,
  formatTaskSnoozeMinutes,
  parseTaskSnoozeMinutes,
} from '@dovo/protocol'

function SnoozeDurations({ minutes }: { minutes: number[] }) {
  const uiText = useInterfaceText()

  const saved = formatTaskSnoozeMinutes(minutes)
  const [text, setText] = useState(saved)
  const [error, setError] = useState('')
  const { styles } = useTheme()
  useEffect(() => {
    setText(saved)
    setError('')
  }, [saved])
  return (
    <View style={{ gap: 8, padding: 12 }}>
      <Field
        label={uiText('Snooze durations')}
        value={text}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(value) => {
          setText(value)
          setError('')
        }}
        placeholder="15m, 1h, 4h, 1d"
      />
      <Action
        label={uiText('Save snooze durations')}
        disabled={text === saved}
        onPress={() => {
          try {
            updateMobilePreferences({ taskSnoozeMinutes: parseTaskSnoozeMinutes(text) })
            setError('')
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        }}
      />
      <Action
        secondary
        label={uiText('Reset snooze durations')}
        onPress={() => {
          updateMobilePreferences({ taskSnoozeMinutes: [...defaultTaskSnoozeMinutes] })
          setText(formatTaskSnoozeMinutes(defaultTaskSnoozeMinutes))
          setError('')
        }}
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}

function BrowserCleanupMinutes({
  label,
  value,
  onSave,
}: {
  label: string
  value: number
  onSave: (minutes: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <View style={{ padding: 12 }}>
      <Field
        label={label}
        value={text}
        keyboardType="number-pad"
        onChangeText={(text) => {
          setText(text)
          if (/^\d+$/.test(text)) {
            const minutes = Number(text)
            if (minutes <= 525600) onSave(minutes)
          }
        }}
        onBlur={() => setText(String(value))}
      />
    </View>
  )
}

const tabs = [
  { id: 'tasks', name: 'Threads' },
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
        <Text style={[styles.muted, { fontSize: 13 }]}>
          <InterfaceText>{'Saved automatically on this device.'}</InterfaceText>
        </Text>
        {children}
      </SettingsScrollView>
    </SettingsPage>
  )
}

export default function GeneralScreen() {
  const uiText = useInterfaceText()

  const preferences = useMobilePreferences()
  return (
    <LocalSettingsPage title={uiText('General')}>
      <SettingsGroup
        title={uiText('Interface language')}
        footer={uiText(
          'Language for navigation, settings labels, and common controls. Other copy falls back to English. Speech recognition keeps its own language.',
        )}
      >
        <Choice
          label={uiText('Interface language')}
          value={preferences.interfaceLanguage}
          items={interfaceLanguages}
          onChange={(value) =>
            updateMobilePreferences({ interfaceLanguage: decode(interfaceLanguageSchema, value) })
          }
        />
      </SettingsGroup>
      <SettingsGroup
        title={uiText('Startup')}
        footer={uiText('The page Dovo shows when it opens.')}
      >
        <Choice
          label={uiText('Open on launch')}
          value={preferences.launchTab}
          items={tabs.map((tab) => ({ id: tab.id, name: uiText(tab.name) }))}
          onChange={(launchTab) =>
            updateMobilePreferences({ launchTab: launchTab as typeof preferences.launchTab })
          }
        />
      </SettingsGroup>
      <SettingsGroup
        title={uiText('Browser tab cleanup')}
        footer={uiText(
          '0 turns a timer off. Current tabs, pinned tabs and active media are protected. Checks run when Browser is open.',
        )}
      >
        <BrowserCleanupMinutes
          label={uiText('Auto-settle unused tabs after (minutes)')}
          value={preferences.browserAutoSettleMinutes}
          onSave={(browserAutoSettleMinutes) =>
            updateMobilePreferences({ browserAutoSettleMinutes })
          }
        />
        <BrowserCleanupMinutes
          label={uiText('Close settled tabs after (minutes)')}
          value={preferences.browserCloseSettledMinutes}
          onSave={(browserCloseSettledMinutes) =>
            updateMobilePreferences({ browserCloseSettledMinutes })
          }
        />
      </SettingsGroup>
      <SettingsGroup title={uiText('Date & time')}>
        <Choice
          label={uiText('Time format')}
          value={preferences.timeFormat}
          items={[
            { id: 'auto', name: uiText('Automatic') },
            { id: '12h', name: uiText('12-hour') },
            { id: '24h', name: uiText('24-hour') },
          ]}
          onChange={(timeFormat) =>
            updateMobilePreferences({ timeFormat: timeFormat as typeof preferences.timeFormat })
          }
        />
      </SettingsGroup>
      <SettingsGroup title={uiText('Conversation & speech')}>
        <SettingsRow
          title={uiText('Conversation')}
          subtitle={uiText('Changed files, tool activity and keeping the screen on')}
          icon="chat"
          onPress={() => router.push('/settings/conversation')}
        />
        <SettingsRow
          title={uiText('Speech & driving')}
          subtitle={uiText('Dictation, read aloud, voices and car mode')}
          icon="settings"
          onPress={() => router.push('/settings/speech')}
        />
      </SettingsGroup>
      <SettingsGroup
        title={uiText('Experimental')}
        footer={uiText(
          'Browser tabs stay on this device. Terminals run on paired computers and use their session recovery.',
        )}
      >
        <SettingsSwitchRow
          label={uiText('Enable experimental Browser')}
          value={preferences.browserWorkspaceEnabled}
          onValueChange={(browserWorkspaceEnabled) =>
            updateMobilePreferences({ browserWorkspaceEnabled })
          }
        />
        <SettingsSwitchRow
          label={uiText('Enable Terminal workspace')}
          value={preferences.terminalWorkspaceEnabled}
          onValueChange={(terminalWorkspaceEnabled) =>
            updateMobilePreferences({ terminalWorkspaceEnabled })
          }
        />
      </SettingsGroup>
      <SettingsGroup title={uiText('Related settings')}>
        <SettingsRow
          title={uiText('Battery & background')}
          subtitle={uiText('This device · computer refresh and widget updates')}
          icon="settings"
          onPress={() => router.push('/settings/battery')}
        />
        <SettingsRow
          title={uiText('Thread & PR preferences')}
          subtitle={uiText('This device · task list, confirmations and merge preferences')}
          icon="tasks"
          onPress={() => router.push('/settings/task-preferences')}
        />
        <SettingsRow
          title={uiText('Notifications')}
          subtitle={uiText('Task alerts, computer subscriptions and Live Activities')}
          icon="settings"
          onPress={() => router.push('/settings/notifications')}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}

export function BatterySettingsScreen() {
  const uiText = useInterfaceText()

  const preferences = useMobilePreferences()
  return (
    <LocalSettingsPage title={uiText('Battery & background')}>
      <SettingsGroup
        title={uiText('Battery & background activity')}
        footer={uiText(
          'The open computer updates live. Less frequent checks of other computers reduce network activity. Connections pause while the app is in the background; notifications and Live Activities are managed in Notifications. Disabled widgets keep their last saved snapshot.',
        )}
      >
        <Choice
          label={uiText('Other computer refresh')}
          value={preferences.computerRefresh}
          items={[
            { id: 'normal', name: uiText('Every 30 seconds') },
            { id: 'reduced', name: uiText('Every 2 minutes') },
            { id: 'manual', name: uiText('When I refresh') },
          ]}
          onChange={(value) => {
            if (value === 'normal' || value === 'reduced' || value === 'manual')
              updateMobilePreferences({ computerRefresh: value })
          }}
        />

        <SettingsSwitchRow
          label={uiText('Update widgets')}
          value={preferences.widgetUpdates}
          onValueChange={(widgetUpdates) => updateMobilePreferences({ widgetUpdates })}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}

export function TaskPreferencesScreen() {
  const uiText = useInterfaceText()

  const preferences = useMobilePreferences()
  const { setView } = useTaskListView()
  return (
    <LocalSettingsPage title={uiText('Thread & PR preferences')}>
      <SettingsGroup
        title={uiText('Task list')}
        footer={uiText(
          'Working groups running tasks in a collapsed section. They return to the main list when they need input or finish. Pinned tasks stay visible.',
        )}
      >
        <Choice
          label={uiText('Default sort')}
          value={preferences.taskSort}
          items={taskSortOptions.map((option) => ({ id: option.id, name: uiText(option.name) }))}
          onChange={(value) => {
            const taskSort = value as typeof preferences.taskSort
            updateMobilePreferences({ taskSort })
            setView((current) => ({ ...current, sort: taskSort }))
          }}
        />
        <Choice
          label={uiText('Group by')}
          value={preferences.taskGrouping}
          items={taskGroupOptions.map((option) => ({ ...option, name: uiText(option.name) }))}
          onChange={(taskGrouping) =>
            updateMobilePreferences({
              taskGrouping: taskGrouping as typeof preferences.taskGrouping,
            })
          }
        />

        <SettingsSwitchRow
          label={uiText('Working section')}
          value={preferences.workingSection}
          onValueChange={(workingSection) => updateMobilePreferences({ workingSection })}
        />
      </SettingsGroup>
      <SettingsGroup
        title={uiText('Snoozing')}
        footer={uiText(
          'Enter 1–12 durations separated by commas, in menu order: m for minutes, h for hours, d for days or w for weeks. Existing snoozed threads keep their wake-up time.',
        )}
      >
        <SnoozeSchedule schedule={preferences.taskSnoozeSchedule} ready={preferences.ready} />
        <SnoozeDurations minutes={preferences.taskSnoozeMinutes} />
      </SettingsGroup>
      <SettingsGroup
        title={uiText('Confirmations')}
        footer={uiText(
          'Archived threads can always be restored from Settings → Archived threads. Stopping pauses queued messages.',
        )}
      >
        <SettingsSwitchRow
          first
          label={uiText('Confirm before archiving a task')}
          value={preferences.confirmArchive}
          onValueChange={(confirmArchive) => updateMobilePreferences({ confirmArchive })}
        />
        <SettingsSwitchRow
          label={uiText('Confirm before stopping a running task')}
          value={preferences.confirmStop}
          onValueChange={(confirmStop) => updateMobilePreferences({ confirmStop })}
        />
      </SettingsGroup>
      <SettingsGroup
        title={uiText('Pull requests')}
        footer={uiText(
          'The merge method is preselected when merging and falls back to the forge’s default. Draft applies where the forge supports it.',
        )}
      >
        <Choice
          label={uiText('Merge method')}
          value={preferences.mergeMethod}
          items={[
            { id: 'auto', name: uiText('Forge default') },
            { id: 'merge', name: uiText('Merge') },
            { id: 'squash', name: uiText('Squash') },
            { id: 'rebase', name: uiText('Rebase') },
          ]}
          onChange={(mergeMethod) =>
            updateMobilePreferences({
              mergeMethod: mergeMethod as typeof preferences.mergeMethod,
            })
          }
        />

        <SettingsSwitchRow
          label={uiText('Create pull requests as drafts')}
          value={preferences.pullDraft}
          onValueChange={(pullDraft) => updateMobilePreferences({ pullDraft })}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}

export function ConversationSettingsScreen() {
  const uiText = useInterfaceText()

  const preferences = useMobilePreferences()
  return (
    <LocalSettingsPage title={uiText('Conversation')}>
      <SettingsGroup
        title={uiText('Conversation')}
        footer={uiText(
          'Turn off Minimal composer to always show the full composer. Tool activity controls whether commands, edits and searches start open or folded. Tool call details show output and full inputs only when enabled. The screen stays on only while you have a running task open.',
        )}
      >
        <SettingsSwitchRow
          first
          label={uiText('Collapse changed files by default')}
          value={preferences.collapseChangedFiles}
          onValueChange={(collapseChangedFiles) =>
            updateMobilePreferences({ collapseChangedFiles })
          }
        />
        <Choice
          label={uiText('Tool activity')}
          value={preferences.toolActivity}
          items={[
            { id: 'collapsed', name: uiText('Collapsed') },
            { id: 'expanded', name: uiText('Expanded') },
          ]}
          onChange={(toolActivity) =>
            updateMobilePreferences({
              toolActivity: toolActivity as typeof preferences.toolActivity,
            })
          }
        />

        <SettingsSwitchRow
          label={uiText('Show tool call details')}
          value={preferences.showToolDetails}
          onValueChange={(showToolDetails) => updateMobilePreferences({ showToolDetails })}
        />
        <SettingsSwitchRow
          label={uiText('Minimal composer')}
          value={preferences.minimalComposer}
          onValueChange={(minimalComposer) => updateMobilePreferences({ minimalComposer })}
        />
        <SettingsSwitchRow
          label={uiText('Show Plan button')}
          value={preferences.showPlanButton}
          onValueChange={(showPlanButton) => updateMobilePreferences({ showPlanButton })}
        />
        <SettingsSwitchRow
          label={uiText('Show context usage')}
          value={preferences.showContextUsage}
          onValueChange={(showContextUsage) => updateMobilePreferences({ showContextUsage })}
        />
        <SettingsSwitchRow
          label={uiText('Keep the screen on while a task runs')}
          value={preferences.keepScreenOn}
          onValueChange={(keepScreenOn) => updateMobilePreferences({ keepScreenOn })}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}

export function SpeechSettingsScreen() {
  const uiText = useInterfaceText()

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
    <LocalSettingsPage title={uiText('Speech & driving')}>
      <RuntimeSpeechSettings />
      <SettingsGroup
        title={uiText('Speech')}
        footer={uiText(
          'Saved on this phone. Siri voices appear when iOS makes them available to apps; additional voices can be downloaded in iPhone speech settings.',
        )}
      >
        {loadingSpeech && (
          <Text style={styles.muted}>
            <InterfaceText>{'Loading speech options…'}</InterfaceText>
          </Text>
        )}
        {!!speechError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {speechError}
          </Text>
        )}
        <Choice
          label={uiText('Dictation language')}
          value={preferences.dictationLanguage}
          items={[
            { id: '', name: uiText('Automatic') },
            ...[...recognitionLanguages].sort().map((language) => ({
              id: language,
              name: dictationLanguages.find(([code]) => code === language)?.[1] ?? language,
            })),
          ]}
          onChange={(dictationLanguage) => updateMobilePreferences({ dictationLanguage })}
        />
        <Choice
          label={uiText('Read aloud language')}
          value={preferences.speechLanguage}
          items={[
            { id: '', name: uiText('Automatic') },
            ...speechLanguages.map((language) => ({ id: language, name: language })),
          ]}
          onChange={(speechLanguage) =>
            updateMobilePreferences({ speechLanguage, speechVoice: '' })
          }
        />
        <Choice
          label={uiText('Voice')}
          value={preferences.speechVoice}
          items={[
            { id: '', name: uiText('System default') },
            ...orderedVoices.map((voice) => ({
              id: voice.identifier,
              name: `${/siri/i.test(`${voice.name} ${voice.identifier}`) ? 'Siri · ' : ''}${voice.name} · ${voice.language}${voice.quality === 'Enhanced' ? ' · Enhanced' : ''}`,
            })),
          ]}
          onChange={(speechVoice) => updateMobilePreferences({ speechVoice })}
        />
        <Choice
          label={uiText('Speaking speed')}
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
        title={uiText('Driving')}
        footer={uiText(
          'Bigger text, only Threads and Settings, and chats without tool details. The screen stays on while a task runs. Also on the car button in Threads. Use dictation and keep your eyes on the road.',
        )}
      >
        <SettingsSwitchRow
          first
          label={uiText('Car mode')}
          value={preferences.carMode}
          onValueChange={(carMode) => updateMobilePreferences({ carMode })}
        />
        <SettingsSwitchRow
          label={uiText('Read replies aloud')}
          value={preferences.readRepliesAloud}
          onValueChange={(readRepliesAloud) => updateMobilePreferences({ readRepliesAloud })}
        />
      </SettingsGroup>
    </LocalSettingsPage>
  )
}
