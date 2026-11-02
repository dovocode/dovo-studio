import { Archive, ArchiveRestore, Pin, PinOff } from 'lucide-react'
import {
  projectOrganizationBlocked,
  projectOrganizationSave,
  projectOrganizationScope,
  scopedSettingsResultSchema,
  sharedProjectKey,
  type ProjectOrganizationChange,
  type Repository,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { Button } from './components/ui/button'

/** Pin and archive one project; archived projects stay reachable here to unarchive. */
export function ProjectOrganizationSettings({
  repository,
  compact = false,
}: {
  repository: Repository
  /** A single unarchive action for settings pages that only need to restore the project. */
  compact?: boolean
}) {
  const { request, connected, refreshRuntime, runtimes, activeRuntimeId, snapshot } = useWorkspace()
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const blocked = projectOrganizationBlocked(repository, snapshot?.projectOrganizationSupported)
  const disabled = !connected || busy || !!blocked
  const save = async (change: ProjectOrganizationChange) => {
    const profile = runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile
    if (!profile) return
    setBusy(true)
    setError('')
    try {
      const current = await request(
        '/api/agents/settings/read',
        projectOrganizationScope(repository),
        scopedSettingsResultSchema,
      )
      await request(
        '/api/agents/settings/save',
        projectOrganizationSave(repository, current.value, change),
        scopedSettingsResultSchema,
      )
      await refreshRuntime(profile)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const archive = (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={() => void save({ projectArchived: !repository.archived })}
    >
      {repository.archived ? (
        <ArchiveRestore className="size-3.5" aria-hidden="true" />
      ) : (
        <Archive className="size-3.5" aria-hidden="true" />
      )}
      {repository.archived ? 'Unarchive project' : 'Archive project'}
    </Button>
  )
  const feedback = (
    <>
      {blocked && <p className="w-full text-xs text-muted-foreground">{blocked}</p>}
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
  if (compact)
    return repository.archived ? (
      <div role="status" className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          Archived · hidden from new-thread project choices.
        </span>
        {archive}
        {feedback}
      </div>
    ) : null
  return (
    <section
      aria-label="Project organization"
      className="flex flex-col gap-2 rounded-lg border p-3"
    >
      <div>
        <p className="text-xs font-medium">Organize</p>
        <p className="text-xs text-muted-foreground">
          Pinned projects come first in project pickers. Archived projects leave new-thread project
          choices; their threads, settings and files are kept.{' '}
          {sharedProjectKey(repository)
            ? 'Syncs across paired computers with the same Git remote.'
            : 'Applies to this project on this computer.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={!!repository.pinned}
          disabled={disabled}
          onClick={() => void save({ projectPinned: !repository.pinned })}
        >
          {repository.pinned ? (
            <PinOff className="size-3.5" aria-hidden="true" />
          ) : (
            <Pin className="size-3.5" aria-hidden="true" />
          )}
          {repository.pinned ? 'Unpin project' : 'Pin project'}
        </Button>
        {archive}
      </div>
      {feedback}
    </section>
  )
}
