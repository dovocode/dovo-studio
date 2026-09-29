import { useAppPreferences, updateAppPreferences } from '@dovo/studio-core'
import { ChoicePicker, Button } from '@dovo/studio-ui'
import { useApplicationState } from '@dovo/studio-core/state'
import { runtimeDefaultsSchema } from '@dovo/protocol'
import { useCallback } from 'react'
import {
  modelCatalogSchema,
  type Agent,
  type AgentDiscovery,
  useWorkspace,
} from '@dovo/studio-core'
import { ModelSettings as Fields } from '@dovo/studio-ui'
export function ModelSettings({
  agent,
  onChange,
}: {
  agent: Agent
  onChange: (agent: Agent) => void
}) {
  const { request, connected, snapshot, refreshRuntimes } = useWorkspace()
  const load = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  const [scope, setScope] = useApplicationState('server')
  const [error, setError] = useApplicationState('')
  const { globalModelPreferences, globalModelPreferencesUpdatedAt } = useAppPreferences()
  const globalPreferences =
    (snapshot?.defaults?.globalModelPreferencesUpdatedAt ?? 0) > globalModelPreferencesUpdatedAt
      ? (snapshot?.defaults?.globalModelPreferences ?? {})
      : (globalModelPreferences ?? snapshot?.defaults?.globalModelPreferences ?? {})
  return (
    <div className="grid gap-3">
      <ChoicePicker
        aria-label="Model preference scope"
        value={scope}
        onValueChange={setScope}
        className="h-9 rounded-md border bg-background px-2 text-xs"
      >
        <option value="server">Model favorites & visibility · This server</option>
        <option value="global">Model favorites & visibility · Global</option>
      </ChoicePicker>
      <Fields
        agent={agent}
        onChange={onChange}
        connected={connected}
        loadModels={load}
        preferences={scope === 'global' ? globalPreferences : snapshot?.defaults?.modelPreferences}
        onPreference={async (key, change) => {
          if (scope === 'global') {
            updateAppPreferences({
              globalModelPreferences: {
                ...globalPreferences,
                [key]: {
                  favorite: change.favorite ?? globalPreferences[key]?.favorite ?? false,
                  disabled: change.disabled ?? globalPreferences[key]?.disabled ?? false,
                },
              },
              globalModelPreferencesUpdatedAt: Math.max(
                Date.now(),
                globalModelPreferencesUpdatedAt + 1,
                (snapshot?.defaults?.globalModelPreferencesUpdatedAt ?? 0) + 1,
              ),
            })
            return
          }
          await request('/api/agents/models/preference', { key, ...change }, runtimeDefaultsSchema)
          await refreshRuntimes()
        }}
      />
      {scope === 'server' && snapshot?.defaults?.globalModelPreferences && (
        <Button
          type="button"
          variant="outline"
          disabled={!connected}
          onClick={() => {
            void request('/api/agents/models/reset', {}, runtimeDefaultsSchema)
              .then(refreshRuntimes)
              .catch((error: unknown) =>
                setError(error instanceof Error ? error.message : String(error)),
              )
          }}
        >
          Use global model preferences on this server
        </Button>
      )}
      {!!error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
