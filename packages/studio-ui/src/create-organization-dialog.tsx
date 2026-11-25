import {
  organizationChangeResultSchema,
  organizationKey,
  projectDisplayName,
  projectOrganizationAssignment,
  projectOrganizationId,
  studioOrganizations,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { Button } from './components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog'
import { Input } from './components/ui/input'
import { FormField } from './components/form-field'

export function CreateOrganizationDialog({
  onClose,
  repositoryId,
}: {
  onClose: () => void
  repositoryId?: string
}) {
  const uiText = useInterfaceText()
  const { workspace, snapshot, request, connected, activeRuntimeId, runtimes, refreshRuntime } =
    useWorkspace()
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState(repositoryId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const projects = workspace.repositories.filter(
    (repo) =>
      repo.kind !== 'scratch' && !repo.archived && !projectOrganizationId(repo, snapshot?.defaults),
  )
  const project = projects.find(
    (repo) => repo.id === (projectId ?? (projects.length === 1 ? projects[0]?.id : undefined)),
  )
  const duplicate =
    !!name.trim() &&
    [...studioOrganizations(snapshot?.defaults, workspace.repositories).values()].some(
      (entry) => organizationKey(entry.name) === organizationKey(name),
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <DialogTitle>{uiText('New organization')}</DialogTitle>
        <DialogDescription>
          {uiText('Group projects that share skills, MCP servers, and AGENTS.md instructions.')}
        </DialogDescription>
        {snapshot && !snapshot.sharedOrganizationsSupported && (
          <p className="text-sm text-muted-foreground">{uiText('Saved on this computer.')}</p>
        )}
        {projects.length ? (
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!connected || !project || !name.trim() || busy || duplicate) return
              setBusy(true)
              setError('')
              try {
                await request(
                  '/api/agents/settings/organization',
                  projectOrganizationAssignment(
                    project,
                    name,
                    [],
                    snapshot?.sharedOrganizationsSupported,
                  ),
                  organizationChangeResultSchema,
                )
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause))
                setBusy(false)
                return
              }
              const owner = runtimes.find(({ profile }) => profile.id === activeRuntimeId)
              if (owner) await refreshRuntime(owner.profile).catch(() => {})
              onClose()
            }}
          >
            <FormField label={uiText('Organization name')}>
              <Input
                value={name}
                maxLength={80}
                required
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField label={uiText('First project')}>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={project?.id ?? ''}
                disabled={busy}
                required
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="" disabled>
                  {uiText('Choose a project')}
                </option>
                {projects.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {projectDisplayName(repo)}
                  </option>
                ))}
              </select>
            </FormField>
            {duplicate && (
              <p role="alert" className="text-xs text-destructive">
                {uiText('An organization already uses this name.')}
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={!connected || !project || !name.trim() || duplicate || busy}
            >
              {uiText('Create and link organization')}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {uiText('Add an ungrouped project or folder on this computer first.')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
