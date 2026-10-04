import { HostSettingsPage } from '@dovo/studio-ui'
import { TitleSettings } from './title-settings'

export default function TextGenerationView({ entityId }: { entityId?: string }) {
  return (
    <HostSettingsPage
      initialRuntimeId={entityId}
      title="Titles & dictation"
      description="Choose the model used for task titles and dictation on each computer."
    >
      <TitleSettings />
    </HostSettingsPage>
  )
}
