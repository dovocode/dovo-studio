import { useApplicationState } from '@dovo/studio-core/state'
import {
  formatDateTime,
  taskSortOptions,
  updateAppPreferences,
  useAppPreferences,
} from '@dovo/studio-core'
import { ChoicePicker } from '@dovo/studio-ui'
import { SettingRow, SettingsGroup, SettingsPage, Segmented, Toggle } from './layout'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl'

export default function GeneralSettings() {
  const preferences = useAppPreferences()
  const [notice, setNotice] = useApplicationState('')
  // Turning on a notification asks the OS for permission once.
  const notify = async (
    key: 'notifyInput' | 'notifyDone' | 'notifyAutomations',
    enabled: boolean,
  ) => {
    setNotice('')
    if (enabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setNotice(
          'Notifications are blocked. Allow Dovo Studio in your system notification settings.',
        )
        return
      }
    }
    updateAppPreferences({ [key]: enabled })
  }
  return (
    <SettingsPage title="General" description="Preferences for this app on this device.">
      <SettingsGroup title="Startup">
        <SettingRow label="Open on launch" description="The view Dovo shows when it starts.">
          <Segmented
            label="Open on launch"
            value={preferences.launchView}
            options={[
              ['tasks', 'Tasks'],
              ['overview', 'Overview'],
            ]}
            onChange={(launchView) => updateAppPreferences({ launchView })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Task list">
        <SettingRow
          label="Default sort"
          description="How the task sidebar is ordered when Dovo opens."
        >
          <ChoicePicker
            aria-label="Default task sort"
            className="h-8 min-w-40 rounded-md px-2 text-xs"
            value={preferences.taskSort}
            onValueChange={(taskSort) =>
              updateAppPreferences({ taskSort: taskSort as typeof preferences.taskSort })
            }
          >
            {taskSortOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </ChoicePicker>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Date & time">
        <SettingRow
          label="Time format"
          description={`Example: ${formatDateTime(new Date(2026, 8, 25, 21, 30))}`}
        >
          <Segmented
            label="Time format"
            value={preferences.timeFormat}
            options={[
              ['auto', 'Automatic'],
              ['12h', '12-hour'],
              ['24h', '24-hour'],
            ]}
            onChange={(timeFormat) => updateAppPreferences({ timeFormat })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Conversation">
        <SettingRow
          label="Tool activity"
          description="Whether commands, edits and searches in each turn start open or folded."
        >
          <Segmented
            label="Tool activity"
            value={preferences.toolActivity}
            options={[
              ['collapsed', 'Collapsed'],
              ['expanded', 'Expanded'],
            ]}
            onChange={(toolActivity) => updateAppPreferences({ toolActivity })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Pull requests">
        <SettingRow
          label="Merge method"
          description="Preselected when merging. Falls back to the forge’s default if it isn’t offered."
        >
          <Segmented
            label="Merge method"
            value={preferences.mergeMethod}
            options={[
              ['auto', 'Forge default'],
              ['merge', 'Merge'],
              ['squash', 'Squash'],
              ['rebase', 'Rebase'],
            ]}
            onChange={(mergeMethod) => updateAppPreferences({ mergeMethod })}
          />
        </SettingRow>
        <SettingRow
          label="Create pull requests as drafts"
          description="Preselects Draft when the forge supports it. You can still change it per pull request."
        >
          <Toggle
            label="Create pull requests as drafts"
            checked={preferences.pullDraft}
            onChange={(pullDraft) => updateAppPreferences({ pullDraft })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Browser previews">
        <SettingRow
          label="Default viewport"
          description="The page size a task’s browser preview opens at. You can still change it in the preview."
        >
          <Segmented
            label="Default viewport"
            value={preferences.browserViewport}
            options={[
              ['fill', 'Fit window'],
              ['phone', 'Phone'],
              ['tablet', 'Tablet'],
              ['desktop', 'Desktop'],
            ]}
            onChange={(browserViewport) => updateAppPreferences({ browserViewport })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Composer">
        <SettingRow
          label="Send messages with"
          description={
            preferences.sendWith === 'enter'
              ? 'Enter sends. Shift+Enter adds a new line.'
              : `${mod}+Enter sends. Enter adds a new line.`
          }
        >
          <Segmented
            label="Send messages with"
            value={preferences.sendWith}
            options={[
              ['enter', 'Enter'],
              ['mod-enter', `${mod}+Enter`],
            ]}
            onChange={(sendWith) => updateAppPreferences({ sendWith })}
          />
        </SettingRow>
        <SettingRow
          label="Follow-ups while a task runs"
          description={
            preferences.followUp === 'queue'
              ? 'Queued messages are sent when the current turn finishes. Steer stays one click away.'
              : 'Messages guide the current turn right away. Queue stays one click away.'
          }
        >
          <Segmented
            label="Follow-ups while a task runs"
            value={preferences.followUp}
            options={[
              ['queue', 'Queue'],
              ['steer', 'Steer'],
            ]}
            onChange={(followUp) => updateAppPreferences({ followUp })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Notifications">
        <SettingRow
          label="When a task needs your input"
          description="A question or approval is waiting while Dovo is in the background."
        >
          <Toggle
            label="Notify when a task needs your input"
            checked={preferences.notifyInput}
            onChange={(enabled) => void notify('notifyInput', enabled)}
          />
        </SettingRow>
        <SettingRow
          label="When a task finishes"
          description="Includes tasks that stop with an error."
        >
          <Toggle
            label="Notify when a task finishes"
            checked={preferences.notifyDone}
            onChange={(enabled) => void notify('notifyDone', enabled)}
          />
        </SettingRow>
        <SettingRow
          label="When an automation finishes"
          description="Also when a run fails or reaches a review step. Cancelled runs stay quiet."
        >
          <Toggle
            label="Notify when an automation finishes"
            checked={preferences.notifyAutomations}
            onChange={(enabled) => void notify('notifyAutomations', enabled)}
          />
        </SettingRow>
        <SettingRow label="Play a sound">
          <Toggle
            label="Play a sound with notifications"
            checked={preferences.notifySound}
            onChange={(notifySound) => updateAppPreferences({ notifySound })}
          />
        </SettingRow>
      </SettingsGroup>
      {notice && (
        <p role="alert" className="text-xs text-destructive">
          {notice}
        </p>
      )}
      <SettingsGroup title="Confirmations">
        <SettingRow
          label="Confirm before archiving a task"
          description="Archived tasks can always be restored from Archived tasks."
        >
          <Toggle
            label="Confirm before archiving a task"
            checked={preferences.confirmArchive}
            onChange={(confirmArchive) => updateAppPreferences({ confirmArchive })}
          />
        </SettingRow>
        <SettingRow
          label="Confirm before stopping a running task"
          description="Stopping ends the agent's current turn and pauses queued messages."
        >
          <Toggle
            label="Confirm before stopping a running task"
            checked={preferences.confirmStop}
            onChange={(confirmStop) => updateAppPreferences({ confirmStop })}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
