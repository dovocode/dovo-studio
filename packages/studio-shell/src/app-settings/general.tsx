import { useStudioHost } from '@dovo/studio-core'
import { useEffect, useState } from 'react'
import { taskLauncherShortcuts } from '@dovo/protocol'
import {
  formatDateTime,
  taskSortOptions,
  updateAppPreferences,
  useAppPreferences,
} from '@dovo/studio-core'
import { UpdateSettings } from './updates'
import { ChoicePicker } from '@dovo/studio-ui'
import { SettingRow, SettingsGroup, SettingsPage, Segmented, Toggle } from './layout'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl'

export default function GeneralSettings() {
  const { appInfo, taskLauncher } = useStudioHost()
  const preferences = useAppPreferences()
  const [shortcutError, setShortcutError] = useState('')
  useEffect(() => {
    if (!taskLauncher) return
    let current = true
    void taskLauncher.configure(preferences.taskLauncherShortcut).then(
      (result) => {
        if (current) setShortcutError(result.error ?? '')
      },
      (cause: unknown) => {
        if (current) setShortcutError(String(cause))
      },
    )
    return () => {
      current = false
    }
  }, [taskLauncher, preferences.taskLauncherShortcut])
  return (
    <SettingsPage
      title="General"
      description="How Dovo starts, lists tasks and behaves in conversations on this device."
    >
      {appInfo && (
        <SettingsGroup title="About">
          <SettingRow label="Dovo Studio" description="Installed app version">
            <span className="text-xs text-muted-foreground">
              {appInfo.version}
              {appInfo.channel !== 'stable'
                ? ` · ${appInfo.channel === 'nightly' ? 'Nightly' : 'Dev'}`
                : ''}
            </span>
          </SettingRow>
        </SettingsGroup>
      )}
      <UpdateSettings />
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
      <SettingsGroup title="Navigation">
        {taskLauncher && (
          <SettingRow
            label="Global new task shortcut"
            description={
              shortcutError ||
              'Open the task launcher from any app. Select a server, project and favorite agent.'
            }
          >
            <ChoicePicker
              aria-label="Global new task shortcut"
              value={preferences.taskLauncherShortcut}
              onValueChange={(value) => {
                const shortcut = taskLauncherShortcuts.find((shortcut) => shortcut === value)
                if (shortcut !== undefined) updateAppPreferences({ taskLauncherShortcut: shortcut })
              }}
            >
              <option value="CommandOrControl+Shift+Space">{mod} + Shift + Space</option>
              <option value="CommandOrControl+Alt+N">{mod} + Alt + N</option>
              <option value="">Disabled</option>
            </ChoicePicker>
          </SettingRow>
        )}
        <SettingRow label="Issues" description="Show code-host issues in the sidebar.">
          <Toggle
            label="Show Issues"
            checked={preferences.showIssues}
            onChange={(showIssues) => updateAppPreferences({ showIssues })}
          />
        </SettingRow>
        <SettingRow label="Jira" description="Show Jira issues in a separate sidebar view.">
          <Toggle
            label="Show Jira"
            checked={preferences.showJira}
            onChange={(showJira) => updateAppPreferences({ showJira })}
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
        <SettingRow
          label="Tool activity"
          description="Whether commands, edits and searches in each turn start open, folded, or stay hidden so only replies show. Ctrl+O switches between them."
        >
          <Segmented
            label="Tool activity"
            value={preferences.toolActivity}
            options={[
              ['collapsed', 'Collapsed'],
              ['expanded', 'Expanded'],
              ['hidden', 'Replies only'],
            ]}
            onChange={(toolActivity) => updateAppPreferences({ toolActivity })}
          />
        </SettingRow>
      </SettingsGroup>
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
