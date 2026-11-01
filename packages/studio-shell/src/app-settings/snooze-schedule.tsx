import { useEffect, useState } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { Button, Input } from '@dovo/studio-ui'
import {
  defaultTaskSnoozeSchedule,
  parseTaskSnoozeSchedule,
  taskSnoozeCalendarPresets,
  taskSnoozeWeekdays,
  type TaskSnoozeSchedule,
} from '@dovo/protocol'
import { updateAppPreferences } from '@dovo/studio-core'
import { SettingRow, Toggle } from './layout'
import { SettingsSelect } from './settings-select'

export function SnoozeSchedule({ schedule }: { schedule: TaskSnoozeSchedule }) {
  const [draft, setDraft] = useState(schedule)
  const [error, setError] = useState('')
  useEffect(() => {
    setDraft(schedule)
    setError('')
  }, [schedule])
  const presets = [
    ...draft.presets,
    ...taskSnoozeCalendarPresets.map(([id]) => id).filter((id) => !draft.presets.includes(id)),
  ]
  return (
    <>
      <SettingRow label="Morning time" description="24-hour local time for morning shortcuts.">
        <Input
          aria-label="Morning time"
          type="time"
          value={draft.morningTime}
          onChange={(event) => setDraft({ ...draft, morningTime: event.target.value })}
        />
      </SettingRow>
      <SettingRow
        label="Evening time"
        description="24-hour local time for Later today and evening shortcuts."
      >
        <Input
          aria-label="Evening time"
          type="time"
          value={draft.eveningTime}
          onChange={(event) => setDraft({ ...draft, eveningTime: event.target.value })}
        />
      </SettingRow>
      <SettingRow label="Next week starts on">
        <SettingsSelect
          label="Next week starts on"
          value={String(draft.weekStartsOn)}
          options={taskSnoozeWeekdays.map((day) => [day.id, day.name])}
          onChange={(day) => setDraft({ ...draft, weekStartsOn: Number(day) })}
        />
      </SettingRow>
      {presets.map((id) => {
        const label = taskSnoozeCalendarPresets.find(([key]) => key === id)![1]
        const index = draft.presets.indexOf(id)
        return (
          <SettingRow key={id} label={label}>
            <div className="flex items-center gap-2">
              {([-1, 1] as const).map((direction) => (
                <Button
                  key={direction}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${label} ${direction === -1 ? 'up' : 'down'}`}
                  disabled={
                    index < 0 ||
                    (direction === -1 ? index === 0 : index === draft.presets.length - 1)
                  }
                  onClick={() => {
                    const presets = [...draft.presets]
                    ;[presets[index], presets[index + direction]] = [
                      presets[index + direction]!,
                      presets[index]!,
                    ]
                    setDraft({ ...draft, presets })
                  }}
                >
                  {direction === -1 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                </Button>
              ))}
              <Toggle
                label={label}
                checked={index >= 0}
                onChange={(enabled) =>
                  setDraft({
                    ...draft,
                    presets: enabled
                      ? [...draft.presets, id]
                      : draft.presets.filter((key) => key !== id),
                  })
                }
              />
            </div>
          </SettingRow>
        )
      })}
      <SettingRow
        label="Calendar shortcuts"
        description="Enabled shortcuts appear before durations, in this order. Later today appears until the evening time."
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={JSON.stringify(draft) === JSON.stringify(schedule)}
              onClick={() => {
                try {
                  updateAppPreferences({ taskSnoozeSchedule: parseTaskSnoozeSchedule(draft) })
                  setError('')
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause))
                }
              }}
            >
              Save calendar shortcuts
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const defaults = {
                  ...defaultTaskSnoozeSchedule,
                  presets: [...defaultTaskSnoozeSchedule.presets],
                }
                setDraft(defaults)
                updateAppPreferences({ taskSnoozeSchedule: defaults })
                setError('')
              }}
            >
              Reset calendar shortcuts
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </SettingRow>
    </>
  )
}
