import { useEffect, useRef } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import {
  deviceHostSettingsResultSchema,
  deviceHostTestResultSchema,
  runtimeComputerName,
  type DeviceHostSettings as HostSettingsInput,
  type DeviceHostTestResult,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { useApplicationState } from '../runtime/state/application-state'
import { Switch } from '../ui/controls/switch'
import { Text } from '../ui/content/text'
import { ScreenHeader } from '../ui/layout/screen-header'
import { SettingsPage, useSettingsTheme } from './settings-theme'
import { SettingsGroup, SettingsRow } from './settings-group'
import { SettingsAction as Action, SettingsChoice as Choice } from './settings-controls'
import { DeviceHostEditor, type DeviceHostDraft } from './device-host-editor'
import {
  deviceHostDraft,
  deviceHostInput,
  deviceHostMessage,
  deviceHostSettingsInput,
} from './device-host-form'

type Settings = typeof deviceHostSettingsResultSchema.Type

export function DeviceHostSettings({
  onBusyChange,
  onDirtyChange,
}: {
  onBusyChange?: (busy: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { styles } = useSettingsTheme()
  const { profile, profiles, connected, read, call } = useRuntime()
  const [settings, setSettings] = useApplicationState<Settings | null>(null)
  const [draft, setDraft] = useApplicationState<DeviceHostDraft | null>(null)
  const [test, setTest] = useApplicationState<DeviceHostTestResult | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [loading, setLoading] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  const readinessGeneration = useRef(0)
  const selectedToken = profiles.find((entry) => entry.id === draft?.pairedProfileId)?.connection
    .token
  useEffect(() => {
    readinessGeneration.current++
    setTest(null)
  }, [selectedToken])
  const lock = useRef(false)
  const generation = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
    }
  }, [])
  useEffect(() => {
    onBusyChange?.(busy || loading)
  }, [busy, loading, onBusyChange])
  useEffect(() => {
    const version = ++generation.current
    setTest(null)
    setError('')
    if (!connected) {
      setLoading(false)
      return
    }
    setLoading(true)
    void read('/api/device-hosts', {}, deviceHostSettingsResultSchema, 'GET')
      .then((result) => {
        if (mounted.current && version === generation.current)
          setSettings((previous) =>
            mounted.current && version === generation.current ? result : previous,
          )
      })
      .catch((reason) => {
        if (mounted.current && version === generation.current)
          setError(
            deviceHostMessage(reason instanceof Error ? reason.message : String(reason), profiles),
          )
      })
      .finally(() => {
        if (mounted.current && version === generation.current) setLoading(false)
      })
    return () => {
      generation.current++
    }
  }, [read, connected, retry])
  useEffect(() => {
    onDirtyChange?.(draft !== null)
  }, [draft, onDirtyChange])
  const run = (work: (current: () => boolean) => Promise<void>) => {
    if (lock.current || !connected || loading) return
    lock.current = true
    const version = generation.current
    const current = () => mounted.current && version === generation.current
    setBusy(true)
    setError('')
    void work(current)
      .catch((reason) => {
        if (current())
          setError(
            deviceHostMessage(reason instanceof Error ? reason.message : String(reason), profiles),
          )
      })
      .finally(() => {
        lock.current = false
        if (mounted.current) setBusy(false)
      })
  }
  // Refuse to replace settings changed elsewhere since this screen last read them.
  const freshSettings = async (current: () => boolean) => {
    const fresh = await read('/api/device-hosts', {}, deviceHostSettingsResultSchema, 'GET')
    if (!current()) throw new Error('Connection changed. Try again.')
    if (JSON.stringify(fresh) !== JSON.stringify(settings)) {
      if (current()) {
        setSettings((previous) => (current() ? fresh : previous))
        setTest(null)
      }
      throw new Error(
        'Device hosts changed elsewhere. Your draft is preserved; review and test it again.',
      )
    }
    return fresh
  }
  const update = async (next: HostSettingsInput, current: () => boolean, preserveTest = false) => {
    if (!current()) return
    const result = await call('/api/device-hosts', next, deviceHostSettingsResultSchema)
    if (current()) {
      setSettings((previous) => (current() ? result : previous))
      if (!preserveTest) setTest(null)
    }
  }
  const disabled = busy || loading || !connected
  const destinations = profiles.filter((entry) => entry.id !== profile?.id)
  return (
    <View style={{ gap: 20 }}>
      <Text style={styles.muted}>
        Saved on {profile ? runtimeComputerName({ profile }) : 'the current runtime'}. Discover and
        control simulators and connected phones on other paired computers over SSH.
      </Text>
      {!connected && (
        <Text accessibilityRole="alert" style={styles.muted}>
          This computer is offline. Reconnect to load or save device hosts. Your draft is kept here.
        </Text>
      )}
      {loading && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Loading device hosts…
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!error && (
        <Action
          secondary
          label="Retry device host settings"
          disabled={disabled}
          onPress={() => setRetry((value) => value + 1)}
        />
      )}
      <SettingsGroup
        title="Device Hub"
        footer="Enable device discovery and controls on this runtime. Turning it off keeps saved hosts and leaves devices running."
      >
        <View style={styles.row}>
          <Text style={[styles.text, { flex: 1 }]}>Enable Device Hub</Text>
          <Switch
            accessibilityLabel="Enable Device Hub"
            value={settings?.enabled === true}
            disabled={disabled || !settings}
            onValueChange={(enabled) =>
              run(async (current) => {
                const fresh = await freshSettings(current)
                await update({ ...deviceHostSettingsInput(fresh), enabled }, current, true)
              })
            }
          />
        </View>
      </SettingsGroup>
      {settings?.enabled === true &&
        (draft ? (
          <DeviceHostEditor
            draft={draft}
            profiles={destinations}
            busy={disabled}
            ready={test?.ok === true}
            checks={test?.checks ?? []}
            onChange={(next) => {
              setDraft(next)
              setTest(null)
              setError('')
            }}
            onCancel={() => {
              setDraft(null)
              setTest(null)
              setError('')
            }}
            onTest={() =>
              run(async (current) => {
                setTest(null)
                const readinessVersion = readinessGeneration.current
                const input = deviceHostInput(
                  draft,
                  destinations,
                  settings?.hosts.find((host) => host.id === draft.id),
                )
                const result = await call(
                  '/api/device-hosts/test',
                  input,
                  deviceHostTestResultSchema,
                )
                if (current() && readinessVersion === readinessGeneration.current)
                  setTest({
                    ...result,
                    checks: result.checks.map((check) => ({
                      ...check,
                      message: deviceHostMessage(check.message, profiles),
                      name: deviceHostMessage(check.name, profiles),
                    })),
                  })
              })
            }
            onSave={() =>
              run(async (current) => {
                if (!test?.ok) return
                const fresh = await freshSettings(current)
                const host = deviceHostInput(
                  draft,
                  destinations,
                  fresh.hosts.find((entry) => entry.id === draft.id),
                )
                await update(
                  {
                    ...deviceHostSettingsInput(fresh),
                    hosts: [
                      ...fresh.hosts
                        .filter((entry) => entry.id !== host.id)
                        .map(({ hasToken: _hasToken, ...entry }) => entry),
                      host,
                    ],
                  },
                  current,
                )
                if (current()) setDraft(null)
              })
            }
          />
        ) : (
          settings && (
            <>
              <SettingsGroup
                title="Remote device hosts"
                footer="The destination requires an updated installed Dovo runtime and an existing pairing. SSH alone does not grant Dovo access."
              >
                {settings.hosts.map((host, index) => (
                  <SettingsRow
                    key={host.id}
                    title={host.name}
                    subtitle={`${host.sshUser}@${host.sshHost}:${host.sshPort} · ${host.agentAccess ? 'Agent access on' : 'Agent access off'}`}
                    icon="device"
                    last={index === settings.hosts.length - 1}
                    disabled={disabled}
                    onPress={() => {
                      setDraft(deviceHostDraft(host))
                      setTest(null)
                      setError('')
                    }}
                  />
                ))}
                {!settings.hosts.length && (
                  <View style={{ padding: 16 }}>
                    <Text style={styles.muted}>
                      No remote device hosts yet. Local devices remain available.
                    </Text>
                  </View>
                )}
              </SettingsGroup>
              <Action
                label="Add device host"
                disabled={disabled || settings.hosts.length >= 20}
                onPress={() => {
                  setDraft({
                    id: Crypto.randomUUID(),
                    name: '',
                    sshHost: '',
                    sshUser: '',
                    sshPort: '22',
                    identityFile: '',
                    runtimeAddress: '',
                    pairedProfileId: '',
                    hasToken: false,
                    agentAccess: false,
                  })
                  setTest(null)
                  setError('')
                }}
              />
              <Choice
                label="Default device host"
                value={settings.defaultHostId ?? ''}
                disabled={disabled}
                items={[
                  { id: '', name: 'Local runtime (no remote default)' },
                  ...settings.hosts.map((host) => ({ id: host.id, name: host.name })),
                ]}
                onChange={(defaultHostId) =>
                  run(async (current) => {
                    const fresh = await freshSettings(current)
                    await update(
                      {
                        ...deviceHostSettingsInput(fresh),
                        hosts: fresh.hosts.map(({ hasToken: _hasToken, ...host }) => host),
                        defaultHostId: defaultHostId || undefined,
                      },
                      current,
                    )
                  })
                }
              />
              <Text style={styles.muted}>
                Preselects this host in the desktop device picker. The mobile picker shows devices
                from all reachable hosts.
              </Text>
            </>
          )
        ))}
      {settings?.enabled === true &&
        draft &&
        settings?.hosts.some((host) => host.id === draft.id) && (
          <Action
            secondary
            label="Remove device host"
            disabled={disabled}
            onPress={() =>
              Alert.alert(
                'Remove device host?',
                'This removes the SSH device host configuration from this runtime. The destination pairing and its devices remain intact.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () =>
                      run(async (current) => {
                        const fresh = await freshSettings(current)
                        await update(
                          {
                            ...deviceHostSettingsInput(fresh),
                            hosts: fresh.hosts
                              .filter((host) => host.id !== draft.id)
                              .map(({ hasToken: _hasToken, ...host }) => host),
                            defaultHostId:
                              fresh.defaultHostId === draft.id ? undefined : fresh.defaultHostId,
                          },
                          current,
                        )
                        if (current()) setDraft(null)
                      }),
                  },
                ],
              )
            }
          />
        )}
    </View>
  )
}

export default function DeviceHostsScreen() {
  const { styles } = useSettingsTheme()
  const { profile } = useRuntime()
  return (
    <SettingsPage>
      <ScreenHeader title="Device previews" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {profile ? (
          <DeviceHostSettings key={profile.id} />
        ) : (
          <Text style={styles.muted}>Pair a computer to configure its device hosts.</Text>
        )}
      </ScrollView>
    </SettingsPage>
  )
}
