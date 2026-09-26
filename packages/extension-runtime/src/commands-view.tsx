import { CommandSettings } from './command-settings'
import { HostPage } from './host-page'

export default function CommandsView() {
  return (
    <HostPage
      title="CLI commands & shell"
      description="Executables and the terminal shell this computer uses for agents, Git and forges."
    >
      <CommandSettings />
    </HostPage>
  )
}
