import { HostPage } from './host-page'
import { RunningTaskPreferences } from './runtime-preferences'

export default function RunningTasksView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Running tasks"
      description="Control task recovery, child agent limits and automatic archiving."
    >
      <RunningTaskPreferences />
    </HostPage>
  )
}
