import { HostPage } from './host-page'
import { RunningTaskPreferences } from './runtime-preferences'
import { LifecycleLink } from './lifecycle-link'
export default function RunningTasksView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      saveInfo="Saved automatically. Text fields save on Enter or when you leave the field."
      title="Running threads"
      description="Control web approvals, thread recovery, child agent limits and automatic archiving."
    >
      <RunningTaskPreferences showSaveInfo={false}>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            These are computer defaults. Scoped lifecycle settings override restart and archiving
            defaults.
          </p>
          <LifecycleLink />
        </div>
      </RunningTaskPreferences>
    </HostPage>
  )
}
