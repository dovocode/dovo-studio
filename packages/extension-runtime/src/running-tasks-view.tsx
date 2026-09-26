import { HostPage } from './host-page'
import { RunningTaskPreferences } from './runtime-preferences'

export default function RunningTasksView() {
  return (
    <HostPage
      title="Running tasks"
      description="What this computer does with tasks on its own: resuming, staying awake and tidying up."
    >
      <RunningTaskPreferences />
    </HostPage>
  )
}
