import { TaskDefaultSettings } from '@dovo/studio-ui'
import { HostPage } from './host-page'

export default function TaskDefaultsView() {
  return (
    <HostPage
      title="Task defaults"
      description="How new tasks start on this computer. Projects can override these."
    >
      <TaskDefaultSettings inline />
    </HostPage>
  )
}
