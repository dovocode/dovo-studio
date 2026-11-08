import { HostSettingsPage } from '@dovo/studio-ui'
import { TitleSettings } from './title-settings'

export default function TextGenerationView({ entityId }: { entityId?: string }) {
  return (
    <HostSettingsPage
      initialRuntimeId={entityId}
      title="Titles & dictation"
      description="The model each computer uses to name new threads and clean up dictation."
    >
      <TitleSettings />
      <TitleSettings selection />
    </HostSettingsPage>
  )
}
