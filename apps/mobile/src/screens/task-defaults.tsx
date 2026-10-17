import { ScopedSettings } from '../runtime/preferences/settings-target'
import { TaskDefaultSettings } from '../runtime/preferences/task-default-settings'
import { ScreenHeader } from '../ui/layout/screen-header'
import { SettingsPage } from './settings-theme'

export default function TaskDefaultsScreen() {
  return (
    <SettingsPage>
      <ScreenHeader title="Task defaults" />
      <ScopedSettings scrollable>
        {({ scope, repository }) => (
          <TaskDefaultSettings inline scope={scope} repository={repository} />
        )}
      </ScopedSettings>
    </SettingsPage>
  )
}
