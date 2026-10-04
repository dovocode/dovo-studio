import { useWorkspace } from '@dovo/studio-core'
import { SettingsScopePage, TaskDefaultSettings } from '@dovo/studio-ui'
import { ScopedAgents } from './scoped-agents'
import { HarnessUpdates } from './harness-updates'
import { AcpRegistrySettings } from './acp-registry'
import { TitleSettings } from './title-settings'
export default function AgentsView() {
  return (
    <SettingsScopePage
      wide
      title="Agents"
      description="Default agent and reusable configurations, inherited across environments and projects."
    >
      {({ scope, repository }) => (
        <>
          <ScopedAgents scope={scope} repository={repository} />
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">Task defaults</summary>
            <div className="mt-4">
              <TaskDefaultSettings scope={scope} repository={repository} inline />
            </div>
          </details>
          {scope === 'environment' && <EnvironmentTools />}
          {(scope === 'global' || scope === 'project') && (
            <p className="text-xs text-muted-foreground">
              Choose an environment to manage installations, accounts, titles and dictation.
            </p>
          )}
        </>
      )}
    </SettingsScopePage>
  )
}
function EnvironmentTools() {
  const { connected } = useWorkspace()
  return (
    <fieldset disabled={!connected} className="space-y-4 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Environment tools</h2>
      <HarnessUpdates />
      <AcpRegistrySettings />
      <TitleSettings />
    </fieldset>
  )
}
