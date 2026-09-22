import { ChoicePicker } from './choice-picker'
import { useEffect, useState } from 'react'
import {
  agentSchema,
  daybreakChoices,
  modelServiceTiers,
  selectedCatalogModel,
  serviceTierValue,
  type ModelCatalog,
  type Agent,
  type AgentDiscovery,
} from '@dovo/protocol'
import { Button } from './components/ui/button'
import { FormField } from './components/form-field'
import { Input } from './components/ui/input'
export function ModelSettings({
  agent,
  onChange,
  loadModels,
  connected,
  modes = true,
}: {
  agent: Agent
  onChange: (agent: Agent) => void
  loadModels: (agent: AgentDiscovery) => Promise<ModelCatalog>
  connected: boolean
  modes?: boolean
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [custom, setCustom] = useState(false)
  const key = JSON.stringify({
    provider: agent.provider,
    endpoint: agent.endpoint,
    args: agent.args,
    model: agent.provider === 'acp' ? agent.model : '',
  })
  useEffect(() => {
    let stopped = false
    setCatalog(null)
    setError('')
    setLoading(connected)
    if (!connected) return
    const timer = setTimeout(() => {
      void loadModels(JSON.parse(key))
        .then((value) => {
          if (!stopped) setCatalog(value)
        })
        .catch((error) => {
          if (!stopped) setError(String(error))
        })
        .finally(() => {
          if (!stopped) setLoading(false)
        })
    }, 400)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [key, connected, loadModels, refresh])
  const models = catalog?.models ?? [],
    selected = selectedCatalogModel(catalog, agent.model)
  const efforts =
    selected?.reasoning ??
    (!agent.model || agent.provider === 'acp' ? catalog?.reasoning : []) ??
    []
  const changeModel = (model: string) =>
    onChange({
      ...agent,
      model,
      reasoning: model === agent.model ? agent.reasoning : '',
      serviceTier: model === agent.model ? agent.serviceTier : undefined,
      cyberAccessProgram: model === agent.model ? agent.cyberAccessProgram : undefined,
    })
  return (
    <div className="grid gap-3">
      <FormField label="Model">
        <ChoicePicker
          aria-label="Model"
          className="h-9 rounded-md border bg-background px-2 text-xs"
          value={custom ? '__custom__' : agent.model}
          onValueChange={(selection) => {
            const value = selection
            setCustom(value === '__custom__')
            if (value !== '__custom__') changeModel(value)
          }}
        >
          <option value="">Provider default</option>
          {agent.model && !selected && (
            <option value={agent.model}>{agent.model} (saved/custom)</option>
          )}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
          <option value="__custom__">Custom model…</option>
        </ChoicePicker>
      </FormField>
      {(custom || (!!agent.model && !selected)) && (
        <Input
          aria-label="Custom model ID"
          placeholder={agent.provider === 'opencode' ? 'provider/model' : 'Model ID'}
          value={agent.model}
          onChange={(event) => changeModel(event.target.value)}
        />
      )}
      <FormField
        label={agent.provider === 'opencode' ? 'Reasoning / model variant' : 'Reasoning level'}
      >
        <ChoicePicker
          aria-label="Reasoning level"
          className="h-9 rounded-md border bg-background px-2 text-xs"
          value={agent.reasoning ?? ''}
          onValueChange={(selection) => onChange({ ...agent, reasoning: selection })}
        >
          <option value="">Provider default</option>
          {agent.reasoning && !efforts.some((e) => e.id === agent.reasoning) && (
            <option value={agent.reasoning}>{agent.reasoning} (saved)</option>
          )}
          {efforts.map((effort) => (
            <option key={effort.id} value={effort.id}>
              {effort.name}
            </option>
          ))}
        </ChoicePicker>
      </FormField>
      {modes && agent.provider === 'codex' && (
        <>
          <FormField label="Speed">
            <ChoicePicker
              aria-label="Service tier"
              value={serviceTierValue(agent.serviceTier)}
              onValueChange={(serviceTier) => onChange({ ...agent, serviceTier })}
            >
              {modelServiceTiers(catalog, agent.model, agent.serviceTier).map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
            </ChoicePicker>
          </FormField>
          <p className="text-xs text-muted-foreground">
            {catalog?.codex?.fastModeBlocked
              ? 'Fast mode is disabled by the runtime’s managed policy.'
              : modelServiceTiers(catalog, agent.model, agent.serviceTier).find(
                  (tier) => tier.id === serviceTierValue(agent.serviceTier),
                )?.description}
          </p>
          <FormField label="Daybreak">
            <ChoicePicker
              aria-label="Daybreak mode"
              value={agent.cyberAccessProgram ?? ''}
              onValueChange={(program) =>
                onChange({
                  ...agent,
                  cyberAccessProgram: program
                    ? agentSchema.shape.cyberAccessProgram.parse(program)
                    : undefined,
                })
              }
            >
              {daybreakChoices(catalog, agent.cyberAccessProgram).map((choice) => (
                <option
                  key={choice.id}
                  value={choice.id}
                  disabled={
                    choice.id !== '' &&
                    choice.id !== 'standard' &&
                    !catalog?.codex?.daybreakPrograms.some((program) => program === choice.id)
                  }
                >
                  {choice.name}
                </option>
              ))}
            </ChoicePicker>
          </FormField>
          <p className="text-xs text-muted-foreground">
            {catalog?.codex?.daybreakPrograms.length
              ? 'Authorized cybersecurity mode for each turn. Codex checks account and model access. Auto review is recommended; your access setting stays unchanged.'
              : 'Daybreak requires an eligible ChatGPT account and an updated Codex harness. Available programs appear after model discovery.'}
          </p>
        </>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {loading
            ? 'Loading provider models…'
            : !connected
              ? 'Connect to discover models and reasoning levels.'
              : !efforts.length
                ? 'Select a model that advertises reasoning options.'
                : selected?.description}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!connected || loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh models
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error} Custom model entry is still available.
        </p>
      )}
    </div>
  )
}
