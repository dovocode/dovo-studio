import { taskSortOptions, updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { Input } from '@dovo/studio-ui'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'
import { SettingsSelect } from './settings-select'

export default function TaskListSettings() {
  const preferences = useAppPreferences()
  return (
    <SettingsPage
      local
      title="Task list & projects"
      description="Organize the task list and project picker, and choose when to ask for confirmation. These preferences apply on this device."
    >
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
    </SettingsPage>
  )
}
