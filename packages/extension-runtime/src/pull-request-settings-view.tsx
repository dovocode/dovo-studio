import { HostPage } from './host-page'
import { PullRequestPreferences } from './runtime-preferences'

export default function SettingsView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Pull requests & pipelines"
      description="Link pull requests, choose what happens when they close and enable monitoring."
    >
      <PullRequestPreferences />
    </HostPage>
  )
}
