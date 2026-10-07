import { useState } from 'react'
import { useRuntime } from '../connection/provider'
import {
  settingBaseLabel,
  settingLayers,
  settingValueLabel,
  runtimeComputerName,
  type Repository,
  type SettingField,
} from '@dovo/protocol'
import { View } from 'react-native'
import { settingsScopeLabels, type SettingsScope } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function SettingSource({
  source,
  overridden,
  label,
  disabled = false,
  onReset,
  setting,
}: {
  setting?: { field: SettingField; repository?: Repository; scope: SettingsScope; value: unknown }
  source: SettingsScope | 'built-in' | 'computer-default'
  overridden: boolean
  label: string
  disabled?: boolean
  onReset?: () => void
}) {
  const [open, setOpen] = useState(false)
  const { overviews, activeId, snapshot } = useRuntime()
  const { colors, styles } = useTheme()

  const name =
    source === 'built-in'
      ? 'Dovo default'
      : source === 'computer-default'
        ? 'Computer preference'
        : settingsScopeLabels[source]
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 4,
      }}
    >
      <Text
        style={[
          styles.muted,
          { flex: 1, fontSize: 12, color: overridden ? colors.accent : colors.muted },
        ]}
      >
        {overridden ? `Set here · ${name}` : `Inherited · ${name}`}
      </Text>
      {setting && (
        <Action
          secondary
          label={open ? 'Hide sources' : `Sources for ${label.toLowerCase()}`}
          onPress={() => setOpen(!open)}
        />
      )}
      {open && setting && (
        <View style={{ width: '100%', gap: 12 }}>
          {overviews.map((entry) => {
            const active = entry.profile.id === activeId
            const state = active ? snapshot : entry.snapshot
            const repository = active
              ? setting.repository
              : setting.repository?.gitIdentity
                ? state?.workspace.repositories.find(
                    (repo) => !repo.kind && repo.gitIdentity === setting.repository?.gitIdentity,
                  )
                : undefined
            if (setting.repository && !repository && state) return null
            const rows = settingLayers(
              state?.defaults,
              repository,
              setting.field,
              active ? { scope: setting.scope, value: setting.value } : undefined,
            )
            return (
              <View key={entry.profile.id} style={{ gap: 6 }}>
                <Text>
                  {runtimeComputerName(entry)}
                  {active ? ' · editing' : ''}
                  {!entry.connected ? ' · offline, saved snapshot' : ''}
                </Text>
                {!state ? (
                  <Text style={styles.muted}>No snapshot available</Text>
                ) : (
                  <>
                    {rows.map((row) => (
                      <Text key={row.scope} style={styles.muted}>
                        {row.effective ? '✓ ' : ''}
                        {settingValueLabel(row.value)} · {settingsScopeLabels[row.scope]}
                        {active && row.scope === setting.scope ? ' · current draft' : ''}
                      </Text>
                    ))}
                    <Text style={styles.muted}>
                      {!rows.some((row) => row.effective) ? '✓ ' : ''}
                      {settingBaseLabel(setting.field)}
                    </Text>
                  </>
                )}
              </View>
            )
          })}
        </View>
      )}
      {overridden && onReset && (
        <Action
          secondary
          icon="reopen"
          label={`Use inherited ${label.toLowerCase()}`}
          disabled={disabled}
          onPress={onReset}
        />
      )}
    </View>
  )
}
