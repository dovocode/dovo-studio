import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { dictationStatusSchema, responses, type DictationStatus } from '@dovo/protocol'
import { randomUUID } from 'expo-crypto'
import { useRuntime } from '../runtime/connection/provider'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { Text } from '../ui/content/text'
import { useSettingsTheme } from './settings-theme'
import { SettingsGroup, SettingsSwitchRow } from './settings-group'
import { SettingsAction } from './settings-controls'

export function RuntimeSpeechSettings() {
  const { snapshot, profile } = useRuntime()
  const runtimeId = snapshot?.runtimeId ?? profile?.connection.runtimeId
  if (!runtimeId || !snapshot?.runtimeDictationSupported) return null
  return (
    <ComputerSpeech
      key={JSON.stringify([runtimeId, profile?.connection.address, profile?.connection.token])}
      runtimeId={runtimeId}
    />
  )
}
function ComputerSpeech({ runtimeId }: { runtimeId: string }) {
  const { call, connected } = useRuntime()
  const preferences = useMobilePreferences()
  const { styles } = useSettingsTheme()
  const [status, setStatus] = useState<DictationStatus>()
  const [operation, setOperation] = useState('')
  const [error, setError] = useState('')
  const [statusError, setStatusError] = useState('')
  useEffect(() => {
    if (!connected) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const result = await call('/api/dictation/status', {}, dictationStatusSchema)
        if (!stopped) {
          setStatus(result)
          setStatusError('')
        }
      } catch (cause) {
        if (!stopped) setStatusError(String(cause))
      } finally {
        if (!stopped) timer = setTimeout(refresh, 2000)
      }
    }
    void refresh()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [call, connected])
  return (
    <SettingsGroup
      title="Dictation on the selected computer"
      footer="Off by default on each device. Finished recordings go only to the thread’s computer. No cloud fallback. The computer needs FFmpeg to read phone recordings. Update the phone app to enable recording."
    >
      <SettingsSwitchRow
        label="Use this computer for dictation"
        value={preferences.runtimeDictationIds.includes(runtimeId)}
        disabled={
          !preferences.runtimeDictationIds.includes(runtimeId) && (!connected || !status?.model)
        }
        onValueChange={(enabled) =>
          updateMobilePreferences({
            runtimeDictationIds: [
              ...preferences.runtimeDictationIds.filter((id) => id !== runtimeId),
              ...(enabled ? [runtimeId] : []),
            ],
          })
        }
      />
      <View style={{ padding: 12, gap: 8 }}>
        <Text style={styles.muted}>
          {status?.model
            ? 'Speech model downloaded.'
            : 'Download the 751 MB speech model once on this computer.'}
        </Text>
        {!status?.engine && (
          <Text style={styles.muted}>
            Update the computer’s server package or run pnpm prepare:dictation there.
          </Text>
        )}
        {status?.downloading && (
          <Text style={styles.muted}>
            Downloading… {Math.floor((status.downloaded / 751094240) * 100)}%
          </Text>
        )}
        <SettingsAction
          label="Download model on computer"
          disabled={!connected || !status?.engine || status.downloading || !!operation}
          onPress={() => {
            const id = randomUUID()
            setOperation(id)
            setError('')
            void call('/api/dictation/install', { id }, dictationStatusSchema)
              .then(setStatus)
              .catch((cause: unknown) => setError(String(cause)))
              .finally(() => setOperation(''))
          }}
        />
        {!!operation && (
          <SettingsAction
            secondary
            label="Cancel download"
            onPress={() => {
              void call('/api/dictation/cancel', { id: operation }, responses.ok).catch(
                (cause: unknown) => setError(String(cause)),
              )
            }}
          />
        )}
        {!!(error || statusError) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error || statusError}
          </Text>
        )}
      </View>
    </SettingsGroup>
  )
}
