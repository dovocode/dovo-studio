import { View } from 'react-native'
import { Field } from '../ui/controls/field'

/** Text fields stay local until the user saves the assistant. */
export function BotFields({
  name,
  role,
  responsibilities,
  disabled,
  onName,
  onRole,
  onResponsibilities,
}: {
  name: string
  role: string
  responsibilities: string
  disabled: boolean
  onName: (value: string) => void
  onRole: (value: string) => void
  onResponsibilities: (value: string) => void
}) {
  return (
    <View style={{ gap: 16 }}>
      <Field label="Bot name" value={name} onChangeText={onName} editable={!disabled} />
      <Field
        label="Role"
        maxLength={120}
        value={role}
        onChangeText={onRole}
        editable={!disabled}
        hint="Describe the assistant’s purpose."
      />
      <Field
        label="Responsibilities"
        maxLength={8000}
        value={responsibilities}
        onChangeText={onResponsibilities}
        multiline
        editable={!disabled}
        hint="Describe the work this assistant should do."
      />
    </View>
  )
}
