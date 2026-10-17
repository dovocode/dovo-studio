import { HostPage } from './host-page'
import { PullRequestPreferences } from './runtime-preferences'
import { PullRequestCreationDefaults } from './pull-request-creation-defaults'

export default function SettingsView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Pull requests & pipelines"
      description="Creation defaults are saved on this device. Lifecycle and monitoring settings are saved on the selected computer."
      localSettings={<PullRequestCreationDefaults />}
    >
      <PullRequestPreferences />
    </HostPage>
  )
}
