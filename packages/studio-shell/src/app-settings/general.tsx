import { useEffect, useState } from 'react'
import { Bot, ChevronRight, ListTodo } from 'lucide-react'
import { taskLauncherShortcuts } from '@dovo/protocol'
import {
  formatDateTime,
  taskSortOptions,
  updateAppPreferences,
  useAppPreferences,
  useStudioHost,
} from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'
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
      description="Organization, navigation and everyday app behavior."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
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
            className="flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="size-5 shrink-0 text-muted-foreground" />
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
      <SettingsGroup title="Projects" description="Arrange projects in the project picker.">
        <SettingRow
          label="Group matching projects"
          description="Combine matching repositories across computers."
        >
          <Toggle
            label="Group matching projects"
            checked={preferences.projectGrouping}
            onChange={(projectGrouping) => updateAppPreferences({ projectGrouping })}
          />
        </SettingRow>
        <SettingRow label="Project order" description="Order of projects in the project picker.">
          <SettingsSelect
            label="Project order"
            value={preferences.projectOrder}
            options={[
              ['name', 'Name'],
              ['activity', 'Last activity'],
              ['user-message', 'Last user message'],
            ]}
            onChange={(projectOrder) => updateAppPreferences({ projectOrder })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Task list">
        <SettingRow
          label="Group running tasks"
          description="Keep running tasks in a collapsed Working section. Tasks needing input and pinned tasks stay visible."
        >
          <Toggle
            label="Group running tasks"
            checked={preferences.workingSection}
            onChange={(workingSection) => updateAppPreferences({ workingSection })}
          />
        </SettingRow>
        <SettingRow
          label="Default task sort"
          description="How the task sidebar is ordered when Dovo opens."
        >
          <SettingsSelect
            label="Default task sort"
            value={preferences.taskSort}
            options={taskSortOptions
              .filter((option) => option.id !== 'status')
              .map((option) => [option.id, option.name])}
            onChange={(taskSort) => updateAppPreferences({ taskSort })}
          />
        </SettingRow>
      </SettingsGroup>
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
        <SettingRow
          label="Add project starts in"
          description="Starting folder for the project picker. Leave empty to use the computer’s default."
        >
          <Input
            aria-label="Add project starts in"
            value={preferences.addProjectStartsIn}
            onChange={(event) => updateAppPreferences({ addProjectStartsIn: event.target.value })}
            placeholder="~/Code"
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
      <SettingsGroup
        title="Confirmations"
        description="Choose when Dovo asks before changing a task."
      >
        {(
          [
            [
              'confirmArchive',
              'Confirm before archiving a task',
              'Archived tasks can be restored from Archived tasks.',
            ],
            [
              'confirmStop',
              'Confirm before stopping a running task',
              'Ends the current turn and pauses queued messages.',
            ],
            ['confirmUnpin', 'Confirm before unpinning a task', 'Remove a task from Pinned.'],
            [
              'confirmDelete',
              'Confirm before deleting a task',
              'Ask before permanently deleting a task and its conversation.',
            ],
          ] as const
        ).map(([key, label, description]) => (
          <SettingRow key={key} label={label} description={description}>
            <Toggle
              label={label}
              checked={preferences[key]}
              onChange={(value) => updateAppPreferences({ [key]: value })}
            />
          </SettingRow>
        ))}
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
        <SettingRow
          label="Mobile devices"
          description="Pair Dovo on your phone with a computer using a pairing code."
        >
          <Button variant="outline" onClick={() => host.navigate({ viewId: 'runtime' })}>
            Pair a device
          </Button>
        </SettingRow>
        <SettingRow
          label="Text generation model"
          description="Choose the model for task titles and dictation on each computer."
        >
          <Button variant="outline" onClick={() => host.navigate({ viewId: 'text-generation' })}>
            Configure text generation
          </Button>
        </SettingRow>
        <SettingRow
          label="Diagnostics"
          description="Inspect provider installations, runtime state and recorded activity."
        >
          <Button variant="outline" onClick={() => host.navigate({ viewId: 'activity' })}>
            View activity
          </Button>
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
