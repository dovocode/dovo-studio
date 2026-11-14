import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import type { CredentialField } from '@dovo/protocol'
import { View } from 'react-native'
import { SettingsField as Field } from '../screens/settings-controls'
import { Text } from '../ui/content/text'
import { SettingsAction as Action } from '../screens/settings-controls'
import { useTheme } from '../ui/theme'
export function CredentialEditor({
  fields,
  onChange,
  disabled,
}: {
  fields: CredentialField[]
  onChange: (fields: CredentialField[]) => void
  disabled: boolean
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const change = (index: number, patch: Partial<CredentialField>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)))
  return (
    <View style={{ gap: 12 }}>
      {fields.map((field, index) => (
        <View key={index} style={[styles.card, { gap: 10 }]}>
          <Field
            label={uiText('Credential {value0} name', { value0: index + 1 })}
            placeholder={'API_KEY'}
            value={field.name}
            editable={!disabled && field.saved === undefined}
            onChangeText={(name) => change(index, { name })}
          />
          {field.saved !== undefined && !field.replacing ? (
            <Text style={styles.muted}>
              <InterfaceText>{'Configured · value hidden'}</InterfaceText>
            </Text>
          ) : (
            <Field
              label={uiText('Value for {value0}', { value0: field.name || 'new credential' })}
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
              label={field.replacing ? uiText('Keep saved value') : uiText('Replace')}
              onPress={() => change(index, { replacing: !field.replacing, value: '' })}
            />
          )}
          <Action
            destructive
            secondary
            disabled={disabled}
            label={uiText('Remove credential')}
            onPress={() => onChange(fields.filter((_, i) => i !== index))}
          />
        </View>
      ))}
      <Action
        secondary
        disabled={disabled}
        label={uiText('Add credential')}
        onPress={() => onChange([...fields, { name: '', value: '', replacing: true }])}
      />
      <Text style={styles.muted}>
        <InterfaceText>
          {'Changes take effect when you save. Remove a row to clear its saved value.'}
        </InterfaceText>
      </Text>
    </View>
  )
}
