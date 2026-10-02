import { decode } from '@dovo/protocol'
import { useCallback } from 'react'
import {
  providers,
  providerSchema,
  defaultTaskHarness,
  acpInstallationHarness,
  acpHarnessChoiceId,
  selectableAccessModes,
  supportsAccess,
  agentSchema,
  modelCatalogSchema,
  useWorkspace,
  type AgentDiscovery,
  type TaskHarness,
  type Agent,
} from '@dovo/studio-core'
import { ChoicePicker } from './choice-picker'
import { FormField } from './components/form-field'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { ModelSettings } from './model-settings'
export function HarnessFields({
  value,
  onChange,
  lockedProvider,
  lockedInstallationId,
  agents = [],
  selectedAgentId,
  onSelectAgent,
}: {
  value: TaskHarness
  agents?: readonly Agent[]
  selectedAgentId?: string
  onSelectAgent?: (id: string) => void
  lockedProvider?: TaskHarness['provider']
  lockedInstallationId?: string
  onChange: (value: TaskHarness) => void
}) {
  const { request, connected, snapshot } = useWorkspace()
  const installations = snapshot?.acpInstallations ?? []
  const load = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  return (
    <div className="grid gap-3">
      <FormField label="Harness">
        <ChoicePicker
          aria-label="Harness"
          value={
            selectedAgentId
              ? `agent:${selectedAgentId}`
              : value.provider === 'acp' && value.acpInstallationId
                ? acpHarnessChoiceId(value.acpInstallationId)
                : value.provider
          }
          onValueChange={(provider) => {
            if (provider.startsWith('agent:') && onSelectAgent) {
              onSelectAgent(provider.slice(6))
              return
            }
            const installation = installations.find(
              (item) => acpHarnessChoiceId(item.id) === provider,
            )
            if (installation) {
              if (
                (!lockedProvider || lockedProvider === 'acp') &&
                (lockedInstallationId === undefined || lockedInstallationId === installation.id)
              )
                onChange(acpInstallationHarness(installation, value.permission))
              return
            }
            const next = decode(providerSchema, provider)
            if (
              (!lockedProvider || next === lockedProvider) &&
              (next !== 'acp' || lockedInstallationId === undefined || lockedInstallationId === '')
            )
              onChange({ ...defaultTaskHarness(next), permission: value.permission })
          }}
        >
          {providerSchema.literals
            .filter(
              (provider) =>
                (!lockedProvider || provider === lockedProvider || provider === value.provider) &&
                (provider !== 'acp' ||
                  lockedInstallationId === undefined ||
                  lockedInstallationId === ''),
            )
            .map((provider) => (
              <option
                key={provider}
                value={provider}
                disabled={!!lockedProvider && provider !== lockedProvider}
              >
                {providers[provider].short}
              </option>
            ))}
          {installations
            .filter(
              (installation) =>
                (!lockedProvider || lockedProvider === 'acp') &&
                (lockedInstallationId === undefined || lockedInstallationId === installation.id),
            )
            .map((installation) => (
              <option key={installation.id} value={acpHarnessChoiceId(installation.id)}>
                {installation.name} · ACP
              </option>
            ))}
          {onSelectAgent &&
            agents.map((agent) => (
              <option key={agent.id} value={`agent:${agent.id}`}>
                {agent.name}
              </option>
            ))}
        </ChoicePicker>
      </FormField>
      {lockedProvider && (
        <p className="text-xs text-muted-foreground">
          The provider is fixed to {providers[lockedProvider].short} after the first message. Models
          and settings can still change.
        </p>
      )}
      <ModelSettings
        preferences={snapshot?.defaults?.modelPreferences}
        agent={{
          ...value,
          id: 'task-harness',
          name: providers[value.provider].short,
        }}
        connected={connected}
        loadModels={load}
        onChange={(next) =>
          onChange({
            ...value,
            model: next.model,
            reasoning: next.reasoning,
            serviceTier: next.serviceTier,
            cyberAccessProgram: next.cyberAccessProgram,
            ...(next.provider === 'acp'
              ? {
                  acpInstallationId: next.acpInstallationId,
                  acpMode: next.acpMode,
                  acpConfig: next.acpConfig,
                }
              : {}),
          })
        }
      />
      <FormField label="Access">
        <ChoicePicker
          aria-label="Harness access"
          value={value.permission}
          onValueChange={(permission) =>
            onChange({
              ...value,
              permission: decode(agentSchema.fields.permission, permission),
            })
          }
        >
          {selectableAccessModes(value.permission).map((mode) => (
            <option
              key={mode.id}
              value={mode.id}
              disabled={!supportsAccess(value.provider, mode.id)}
            >
              {mode.name}
            </option>
          ))}
        </ChoicePicker>
      </FormField>
      <p className="text-xs text-muted-foreground">
        {
          selectableAccessModes(value.permission).find((mode) => mode.id === value.permission)
            ?.description
        }
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Connection and instructions
        </summary>
        <div className="mt-3 grid gap-3">
          {(value.provider !== 'acp' || !value.acpInstallationId) && (
            <FormField label={value.provider === 'opencode' ? 'Server URL' : 'Executable'}>
              <Input
                aria-label="Harness endpoint"
                value={value.endpoint}
                onChange={(e) =>
                  onChange({
                    ...value,
                    endpoint: e.target.value,
                  })
                }
                placeholder={
                  value.provider === 'opencode' ? 'http://127.0.0.1:4096' : 'Use runtime default'
                }
              />
            </FormField>
          )}
          {value.provider === 'acp' && !value.acpInstallationId && (
            <FormField label="Arguments (one per line)">
              <Textarea
                aria-label="Harness arguments"
                value={(value.args ?? []).join('\n')}
                onChange={(e) =>
                  onChange({
                    ...value,
                    args: e.target.value.split('\n').filter(Boolean),
                  })
                }
              />
            </FormField>
          )}
          <FormField label="Task instructions">
            <Textarea
              aria-label="Harness instructions"
              value={value.instructions}
              onChange={(e) =>
                onChange({
                  ...value,
                  instructions: e.target.value,
                })
              }
              placeholder="Optional instructions for this task"
            />
          </FormField>
        </div>
      </details>
    </div>
  )
}
