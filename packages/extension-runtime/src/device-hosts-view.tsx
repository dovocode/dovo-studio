import { useEffect, useRef } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { useSettingsDraft, useWorkspace } from '@dovo/studio-core'
import {
  randomUUID,
  deviceHostSettingsResultSchema,
  deviceHostTestResultSchema,
  type DeviceHost,
} from '@dovo/protocol'
import {
  Button,
  ChoicePicker,
  FormField,
  Input,
  SettingRow,
  SettingsGroup,
  Toggle,
} from '@dovo/studio-ui'
import { HostPage } from './host-page'

export default function DeviceHostsView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Device previews"
      description="Use simulators and phones on this computer or another paired computer over SSH."
    >
      <DeviceHostSettings />
    </HostPage>
  )
}

function DeviceHostSettings() {
  const { request, connected, runtimes, connection } = useWorkspace()
  const [settings, setSettings] = useApplicationState<
    typeof deviceHostSettingsResultSchema.Type | null
  >(null)
  const [draft, setDraft] = useApplicationState<DeviceHost | null>(null)
  const [pairedId, setPairedId] = useApplicationState('')
  const [result, setResult] = useApplicationState<typeof deviceHostTestResultSchema.Type | null>(
    null,
  )
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  const generation = useRef(0)
  const lock = useRef(false)
  useSettingsDraft(draft !== null, busy)
  useEffect(() => {
    const current = ++generation.current
    setSettings(null)
    setDraft(null)
    setResult(null)
    setError('')
    setBusy(false)
    lock.current = false
    if (connected)
      void request('/api/device-hosts', {}, deviceHostSettingsResultSchema, 'GET')
        .then((value) => {
          if (current === generation.current) setSettings(value)
        })
        .catch((failure) => {
          if (current === generation.current) setError(String(failure))
        })
    return () => {
      generation.current++
    }
  }, [request, connected, retry, setSettings, setDraft, setResult, setError, setBusy])
  const act = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    const current = generation.current
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (failure) {
      if (current === generation.current) setError(String(failure))
    } finally {
      if (current === generation.current) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  const change = (update: Partial<DeviceHost>) => {
    if (draft) {
      setDraft({ ...draft, ...update })
      setResult(null)
    }
  }
  const destinations = runtimes.filter(
    (entry) => entry.profile.connection.address !== connection?.address,
  )
  const keepsPairing = (value: DeviceHost) =>
    settings?.hosts.some(
      (host) =>
        host.id === value.id &&
        host.hasToken &&
        host.sshHost === value.sshHost &&
        host.sshUser === value.sshUser &&
        host.sshPort === value.sshPort &&
        host.runtimeAddress === value.runtimeAddress,
    ) ?? false
  const candidate = () => {
    if (!draft) throw new Error('Choose a device host.')
    const profile = destinations.find((entry) => entry.profile.id === pairedId)?.profile
    if (!profile && !keepsPairing(draft))
      throw new Error('Connection changed. Choose a paired destination before testing or saving.')
    return { ...draft, ...(profile ? { token: profile.connection.token } : {}) }
  }
  const updateSettings = async (value: {
    enabled?: boolean
    hosts: DeviceHost[]
    defaultHostId?: string
  }) => {
    const current = generation.current
    const next = await request(
      '/api/device-hosts',
      {
        ...value,
        enabled: value.enabled ?? settings?.enabled ?? false,
        revision: settings?.revision ?? 0,
      },
      deviceHostSettingsResultSchema,
    )
    if (current === generation.current) setSettings(next)
  }
  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Device Hub"
        description="Optional device previews and controls on this runtime. Off by default."
      >
        <SettingRow
          label="Enable Device Hub"
          description="Discover simulators and phones, open live previews, and use configured SSH device hosts. Turning this off closes previews and forwarding helpers while devices keep running."
        >
          <Toggle
            label="Enable Device Hub"
            checked={settings?.enabled ?? false}
            disabled={!settings || busy || !!draft}
            onChange={(enabled) => {
              if (settings) void act(() => updateSettings({ ...settings, enabled }))
            }}
          />
        </SettingRow>
      </SettingsGroup>
      {settings?.enabled && (
        <>
          <SettingsGroup
            title="Device hosts"
            description="SSH commands run from this computer. Key paths and SSH aliases belong to this computer, even when you configure them from your phone."
          >
            <SettingRow
              label="This computer"
              description="Local simulators and connected phones remain available without SSH."
            >
              <span className="text-xs text-muted-foreground">Local</span>
            </SettingRow>
            {settings?.hosts.map((host) => (
              <SettingRow
                key={host.id}
                label={host.name}
                description={`${host.sshUser}@${host.sshHost}:${host.sshPort} · ${host.agentAccess ? 'Agent access allowed' : 'Agent access off'}${host.hasToken ? '' : ' · Pairing missing'}`}
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !!draft}
                    onClick={() => {
                      setDraft({ ...host })
                      setPairedId(
                        destinations.find(
                          (entry) => entry.profile.connection.address === host.runtimeAddress,
                        )?.profile.id ?? '',
                      )
                      setResult(null)
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !!draft}
                    onClick={() =>
                      void act(async () => {
                        const current = generation.current
                        const check = await request(
                          '/api/device-hosts/test',
                          host,
                          deviceHostTestResultSchema,
                        )
                        if (current === generation.current) setResult(check)
                      })
                    }
                  >
                    Test connection
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !!draft}
                    onClick={() => {
                      if (window.confirm(`Remove ${host.name}? Its devices will keep running.`))
                        void act(() =>
                          updateSettings({
                            hosts: settings.hosts.filter((entry) => entry.id !== host.id),
                            ...(settings.defaultHostId && settings.defaultHostId !== host.id
                              ? { defaultHostId: settings.defaultHostId }
                              : {}),
                          }),
                        )
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </SettingRow>
            ))}
            <SettingRow
              label="Add a remote computer"
              description="Pair the destination in Devices & runtime first. Dovo must be running there."
            >
              <Button
                size="sm"
                disabled={busy || !!draft || !settings || settings.hosts.length >= 20}
                onClick={() => {
                  setDraft({
                    id: randomUUID(),
                    name: '',
                    sshHost: '',
                    sshUser: '',
                    sshPort: 22,
                    runtimeAddress: '',
                    agentAccess: false,
                  })
                  setPairedId('')
                  setResult(null)
                }}
              >
                Add device host
              </Button>
            </SettingRow>
          </SettingsGroup>
          {settings && (
            <SettingsGroup
              title="Default device host"
              description="Choose which computer is preferred when opening the device picker. You can still select devices on other hosts."
            >
              <SettingRow label="Preferred computer">
                <ChoicePicker
                  aria-label="Default device host"
                  disabled={busy || !!draft}
                  value={settings.defaultHostId ?? ''}
                  onValueChange={(id) =>
                    void act(() =>
                      updateSettings({
                        hosts: settings.hosts,
                        ...(id ? { defaultHostId: id } : {}),
                      }),
                    )
                  }
                >
                  <option value="">This computer</option>
                  {settings.hosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name}
                    </option>
                  ))}
                </ChoicePicker>
              </SettingRow>
            </SettingsGroup>
          )}
          {draft && (
            <form
              className="space-y-4 rounded-lg border bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault()
                void act(async () => {
                  if (!settings) return
                  const host = candidate()
                  const current = generation.current
                  await updateSettings({
                    ...settings,
                    hosts: [...settings.hosts.filter((entry) => entry.id !== host.id), host],
                  })
                  if (current === generation.current) {
                    setDraft(null)
                    setResult(null)
                  }
                })
              }}
            >
              <h2 className="text-sm font-semibold">
                {settings?.hosts.some((host) => host.id === draft.id)
                  ? 'Edit device host'
                  : 'Add device host'}
              </h2>
              <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
                <FormField label="Name">
                  <Input
                    required
                    value={draft.name}
                    maxLength={100}
                    onChange={(event) => change({ name: event.target.value })}
                    placeholder="Mac mini"
                  />
                </FormField>
                <FormField label="Paired destination">
                  <ChoicePicker
                    aria-label="Paired destination"
                    value={pairedId}
                    onValueChange={(id) => {
                      const profile = destinations.find((entry) => entry.profile.id === id)?.profile
                      setPairedId(id)
                      if (profile)
                        change({
                          runtimeAddress: profile.connection.address,
                          name: draft.name || profile.name,
                          sshHost:
                            draft.sshHost ||
                            new URL(profile.connection.address).hostname.replace(/^\[|\]$/g, ''),
                        })
                    }}
                  >
                    <option value="">Choose a paired computer</option>
                    {destinations.map((entry) => (
                      <option key={entry.profile.id} value={entry.profile.id}>
                        {entry.profile.name}
                      </option>
                    ))}
                  </ChoicePicker>
                </FormField>
                <FormField label="SSH host or alias">
                  <Input
                    required
                    value={draft.sshHost}
                    onChange={(event) => change({ sshHost: event.target.value })}
                    placeholder="mac-mini"
                  />
                </FormField>
                <FormField label="SSH user">
                  <Input
                    required
                    value={draft.sshUser}
                    onChange={(event) => change({ sshUser: event.target.value })}
                    placeholder="dominic"
                  />
                </FormField>
                <FormField label="SSH port">
                  <Input
                    required
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.sshPort}
                    onChange={(event) => change({ sshPort: Number(event.target.value) })}
                  />
                </FormField>
                <FormField label="SSH key path (optional)">
                  <Input
                    value={draft.identityFile ?? ''}
                    onChange={(event) => change({ identityFile: event.target.value || undefined })}
                    placeholder="Use SSH agent or ~/.ssh/config"
                  />
                </FormField>
                <FormField label="Destination runtime address">
                  <Input
                    required
                    value={draft.runtimeAddress}
                    onChange={(event) => change({ runtimeAddress: event.target.value })}
                    placeholder="http://127.0.0.1:3001"
                  />
                </FormField>
              </fieldset>
              <p className="text-xs text-muted-foreground">
                The address is reached from the SSH host. Select a paired destination to authorize
                access; its token is stored privately on this computer. SSH uses keys and verified
                host keys. No passwords or private key uploads.
              </p>
              <SettingRow
                label="Allow agents to use this host"
                description="Make this host available through agent device tools in threads on this computer."
              >
                <Toggle
                  label="Allow agents to use this host"
                  checked={draft.agentAccess}
                  disabled={busy}
                  onChange={(value) => change({ agentAccess: value })}
                />
              </SettingRow>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !draft.sshHost || !draft.sshUser || !draft.runtimeAddress}
                  onClick={() =>
                    void act(async () => {
                      const current = generation.current
                      const check = await request(
                        '/api/device-hosts/test',
                        candidate(),
                        deviceHostTestResultSchema,
                      )
                      if (current === generation.current) setResult(check)
                    })
                  }
                >
                  {busy ? 'Working…' : 'Test connection'}
                </Button>
                <Button type="submit" disabled={busy || (!pairedId && !keepsPairing(draft))}>
                  Save host
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null)
                    setResult(null)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {result && (
            <SettingsGroup title={result.ok ? 'Connection ready' : 'Setup needs attention'}>
              {result.checks.map((check, index) => (
                <SettingRow
                  key={`${check.name}:${index}`}
                  label={check.name}
                  description={check.message}
                >
                  <span
                    className={
                      check.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'
                    }
                  >
                    {check.ok ? 'Ready' : 'Check setup'}
                  </span>
                </SettingRow>
              ))}
            </SettingsGroup>
          )}
        </>
      )}
      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">{error}</p>
          {settings && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (!draft || window.confirm('Discard the draft and reload device settings?'))
                  setRetry((value) => value + 1)
              }}
            >
              Reload settings
            </Button>
          )}
          {!settings && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {!settings && !error && connected && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading device hosts…
        </p>
      )}
    </div>
  )
}
