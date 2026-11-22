import { Button } from '@dovo/studio-ui'
import {
  WorkspaceScope,
  clientScopeKey,
  parseStudioExtensionPageTarget,
  useStudioExtensionPage,
  useWorkspace,
  type StudioViewProps,
} from '@dovo/studio-core'
import { ExtensionComponents } from './components'

export default function ExtensionPage({ entityId }: StudioViewProps) {
  const { runtimes } = useWorkspace()
  const page = parseStudioExtensionPageTarget(entityId)
  const source = runtimes.find((entry) => entry.profile.id === page?.runtimeId)
  if (!page || !source)
    return (
      <p className="p-5 text-sm" role="status">
        This extension page has no paired computer.
      </p>
    )
  return (
    <WorkspaceScope key={clientScopeKey(source.profile.connection)} profile={source.profile}>
      <PageContent key={entityId} extensionId={page.extensionId} pageId={page.pageId} />
    </WorkspaceScope>
  )
}

function PageContent({ extensionId, pageId }: { extensionId: string; pageId: string }) {
  const { request, connected, snapshot } = useWorkspace()
  const state = useStudioExtensionPage(request, snapshot, connected, extensionId, pageId)
  const { entry, page } = state
  if (!entry || !page)
    return (
      <p className="p-5 text-sm" role="status">
        {state.error || (connected ? state.message : 'Computer offline.')}
      </p>
    )
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm text-muted-foreground">{entry.installed?.name}</p>
          <h1 className="break-words text-xl font-semibold">{page.title}</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!connected || state.busy}
          onClick={state.togglePin}
        >
          {state.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
        </Button>
      </div>
      {!connected && <p role="status">Computer offline.</p>}
      {state.error && (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      <ExtensionComponents
        entry={entry}
        contribution={page}
        save={(settings) => state.saveSettings(entry, settings)}
      />
    </div>
  )
}
