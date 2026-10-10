import { CommandSettings } from './command-settings'
import { HostPage } from './host-page'

export default function ComputerUseView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Computer use"
      description="Set up desktop access for agents and optional Computer History."
    >
      <CommandSettings computerUse />
    </HostPage>
  )
}
