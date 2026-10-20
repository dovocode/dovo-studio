import { useEffect, useState } from 'react'
import { Bot, ChevronRight, ListTodo, MessagesSquare, PanelsTopLeft } from 'lucide-react'
import { taskLauncherShortcuts } from '@dovo/protocol'
import {
  formatDateTime,
  updateAppPreferences,
  useAppPreferences,
  useStudioHost,
} from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'
import { SettingsSelect } from './settings-select'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl'

export default function GeneralSettings() {
  const host = useStudioHost()
  const { taskLauncher } = host
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
      local
      title="General"
      description="Navigation, date and time, and everyday app behavior on this device."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            {
              id: 'task-list-settings',
              title: 'Organize tasks & projects',
              description: 'Grouping, sorting, project picker and confirmations',
              icon: PanelsTopLeft,
            },
            {
              id: 'conversation-settings',
              title: 'Customize conversations',
              description: 'Writing, reading responses and speech',
              icon: MessagesSquare,
            },
            {
              id: 'agents',
              title: 'Set up your agents',
              description: 'Providers, models and reusable profiles',
              icon: Bot,
            },
            {
              id: 'task-defaults',
              title: 'Choose task defaults',
              description: 'Global, computer and project settings',
              icon: ListTodo,
            },
          ] as const
        ).map(({ id, title, description, icon: Icon }) => (
          <button
            type="button"
            key={id}
            onClick={() => host.navigate({ viewId: id })}
            className="flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{title}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {description}
              </span>
            </span>
            <ChevronRight className="size-3.5 text-muted-foreground" />
          </button>
        ))}
      </div>
      <SettingsGroup title="Navigation & shortcuts">
        {taskLauncher && (
          <SettingRow
            label="Global new task shortcut"
            description={
              shortcutError ? (
                <span role="alert" className="text-destructive">
                  {shortcutError}
                </span>
              ) : (
                'Open the task launcher from any app.'
              )
            }
          >
            <SettingsSelect
              label="Global new task shortcut"
              value={preferences.taskLauncherShortcut || 'disabled'}
              options={[
                ['CommandOrControl+Shift+Space', `${mod} + Shift + Space`],
                ['CommandOrControl+Alt+N', `${mod} + Alt + N`],
                ['disabled', 'Disabled'],
              ]}
              onChange={(value) => {
                const shortcut = taskLauncherShortcuts.find(
                  (entry) => entry === (value === 'disabled' ? '' : value),
                )
                if (shortcut !== undefined) updateAppPreferences({ taskLauncherShortcut: shortcut })
              }}
            />
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
      <SettingsGroup title="Date & time">
        <SettingRow
          label="Time format"
          description={`Example: ${formatDateTime(new Date(2026, 8, 25, 21, 30))}`}
        >
          <SettingsSelect
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
      <SettingsGroup title="Application">
        <SettingRow
          label="Background activity"
          description="Balanced pauses refreshes in hidden windows. Reduced also refreshes less often in visible windows."
        >
          <SettingsSelect
            label="Background activity"
            value={preferences.backgroundActivity}
            options={[
              ['balanced', 'Balanced'],
              ['reduced', 'Reduced'],
            ]}
            onChange={(backgroundActivity) => updateAppPreferences({ backgroundActivity })}
          />
        </SettingRow>
        {host.appInfo && (
          <SettingRow
            label="Quit shortcut"
            description="In Hold mode, hold for 600 ms or press twice quickly to quit."
          >
            <SettingsSelect
              label="Quit shortcut"
              value={preferences.quitShortcut}
              options={[
                ['immediate', 'Immediate'],
                ['hold', 'Hold'],
                ['disabled', 'Disabled'],
              ]}
              onChange={(quitShortcut) => updateAppPreferences({ quitShortcut })}
            />
          </SettingRow>
        )}
      </SettingsGroup>
    </SettingsPage>
  )
}
