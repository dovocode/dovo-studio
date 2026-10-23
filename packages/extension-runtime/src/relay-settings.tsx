import { useState } from 'react'
import {
  customTurnSchema,
  decode,
  responses,
  runtimeConnectionModeSchema,
  RUNTIME_CONNECTION_MODES,
  runtimeConnectionModeDescription,
  type RuntimeConnectionMode,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, Input, Textarea, ChoicePicker } from '@dovo/studio-ui'

export function RelaySettings() {
  const { activeRuntimeId } = useWorkspace()
  return <RelaySettingsContent key={activeRuntimeId} />
}
function RelaySettingsContent() {
  const { snapshot, connected, request, runtimeRegistry, activeRuntimeId, refreshRuntime } =
    useWorkspace()
  const profile = runtimeRegistry.profiles.find((item) => item.id === activeRuntimeId)
  const status = snapshot?.relaySettings
  const [modeDraft, setModeDraft] = useState<RuntimeConnectionMode>()
  const [urls, setUrls] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState<'save' | 'reset'>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!profile) return null
  const mode = modeDraft ?? status?.connectionMode ?? 'automatic'
  const saveMode = async () => {
    setBusy(true)
    setError('')
    try {
      await request(
        '/api/runtime/connection-mode',
        { consent: true, mode },
        responses.relaySettings,
      )
      await refreshRuntime(profile)
      setModeDraft(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save connection mode')
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const config =
        confirm === 'reset'
          ? null
          : decode(customTurnSchema, {
              urls: urls
                .split(/[\n,]+/)
                .map((url) => url.trim())
                .filter(Boolean),
              username,
              credential: password,
            })
      await request('/api/runtime/relay', { consent: true, config }, responses.relaySettings)
      setPassword('')
      setUsername('')
      setUrls('')
      setConfirm(undefined)
      await refreshRuntime(profile)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save relay settings')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="space-y-2 rounded-md border p-3"
      aria-label={`TURN relay for ${profile.name}`}
    >
      <h2 className="text-sm font-medium">TURN relay</h2>
      {status?.connectionMode !== undefined && snapshot?.relaySetupSupported && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Connection mode</p>
          <ChoicePicker
            aria-label="Connection mode"
            value={mode}
            disabled={!connected || busy}
            onValueChange={(value) => setModeDraft(decode(runtimeConnectionModeSchema, value))}
          >
            {RUNTIME_CONNECTION_MODES.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </ChoicePicker>
          <p className="text-xs text-muted-foreground">
            {runtimeConnectionModeDescription(mode)} Existing connections stay open until they
            reconnect.
          </p>
          <Button
            disabled={!connected || busy || mode === status.connectionMode}
            onClick={() => void saveMode()}
          >
            {busy ? 'Saving…' : 'Apply connection mode'}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {status?.mode === 'organization'
          ? `Supplied by ${status.organization}${status.configured ? '' : ' · Relay unavailable or sign-in expired'}.`
          : status?.mode === 'custom'
            ? 'Custom TURN server configured.'
            : 'Automatic: use your organization relay when signed in, otherwise Dovo relay when authorized.'}{' '}
        {status?.connectionMode && status.connectionMode !== 'automatic'
          ? 'TURN is disabled by the connection mode.'
          : 'Direct connections are tried first.'}
      </p>
      {!!status?.urls.length && (
        <p className="break-all text-xs text-muted-foreground">{status.urls.join('\n')}</p>
      )}
      {!snapshot?.relaySetupSupported ? (
        <p className="text-xs text-muted-foreground">
          Use a separately paired device with an updated runtime to change relay settings.
        </p>
      ) : (
        <details className="space-y-2">
          <summary className="cursor-pointer text-xs font-medium">Custom TURN server</summary>
          <label className="block text-xs">
            TURN URLs (one per line or comma separated)
            <Textarea
              aria-label="TURN URLs"
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
              placeholder="turns:relay.example.com:5349?transport=tcp"
              disabled={busy}
            />
          </label>
          <label className="block text-xs">
            Username
            <Input
              aria-label="TURN username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label className="block text-xs">
            Password
            <Input
              aria-label="TURN password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          {confirm ? (
            <>
              <p role="alert" className="text-sm">
                {confirm === 'save'
                  ? `Use this TURN server for ${profile.name} and share relay credentials with its paired clients? This replaces the automatic relay policy.`
                  : `Restore automatic relay settings on ${profile.name}?`}
              </p>
              <Button disabled={!connected || busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Confirm relay settings'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirm(undefined)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={busy || !connected || !urls.trim() || !username || !password}
                onClick={() => setConfirm('save')}
              >
                Use custom TURN
              </Button>
              {status?.mode === 'custom' && (
                <Button
                  variant="ghost"
                  disabled={busy || !connected}
                  onClick={() => setConfirm('reset')}
                >
                  Use automatic relay
                </Button>
              )}
            </>
          )}
        </details>
      )}
      {!!error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
