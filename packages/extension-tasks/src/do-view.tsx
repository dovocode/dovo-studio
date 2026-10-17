import { type RuntimeProfile } from '@dovo/protocol'
import { useStudioHost, useWorkspace, type StudioViewProps } from '@dovo/studio-core'
import { Button, EmptyState, PageHeader } from '@dovo/studio-ui'
import { MessageCircle } from 'lucide-react'
import { DoChat } from './do/chat-start'
import { DoPlans } from './do/plans-view'

export default function DoView({ entityId, navigationKey }: StudioViewProps) {
  const { runtimeRegistry, connected, snapshot } = useWorkspace()
  const host = useStudioHost()
  const profile = runtimeRegistry.profiles.find((item) => item.id === runtimeRegistry.activeId)
  if (!profile || !connected || !snapshot?.doEnabled)
    return (
      <section className="flex h-full min-w-0 flex-col" aria-label="Do workspace">
        <PageHeader title="Do" description="Experimental · Start with a conversation." />
        <EmptyState
          icon={<MessageCircle />}
          title={
            !profile ? 'Select a computer' : !connected ? 'Computer offline' : 'Do is turned off'
          }
          description={
            !profile
              ? 'Connect to a paired computer to talk to Do.'
              : !connected
                ? 'Reconnect the selected computer to continue your conversations and review its plans.'
                : 'Enable Do (experimental) in Settings → Running tasks for this computer.'
          }
          action={
            profile && connected ? (
              <Button onClick={() => host.navigate({ viewId: 'running-tasks' })}>
                Open settings
              </Button>
            ) : undefined
          }
        />
      </section>
    )
  // A new pairing or selected computer gets a fresh scope; old responses cannot enter it.
  return (
    <DoWorkspace
      key={JSON.stringify([profile.id, profile.connection.address, profile.connection.token])}
      profile={profile}
      entityId={entityId}
      navigationKey={navigationKey}
    />
  )
}

function DoWorkspace({
  profile,
  entityId,
  navigationKey,
}: StudioViewProps & { profile: RuntimeProfile }) {
  const host = useStudioHost()
  // A plan UUID is a direct link to the exact saved proposal; `plans` opens the list.
  return entityId ? (
    <DoPlans
      profile={profile}
      runId={entityId === 'plans' ? undefined : entityId}
      navigationKey={navigationKey}
      onChat={() => host.navigate({ viewId: 'do' })}
    />
  ) : (
    <DoChat profile={profile} onPlans={() => host.navigate({ viewId: 'do', entityId: 'plans' })} />
  )
}
