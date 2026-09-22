import { useEffect, useRef, useState } from 'react'
import {
  forgeLabels,
  forgeRepositoryPageSchema,
  responses,
  useWorkspace,
  type ForgeRepository,
  type ForgeRepositoryPage,
  type Repository,
} from '@dovo/studio-core'
import { Button, ChoicePicker, FormField, Input } from '@dovo/studio-ui'
import { ForgeConnectionsButton, useForgeConnections } from './forge-connections'

type Binding = { connectionId: string; repository: string }
function RepositoryResults({
  connectionId,
  repositoryId,
  onSelect,
}: {
  connectionId: string
  repositoryId?: string
  onSelect: (repo: ForgeRepository) => void
}) {
  const { request, connected } = useWorkspace()
  const [load, setLoad] = useState({ page: 1 })
  const [data, setData] = useState<ForgeRepositoryPage | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setBusy(true)
    setError('')
    void request(
      '/api/scm/repositories/forge/read',
      { connectionId, repositoryId, page: load.page },
      forgeRepositoryPageSchema,
    )
      .then((result) => {
        if (current)
          setData((previous) => ({
            ...result,
            repositories:
              load.page === 1
                ? result.repositories
                : [
                    ...new Map(
                      [...(previous?.repositories ?? []), ...result.repositories].map((repo) => [
                        repo.id,
                        repo,
                      ]),
                    ).values(),
                  ],
          }))
      })
      .catch((error: unknown) => {
        if (current) setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (current) setBusy(false)
      })
    return () => {
      current = false
    }
  }, [request, connectionId, repositoryId, load])
  const repositories =
    data?.repositories.filter((r) =>
      r.fullName.toLowerCase().includes(filter.trim().toLowerCase()),
    ) ?? []
  return (
    <section
      className="grid gap-2 rounded-lg border p-3"
      aria-label="Available repositories"
      aria-busy={busy}
    >
      <Input
        aria-label="Filter loaded repositories"
        placeholder="Filter repositories…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="grid max-h-52 gap-1 overflow-y-auto">
        {repositories.map((repo) => (
          <Button
            key={repo.id}
            type="button"
            variant="ghost"
            disabled={!connected}
            className="h-auto justify-start whitespace-normal break-all text-left text-xs"
            onClick={() => onSelect(repo)}
          >
            {repo.fullName}
          </Button>
        ))}
      </div>
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading repositories…
        </p>
      )}
      {!busy && !error && !repositories.length && (
        <p className="text-xs text-muted-foreground">
          No matching repositories loaded. Enter the repository name above or load another page.
        </p>
      )}
      {error && (
        <>
          <p role="alert" className="break-words text-xs text-destructive">
            {error}
          </p>
          <p className="text-xs text-muted-foreground">
            A token scoped to specific repositories may not allow browsing. You can enter the
            repository directly.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !connected}
            onClick={() => setLoad({ ...load })}
          >
            Retry
          </Button>
        </>
      )}
      {data?.hasMore && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !connected}
          onClick={() => setLoad({ page: data.page + 1 })}
        >
          Load more
        </Button>
      )}
    </section>
  )
}

export function ForgeRepositoryFields({
  value,
  onChange,
  onSelect,
  disabled = false,
  allowAutomatic = false,
  repositoryId,
}: {
  value: Binding
  onChange: (value: Binding) => void
  onSelect?: (repository: ForgeRepository) => void
  disabled?: boolean
  allowAutomatic?: boolean
  repositoryId?: string
}) {
  const { connected } = useWorkspace()
  const { connections, loading, error, reload } = useForgeConnections()
  const [browse, setBrowse] = useState(false)
  const selected = connections.find((c) => c.id === value.connectionId)
  return (
    <div className="grid gap-3">
      <FormField label="Source control connection">
        <ChoicePicker
          aria-label="Source control connection"
          disabled={disabled || !connected || loading}
          value={value.connectionId}
          onValueChange={(connectionId) => {
            onChange({ connectionId, repository: '' })
            setBrowse(false)
          }}
        >
          <option value="">
            {allowAutomatic ? 'GitHub CLI · Detect from checkout' : 'Choose a connection…'}
          </option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {forgeLabels[c.provider]}
            </option>
          ))}
          {value.connectionId && !selected && (
            <option value={value.connectionId} disabled>
              Unavailable connection
            </option>
          )}
        </ChoicePicker>
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ForgeConnectionsButton onChange={reload} repositoryId={repositoryId} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reload}
          disabled={disabled || loading || !connected}
        >
          Refresh connections
        </Button>
      </div>
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
      {value.connectionId && (
        <>
          <FormField
            label={
              selected?.provider === 'azure-devops'
                ? 'Project / repository'
                : selected?.provider === 'bitbucket'
                  ? 'Workspace / repository'
                  : 'Owner / repository'
            }
          >
            <Input
              required
              disabled={disabled}
              value={value.repository}
              onChange={(e) => onChange({ ...value, repository: e.target.value })}
              placeholder={
                selected?.provider === 'azure-devops' ? 'Project/Repository' : 'owner/repository'
              }
              autoCapitalize="off"
              spellCheck={false}
            />
          </FormField>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !connected || !selected}
            onClick={() => setBrowse((v) => !v)}
          >
            {browse ? 'Hide repositories' : 'Browse repositories…'}
          </Button>
          {browse && (
            <RepositoryResults
              key={`${value.connectionId}:${repositoryId ?? ''}`}
              connectionId={value.connectionId}
              repositoryId={repositoryId}
              onSelect={(repo) => {
                onChange({ ...value, repository: repo.fullName })
                onSelect?.(repo)
                setBrowse(false)
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

export function ProjectForgeBinding({ repo }: { repo: Repository }) {
  const { request, connected } = useWorkspace()
  const [value, setValue] = useState<Binding>({
    connectionId: repo.forge?.connectionId ?? '',
    repository: repo.forge?.repository ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const running = useRef(false)
  const changed =
    value.connectionId !== (repo.forge?.connectionId ?? '') ||
    value.repository !== (repo.forge?.repository ?? '')
  return (
    <form
      className="grid gap-3 border-t pt-4"
      aria-label="Project source control"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault()
        if (running.current) return
        running.current = true
        setBusy(true)
        setError('')
        setSaved(false)
        void request(
          '/api/scm/repositories/forge/bind',
          {
            repositoryId: repo.id,
            forge: value.connectionId ? { ...value, repository: value.repository.trim() } : null,
          },
          responses.ok,
        )
          .then(() => setSaved(true))
          .catch((error: unknown) =>
            setError(error instanceof Error ? error.message : String(error)),
          )
          .finally(() => {
            running.current = false
            setBusy(false)
          })
      }}
    >
      <h3 className="text-sm font-medium">Pull requests</h3>
      <ForgeRepositoryFields
        repositoryId={repo.id}
        value={value}
        onChange={(next) => {
          setValue(next)
          setSaved(false)
        }}
        disabled={busy}
        allowAutomatic
      />
      <p className="text-xs text-muted-foreground">
        Link the checkout to its hosted repository. This changes where PRs are loaded; it does not
        change the Git remote.
      </p>
      {error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-muted-foreground">
          Project connection saved.
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={
          !connected || busy || !changed || (!!value.connectionId && !value.repository.trim())
        }
      >
        {busy ? 'Verifying…' : 'Save project connection'}
      </Button>
    </form>
  )
}
