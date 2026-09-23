import type { CredentialField } from '@dovo/protocol'
import { View } from 'react-native'
import { Field } from '../ui/field'
import { Text } from '../ui/text'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
export function CredentialEditor({
  fields,
  onChange,
  disabled,
}: {
  fields: CredentialField[]
  onChange: (fields: CredentialField[]) => void
  disabled: boolean
}) {
  const change = (index: number, patch: Partial<CredentialField>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)))
  return (
    <View style={{ gap: 12 }}>
      {fields.map((field, index) => (
        <View key={index} style={[styles.card, { gap: 10 }]}>
          <Field
            label={`Credential ${index + 1} name`}
            placeholder="API_KEY"
            value={field.name}
            editable={!disabled && field.saved === undefined}
            onChangeText={(name) => change(index, { name })}
          />
          {field.saved !== undefined && !field.replacing ? (
            <Text style={styles.muted}>Configured · value hidden</Text>
          ) : (
            <Field
              label={`Value for ${field.name || 'new credential'}`}
              secureTextEntry
              autoComplete="off"
              value={field.value}
              editable={!disabled}
              onChangeText={(value) => change(index, { value })}
            />
          )}
          {field.saved !== undefined && (
            <Action
              secondary
              disabled={disabled}
              label={field.replacing ? 'Keep saved value' : 'Replace'}
              onPress={() => change(index, { replacing: !field.replacing, value: '' })}
            />
          )}
          <Action
            secondary
            disabled={disabled}
            label="Remove credential"
            onPress={() => onChange(fields.filter((_, i) => i !== index))}
          />
        </View>
      ))}
      <Action
        secondary
        disabled={disabled}
        label="Add credential"
        onPress={() => onChange([...fields, { name: '', value: '', replacing: true }])}
      />
      <Text style={styles.muted}>
        Changes take effect when you save. Remove a row to clear its saved value.
      </Text>
    </View>
  )
}
