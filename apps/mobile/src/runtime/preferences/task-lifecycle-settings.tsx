import { useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { router } from 'expo-router'
import {
  runtimePreferencesSchema,
  scopedSettingsResultSchema,
  taskBehaviorOrigin,
  settingsChangeCount,
  settingsChanges,
  validSettingsDays,
  type Repository,
  type SettingsScope,
  type TaskBehavior,
} from '@dovo/protocol'
import { useRuntime } from '../connection/provider'
import { useSettingsDraft } from './settings-target'
import { SettingSource } from './setting-source'
import { SettingsGroup } from '../../screens/settings-group'
import {
  SettingsChoice as Choice,
  SettingsField as Field,
  SettingsAction as Action,
} from '../../screens/settings-controls'
import { SettingsSaveBar } from '../../screens/settings-save-bar'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function TaskLifecycleSettings({
  scope,
  repository,
}: {
  scope: SettingsScope
  repository?: Repository
}) {
  const { connected, call, snapshot, activeId } = useRuntime()
  const { styles } = useTheme()
  const [loaded, setLoaded] = useState<typeof scopedSettingsResultSchema.Type | null>(null)
  const [behavior, setBehavior] = useState<TaskBehavior>({})
  const [archiveDays, setArchiveDays] = useState<number | null>(null)
  const [legacyBehavior, setLegacyBehavior] = useState<TaskBehavior>({})
  const [dayInputs, setDayInputs] = useState<
    Partial<Record<'inactiveDays' | 'archiveAfterSettledDays', string>>
  >({})
  const invalidDays = Object.values(dayInputs).some(
    (value) => value !== undefined && !validSettingsDays(value),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  const dirty =
    !!loaded && (invalidDays || settingsChangeCount(loaded.value.taskBehavior ?? {}, behavior) > 0)
  const protectDraft = useRef(false)
  const loadedTarget = useRef('')
  protectDraft.current = dirty
  useSettingsDraft(dirty, busy)
  useEffect(() => {
    const target = `${scope}:${repository?.id ?? ''}`
    if (protectDraft.current && loadedTarget.current === target) return
    let active = true
    setLoaded(null)
    setError('')
    if (connected) {
      void call('/api/runtime/preferences/read', {}, runtimePreferencesSchema)
        .then((value) => {
          if (active) {
            setArchiveDays(value.autoArchiveDays)
            setLegacyBehavior({
              continueAfterRestart: value.autoContinueAfterRestart,
              settleMerged: value.settleOnPullClose,
              settleClosed: value.settleOnPullClose,
            })
          }
        })
        .catch((cause: unknown) => {
          if (active) setError(String(cause))
        })
      void call(
        '/api/agents/settings/read',
        { scope, repositoryId: repository?.id },
        scopedSettingsResultSchema,
      )
        .then((value) => {
          if (!active) return
          loadedTarget.current = target
          setLoaded(value)
          setBehavior(value.value.taskBehavior ?? {})
          setDayInputs({})
          setSaved(false)
        })
        .catch((cause: unknown) => {
          if (active) setError(String(cause))
        })
    }
    return () => {
      active = false
    }
  }, [connected, call, scope, repository?.id, retry])
  const disabled = !connected || busy || !loaded || !snapshot?.taskBehaviorSupported
  const inheritedBehavior = loaded?.inherited.taskBehavior ?? {}
  const archivePolicy =
    archiveDays === null
      ? 'Computer policy · loading…'
      : archiveDays
        ? `Computer policy · ${archiveDays} days of inactivity`
        : 'Computer policy · Never'
  async function save() {
    if (!loaded || disabled || invalidDays) return
    setBusy(true)
    setError('')
    try {
      const value = await call(
        '/api/agents/settings/save',
        {
          scope,
          repositoryId: repository?.id,
          projectKey: loaded.projectKey,
          before: loaded.value,
          after: { ...loaded.value, taskBehavior: behavior },
        },
        scopedSettingsResultSchema,
      )
      setLoaded(value)
      setBehavior(value.value.taskBehavior ?? {})
      setDayInputs({})
      setSaved(true)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 20 }}>
      <Text style={styles.muted}>
        Project on computer overrides Project, then Computer, then shared defaults. Restart and PR
        settling fall back to computer defaults. Archiving uses the computer inactivity policy when
        no scoped rule is set.
      </Text>
      <Action
        secondary
        label="Open computer running-task defaults"
        onPress={() =>
          router.push({
            pathname: '/settings/task-behavior',
            params: { runtimeId: activeId ?? '' },
          })
        }
      />
      {!connected && (
        <Text style={styles.muted}>
          Offline · your unsaved edits are kept here. Reconnect to save.
        </Text>
      )}
      {!snapshot?.taskBehaviorSupported && (
        <Text style={styles.muted}>
          Update this computer’s runtime to configure scoped lifecycle settings.
        </Text>
      )}
      {snapshot?.taskBehaviorSupported && (
        <SettingsGroup title="Task lifecycle">
          <View style={{ padding: 16, gap: 12 }}>
            <Text style={styles.muted}>
              Applies to existing tasks too. Off overrides an inherited On.
            </Text>
            {(
              [
                ['quotaResume', 'Auto-resume limited tasks'],
                ['quotaSnooze', 'Snooze limited tasks'],
                ['settleMerged', 'Auto-settle merged tasks'],
                ['settleClosed', 'Auto-settle closed tasks'],
                ['settleInactive', 'Auto-settle inactive tasks'],
                ['autoArchiveSettled', 'Auto-archive settled tasks'],
                ['continueAfterRestart', 'Continue after restarts'],
              ] as const
            ).map(([key, label]) => (
              <View key={key} style={{ gap: 4 }}>
                <Choice
                  label={label}
                  value={behavior[key] === undefined ? 'inherit' : behavior[key] ? 'on' : 'off'}
                  disabled={
                    disabled || (key === 'autoArchiveSettled' && !snapshot?.threadBehaviorSupported)
                  }
                  items={[
                    {
                      id: 'inherit',
                      name:
                        key === 'autoArchiveSettled' && inheritedBehavior[key] === undefined
                          ? `Inherit (${archivePolicy})`
                          : `Inherit (${(inheritedBehavior[key] ?? legacyBehavior[key]) ? 'On' : 'Off'})`,
                    },
                    { id: 'on', name: 'On' },
                    { id: 'off', name: 'Off' },
                  ]}
                  onChange={(value) => {
                    setSaved(false)
                    setBehavior({
                      ...behavior,
                      [key]: value === 'inherit' ? undefined : value === 'on',
                    })
                  }}
                />
                <SettingSource
                  {...taskBehaviorOrigin(
                    snapshot?.defaults,
                    repository,
                    scope,
                    behavior,
                    key,
                    legacyBehavior[key] !== undefined || key === 'autoArchiveSettled',
                  )}
                  label={label}
                  setting={{
                    field: { group: 'taskBehavior', key },
                    repository,
                    scope,
                    value: behavior[key],
                    inheritedValue:
                      inheritedBehavior[key] ??
                      legacyBehavior[key] ??
                      (key === 'autoArchiveSettled' ? archivePolicy : false),
                  }}
                  disabled={disabled}
                  onReset={() => {
                    setBehavior({ ...behavior, [key]: undefined })
                    setSaved(false)
                  }}
                />
              </View>
            ))}
            <Field
              label="Days of inactivity before settling"
              value={dayInputs.inactiveDays ?? String(behavior.inactiveDays ?? '')}
              placeholder={`Inherit (${inheritedBehavior.inactiveDays ?? 3})`}
              editable={!disabled}
              keyboardType="number-pad"
              error={
                dayInputs.inactiveDays !== undefined && !validSettingsDays(dayInputs.inactiveDays)
                  ? 'Enter 1–365 days, or leave empty to inherit.'
                  : undefined
              }
              onChangeText={(value) => {
                setDayInputs((current) => ({ ...current, inactiveDays: value }))
                setSaved(false)
                if (validSettingsDays(value))
                  setBehavior({
                    ...behavior,
                    inactiveDays: value === '' ? undefined : Number(value),
                  })
              }}
            />
            <SettingSource
              {...taskBehaviorOrigin(
                snapshot?.defaults,
                repository,
                scope,
                behavior,
                'inactiveDays',
              )}
              setting={{
                field: { group: 'taskBehavior', key: 'inactiveDays' },
                repository,
                scope,
                value: behavior.inactiveDays,
                inheritedValue: inheritedBehavior.inactiveDays ?? 3,
              }}
              label="Days of inactivity before settling"
              disabled={disabled}
              onReset={() => {
                setBehavior({ ...behavior, inactiveDays: undefined })
                setDayInputs((current) => ({ ...current, inactiveDays: undefined }))
                setSaved(false)
              }}
            />
            <Text style={styles.muted}>
              Archive only after a task stays in Settled for this period. Reopening resets the
              clock.
            </Text>
            <Field
              label="Days in Settled before archiving"
              value={
                dayInputs.archiveAfterSettledDays ?? String(behavior.archiveAfterSettledDays ?? '')
              }
              placeholder={`Inherit (${inheritedBehavior.archiveAfterSettledDays ?? 7})`}
              editable={!disabled && !!snapshot?.threadBehaviorSupported}
              keyboardType="number-pad"
              error={
                dayInputs.archiveAfterSettledDays !== undefined &&
                !validSettingsDays(dayInputs.archiveAfterSettledDays)
                  ? 'Enter 1–365 days, or leave empty to inherit.'
                  : undefined
              }
              onChangeText={(value) => {
                setDayInputs((current) => ({ ...current, archiveAfterSettledDays: value }))
                setSaved(false)
                if (validSettingsDays(value))
                  setBehavior({
                    ...behavior,
                    archiveAfterSettledDays: value === '' ? undefined : Number(value),
                  })
              }}
            />
            <SettingSource
              {...taskBehaviorOrigin(
                snapshot?.defaults,
                repository,
                scope,
                behavior,
                'archiveAfterSettledDays',
              )}
              setting={{
                field: { group: 'taskBehavior', key: 'archiveAfterSettledDays' },
                repository,
                scope,
                value: behavior.archiveAfterSettledDays,
                inheritedValue: inheritedBehavior.archiveAfterSettledDays ?? 7,
              }}
              label="Days in Settled before archiving"
              disabled={disabled}
              onReset={() => {
                setBehavior({ ...behavior, archiveAfterSettledDays: undefined })
                setDayInputs((current) => ({ ...current, archiveAfterSettledDays: undefined }))
                setSaved(false)
              }}
            />
          </View>
        </SettingsGroup>
      )}

      {!!error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Action
            secondary
            label="Reload settings"
            disabled={!connected || busy}
            onPress={() => {
              const reload = () => {
                setLoaded(null)
                setRetry((value) => value + 1)
              }
              if (!dirty) reload()
              else
                Alert.alert(
                  'Discard unsaved edits?',
                  'Load the latest saved settings and discard your edits?',
                  [
                    { text: 'Keep editing', style: 'cancel' },
                    { text: 'Discard and reload', style: 'destructive', onPress: reload },
                  ],
                )
            }}
          />
        </>
      )}
      <SettingsSaveBar
        changes={settingsChanges(loaded?.value.taskBehavior ?? {}, {
          ...behavior,
          ...Object.fromEntries(
            Object.entries(dayInputs).filter(
              ([, value]) => value !== undefined && !validSettingsDays(value),
            ),
          ),
        })}
        saveError={error}
        readLatestChanges={async () =>
          settingsChanges(
            loaded?.value ?? {},
            (
              await call(
                '/api/agents/settings/read',
                { scope, repositoryId: repository?.id },
                scopedSettingsResultSchema,
              )
            ).value,
          )
        }
        dirty={dirty}
        saving={busy}
        disabled={disabled || invalidDays}
        saved={saved}
        changeCount={settingsChangeCount(loaded?.value.taskBehavior ?? {}, behavior)}
        onSave={() => void save()}
        onDiscard={() => {
          setBehavior(loaded?.value.taskBehavior ?? {})
          setDayInputs({})
          setError('')
          setSaved(false)
        }}
      />
    </View>
  )
}
