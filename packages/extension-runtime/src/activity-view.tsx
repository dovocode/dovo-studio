import { ActivityLog } from './activity'
import { HostPage } from './host-page'
import { ActivityRetention } from './runtime-preferences'

export default function ActivityView() {
  return (
    <HostPage
      title="Activity & message history"
      description="Requests, messages and changes recorded by this computer."
    >
      <ActivityRetention />
      <ActivityLog />
    </HostPage>
  )
}
