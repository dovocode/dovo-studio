import { HostPage } from './host-page'
import { StudioToolsPreferences } from './runtime-preferences'
export default function SettingsView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Studio Tools"
      description="Experimental tools for agents to operate and inspect Studio on this computer."
    >
      <StudioToolsPreferences />
    </HostPage>
  )
}
