import { useState } from 'react'
import { View } from 'react-native'
import { ACCOUNT_DIRECTORY_URL, normalizeServiceUrls } from '@dovo/protocol'
import { useMobilePreferences, updateMobilePreferences } from '../preferences/app-preferences'
import { SettingsField as Field, SettingsAction as Action } from '../../screens/settings-controls'
import { useSettingsTheme } from '../../screens/settings-theme'
import { Text } from '../../ui/content/text'

export function ServiceUrlSettings() {
  const saved = useMobilePreferences()
  const [draft, setDraft] = useState<{ connectOrigin: string; artifactsOrigin: string }>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { styles } = useSettingsTheme()
  const fields = draft ?? saved
  const dirty =
    fields.connectOrigin !== saved.connectOrigin || fields.artifactsOrigin !== saved.artifactsOrigin
  const save = () => {
    try {
      const normalized = normalizeServiceUrls(fields)
      updateMobilePreferences({
        ...normalized,
        connectOrigin:
          normalized.connectOrigin === ACCOUNT_DIRECTORY_URL ? '' : normalized.connectOrigin,
      })
      setDraft(undefined)
      setError('')
      setNotice('Service URLs saved on this device.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the service URLs')
    }
  }
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Dovo service URLs">
      <Text style={styles.title}>Dovo services</Text>
      <Text style={styles.text}>
        Saved on this device. Account sessions stay separate for each Connect server. New computer
        setups use this URL. Existing computers keep their current server until Connect is disabled
        and enabled again through LAN / VPN pairing.
      </Text>
      <Field
        label="Dovo Connect URL"
        value={fields.connectOrigin}
        placeholder={ACCOUNT_DIRECTORY_URL}
        keyboardType="url"
        autoCorrect={false}
        onChangeText={(connectOrigin) => {
          setDraft({ connectOrigin, artifactsOrigin: fields.artifactsOrigin })
          setNotice('')
        }}
      />
      <Field
        label="Dovo Artifacts URL"
        value={fields.artifactsOrigin}
        placeholder="Automatic — from Connect"
        keyboardType="url"
        autoCorrect={false}
        onChangeText={(artifactsOrigin) => {
          setDraft({ connectOrigin: fields.connectOrigin, artifactsOrigin })
          setNotice('')
        }}
      />
      <Text style={styles.text}>
        Leave Artifacts blank to use the store announced by Connect. Configure the same custom URL
        on your Connect broker and artifact server; Studio checks they match before sharing.
      </Text>
      <Action label="Save service URLs" disabled={!dirty || !saved.ready} onPress={save} />
      <Action
        label="Use defaults"
        secondary
        onPress={() => {
          setDraft({ connectOrigin: '', artifactsOrigin: '' })
          setError('')
          setNotice('')
        }}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityRole="text" style={styles.text}>
          {notice}
        </Text>
      )}
    </View>
  )
}
