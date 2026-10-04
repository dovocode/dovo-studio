import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { SettingsScopePage, Button } from '@dovo/studio-ui'
import { ScopedAgents } from './scoped-agents'
import { HarnessUpdates } from './harness-updates'
import { AcpRegistrySettings } from './acp-registry'
export default function AgentsView() {
  const host = useStudioHost()
  return (
    <SettingsScopePage
      wide
      title="Agents"
      description="Providers, models and reusable profiles for your coding agents."
    >
      {({ scope, repository }) => (
        <>
          <ScopedAgents scope={scope} repository={repository} />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/30 p-4">
            <div>
              <h2 className="text-xs font-medium">Default agent for new tasks</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose a profile and default permissions in Task defaults.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => host.navigate({ viewId: 'task-defaults' })}
            >
              Open task defaults
            </Button>
          </div>
          {scope === 'environment' && <EnvironmentTools />}
          {(scope === 'global' || scope === 'project') && (
            <p className="text-xs text-muted-foreground">
              Choose a computer to manage installations, accounts, titles and dictation.
            </p>
          )}
        </>
      )}
    </SettingsScopePage>
  )
}
function EnvironmentTools() {
  const { connected, activeRuntimeId } = useWorkspace()
  const host = useStudioHost()
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Provider installations · this computer
      </summary>
      <fieldset disabled={!connected} className="mt-4 space-y-4">
        <HarnessUpdates />
        <AcpRegistrySettings />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            host.navigate({ viewId: 'text-generation', entityId: activeRuntimeId ?? undefined })
          }
        >
          Configure titles & dictation
        </Button>
      </fieldset>
    </details>
  )
}
