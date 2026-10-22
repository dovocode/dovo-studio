import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { HostPage } from './host-page'
import { RunningTaskPreferences } from './runtime-preferences'

function LifecycleLink() {
  const host = useStudioHost()
  const { activeRuntimeId } = useWorkspace()
  return (
    <Button
      variant="link"
      onClick={() =>
        host.navigate({ viewId: 'task-behavior', entityId: activeRuntimeId ?? undefined })
      }
    >
      Open scoped task lifecycle
    </Button>
  )
}
export default function RunningTasksView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Running tasks"
      description="Control web approvals, task recovery, child agent limits and automatic archiving."
    >
      <p className="text-xs text-muted-foreground">
        These are computer defaults. Scoped lifecycle settings override restart and archiving
        defaults.
      </p>
      <LifecycleLink />
      <RunningTaskPreferences />
    </HostPage>
  )
}
