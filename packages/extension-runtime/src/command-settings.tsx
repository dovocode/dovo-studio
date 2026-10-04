import type { CuaCheck } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import {
  commandFields,
  commandSettingsResponse,
  cuaCheckResponse,
  useWorkspace,
  type CommandSettings as Settings,
} from '@dovo/studio-core'
import { Button, FormField, Input, Textarea, Toggle } from '@dovo/studio-ui'
export function CommandSettings() {
  const { request, connected } = useWorkspace()
  const [settings, setSettings] = useApplicationState<Settings | null>(null)
  const [baseline, setBaseline] = useApplicationState<Settings | null>(null)
  const [defaultShell, setDefaultShell] = useApplicationState('')
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const cuaGeneration = useRef(0)
  const [cua, setCua] = useApplicationState<CuaCheck | null>(null)
  const [saved, setSaved] = useApplicationState(false)
  useEffect(() => {
    let stopped = false
    const generation = ++cuaGeneration.current
    setSettings(null)
    setBaseline(null)
    setError('')
    setBusy(false)
    setCua(null)
    if (connected)
      void request('/api/commands/read', {}, commandSettingsResponse)
        .then((result) => {
          if (!stopped) {
            setSettings(result.settings)
            setBaseline(result.settings)
            setDefaultShell(result.defaultShell)
            void request('/api/commands/cua/check', { path: result.settings.cua }, cuaCheckResponse)
              .then((check) => {
                if (!stopped && generation === cuaGeneration.current) setCua(check)
              })
              .catch((error) => {
                if (!stopped && generation === cuaGeneration.current) setError(String(error))
              })
          }
        })
        .catch((error) => {
          if (!stopped) setError(String(error))
        })
    return () => {
      stopped = true
      cuaGeneration.current++
    }
  }, [request, connected])
  const change = (next: Settings) => {
    if (next.cua !== settings?.cua) {
      cuaGeneration.current++
      setCua(null)
    }
    setSettings(next)
    setSaved(false)
  }
  return (
    <article className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Runtime host defaults. Enter executable names or paths, without shell quoting. Agent
        overrides take precedence. Changes apply to new processes.
      </p>
      {settings && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!baseline) return
            setBusy(true)
            setError('')
            setSaved(false)
            void request(
              '/api/commands/save',
              {
                before: baseline,
                after: { ...settings, shellArgs: settings.shellArgs.filter(Boolean) },
              },
              commandSettingsResponse,
            )
              .then((result) => {
                setSettings(result.settings)
                setBaseline(result.settings)
                setSaved(true)
              })
              .catch((error) => setError(String(error)))
              .finally(() => setBusy(false))
          }}
        >
          <fieldset disabled={busy || !connected} className="grid gap-3 sm:grid-cols-2">
            {commandFields.map((field) => (
              <FormField key={field.id} label={field.label}>
                <Input
                  aria-label={field.label}
                  value={settings[field.id]}
                  placeholder={field.id === 'shell' ? defaultShell : field.placeholder}
                  onChange={(event) =>
                    change({
                      ...settings,
                      [field.id]: event.target.value,
                    })
                  }
                />
              </FormField>
            ))}
            <FormField label="Shell arguments (one per line)">
              <Textarea
                aria-label="Shell arguments"
                value={settings.shellArgs.join('\n')}
                onChange={(event) =>
                  change({
                    ...settings,
                    shellArgs: event.target.value.split('\n'),
                  })
                }
              />
            </FormField>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Automatic shell: {defaultShell}. Default argument: -l (login shell). Empty arguments use
            the shell’s normal interactive startup.
          </p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Toggle
                label="Enable agent computer use on this computer"
                checked={settings.cuaEnabled}
                disabled={busy || !connected}
                onChange={(checked) => change({ ...settings, cuaEnabled: checked })}
              />
              Enable agent computer use on this computer
            </label>
            <p className="text-xs text-muted-foreground">
              Grants writable agents access to this computer’s desktop through Cua Driver. Read-only
              agents are excluded. The user and agents share the desktop and app state.
            </p>
            <p className="text-xs text-muted-foreground">
              Cua Driver is configured on this computer. Leave the path empty to detect it on PATH
              or in its standard installation folder. Changes apply to new agent turns.
            </p>
            <a
              className="text-xs underline"
              href="https://cua.ai/docs/cua-driver/quickstart"
              target="_blank"
              rel="noreferrer"
            >
              Install and set up Cua Driver
            </a>
            <Button
              type="button"
              disabled={busy || !connected}
              onClick={() => {
                const generation = ++cuaGeneration.current
                setBusy(true)
                setError('')
                setCua(null)
                void request('/api/commands/cua/check', { path: settings.cua }, cuaCheckResponse)
                  .then((result) => {
                    if (generation === cuaGeneration.current) setCua(result)
                  })
                  .catch((error) => {
                    if (generation === cuaGeneration.current) setError(String(error))
                  })
                  .finally(() => {
                    if (generation === cuaGeneration.current) setBusy(false)
                  })
              }}
            >
              Detect / check Cua Driver
            </Button>
            {cua && (
              <div role="status" className="space-y-1 text-xs text-muted-foreground">
                <p>
                  {cua.available ? 'Cua Driver found' : 'Cua Driver unavailable'}
                  {cua.version ? ` · ${cua.version}` : ''}
                </p>
                {cua.path && <p className="break-all">{cua.path}</p>}
                <p>{cua.detail}</p>
                {cua.daemon && (
                  <pre className="whitespace-pre-wrap break-all">Daemon: {cua.daemon}</pre>
                )}
                {cua.permissions && (
                  <pre className="whitespace-pre-wrap break-all">
                    Permissions: {cua.permissions}
                  </pre>
                )}
                <p>
                  {cua.platform === 'darwin'
                    ? 'Grant Accessibility and Screen Recording to CuaDriver on this Mac, then restart its daemon.'
                    : cua.platform === 'win32'
                      ? 'Run Cua Driver in an interactive Windows desktop session.'
                      : 'Cua Driver needs a Linux desktop session. A WSL runtime checks Linux tools, not the Windows desktop.'}
                </p>
              </div>
            )}
          </div>
          <Button type="submit" disabled={busy || !connected || !baseline}>
            Save command settings
          </Button>
          {saved && (
            <p role="status" className="text-xs text-muted-foreground">
              Command settings saved.
            </p>
          )}
        </form>
      )}
      {!connected && (
        <p className="text-xs text-muted-foreground">Connect to configure the runtime host.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </article>
  )
}
