import {
  cuaActions,
  cuaActionDisabled,
  cuaHistorySummary,
  cuaActionResponse,
  cuaInstallHelp,
  type CuaCheck,
  type CuaAction,
} from '@dovo/protocol'
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
export function CommandSettings({ computerUse = false }: { computerUse?: boolean }) {
  const { request, connected } = useWorkspace()
  const [settings, setSettings] = useApplicationState<Settings | null>(null)
  const [baseline, setBaseline] = useApplicationState<Settings | null>(null)
  const [defaultShell, setDefaultShell] = useApplicationState('')
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const cuaGeneration = useRef(0)
  const [cua, setCua] = useApplicationState<CuaCheck | null>(null)
  const [output, setOutput] = useApplicationState('')
  const [saved, setSaved] = useApplicationState(false)
  useEffect(() => {
    let stopped = false
    const generation = ++cuaGeneration.current
    setSettings(null)
    setBaseline(null)
    setError('')
    setBusy(false)
    setCua(null)
    setOutput('')
    if (connected)
      void request('/api/commands/read', {}, commandSettingsResponse)
        .then((result) => {
          if (!stopped) {
            setSettings(result.settings)
            setBaseline(result.settings)
            setDefaultShell(result.defaultShell)
            if (computerUse)
              void request(
                '/api/commands/cua/check',
                { path: result.settings.cua },
                cuaCheckResponse,
              )
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
  }, [request, connected, computerUse])
  const change = (next: Settings) => {
    if (next.cua !== settings?.cua) {
      cuaGeneration.current++
      setCua(null)
      setOutput('')
    }
    setSettings(next)
    setSaved(false)
  }
  const runAction = (action: CuaAction) => {
    if (!settings) return
    const generation = ++cuaGeneration.current
    setBusy(true)
    setError('')
    setOutput('')
    void request('/api/commands/cua/action', { path: settings.cua, action }, cuaActionResponse)
      .then((result) => {
        if (generation !== cuaGeneration.current) return
        setOutput(result.output)
        setCua(result.check)
      })
      .catch((error) => {
        if (generation === cuaGeneration.current) setError(String(error))
      })
      .finally(() => {
        if (generation === cuaGeneration.current) setBusy(false)
      })
  }
  return (
    <article className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {computerUse
          ? 'Set up computer use on the selected runtime host. CuaDriver owns OS permissions; Dovo connects your agents through MCP.'
          : 'Runtime host defaults. Enter executable names or paths, without shell quoting. Agent overrides take precedence. Changes apply to new processes.'}
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
                after: computerUse
                  ? settings
                  : { ...settings, shellArgs: settings.shellArgs.filter(Boolean) },
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
            {commandFields
              .filter((field) => (computerUse ? field.id === 'cua' : field.id !== 'cua'))
              .map((field) => (
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
            {!computerUse && (
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
            )}
          </fieldset>
          {!computerUse && (
            <p className="text-xs text-muted-foreground">
              Automatic shell: {defaultShell}. Default argument: -l (login shell). Empty arguments
              use the shell’s normal interactive startup.
            </p>
          )}
          {computerUse && (
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
                Grants writable agents access to this computer’s desktop through Cua Driver.
                Read-only agents are excluded. The user and agents share the desktop and app state.
              </p>
              <p className="text-xs text-muted-foreground">
                Cua Driver is configured on this computer. Leave the path empty to detect it on PATH
                or in its standard installation folder. Changes apply to new agent turns.
              </p>
              {cua && (
                <div className="space-y-2 rounded-md border p-3 text-xs">
                  <p className="font-medium">1. Install on this computer</p>
                  <p>{cuaInstallHelp(cua.platform).prerequisites}</p>
                  <p>
                    Run the official installer below on the runtime host, then refresh status. It
                    downloads and installs CuaDriver; no Cua account is required.
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all select-text">
                    {cuaInstallHelp(cua.platform).commands}
                  </pre>
                  {cua.platform === 'linux' && (
                    <p>
                      On minimal systems install libxi6 and at-spi2-core. GNOME also needs Cua’s
                      bundled WinRects helper; see the installation guide.
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
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
                    if (computerUse)
                      void request(
                        '/api/commands/cua/check',
                        { path: settings.cua },
                        cuaCheckResponse,
                      )
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
              </div>
              {cua?.available && (
                <div className="space-y-3">
                  {(['setup', 'skills', 'history'] as const).map((group) => (
                    <section key={group} className="space-y-2 rounded-md border p-3">
                      <h3 className="text-sm font-medium">
                        {group === 'setup'
                          ? '2. Permissions & desktop access'
                          : group === 'skills'
                            ? '3. Agent MCP & skills'
                            : '4. Computer History (optional preview)'}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {group === 'setup'
                          ? 'Grant Accessibility and Screen Recording to CuaDriver on macOS and accept its relaunch. Test desktop access to list apps without changing them. Starting or stopping the shared daemon affects active computer-use sessions.'
                          : group === 'skills'
                            ? 'Save the computer-use switch to supply dovo_cua MCP automatically to new writable turns. No manual MCP registration is needed. Install the optional official skill pack for native agent skill discovery; installation links detected agents on this computer.'
                            : 'History is opt-in, encrypted and metadata-only. Enable may restart the daemon. Disable keeps recorded data; pause temporarily stops recording. Unsupported builds report an error. Data remains on the runtime host; View recent history retrieves up to 20 events here.'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {cuaActions
                          .filter(
                            (action) =>
                              action.group === group &&
                              (action.id !== 'permissions' || cua.platform === 'darwin') &&
                              (action.id !== 'start' || cua.platform !== 'linux'),
                          )
                          .map((action) => (
                            <Button
                              key={action.id}
                              type="button"
                              disabled={busy || !connected || cuaActionDisabled(action.id, cua)}
                              onClick={() => {
                                if (
                                  action.id === 'history-delete' &&
                                  !window.confirm(
                                    'Delete all recorded Computer History and its encryption key on this computer? This cannot be undone.',
                                  )
                                )
                                  return
                                runAction(action.id)
                              }}
                            >
                              {action.label}
                            </Button>
                          ))}
                      </div>
                      {group === 'skills' && cua.skills && (
                        <pre className="whitespace-pre-wrap break-all text-xs">{cua.skills}</pre>
                      )}
                      {group === 'history' && cua.history && (
                        <pre className="whitespace-pre-wrap break-all text-xs">
                          {cuaHistorySummary(cua)}
                        </pre>
                      )}
                    </section>
                  ))}
                </div>
              )}
              {output && (
                <pre
                  role="status"
                  className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border p-3 text-xs"
                >
                  {output}
                </pre>
              )}
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
          )}
          <Button type="submit" disabled={busy || !connected || !baseline}>
            {computerUse ? 'Save computer-use settings' : 'Save command settings'}
          </Button>
          {saved && (
            <p role="status" className="text-xs text-muted-foreground">
              {computerUse
                ? 'Computer-use settings saved. Applies to new turns.'
                : 'Command settings saved.'}
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
