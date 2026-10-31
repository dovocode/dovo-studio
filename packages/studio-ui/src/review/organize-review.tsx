import { useCallback } from 'react'
import {
  acpInstallationHarness,
  acpHarnessChoiceId,
  defaultTaskHarness,
  modelCatalogSchema,
  providerSchema,
  supportsUtilities,
  titleSettingsForHarness,
  type Agent,
  type AgentDiscovery,
} from '@dovo/protocol'
import { providers, useFileReview, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { Button } from '../components/ui/button'
import { ChoicePicker } from '../choice-picker'
import { ReviewGuideCard } from './review-guide'
import { ModelSettings } from '../model-settings'

export function OrganizeReview({
  review,
  disabled = false,
  onOrganized,
  onOpenFile,
}: {
  review: ReturnType<typeof useFileReview>
  disabled?: boolean
  onOrganized: () => void
  onOpenFile: (path: string) => void
}) {
  const { workspace, request, connected, snapshot } = useWorkspace()
  const [agent, setAgent] = useApplicationState<Agent | null>(null)
  const loadModels = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  const blocked =
    disabled || !review.ready || !connected || review.organizing || !review.progress?.files.length
  return (
    <div className="max-h-[45%] shrink-0 overflow-y-auto border-b px-3 py-2 text-xs">
      <details>
        <summary className="cursor-pointer font-medium">
          Organize review {review.featureGroups ? '· Feature groups active' : '· Harness & model'}
        </summary>
        <div className="mt-2 space-y-3">
          <p className="text-muted-foreground">
            Group changes by feature and explain linked impact. The selected model reads the diff;
            verify its suggestions as you review.
          </p>
          <fieldset
            disabled={review.organizing || disabled}
            className="space-y-3 disabled:opacity-60"
          >
            <ChoicePicker
              aria-label="Review organizer harness"
              value={
                !agent
                  ? 'titles'
                  : agent.id.startsWith('saved:')
                    ? agent.id
                    : agent.acpInstallationId
                      ? acpHarnessChoiceId(agent.acpInstallationId)
                      : agent.provider
              }
              onValueChange={(value) => {
                if (value === 'titles') {
                  setAgent(null)
                  return
                }
                const installation = snapshot?.acpInstallations?.find(
                  (item) => acpHarnessChoiceId(item.id) === value,
                )
                if (installation) {
                  setAgent({
                    ...acpInstallationHarness(installation, 'read-only'),
                    id: 'review-organizer',
                    name: installation.name,
                  })
                  return
                }
                const saved = workspace.agents.find((item) => `saved:${item.id}` === value)
                if (saved) setAgent({ ...saved, id: `saved:${saved.id}`, permission: 'read-only' })
                else {
                  const provider = providerSchema.literals.find((item) => item === value)
                  if (provider)
                    setAgent({
                      ...defaultTaskHarness(provider),
                      id: 'review-organizer',
                      name: providers[provider].short,
                    })
                }
              }}
            >
              <option value="titles">Title harness & model (default)</option>
              {snapshot?.acpInstallations?.map((item) => (
                <option key={item.id} value={acpHarnessChoiceId(item.id)}>
                  {item.name} · ACP
                </option>
              ))}
              {providerSchema.literals
                .filter((provider) => supportsUtilities(provider) && provider !== 'acp')
                .map((provider) => (
                  <option key={provider} value={provider}>
                    {providers[provider].short}
                  </option>
                ))}
              {workspace.agents
                .filter((agent) => supportsUtilities(agent.provider))
                .map((agent) => (
                  <option key={agent.id} value={`saved:${agent.id}`}>
                    {agent.name}
                  </option>
                ))}
            </ChoicePicker>
            {agent ? (
              <ModelSettings
                agent={agent}
                onChange={setAgent}
                loadModels={loadModels}
                connected={connected}
                modes={false}
                preferences={snapshot?.defaults?.modelPreferences}
              />
            ) : (
              <p className="text-muted-foreground">
                Uses the title harness and model configured on this computer in a separate ephemeral
                session.
              </p>
            )}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={blocked}
              onClick={() => {
                void review
                  .organize(agent ? titleSettingsForHarness(agent) : undefined)
                  .then((success) => {
                    if (success) onOrganized()
                  })
              }}
            >
              {review.organizing
                ? 'Organizing…'
                : review.featureGroups
                  ? 'Regroup by feature'
                  : 'Organize by feature'}
            </Button>
            {!!review.progress?.revision && (
              <Button
                size="sm"
                variant="outline"
                disabled={blocked}
                onClick={() => {
                  void review
                    .organize(agent ? titleSettingsForHarness(agent) : undefined, true)
                    .then((success) => {
                      if (success) onOrganized()
                    })
                }}
              >
                Generate guided review
              </Button>
            )}
            {review.featureGroups && (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || review.organizing}
                onClick={review.clearGroups}
              >
                Reset to folders
              </Button>
            )}
          </div>
        </div>
      </details>
      {review.progress?.guide && (
        <ReviewGuideCard
          guide={review.progress.guide}
          busy={review.busy}
          disabled={disabled || !review.ready}
          onMove={review.moveGuide}
          onOpenFile={onOpenFile}
        />
      )}
      {!!review.error && (
        <p role="alert" className="text-destructive">
          {review.error}
        </p>
      )}
      {review.organizeError && (
        <p role="alert" className="mt-2 text-destructive">
          {review.organizeError}
        </p>
      )}
    </div>
  )
}
