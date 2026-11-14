import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { SnoozeSchedule } from './snooze-schedule'
import {
  taskSortOptions,
  updateAppPreferences,
  useAppPreferences,
  useSettingsDraft,
} from '@dovo/studio-core'
import { Input, Button } from '@dovo/studio-ui'
import {
  defaultTaskSnoozeMinutes,
  formatTaskSnoozeMinutes,
  parseTaskSnoozeMinutes,
  taskGroupOptions,
} from '@dovo/protocol'
import { useEffect, useState } from 'react'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'
import { SettingsSelect } from './settings-select'

function SnoozeDurations({ minutes }: { minutes: number[] }) {
  const saved = formatTaskSnoozeMinutes(minutes)
  const [text, setText] = useState(saved)
  const [error, setError] = useState('')
  useSettingsDraft(text !== saved)
  useEffect(() => {
    setText(saved)
    setError('')
  }, [saved])
  return (
    <div className="space-y-2">
      <Input
        aria-label="Snooze durations"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setError('')
        }}
        placeholder="15m, 1h, 4h, 1d"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={text === saved}
          onClick={() => {
            try {
              updateAppPreferences({ taskSnoozeMinutes: parseTaskSnoozeMinutes(text) })
              setError('')
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          }}
        >
          Save snooze durations
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            updateAppPreferences({ taskSnoozeMinutes: [...defaultTaskSnoozeMinutes] })
            setText(formatTaskSnoozeMinutes(defaultTaskSnoozeMinutes))
            setError('')
          }}
        >
          Reset snooze durations
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export default function TaskListSettings() {
  const uiText = useInterfaceText()

  const preferences = useAppPreferences()
  return (
    <SettingsPage
      title="Thread list & projects"
      description="Organize the thread list and project picker, and choose when to ask for confirmation."
      storageInfo={<span>This device · saved automatically, except Snoozing (Save to apply)</span>}
    >
      <SettingsGroup
        title={uiText('Projects')}
        description="Arrange projects in the project picker."
      >
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
      <SettingsGroup title="Thread list">
        <SettingRow
          label="Thread grouping"
          description="Group the thread list by status or project, or show one list."
        >
          <SettingsSelect
            label="Thread grouping"
            value={preferences.taskGrouping}
            options={taskGroupOptions.map((option) => [option.id, option.name])}
            onChange={(taskGrouping) => updateAppPreferences({ taskGrouping })}
          />
        </SettingRow>
        <SettingRow
          label="Group running threads"
          description="Keep running threads in a collapsed Working section. Threads needing input and pinned threads stay visible."
        >
          <Toggle
            label="Group running threads"
            checked={preferences.workingSection}
            onChange={(workingSection) => updateAppPreferences({ workingSection })}
          />
        </SettingRow>
        <SettingRow
          label="Default thread sort"
          description="How the thread sidebar is ordered when Dovo opens."
        >
          <SettingsSelect
            label="Default thread sort"
            value={preferences.taskSort}
            options={taskSortOptions
              .filter((option) => option.id !== 'status')
              .map((option) => [option.id, option.name])}
            onChange={(taskSort) => updateAppPreferences({ taskSort })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup
        title="Snoozing"
        saveRequired
        description="Choose the thread snooze options on this device, in menu order. Use Save calendar shortcuts and Save snooze durations to apply edits. Existing snoozed threads keep their wake-up time."
      >
        <SnoozeSchedule schedule={preferences.taskSnoozeSchedule} />
        <SettingRow
          label="Snooze durations"
          description="Enter 1–12 durations separated by commas. Use m for minutes, h for hours, d for days or w for weeks."
        >
          <SnoozeDurations minutes={preferences.taskSnoozeMinutes} />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup
        title="Confirmations"
        description="Choose when Dovo asks before changing a thread."
      >
        {(
          [
            [
              'confirmArchive',
              'Confirm before archiving a thread',
              'Archived threads can be restored from Archived threads.',
            ],
            [
              'confirmStop',
              'Confirm before stopping a running thread',
              'Ends the current turn and pauses queued messages.',
            ],
            ['confirmUnpin', 'Confirm before unpinning a thread', 'Remove a thread from Pinned.'],
            [
              'confirmDelete',
              'Confirm before deleting a thread',
              'Ask before permanently deleting a thread and its conversation.',
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
