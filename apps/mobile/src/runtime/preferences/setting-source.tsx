import { useState } from 'react'
import { useRuntime } from '../connection/provider'
import { useOptionalSettingsTarget } from './settings-target'
import {
  scopedSettingsResultSchema,
  settingBaseLabel,
  settingLayers,
  settingOverrides,
  settingValueLabel,
  runtimeComputerName,
  type Repository,
  type SettingField,
  type SettingOverride,
} from '@dovo/protocol'
import { Alert, View } from 'react-native'
import { settingsScopeLabels, type SettingsScope } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { useTheme } from '../../ui/theme'

const overrideName = (entry: SettingOverride) =>
  [entry.project, entry.computer].filter(Boolean).join(' on ')

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
  const [showOverrides, setShowOverrides] = useState(false)
  const [resetState, setResetState] = useState({ busy: false, message: '' })
  const { overviews, activeId, snapshot, connected, call, readRuntime } = useRuntime()
  const settingsTarget = useOptionalSettingsTarget()
  const { colors, styles } = useTheme()

  const name =
    source === 'built-in'
      ? 'Dovo default'
      : source === 'computer-default'
        ? 'Computer preference'
        : settingsScopeLabels[source]
  // Origin-only badges render outside scoped pages; only field badges read the fleet.
  const sources = setting
    ? overviews.map((entry) => ({
        profile: entry.profile,
        name: runtimeComputerName(entry),
        connected: entry.profile.id === activeId ? connected : entry.connected,
        snapshot: entry.profile.id === activeId ? snapshot : entry.snapshot,
      }))
    : []
  const overrides = setting
    ? settingOverrides(sources, setting.field, {
        scope: setting.scope,
        repository: setting.repository,
        environmentId:
          setting.scope === 'environment' || setting.scope === 'environment-project'
            ? (activeId ?? undefined)
            : undefined,
      })
    : []
  async function resetOverrides() {
    if (!setting) return
    setResetState({ busy: true, message: '' })
    const failures: string[] = []
    let done = 0
    for (const entry of overrides) {
      const owner = sources.find((candidate) => candidate.profile.id === entry.environmentId)
      const where = `${settingsScopeLabels[entry.scope]} · ${overrideName(entry)}`
      if (!owner?.connected) {
        failures.push(`${where}: ${owner?.name ?? 'computer'} is offline`)
        continue
      }
      const request = (path: string, input: unknown) =>
        owner.profile.id === activeId
          ? call(path, input, scopedSettingsResultSchema)
          : readRuntime(owner.profile, path, input, scopedSettingsResultSchema, 'POST')
      try {
        const scoped = { scope: entry.scope, repositoryId: entry.repositoryId }
        const current = await request('/api/agents/settings/read', scoped)
        const kept = Object.fromEntries(
          Object.entries(current.value[setting.field.group] ?? {}).filter(
            ([key]) => key !== setting.field.key,
          ),
        )
        await request('/api/agents/settings/save', {
          ...scoped,
          projectKey: current.projectKey,
          before: current.value,
          after: { ...current.value, [setting.field.group]: kept },
        })
        done++
      } catch (error) {
        failures.push(`${where}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    setResetState({
      busy: false,
      message: [done ? `Reset ${done} ${done === 1 ? 'override' : 'overrides'}.` : '', ...failures]
        .filter(Boolean)
        .join(' '),
    })
  }
  const confirmReset = () =>
    Alert.alert(
      'Reset later overrides',
      `Remove the ${label.toLowerCase()} override at ${overrides.length} later ${overrides.length === 1 ? 'level' : 'levels'}? They inherit the earlier value again.`,
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => void resetOverrides() },
      ],
    )
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
          { flex: 1, fontSize: 13, color: overridden ? colors.accent : colors.muted },
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
      {setting && overrides.length > 0 && (
        <Action
          secondary
          label={
            showOverrides
              ? 'Hide later overrides'
              : `${label}: overridden at ${overrides.length} later ${overrides.length === 1 ? 'level' : 'levels'}`
          }
          onPress={() => setShowOverrides(!showOverrides)}
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
      {showOverrides && setting && overrides.length > 0 && (
        <View style={{ width: '100%', gap: 8 }}>
          <Text style={[styles.muted, { fontSize: 13, lineHeight: 17 }]}>
            These levels keep their own value when {settingsScopeLabels[setting.scope]} changes.
            Open one to edit it, or reset them all to inherit again.
          </Text>
          {overrides.map((entry) => (
            <View
              key={`${entry.scope}:${entry.environmentId}:${entry.repositoryId ?? ''}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text>{settingValueLabel(entry.value)}</Text>
                <Text style={styles.muted}>
                  {settingsScopeLabels[entry.scope]} · {overrideName(entry)}
                </Text>
              </View>
              {settingsTarget && (
                <Action
                  secondary
                  label={`Open ${settingsScopeLabels[entry.scope]} settings for ${overrideName(entry)}`}
                  onPress={() => settingsTarget.setTarget(entry.target)}
                />
              )}
            </View>
          ))}
          <Action
            secondary
            label={
              resetState.busy ? 'Resetting…' : `Reset all later ${label.toLowerCase()} overrides`
            }
            disabled={disabled || resetState.busy}
            onPress={confirmReset}
          />
          {!!resetState.message && (
            <Text accessibilityRole="text" style={styles.muted}>
              {resetState.message}
            </Text>
          )}
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
