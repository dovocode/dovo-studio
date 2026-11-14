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
import { useTheme } from '../ui/theme'
export function RoutineOptions({
  flow,
  disabled,
  jsonMonitoringSupported = false,
  mcpMonitoringSupported = false,
  findingGroupsSupported = false,
  onSave,
}: {
  flow: Automation
  disabled: boolean
  jsonMonitoringSupported?: boolean
  mcpMonitoringSupported?: boolean
  findingGroupsSupported?: boolean
  onSave: (options: Pick<Automation, 'policy' | 'monitor'>) => void
}) {
  const { styles } = useTheme()
  const [fields, setFields] = useState(() => routineOptionFields(flow))
  const [error, setError] = useState('')
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.text}>Monitoring and limits</Text>
      <Text style={styles.muted}>
        Source checks use HTTP GET. Unchanged automatic runs skip the agent. An optional JSON
        pointer watches only that value and ignores object key order. Manual tests always run. Quiet
        hours defer successful Bot reports. Failures and approvals stay visible. Usage limits can
        overrun when reports arrive late.
      </Text>
      {(Object.keys(routineOptionLabels) as Array<keyof typeof routineOptionLabels>)
        .filter((key) => key !== 'jsonPointer' || jsonMonitoringSupported)
        .filter((key) => key !== 'matter' || findingGroupsSupported)
        .filter((key) => !['mcpServer', 'mcpUri'].includes(key) || mcpMonitoringSupported)
        .map((key) => (
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
            if (fields.jsonPointer && !jsonMonitoringSupported)
              throw Error('Update this runtime to edit JSON monitoring.')
            if ((fields.mcpServer || fields.mcpUri) && !mcpMonitoringSupported)
              throw Error('Update this runtime to edit MCP monitoring.')
            onSave(parseRoutineOptions(fields))
            setError('')
          } catch {
            setError(
              'Check the limits, source URL, and quiet hours. Use positive limits, HH:mm and a valid time zone.',
            )
          }
        }}
      />
      {!!error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  )
}
