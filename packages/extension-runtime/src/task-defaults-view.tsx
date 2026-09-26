import { TaskDefaultSettings } from '@dovo/studio-ui'
import { HostPage } from './host-page'
import { RuntimePreferences } from './runtime-preferences'

export default function TaskDefaultsView() {
  return (
    <HostPage
      title="Task defaults"
      description="How tasks start, resume and are tidied up on this computer."
    >
      {/* Short, high-impact switches first; the long model form follows. */}
      <RuntimePreferences />
      <TaskDefaultSettings inline />
    </HostPage>
  )
}
