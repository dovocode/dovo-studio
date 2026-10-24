import { createRuntimeClient, responses } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { HostPage } from './host-page'
import { RemoteDesktopPreferences } from './runtime-preferences'
import { DesktopViewer } from './desktop-viewer'

export default function RemoteDesktopView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Remote desktop"
      description="Experimental access to this computer’s primary display through Cua Driver."
    >
      <RemoteDesktopPreferences />
      <RemoteDesktopViewer />
    </HostPage>
  )
}
export function RemoteDesktopViewer() {
  const { request, connected, snapshot, connection } = useWorkspace()
  return (
    <DesktopViewer
      request={request}
      connected={connected}
      enabled={snapshot?.remoteDesktopEnabled === true}
      unlockUrl={async (id) => {
        if (!connection) throw new Error('Computer offline')
        const ticket = await request('/api/remote-desktop/unlock-ticket', { id }, responses.ticket)
        return createRuntimeClient(connection).socketUrl('/ws/remote-desktop/unlock', ticket)
      }}
    />
  )
}
