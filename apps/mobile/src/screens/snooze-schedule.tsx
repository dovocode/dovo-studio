import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  defaultTaskSnoozeSchedule,
  parseTaskSnoozeSchedule,
  taskSnoozeCalendarPresets,
  taskSnoozeWeekdays,
  type TaskSnoozeSchedule,
} from '@dovo/protocol'
import { updateMobilePreferences } from '../runtime/preferences/app-preferences'
import { Field } from '../ui/controls/field'
import { IconButton } from '../ui/controls/icon-button'
import { Switch } from '../ui/controls/switch'
import { Text } from '../ui/content/text'
import { useSettingsTheme } from './settings-theme'
import { SettingsChoice, SettingsAction } from './settings-controls'

export function SnoozeSchedule({
  schedule,
  ready,
}: {
  schedule: TaskSnoozeSchedule
  ready: boolean
}) {
  const [draft, setDraft] = useState(schedule)
  const [error, setError] = useState('')
  const { styles } = useSettingsTheme()
  useEffect(() => {
    setDraft(schedule)
    setError('')
  }, [schedule])
  const presets = [
    ...draft.presets,
    ...taskSnoozeCalendarPresets.map(([id]) => id).filter((id) => !draft.presets.includes(id)),
  ]
  return (
    <View style={{ gap: 8, padding: 12 }}>
      <Field
        label="Morning time"
        placeholder="09:00"
        value={draft.morningTime}
        editable={ready}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(morningTime) => setDraft({ ...draft, morningTime })}
      />
      <Field
        label="Evening time"
        placeholder="18:00"
        value={draft.eveningTime}
        editable={ready}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(eveningTime) => setDraft({ ...draft, eveningTime })}
      />
      <SettingsChoice
        label="Next week starts on"
        value={String(draft.weekStartsOn)}
        items={taskSnoozeWeekdays}
        onChange={(day) => setDraft({ ...draft, weekStartsOn: Number(day) })}
      />
      <Text style={styles.muted}>
        24-hour local times. Calendar shortcuts appear before durations, in this order. Later today
        appears until the evening time.
      </Text>
      {presets.map((id) => {
        const label = taskSnoozeCalendarPresets.find(([key]) => key === id)![1]
        const index = draft.presets.indexOf(id)
        return (
          <View key={id} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
              <Text style={[styles.text, { flex: 1 }]}>{label}</Text>
              <Switch
                accessibilityLabel={label}
                disabled={!ready}
                value={index >= 0}
                onValueChange={(enabled) =>
                  setDraft({
                    ...draft,
                    presets: enabled
                      ? [...draft.presets, id]
                      : draft.presets.filter((key) => key !== id),
                  })
                }
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([-1, 1] as const).map((direction) => (
                <IconButton
                  key={direction}
                  icon={direction === -1 ? 'moveUp' : 'moveDown'}
                  label={`Move ${label} ${direction === -1 ? 'up' : 'down'}`}
                  disabled={
                    !ready ||
                    index < 0 ||
                    (direction === -1 ? index === 0 : index === draft.presets.length - 1)
                  }
                  onPress={() => {
                    const presets = [...draft.presets]
                    ;[presets[index], presets[index + direction]] = [
                      presets[index + direction]!,
                      presets[index]!,
                    ]
                    setDraft({ ...draft, presets })
                  }}
                />
              ))}
            </View>
          </View>
        )
      })}
      <SettingsAction
        label="Save calendar shortcuts"
        disabled={!ready || JSON.stringify(draft) === JSON.stringify(schedule)}
        onPress={() => {
          try {
            updateMobilePreferences({ taskSnoozeSchedule: parseTaskSnoozeSchedule(draft) })
            setError('')
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        }}
      />
      <SettingsAction
        secondary
        label="Reset calendar shortcuts"
        disabled={!ready}
        onPress={() => {
          const defaults = {
            ...defaultTaskSnoozeSchedule,
            presets: [...defaultTaskSnoozeSchedule.presets],
          }
          setDraft(defaults)
          updateMobilePreferences({ taskSnoozeSchedule: defaults })
          setError('')
        }}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
