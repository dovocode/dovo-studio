import { supportsUtilities } from '@dovo/protocol'
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
import { useCallback, useEffect } from 'react'
import {
  titleGenerationSettingsSchema,
  modelCatalogSchema,
  useWorkspace,
  providers,
  providerSchema,
  type TitleGenerationSettings as Settings,
  type AgentDiscovery,
} from '@dovo/studio-core'
import { Button, ChoicePicker, FormField, ModelSettings, Input, Textarea } from '@dovo/studio-ui'
export function TitleSettings() {
  const { workspace, request, connected, snapshot } = useWorkspace()
  const installations = snapshot?.acpInstallations ?? []
  const [open, setOpen] = useApplicationState(false)
  const [settings, setSettings] = useApplicationState<Settings | null>(null)
  const [baseline, setBaseline] = useApplicationState<Settings | null>(null)
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [saved, setSaved] = useApplicationState(false)
  useEffect(() => {
    let stopped = false
    if (!open || !connected) return
    setSettings(null)
    setBaseline(null)
    setError('')
    void request('/api/agents/title-settings/read', {}, titleGenerationSettingsSchema)
      .then((value) => {
        if (!stopped) {
          setSettings(value)
          setBaseline(value)
        }
      })
      .catch((e) => {
        if (!stopped) setError(String(e))
      })
    return () => {
      stopped = true
    }
  }, [open, connected, request])
  const loadModels = useCallback(
    (agent: AgentDiscovery) => request('/api/agents/models', agent, modelCatalogSchema),
    [request],
  )
  const harness = settings
    ? resolveTitleHarness(settings, workspace.agents, configuredTaskHarness(snapshot?.defaults))
    : undefined
  return (
    <details className="mb-6 rounded-lg border p-4" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">Titles & dictation</summary>
      {open && (
        <div className="mt-4 max-w-xl space-y-3">
          <p className="text-xs text-muted-foreground">
            Generate task titles and lightly clean up mobile dictation with this harness, model and
            reasoning level. Dictation cleanup preserves wording, language and code names.
          </p>
          {!connected && (
            <p className="text-xs text-muted-foreground">
              Connect to the runtime to configure titles and dictation cleanup.
            </p>
          )}
          {settings && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!baseline) return
                setBusy(true)
                setError('')
                setSaved(false)
                void request(
                  '/api/agents/title-settings/save',
                  { before: baseline, after: settings },
                  titleGenerationSettingsSchema,
                )
                  .then((value) => {
                    setSettings(value)
                    setBaseline(value)
                    setSaved(true)
                  })
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false))
              }}
            >
              <fieldset disabled={busy || !connected} className="space-y-3">
                <FormField label="Title harness">
                  <ChoicePicker
                    aria-label="Title harness"
                    value={
                      settings.harness
                        ? settings.harness.provider === 'acp' && settings.harness.acpInstallationId
                          ? acpHarnessChoiceId(settings.harness.acpInstallationId)
                          : `harness:${settings.harness.provider}`
                        : settings.agentId
                    }
                    onValueChange={(agentId) => {
                      const installation = installations.find(
                        (item) => acpHarnessChoiceId(item.id) === agentId,
                      )
                      setSettings({
                        ...settings,
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
                      setSaved(false)
                    }}
                  >
                    <option value="">Default provider · separate model</option>
                    {providerSchema.literals.filter(supportsUtilities).map((provider) => (
                      <option key={provider} value={`harness:${provider}`}>
                        {providers[provider].short}
                      </option>
                    ))}
                    {installations.map((installation) => (
                      <option key={installation.id} value={acpHarnessChoiceId(installation.id)}>
                        {installation.name} · ACP
                      </option>
                    ))}
                    {workspace.agents
                      .filter((a) => supportsUtilities(a.provider))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} / {providers[a.provider].short}
                        </option>
                      ))}
                  </ChoicePicker>
                </FormField>
                {settings.harness && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Connection
                    </summary>
                    <div className="mt-3 grid gap-3">
                      <FormField label="Executable or server URL">
                        <Input
                          value={settings.harness.endpoint}
                          onChange={(e) => {
                            if (settings.harness)
                              setSettings({
                                ...settings,
                                harness: {
                                  ...settings.harness,
                                  endpoint: e.target.value,
                                },
                              })
                          }}
                          placeholder="Use runtime default"
                        />
                      </FormField>
                      {settings.harness.provider === 'acp' && (
                        <FormField label="Arguments (one per line)">
                          <Textarea
                            value={(settings.harness.args ?? []).join('\n')}
                            onChange={(e) => {
                              if (settings.harness)
                                setSettings({
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
                    onChange={(agent) => {
                      setSettings(titleSettingsForHarness(agent))
                      setSaved(false)
                    }}
                  />
                )}
                {harness && (
                  <ModelSettings
                    preferences={snapshot?.defaults?.modelPreferences}
                    modes={false}
                    agent={{
                      ...harness,
                      model: settings.model,
                      reasoning: settings.reasoning,
                    }}
                    onChange={(agent) => {
                      setSettings({
                        ...settings,
                        model: agent.model,
                        reasoning: agent.reasoning ?? '',
                      })
                      setSaved(false)
                    }}
                    loadModels={loadModels}
                    connected={connected}
                  />
                )}
                {!harness && (
                  <p className="text-xs text-destructive">
                    Configure or select an available harness.
                  </p>
                )}
                <Button type="submit" disabled={!harness}>
                  Save title settings
                </Button>
              </fieldset>
            </form>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-xs text-muted-foreground">
              Title settings saved.
            </p>
          )}
        </div>
      )}
    </details>
  )
}
