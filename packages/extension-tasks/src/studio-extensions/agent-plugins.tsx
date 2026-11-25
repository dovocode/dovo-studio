import { useEffect, useState } from 'react'
import { Button } from '@dovo/studio-ui'
import {
  harnessPluginCatalogSchema,
  harnessPluginHarnesses,
  harnessPluginHarnessNames,
  harnessPluginPreviewSchema,
  harnessPluginStateSchema,
  runtimeComputerName,
  type HarnessPluginCatalog,
  type HarnessPluginCommand,
  type HarnessPluginComponents,
  type HarnessPluginHarness,
  type HarnessPluginPreview,
  type HarnessPluginState,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import type { Schema } from 'effect'

const control = 'rounded-md border px-3 py-2 text-sm disabled:opacity-50'
const item = 'space-y-2 rounded-lg border bg-card p-4'
const short = (revision: string) => revision.slice(0, 7)

export function componentSummary(components: HarnessPluginComponents) {
  return [
    components.skills.length && `${components.skills.length} skills`,
    components.commands.length && `${components.commands.length} commands`,
    components.agents.length && `${components.agents.length} agents`,
    components.hooks && 'hooks',
    components.mcpServers.length && `${components.mcpServers.length} MCP servers`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** GitHub plugin marketplaces for Claude Code and Codex on the selected computer. */
export function AgentPlugins({ focus }: { focus?: string }) {
  const { request, connected, snapshot, runtimes, activeRuntimeId } = useWorkspace()
  const computer = runtimeComputerName({
    profile: runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile,
    snapshot,
  })
  const [state, setState] = useState<HarnessPluginState>()
  const [repository, setRepository] = useState('')
  const [ref, setRef] = useState('')
  const [catalog, setCatalog] = useState<HarnessPluginCatalog>()
  const [preview, setPreview] = useState<HarnessPluginPreview>()
  const [harness, setHarness] = useState<HarnessPluginHarness>('claude')
  const [everywhere, setEverywhere] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = <T extends Schema.Codec<unknown, unknown>>(
    command: HarnessPluginCommand,
    schema: T,
  ) => request('/api/agents/plugins', command, schema)
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const change = (command: HarnessPluginCommand) =>
    run(async () => setState(await send(command, harnessPluginStateSchema)))
  useEffect(() => {
    if (connected) void change({ action: 'list' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  const browse = (marketplaceId: string) =>
    run(async () => {
      setPreview(undefined)
      setCatalog(await send({ action: 'catalog', marketplaceId }, harnessPluginCatalogSchema))
    })
  const review = (marketplaceId: string, plugin: string) =>
    run(async () =>
      setPreview(
        await send({ action: 'preview', marketplaceId, plugin }, harnessPluginPreviewSchema),
      ),
    )

  return (
    <details className={item} open={focus === 'agent-plugins'} id="agent-plugins">
      <summary className="cursor-pointer font-medium">Agent plugins</summary>
      <p className="text-sm text-muted-foreground">
        Add a GitHub repository with a Claude Code or Codex plugin marketplace. Dovo reads its
        manifests without running them. Plugins you install can run commands, hooks and MCP servers
        inside the agent on {computer || 'this computer'}. Review each plugin before you install it.
      </p>
      {!connected && <p role="status">Computer offline.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void change({
            action: 'add-marketplace',
            repository,
            ...(ref.trim() ? { ref: ref.trim() } : {}),
          }).then(() => {
            setRepository('')
            setRef('')
          })
        }}
      >
        <input
          aria-label="GitHub repository"
          className={`${control} min-w-64 flex-1`}
          placeholder="owner/repo or https://github.com/owner/repo"
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
        />
        <input
          aria-label="Branch or tag"
          className={`${control} w-40`}
          placeholder="Branch or tag (optional)"
          value={ref}
          onChange={(event) => setRef(event.target.value)}
        />
        <button className={control} disabled={!connected || busy || !repository.trim()}>
          Add marketplace
        </button>
      </form>

      {state?.marketplaces.map((marketplace) => (
        <div key={marketplace.id} className="space-y-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{marketplace.name}</strong>
            <span className="text-muted-foreground">
              {marketplace.repository}
              {marketplace.ref ? ` @ ${marketplace.ref}` : ''} · revision{' '}
              {short(marketplace.revision)}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !connected}
                onClick={() =>
                  catalog?.marketplace.id === marketplace.id
                    ? setCatalog(undefined)
                    : void browse(marketplace.id)
                }
              >
                {catalog?.marketplace.id === marketplace.id ? 'Hide plugins' : 'Browse plugins'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !connected}
                onClick={() =>
                  void change({
                    action: 'refresh-marketplace',
                    marketplaceId: marketplace.id,
                  }).then(() => {
                    setCatalog(undefined)
                    setPreview(undefined)
                  })
                }
              >
                Check for updates
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !connected}
                onClick={() =>
                  void change({ action: 'remove-marketplace', marketplaceId: marketplace.id })
                }
              >
                Remove marketplace
              </Button>
            </span>
          </div>
          {catalog?.marketplace.id === marketplace.id && (
            <ul className="space-y-2" aria-label={`${marketplace.name} plugins`}>
              {catalog.plugins.map((plugin) => (
                <li key={plugin.name} className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {plugin.name}
                      {plugin.version ? ` ${plugin.version}` : ''}
                    </div>
                    {plugin.description && (
                      <div className="text-muted-foreground">{plugin.description}</div>
                    )}
                    {plugin.unsupported && (
                      <div className="text-muted-foreground">Unavailable: {plugin.unsupported}</div>
                    )}
                  </div>
                  {!plugin.unsupported && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !connected}
                      onClick={() => void review(marketplace.id, plugin.name)}
                    >
                      Review
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {preview && (
        <section
          className="space-y-2 rounded-md border border-primary p-3 text-sm"
          aria-label="Plugin review"
        >
          <h3 className="font-medium">
            Review {preview.plugin.name}
            {preview.plugin.version ? ` ${preview.plugin.version}` : ''}
          </h3>
          <p className="text-muted-foreground">
            From {preview.repository} at revision {short(preview.revision)}. Installing uses these
            exact files. {preview.files} files, {Math.ceil(preview.bytes / 1024)} KB.
          </p>
          <ul className="list-disc pl-5">
            <li>Skills: {preview.components.skills.join(', ') || 'none'}</li>
            <li>Commands: {preview.components.commands.join(', ') || 'none'}</li>
            <li>Agents: {preview.components.agents.join(', ') || 'none'}</li>
            <li>
              Hooks:{' '}
              {preview.components.hooks
                ? 'yes. Hooks run shell commands during agent work.'
                : 'none'}
            </li>
            <li>
              MCP servers:{' '}
              {preview.components.mcpServers.length
                ? `${preview.components.mcpServers.join(', ')}. These start processes or connect to services.`
                : 'none'}
            </li>
          </ul>
          <label className="flex flex-wrap items-center gap-2">
            Install for
            <select
              className={control}
              value={harness}
              onChange={(event) => setHarness(event.target.value === 'codex' ? 'codex' : 'claude')}
            >
              {harnessPluginHarnesses.map((id) => (
                <option key={id} value={id}>
                  {harnessPluginHarnessNames[id]}
                </option>
              ))}
            </select>
            on {computer || 'this computer'}
          </label>
          <p className="text-muted-foreground">
            {harness === 'claude'
              ? 'Claude Code threads started by Dovo load the plugin when it is on for their project. Your own Claude Code settings do not change.'
              : 'Dovo installs the plugin with Codex. Codex turns plugins on for the whole computer, including the Codex CLI there. It cannot limit a plugin to a project or organization.'}
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={everywhere}
              onChange={(event) => setEverywhere(event.target.checked)}
            />
            Turn on for all projects on this computer
          </label>
          {!everywhere && harness === 'claude' && (
            <p className="text-muted-foreground">
              The plugin stays off until you turn it on for a project or organization in MCP, skills
              &amp; hooks.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !connected}
              onClick={() =>
                void change({
                  action: 'install',
                  marketplaceId: preview.marketplaceId,
                  plugin: preview.plugin.name,
                  revision: preview.revision,
                  harness,
                  enabled: everywhere,
                }).then(() => setPreview(undefined))
              }
            >
              Install for {harnessPluginHarnessNames[harness]}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(undefined)}>
              Close review
            </Button>
          </div>
        </section>
      )}

      {!!state?.plugins.length && (
        <ul className="space-y-2" aria-label="Installed agent plugins">
          {state.plugins.map((plugin) => (
            <li
              key={plugin.id}
              className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {plugin.name}
                  {plugin.version ? ` ${plugin.version}` : ''} ·{' '}
                  {harnessPluginHarnessNames[plugin.harness]} ·{' '}
                  {plugin.enabled
                    ? 'on for all projects'
                    : plugin.harness === 'claude'
                      ? 'on only where a project or organization turns it on'
                      : 'off'}
                </div>
                <div className="text-muted-foreground">
                  {plugin.repository} · revision {short(plugin.revision)}
                  {componentSummary(plugin.components)
                    ? ` · ${componentSummary(plugin.components)}`
                    : ''}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !connected}
                onClick={() =>
                  void change({ action: 'set-enabled', id: plugin.id, enabled: !plugin.enabled })
                }
              >
                {plugin.enabled ? 'Turn off for all projects' : 'Turn on for all projects'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !connected}
                onClick={() => void change({ action: 'remove', id: plugin.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Changes apply to new agent sessions. Claude Code plugins do not load in sandboxed threads.
      </p>
    </details>
  )
}
