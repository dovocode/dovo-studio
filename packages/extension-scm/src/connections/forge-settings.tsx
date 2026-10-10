import { PageHeader } from '@dovo/studio-ui'
import { useRuntimeSources, WorkspaceScope } from '@dovo/studio-core'
import { ForgeConnections } from './forge-connections'
export default function ForgeSettings() {
  const sources = useRuntimeSources()
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Source control"
        description="Accounts across your computers. Credentials stay on their host."
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-4xl space-y-5">
          {!sources.length && (
            <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">
              Connect a computer to manage source-control accounts.
            </p>
          )}
          {sources.map((source) => (
            <WorkspaceScope key={source.scope} profile={source.profile}>
              <section className="space-y-3" aria-label={`Accounts on ${source.name}`}>
                <h2 className="mb-3 text-sm font-semibold">
                  {source.name}{' '}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {source.connected ? 'Online' : 'Offline'}
                  </span>
                </h2>
                <ForgeConnections />
              </section>
            </WorkspaceScope>
          ))}
        </div>
      </div>
    </section>
  )
}
