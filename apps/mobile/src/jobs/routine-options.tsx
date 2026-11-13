import { useState } from 'react'
import { View } from 'react-native'
import {
  routineOptionFields,
  routineOptionLabels,
  parseRoutineOptions,
  type Automation,
} from '@dovo/protocol'
import { SettingsField as Field, SettingsAction as Action } from '../screens/settings-controls'
import { Text } from '../ui/content/text'
export function RoutineOptions({
  flow,
  disabled,
  onSave,
}: {
  flow: Automation
  disabled: boolean
  onSave: (options: Pick<Automation, 'policy' | 'monitor'>) => void
}) {
  const [fields, setFields] = useState(() => routineOptionFields(flow))
  const [error, setError] = useState('')
  return (
    <View style={{ gap: 8 }}>
      <Text>Monitoring and limits</Text>
      <Text>
        Source checks use HTTP GET. Unchanged automatic runs skip the agent. Manual tests always
        run. Quiet hours defer successful Bot reports. Failures and approvals stay visible. Usage
        limits can overrun when reports arrive late.
      </Text>
      {(Object.keys(routineOptionLabels) as Array<keyof typeof routineOptionLabels>).map((key) => (
        <Field
          key={key}
          label={routineOptionLabels[key]}
          value={fields[key]}
          editable={!disabled}
          placeholder={key === 'start' || key === 'end' ? 'HH:mm' : undefined}
          onChangeText={(value) => setFields((f) => ({ ...f, [key]: value }))}
        />
      ))}
      <Action
        label="Save monitoring and limits"
        disabled={disabled}
        onPress={() => {
          try {
            onSave(parseRoutineOptions(fields))
            setError('')
          } catch {
            setError(
              'Check the limits, source URL, and quiet hours. Use positive limits, HH:mm and a valid time zone.',
            )
          }
        }}
      />
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  )
}
