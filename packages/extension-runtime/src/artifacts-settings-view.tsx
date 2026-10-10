import { HostPage } from './host-page'
import { ArtifactPreferences } from './runtime-preferences'

export default function SettingsView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Artifacts"
      description="Enable documents and interactive previews, and choose how long to keep them."
    >
      <ArtifactPreferences />
    </HostPage>
  )
}
