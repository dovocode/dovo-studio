import { useEffect, useId, useState } from 'react'
import {
  harnessPluginHarnessNames,
  harnessPluginStateSchema,
  type InstalledHarnessPlugin,
  type ResourceSettings,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'

type Choice = 'inherit' | 'on' | 'off'

/**
 * Turns installed agent plugins on or off at the selected scope, such as an organization. Each
 * choice overrides earlier scopes by plugin; Inherit removes the choice at this scope.
 */
export function PluginActivations({
  settings,
  inherited,
  scopeLabel,
  disabled,
  change,
}: {
  settings: ResourceSettings
  inherited?: ResourceSettings
  scopeLabel: string
  disabled: boolean
  change: (update: (value: ResourceSettings) => ResourceSettings) => Promise<void>
}) {
  const { request, connected, snapshot } = useWorkspace()
  const supported = snapshot?.harnessPluginsSupported === true
  const [installed, setInstalled] = useState<InstalledHarnessPlugin[]>()
  const [error, setError] = useState('')
  const headingId = useId()
  useEffect(() => {
    if (!supported || !connected) return
    void request('/api/agents/plugins', { action: 'list' }, harnessPluginStateSchema).then(
      (state) => setInstalled(state.plugins),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    )
  }, [supported, connected, request])
  if (!supported) return null

  const here = new Map((settings.plugins ?? []).map((plugin) => [plugin.name, plugin.enabled]))
  const above = new Map((inherited?.plugins ?? []).map((plugin) => [plugin.name, plugin.enabled]))
  const missing = [...here.keys()].filter(
    (name) => !installed?.some((plugin) => plugin.id === name),
  )
  const choose = (name: string, choice: Choice) =>
    change((value) => ({
      ...value,
      // Always send the list, so an empty list removes the last choice at this scope.
      plugins: [
        ...(value.plugins ?? []).filter((plugin) => plugin.name !== name),
        ...(choice === 'inherit' ? [] : [{ name, enabled: choice === 'on' }]),
      ],
    })).catch(() => {
      /* The view shows save errors above the resource lists. */
    })

  return (
    <section aria-labelledby={headingId} className="min-w-0 border-b border-border/50 pb-3">
      <div className="py-3">
        <h3 id={headingId} className="text-sm font-medium">
          Agent plugins
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Turn installed Claude Code plugins on or off for {scopeLabel}. A choice here overrides the
          computer default and earlier levels. Install and review plugins in Studio extensions →
          Agent plugins.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {installed && !installed.length && !missing.length && (
        <p className="py-2 text-xs text-muted-foreground">No plugins installed on this computer.</p>
      )}
      <ul className="space-y-2">
        {installed?.map((plugin) => {
          const own = here.get(plugin.id)
          const effective = own ?? above.get(plugin.id) ?? plugin.enabled
          const source =
            own !== undefined ? 'set here' : above.has(plugin.id) ? 'inherited' : 'computer default'
          return (
            <li key={plugin.id} className="flex flex-wrap items-center gap-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {plugin.name} · {harnessPluginHarnessNames[plugin.harness]}
                </div>
                <div className="text-muted-foreground">
                  {plugin.harness === 'codex'
                    ? `${plugin.enabled ? 'On' : 'Off'} for the whole computer. Codex reads plugin settings only from its own configuration, so a project or organization cannot change it.`
                    : `${effective ? 'On' : 'Off'} (${source})`}
                </div>
              </div>
              {plugin.harness === 'claude' && (
                <select
                  aria-label={`${plugin.name} for ${scopeLabel}`}
                  className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                  disabled={disabled}
                  value={own === undefined ? 'inherit' : own ? 'on' : 'off'}
                  onChange={(event) => void choose(plugin.id, event.target.value as Choice)}
                >
                  <option value="inherit">Inherit</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              )}
            </li>
          )
        })}
        {missing.map((name) => (
          <li key={name} className="flex flex-wrap items-center gap-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{name.split('@')[0]}</div>
              <div className="text-muted-foreground">
                {here.get(name) ? 'On' : 'Off'} here, but not installed on this computer. It has no
                effect until you install it.
              </div>
            </div>
            <button
              type="button"
              className="rounded-md border px-2 py-1 disabled:opacity-50"
              disabled={disabled}
              onClick={() => void choose(name, 'inherit')}
            >
              Remove choice
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
