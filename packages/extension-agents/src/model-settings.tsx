import { useAppPreferences, updateAppPreferences } from '@dovo/studio-core'
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dovo/studio-ui'
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

type PreferenceScope = 'server' | 'global'
const preferenceScopes: readonly { id: PreferenceScope; name: string }[] = [
  { id: 'server', name: 'This computer' },
  { id: 'global', name: 'All computers' },
]

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
  const [scope, setScope] = useApplicationState<PreferenceScope>('server')
  const [error, setError] = useApplicationState('')
  const [resetting, setResetting] = useApplicationState(false)
  const { globalModelPreferences, globalModelPreferencesUpdatedAt } = useAppPreferences()
  const globalPreferences =
    (snapshot?.defaults?.globalModelPreferencesUpdatedAt ?? 0) > globalModelPreferencesUpdatedAt
      ? (snapshot?.defaults?.globalModelPreferences ?? {})
      : (globalModelPreferences ?? snapshot?.defaults?.globalModelPreferences ?? {})
  return (
    <div className="grid gap-3">
      <Fields
        layout="settings"
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
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Where model favorites are saved</summary>
        <div className="mt-3 grid gap-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-sm leading-relaxed">
              Favorites and hidden models apply to every profile. Save them for this computer only,
              or share them across all your computers.
            </p>
            <Select
              value={scope}
              onValueChange={(value) => {
                const next = preferenceScopes.find((entry) => entry.id === value)
                if (next) setScope(next.id)
              }}
            >
              <SelectTrigger aria-label="Model preference scope" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {preferenceScopes.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {scope === 'server' && snapshot?.defaults?.globalModelPreferences && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <p className="max-w-sm leading-relaxed">
                Replace this computer’s favorites and hidden models with the shared list.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!connected || resetting}
                onClick={() => {
                  setResetting(true)
                  setError('')
                  void request('/api/agents/models/reset', {}, runtimeDefaultsSchema)
                    .then(refreshRuntimes)
                    .catch((error: unknown) =>
                      setError(error instanceof Error ? error.message : String(error)),
                    )
                    .finally(() => setResetting(false))
                }}
              >
                {resetting ? 'Switching…' : 'Use shared list here'}
              </Button>
            </div>
          )}
        </div>
      </details>
      {!!error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
