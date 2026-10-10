import { CommandSettings } from './command-settings'
import { HostPage } from './host-page'

export default function CommandsView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="CLI commands & shell"
      description="Choose the shell and command paths used on this computer."
    >
      <CommandSettings />
    </HostPage>
  )
}
