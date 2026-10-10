import { HostSettingsPage } from '@dovo/studio-ui'
import { TitleSettings } from './title-settings'

export default function TextGenerationView({ entityId }: { entityId?: string }) {
  return (
    <HostSettingsPage
      initialRuntimeId={entityId}
      title="Titles & dictation"
      description="The model each computer uses to name new tasks and clean up dictation."
    >
      <TitleSettings />
    </HostSettingsPage>
  )
}
