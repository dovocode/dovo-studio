import type { ReactNode } from 'react'
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
      description="Agent profiles: the provider, model, access and instructions each coding agent uses."
    >
      {({ scope, repository }) => (
        <>
          <ScopedAgents scope={scope} repository={repository} />
          <div className="grid gap-3 lg:grid-cols-2">
            <LinkCard
              title="Default agent for new tasks"
              description="Pick which profile new tasks start with, and their default access, in Task defaults."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => host.navigate({ viewId: 'task-defaults' })}
                >
                  Open task defaults
                </Button>
              }
            />
            {(scope === 'global' || scope === 'project') && (
              <LinkCard
                title="Installations & sign-in"
                description="Provider installs, ACP agents, titles and dictation belong to one computer. Choose a computer in the bar above to manage them."
              />
            )}
          </div>
          {scope === 'environment' && <EnvironmentTools />}
        </>
      )}
    </SettingsScopePage>
  )
}
function LinkCard({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/30 p-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-xs font-medium">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
function EnvironmentTools() {
  const { connected, activeRuntimeId } = useWorkspace()
  const host = useStudioHost()
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Installations & sign-in · this computer
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Update provider tools and install agents from the ACP registry on this computer. Profiles
        above use these installations.
      </p>
      {!connected && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          Connect to this computer to manage its installations.
        </p>
      )}
      <fieldset disabled={!connected} className="mt-4 space-y-4">
        <HarnessUpdates />
        <AcpRegistrySettings />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            Titles and dictation cleanup use their own model on each computer.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              host.navigate({ viewId: 'text-generation', entityId: activeRuntimeId ?? undefined })
            }
          >
            Configure titles & dictation
          </Button>
        </div>
      </fieldset>
    </details>
  )
}
