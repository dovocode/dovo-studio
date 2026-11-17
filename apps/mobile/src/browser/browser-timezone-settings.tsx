import { useState } from 'react'
import { View } from 'react-native'
import { browserProfilesSchema, decodeResult } from '@dovo/protocol'
import { Field } from '../ui/controls/field'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
export function BrowserTimezoneSettings({
  value,
  supported,
  disabled,
  onSave,
}: {
  value?: string
  supported: boolean
  disabled: boolean
  onSave: (timezone?: string) => Promise<void>
}) {
  const [text, setText] = useState(value ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { styles } = useTheme()
  const timezone = text.trim() || undefined
  const valid = decodeResult(browserProfilesSchema, [
    { id: 'default', name: 'Default', timezone },
  ]).success
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.muted}>
        Profile time zone: {value ?? 'Computer default'}. A blank value restores the computer time
        zone.
      </Text>
      {!supported ? (
        <Text style={styles.muted}>Update this computer to set a browser time zone.</Text>
      ) : (
        <>
          <Field
            label="Profile time zone"
            value={text}
            onChangeText={setText}
            editable={!disabled && !busy}
            placeholder="Europe/Amsterdam"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!valid && <Text style={styles.error}>Enter a valid IANA time zone.</Text>}
          {timezone !== value && (
            <Action
              label="Save time zone"
              disabled={disabled || busy || !valid}
              onPress={() => {
                setBusy(true)
                setError('')
                void onSave(timezone)
                  .catch((cause: unknown) => setError(String(cause)))
                  .finally(() => setBusy(false))
              }}
            />
          )}
        </>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
