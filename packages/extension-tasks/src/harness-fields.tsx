import { decode } from '@dovo/protocol'
import { useCallback } from 'react'
import {
  providers,
  providerSchema,
  defaultTaskHarness,
  accessModes,
  supportsAccess,
  agentSchema,
  modelCatalogSchema,
  useWorkspace,
  type AgentDiscovery,
  type TaskHarness,
} from '@dovo/studio-core'
import { ChoicePicker, FormField, Input, Textarea, ModelSettings } from '@dovo/studio-ui'
export function HarnessFields({
  value,
  onChange,
  lockedProvider,
}: {
  value: TaskHarness
  lockedProvider?: TaskHarness['provider']
  onChange: (value: TaskHarness) => void
}) {
  const { request, connected } = useWorkspace()
  const load = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  return (
    <div className="grid gap-3">
      <FormField label="Harness">
        <ChoicePicker
          aria-label="Harness"
          value={value.provider}
          disabled={!!lockedProvider && value.provider === lockedProvider}
          onValueChange={(provider) => {
            const next = decode(providerSchema, provider)
            if (!lockedProvider || next === lockedProvider) onChange(defaultTaskHarness(next))
          }}
        >
          {providerSchema.literals
            .filter(
              (provider) =>
                !lockedProvider || provider === lockedProvider || provider === value.provider,
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
        </ChoicePicker>
      </FormField>
      {lockedProvider && (
        <p className="text-xs text-muted-foreground">
          The provider is fixed to {providers[lockedProvider].short} after the first message. Models
          and settings can still change.
        </p>
      )}
      <ModelSettings
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
          {accessModes.map((mode) => (
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
        {accessModes.find((mode) => mode.id === value.permission)?.description}
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
