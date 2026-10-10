import { ActivityLog } from './activity'
import { HostPage } from './host-page'
import { ActivityRetention } from './runtime-preferences'

export default function ActivityView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Activity & message history"
      description="Requests, messages and changes recorded by this computer."
    >
      <div className="space-y-6">
        <ActivityRetention />
        <ActivityLog />
      </div>
    </HostPage>
  )
}
