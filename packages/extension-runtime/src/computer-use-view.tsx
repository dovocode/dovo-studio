import { CommandSettings } from './command-settings'
import { HostPage } from './host-page'

export default function ComputerUseView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Computer use"
      description="Install CuaDriver, grant desktop permissions, connect agents and manage optional Computer History on this computer."
    >
      <CommandSettings computerUse />
    </HostPage>
  )
}
