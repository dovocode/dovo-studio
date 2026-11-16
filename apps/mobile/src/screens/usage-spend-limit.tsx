import { useState } from 'react'
import { View } from 'react-native'
import { Schema } from 'effect'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  formatSpendUsd,
  runtimeComputerName,
  unattendedSpendLimitInput,
  type RuntimeOverview,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsAction as Action, SettingsField as Field } from './settings-controls'
import { SettingsGroup } from './settings-group'
import { Text } from '../ui/content/text'
import { useSettingsTheme as useTheme } from './settings-theme'

const saved = Schema.Struct({ unattendedSpendLimitUsd: Schema.NullOr(Schema.Number) })

/** Settings → Usage & limits → Limits: the computer-wide limit on unattended spend. */
export function UsageSpendLimit({ computer }: { computer: string }) {
  const uiText = useInterfaceText()
  const { overviews } = useRuntime()
  const hosts = overviews.filter((entry) => computer === 'all' || entry.profile.id === computer)
  if (!hosts.length) return null
  return (
    <SettingsGroup
      title={uiText('Unattended spend limit')}
      footer={uiText(
        'Holds new work that runs without your message once its estimated cost reaches the limit. This covers Bot follow-ups, Bot routine steps, scheduled messages and child agents. Each thread or Bot counts with its child agents. A routine without a Bot starts a new count on each run. Set its own limits in Monitoring and limits. Your next message or Continue resets the count. Turns without a price also hold work. A running turn always finishes.',
      )}
    >
      {hosts.map((entry) => (
        <SpendLimitRow key={entry.profile.id} entry={entry} />
      ))}
    </SettingsGroup>
  )
}

function SpendLimitRow({ entry }: { entry: RuntimeOverview }) {
  const uiText = useInterfaceText()
  const { readRuntime, refreshRuntime } = useRuntime()
  const { styles } = useTheme()
  const reported = entry.snapshot?.unattendedSpendLimitUsd ?? null
  // A saved value shows at once; a newer snapshot from any client replaces it.
  const [local, setLocal] = useState<{ value: number | null; reported: number | null }>()
  const current = local && local.reported === reported ? local.value : reported
  // The field follows the reported limit until the user types, so a late snapshot or a change
  // from another device never leaves a blank or stale value to save.
  const [edited, setEdited] = useState<string>()
  const text = edited ?? current?.toString() ?? ''
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const name = runtimeComputerName(entry)
  if (entry.snapshot && !entry.snapshot.unattendedSpendLimitSupported)
    return (
      <Text style={[styles.muted, { padding: 12 }]}>
        {uiText('{value0}: update Dovo on this computer to set a spend limit.', { value0: name })}
      </Text>
    )
  const save = async (value: number | null) => {
    setBusy(true)
    setMessage('')
    try {
      const result = await readRuntime(
        entry.profile,
        '/api/runtime/preferences/save',
        { unattendedSpendLimitUsd: value },
        saved,
        'POST',
      )
      setEdited(undefined)
      setLocal({ value: result.unattendedSpendLimitUsd, reported })
      setMessage(
        result.unattendedSpendLimitUsd === null
          ? uiText('Limit turned off.')
          : uiText('Limit saved.'),
      )
      void refreshRuntime(entry.profile)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const disabled = busy || !entry.connected || !entry.snapshot
  const status =
    current === null
      ? uiText('Off')
      : uiText('{value0} per thread family', { value0: formatSpendUsd(current) })
  return (
    <View style={{ padding: 12, gap: 8 }}>
      <Text style={styles.text}>
        {[name, status, entry.connected ? '' : uiText('Offline')].filter(Boolean).join(' · ')}
      </Text>
      <Field
        label={uiText('Limit in USD for {value0}', { value0: name })}
        keyboardType="decimal-pad"
        placeholder={uiText('Off')}
        value={text}
        editable={!disabled}
        onChangeText={setEdited}
      />
      <Action
        label={uiText('Save limit')}
        disabled={disabled}
        onPress={() => {
          const value = unattendedSpendLimitInput(text)
          if (value === undefined)
            setMessage(uiText('Enter an amount in USD above 0 and up to 10,000.'))
          else void save(value)
        }}
      />
      <Action
        label={uiText('Turn off')}
        secondary
        disabled={disabled || current === null}
        onPress={() => void save(null)}
      />
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {message}
        </Text>
      )}
    </View>
  )
}
