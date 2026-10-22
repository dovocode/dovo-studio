import { settingsChanges, supportsUtilities } from '@dovo/protocol'
import { configuredTaskHarness } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  acpHarnessChoiceId,
  acpInstallationHarness,
  decode,
  resolveTitleHarness,
  titleSettingsForHarness,
} from '@dovo/protocol'
import { AcpRegistry } from './acp-registry'
import { useCallback, useEffect, useRef } from 'react'
import {
  titleGenerationSettingsSchema,
  modelCatalogSchema,
  useWorkspace,
  useSettingsDraft,
  providers,
  providerSchema,
  type TitleGenerationSettings as Settings,
  type AgentDiscovery,
} from '@dovo/studio-core'
import {
  SettingsSaveBar,
  Button,
  ChoicePicker,
  FormField,
  ModelSettings,
  Input,
  Textarea,
} from '@dovo/studio-ui'
export function TitleSettings({ selection = false }: { selection?: boolean }) {
  const settingsPath = selection ? '/api/agents/selection-settings' : '/api/agents/title-settings'
  const { workspace, request, connected, snapshot } = useWorkspace()
  const installations = snapshot?.acpInstallations ?? []
  const [settings, setSettings] = useApplicationState<Settings | null>(null)
  const [baseline, setBaseline] = useApplicationState<Settings | null>(null)
  const [error, setError] = useApplicationState('')
  const [loadError, setLoadError] = useApplicationState('')
  const [reload, setReload] = useApplicationState(0)
  const [busy, setBusy] = useApplicationState(false)
  const [saved, setSaved] = useApplicationState(false)
  const form = useRef<HTMLFormElement>(null)
  const protectDraft = useRef(false)
  useEffect(() => {
    if (protectDraft.current) return
    let stopped = false
    if (!connected) return
    setSettings(null)
    setBaseline(null)
    setError('')
    setSaved(false)
    setLoadError('')
    void request(`${settingsPath}/read`, {}, titleGenerationSettingsSchema)
      .then((value) => {
        if (!stopped) {
          setSettings(value)
          setBaseline(value)
        }
      })
      .catch((e: unknown) => {
        if (!stopped) setLoadError(message(e))
      })
    return () => {
      stopped = true
    }
  }, [connected, request, reload, settingsPath])
  const loadModels = useCallback(
    (agent: AgentDiscovery) => request('/api/agents/models', agent, modelCatalogSchema),
    [request],
  )
  const harness = settings
    ? resolveTitleHarness(settings, workspace.agents, configuredTaskHarness(snapshot?.defaults))
    : undefined
  const unsupported = providerSchema.literals
    .filter((provider) => !supportsUtilities(provider))
    .map((provider) => providers[provider].short)
  const dirty = !!settings && JSON.stringify(settings) !== JSON.stringify(baseline)
  protectDraft.current = dirty
  useSettingsDraft(dirty, busy)
  const reloadSettings = () => {
    if (dirty && !window.confirm('Discard your unsaved edits and load the latest saved settings?'))
      return
    setBaseline(settings)
    setReload((value) => value + 1)
  }
  const edit = (next: Settings) => {
    setSettings(next)
    setSaved(false)
  }
  if (
    selection &&
    snapshot?.smartModelSelectionEnabled !== true &&
    snapshot?.autoProjectSelectionEnabled !== true
  )
    return null
  return (
    <section className="rounded-xl border">
      <header className="border-b p-4">
        <h2 className="text-sm font-semibold">
          {selection
            ? 'Model for Scope, Tune & Maestro selection (experimental)'
            : 'Model for titles & dictation'}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {selection
            ? 'Choose the utility model that selects projects, harnesses and coding models. By default it inherits the explicit title model.'
            : 'Choose an explicit harness and model for task titles and dictation cleanup.'}
        </p>
      </header>
      <div className="p-4">
        {!connected ? (
          <p role="status" className="text-xs text-muted-foreground">
            Connect to this computer to change titles and dictation.
          </p>
        ) : loadError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-xs text-destructive">
            <span>Title settings could not be loaded. {loadError}</span>
            <Button size="sm" variant="outline" onClick={reloadSettings}>
              Try again
            </Button>
          </div>
        ) : !settings ? (
          <p role="status" className="text-xs text-muted-foreground">
            Loading title settings…
          </p>
        ) : (
          <form
            ref={form}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!baseline) return
              setBusy(true)
              setError('')
              setSaved(false)
              void request(
                `${settingsPath}/save`,
                { before: baseline, after: settings },
                titleGenerationSettingsSchema,
              )
                .then((value) => {
                  setSettings(value)
                  setBaseline(value)
                  setSaved(true)
                })
                .catch((e: unknown) => setError(message(e)))
                .finally(() => setBusy(false))
            }}
          >
            <fieldset disabled={busy || !connected} className="min-w-0 space-y-4">
              <FormField layout="settings" label="Provider">
                <ChoicePicker
                  aria-label={
                    selection
                      ? 'Scope, Tune & Maestro selector harness'
                      : 'Titles & dictation provider'
                  }
                  value={
                    selection && settings.inheritTitleModel
                      ? 'title'
                      : settings.harness
                        ? settings.harness.provider === 'acp' && settings.harness.acpInstallationId
                          ? acpHarnessChoiceId(settings.harness.acpInstallationId)
                          : `harness:${settings.harness.provider}`
                        : settings.agentId
                  }
                  onValueChange={(agentId) => {
                    if (agentId === 'title') {
                      edit({ ...settings, inheritTitleModel: true })
                      return
                    }
                    const installation = installations.find(
                      (item) => acpHarnessChoiceId(item.id) === agentId,
                    )
                    edit({
                      ...settings,
                      inheritTitleModel: selection ? false : undefined,
                      agentId: installation || agentId.startsWith('harness:') ? '' : agentId,
                      harness: installation
                        ? acpInstallationHarness(installation)
                        : agentId.startsWith('harness:')
                          ? {
                              provider: decode(providerSchema, agentId.slice(8)),
                              endpoint: '',
                            }
                          : undefined,
                      model: '',
                      reasoning: '',
                    })
                  }}
                >
                  <option value="" disabled>
                    Choose a harness
                  </option>
                  {selection && <option value="title">Inherit title model</option>}
                  {providerSchema.literals.filter(supportsUtilities).map((provider) => (
                    <option key={provider} value={`harness:${provider}`}>
                      {providers[provider].short}
                    </option>
                  ))}
                  {installations.map((installation) => (
                    <option key={installation.id} value={acpHarnessChoiceId(installation.id)}>
                      {installation.name} · ACP agent
                    </option>
                  ))}
                  {workspace.agents
                    .filter((a) => supportsUtilities(a.provider))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {providers[a.provider].short} profile
                      </option>
                    ))}
                </ChoicePicker>
                <p className="font-normal leading-relaxed">
                  Choose a provider, an installed ACP agent or one of your agent profiles.{' '}
                  {unsupported.length > 0 && `${unsupported.join(', ')} cannot generate titles.`}
                </p>
              </FormField>
              {settings.harness && !(selection && settings.inheritTitleModel) && (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Connection (optional)
                  </summary>
                  <div className="mt-3 grid gap-3">
                    <FormField layout="settings" label="Executable or server URL">
                      <Input
                        value={settings.harness.endpoint}
                        onChange={(e) => {
                          if (settings.harness)
                            edit({
                              ...settings,
                              harness: {
                                ...settings.harness,
                                endpoint: e.target.value,
                              },
                            })
                        }}
                        placeholder="Use this computer’s default"
                      />
                    </FormField>
                    {settings.harness.provider === 'acp' && (
                      <FormField layout="settings" label="Arguments (one per line)">
                        <Textarea
                          value={(settings.harness.args ?? []).join('\n')}
                          onChange={(e) => {
                            if (settings.harness)
                              edit({
                                ...settings,
                                harness: {
                                  ...settings.harness,
                                  args: e.target.value.split('\n').filter(Boolean),
                                },
                              })
                          }}
                        />
                      </FormField>
                    )}
                  </div>
                </details>
              )}
              {harness?.provider === 'acp' && (
                <AcpRegistry
                  agent={{ ...harness, model: settings.model, reasoning: settings.reasoning }}
                  onChange={(agent) => edit(titleSettingsForHarness(agent))}
                />
              )}
              {selection && settings.inheritTitleModel ? (
                <p className="text-xs text-muted-foreground">
                  Uses the title harness and model. Choose a harness above to override it.
                </p>
              ) : harness ? (
                <ModelSettings
                  layout="settings"
                  preferences={snapshot?.defaults?.modelPreferences}
                  modes={false}
                  agent={{
                    ...harness,
                    model: settings.model,
                    reasoning: settings.reasoning,
                  }}
                  onChange={(agent) =>
                    edit({
                      ...settings,
                      model: agent.model,
                      reasoning: agent.reasoning ?? '',
                    })
                  }
                  loadModels={loadModels}
                  connected={connected}
                />
              ) : (
                <p role="alert" className="text-xs text-destructive">
                  The selected profile is no longer available. Choose another provider.
                </p>
              )}
              <SettingsSaveBar
                saveLabel={selection ? 'Save selection model' : 'Save title settings'}
                dirty={dirty}
                saving={busy}
                saved={saved}
                changes={settingsChanges(baseline ?? {}, settings)}
                saveError={error}
                readLatestChanges={async () =>
                  settingsChanges(
                    baseline ?? {},
                    await request(`${settingsPath}/read`, {}, titleGenerationSettingsSchema),
                  )
                }
                description="Changes apply to new tasks. Save to apply."
                disabled={
                  !connected ||
                  (!(selection && settings.inheritTitleModel) &&
                    (!harness ||
                      !settings.model.trim() ||
                      (!settings.harness && !settings.agentId)))
                }
                onDiscard={() => {
                  setSettings(baseline)
                  setError('')
                }}
                onSave={() => form.current?.requestSubmit()}
              />
            </fieldset>
          </form>
        )}
        {error && (
          <div
            role="alert"
            className="mt-3 flex flex-wrap items-center gap-3 text-xs text-destructive"
          >
            <span>{error}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !connected}
              onClick={reloadSettings}
            >
              Reload settings
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
