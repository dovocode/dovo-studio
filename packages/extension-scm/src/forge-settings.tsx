import { useRuntimeSources, WorkspaceScope } from '@dovo/studio-core'
import { ForgeConnections } from './forge-connections'
export default function ForgeSettings() {
  const sources = useRuntimeSources()
  return (
    <section className="min-h-0 flex-1 overflow-y-auto">
      <header className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Source control</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accounts across your computers. Credentials stay on their host.
        </p>
      </header>
      <div className="mx-auto max-w-4xl space-y-8 p-6">
        {!sources.length && (
          <p className="text-sm text-muted-foreground">
            Connect a computer to manage source-control accounts.
          </p>
        )}
        {sources.map((source) => (
          <WorkspaceScope key={source.scope} profile={source.profile}>
            <section aria-label={`Accounts on ${source.name}`}>
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
    </section>
  )
}
